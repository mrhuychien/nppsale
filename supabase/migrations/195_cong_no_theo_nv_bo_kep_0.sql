-- ====================================================================
-- CÔNG NỢ THEO NHÂN VIÊN / Ô TỔNG CÔNG NỢ: BỎ KẸP 0, HIỆN DÒNG CHƯA GÁN NV
--
-- VÌ SAO — chủ nhà 25/09/2026: "rà soát lại toàn bộ cho tao tại sao doanh số nhân
--   viên lại lệch so với công nợ nhân viên". Hai hàm này kẹp TỪNG dòng về 0
--   (`GREATEST(0, amount − paid)`) — sai luật công nợ âm chủ nhà chốt 24/09/2026
--   (mig 186): dư có của khách (hàng trả vượt tiền HĐ, phiếu trả tự lập) phải được
--   trừ vào tổng nợ. Màn "Công nợ theo NV" vì vậy cao hơn trang chi tiết của chính
--   nhân viên đó, và cao hơn doanh số thuần. `receivables_by_rep` còn bỏ hẳn dòng nợ
--   không có nhân viên → tổng các nhân viên không bằng tổng nợ.
--   Luật mới = `loadDebtByCustomer`: Σ(amount − paid) trên dòng chưa 'paid'.
-- ⚠ Không SECURITY DEFINER (RLS + lọc org_id của người gọi) — chốt tests/aging-thresholds.
-- Đi cùng mig 194 (người đứng tên công nợ theo hóa đơn / phiếu trả).
-- ====================================================================

DROP FUNCTION IF EXISTS public.receivables_summary();
CREATE FUNCTION public.receivables_summary()
RETURNS TABLE (
  total_outstanding  numeric,
  current_amount     numeric,
  current_count      bigint,
  warning_amount     numeric,
  warning_count      bigint,
  overdue_amount     numeric,
  overdue_count      bigint,
  critical_amount    numeric,
  critical_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      -- ⚠ KHÔNG KẸP 0 (mig 186/194): dòng âm là dư có của khách, trừ vào tổng nợ.
      COALESCE(amount, 0) - COALESCE(paid, 0) AS remaining,
      CASE
        WHEN due_date IS NULL THEN 'current'
        WHEN (public.vn_today() - due_date) <= 0  THEN 'current'
        WHEN (public.vn_today() - due_date) <= 30 THEN 'warning'
        WHEN (public.vn_today() - due_date) <= 60 THEN 'overdue'
        ELSE 'critical'
      END AS bucket
    FROM receivables
    WHERE org_id = public.user_org_id()
      AND status <> 'paid'
  )
  SELECT
    COALESCE(SUM(remaining), 0),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'current'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'current'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'warning'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'warning'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'overdue'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'overdue'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'critical'), 0),
    COUNT(*)                FILTER (WHERE bucket = 'critical')
  FROM r;
$$;

DROP FUNCTION IF EXISTS public.receivables_by_rep();
CREATE FUNCTION public.receivables_by_rep()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  customer_count      bigint,
  customers_with_debt bigint,
  total_debt          numeric,
  total_paid          numeric,
  total_amount        numeric,
  overdue_amount      numeric,
  collection_rate     integer,
  dso                 integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.sales_user_id,
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ (mig 194) Σ(amount − paid) trên dòng CHƯA 'paid', KHÔNG kẹp 0 — cùng luật
      --   `loadDebtByCustomer` và trang chi tiết nhân viên. Dòng trả dư đã 'paid' thì 0.
      CASE WHEN rc.status <> 'paid'
           THEN COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) ELSE 0 END AS remaining,
      rc.status,
      rc.status <> 'paid' AND COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) > 0 AS has_debt,
      GREATEST(0, public.vn_today() - COALESCE(rc.due_date, public.vn_today())) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
  )
  SELECT
    r.sales_user_id,
    CASE WHEN r.sales_user_id IS NULL THEN '(Chưa gán nhân viên)' ELSE COALESCE(u.full_name, '-') END,
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN GREATEST(0, LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer))
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(AVG(r.aging_days) FILTER (WHERE r.has_debt))::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.receivables_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()  TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Công nợ theo NV bỏ kẹp 0' AS hang_muc,
       CASE WHEN position('GREATEST(0, COALESCE(rc.amount' IN pg_get_functiondef('public.receivables_by_rep()'::regprocedure)) = 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT total_outstanding FROM public.receivables_summary()) AS tong_no_cua_nguoi_chay;
