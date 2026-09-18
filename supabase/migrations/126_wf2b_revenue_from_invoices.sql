-- ---------------------------------------------------------------------
-- 126 — Workflow v2b: doanh thu chuyển gốc từ ĐƠN sang HÓA ĐƠN
--
-- Phần cuối của bộ ba 124 (cấu trúc) · 125 (RPC) · 126 (số liệu).
-- ---------------------------------------------------------------------
--
-- ⚠ VÌ SAO KHÔNG THỂ ĐỂ NGUYÊN: v2b cho một đơn xuất làm nhiều đợt. Đơn
--   `partially_invoiced` đã giao một phần và đã sinh công nợ phần đó —
--   nhưng `is_revenue_status` của v2 chỉ nhận `'completed'`, nên phần đã
--   giao ấy KHÔNG có mặt trong doanh thu, trong lương, trong báo cáo.
--   Hàng ra khỏi kho, tiền ghi vào công nợ, mà sổ doanh thu im lặng.
--
-- ⚠ VÀ ĐỂ NGUYÊN THEO CHIỀU NGƯỢC LẠI CŨNG SAI: chỉ nới
--   `is_revenue_status` cho ba trạng thái mới mà vẫn cộng
--   `sales_orders.total` thì đơn mới giao một nửa được tính doanh thu
--   TOÀN BỘ. Sai còn to hơn.
--
-- Nên phải tách làm hai việc khác nhau:
--
--   SỐ TIỀN  → cộng từ `sales_invoices` đã ghi sổ. Đúng phần đã xuất,
--              không hơn không kém.
--   TẬP ĐƠN  → `is_revenue_status` đổi nghĩa thành "đơn này đã sinh ra
--              doanh thu", tức đã xuất ít nhất một phần. Dùng cho các
--              phép ĐẾM ĐƠN và cho chốt chặn của đơn trả — những chỗ hỏi
--              "đơn này có đáng kể không", không hỏi "bao nhiêu tiền".
--
-- ⚠ ĐỔI Ý NGHĨA SỐ LIỆU — ĐỌC KỸ
--   Doanh thu nay tính theo NGÀY HÓA ĐƠN, không theo ngày đặt hàng. Đơn
--   đặt cuối tháng 3 giao đầu tháng 4 rời khỏi doanh thu tháng 3 và sang
--   tháng 4. Lương và hoa hồng của các kỳ đã chốt sẽ tính lại khác đi.
--   Đổi lại, doanh thu về đúng cùng một trục thời gian với GIÁ VỐN —
--   `finance_pnl` vốn lấy giá vốn theo `stock_entries.posted_at`, nên
--   trước nay lãi gộp của một kỳ đang so doanh thu ngày đặt với giá vốn
--   ngày giao. Lệch đó nay hết.
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.sales_invoices') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_124: chưa có bảng sales_invoices. Chạy migration 124 và 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. is_revenue_status — đổi nghĩa, giữ nguyên chữ ký
-- =====================================================================
--
-- ⚠ GIỮ NGUYÊN TÊN VÀ CHỮ KÝ, CÓ CHỦ Ý. Sáu hàm lương/báo cáo đang gọi
--   nó. Đổi tên là phải sửa cả sáu trong cùng một migration, và hàm nào
--   sót lại sẽ gọi một cái tên không còn tồn tại — PL/pgSQL chỉ tra tên
--   lúc CHẠY, nên nó không vỡ khi cài mà vỡ giữa kỳ tính lương.
--
-- ⚠ 'closed' CÓ TÍNH. Đơn đóng là đơn NPP chốt không giao nốt phần còn
--   lại — phần đã giao vẫn là hàng đã bán và tiền đã ghi nợ. Bỏ nó ra là
--   xoá doanh thu có thật chỉ vì đơn không giao đủ.
--
-- ⚠ 'submitted' KHÔNG TÍNH. Phiếu tạm chưa trừ kho, chưa sinh công nợ.
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') IN ('partially_invoiced', 'completed', 'closed');
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn này đã sinh ra doanh thu chưa — tức đã xuất ít nhất một phần. '
  'v2b: dùng cho phép ĐẾM ĐƠN. Muốn biết BAO NHIÊU TIỀN thì cộng từ '
  'sales_invoices, vì đơn xuất một phần không mang doanh thu toàn bộ.';


-- =====================================================================
-- 2. dashboard_summary
-- =====================================================================
--
-- ⚠ HAI CON SỐ ĐẦU VỀ CÙNG MỘT TRỤC THỜI GIAN. Giữ "doanh thu theo ngày
--   hóa đơn" bên cạnh "số đơn theo ngày đặt" là để hai ô cạnh nhau trên
--   cùng màn hình trả lời hai câu hỏi khác nhau mà nhìn như một.
--   `period_orders` nay là SỐ ĐƠN ĐÃ XUẤT HÀNG TRONG KỲ, đếm phân biệt
--   vì một đơn xuất hai đợt vẫn là một đơn.
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
      SELECT SUM(COALESCE(total, 0)) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
    ), 0),
    COALESCE((
      SELECT COUNT(DISTINCT order_id) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
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

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;


-- =====================================================================
-- 3. dashboard_channel_revenue
-- =====================================================================
--
-- ⚠ KÊNH LẤY TỪ KHÁCH CỦA HÓA ĐƠN, không từ khách của đơn. Hai thứ này
--   luôn bằng nhau (RPC chép `customer_id` từ đơn sang) nhưng đi qua hóa
--   đơn thì mỗi đồng doanh thu chỉ được đếm ở đúng một chỗ.
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
    COALESCE(SUM(COALESCE(si.total, 0)), 0)
  FROM sales_invoices si
  LEFT JOIN customers c ON c.id = si.customer_id
  WHERE si.org_id = public.user_org_id()
    AND si.invoice_date >= p_period_start
    AND public.is_revenue_invoice_status(si.status)
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(si.total, 0)), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date) TO authenticated;


-- =====================================================================
-- 4. dashboard_top_customers
-- =====================================================================
--
-- ⚠ `order_count` VẪN ĐẾM ĐƠN, không đếm hóa đơn. Cột này trả lời "khách
--   này mua mấy lần"; đếm hóa đơn thì khách nhận hàng làm hai chuyến
--   trông như mua hai lần.
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
    si.customer_id,
    COALESCE(c.store_name, 'N/A'),
    COALESCE(SUM(COALESCE(si.total, 0)), 0),
    COUNT(DISTINCT si.order_id)
  FROM sales_invoices si
  LEFT JOIN customers c ON c.id = si.customer_id
  WHERE si.org_id = public.user_org_id()
    AND si.invoice_date >= p_period_start
    AND si.customer_id IS NOT NULL
    AND public.is_revenue_invoice_status(si.status)
  GROUP BY si.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(si.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;


-- =====================================================================
-- 5. finance_pnl
-- =====================================================================
--
-- ⚠ CHỈ ĐỔI KHỐI `rev`. Giá vốn và chi phí giữ nguyên từng chữ — chúng
--   không đọc trạng thái đơn, và đụng vào là mở thêm một mặt trận trong
--   cùng một migration.
--
-- ⚠ DOANH THU VÀ GIÁ VỐN NAY CÙNG MỘT TRỤC. `cogs` vốn lấy theo
--   `stock_entries.posted_at` (ngày hàng rời kho), còn doanh thu trước
--   nay lấy theo `order_date`. Lãi gộp của một kỳ vì thế đang so hai mốc
--   khác nhau: đơn đặt tháng 3 giao tháng 4 góp doanh thu vào tháng 3 mà
--   góp giá vốn vào tháng 4. Nay cả hai cùng bám ngày giao.
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
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS revenue,
           COUNT(DISTINCT order_id) AS order_count
    FROM sales_invoices
    WHERE org_id = public.user_org_id()
      AND public.is_revenue_invoice_status(status)
      AND invoice_date >= p_from
      AND invoice_date <= p_to
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
$$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;


-- =====================================================================
-- 6. compute_payroll_run — chỉ đổi DOANH SỐ GỘP
-- =====================================================================
--
-- ⚠ HÀM DÀI, VÀ CHỈ MỘT CÂU TRUY VẤN CẦN ĐỔI. Nên thay vì chép lại cả
--   thân hàm (mig 096) và chờ một chữ bị chép sai, tách đúng câu ấy ra
--   thành một hàm riêng rồi gọi vào. `compute_payroll_run` được dựng lại
--   nguyên văn mig 096 với đúng một dòng khác.
--
-- ⚠ HAI PHÉP ĐẾM ĐƠN THƯỞNG KHÔNG ĐỔI. Chúng đếm ĐƠN theo `order_date`
--   và so `sales_orders.total` với ngưỡng — hỏi "nhân viên chốt được mấy
--   đơn đủ lớn", không hỏi "thu về bao nhiêu tiền". Chuyển sang hóa đơn
--   là đơn giao hai chuyến hoá ra hai lần thưởng. Chúng tự đi theo nghĩa
--   mới của `is_revenue_status` ở mục 1, và thế là đủ.
CREATE OR REPLACE FUNCTION public._wf2b_gross_revenue_for(
  p_user uuid, p_org uuid, p_start date, p_end date
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(si.total, 0)), 0)
  FROM sales_invoices si
  WHERE si.org_id = p_org
    AND si.sales_user_id = p_user
    AND public.is_revenue_invoice_status(si.status)
    AND si.invoice_date BETWEEN p_start AND p_end;
$$;

COMMENT ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) IS
  'Doanh số gộp của một nhân viên trong kỳ, cộng từ hóa đơn đã ghi sổ. '
  'Tách riêng để compute_payroll_run không phải chép lại cả thân hàm.';

REVOKE EXECUTE ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._wf2b_gross_revenue_for(uuid, uuid, date, date) TO authenticated;


DO $$
DECLARE
  v_src text;
  v_old text;
  v_new text;
  v_n   int;
BEGIN
  -- ⚠ ĐẾM TRƯỚC KHI LẤY. Có hai bản nạp chồng thì `SELECT … INTO` vớ đại
  --   một cái, vá xong bản kia vẫn cộng tiền theo đơn — và không dòng nào
  --   báo.
  SELECT count(*) INTO v_n
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'compute_payroll_run';

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'WF2B_NO_PAYROLL_FN: tìm thấy % bản compute_payroll_run, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_get_functiondef(pr.oid) INTO v_src
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'compute_payroll_run';

  -- ⚠ VÁ ĐÚNG MỘT CÂU TRONG THÂN HÀM ĐANG CHẠY, không chép lại cả hàm.
  --   Chép lại là dựng một bản sao thứ hai của 400 dòng mà không ai đối
  --   chiếu được với bản gốc; vá thì nếu câu cần vá không còn đúng như
  --   dự tính, khối này DỪNG thay vì âm thầm để nguyên.
  v_old := 'SELECT COALESCE(SUM(total), 0) INTO v_gross
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND org_id = v_org
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;';

  v_new := 'v_gross := public._wf2b_gross_revenue_for(u.id, v_org, v_period_start, v_period_end);';

  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION
      'WF2B_PAYROLL_SHAPE: câu tính doanh số gộp trong compute_payroll_run không còn đúng hình dạng mig 096. Sửa tay migration 126 trước khi chạy tiếp.'
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
  RAISE NOTICE '--- 126: compute_payroll_run đã chuyển doanh số gộp sang hóa đơn ---';
END $$;


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_left  int;
  v_ord   numeric;
  v_inv   numeric;
BEGIN
  -- Còn hàm nào cộng TIỀN từ sales_orders theo is_revenue_status không.
  SELECT count(*) INTO v_left
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pg_get_functiondef(pr.oid) LIKE '%is_revenue_status%'
    AND pg_get_functiondef(pr.oid) LIKE '%SUM(%total%'
    AND pg_get_functiondef(pr.oid) LIKE '%sales_orders%';

  IF v_left > 0 THEN
    RAISE NOTICE '--- 126 ⚠ còn % hàm cộng tiền từ sales_orders theo is_revenue_status. Xem lại. ---', v_left;
  END IF;

  SELECT COALESCE(sum(total), 0) INTO v_ord
  FROM sales_orders WHERE public.is_revenue_status(status);
  SELECT COALESCE(sum(total), 0) INTO v_inv
  FROM sales_invoices WHERE status = 'posted';

  RAISE NOTICE '--- 126: doanh thu theo ĐƠN % · theo HÓA ĐƠN % ---', v_ord, v_inv;
  IF v_ord <> v_inv THEN
    RAISE NOTICE '--- 126 ⚠ hai con số LỆCH NHAU %. Đúng ra chúng bằng nhau ngay sau backfill (mọi đơn xuất đủ một lần). Lệch nghĩa là có đơn xuất một phần, hoặc backfill 124 chưa khớp — đối chiếu trước khi chốt lương kỳ tới. ---', v_ord - v_inv;
  END IF;
END $$;
