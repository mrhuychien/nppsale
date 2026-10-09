import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import { khoiPhucPhieuNcc, loiKhoiPhuc, thongBaoKhoiPhuc } from "@/lib/purchasing/khoi-phuc"

/**
 * KHÔI PHỤC PHIẾU NHẬP HÀNG / PHIẾU TRẢ NCC ĐÃ HUỶ (mig 241).
 *
 * ⚠ CHỦ NHÀ 09/10/2026: "Phiếu nhập hàng, phiếu trả NCC hủy xong phải có đường khôi phục".
 * ⚠ Phiếu về ĐÚNG trạng thái trước khi huỷ. Phiếu nhập đã hoàn thành: cộng lại `qty_initial` vào CHÍNH các lô cũ (lô âm
 *   vì đã bán về lại đúng số còn) — KHÔNG gọi lại `complete_purchase_invoice` (lô mới + lô âm treo vĩnh viễn). Phiếu trả
 *   đã gửi: gửi lại bằng `complete_supplier_return`, kho thiếu → dừng ở Nháp kèm lý do.
 *   Bộ thử chạy thật: scripts/sql/thu-241-khoi-phuc-phieu-ncc.sql (18/18 dưới safeupdate; thử phá 17 chỗ — đỏ cả 17).
 */
const GOC = resolve(__dirname, "..")
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf-8")
const HAM = hamDangChay()

describe("khoi_phuc_phieu_nhap (bản đang chạy)", () => {
  const h = HAM.get("public.khoi_phuc_phieu_nhap(UUID)")

  it("là bản mig 241, chặn NPP + vai như hàm huỷ, bấm hai lần thì đứng yên", () => {
    expect(h?.file).toBe("241_khoi_phuc_phieu_ncc.sql")
    expect(h!.than).toContain("IF v_inv.org_id IS DISTINCT FROM public.user_org_id() THEN")
    expect(h!.than).toContain("NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN")
    expect(h!.than).toMatch(/IF v_inv\.status IS DISTINCT FROM 'cancelled' THEN\s+RETURN jsonb_build_object\([^)]*'da_khoi_phuc', false/)
    expect(h!.than).toContain("FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;")
  })

  it("đảo đúng cancel_purchase_invoice: cộng lại số đã nhập vào chính lô cũ, mở lô, phiếu kho ghi sổ lại — không lập lô mới", () => {
    expect(h!.than).toMatch(/UPDATE batches\s+SET qty_on_hand = qty_on_hand \+ qty_initial,\s+status = 'available'\s+WHERE id IN \(SELECT sel\.batch_id FROM stock_entry_lines sel/)
    expect(h!.than).toContain("UPDATE stock_entries SET status = 'posted' WHERE id = v_inv.stock_entry_id;")
    expect(h!.than).not.toContain("complete_purchase_invoice(")
    expect(h!.than).not.toMatch(/INSERT INTO batches/)
  })

  it("ghi lại công nợ NCC = tổng phiếu, chưa trả, ngày ghi nợ = lúc hoàn thành gốc", () => {
    expect(h!.than).toContain("GREATEST(0, COALESCE(v_inv.total, 0)), 0, 'open',")
    expect(h!.than).toContain("COALESCE(v_inv.completed_at, now()))")
    expect(h!.than).toMatch(/SET status = 'completed', payable_id = v_payable,\s+cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL/)
  })

  it("phiếu kho còn ghi sổ → PHIEU_KHO_LECH; phiếu kho của lần trước (dòng ≠ lô — luồng sửa cũ) → về Phiếu tạm", () => {
    expect(h!.than).toContain("RAISE EXCEPTION 'PHIEU_KHO_LECH:")
    expect(h!.than).toContain("SUM(COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor, 1))")
    expect(h!.than).toContain("SUM(b.qty_initial)")
    expect(h!.than).toMatch(/IF NOT v_khop THEN\s+UPDATE purchase_invoices\s+SET status = 'draft'/)
  })
})

describe("khoi_phuc_phieu_tra_ncc (bản đang chạy)", () => {
  const h = HAM.get("public.khoi_phuc_phieu_tra_ncc(UUID)")

  it("là bản mig 241, chặn NPP + vai, bấm hai lần đứng yên", () => {
    expect(h?.file).toBe("241_khoi_phuc_phieu_ncc.sql")
    expect(h!.than).toContain("IF v_ret.org_id IS DISTINCT FROM public.user_org_id() THEN")
    expect(h!.than).toContain("NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN")
    expect(h!.than).toMatch(/IF v_ret\.status IS DISTINCT FROM 'cancelled' THEN\s+RETURN/)
  })

  it("đã gửi → về Nháp rồi gửi lại bằng complete_supplier_return; lỗi nghiệp vụ (kho thiếu) chỉ lùi phần gửi lại, trả lý do", () => {
    expect(h!.than).toContain("UPDATE supplier_returns SET status = 'draft', cancel_reason = NULL WHERE id = p_return_id;")
    expect(h!.than).toMatch(/BEGIN\s+PERFORM public\.complete_supplier_return\(p_return_id\);\s+EXCEPTION WHEN raise_exception THEN\s+v_ly_do := SQLERRM;/)
    expect(h!.than).toContain("'ly_do', v_ly_do")
    expect(h!.than.indexOf("UPDATE supplier_returns SET status = 'draft'")).toBeLessThan(h!.than.indexOf("complete_supplier_return("))
  })

  it("phiếu kho còn ghi sổ → PHIEU_KHO_LECH; đối chiếu dòng ↔ phiếu xuất (kể cả dòng xuất vượt tồn không lô)", () => {
    expect(h!.than).toContain("RAISE EXCEPTION 'PHIEU_KHO_LECH:")
    expect(h!.than).toContain("SUM(COALESCE(sel.qty_in_base_uom, sel.quantity, 0))")
    expect(h!.than).toMatch(/IF NOT v_khop THEN\s+RETURN jsonb_build_object\('id', p_return_id, 'trang_thai', 'draft'/)
  })

  it("quyền gọi: authenticated, không anon / PUBLIC", () => {
    const mig = doc("supabase/migrations/241_khoi_phuc_phieu_ncc.sql")
    for (const f of ["khoi_phuc_phieu_nhap(uuid)", "khoi_phuc_phieu_tra_ncc(uuid)"]) {
      expect(mig).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`)
      expect(mig).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`)
    }
  })
})

describe("lib khoi-phuc: gọi đúng RPC, báo đúng trạng thái VỀ ĐƯỢC", () => {
  it("khoiPhucPhieuNcc gọi đúng hàm + tham số; lỗi máy chủ cắt mã, dịch lỗi kho", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "x", trang_thai: "completed", da_khoi_phuc: true }, error: null })
    await khoiPhucPhieuNcc({ rpc } as never, "nhap", "pi1")
    await khoiPhucPhieuNcc({ rpc } as never, "tra", "sr1")
    expect(rpc.mock.calls).toEqual([["khoi_phuc_phieu_nhap", { p_invoice_id: "pi1" }], ["khoi_phuc_phieu_tra_ncc", { p_return_id: "sr1" }]])
    const loi = vi.fn().mockResolvedValue({ data: null, error: { message: "FORBIDDEN: vai trò của bạn không được khôi phục phiếu nhập." } })
    await expect(khoiPhucPhieuNcc({ rpc: loi } as never, "nhap", "pi1")).rejects.toThrow(/^vai trò của bạn không được khôi phục phiếu nhập\.$/)
    expect(loiKhoiPhuc("INSUFFICIENT_STOCK | Sữa (hộp): cần 6, kho hàng bán còn 2")).toContain("Không đủ tồn để xuất — Sữa (hộp): cần 6")
  })

  it("thongBaoKhoiPhuc theo trạng thái máy chủ trả về", () => {
    expect(thongBaoKhoiPhuc("nhap", { id: "a", trang_thai: "completed", da_khoi_phuc: true }).title).toBe(
      "Đã khôi phục — phiếu Hoàn thành, kho và công nợ NCC đã ghi lại"
    )
    expect(thongBaoKhoiPhuc("nhap", { id: "a", trang_thai: "draft", da_khoi_phuc: true }).title).toBe("Đã khôi phục về Phiếu tạm")
    expect(thongBaoKhoiPhuc("tra", { id: "a", trang_thai: "completed", da_khoi_phuc: true }).title).toContain("gửi lại")
    const thieu = thongBaoKhoiPhuc("tra", { id: "a", trang_thai: "draft", da_khoi_phuc: true, ly_do: "INSUFFICIENT_STOCK | Sữa (hộp): cần 6" })
    expect(thieu.title).toBe("Đã khôi phục về Nháp — chưa gửi lại được")
    expect(thieu.description).toContain("Không đủ tồn để xuất — Sữa (hộp): cần 6")
    expect(thongBaoKhoiPhuc("tra", { id: "a", trang_thai: "draft", da_khoi_phuc: true }).title).toBe("Đã khôi phục về Nháp")
    expect(thongBaoKhoiPhuc("nhap", { id: "a", trang_thai: "completed", da_khoi_phuc: false }).title).toContain("không còn ở trạng thái Đã huỷ")
  })
})

describe("màn hình: nút Khôi phục chỉ ở phiếu Đã huỷ, chỉ vai ghi mua hàng, qua hộp hỏi lại", () => {
  it("chi tiết phiếu nhập", () => {
    const s = doc("src/app/(dashboard)/purchasing/receipts/[id]/page.tsx")
    expect(s).toContain('{ghiDuoc && head.status === "cancelled" && (')
    expect(s).toContain('toast(thongBaoKhoiPhuc("nhap", await khoiPhucPhieuNcc(supabase, "nhap", id)))')
    expect(s).toMatch(/title="Khôi phục phiếu nhập hàng\?"[\s\S]*?onConfirm=\{khoiPhuc\}/)
  })
  it("chi tiết phiếu trả NCC", () => {
    const s = doc("src/app/(dashboard)/purchase-returns/[id]/page.tsx")
    expect(s).toContain('{ghiDuoc && data.status === "cancelled" && (')
    expect(s).toContain('toast(thongBaoKhoiPhuc("tra", await khoiPhucPhieuNcc(supabase, "tra", data.id)))')
    expect(s).toMatch(/title="Khôi phục phiếu trả NCC\?"[\s\S]*?onConfirm=\{handleRestore\}/)
  })
  it("màn sửa / POS gặp phiếu đã huỷ thì chỉ đường khôi phục", () => {
    expect(doc("src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx")).toContain("bấm Khôi phục ở màn chi tiết trước")
    expect(doc("src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx")).toContain("bấm Khôi phục ở màn chi tiết trước")
    expect(doc("src/lib/pos/save.ts").match(/Khôi phục phiếu ở màn chi tiết trước, hoặc lập phiếu mới\./g)?.length).toBe(2)
  })
})
