-- ====================================================================
-- 093_aggregate_functions
--
-- Cộng số Ở PHÍA DATABASE thay vì tải dữ liệu về trình duyệt rồi cộng.
--
-- BỐI CẢNH
-- `db.max_rows` của dự án là 1.000. Trước đây các trang tổng hợp tải cả
-- bảng về rồi cộng bằng JavaScript, nên khi vượt trần thì API trả 200
-- kèm đúng 1.000 dòng, KHÔNG có lỗi — trang hiện một con số trông bình
-- thường nhưng thiếu. Lớp `src/lib/supabase/aggregate.ts` đã vá bằng cách
-- chia trang lấy đủ, nhưng đó vẫn là hàng chục request và vài MB dữ liệu
-- chỉ để ra một con số.
--
-- Các hàm dưới đây trả về SẴN kết quả đã cộng: một request, vài chục byte,
-- và chính xác tuyệt đối vì Postgres cộng trên toàn bộ dữ liệu.
--
-- BẢO MẬT — ĐỌC KỸ TRƯỚC KHI SỬA
-- Tất cả đều để SECURITY INVOKER (mặc định), tức là chạy bằng quyền NGƯỜI
-- GỌI nên RLS của các bảng bên dưới vẫn được áp dụng. Nhân viên bán hàng
-- gọi `receivables_by_rep()` chỉ cộng được trên những dòng RLS cho họ thấy.
--
--   ⚠️ TUYỆT ĐỐI KHÔNG đổi sang SECURITY DEFINER để "cho tiện".
--      Làm vậy là mở toang toàn bộ số liệu tài chính cho mọi vai trò,
--      và sẽ không có lỗi nào báo cho bạn biết.
--
-- Ngoại lệ có chủ đích: `public.user_org_id()` vốn đã là SECURITY DEFINER
-- (từ migration 002) vì nó phải đọc bảng users để biết người gọi thuộc tổ
-- chức nào. Đó là hàm chỉ trả về org_id của CHÍNH người gọi.
--
-- QUY ƯỚC
-- Mỗi hàm đều lọc `org_id = public.user_org_id()` — phòng vệ chiều sâu,
-- không phụ thuộc hoàn toàn vào RLS.
-- Idempotent: DROP trước CREATE (xem bài học ở migration 091).
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. receivables_summary — tổng công nợ phải thu + phân nhóm tuổi nợ.
--
-- Dùng ở trang /receivables. Ngưỡng chia nhóm PHẢI khớp với
-- `getAgingStatus()` trong src/lib/utils.ts:
--     <= 0 ngày quá hạn → current
--     <= 30             → warning
--     <= 60             → overdue
--     > 60              → critical
-- Sửa một bên mà quên bên kia là hai chỗ ra hai con số khác nhau.
--
-- Trả về 1 dòng.
-- --------------------------------------------------------------------
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
      GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)) AS remaining,
      CASE
        WHEN due_date IS NULL THEN 'current'
        WHEN (CURRENT_DATE - due_date) <= 0  THEN 'current'
        WHEN (CURRENT_DATE - due_date) <= 30 THEN 'warning'
        WHEN (CURRENT_DATE - due_date) <= 60 THEN 'overdue'
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


-- --------------------------------------------------------------------
-- 2. receivables_by_rep — công nợ gộp theo nhân viên bán hàng.
--
-- Dùng ở /receivables/by-rep. Số dòng trả về = số nhân viên, không phải
-- số dòng công nợ.
--
-- Lưu ý về DSO: chỉ tính trên các dòng CHƯA thanh toán xong, và số ngày
-- quá hạn ép sàn về 0 (chưa đến hạn không được kéo trung bình xuống âm) —
-- giống hệt logic cũ ở trình duyệt.
-- --------------------------------------------------------------------
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
      COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS remaining,
      rc.status,
      rc.status <> 'paid' AS has_debt,
      GREATEST(0, CURRENT_DATE - COALESCE(rc.due_date, CURRENT_DATE)) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.sales_user_id IS NOT NULL
  )
  SELECT
    r.sales_user_id,
    COALESCE(u.full_name, '-'),
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(
                AVG(r.aging_days) FILTER (WHERE r.has_debt)
              )::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 3. receivables_by_customer — công nợ gộp theo khách hàng.
--
-- Dùng ở /receivables/by-customer. Chỉ tính dòng CHƯA thanh toán xong,
-- đúng như truy vấn cũ (`.neq("status", "paid")`).
--
-- `rep_name` lấy theo người phụ trách chính (customer_assignments role =
-- 'primary'); không có thì lấy nhân viên trên dòng công nợ — đúng thứ tự
-- ưu tiên của mã cũ.
-- --------------------------------------------------------------------
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
      COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0) AS overdue_amount,
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


-- --------------------------------------------------------------------
-- 4. payables_by_supplier — công nợ phải trả gộp theo nhà cung cấp.
--    Dùng ở /payables/by-supplier.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payables_by_supplier();
CREATE FUNCTION public.payables_by_supplier()
RETURNS TABLE (
  supplier_id    uuid,
  supplier_name  text,
  supplier_code  text,
  invoice_count  bigint,
  total_debt     numeric,
  total_paid     numeric,
  remaining      numeric,
  overdue_count  bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.supplier_id,
    COALESCE(s.name, '-'),
    COALESCE(s.code, '-'),
    COUNT(*),
    COALESCE(SUM(p.amount), 0),
    COALESCE(SUM(p.paid), 0),
    COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0),
    COUNT(*) FILTER (WHERE p.status = 'overdue')
  FROM payables p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.org_id = public.user_org_id()
    AND p.status <> 'paid'
  GROUP BY p.supplier_id, s.name, s.code
  ORDER BY COALESCE(SUM(COALESCE(p.amount, 0) - COALESCE(p.paid, 0)), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 5. payables_summary — tổng công nợ phải trả + tổng nhập trong kỳ.
--    Dùng ở /purchasing.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payables_summary(timestamptz);
CREATE FUNCTION public.payables_summary(p_since timestamptz)
RETURNS TABLE (
  open_payables numeric,
  month_total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
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
$$;


-- --------------------------------------------------------------------
-- 6. stock_value_summary — giá trị tồn kho theo giá vốn lô.
--    Dùng ở /reports/finance và bảng cân đối kế toán.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.stock_value_summary();
CREATE FUNCTION public.stock_value_summary()
RETURNS TABLE (
  inventory_value numeric,
  batch_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0),
    COUNT(*)
  FROM batches
  WHERE org_id = public.user_org_id()
    AND COALESCE(qty_on_hand, 0) > 0;
$$;


-- --------------------------------------------------------------------
-- 7. finance_pnl — báo cáo lãi lỗ cho một khoảng ngày.
--
-- Doanh thu = tổng đơn đã giao trong kỳ (theo order_date).
-- Giá vốn   = tổng |quantity| × unit_cost của các dòng thuộc phiếu XUẤT
--             đã ghi sổ trong kỳ (theo posted_at).
-- Chi phí   = bảng expenses, gộp theo bucket của danh mục.
--
-- Trả chi phí theo từng bucket thành cột riêng thay vì JSON, để phía
-- TypeScript đọc thẳng không phải parse.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_pnl(date, date);
CREATE FUNCTION public.finance_pnl(p_from date, p_to date)
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
AS $$
  WITH rev AS (
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue, COUNT(*) AS order_count
    FROM sales_orders
    WHERE org_id = public.user_org_id()
      AND status = 'delivered'
      AND order_date >= p_from
      AND order_date <= p_to
  ),
  cogs AS (
    SELECT COALESCE(SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0)), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'export'
      AND e.status = 'posted'
      AND e.posted_at >= p_from::timestamptz
      AND e.posted_at <  (p_to + 1)::timestamptz
  ),
  exp AS (
    SELECT
      -- Danh mục không có bucket thì rơi vào 'other', giống mã cũ.
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
$$;


-- --------------------------------------------------------------------
-- 8. finance_balance_sheet — bảng cân đối kế toán tại một ngày.
--
-- Giữ NGUYÊN công thức đơn giản hoá của mã cũ, kể cả những chỗ chưa
-- chuẩn mực kế toán, để con số không đổi khi chuyển sang cộng ở database:
--   Tiền     = tiền đã thu − chi trả NCC − chi phí đã trả
--   Phải thu = tổng (amount − paid) của công nợ chưa tất toán
--   Tồn kho  = Σ qty_on_hand × unit_cost
--   Phải trả = tổng (amount − paid) của công nợ NCC chưa tất toán
--   Chi phí chưa trả = tổng expenses có is_paid = false
--   Vốn chủ sở hữu = tài sản − nợ phải trả (số chốt)
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_balance_sheet(date);
CREATE FUNCTION public.finance_balance_sheet(p_as_of date)
RETURNS TABLE (
  cash                 numeric,
  accounts_receivable  numeric,
  inventory            numeric,
  accounts_payable     numeric,
  unpaid_expenses      numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
  cash_in AS (
    SELECT COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS v
    FROM payments p
    JOIN receivables r ON r.id = p.receivable_id
    WHERE r.org_id = public.user_org_id()
      AND p.collected_at < (p_as_of + 1)::timestamptz
  ),
  paid_payables AS (
    SELECT COALESCE(SUM(COALESCE(pp.amount, 0)), 0) AS v
    FROM payable_payments pp
    JOIN payables pa ON pa.id = pp.payable_id
    WHERE pa.org_id = public.user_org_id()
      AND pp.paid_at < (p_as_of + 1)::timestamptz
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE is_paid), 0)     AS paid,
      COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE NOT is_paid), 0) AS unpaid
    FROM expenses
    WHERE org_id = public.user_org_id()
      AND expense_date <= p_as_of
  ),
  ar AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM receivables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  ),
  inv AS (
    SELECT COALESCE(SUM(COALESCE(qty_on_hand, 0) * COALESCE(unit_cost, 0)), 0) AS v
    FROM batches
    WHERE org_id = public.user_org_id() AND COALESCE(qty_on_hand, 0) > 0
  ),
  ap AS (
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0))), 0) AS v
    FROM payables
    WHERE org_id = public.user_org_id() AND status <> 'paid'
  )
  SELECT
    cash_in.v - paid_payables.v - exp.paid,
    ar.v,
    inv.v,
    ap.v,
    exp.unpaid
  FROM cash_in, paid_payables, exp, ar, inv, ap;
$$;


-- --------------------------------------------------------------------
-- 9. finance_cash_flow — lưu chuyển tiền tệ (chỉ phần hoạt động kinh doanh).
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_cash_flow(date, date);
CREATE FUNCTION public.finance_cash_flow(p_from date, p_to date)
RETURNS TABLE (
  cash_from_customers numeric,
  cash_to_suppliers   numeric,
  cash_to_expenses    numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(p.amount, 0))
      FROM payments p
      JOIN receivables r ON r.id = p.receivable_id
      WHERE r.org_id = public.user_org_id()
        AND p.collected_at >= p_from::timestamptz
        AND p.collected_at <  (p_to + 1)::timestamptz
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.amount, 0))
      FROM payable_payments pp
      JOIN payables pa ON pa.id = pp.payable_id
      WHERE pa.org_id = public.user_org_id()
        AND pp.paid_at >= p_from::timestamptz
        AND pp.paid_at <  (p_to + 1)::timestamptz
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM expenses
      WHERE org_id = public.user_org_id()
        AND is_paid = true
        AND paid_at >= p_from::timestamptz
        AND paid_at <  (p_to + 1)::timestamptz
    ), 0);
$$;


-- --------------------------------------------------------------------
-- 10. dashboard_summary — các con số trên trang Tổng quan.
--
-- `p_period_start` là mốc đầu kỳ do giao diện chọn (hôm nay / tuần / tháng
-- / quý), truyền vào để trang chủ và hàm này luôn cùng một mốc.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_summary(date);
CREATE FUNCTION public.dashboard_summary(p_period_start date)
RETURNS TABLE (
  period_revenue    numeric,
  period_orders     bigint,
  open_receivables  numeric,
  overdue_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(COALESCE(total, 0)) FROM sales_orders
      WHERE org_id = public.user_org_id() AND order_date >= p_period_start
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM sales_orders
      WHERE org_id = public.user_org_id() AND order_date >= p_period_start
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)))
      FROM receivables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM receivables
      WHERE org_id = public.user_org_id() AND status = 'overdue'
    ), 0);
$$;


-- --------------------------------------------------------------------
-- 11. dashboard_top_customers — top khách hàng theo doanh thu trong kỳ.
--     Trả về đúng `p_limit` dòng thay vì cả bảng đơn hàng.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_top_customers(date, integer);
CREATE FUNCTION public.dashboard_top_customers(p_period_start date, p_limit integer DEFAULT 5)
RETURNS TABLE (
  customer_id uuid,
  store_name  text,
  total       numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    o.customer_id,
    COALESCE(c.store_name, 'N/A'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0),
    COUNT(*)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
    AND o.customer_id IS NOT NULL
  GROUP BY o.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;


-- --------------------------------------------------------------------
-- 12. dashboard_channel_revenue — doanh thu theo kênh khách hàng.
--     Khách không gắn kênh gộp vào "Khác", giống mã cũ.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_channel_revenue(date);
CREATE FUNCTION public.dashboard_channel_revenue(p_period_start date)
RETURNS TABLE (
  channel text,
  total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(c.channel, ''), 'Khác'),
    COALESCE(SUM(COALESCE(o.total, 0)), 0)
  FROM sales_orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.org_id = public.user_org_id()
    AND o.order_date >= p_period_start
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC;
$$;


-- --------------------------------------------------------------------
-- 13. cash_received_total — tổng tiền mặt đã nhận trong kỳ.
--     Chỉ tính phiếu thu đã được kế toán xác nhận (status = 'received').
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cash_received_total(date, date);
CREATE FUNCTION public.cash_received_total(p_from date, p_to date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(submitted_amount, 0)), 0)
  FROM cash_receipts
  WHERE org_id = public.user_org_id()
    AND status = 'received'
    AND receipt_date >= p_from
    AND receipt_date <= p_to;
$$;


-- --------------------------------------------------------------------
-- Quyền gọi. `authenticated` là đủ — RLS vẫn chặn ở tầng bảng.
-- KHÔNG cấp cho `anon`: người chưa đăng nhập không có org_id nên hàm sẽ
-- trả 0, nhưng không việc gì phải để lộ bề mặt gọi được.
-- --------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.receivables_summary()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_customer()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_by_supplier()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.payables_summary(timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_value_summary()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_received_total(date, date)  TO authenticated;


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY
-- ====================================================================
-- 1) Cả 13 hàm đã tạo chưa — phải ra đúng 13 dòng:
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND proname IN (
--    'receivables_summary','receivables_by_rep','receivables_by_customer',
--    'payables_by_supplier','payables_summary','stock_value_summary',
--    'finance_pnl','finance_balance_sheet','finance_cash_flow',
--    'dashboard_summary','dashboard_top_customers','dashboard_channel_revenue',
--    'cash_received_total')
--  ORDER BY proname;
--
-- 2) KHÔNG hàm nào được là SECURITY DEFINER — phải ra 0 dòng:
-- SELECT proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.prosecdef
--    AND proname IN ('receivables_summary','receivables_by_rep',
--      'receivables_by_customer','payables_by_supplier','payables_summary',
--      'stock_value_summary','finance_pnl','finance_balance_sheet',
--      'finance_cash_flow','dashboard_summary','dashboard_top_customers',
--      'dashboard_channel_revenue','cash_received_total');
--
-- 3) Đối chiếu số cũ và số mới — hai cột phải BẰNG NHAU:
-- SELECT
--   (SELECT total_outstanding FROM public.receivables_summary()) AS ham_moi,
--   (SELECT COALESCE(SUM(GREATEST(0, amount - paid)), 0)
--      FROM receivables
--     WHERE org_id = public.user_org_id() AND status <> 'paid') AS cong_tay;
-- ====================================================================
