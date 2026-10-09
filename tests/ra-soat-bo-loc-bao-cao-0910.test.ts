import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { homNayVN, homNayVNKey, lastNDays, rangeFromPreset } from "@/lib/analytics/period"
import { gopNoTheoNcc } from "@/lib/payables/so-no-ncc"
import { khopTimKhach, maKhachBaoCao } from "@/lib/analytics/tim-khach"

/**
 * RÀ BỘ LỌC BÁO CÁO (chủ nhà 09/10/2026: "rà soát lại phần báo cáo xem các bộ lọc có hoạt động không?").
 *
 * Đợt 1 — các lỗi làm bộ lọc ra số sai dù bấm đúng:
 *  1. Kỳ "Hôm nay / Tháng này / Năm nay" lấy ngày theo ĐỒNG HỒ MÁY. Máy đặt múi giờ khác (máy chủ, máy chạy thử: UTC)
 *     thì từ 00:00 tới 06:59 giờ VN "Hôm nay" là hôm qua, sáng mùng 1 "Tháng này" là tháng trước. Lãi lỗ / Dòng tiền /
 *     Cân đối còn lấy `toISOString().slice(0, 10)` — ngày UTC: "Tháng này" bắt đầu từ ngày cuối tháng trước.
 *  2. Báo cáo NCC, tab Công nợ: bỏ mọi dòng ≤ 0 → phiếu trả NCC (dòng âm) không trừ, nợ NCC CAO hơn sổ. Tab Nhập hàng
 *     cộng cả phiếu nhập Nháp (chưa nhập kho, chưa ghi nợ).
 *  3. Tuổi nợ (Phân tích công nợ, Công nợ NCC): `Math.ceil` trên ngày UTC → từ 07:00 sáng mọi khoản dư 1 ngày.
 *  4. Báo cáo khách hàng: ô tìm khớp cả UUID của khách — gõ "ba" ra ~13% số khách không liên quan.
 */

const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8")
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

afterEach(() => vi.useRealTimers())
function ghimLuc(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe("kỳ báo cáo theo LỊCH VIỆT NAM, không theo đồng hồ máy", () => {
  it("homNayVNKey: 20:00 UTC ngày 19 là 03:00 sáng ngày 20 ở VN", () => {
    expect(homNayVNKey(new Date("2026-08-19T20:00:00Z"))).toBe("2026-08-20")
    expect(homNayVNKey(new Date("2026-08-20T16:59:59Z"))).toBe("2026-08-20") // 23:59:59 VN
    expect(homNayVNKey(new Date("2026-08-20T17:00:00Z"))).toBe("2026-08-21") // 00:00 VN
    // Mốc 12:00 trưa giờ máy — cộng / trừ ngày không bị đổi giờ mùa hè kéo lệch.
    expect(homNayVN(new Date("2026-08-19T20:00:00Z")).getHours()).toBe(12)
  })

  it("Hôm nay / Hôm qua lúc 03:00 sáng giờ VN", () => {
    ghimLuc("2026-08-19T20:00:00Z")
    expect(rangeFromPreset("today")).toEqual({ from: "2026-08-20", to: "2026-08-20" })
    expect(rangeFromPreset("yesterday")).toEqual({ from: "2026-08-19", to: "2026-08-19" })
  })

  it("sáng mùng 1 (giờ VN): Tháng này là tháng MỚI, không phải tháng trước", () => {
    ghimLuc("2026-08-31T18:00:00Z") // 01:00 sáng 01/09 giờ VN
    expect(rangeFromPreset("this_month")).toEqual({ from: "2026-09-01", to: "2026-09-01" })
    expect(rangeFromPreset("last_month")).toEqual({ from: "2026-08-01", to: "2026-08-31" })
  })

  it("sáng 01/01 (giờ VN): Năm nay là năm mới; Quý này là quý I", () => {
    ghimLuc("2026-12-31T17:30:00Z") // 00:30 sáng 01/01/2027 giờ VN
    expect(rangeFromPreset("this_year")).toEqual({ from: "2027-01-01", to: "2027-01-01" })
    expect(rangeFromPreset("this_quarter").from).toBe("2027-01-01")
  })

  it("lastNDays mặc định tính tới HÔM NAY theo lịch VN (Bán chậm 90 ngày)", () => {
    ghimLuc("2026-08-19T20:00:00Z")
    expect(lastNDays(90).to).toBe("2026-08-20")
  })

  it("Lãi lỗ / Dòng tiền / Cân đối / Tài chính không còn lấy ngày UTC hay đồng hồ máy làm mặc định", () => {
    const trang = [
      "src/app/(dashboard)/reports/finance/pnl/page.tsx",
      "src/app/(dashboard)/reports/finance/cash-flow/page.tsx",
      "src/app/(dashboard)/reports/finance/balance-sheet/page.tsx",
      "src/app/(dashboard)/reports/finance/page.tsx",
    ]
    for (const p of trang) {
      const code = boChuThich(doc(p))
      expect(code, p).not.toMatch(/\.toISOString\(\)\.slice\(0,\s*10\)/)
      expect(code, p).not.toMatch(/new Date\(\)\.get(FullYear|Month|Date)\(\)/)
    }
    const pnl = boChuThich(doc(trang[0]))
    expect(pnl).toContain('rangeFromPreset("this_month")')
    expect(pnl).toContain('rangeFromPreset("this_year")')
    const cf = boChuThich(doc(trang[1]))
    expect(cf).toContain('rangeFromPreset("this_month")')
    expect(cf).toContain('rangeFromPreset("this_year")')
    expect(boChuThich(doc(trang[2]))).toContain("setAsOf(homNayVNKey())")
  })
})

describe("Báo cáo NCC — tab Công nợ: dòng âm TRỪ vào nợ (gopNoTheoNcc)", () => {
  const ncc = (id: string, amount: number, paid: number, status = "open", due: string | null = null) => ({
    supplier_id: id, amount, paid, status, due_date: due,
  })

  it("phiếu trả NCC (dòng âm) trừ vào nợ; dòng đã xong bỏ qua; số phiếu chỉ đếm dòng còn phải trả", () => {
    const m = gopNoTheoNcc([
      ncc("A", 5_000_000, 1_000_000), // còn 4.000.000
      ncc("A", -1_500_000, 0), // phiếu trả NCC
      ncc("A", 2_000_000, 2_000_000, "paid"), // đã xong
      ncc("B", 1_000_000, 1_200_000), // trả dư 200.000 → NCC nợ lại mình
      ncc("C", 300_000, 299_999.996, "paid"), // đã xong (lệch lẻ < 0,01 — trigger coi là xong) — không hiện
      ncc("D", 300_000, 300_000), // còn 0 — không hiện
    ])
    expect(m.get("A")).toMatchObject({ conNo: 2_500_000, soPhieu: 1 })
    expect(m.get("B")).toMatchObject({ conNo: -200_000, soPhieu: 0 })
    expect(m.has("C")).toBe(false)
    expect(m.has("D")).toBe(false)
  })

  it("lọc NCC / ô tìm áp TRƯỚC khi cộng", () => {
    const m = gopNoTheoNcc([ncc("A", 100, 0), ncc("B", 200, 0)], (id) => id === "B")
    expect(Array.from(m.keys())).toEqual(["B"])
  })

  it("quá hạn tính theo lịch VN, chỉ trên dòng còn phải trả", () => {
    ghimLuc("2026-08-20T03:00:00Z") // 10:00 sáng 20/08 giờ VN — bản cũ (`Math.ceil` trên ngày UTC) dư 1 ngày từ 07:00
    const m = gopNoTheoNcc([
      ncc("A", 100, 0, "open", "2026-08-10"), // quá 10 ngày (bản cũ: 11)
      ncc("A", -50, 0, "open", "2026-06-01"), // dòng âm: không phải khoản quá hạn
      ncc("B", 100, 0, "open", "2026-08-20"), // hạn hôm nay → chưa quá hạn (bản cũ: quá 1 ngày)
    ])
    expect(m.get("A")?.quaHan).toBe(10)
    expect(m.get("B")?.quaHan).toBe(0)
  })

  it("trang báo cáo NCC dùng gopNoTheoNcc và chỉ cộng phiếu nhập ĐÃ HOÀN THÀNH", () => {
    const code = boChuThich(doc("src/app/(dashboard)/reports/suppliers/page.tsx"))
    expect(code).toContain("gopNoTheoNcc(payables,")
    expect(code).not.toMatch(/outstanding\s*<=\s*0/)
    const i = code.indexOf('.from("purchase_invoices")')
    expect(i).toBeGreaterThan(0)
    const truyVan = code.slice(i, code.indexOf(".range(from, to)", i))
    expect(truyVan).toContain('.eq("status", "completed")')
    expect(truyVan).not.toContain('.neq("status", "cancelled")')
  })
})

describe("Phân tích công nợ — tuổi nợ theo lịch VN", () => {
  it("dùng daysOverdueOf, không Math.ceil trên ngày UTC", () => {
    const code = boChuThich(doc("src/app/(dashboard)/analytics/performance/receivables/page.tsx"))
    expect(code).toContain("daysOverdueOf(r.due_date)")
    expect(code).not.toMatch(/Math\.ceil\(\(now - due\)/)
  })
})

describe("Báo cáo khách hàng — ô tìm khớp mã ĐANG HIỆN, không khớp cả UUID", () => {
  const khach = { id: "3fa2b9c1-0000-4000-8000-0000000000ba", phone: "0912345678", store_name: "Tạp hoá Hoa" }

  it("chữ nằm trong UUID nhưng không ở tên / SĐT / mã hiện → không khớp", () => {
    expect(khopTimKhach("ba", khach)).toBe(false)
    expect(khopTimKhach("8000", khach)).toBe(false)
  })

  it("khớp tên, SĐT, mã KH đang hiện", () => {
    expect(maKhachBaoCao(khach.id)).toBe("KH3fa2b9")
    expect(khopTimKhach("hoa", khach)).toBe(true)
    expect(khopTimKhach("0912", khach)).toBe(true)
    expect(khopTimKhach("KH3fa2", khach)).toBe(true)
    expect(khopTimKhach("", khach)).toBe(true)
  })

  it("trang báo cáo khách dùng khopTimKhach và hiện đúng mã ấy", () => {
    const code = boChuThich(doc("src/app/(dashboard)/reports/customers/page.tsx"))
    expect(code).toContain("{maKhachBaoCao(r.id)}")
    // Thân `matchSearch`: id chỉ dùng để so với lọc Khách hàng, phần tìm chữ đi hết qua khopTimKhach.
    const i = code.indexOf("const matchSearch = useCallback(")
    expect(i).toBeGreaterThan(0)
    const than = code.slice(i, code.indexOf("[search, customerFilter]", i))
    expect(than).toMatch(/return khopTimKhach\(search, c\)\s*\}/)
    expect(than.replace("customerFilter.includes(c.id)", "")).not.toContain("c.id")
  })
})
