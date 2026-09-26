import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  khoangKy, ngayDauCanDoc, mucTieuKy, doanhSoKy, theoKhach, theoKenh, tienGon, loiNhacMucTieu,
  nhanNgay, nhanTuyen, ngayTuyen, traCuaToi,
} from "@/lib/home/sales-home"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Làm lại trang chủ cho nhân viên bán hàng theo mẫu" — "Doanh số của
 *   tôi 60.299.000đ · 75% mục tiêu 80 tr · Còn 4 ngày · cần thêm 19,7 tr, khoảng 4,9 tr/ngày."
 *   Doanh số = HÓA ĐƠN đã ghi sổ − hàng trả (luật 24–25/09/2026), không phải tổng đơn.
 */
describe("kỳ trên trang chủ NVBH", () => {
  it("tháng / tuần (T2→CN) / quý / hôm nay và số ngày còn lại", () => {
    expect(khoangKy("month", "2026-09-26")).toEqual({ from: "2026-09-01", to: "2026-09-30", conNgay: 4 })
    expect(khoangKy("week", "2026-09-26")).toEqual({ from: "2026-09-21", to: "2026-09-27", conNgay: 1 })
    expect(khoangKy("week", "2026-09-27").from).toBe("2026-09-21") // Chủ nhật vẫn thuộc tuần T2 21/09
    expect(khoangKy("quarter", "2026-09-26")).toEqual({ from: "2026-07-01", to: "2026-09-30", conNgay: 4 })
    expect(khoangKy("today", "2026-09-26")).toEqual({ from: "2026-09-26", to: "2026-09-26", conNgay: 0 })
    expect(ngayDauCanDoc("2026-10-01")).toBe("2026-09-28") // tuần lấn sang quý trước
  })
  it("mục tiêu kỳ suy từ mục tiêu tháng", () => {
    expect(mucTieuKy(80_000_000, "month", "2026-09-26")).toBe(80_000_000)
    expect(mucTieuKy(80_000_000, "quarter", "2026-09-26")).toBe(240_000_000)
    expect(mucTieuKy(90_000_000, "today", "2026-09-26")).toBe(3_000_000)
    expect(mucTieuKy(0, "month", "2026-09-26")).toBe(0)
  })
  it("câu nhắc như mẫu", () => {
    expect(loiNhacMucTieu(60_299_000, 80_000_000, 4)).toBe("Còn 4 ngày · cần thêm 19,7 tr, khoảng 4,9 tr/ngày.")
    expect(loiNhacMucTieu(90, 80, 4)).toBe("Đã đạt mục tiêu kỳ này.")
    expect(loiNhacMucTieu(1, 0, 4)).toBeNull()
    expect(tienGon(80_000_000)).toBe("80 tr")
    expect(tienGon(58_980_000)).toBe("59 tr")
  })
  it("nhãn ngày / tuyến (pjp_routes: 0 = Thứ 2)", () => {
    expect(nhanNgay("2026-09-26")).toBe("Thứ Bảy, 26/09")
    expect(ngayTuyen("2026-09-26")).toBe(5)
    expect(nhanTuyen("2026-09-26")).toBe("T7")
    expect(nhanTuyen("2026-09-27")).toBe("CN")
  })
})

describe("doanh số của tôi = hóa đơn − hàng trả", () => {
  it("phiếu trả tính cho mình: đứng tên mình hoặc chưa ghi người; không tính của người khác", () => {
    const rows = [{ sales_user_id: "me" }, { sales_user_id: null }, { sales_user_id: "khac" }]
    expect(traCuaToi(rows, "me")).toEqual([{ sales_user_id: "me" }, { sales_user_id: null }])
  })
  const hd = [
    { id: "a", customer_id: "k1", invoice_date: "2026-09-26", total: 1_000_000 },
    { id: "b", customer_id: "k2", invoice_date: "2026-09-10", total: 500_000 },
    { id: "c", customer_id: "k1", invoice_date: "2026-08-31", total: 9_000_000 },
  ]
  const tra = [{ customer_id: "k1", revenue_date: "2026-09-26", credit_note_amount: 200_000 }]
  const thang = khoangKy("month", "2026-09-26")
  it("trừ hàng trả theo ngày trừ doanh số; ngoài kỳ không tính", () => {
    expect(doanhSoKy(hd, tra, thang)).toBe(1_300_000)
    expect(doanhSoKy(hd, tra, khoangKy("today", "2026-09-26"))).toBe(800_000)
  })
  it("top khách và theo kênh dùng số thuần", () => {
    expect(theoKhach(hd, tra, thang)).toEqual([{ customerId: "k1", total: 800_000 }, { customerId: "k2", total: 500_000 }])
    expect(theoKenh(theoKhach(hd, tra, thang), (id) => (id === "k1" ? "GT" : null)))
      .toEqual([{ kenh: "GT", total: 800_000 }, { kenh: "Khác", total: 500_000 }])
  })
  it("màn đọc HÓA ĐƠN đã ghi sổ + returns.revenue_date, không cộng tổng đơn làm doanh số", () => {
    const src = readFileSync(resolve(__dirname, "../src/components/home/sales-home.tsx"), "utf-8")
    expect(src).toContain('.from("sales_invoices").select("id, customer_id, invoice_date, total"')
    expect(src).toContain('.eq("status", "posted")')
    expect(src).toContain('.gte("revenue_date", dau)')
    /* ⚠ Chủ nhà 26/09/2026: "doanh thu của nhân viên chưa trừ hàng trả lại" — không lọc người
       ở câu hỏi (phiếu tự sinh cũ chưa ghi người), lọc bằng `traCuaToi`. */
    expect(src).toContain("traCuaToi(traR.rows, userId)")
    expect(src).not.toMatch(/from\("returns"\)[^\n]*\n[^\n]*\.eq\("sales_user_id", userId\)/)
    expect(src).toContain("doanhSoKy(dl.hd, dl.tra, kk)")
    expect(src).toContain('sb.rpc("my_sales_target")')
    expect(readFileSync(resolve(__dirname, "../src/app/(dashboard)/home/page.tsx"), "utf-8")).toContain("<SalesHome")
  })
  it("mig 196: mục tiêu đọc qua hàm trả đúng một số, không mở bảng nhân sự", () => {
    const m = readFileSync(resolve(__dirname, "../supabase/migrations/196_muc_tieu_doanh_so_nvbh.sql"), "utf-8")
    expect(m).toContain("RETURNS numeric")
    expect(m).toContain("WHERE c.org_id = public.user_org_id()")
    expect(m).toContain("REVOKE ALL ON FUNCTION public.my_sales_target() FROM PUBLIC, anon;")
    expect(m).not.toMatch(/GRANT SELECT ON .*hr_salary_config/)
  })
})
