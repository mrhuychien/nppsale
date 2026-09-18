-- ---------------------------------------------------------------------
-- 121 — Bốn hàm tổng hợp nói dối sau khi workflow v2 mở hai thứ mới:
--       SỐ DƯ CÓ của khách, và hai phương thức thanh toán KHÔNG PHẢI TIỀN
-- ---------------------------------------------------------------------
--
-- ⚠ VÌ SAO LÀ MỘT MIGRATION MỚI CHỨ KHÔNG SỬA 093.
--
-- Lượt trước tôi vá thẳng vào `093_aggregate_functions.sql`. Sai — và sai
-- theo đúng kiểu đắt nhất: KHÔNG AI THẤY.
--   · 093 đã chạy trên production từ lâu. `supabase db push` chỉ chạy
--     migration MỚI, nên bản vá nằm trong 093 không bao giờ tới nơi;
--   · 093 dùng `CREATE FUNCTION` trần (không `OR REPLACE`), nên chạy lại
--     nó trên CSDL có sẵn còn ném "function already exists";
--   · `schema_full.sql` chỉ dùng để CÀI MỚI, nên bản gộp vẫn đúng và
--     nhìn vào đó tưởng đã xong.
-- Kết quả: kho mã nói đã sửa, còn cơ sở dữ liệu thật vẫn tính sai. Đã
-- hoàn 093 về nguyên trạng; toàn bộ phép sửa nằm ở đây.
--
-- ---------------------------------------------------------------------
-- VẤN ĐỀ 1 — SỐ DƯ CÓ BỊ TRỪ THẲNG VÀO CÔNG NỢ (Q11)
--
-- Từ mig 120, `receivables.paid > amount` là HỢP LỆ: khách trả hàng sau
-- khi đã thanh toán đủ thì phần chênh là tiền của họ đang nằm ở nhà phân
-- phối. Hai hàm dưới đây tính `amount - paid` không kẹp:
--   · `receivables_by_rep` KHÔNG lọc `status <> 'paid'`, nên dòng dư lọt
--     vào và kéo tổng công nợ của NVBH XUỐNG — có khi âm. Nhân viên đang
--     phải đòi 10 triệu hiện ra còn 7 triệu, không lỗi nào bắn ra.
--   · `receivables_by_customer` có lọc `status <> 'paid'` nên phần lớn
--     dòng dư bị loại; nhưng dòng dư MỘT PHẦN (`partial`, `paid` vừa
--     vượt `amount` sau khi ghi có) vẫn lọt, và vẫn âm.
-- Kẹp `GREATEST(0, …)` là đúng: không ai muốn thấy "công nợ −400.000".
-- Phần bị kẹp được nói ra ở giao diện (`src/lib/receivables/credit.ts`),
-- không nuốt trong im lặng.
--
-- Tỉ lệ thu hồi cũng vượt 100% vì cùng lý do → kẹp trần 100.
--
-- ---------------------------------------------------------------------
-- VẤN ĐỀ 2 — BÁO CÁO DÒNG TIỀN ĐẾM CẢ TIỀN KHÔNG VÀO KÉT (Q13)
--
-- `finance_balance_sheet.cash_in` và `finance_cash_flow.cash_from_customers`
-- cộng THẲNG `payments.amount`, không hỏi `method`. Khi bảng đó chỉ có
-- tiền mặt / chuyển khoản / ví thì đúng. Workflow v2 thêm hai phương
-- thức KHÔNG phải tiền:
--   · `'return_credit'` (mig 120) — cấn trừ phiếu trả độc lập vào công
--     nợ. Một dòng DƯƠNG, KHÔNG có dòng đối ứng. Đây là chỗ sai thật:
--     mỗi đồng hàng trả được cấn trừ đều hiện ra như một đồng tiền mặt
--     thu được. Tiền mặt trên bảng cân đối CAO HƠN két thật.
--   · `'credit_applied'` (Q11) — rút số dư có, ghi HAI VẾ (âm ở khoản
--     đang dư, dương ở khoản được thu) nên tự triệt tiêu trong một tổng.
--     Hôm nay nó vô hại, nhưng chỉ vì hai vế cùng `collected_at`. Lọc nó
--     ra để con số không phụ thuộc vào một bất biến mà không ai nhớ.
--
-- ⚠ LỌC THEO DANH SÁCH LOẠI TRỪ, KHÔNG PHẢI DANH SÁCH CHO PHÉP.
--   `method NOT IN ('return_credit','credit_applied')` giữ nguyên hành vi
--   cho mọi phương thức tiền thật đang có VÀ mọi phương thức tiền thật
--   thêm sau này. Nếu viết `method IN ('cash','transfer','wallet')` thì
--   người thêm 'momo' vào tháng sau sẽ thấy doanh thu tiền mặt hụt đi mà
--   không hiểu vì sao — và sẽ đi tìm ở chỗ khác.
--   `COALESCE(method,'')` vì cột cho phép NULL: `NULL NOT IN (…)` ra NULL
--   chứ không ra true, và dòng đó sẽ bị loại oan.
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- 1. receivables_by_rep — kẹp phần dư, kẹp trần tỉ lệ thu hồi.
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
      -- ⚠ Q11 — KẸP VỀ 0. Hàm này không lọc `status <> 'paid'` nên dòng
      --   trả dư lọt vào; không kẹp thì số dư có bị TRỪ THẲNG vào công
      --   nợ của nhân viên.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
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
    -- ⚠ Q11 — KẸP TRẦN 100%. Dòng dư có `paid > amount` nên tỉ lệ thu
    --   được vượt 100 và người đọc tưởng số liệu hỏng.
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer)
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
-- 2. receivables_by_customer — kẹp phần dư.
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
      -- ⚠ Q11 — KẸP VỀ 0. Bộ lọc `status <> 'paid'` bên dưới loại phần
      --   lớn dòng dư, nhưng dòng `partial` vừa bị ghi có vượt lên vẫn
      --   lọt, và vẫn cho hiệu âm.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
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
-- 3. finance_balance_sheet — `cash_in` chỉ đếm TIỀN THẬT.
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
      -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT. Xem đầu tệp.
      AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
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
-- 4. finance_cash_flow — `cash_from_customers` chỉ đếm TIỀN THẬT.
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
        -- ⚠ Q13 — CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT. Xem đầu tệp.
        AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')
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
-- Phân quyền — `DROP FUNCTION` xoá luôn GRANT cũ, phải cấp lại.
--
-- ⚠ QUÊN KHỐI NÀY LÀ BỐN MÀN BÁO CÁO TRẮNG XOÁ với lỗi "permission
--   denied for function", trong khi migration chạy xong không báo gì.
-- --------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_customer()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_balance_sheet(date)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm phần dữ liệu mà bản vá này đụng tới. Không sửa gì — chỉ nói ra,
-- để chủ NPP biết con số trên báo cáo sắp đổi bao nhiêu và vì sao.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_over  int;
  v_sum   numeric;
  v_ncash int;
  v_nsum  numeric;
BEGIN
  SELECT count(*), COALESCE(sum(COALESCE(paid,0) - COALESCE(amount,0)), 0)
    INTO v_over, v_sum
  FROM receivables
  WHERE COALESCE(paid, 0) > COALESCE(amount, 0);

  SELECT count(*), COALESCE(sum(COALESCE(amount, 0)), 0)
    INTO v_ncash, v_nsum
  FROM payments
  WHERE COALESCE(method, '') IN ('return_credit', 'credit_applied');

  RAISE NOTICE '--- 121: % dòng công nợ đang DƯ, tổng số dư có %đ — trước bản vá phần này bị trừ thẳng vào công nợ ---', v_over, v_sum;
  RAISE NOTICE '--- 121: % dòng payments KHÔNG phải tiền mặt, tổng %đ — trước bản vá phần này bị đếm là tiền vào két ---', v_ncash, v_nsum;
  IF v_ncash > 0 THEN
    RAISE NOTICE '--- 121 ⚠ Tiền mặt trên bảng cân đối sẽ GIẢM %đ sau khi chạy. Đó là sửa đúng, không phải mất tiền. ---', v_nsum;
  END IF;
END $$;
