import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import { fetchBalanceSheet } from "@/lib/finance"

/**
 * BẢNG CÂN ĐỐI: DÒNG "TRẢ TRƯỚC CHO NCC" (mig 243).
 *
 * ⚠ CHỦ NHÀ 11/10/2026: "thêm dòng trả trước cho NCC vào".
 * ⚠ Công nợ NCC RÒNG THEO TỪNG NCC (như TT200: dư Nợ TK 331 theo từng người bán → trả trước cho người bán): ròng dương
 *   → Phải trả NCC, ròng âm → Trả trước cho NCC (tài sản). Bản cũ kẹp GREATEST(0, amount − paid) TỪNG DÒNG → tiền trả
 *   dư / hàng trả vượt nợ biến mất, vốn chủ hụt đúng bằng số ấy.
 *   Bộ thử chạy thật: scripts/sql/thu-243-can-doi-tra-truoc-ncc.sql (8/8 dưới safeupdate; thử phá 7 chỗ — đỏ cả 7).
 */
const GOC = resolve(__dirname, "..")
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf-8")
const MIG = doc("supabase/migrations/243_can_doi_tra_truoc_ncc.sql")

describe("finance_balance_sheet (bản đang chạy)", () => {
  const h = hamDangChay().get("public.finance_balance_sheet(DATE)")

  it("là bản mig 243, trả thêm cột supplier_prepayments", () => {
    expect(h?.file).toBe("243_can_doi_tra_truoc_ncc.sql")
    expect(h!.dau).toMatch(/unpaid_expenses numeric,\s+supplier_prepayments numeric\)/)
  })

  it("công nợ NCC ròng THEO TỪNG NCC, chỉ dòng chưa 'paid'; ròng dương → phải trả, ròng âm → trả trước", () => {
    expect(h!.than).toMatch(/SELECT supplier_id, SUM\(COALESCE\(amount, 0\) - COALESCE\(paid, 0\)\) AS rong\s+FROM payables\s+WHERE org_id = public\.user_org_id\(\) AND status <> 'paid'\s+GROUP BY supplier_id/)
    expect(h!.than).toContain("SELECT COALESCE(SUM(GREATEST(rong, 0)), 0)  AS phai_tra")
    expect(h!.than).toContain("COALESCE(SUM(GREATEST(-rong, 0)), 0) AS tra_truoc")
    expect(h!.than).toMatch(/ap\.phai_tra,\s+exp\.unpaid,\s+ap\.tra_truoc\s+FROM/)
    // Không còn kẹp từng dòng.
    expect(h!.than).not.toContain("GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))")
  })

  it("giữ nguyên phần cũ: mốc ngày giờ VN, cấn trừ không phải tiền, phải thu không kẹp dòng âm", () => {
    expect(h!.than).toContain("SELECT ((p_as_of + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS den")
    expect(h!.than).toContain("AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')")
    expect(h!.than).toMatch(/ar AS \([\s\S]*?SELECT COALESCE\(SUM\(COALESCE\(amount, 0\) - COALESCE\(paid, 0\)\), 0\) AS v\s+FROM receivables/)
    expect(h!.than).toContain("cash_in.v - paid_payables.v - exp.paid,")
  })

  it("đổi kiểu trả về → DROP rồi CREATE, cấp lại quyền (bài học mig 121), chặn anon; đúng khuôn migration", () => {
    expect(MIG).toContain("DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);")
    expect(MIG.indexOf("DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);")).toBeLessThan(MIG.indexOf("CREATE FUNCTION public.finance_balance_sheet(p_as_of date)"))
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public.finance_balance_sheet(date) FROM PUBLIC, anon;")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date) TO authenticated;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG).toContain("chủ nhà 11/10/2026: \"thêm dòng trả trước cho NCC vào\"")
  })
})

describe("fetchBalanceSheet", () => {
  const sb = (data: Record<string, number>) => ({ rpc: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) as never

  it("trả trước cho NCC cộng vào TỔNG TÀI SẢN; vốn chủ = tài sản − nợ phải trả", async () => {
    const bs = await fetchBalanceSheet(
      sb({ cash: 600, accounts_receivable: 0, inventory: 350, accounts_payable: 0, unpaid_expenses: 0, supplier_prepayments: 50 }),
      "o1", "2026-10-11"
    )
    expect(bs.assets.supplierPrepayments).toBe(50)
    expect(bs.assets.total).toBe(1000)
    expect(bs.equity.total).toBe(1000)
    expect(bs.liabilities.total + bs.equity.total).toBe(bs.assets.total)
  })

  it("sổ chưa chạy 243 (không có cột) → trả trước 0, số cũ giữ nguyên", async () => {
    const bs = await fetchBalanceSheet(sb({ cash: 10, accounts_receivable: 20, inventory: 30, accounts_payable: 5, unpaid_expenses: 5 }), "o1", "2026-10-11")
    expect(bs.assets.supplierPrepayments).toBe(0)
    expect(bs.assets.total).toBe(60)
    expect(bs.equity.total).toBe(50)
  })
})

describe("màn hình: dòng 'Trả trước cho NCC' bên tài sản", () => {
  it("Bảng cân đối (báo cáo cũ): dòng ngay sau Hàng tồn kho, có ghi chú cách tính", () => {
    const s = doc("src/app/(dashboard)/reports/finance/balance-sheet/page.tsx")
    expect(s).toMatch(/data-testid="bs-tra-truoc-ncc">\s+<span className="pl-5">Trả trước cho NCC<\/span>\s+<span>\{formatCurrency\(data\.assets\.supplierPrepayments\)\}<\/span>/)
    expect(s.indexOf("Hàng tồn kho")).toBeLessThan(s.indexOf("Trả trước cho NCC</span>"))
    expect(s).toContain("Công nợ NCC tính ròng theo từng NCC")
  })

  it("Báo cáo tổng hợp › Tài sản – Nguồn vốn: tổng tài sản gồm trả trước; dòng bấm mở Công nợ theo NCC", () => {
    const s = doc("src/components/bao-cao/man-tai-chinh.tsx")
    expect(s).toContain("const ts = bs.assets.cash + d.phaiThu + bs.assets.inventory + bs.assets.supplierPrepayments")
    expect(s).toContain('{ _n: "Trả trước cho NCC", _indent: true, nay: bs.assets.supplierPrepayments, truoc: null, chieu: 1, bam: congNoNcc },')
    expect(s).toContain('const congNoNcc = () => router.push("/payables/by-supplier")')
  })
})
