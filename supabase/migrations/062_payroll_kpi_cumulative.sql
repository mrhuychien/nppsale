-- ====================================================================
-- Payroll: thưởng KPI tính CỘNG DỒN theo % của doanh số chung A
-- (hr_salary_config.kpi_target_revenue + target_tiers).
--
-- Mô hình mới (per user feedback):
--   pct = doanh_số_NV / A * 100
--   kpi_bonus = SUM(bonus) của mọi bậc có min_percent <= pct
--   → Đạt 70%A: +x1. Đạt 80%A: +x1+x2. Đạt 90%A: +x1+x2+x3. v.v.
--
-- Per-user salary_kpi_tiers (mig 043) vẫn còn để override nếu org
-- muốn cấu hình riêng cho 1 NV — khi NV có dòng tiers riêng cho
-- tháng đó thì dùng dòng đó (model cũ: pick bậc cao nhất). Mặc định
-- (không có dòng riêng) → dùng org config cộng dồn.
-- ====================================================================

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
  v_std_days numeric;
  v_act_days numeric;
  v_prorated numeric;
  v_kpi      numeric;
  v_kpi_tier record;
  v_kpi_per_user bool;
  v_kpi_target numeric;
  v_kpi_tiers  jsonb;
  v_kpi_pct    numeric;
  v_oc_cfg   record;
  v_oc_count int;
  v_oc_bonus numeric;
  v_activity numeric;
  v_si       numeric;
  v_net      numeric;
  v_count    int := 0;
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

  v_period_start := v_month;
  v_period_end := (v_month + interval '1 month - 1 day')::date;

  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  -- Org-level config: base salary + KPI target A + cumulative tiers.
  SELECT
    COALESCE(MAX(base_salary), 0)::numeric,
    COALESCE(MAX(working_days_per_month), 26)::numeric,
    COALESCE(MAX(kpi_target_revenue), 0)::numeric,
    (SELECT target_tiers FROM hr_salary_config
       WHERE org_id = v_org AND COALESCE(is_active, true) = true
       ORDER BY created_at DESC LIMIT 1)
  INTO v_base_salary, v_std_days, v_kpi_target, v_kpi_tiers
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;
  v_kpi_tiers := COALESCE(v_kpi_tiers, '[]'::jsonb);

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    -- Ngày công thực tế (chỉ để audit, không prorate — mig 060).
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    v_prorated := v_base_salary;

    -- Doanh số NV trong kỳ.
    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    -- KPI bonus.
    v_kpi := 0;
    v_kpi_per_user := false;

    -- 1) Nếu NV có cấu hình tiers riêng cho tháng này → model cũ
    --    (pick bậc cao nhất pass min_revenue).
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
    ELSIF v_kpi_target > 0 THEN
      -- 2) Mặc định: org config cộng dồn theo % của A.
      v_kpi_pct := v_revenue / v_kpi_target * 100;
      SELECT COALESCE(SUM((t->>'bonus')::numeric), 0)
        INTO v_kpi
      FROM jsonb_array_elements(v_kpi_tiers) AS t
      WHERE COALESCE((t->>'min_percent')::numeric, 0) <= v_kpi_pct;
      v_kpi := COALESCE(v_kpi, 0);
    END IF;

    -- Order-count bonus (không đổi).
    v_oc_bonus := 0;
    SELECT min_order_count, min_order_value, bonus_per_order, period
      INTO v_oc_cfg
    FROM salary_order_count_bonus_configs
    WHERE user_id = u.id
      AND effective_from <= v_period_end
      AND (effective_to IS NULL OR effective_to >= v_period_start)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_oc_count
      FROM sales_orders
      WHERE sales_user_id = u.id
        AND status IN ('delivered','confirmed')
        AND order_date BETWEEN v_period_start AND v_period_end
        AND total >= v_oc_cfg.min_order_value;
      IF v_oc_count >= v_oc_cfg.min_order_count THEN
        v_oc_bonus := v_oc_count * v_oc_cfg.bonus_per_order;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    v_si := round(v_base_salary * 0.105, 0);

    v_net := v_prorated + v_kpi + v_oc_bonus + v_activity - v_si;

    INSERT INTO payroll_run_items (
      payroll_run_id, user_id,
      base_salary, standard_workdays, actual_workdays, prorated_base,
      kpi_bonus, order_count_bonus, activity_bonus,
      overtime, deductions, social_insurance,
      manual_adjustment, net_salary,
      computed_breakdown
    ) VALUES (
      p_run_id, u.id,
      v_base_salary, v_std_days, v_act_days, v_prorated,
      v_kpi, v_oc_bonus, v_activity,
      0, 0, v_si,
      0, v_net,
      jsonb_build_object(
        'revenue', v_revenue,
        'kpi_target_revenue', v_kpi_target,
        'kpi_pct', CASE WHEN v_kpi_target > 0 THEN round(v_revenue / v_kpi_target * 100, 1) ELSE NULL END,
        'kpi_model', CASE WHEN v_kpi_per_user THEN 'per_user_tier' ELSE 'org_cumulative' END,
        'oc_count', COALESCE(v_oc_count, 0),
        'oc_min_count', COALESCE(v_oc_cfg.min_order_count, 0),
        'oc_min_value', COALESCE(v_oc_cfg.min_order_value, 0),
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0),
        'attendance_skipped', true
      )
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE payroll_runs
  SET computed_at = now()
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;
