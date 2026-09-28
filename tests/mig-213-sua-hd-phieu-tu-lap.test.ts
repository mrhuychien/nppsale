/** Quét luồng 28/09/2026 — nhóm sai tiền 4–5 (mig 213). */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { giamGiaDonPayload } from "@/lib/orders/post-invoice"
import { hanhDongPhieuTra } from "@/lib/returns/loai-phieu"

const m = readFileSync("supabase/migrations/213_sua_hd_giu_ngay_giam_gia_phieu_tu_lap.sql", "utf8")

describe("4. sửa hoá đơn giữ ngày / điều khoản / giảm giá của tờ cũ", () => {
  it("máy chủ điền khi tải trọng không có khoá", () => {
    expect(m).toMatch(/IF NULLIF\(v_out->>'invoice_date', ''\) IS NULL AND v_old\.invoice_date IS NOT NULL/)
    expect(m).toMatch(/IF NOT \(v_out \? 'discount'\) THEN/)
    expect(m).toContain("p := public._mac_dinh_lap_lai(p_invoice_id, p);")
  })
  it("màn biết giảm giá gửi số kể cả 0; không biết thì không gửi", () => {
    expect(giamGiaDonPayload(0)).toEqual({ discount: 0 })
    expect(giamGiaDonPayload(50000.4)).toEqual({ discount: 50000 })
    expect(giamGiaDonPayload(-5)).toEqual({ discount: 0 })
    expect(giamGiaDonPayload(undefined)).toEqual({})
  })
  it("POS mặc định ngày tờ gốc", () => {
    expect(readFileSync("src/components/pos/invoice-screen.tsx", "utf8")).toContain("if (hd.invoice_date) setNgay(hd.invoice_date)")
  })
})

describe("5. phiếu trả tự lập không bị biến thành tự sinh; nháp rỗng huỷ được", () => {
  it("câu gắn của post_invoice bỏ qua phiếu tự lập đang lập lại; huỷ HĐ thì huỷ phiếu tự lập", () => {
    expect(m).toContain("AND ret.id <> ALL (COALESCE(NULLIF(current_setting(''npp.giu_phieu_tu_lap''")
    expect(m).toContain("AND (order_id IS NULL OR NOT credit_with_invoice)")
  })
  it("nháp rỗng: nút huỷ", () => {
    expect(hanhDongPhieuTra({ status: "draft", credit_with_invoice: true }, 0).huy).toBe("huy")
    expect(hanhDongPhieuTra({ status: "draft", credit_with_invoice: true }, 1).huy).toBe(false)
    expect(hanhDongPhieuTra({ status: "draft", credit_with_invoice: true }).huy).toBe(false)
    expect(m).toMatch(/IF r\.status = ''draft'' AND NOT EXISTS \(SELECT 1 FROM return_lines/)
  })
})
