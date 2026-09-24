-- ====================================================================
-- GIÁ VỐN Ở BÁO CÁO LÃI / LỖ THEO ĐƠN VỊ CƠ SỞ
--
-- Chủ nhà 24/09/2026 (báo cáo Hàng bán theo nhân viên): "giá niêm yết đang tính
-- theo đơn vị cơ sở. Số lượng bán tính theo đơn vị trung gian … Rà soát các lỗi
-- sai tương tự trong các báo cáo".
--
-- `finance_pnl` (bản mig 126) tính giá vốn = |quantity| × unit_cost trên dòng
-- phiếu xuất. Nhưng phiếu xuất ghi `quantity` theo ĐƠN VỊ GIAO DỊCH
-- (`p_qty_base / v_conv`, mig 120), còn `unit_cost` là giá mỗi ĐƠN VỊ CƠ SỞ
-- (mig 016) — xuất 1 thùng 12 hộp thì giá vốn chỉ còn 1/12.
--
-- Sửa: nhân với `qty_in_base_uom` (mig 039; dòng cũ thiếu thì quantity × hệ số
-- chụp). Mọi phần khác của hàm giữ NGUYÊN VĂN bản mig 126.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.finance_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue        numeric,
  order_count    bigint,
  cogs           numeric,
  exp_cogs       numeric,
  exp_operating  numeric,
  exp_hr         numeric,
  exp_financial  numeric,
  exp_tax        numeric,
  exp_other      numeric,
  total_expenses numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue,
           COUNT(DISTINCT order_id) AS order_count
    FROM sales_invoices
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_invoice_status(status)
      AND invoice_date >= p_from
      AND invoice_date <= p_to
  ),
  cogs AS (
    -- ⚠ SL THEO ĐƠN VỊ CƠ SỞ (mig 187): `unit_cost` là giá mỗi đơn vị cơ sở,
    --   còn `quantity` của phiếu xuất là SL theo đơn vị giao dịch (thùng).
    SELECT COALESCE(SUM(
             ABS(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor_snapshot, 1)))
             * COALESCE(l.unit_cost, 0)
           ), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
    SELECT
      COALESCE(ec.bucket, 'other') AS bucket,
      SUM(COALESCE(x.amount, 0))   AS amt
    FROM expenses x
    LEFT JOIN expense_categories ec ON ec.id = x.category_id
    WHERE x.org_id = public.user_org_id()
      AND x.expense_date >= p_from
      AND x.expense_date <= p_to
    GROUP BY COALESCE(ec.bucket, 'other')
  )
  SELECT
    rev.revenue,
    rev.order_count,
    cogs.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0)
  FROM rev, cogs;
$fn$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Giá vốn lãi/lỗ theo đơn vị cơ sở' AS hang_muc,
       CASE WHEN position('qty_in_base_uom' IN pg_get_functiondef('public.finance_pnl(date, date)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai;
