-- ====================================================================
-- CÔNG NỢ THEO KHÁCH HÀNG: BỎ KẸP 0 — KHỚP CÔNG NỢ THEO NHÂN VIÊN
--
-- VÌ SAO — chủ nhà 26/09/2026: "sao các con số doanh thu/công nợ của 3 màn này không khớp
--   nhau ? đặc biệt công nợ theo khách hàng và công nợ theo nhân viên không khớp nhau ?"
--   (Tổng công nợ theo KH 650.123.000đ, theo NV 643.795.000đ.)
--   `receivables_by_customer` (mig 121) vẫn kẹp TỪNG dòng về 0 (`GREATEST(0, amount − paid)`)
--   — dòng âm (hàng trả vượt tiền HĐ, phiếu trả tự lập không gắn HĐ) bị tính là 0, nên
--   tổng theo khách CAO hơn tổng theo nhân viên đúng bằng phần dư có của khách. Mig 195 đã
--   bỏ kẹp cho `receivables_by_rep` / `receivables_summary`; hàm này còn sót.
--   Luật công nợ âm chủ nhà chốt 24/09/2026 (mig 186): "không được kẹp về 0".
-- ⚠ Không SECURITY DEFINER (RLS + lọc org_id của người gọi) — như bản 121.
-- ====================================================================

DROP FUNCTION IF EXISTS public.receivables_by_customer();
CREATE FUNCTION public.receivables_by_customer()
RETURNS TABLE (
  customer_id    uuid,
  store_name     text,
  phone          text,
  rep_name       text,
  total_debt     numeric,
  total_paid     numeric,
  remaining      numeric,
  overdue_amount numeric,
  credit_limit   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ (mig 199) KHÔNG KẸP 0 — dòng âm là dư có của khách (mig 186/191), trừ vào nợ
      --   của CHÍNH khách đó. Cùng luật `receivables_by_rep` (mig 195), `loadDebtByCustomer`.
      COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS remaining,
      rc.status,
      rc.sales_user_id
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.status <> 'paid'
  ),
  agg AS (
    SELECT
      r.customer_id,
      SUM(r.amount)     AS total_debt,
      SUM(r.paid)       AS total_paid,
      SUM(r.remaining)  AS remaining,
      GREATEST(0, COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0)) AS overdue_amount,
      -- Lấy một sales_user_id bất kỳ làm phương án dự phòng cho rep_name.
      MIN(r.sales_user_id::text)::uuid AS any_sales_user_id
    FROM r
    GROUP BY r.customer_id
  )
  SELECT
    agg.customer_id,
    COALESCE(c.store_name, '-'),
    COALESCE(c.phone, '-'),
    COALESCE(pa.full_name, su.full_name, '-'),
    agg.total_debt,
    agg.total_paid,
    agg.remaining,
    agg.overdue_amount,
    COALESCE(c.credit_limit, 0)
  FROM agg
  LEFT JOIN customers c ON c.id = agg.customer_id
  LEFT JOIN LATERAL (
    SELECT u.full_name
    FROM customer_assignments ca
    JOIN users u ON u.id = ca.user_id
    WHERE ca.customer_id = agg.customer_id AND ca.role = 'primary'
    LIMIT 1
  ) pa ON true
  LEFT JOIN users su ON su.id = agg.any_sales_user_id
  ORDER BY agg.remaining DESC;
$$;

GRANT EXECUTE ON FUNCTION public.receivables_by_customer() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Công nợ theo KH bỏ kẹp 0' AS hang_muc,
       CASE WHEN position('GREATEST(0, COALESCE(rc.amount' IN pg_get_functiondef('public.receivables_by_customer()'::regprocedure)) = 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       -- Phần dư có mà màn theo khách trước đây bỏ qua (= chênh lệch hai màn công nợ cũ).
       (SELECT COALESCE(sum(GREATEST(0, amount - COALESCE(paid, 0))) - sum(amount - COALESCE(paid, 0)), 0)
          FROM receivables WHERE status <> 'paid') AS phan_du_co_truoc_day_bi_bo;
