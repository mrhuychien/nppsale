-- ====================================================================
-- 239 — CÔNG NỢ THEO NCC: THÊM CỘT HÀNG TRẢ LẠI
--
-- VÌ SAO — chủ nhà 08/10/2026: "Phần công nợ theo NCC thêm cột hàng trả lại, đã trả đổi tên thành đã thanh toán cho
--   dễ theo dõi".
--   `payables_by_supplier` (mig 093) cộng thẳng dòng nợ ÂM của phiếu trả NCC (`complete_supplier_return`: amount =
--   −tổng, nối qua `supplier_returns.payable_credit_id`) vào "Tổng nợ" — hàng trả lại lẫn mất trong số ròng.
--
-- CÁCH LÀM: thêm cột `total_returned` = Σ(−amount) của các dòng nợ thuộc phiếu trả NCC (số dương), trên đúng tập dòng
--   đang tính (chưa trả xong). Các cột cũ GIỮ NGUYÊN nghĩa (`total_debt` vẫn là Σ amount ròng) — màn hình hiện
--   Tổng nợ = total_debt + total_returned, nên Tổng nợ − Hàng trả lại − Đã thanh toán = Còn lại. Sổ chưa chạy 239 thì
--   màn hiện "—" ở cột mới, số khác như cũ.
--   ⚠ Đổi cột trả về thì phải DROP rồi CREATE (CREATE OR REPLACE không đổi được RETURNS TABLE).
-- ====================================================================

DROP FUNCTION IF EXISTS public.payables_by_supplier();

CREATE FUNCTION public.payables_by_supplier()
RETURNS TABLE(supplier_id uuid, supplier_name text, supplier_code text, invoice_count bigint, total_debt numeric,
              total_paid numeric, remaining numeric, overdue_count bigint, total_returned numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT
    p.supplier_id,
    COALESCE(s.name, '-'),
    COALESCE(s.code, '-'),
    COUNT(*),
    COALESCE(SUM(p.amount), 0),
    COALESCE(SUM(p.paid), 0),
    COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0),
    COUNT(*) FILTER (WHERE p.status = 'overdue'),
    -- (mig 239) Hàng trả lại NCC: dòng nợ của phiếu trả NCC, ghi số dương.
    COALESCE(SUM(-COALESCE(p.amount, 0)) FILTER (WHERE tra.id IS NOT NULL), 0)
  FROM payables p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN (
    SELECT DISTINCT sr.payable_credit_id AS id FROM supplier_returns sr WHERE sr.payable_credit_id IS NOT NULL
  ) tra ON tra.id = p.id
  WHERE p.org_id = public.user_org_id()
    AND p.status <> 'paid'
  GROUP BY p.supplier_id, s.name, s.code
  ORDER BY COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0) DESC;
$fn$;
REVOKE EXECUTE ON FUNCTION public.payables_by_supplier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payables_by_supplier() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 239: công nợ theo NCC có cột hàng trả lại' AS buoc,
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_proc p
              WHERE p.oid = 'public.payables_by_supplier()'::regprocedure
                AND 'total_returned' = ANY (p.proargnames))
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM supplier_returns WHERE payable_credit_id IS NOT NULL) AS phieu_tra_ncc_dang_tru_no;
