-- ====================================================================
-- 224 — ĐÁNH DẤU HOÁ ĐƠN ĐÃ SOẠN HÀNG
--
-- VÌ SAO — chủ nhà 02/10/2026: "phần soạn đơn, thêm các bộ lọc vào đơn. thêm đánh dấu đơn nào đã soạn vào."
--   · "đã soạn chỉ xuất hiện ở màn soạn đơn thôi" — dấu này chỉ đọc / ghi ở Kho vận › Soạn hàng.
--   Kho gộp nhiều hoá đơn thành đơn tổng để nhặt; trước đây không biết hoá đơn nào đã soạn rồi → soạn trùng
--   hoặc sót.
--
-- CÁCH LÀM
--   1. `sales_invoices.soan_luc / soan_boi` — đã soạn lúc nào, ai đánh dấu. Ghi THẲNG lên hoá đơn (lọc
--      "Chưa soạn" bằng một điều kiện) nhưng KHÔNG đổi giờ sửa cuối (mig 220 chỉ bắt cột nội dung), không
--      đụng trạng thái / tiền / kho.
--   2. RPC `danh_dau_soan_hang(p_ids, p_da)` — đánh dấu / bỏ đánh dấu nhiều hoá đơn một lượt. Trình duyệt
--      không UPDATE được sales_invoices (chỉ có quyền đọc) → mọi ghi đi qua đây. Chủ NPP, quản lý, thủ kho,
--      kế toán; chỉ hoá đơn đã ghi sổ của NPP mình.
-- ====================================================================

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS soan_luc timestamptz;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS soan_boi uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoices_chua_soan
  ON sales_invoices (org_id, invoice_date DESC) WHERE soan_luc IS NULL AND status = 'posted';

CREATE OR REPLACE FUNCTION public.danh_dau_soan_hang(p_ids uuid[], p_da boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_n integer;
BEGIN
  IF v_org IS NULL OR public.user_role() NOT IN ('owner', 'manager', 'warehouse', 'accountant') THEN
    RAISE EXCEPTION 'KHONG_DU_QUYEN: chỉ chủ NPP, quản lý, thủ kho, kế toán đánh dấu soạn hàng' USING ERRCODE = 'P0001';
  END IF;
  UPDATE sales_invoices
     SET soan_luc = CASE WHEN p_da THEN COALESCE(soan_luc, now()) END,
         soan_boi = CASE WHEN p_da THEN COALESCE(soan_boi, auth.uid()) END
   WHERE org_id = v_org AND id = ANY (COALESCE(p_ids, '{}'))
     AND status = 'posted'
     AND (soan_luc IS NULL) = p_da;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.danh_dau_soan_hang(uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.danh_dau_soan_hang(uuid[], boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 224: đánh dấu đã soạn hàng' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'sales_invoices' AND column_name = 'soan_luc')
             AND to_regprocedure('public.danh_dau_soan_hang(uuid[],boolean)') IS NOT NULL
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM sales_invoices WHERE status = 'posted' AND soan_luc IS NULL) AS hoa_don_chua_soan;
