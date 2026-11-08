import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { duNoHienTaiCuaNcc, gopNoTheoNcc, tongNoNcc } from "@/lib/payables/so-no-ncc"
import { adoptNewKeys } from "@/hooks/use-list-view-prefs"
import { PAYABLE_COLUMNS, DEFAULT_PAYABLE_COLUMNS } from "@/app/(dashboard)/payables/list-config"

/**
 * Chủ nhà 08/11/2026: "Phần công nợ NCC : Công nợ chưa có cột dư nợ hiện tại".
 * Màn Công nợ NCC mỗi dòng là MỘT chứng từ ("Còn lại" của riêng chứng từ ấy) — cột mới là tổng đang nợ NCC của dòng,
 * cùng số với "Dư nợ hiện tại" (cột "Còn lại" cũ) của màn Theo NCC và ô Công nợ NCC ở chi tiết NCC.
 */
const doc = (p: string) => readFileSync(p, "utf8")

/**
 * Sổ khoản nợ NCC. Màn Công nợ NCC chỉ đọc khoản CHƯA XONG (`.neq("status", "paid")`), nhưng `gopNoTheoNcc` dùng chung
 * với báo cáo NCC (đọc mọi dòng) — nên tự bỏ khoản đã xong, như `status <> 'paid'` của `payables_by_supplier`.
 */
const SO = [
  // Vinamilk: phiếu nhập 300.000 đã trả 100.000 · phiếu trả NCC −50.000 → 150.000
  { supplier_id: "vnm", amount: 300000, paid: 100000, status: "partial", due_date: "2026-10-01" },
  { supplier_id: "vnm", amount: -50000, paid: 0, status: "open", due_date: null },
  // … khoản đã xong (status 'paid') không tính, kể cả khi số lệch vài đồng làm tròn
  { supplier_id: "vnm", amount: 200000, paid: 199999.5, status: "paid", due_date: "2026-08-01" },
  // Kinh Đô: tiền trả trước −80.000 + phiếu nhập 50.000 → NCC còn nợ lại mình 30.000 (âm, không kẹp)
  { supplier_id: "kd", amount: -80000, paid: 0, status: "open", due_date: null },
  { supplier_id: "kd", amount: 50000, paid: 0, status: "open", due_date: "2026-12-01" },
  // Ba Huân: khoản đã trả đủ mà trạng thái chưa kịp đổi (amount = paid) → 0
  { supplier_id: "bh", amount: 70000, paid: 70000, status: "partial", due_date: null },
]

describe("dư nợ hiện tại của NCC (cột mới ở Công nợ NCC)", () => {
  const m = gopNoTheoNcc(SO)

  it("= Σ(phải trả − đã trả) mọi khoản chưa xong của NCC, trừ dòng âm (trả NCC, trả trước) — không kẹp 0", () => {
    expect(duNoHienTaiCuaNcc(m, "vnm")).toBe(150000)
    expect(duNoHienTaiCuaNcc(m, "kd")).toBe(-30000)
    expect(duNoHienTaiCuaNcc(m, "bh")).toBe(0)
  })

  it("NCC không còn khoản nào chưa xong (mọi dòng đã trả đủ) → 0, không phải '—'", () => {
    expect(duNoHienTaiCuaNcc(m, "ncc-da-tra-het")).toBe(0)
  })

  it("chưa đọc xong / đọc hỏng / chạm trần (map null) hoặc dòng thiếu NCC → null (ô hiện '—', không hiện số thiếu)", () => {
    expect(duNoHienTaiCuaNcc(null, "vnm")).toBeNull()
    expect(duNoHienTaiCuaNcc(m, null)).toBeNull()
    expect(duNoHienTaiCuaNcc(m, undefined)).toBeNull()
  })

  it("khớp ô Công nợ NCC ở chi tiết NCC (`tongNoNcc` trên sổ của một NCC, kể cả dòng đã trả)", () => {
    expect(duNoHienTaiCuaNcc(m, "vnm")).toBe(tongNoNcc(SO.filter((r) => r.supplier_id === "vnm")))
    expect(duNoHienTaiCuaNcc(m, "kd")).toBe(tongNoNcc(SO.filter((r) => r.supplier_id === "kd")))
  })

  it("khớp `payables_by_supplier.remaining` (mig 239): SUM(amount − paid) WHERE status <> 'paid' GROUP BY NCC", () => {
    const mig = doc("supabase/migrations/239_cong_no_ncc_hang_tra_lai.sql")
    expect(mig).toContain("COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0)")
    expect(mig).toContain("AND p.status <> 'paid'")
    const gom = new Map<string, number>()
    for (const r of SO) if (r.status !== "paid") gom.set(r.supplier_id, (gom.get(r.supplier_id) ?? 0) + r.amount - r.paid)
    gom.forEach((v, id) => expect(duNoHienTaiCuaNcc(m, id)).toBe(v))
    expect(gom.size).toBe(3)
  })
})

describe("màn Công nợ NCC: cột 'Dư nợ hiện tại'", () => {
  it("có trong danh mục cột và bật sẵn, ngay sau 'Còn lại'", () => {
    const keys = PAYABLE_COLUMNS.map((c) => c.key) as string[]
    expect(PAYABLE_COLUMNS.find((c) => c.key === "duNo")?.label).toBe("Dư nợ hiện tại")
    expect(keys.indexOf("duNo")).toBe(keys.indexOf("remaining") + 1)
    expect(DEFAULT_PAYABLE_COLUMNS).toContain("duNo")
  })

  it("người đã chỉnh cột từ trước (bản lưu chưa biết cột này) vẫn thấy cột mới hiện ra", () => {
    const cu = ["invoiceNumber", "amount", "paid", "remaining", "dueDate", "aging", "status"]
    const tat = cu.filter((k) => k !== "aging") // người dùng từng tắt Tuổi nợ
    const sau = adoptNewKeys<string>(tat, cu, PAYABLE_COLUMNS.map((c) => c.key))
    expect(sau).toContain("duNo")
    expect(sau, "cột người dùng đã tắt vẫn tắt").not.toContain("aging")
  })

  it("cộng từ sổ khoản chưa xong của bốn ô tổng (không thêm câu hỏi máy chủ); chưa đọc xong / hỏng / thiếu thì không có số", () => {
    const s = doc("src/app/(dashboard)/payables/page.tsx")
    expect(s).toContain("() => (statsReady && !statsError && !statsTruncated ? gopNoTheoNcc(allOpen) : null)")
    expect(s).toMatch(/setAllOpen\(res\.rows\)\s*\n\s*setStatsReady\(true\)/)
    expect(s).not.toMatch(/rpc\("payables_by_supplier"/)
  })

  it("danh sách đọc kèm supplier_id; bảng, thẻ điện thoại và xem nhanh cùng một hàm", () => {
    const s = doc("src/app/(dashboard)/payables/page.tsx")
    expect(s).toContain('"id, supplier_id, invoice_number, amount, paid, due_date, status, opening_balance, supplier:suppliers(name, code)"')
    expect(s).toContain('k: "duNo", key: "duNo", label: "Dư nợ hiện tại"')
    expect(s).toContain("render: (p) => <ODuNo v={duNoHienTaiCuaNcc(duNoNcc, p.supplier_id)} cho={!statsReady} />")
    expect(s).toContain("const duNo = duNoHienTaiCuaNcc(duNoNcc, p.supplier_id)")
    expect(s).toContain('(duNo === null ? "" : ` · Dư nợ hiện tại ${formatCurrency(duNo)}`)')
    expect(s).toContain('{ label: "Dư nợ hiện tại của NCC", value: <ODuNo v={duNoHienTaiCuaNcc(duNoNcc, xem.supplier_id)} cho={!statsReady} />, wide: true }')
    // Bảng cột dựng lại khi số dư về — thiếu thì ô đứng mãi ở khung chờ.
    expect(s).toContain("}, [visibleColumns, chungTu, duNoNcc, statsReady])")
  })

  it("màn Theo NCC: cột 'Còn lại' đổi tên 'Dư nợ hiện tại' (cùng số, cùng tên) — máy tính và điện thoại", () => {
    const s = doc("src/app/(dashboard)/payables/by-supplier/page.tsx")
    expect(s).toContain('<TableHead className="text-right">Dư nợ hiện tại</TableHead>')
    expect(s).toContain('<p className="text-muted-foreground">Dư nợ hiện tại</p>')
    expect(s).not.toMatch(/>Còn lại</)
  })
})
