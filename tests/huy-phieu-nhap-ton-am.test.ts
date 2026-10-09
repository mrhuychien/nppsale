import { describe, it, expect } from "vitest"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"

/**
 * HUỶ PHIẾU NHẬP ĐÃ XUẤT BỚT KHI CHO PHÉP TỒN KHO ÂM (mig 238).
 *
 * ⚠ CHỦ NHÀ 08/10/2026: "Hiện tại ko huỷ được phiếu nhập khi đã xuất kho 1 lượng. Trường hợp cho phép tồn kho âm,
 *   hành động huỷ phiếu nhập được cho phép."
 * ⚠ LÔ TRỪ ĐÚNG SỐ ĐÃ NHẬP (`còn − nhập`), KHÔNG VỀ 0: về 0 thì huỷ phiếu xuất về sau cộng trả vào lô của phiếu đã
 *   huỷ → tồn ảo (đã thử phá trên Postgres: lô 30, thẻ kho 0). Bộ thử chạy thật: scripts/sql/thu-238-…sql (9/9).
 */
describe("cancel_purchase_invoice (bản đang chạy)", () => {
  const h = hamDangChay().get("public.cancel_purchase_invoice(UUID,TEXT)")

  // Mig 242 chép nguyên bản 238 và thêm một khối (phần phiếu chi trả NCC tự trừ vào phiếu → trả về "trả trước") —
  // các luật bên dưới vẫn phải còn nguyên.
  it("là bản mig 242 (= 238 + trả phần phiếu chi về trả trước)", () => {
    expect(h?.file).toBe("242_phieu_chi_tra_ncc.sql")
  })

  it("chỉ chặn HANG_DA_XUAT khi NPP chưa cho phép tồn âm; câu báo chỉ cách gỡ", () => {
    expect(h!.than).toContain("SELECT COALESCE(allow_oversell, false) INTO v_cho_am FROM organizations WHERE id = v_org;")
    expect(h!.than).toContain("IF v_bad IS NOT NULL AND NOT COALESCE(v_cho_am, false) THEN")
    expect(h!.than).toContain('bật "Cho phép bán vượt tồn kho"')
  })

  it("lô trừ đúng số đã nhập — không ép về 0", () => {
    expect(h!.than).toContain("SET qty_on_hand = b.qty_on_hand - b.qty_initial,")
    expect(h!.than).not.toMatch(/SET qty_on_hand = 0\b/)
  })

  it("giữ nguyên cổng vai (mig 166) và chặn đã trả tiền NCC", () => {
    expect(h!.than).toContain("NOT IN ('owner', 'manager', 'accountant', 'warehouse')")
    expect(h!.than).toContain("RAISE EXCEPTION 'DA_TRA_TIEN:")
    expect(h!.than.indexOf("DA_TRA_TIEN")).toBeLessThan(h!.than.indexOf("v_cho_am FROM organizations"))
  })
})
