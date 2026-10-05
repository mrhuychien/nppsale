-- ====================================================================
-- 231 — CÔNG NỢ NCC: KHÔNG KẸP DÒNG ÂM VỀ 0
--
-- VÌ SAO
--   · Chủ nhà 05/10/2026: "Vào xem chi tiết nhà cung cấp hiển thị công nợ chưa đúng (công nợ tính theo phiếu nhập)"
--     · "Phần công nợ NCC thêm phần công nợ theo NCC".
--   · Phiếu trả NCC ghi một dòng `payables` SỐ ÂM (`complete_supplier_return`: "khoản NCC trả lại mình"). Tổng "còn
--     phải trả" cộng `GREATEST(0, amount − paid)` từng dòng (mig 093) thì dòng âm thành 0 — trả NCC xong mà số nợ
--     trên màn Mua hàng / báo cáo Tài chính không giảm. Cùng luật công nợ âm phía khách (CLAUDE.md, mig 186): dòng âm
--     trừ vào tổng. `payables_by_supplier` (mig 093) vốn đã không kẹp — nay ba chỗ cùng một số.
--
-- CÁCH LÀM: viết lại `payables_summary` — `open_payables` = Σ(amount − paid) trên các dòng chưa trả xong. Cột
--   `month_total` giữ nguyên.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.payables_summary(p_since timestamp with time zone)
RETURNS TABLE(open_payables numeric, month_total numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(amount, 0) - COALESCE(paid, 0))
      FROM payables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM payables
      WHERE org_id = public.user_org_id()
        AND created_at >= p_since
        AND stock_entry_id IS NOT NULL
    ), 0);
$fn$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 231: công nợ NCC không kẹp dòng âm' AS buoc,
       CASE WHEN position('GREATEST' IN pg_get_functiondef('public.payables_summary(timestamptz)'::regprocedure)) = 0
            THEN 'OK' ELSE 'CHƯA' END AS ket_qua;
