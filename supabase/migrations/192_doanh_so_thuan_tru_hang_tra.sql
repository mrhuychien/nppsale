-- ====================================================================
-- DOANH SỐ THUẦN = HÀNG ĐI − HÀNG TRẢ (khớp với công nợ)
--
-- VÌ SAO — chủ nhà 25/09/2026 (màn khách "Chị huyền 25"):
--   "check lại màn này Doanh thu lệch công nợ. Danh sách Hoá đơn bán HD 0403 thực
--    chất số tiền còn 2988500 (sau khi trừ hàng trả). Rà soát lại toàn bộ doanh số
--    tính bằng số đi - số trả."
--   HD-0403 = 4.640.500, hàng trả tự sinh kèm hóa đơn 1.652.000 (Chờ xử lý) → công
--   nợ 2.988.500 nhưng doanh thu vẫn 4.640.500.
--
-- MỘT LUẬT, KHỚP CÔNG NỢ (`_wf2b_recompute_receivable`, mig 186/191):
--   · Phiếu TỰ SINH theo hóa đơn (`credit_with_invoice`, Chờ xử lý / Đã nhập kho):
--     trừ doanh số vào NGÀY CỦA HÓA ĐƠN — cùng lúc công nợ bị trừ.
--   · Phiếu TỰ LẬP (và phiếu cũ 'approved'): trừ vào ngày HOÀN THÀNH (`credited_at`,
--     mig 188 — bám ngày chứng từ).
--   · Số tiền: `credit_note_amount` (hàng ĐỔI không tính, mig 055).
--   Bản cũ của các báo cáo chỉ đọc phiếu 'approved'/'completed' theo `credited_at`
--   → phiếu tự sinh đang Chờ xử lý (đã trừ nợ) bị BỎ SÓT: đúng lỗi chủ nhà thấy.
--
-- CÁCH LÀM:
--   1. `returns.revenue_date` (DATE) — ngày trừ doanh số, NULL = không trừ. Trigger
--      giữ nó đúng ở mọi đường ghi phiếu trả, và khi hóa đơn đổi ngày / trạng thái.
--   2. `dashboard_summary` / `dashboard_channel_revenue` / `dashboard_top_customers`:
--      doanh thu thuần. `open_receivables` thôi kẹp từng dòng về 0 (luật mig 186).
--   3. `finance_pnl`: thêm `revenue_gross`, `returns_value`, `returns_cogs`;
--      `revenue` = thuần; giá vốn trừ giá vốn hàng trả đã nhập lại kho.
--   4. `payroll_returns_for`: theo `revenue_date`, NV theo `returns.sales_user_id`
--      (mig 160) rồi mới tới hóa đơn / đơn.
-- ====================================================================

-- 1. Cột + trigger ----------------------------------------------------
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS revenue_date date;
CREATE INDEX IF NOT EXISTS idx_returns_revenue_date
  ON public.returns(org_id, revenue_date) WHERE revenue_date IS NOT NULL;

COMMENT ON COLUMN public.returns.revenue_date IS
  'Ngày trừ doanh số của phiếu trả (mig 192): tự sinh = ngày hóa đơn; tự lập = ngày hoàn thành; NULL = không trừ.';

CREATE OR REPLACE FUNCTION public._ngay_tru_doanh_so()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $trg$
DECLARE
  v_ngay date;
BEGIN
  IF COALESCE(NEW.credit_with_invoice, false) AND NEW.status IN ('submitted', 'completed')
     AND NEW.invoice_id IS NOT NULL THEN
    SELECT si.invoice_date INTO v_ngay
    FROM sales_invoices si
    WHERE si.id = NEW.invoice_id AND public.is_revenue_invoice_status(si.status);
    NEW.revenue_date := v_ngay;
  ELSIF NEW.status IN ('approved', 'completed') THEN
    NEW.revenue_date := COALESCE(
      (NEW.credited_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      NEW.return_date,
      (NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  ELSE
    NEW.revenue_date := NULL;
  END IF;
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._ngay_tru_doanh_so() FROM PUBLIC, anon, authenticated;

-- ⚠ Tên "trg_zz_…": trigger BEFORE chạy theo thứ tự tên — phải chạy SAU
--   `trg_returns_credited_at` (mig 188) để đọc `credited_at` đã chốt.
DROP TRIGGER IF EXISTS trg_zz_returns_revenue_date ON public.returns;
CREATE TRIGGER trg_zz_returns_revenue_date
  BEFORE INSERT OR UPDATE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._ngay_tru_doanh_so();

-- Hóa đơn đổi ngày / trạng thái → phiếu tự sinh của nó đổi ngày trừ theo.
CREATE OR REPLACE FUNCTION public._hoa_don_doi_ngay_tru_hang_tra()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR NEW.status IS DISTINCT FROM OLD.status THEN
    -- Chạm dòng để trigger trên `returns` tính lại `revenue_date`.
    UPDATE returns SET revenue_date = revenue_date WHERE invoice_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._hoa_don_doi_ngay_tru_hang_tra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hoa_don_ngay_tru_hang_tra ON public.sales_invoices;
CREATE TRIGGER trg_hoa_don_ngay_tru_hang_tra
  AFTER UPDATE OF invoice_date, status ON public.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public._hoa_don_doi_ngay_tru_hang_tra();

-- Điền cho phiếu cũ (trigger BEFORE tự tính giá trị).
UPDATE public.returns SET revenue_date = revenue_date;

-- 2. Dashboard --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_period_start date)
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
    -- (mig 192) Doanh thu THUẦN: hóa đơn đã ghi sổ − hàng trả theo `revenue_date`.
    COALESCE((
      SELECT SUM(COALESCE(total, 0)) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
    ), 0)
    - COALESCE((
      SELECT SUM(COALESCE(credit_note_amount, 0)) FROM returns
      WHERE org_id = public.user_org_id()
        AND revenue_date >= p_period_start
    ), 0),
    COALESCE((
      SELECT COUNT(DISTINCT order_id) FROM sales_invoices
      WHERE org_id = public.user_org_id()
        AND invoice_date >= p_period_start
        AND public.is_revenue_invoice_status(status)
    ), 0),
    -- ⚠ (mig 192) KHÔNG kẹp từng dòng về 0 (luật công nợ âm, mig 186).
    COALESCE((
      SELECT SUM(COALESCE(amount, 0) - COALESCE(paid, 0))
      FROM receivables
      WHERE org_id = public.user_org_id() AND status <> 'paid'
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM receivables
      WHERE org_id = public.user_org_id() AND status = 'overdue'
    ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_channel_revenue(p_period_start date)
RETURNS TABLE (
  channel text,
  total   numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH x AS (
    SELECT si.customer_id, COALESCE(si.total, 0) AS amt
    FROM sales_invoices si
    WHERE si.org_id = public.user_org_id()
      AND si.invoice_date >= p_period_start
      AND public.is_revenue_invoice_status(si.status)
    UNION ALL
    -- (mig 192) Hàng trả trừ vào kênh của khách trả.
    SELECT r.customer_id, -COALESCE(r.credit_note_amount, 0)
    FROM returns r
    WHERE r.org_id = public.user_org_id()
      AND r.revenue_date >= p_period_start
  )
  SELECT
    COALESCE(NULLIF(c.channel, ''), 'Khác'),
    COALESCE(SUM(x.amt), 0)
  FROM x
  LEFT JOIN customers c ON c.id = x.customer_id
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(x.amt), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_top_customers(p_period_start date, p_limit integer DEFAULT 5)
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
  WITH ban AS (
    SELECT si.customer_id, SUM(COALESCE(si.total, 0)) AS amt, COUNT(DISTINCT si.order_id) AS n
    FROM sales_invoices si
    WHERE si.org_id = public.user_org_id()
      AND si.invoice_date >= p_period_start
      AND si.customer_id IS NOT NULL
      AND public.is_revenue_invoice_status(si.status)
    GROUP BY si.customer_id
  ),
  tra AS (
    -- (mig 192) Doanh thu THUẦN theo khách.
    SELECT r.customer_id, SUM(COALESCE(r.credit_note_amount, 0)) AS amt
    FROM returns r
    WHERE r.org_id = public.user_org_id()
      AND r.revenue_date >= p_period_start
    GROUP BY r.customer_id
  )
  SELECT
    b.customer_id,
    COALESCE(c.store_name, 'N/A'),
    b.amt - COALESCE(t.amt, 0),
    b.n
  FROM ban b
  LEFT JOIN tra t ON t.customer_id = b.customer_id
  LEFT JOIN customers c ON c.id = b.customer_id
  ORDER BY b.amt - COALESCE(t.amt, 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;

-- 3. finance_pnl — doanh thu thuần + giá vốn thuần -----------------------
-- ⚠ Đổi danh sách cột trả về → phải DROP (CREATE OR REPLACE không đổi được).
--   Thân hàm chép NGUYÊN VĂN bản mig 187, chỉ thêm hai CTE `tra` / `tra_von`.
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
  total_expenses numeric,
  revenue_gross  numeric,
  returns_value  numeric,
  returns_cogs   numeric
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
  tra AS (
    -- (mig 192) Hàng trả theo ngày trừ doanh số — cùng luật với công nợ.
    SELECT COALESCE(SUM(COALESCE(credit_note_amount, 0)), 0) AS value
    FROM returns
    WHERE org_id = public.user_org_id()
      AND revenue_date >= p_from
      AND revenue_date <= p_to
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
  tra_von AS (
    -- (mig 192) Giá vốn hàng khách trả đã NHẬP LẠI KHO (phiếu nhập của phiếu trả
    --   đang hoàn thành; phiếu đã đảo mang đuôi "(đã đảo)" nên không khớp).
    SELECT COALESCE(SUM(
             ABS(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor_snapshot, 1)))
             * COALESCE(l.unit_cost, 0)
           ), 0) AS cogs
    FROM stock_entry_lines l
    JOIN stock_entries e ON e.id = l.entry_id
    JOIN returns r ON e.notes = 'Nhập lại từ phiếu trả ' || r.id::text AND r.status = 'completed'
    WHERE e.org_id = public.user_org_id()
      AND e.type = 'import'
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
    rev.revenue - tra.value,
    rev.order_count,
    cogs.cogs - tra_von.cogs,
    COALESCE((SELECT amt FROM exp WHERE bucket = 'cogs'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'operating'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'hr'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'financial'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'tax'), 0),
    COALESCE((SELECT amt FROM exp WHERE bucket = 'other'), 0),
    COALESCE((SELECT SUM(amt) FROM exp), 0),
    rev.revenue,
    tra.value,
    tra_von.cogs
  FROM rev, tra, cogs, tra_von;
$fn$;

GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;

-- 4. Lương: hàng trả trừ doanh số NV theo cùng luật ------------------------
CREATE OR REPLACE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  LEFT JOIN sales_invoices si ON si.id = r.invoice_id
  WHERE r.org_id = p_org
    -- (mig 192) Ngày trừ doanh số: phiếu tự sinh theo ngày hóa đơn (kể cả khi còn
    --   Chờ xử lý — công nợ đã trừ), phiếu tự lập theo ngày hoàn thành.
    AND r.revenue_date BETWEEN p_start AND p_end
    -- Phiếu gắn vào đơn NHÁP / ĐÃ HUỶ thì không trừ: đơn đó chưa từng được
    -- cộng vào doanh số gộp nên trừ credit của nó là phạt hai lần (mig 096).
    AND (r.order_id IS NULL OR r.invoice_id IS NOT NULL OR public.is_revenue_status(o.status))
    AND COALESCE(
          -- (mig 192) Người đứng tên phiếu trả (mig 160) trước, rồi NV của hóa đơn.
          r.sales_user_id,
          si.sales_user_id,
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= r.revenue_date
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'Doanh số thuần = hàng đi − hàng trả' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_returns_revenue_date')
                 AND position('revenue_date' IN pg_get_functiondef('public.dashboard_summary(date)'::regprocedure)) > 0
                 AND position('returns_cogs' IN pg_get_functiondef('public.finance_pnl(date, date)'::regprocedure)) > 0
                 AND position('revenue_date' IN pg_get_functiondef('public.payroll_returns_for(uuid, uuid, date, date)'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM returns WHERE revenue_date IS NOT NULL) AS phieu_tra_tru_doanh_so,
       (SELECT COALESCE(sum(credit_note_amount), 0) FROM returns
         WHERE revenue_date IS NOT NULL AND credit_with_invoice AND status = 'submitted') AS tien_tra_tu_sinh_cho_xu_ly_nay_da_tru;
