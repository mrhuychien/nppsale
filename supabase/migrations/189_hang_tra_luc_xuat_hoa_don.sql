-- ====================================================================
-- HÀNG ĐỔI / TRẢ THÊM LÚC XUẤT HÓA ĐƠN BỊ KẸT Ở NHÁP
--
-- Chủ nhà 25/09/2026: "Xem lại mẫu in hoá đơn từ pos. Mất hàng đổi trả."
--
-- Gốc lỗi KHÔNG ở mẫu in mà ở sổ. Xuất hóa đơn lần đầu (POS "Tạo hóa đơn")
-- kèm hàng đổi / trả thêm tại chỗ thì `post_invoice` chạy:
--   1. `_apply_return_adds(v_order, v_inv, …)` → `_pending_return_for`
--      DỰNG PHIẾU MỚI với `invoice_id = v_inv` (mig 152), trạng thái 'draft';
--   2. câu gắn phiếu `UPDATE returns ret SET status = 'submitted',
--      credit_with_invoice = true … WHERE ret.invoice_id IS NULL` (mig 131/133)
--      — phiếu vừa dựng ĐÃ có invoice_id nên bị loại.
-- Kết quả đo trên Postgres thật (hóa đơn 220.000, trả 50.000 + 1 dòng đổi):
-- phiếu trả nằm 'draft', credit_with_invoice = false → công nợ ghi 220.000
-- (khách đã được trừ 50.000 tại chỗ), bản in bỏ cả khối hàng đổi / trả vì
-- phiếu chưa được tính (`creditCounted`).
-- (Sửa hóa đơn — `reissue_invoice` — không dính: nó gỡ invoice_id trước khi
--  gọi `post_invoice`, nên câu gắn bắt được.)
--
-- CÁCH LÀM:
--   1. `_pending_return_for` dựng phiếu mới với invoice_id NULL — câu gắn của
--      `post_invoice` (ngay sau đó, cùng giao dịch) mới là chỗ gắn hóa đơn,
--      đẩy 'submitted' và đánh dấu đi cùng hóa đơn, đúng như chú thích của
--      mig 152 vẫn nói.
--      Và chỉ dùng lại phiếu CHƯA gắn hoặc gắn ĐÚNG hóa đơn này: đơn xuất
--      nhiều hóa đơn thì hàng trả thêm ở tờ thứ hai không được chui vào phiếu
--      của tờ thứ nhất.
--   2. Chữa phiếu đã kẹt: phiếu 'draft' gắn một hóa đơn đã ghi sổ, cùng đơn,
--      dựng TRONG CÙNG giao dịch với hóa đơn (created_at trùng — now() là mốc
--      đầu giao dịch) → 'submitted' + credit_with_invoice, rồi tính lại công
--      nợ của hóa đơn đó.
--
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

CREATE OR REPLACE FUNCTION public._pending_return_for(
  p_order_id uuid,
  p_invoice_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ret uuid;
  o     record;
BEGIN
  -- Cũ nhất trước — gộp mọi dòng thêm tay vào MỘT phiếu.
  -- (mig 189) Chỉ phiếu chưa gắn hóa đơn, hoặc gắn đúng hóa đơn này.
  SELECT r.id INTO v_ret
  FROM returns r
  WHERE r.order_id = p_order_id
    AND r.status IN ('draft', 'submitted')
    AND (r.invoice_id IS NULL OR r.invoice_id = p_invoice_id)
  ORDER BY r.created_at
  LIMIT 1;

  IF v_ret IS NOT NULL THEN
    RETURN v_ret;
  END IF;

  SELECT so.id, so.org_id, so.customer_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ (mig 189) invoice_id NULL: câu gắn phiếu của `post_invoice` chỉ nhận
  --   phiếu chưa gắn — dựng sẵn invoice_id là phiếu kẹt ở 'draft' mãi.
  INSERT INTO returns (org_id, order_id, customer_id, requested_by, invoice_id, status, reason)
  VALUES (o.org_id, o.id, o.customer_id, auth.uid(), NULL, 'draft', 'damaged')
  RETURNING id INTO v_ret;

  RETURN v_ret;
END;
$fn$;

COMMENT ON FUNCTION public._pending_return_for(uuid, uuid) IS
  'Phiếu trả đang chờ của một đơn (chưa gắn hoặc gắn đúng hóa đơn này); dựng mới '
  'nếu chưa có — luôn draft, chưa gắn hóa đơn. post_invoice gắn và đẩy sang submitted (mig 189).';

REVOKE ALL ON FUNCTION public._pending_return_for(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Chữa phiếu đã kẹt.
DO $chua$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    WITH ket AS (
      UPDATE returns ret
      SET status = 'submitted', credit_with_invoice = true
      FROM sales_invoices si
      WHERE si.id = ret.invoice_id
        AND si.status = 'posted'
        AND ret.order_id = si.order_id
        AND ret.status = 'draft'
        AND ret.credit_with_invoice IS NOT TRUE
        AND ret.created_at = si.created_at
      RETURNING ret.invoice_id
    )
    SELECT DISTINCT invoice_id FROM ket
  LOOP
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '189: đã chữa phiếu trả kẹt của % hóa đơn', n;
END;
$chua$;

NOTIFY pgrst, 'reload schema';

SELECT 'Hàng đổi / trả thêm lúc xuất hóa đơn' AS hang_muc,
       CASE WHEN position('(mig 189)' IN pg_get_functiondef('public._pending_return_for(uuid, uuid)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM returns ret JOIN sales_invoices si ON si.id = ret.invoice_id
        WHERE si.status = 'posted' AND ret.status = 'draft' AND ret.created_at = si.created_at) AS phieu_con_ket;
