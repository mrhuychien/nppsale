/**
 * Chủ nhà 28/09/2026: "khi sửa hoá đơn có phiếu nhập kho đã hoàn thành -> hệ thống sẽ hỏi
 * 'Cần huỷ phiếu nhập trước?' y/n -> yes -> huỷ phiếu nhập … khi cập nhật -> cập nhật lại hết"
 * · "No -> giữ nguyên phiếu nhập gắn vào hoá đơn mới." (mig 210)
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { laDaNhapTuSinh, phieuDaNhapCuaHoaDon, traSuaDuoc } from "@/lib/returns/tra-da-nhap"
import { explainInvoiceError } from "@/lib/orders/post-invoice"

const HD = "hd-1"
const phieu = (o: Partial<{ status: string; invoice_id: string | null; credit_with_invoice: boolean }>) => ({
  id: "r", status: "completed", invoice_id: HD, credit_with_invoice: true, ...o,
})

describe("phiếu trả đã nhập kho khi sửa hoá đơn", () => {
  it("chỉ hỏi cho phiếu TỰ SINH đã hoàn thành của đúng tờ đang sửa", () => {
    expect(laDaNhapTuSinh(phieu({}), HD)).toBe(true)
    expect(laDaNhapTuSinh(phieu({ credit_with_invoice: false }), HD), "phiếu tự lập").toBe(false)
    expect(laDaNhapTuSinh(phieu({ status: "submitted" }), HD)).toBe(false)
    expect(laDaNhapTuSinh(phieu({ invoice_id: "hd-khac" }), HD)).toBe(false)
    expect(laDaNhapTuSinh(phieu({}), null), "xuất hàng lần đầu").toBe(false)
    expect(phieuDaNhapCuaHoaDon([phieu({}), phieu({ status: "draft" })], HD)).toHaveLength(1)
  })
  it("dòng của phiếu đã nhập kho chỉ sửa được khi chọn Có", () => {
    expect(traSuaDuoc(phieu({}), HD, null)).toBe(false)
    expect(traSuaDuoc(phieu({}), HD, "giu")).toBe(false)
    expect(traSuaDuoc(phieu({}), HD, "lam_lai")).toBe(true)
    expect(traSuaDuoc(phieu({ credit_with_invoice: false }), HD, "lam_lai"), "phiếu tự lập sửa ở phiếu").toBe(false)
    // Luật cũ còn nguyên: phiếu chờ của tờ này sửa được; xuất lần đầu là phiếu chưa bám tờ nào.
    expect(traSuaDuoc(phieu({ status: "submitted" }), HD, null)).toBe(true)
    expect(traSuaDuoc(phieu({ status: "draft", invoice_id: null }), null, null)).toBe(true)
  })
  it("lỗi máy chủ khi màn hình chưa hỏi được nói ra thành câu", () => {
    expect(explainInvoiceError("REISSUE_RETURN_STOCKED: phiếu trả TH-1 đã nhập kho — chọn huỷ phiếu nhập hay giữ nguyên"))
      .toBe("phiếu trả TH-1 đã nhập kho — chọn huỷ phiếu nhập hay giữ nguyên")
  })
})

describe("mig 210 + màn hình", () => {
  const mig = readFileSync("supabase/migrations/210_sua_hoa_don_co_phieu_tra_da_nhap.sql", "utf8")
  it("Có = cancel_return rồi complete_return vào đúng kho cũ; Không = gỡ rồi gắn tờ mới; chưa chọn = hỏi", () => {
    expect(mig).toMatch(/PERFORM public\.cancel_return\(r\.id,/)
    expect(mig).toMatch(/PERFORM public\.complete_return\(x\.id, x\.zone\)/)
    expect(mig).toMatch(/UPDATE returns SET invoice_id = p_new_invoice_id WHERE id = x\.id/)
    expect(mig).toContain("REISSUE_RETURN_STOCKED")
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\._tra_da_nhap_truoc_lap_lai\(uuid, jsonb\) FROM PUBLIC, anon, authenticated/)
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\._tra_da_nhap_sau_lap_lai\(uuid\) FROM PUBLIC, anon, authenticated/)
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 210")
  })
  it("mig 216: chọn Có thì phiếu về Chờ xử lý — bước sau lập lại KHÔNG nhập kho lại", () => {
    const m216 = readFileSync("supabase/migrations/216_sua_hd_phieu_tra_ve_cho_xu_ly.sql", "utf8")
    const than = m216.slice(m216.indexOf("CREATE OR REPLACE FUNCTION public._tra_da_nhap_sau_lap_lai"), m216.indexOf("$fn$;"))
    expect(than).not.toContain("complete_return")
    expect(than).toContain("UPDATE returns SET invoice_id = p_new_invoice_id WHERE id = x.id")
    expect(readFileSync("src/components/returns/hoi-tra-da-nhap.tsx", "utf8")).toContain("Chờ xử lý")
  })
  it("POS và màn điện thoại đều hỏi trước khi lập lại và gửi lựa chọn", () => {
    for (const f of ["src/components/pos/invoice-screen.tsx", "src/components/orders/invoice-editor.tsx"]) {
      const s = readFileSync(f, "utf8")
      expect(s, f).toContain("<HoiTraDaNhap")
      expect(s, f).toMatch(/phieuDaNhap\.length > 0 && !cheDoTra\) \{ setHoiTra\(true\); return \}/)
      expect(s, f).toMatch(/traDaNhap: phieuDaNhap\.length > 0 \? cheDoTra : null/)
    }
    expect(readFileSync("src/lib/orders/post-invoice.ts", "utf8")).toMatch(/tra_da_nhap: payload\.traDaNhap/)
  })
})
