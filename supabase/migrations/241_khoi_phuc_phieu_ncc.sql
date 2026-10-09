-- ====================================================================
-- 241 — KHÔI PHỤC PHIẾU NHẬP HÀNG / PHIẾU TRẢ NCC ĐÃ HUỶ
--
-- VÌ SAO — chủ nhà 09/10/2026: "Phiếu nhập hàng, phiếu trả NCC hủy xong phải có đường khôi phục".
--   Huỷ (`cancel_purchase_invoice` mig 238, `cancel_supplier_return` mig 235) là đường một chiều: màn chi tiết chỉ còn
--   dòng "Phiếu đã huỷ", màn sửa từ chối ("Lập phiếu mới"). Lập phiếu mới là mất mã phiếu, mất dấu vết lấy lô của hàng
--   đã bán (lô cũ nằm âm, đã đóng — mig 238), công nợ NCC phải gõ lại.
--
-- CÁCH LÀM — khôi phục = phiếu VỀ ĐÚNG TRẠNG THÁI TRƯỚC KHI HUỶ:
--   1. `khoi_phuc_phieu_nhap(p_invoice_id)`:
--      · Huỷ lúc còn Phiếu tạm (không có phiếu kho) → về Phiếu tạm.
--      · Huỷ lúc đã Hoàn thành → đảo ĐÚNG `cancel_purchase_invoice`: cộng lại `qty_initial` vào CHÍNH các lô của phiếu
--        (lô âm vì hàng đã bán về lại đúng số còn), mở lại lô, phiếu kho về 'posted' (giữ ngày nhập gốc), ghi lại công
--        nợ NCC (= tổng phiếu, chưa trả, ngày ghi nợ = lúc hoàn thành gốc), phiếu về Hoàn thành. Bảng giá nhập tự cập
--        nhật qua trigger `trg_gia_nhap_tu_phieu` (mig 234 — phiếu cũ hơn giá đang lưu thì không đè).
--        ⚠ KHÔNG gọi lại `complete_purchase_invoice`: nó sinh lô MỚI, còn lô cũ (âm, đã đóng) nằm lại — tồn âm treo
--          vĩnh viễn, dấu vết lấy lô của hàng đã bán trỏ vào lô chết, màn tồn kho (chỉ cộng lô dương) lệch thẻ kho.
--      · ⚠ Luồng sửa CŨ (trước mig 235: huỷ → về tạm → lưu → hoàn thành) có thể để lại Phiếu tạm còn trỏ vào phiếu kho
--        đã huỷ của lần trước; phiếu tạm ấy bị huỷ tiếp thì phiếu kho kia KHÔNG thuộc lần huỷ này. Nhận ra bằng đối
--        chiếu: số lượng (quy đơn vị cơ sở) từng mặt hàng trên phiếu ≠ số đã nhập vào các lô của phiếu kho → về Phiếu
--        tạm, không đụng kho / công nợ.
--   2. `khoi_phuc_phieu_tra_ncc(p_return_id)`:
--      · Huỷ lúc Nháp → về Nháp.
--      · Huỷ lúc đã gửi → về Nháp rồi GỬI LẠI bằng chính `complete_supplier_return` trong cùng giao dịch: xuất kho FIFO
--        từ tồn HIỆN TẠI (hàng của lần gửi trước đã về lô cũ và có thể đã bán đi), ghi lại khoản giảm công nợ NCC —
--        y như luồng sửa phiếu trả (huỷ → về Nháp → gửi lại). Gửi lại không được (kho không đủ mà NPP không cho tồn
--        âm…) → phiếu DỪNG Ở NHÁP, trả lý do — không kẹt lại ở Đã huỷ.
--        Cùng phép đối chiếu dòng ↔ phiếu kho như trên (luồng sửa phiếu trả hỏng giữa chừng để lại Nháp trỏ phiếu kho cũ).
--   3. Cổng như hàm huỷ: cùng NPP, vai Chủ / Quản lý / Kế toán / Thủ kho (RLS phiếu nhập / phiếu trả NCC, mig 163/166).
--      Bấm hai lần không cộng kho hai lần: phiếu không còn 'cancelled' thì đứng yên.
--      Phiếu kho của phiếu còn đang ghi sổ (không ở Đã huỷ) → dừng PHIEU_KHO_LECH, không nhập / xuất kho lần hai.
--   ⚠ Mọi UPDATE có WHERE (Supabase nạp `safeupdate` cho lượt gọi qua API — mig 236).
-- ====================================================================

-- ── 1. Khôi phục phiếu nhập hàng ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.khoi_phuc_phieu_nhap(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv      purchase_invoices%ROWTYPE;
  v_entry_st text;
  v_entry_ma text;
  v_khop     boolean := false;
  v_payable  uuid;
  v_so_lo    int := 0;
BEGIN
  SELECT * INTO v_inv FROM purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu nhập này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu nhập này không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (luật mig 166) — cùng vai với RLS phiếu nhập và với `cancel_purchase_invoice`.
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được khôi phục phiếu nhập.' USING ERRCODE = '42501';
  END IF;
  -- ⚠ IDEMPOTENT — bấm hai lần / mạng rớt bấm lại không được nhập kho hai lần.
  IF v_inv.status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('id', p_invoice_id, 'trang_thai', v_inv.status, 'da_khoi_phuc', false, 'so_lo', 0);
  END IF;

  IF v_inv.stock_entry_id IS NOT NULL THEN
    SELECT status, entry_code INTO v_entry_st, v_entry_ma FROM stock_entries WHERE id = v_inv.stock_entry_id FOR UPDATE;
    IF v_entry_st IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'PHIEU_KHO_LECH: Phiếu kho % của phiếu nhập này đang ở trạng thái "%" chứ không phải Đã huỷ — khôi phục sẽ nhập kho lần hai. Kiểm tra phiếu kho đó trước.',
        COALESCE(v_entry_ma, '?'), COALESCE(v_entry_st, 'không có') USING ERRCODE = 'P0001';
    END IF;
    -- Phiếu kho có đúng là của lần huỷ này? Số từng mặt hàng (đơn vị cơ sở) trên phiếu = số đã nhập vào các lô.
    SELECT NOT EXISTS (
      SELECT 1
      FROM (SELECT l.product_id, SUM(COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor, 1)) AS sl
            FROM purchase_invoice_lines l WHERE l.invoice_id = p_invoice_id GROUP BY l.product_id) a
      FULL JOIN (SELECT b.product_id, SUM(b.qty_initial) AS sl
                 FROM batches b
                 WHERE b.id IN (SELECT sel.batch_id FROM stock_entry_lines sel WHERE sel.entry_id = v_inv.stock_entry_id)
                 GROUP BY b.product_id) k ON k.product_id = a.product_id
      WHERE abs(COALESCE(a.sl, 0) - COALESCE(k.sl, 0)) > 0.001
    ) INTO v_khop;
  END IF;

  -- Huỷ lúc còn Phiếu tạm (hoặc phiếu kho là của lần trước — luồng sửa cũ) → về Phiếu tạm, không đụng kho / công nợ.
  IF NOT v_khop THEN
    UPDATE purchase_invoices
    SET status = 'draft', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
    WHERE id = p_invoice_id;
    RETURN jsonb_build_object('id', p_invoice_id, 'trang_thai', 'draft', 'da_khoi_phuc', true, 'so_lo', 0);
  END IF;

  -- Huỷ lúc đã Hoàn thành → đảo đúng `cancel_purchase_invoice` (mig 238: `còn − nhập`, lô ≤ 0 thì đóng).
  -- ⚠ `WHERE id IN (…)`, không `UPDATE … FROM`: mỗi lô cộng ĐÚNG MỘT LẦN số nhập của chính nó.
  UPDATE batches
  SET qty_on_hand = qty_on_hand + qty_initial,
      status = 'available'
  WHERE id IN (SELECT sel.batch_id FROM stock_entry_lines sel
               WHERE sel.entry_id = v_inv.stock_entry_id AND sel.batch_id IS NOT NULL);
  GET DIAGNOSTICS v_so_lo = ROW_COUNT;

  UPDATE stock_entries SET status = 'posted' WHERE id = v_inv.stock_entry_id;

  -- Công nợ NCC như `complete_purchase_invoice` (mig 145) ghi: tổng phiếu, chưa trả. Huỷ chỉ chạy khi chưa trả đồng
  -- nào (DA_TRA_TIEN), nên "chưa trả" là đúng số trước khi huỷ. Ngày ghi nợ = lúc hoàn thành gốc (sổ nợ NCC xếp theo).
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes, created_at)
  VALUES (v_inv.org_id, v_inv.supplier_id, v_inv.stock_entry_id, v_inv.invoice_number,
          GREATEST(0, COALESCE(v_inv.total, 0)), 0, 'open',
          'Phiếu nhập hàng ' || COALESCE(v_inv.receipt_code, ''), COALESCE(v_inv.completed_at, now()))
  RETURNING id INTO v_payable;

  UPDATE purchase_invoices
  SET status = 'completed', payable_id = v_payable,
      cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object('id', p_invoice_id, 'trang_thai', 'completed', 'da_khoi_phuc', true, 'so_lo', v_so_lo);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.khoi_phuc_phieu_nhap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.khoi_phuc_phieu_nhap(uuid) TO authenticated;

-- ── 2. Khôi phục phiếu trả NCC ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.khoi_phuc_phieu_tra_ncc(p_return_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ret      supplier_returns%ROWTYPE;
  v_entry_st text;
  v_entry_ma text;
  v_khop     boolean := false;
  v_ly_do    text;
BEGIN
  SELECT * INTO v_ret FROM supplier_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHIEU_KHONG_TON_TAI: Không tìm thấy phiếu trả NCC này.' USING ERRCODE = 'P0001';
  END IF;
  IF v_ret.org_id IS DISTINCT FROM public.user_org_id() THEN
    RAISE EXCEPTION 'SAI_DON_VI: Phiếu trả này không thuộc đơn vị của bạn.' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ KIỂM VAI (luật mig 166) — cùng vai với RLS phiếu trả NCC và với `cancel_supplier_return`.
  IF COALESCE(public.user_role(), '') NOT IN ('owner', 'manager', 'accountant', 'warehouse') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không được khôi phục phiếu trả NCC.' USING ERRCODE = '42501';
  END IF;
  -- ⚠ IDEMPOTENT — bấm hai lần không xuất kho hai lần.
  IF v_ret.status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('id', p_return_id, 'trang_thai', v_ret.status, 'da_khoi_phuc', false);
  END IF;

  IF v_ret.stock_entry_id IS NOT NULL THEN
    SELECT status, entry_code INTO v_entry_st, v_entry_ma FROM stock_entries WHERE id = v_ret.stock_entry_id FOR UPDATE;
    IF v_entry_st IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'PHIEU_KHO_LECH: Phiếu kho % của phiếu trả này đang ở trạng thái "%" chứ không phải Đã huỷ — khôi phục sẽ xuất kho lần hai. Kiểm tra phiếu kho đó trước.',
        COALESCE(v_entry_ma, '?'), COALESCE(v_entry_st, 'không có') USING ERRCODE = 'P0001';
    END IF;
    -- Phiếu kho có đúng là lần gửi đã bị huỷ? Số từng mặt hàng (đơn vị cơ sở) trên phiếu = số đã xuất (kể cả dòng xuất
    -- vượt tồn không lô — mig 222).
    SELECT NOT EXISTS (
      SELECT 1
      FROM (SELECT l.product_id, SUM(COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor, 1)) AS sl
            FROM supplier_return_lines l WHERE l.return_id = p_return_id GROUP BY l.product_id) a
      FULL JOIN (SELECT sel.product_id, SUM(COALESCE(sel.qty_in_base_uom, sel.quantity, 0)) AS sl
                 FROM stock_entry_lines sel WHERE sel.entry_id = v_ret.stock_entry_id
                 GROUP BY sel.product_id) k ON k.product_id = a.product_id
      WHERE abs(COALESCE(a.sl, 0) - COALESCE(k.sl, 0)) > 0.001
    ) INTO v_khop;
  END IF;

  UPDATE supplier_returns SET status = 'draft', cancel_reason = NULL WHERE id = p_return_id;

  -- Huỷ lúc Nháp (hoặc phiếu kho là của lần gửi trước — luồng sửa hỏng giữa chừng) → dừng ở Nháp.
  IF NOT v_khop THEN
    RETURN jsonb_build_object('id', p_return_id, 'trang_thai', 'draft', 'da_khoi_phuc', true);
  END IF;

  -- Gửi lại. Lỗi nghiệp vụ (P0001 — kho không đủ…) thì chỉ lùi phần gửi lại: phiếu ở Nháp, trả lý do. Lỗi khác ném ra.
  BEGIN
    PERFORM public.complete_supplier_return(p_return_id);
  EXCEPTION WHEN raise_exception THEN
    v_ly_do := SQLERRM;
  END;
  IF v_ly_do IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_return_id, 'trang_thai', 'draft', 'da_khoi_phuc', true, 'ly_do', v_ly_do);
  END IF;
  RETURN jsonb_build_object('id', p_return_id, 'trang_thai', 'completed', 'da_khoi_phuc', true);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.khoi_phuc_phieu_tra_ncc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.khoi_phuc_phieu_tra_ncc(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 241: khôi phục phiếu nhập hàng / phiếu trả NCC đã huỷ' AS buoc,
       CASE WHEN to_regprocedure('public.khoi_phuc_phieu_nhap(uuid)') IS NOT NULL
             AND to_regprocedure('public.khoi_phuc_phieu_tra_ncc(uuid)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM purchase_invoices WHERE status = 'cancelled') AS phieu_nhap_da_huy,
       (SELECT count(*) FROM supplier_returns WHERE status = 'cancelled') AS phieu_tra_ncc_da_huy;
