-- ====================================================================
-- 217 — HUỶ HÓA ĐƠN = HUỶ ĐƠN; MỘT ĐƠN MỘT HÓA ĐƠN, KHÔNG CÒN XUẤT MỘT PHẦN / ĐÓNG ĐƠN
--
-- VÌ SAO — chủ nhà 30/09/2026:
--   "Khi hủy hóa đơn -> coi như đóng đơn hàng -> Chuyển luôn đơn hàng về trạng thái Đã hủy.
--    Nhà phân phối không dùng chức năng xuất 1 phần đơn, đơn nào xuất xong coi như xong
--    (hoàn thành) -> ko còn trạng thái Xuất 1 phần và đã đóng. Vì hủy hóa đơn -> hủy luôn
--    đơn hàng nên trả hàng cũng hủy theo luôn ko cần nháp."
--   · "Giao thiếu a) xuất xong coi như xong" · "Dữ liệu cũ: Ko có đơn nào nhiều hóa đơn,
--     các đơn trạng thái kia cho về Hoàn thành".
--
-- CÁCH LÀM
--   1. `_wf2b_sync_order_status`: đơn có hóa đơn ghi sổ là 'completed' — xuất thiếu cũng
--      xong (không còn 'partially_invoiced'). Không hóa đơn nào là 'submitted' như cũ.
--   2. `cancel_invoice` (nút Huỷ HĐ): sau khi hoàn kho / xoá công nợ, đơn → 'cancelled',
--      mọi phiếu trả Nháp / Chờ xử lý của đơn → 'cancelled' (không về Nháp nữa).
--      ⚠ KHÔNG ÁP KHI `reissue_invoice` GỌI (Sửa HĐ = huỷ & lập lại) — cờ
--      `npp.reissue_chuyen_thu` (mig 184) đang 'on' trong lượt đó; đơn phải về
--      'submitted' để `post_invoice` lập tờ mới.
--   3. Chặn hóa đơn thứ hai cho một đơn: chỉ mục duy nhất `(order_id) WHERE posted`.
--      (Đơn 'completed' đã không lọt qua `post_invoice`; chỉ mục chặn nốt hai lượt chạy song song.)
--   4. `close_order` ngừng dùng (ORDER_CLOSE_REMOVED).
--   5. Dữ liệu: đơn 'partially_invoiced' / 'closed' → 'completed'.
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

-- 1. Đơn có hóa đơn là xong -------------------------------------------------
CREATE OR REPLACE FUNCTION public._wf2b_sync_order_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_cur text;
  v_inv int;
  v_new text;
BEGIN
  SELECT status INTO v_cur FROM sales_orders WHERE id = p_order_id;
  IF v_cur IS NULL OR v_cur IN ('draft', 'cancelled') THEN
    RETURN v_cur;
  END IF;

  SELECT count(*) INTO v_inv
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  -- (mig 217) Xuất thiếu cũng là xong — phần chưa giao bỏ, không treo đơn.
  v_new := CASE WHEN v_inv = 0 THEN 'submitted' ELSE 'completed' END;

  IF v_new IS DISTINCT FROM v_cur THEN
    PERFORM set_config('npp.via_rpc', 'on', true);
    UPDATE sales_orders
    SET status = v_new,
        completed_at = CASE WHEN v_new = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
        completed_by = CASE WHEN v_new = 'completed' THEN COALESCE(completed_by, auth.uid()) ELSE NULL END,
        closed_at    = NULL,
        closed_by    = NULL
    WHERE id = p_order_id;
  END IF;

  RETURN v_new;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._wf2b_sync_order_status(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Huỷ HĐ thì huỷ đơn và phiếu trả chưa nhập kho của đơn -------------------
CREATE OR REPLACE FUNCTION public._huy_don_theo_hoa_don(
  p_order_id uuid, p_invoice_code text, p_reason text, p_status text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  o record;
BEGIN
  -- Sửa HĐ (huỷ & lập lại): đơn phải còn sống để lập tờ mới.
  IF COALESCE(current_setting('npp.reissue_chuyen_thu', true), '') = 'on' THEN
    RETURN p_status;
  END IF;
  -- Còn hóa đơn khác (dữ liệu cũ) thì đơn chưa chết.
  IF p_status IS DISTINCT FROM 'submitted' THEN
    RETURN p_status;
  END IF;

  SELECT so.id, so.org_id, so.order_code INTO o FROM sales_orders so WHERE so.id = p_order_id;

  PERFORM set_config('npp.via_rpc', 'on', true);

  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Hóa đơn ' || p_invoice_code || ' bị huỷ — đơn ' || o.order_code || ' huỷ theo'
  WHERE order_id = p_order_id AND status IN ('draft', 'submitted');

  UPDATE sales_orders
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = 'Huỷ theo hóa đơn ' || p_invoice_code || ': ' || COALESCE(p_reason, '')
  WHERE id = p_order_id;

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'cancel_after_complete', 'cancelled',
          jsonb_build_object('reason', p_reason, 'invoice_code', p_invoice_code), auth.uid());

  RETURN 'cancelled';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._huy_don_theo_hoa_don(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure);
  v_re  text := '(v_status\s*:=\s*public\._wf2b_sync_order_status\(v\.order_id\);)';
BEGIN
  IF position('(mig 217)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 217: cancel_invoice đã huỷ đơn theo hóa đơn, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '217: không thấy đúng một chỗ tính lại trạng thái đơn trong cancel_invoice' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '\1' || chr(10)
    || '  -- (mig 217) Huỷ HĐ = huỷ đơn + phiếu trả chưa nhập kho (trừ khi Sửa HĐ gọi).' || chr(10)
    || '  v_status := public._huy_don_theo_hoa_don(v.order_id, v.invoice_code, p_reason, v_status);');
END;
$p$;

-- 3. Một đơn một hóa đơn ghi sổ ---------------------------------------------
DO $p$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT order_id FROM sales_invoices
    WHERE status = 'posted' AND order_id IS NOT NULL
    GROUP BY order_id HAVING count(*) > 1) t;
  IF v_n > 0 THEN
    RAISE NOTICE '--- 217: % đơn đang có nhiều hóa đơn ghi sổ — CHƯA tạo chỉ mục một-đơn-một-HĐ ---', v_n;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_mot_don_mot_hd
      ON sales_invoices (order_id) WHERE status = 'posted';
  END IF;
END;
$p$;

-- 4. Không còn đóng đơn -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- (mig 217) Chủ nhà 30/09/2026: đơn xuất xong là Hoàn thành, không còn đóng đơn.
  RAISE EXCEPTION 'ORDER_CLOSE_REMOVED: không còn đóng đơn — đơn xuất hóa đơn xong là Hoàn thành'
    USING ERRCODE = 'P0001';
END;
$fn$;

-- 5. Dữ liệu cũ về Hoàn thành --------------------------------------------------
DO $p$
BEGIN
  PERFORM set_config('npp.via_rpc', 'on', true);
  UPDATE sales_orders
  SET status = 'completed',
      completed_at = COALESCE(completed_at, closed_at, now()),
      closed_at = NULL, closed_by = NULL
  WHERE status IN ('partially_invoiced', 'closed');
END;
$p$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 217: huỷ HĐ = huỷ đơn; một đơn một HĐ; bỏ xuất một phần / đóng đơn' AS buoc,
       CASE WHEN position('(mig 217)' IN pg_get_functiondef('public.cancel_invoice(uuid, text)'::regprocedure)) > 0
             AND position('ORDER_CLOSE_REMOVED' IN pg_get_functiondef('public.close_order(uuid, text)'::regprocedure)) > 0
             AND NOT EXISTS (SELECT 1 FROM sales_orders WHERE status IN ('partially_invoiced', 'closed'))
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_sales_invoices_mot_don_mot_hd') AS chi_muc_mot_don_mot_hd;
