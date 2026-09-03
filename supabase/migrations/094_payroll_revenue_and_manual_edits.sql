-- ====================================================================
-- 094 — Sửa 5 lỗi bảng lương & doanh thu chạm trực tiếp vào tiền
--
-- Tất cả đều đã được đọc mã và tái hiện, không phải suy đoán. Mỗi mục
-- ghi rõ bằng chứng để người sau kiểm lại được.
--
--  1. DOANH SỐ BỎ SÓT ĐƠN ĐANG GIAO (067:112)
--     Bộ lọc cũ: status IN ('delivered','confirmed').
--     Nhưng vòng đời đơn có 6 trạng thái (001_schema.sql:167) và
--     'picking' / 'delivering' nằm ĐÚNG GIỮA 'confirmed' và 'delivered'
--     (stock-out/page.tsx:703 đặt 'picking'; entries/[id]/page.tsx:300
--     đặt 'delivering'). Nghĩa là mọi đơn đều PHẢI đi qua hai trạng thái
--     bị bỏ sót đó.
--     Hậu quả: đơn được tính khi mới chốt, BIẾN MẤT lúc kho soạn hàng,
--     rồi hiện lại khi giao xong. Cùng một tháng, bấm "Tính lại" ở hai
--     thời điểm khác nhau ra hai bảng lương khác nhau — và vì lương có
--     ngưỡng 60%/70%, một nhân viên đủ chỉ tiêu có thể rơi xuống nhánh
--     phạt chỉ vì hàng đang trên đường giao.
--     Sửa: doanh số = đơn đã chốt và chưa huỷ.
--
--  2. CẤU HÌNH THƯỞNG THEO TUẦN BỊ BỎ QUA (067:181)
--     `period` được SELECT vào v_oc_cfg rồi KHÔNG đọc lại lần nào
--     (grep v_oc_cfg trong 067: chỉ dùng min_order_count, min_order_value,
--     bonus_per_order). Cột này NOT NULL CHECK IN ('week','month')
--     (043:47) và "Tuần" là lựa chọn thật trên giao diện
--     (settings/users/[id]/salary/page.tsx:477).
--     Hậu quả: chọn "Tuần" thì ngưỡng số đơn được đem so với số đơn CẢ
--     THÁNG, rồi nhân thưởng cho toàn bộ đơn trong tháng — trả thừa
--     khoảng 4,3 lần, im lặng.
--     Sửa: gom đơn theo tuần, mỗi tuần xét ngưỡng riêng.
--
--  3. "TÍNH LẠI" XOÁ TRẮNG SỐ KẾ TOÁN ĐÃ SỬA TAY (067:73)
--     `DELETE FROM payroll_run_items` rồi INSERT lại với
--     manual_adjustment = 0, deductions = 0, notes = NULL.
--     Hậu quả: kế toán trừ tạm ứng 2 triệu, ai đó bấm "Tính lại" —
--     khoản trừ biến mất, thực lĩnh vọt lên đúng 2 triệu, không cảnh báo,
--     không phục hồi được.
--     Sửa: đổi sang UPSERT, chỉ ghi đè các cột do MÁY tính; giữ nguyên
--     manual_adjustment / deductions / overtime / notes.
--
--  4. AI CŨNG GỌI ĐƯỢC HÀM TÍNH LƯƠNG (050:265)
--     compute_payroll_run và lock_payroll_run là SECURITY DEFINER,
--     GRANT cho `authenticated`, và bên trong chỉ kiểm org + trạng thái
--     khoá — KHÔNG kiểm vai trò.
--     Hậu quả: một tài khoản bán hàng hoặc lái xe gọi thẳng RPC là tính
--     lại (hoặc khoá cứng) bảng lương của cả công ty.
--     Sửa: chỉ owner / manager / accountant.
--
--  5. DOANH THU TRÊN TRANG TỔNG QUAN TÍNH CẢ ĐƠN NHÁP VÀ ĐƠN ĐÃ HUỶ
--     (093:536, :579, :606 — ba hàm dashboard không có mệnh đề status
--     nào). Mã chạy trước 093 cũng vậy nên đây là lỗi có sẵn được bê
--     nguyên vào SQL, không phải lỗi mới; nhưng giờ nó nằm ở một chỗ
--     nên sửa một lần là xong.
--     Hậu quả: huỷ một đơn 50 triệu, doanh thu trên trang chủ không đổi.
--     Sửa: dùng cùng một định nghĩa doanh thu với bảng lương.
--
-- CÒN LẠI, CỐ Ý KHÔNG SỬA Ở ĐÂY (cần chủ NPP quyết, không phải lỗi kỹ thuật):
--   • Doanh số tính lương đang là doanh số GỘP — hàng trả lại không bị
--     trừ, trong khi báo cáo nhân viên thì có trừ. Hai màn hình cùng
--     ghi "doanh số của NV X" ra hai số khác nhau. Trả lương trên gộp
--     hay trên thuần là chính sách, không phải bug — nêu ra để chốt.
-- ====================================================================


-- --------------------------------------------------------------------
-- Định nghĩa doanh thu dùng chung: đơn đã chốt và chưa huỷ.
-- Đặt thành hàm để bốn chỗ đang đếm doanh thu không trôi khỏi nhau nữa.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_revenue_status(text);
CREATE FUNCTION public.is_revenue_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_status, '') NOT IN ('draft', 'cancelled');
$$;

COMMENT ON FUNCTION public.is_revenue_status(text) IS
  'Đơn có được tính vào doanh thu không. Đã chốt và chưa huỷ = có. '
  'Bao gồm picking/delivering: hàng đã xuất kho, đang trên đường giao, '
  'không thể biến mất khỏi doanh số chỉ vì chưa bấm nút giao xong.';


-- --------------------------------------------------------------------
-- 1+2+3+4. compute_payroll_run
--
-- Thân hàm dưới đây là BẢN 067 NGUYÊN VĂN, chỉ vá đúng 4 chỗ đánh dấu
-- [1] [2] [3] [4]. Cố ý không gõ lại từ đầu: lần thử đầu tiên tôi chép
-- tay phần thưởng KPI và đã đặt nhầm công thức (lấy 'bonus_percent' ×
-- lương CB trong khi 067 dùng trường 'bonus' là số tiền tuyệt đối), sai
-- luôn tên cột cấu hình ngày công. Với hàm tính tiền thì chép tay là
-- cách chắc chắn nhất để tạo ra một lỗi mới trong lúc sửa lỗi cũ.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_payroll_run(p_run_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_month    date;
  v_status   text;
  v_period_start date;
  v_period_end   date;
  u          record;
  v_revenue  numeric;
  v_base_salary numeric;
  v_gas      numeric;
  v_phone    numeric;
  v_allowances numeric;
  v_emp_gas   numeric;
  v_emp_phone numeric;
  v_emp_allowances numeric;
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_partial numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_kpi_breakdown jsonb;
  v_over_pct   numeric;
  v_under_60_pct numeric;
  v_low_perf   text;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
  v_role     text;
  v_oc_paid  int;
  v_touched  uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT org_id, month, status INTO v_org, v_month, v_status
  FROM payroll_runs WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Hàm là SECURITY DEFINER + GRANT cho `authenticated`, mà trước đây
  --     chỉ kiểm org và trạng thái khoá. Không chặn ở đây thì một tài
  --     khoản bán hàng hoặc lái xe gọi thẳng RPC là tính lại được bảng
  --     lương của cả công ty.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  -- [3] KHÔNG xoá dòng lương ở đây nữa. Bước DELETE + INSERT cũ thổi
  --     bay cả manual_adjustment, deductions và notes do kế toán nhập
  --     tay. Thay bằng UPSERT ở cuối vòng lặp, rồi dọn dòng thừa sau.

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(gas_allowance), 0)::numeric,
    COALESCE(MAX(phone_allowance), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1),
    COALESCE(MAX(over_target_percent), 0)::numeric,
    COALESCE(MAX(under_60_percent), 0)::numeric
  INTO v_base_salary, v_gas, v_phone, v_std_days, v_kpi_target, v_kpi_tiers, v_over_pct, v_under_60_pct
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);
  v_allowances := v_gas + v_phone;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
      AND role = 'sales'   -- tạm thời chỉ tính lương NV bán hàng
  LOOP
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND public.is_revenue_status(status)
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_prorated := v_base_salary;   -- lương CB (mig 060: không prorate chấm công)
    v_emp_gas := v_gas;
    v_emp_phone := v_phone;
    v_emp_allowances := v_allowances;
    v_kpi := 0;
    v_kpi_per_user := false;
    v_kpi_pct := NULL;
    v_low_perf := 'normal';
    v_kpi_breakdown := '[]'::jsonb;

    -- 1) Per-user override (model cũ).
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      v_kpi_per_user := true;
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;

    -- 2) Org config theo mức doanh số chung A + cộng dồn.
    ELSIF v_kpi_target > 0 THEN
      v_kpi_pct := v_revenue / v_kpi_target * 100;

      IF v_kpi_pct < 60 THEN
        -- Dưới 60% A: không hưởng lương cứng → lương = doanh số ×
        -- under_60%; KHÔNG có phụ cấp; không thưởng KPI.
        v_low_perf := 'under_60';
        v_prorated := round(v_revenue * v_under_60_pct / 100, 0);
        v_emp_gas := 0;
        v_emp_phone := 0;
        v_emp_allowances := 0;
        v_kpi := 0;
      ELSIF v_kpi_pct < 70 THEN
        v_low_perf := 'under_70';
        v_kpi := 0;
      ELSE
        SELECT
          COALESCE(SUM(CASE WHEN COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
                            THEN COALESCE((elem->>'bonus')::numeric, 0) ELSE 0 END), 0),
          COALESCE(jsonb_agg(jsonb_build_object(
            'min_percent', COALESCE((elem->>'min_percent')::numeric, 0),
            'bonus', COALESCE((elem->>'bonus')::numeric, 0),
            'label', elem->>'label',
            'passed', COALESCE((elem->>'min_percent')::numeric, 0) <= v_kpi_pct
          ) ORDER BY COALESCE((elem->>'min_percent')::numeric, 0)), '[]'::jsonb)
        INTO v_kpi_partial, v_kpi_breakdown
        FROM jsonb_array_elements(v_kpi_tiers) AS arr(elem);
        v_kpi := COALESCE(v_kpi_partial, 0);

        IF v_kpi_pct > 100 AND v_over_pct > 0 THEN
          v_low_perf := 'over_100';
          v_kpi := v_kpi + round((v_revenue - v_kpi_target) * v_over_pct / 100, 0);
        END IF;
      END IF;
    END IF;

    -- Order-count bonus.
    v_oc_bonus := 0;
    v_oc_count := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    v_oc_paid := 0;
    IF FOUND THEN
      IF v_oc_cfg.period = 'week' THEN
        -- [2] Cấu hình "Tuần" (043:47 CHECK IN ('week','month'), giao diện
        --     settings/users/[id]/salary/page.tsx:477 cho chọn): gom đơn
        --     theo tuần, MỖI TUẦN xét ngưỡng riêng, chỉ tuần nào đạt mới
        --     được thưởng. Trước đây nhánh này không tồn tại — cột period
        --     được SELECT rồi vứt đi — nên ngưỡng tuần bị đem so với số
        --     đơn CẢ THÁNG rồi thưởng cho toàn bộ đơn trong tháng.
        SELECT
          COALESCE(SUM(wk.cnt), 0),
          COALESCE(SUM(wk.cnt) FILTER (WHERE wk.cnt >= v_oc_cfg.min_order_count), 0)
        INTO v_oc_count, v_oc_paid
        FROM (
          SELECT date_trunc('week', order_date) AS w, count(*) AS cnt
          FROM sales_orders
          WHERE sales_user_id = u.id
            AND public.is_revenue_status(status)
            AND order_date BETWEEN v_period_start AND v_period_end
            AND total >= v_oc_cfg.min_order_value
          GROUP BY 1
        ) wk;
      ELSE
        SELECT count(*) INTO v_oc_count
        FROM sales_orders
        WHERE sales_user_id = u.id
          AND public.is_revenue_status(status)
          AND order_date BETWEEN v_period_start AND v_period_end
          AND total >= v_oc_cfg.min_order_value;
        IF v_oc_count >= v_oc_cfg.min_order_count THEN
          v_oc_paid := v_oc_count;
        END IF;
      END IF;
      v_oc_bonus := v_oc_paid * v_oc_cfg.bonus_per_order;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- BHXH 10.5% trên phần lương CB hiệu lực (không trên phụ cấp).
    v_si := round(v_prorated * 0.105, 0);

    v_net := v_prorated + v_emp_allowances + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      allowances, kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_emp_allowances, v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'period_start', v_period_start,
        'period_end', v_period_end,
        'revenue', v_revenue,
        'gas_allowance', v_emp_gas,
        'phone_allowance', v_emp_phone,
        'allowance_dropped', (v_emp_allowances = 0 AND v_allowances > 0),
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'kpi_tier_breakdown', v_kpi_breakdown,
        'low_perf', v_low_perf,
        'over_target_percent', v_over_pct,
        'under_60_percent', v_under_60_pct,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_paid_count', COALESCE(v_oc_paid, 0),
        'oc_period', COALESCE(v_oc_cfg.period, 'month'),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    )
    -- [3] Các cột do NGƯỜI nhập (overtime, deductions, manual_adjustment,
    --     notes) cố ý KHÔNG nằm trong danh sách SET, nên "Tính lại" không
    --     còn xoá được chúng. Công thức net dưới đây khớp với
    --     src/lib/payroll/run.ts:126-134 để hai đường ghi không cho ra hai
    --     con số khác nhau trên cùng một dòng lương.
    ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
      base_salary        = EXCLUDED.base_salary,
      standard_workdays  = EXCLUDED.standard_workdays,
      actual_workdays    = EXCLUDED.actual_workdays,
      prorated_base      = EXCLUDED.prorated_base,
      allowances         = EXCLUDED.allowances,
      kpi_bonus          = EXCLUDED.kpi_bonus,
      order_count_bonus  = EXCLUDED.order_count_bonus,
      activity_bonus     = EXCLUDED.activity_bonus,
      social_insurance   = EXCLUDED.social_insurance,
      computed_breakdown = EXCLUDED.computed_breakdown,
      updated_at         = now(),
      net_salary         = EXCLUDED.prorated_base
                         + EXCLUDED.allowances
                         + EXCLUDED.kpi_bonus
                         + EXCLUDED.order_count_bonus
                         + EXCLUDED.activity_bonus
                         + payroll_run_items.overtime
                         + payroll_run_items.manual_adjustment
                         - payroll_run_items.deductions
                         - EXCLUDED.social_insurance;

    v_touched := v_touched || u.id;
    v_count := v_count + 1;
  END LOOP;

  -- Nhân sự đã nghỉ hoặc đổi vai trò thì bỏ dòng lương đi. Trước đây bước
  -- DELETE ở đầu hàm lo việc này; giờ UPSERT không xoá nên phải dọn ở đây.
  DELETE FROM payroll_run_items
  WHERE payroll_run_id = p_run_id
    AND NOT (user_id = ANY (v_touched));

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_payroll_run(uuid) TO authenticated;


-- --------------------------------------------------------------------
-- 4. lock_payroll_run — cùng lỗ hổng vai trò. Cũng là bản 050 nguyên văn
--    cộng đúng một khối kiểm vai trò.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_role text;
BEGIN
  SELECT org_id INTO v_org FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- [4] Cùng lỗ hổng với compute_payroll_run: SECURITY DEFINER, GRANT cho
  --     `authenticated`, không kiểm vai trò — tài xế cũng khoá cứng được
  --     kỳ lương, và khoá rồi thì không ai sửa lại được nữa.
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE payroll_runs
  SET status = 'locked',
      locked_at = now(),
      locked_by = auth.uid()
  WHERE id = p_run_id
    AND status = 'draft';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run(uuid) TO authenticated;


-- --------------------------------------------------------------------
-- 5. Ba hàm tổng quan: dùng cùng định nghĩa doanh thu với bảng lương.
--    Trước đây không có mệnh đề status nào — huỷ đơn 50 triệu mà doanh
--    thu trang chủ không đổi.
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
      WHERE org_id = public.user_org_id()
        AND order_date >= p_period_start
        AND public.is_revenue_status(status)
    ), 0),
    COALESCE((
      SELECT COUNT(*) FROM sales_orders
      WHERE org_id = public.user_org_id()
        AND order_date >= p_period_start
        AND public.is_revenue_status(status)
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
    AND public.is_revenue_status(o.status)
  GROUP BY o.customer_id, c.store_name
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_top_customers(date, integer) TO authenticated;


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
    AND public.is_revenue_status(o.status)
  GROUP BY COALESCE(NULLIF(c.channel, ''), 'Khác')
  ORDER BY COALESCE(SUM(COALESCE(o.total, 0)), 0) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_channel_revenue(date) TO authenticated;
