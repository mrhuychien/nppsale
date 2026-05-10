-- ====================================================================
-- Lương tính không cần chấm công (per user feedback).
--
-- Trước: compute_payroll_run prorate base_salary theo số ngày công
-- thực tế trong hr_attendance:
--   prorated = base / std_days * actual_days
-- Sau: bỏ phần proration, lấy nguyên base_salary cho mọi NV active
-- trong kỳ. Cột actual_workdays vẫn ghi để audit nhưng không ảnh
-- hưởng lương.
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

  SELECT
    COALESCE(MAX(base_salary), 0)::numeric AS base,
    COALESCE(MAX(working_days_per_month), 26)::numeric AS std
  INTO v_base_salary, v_std_days
  FROM hr_salary_config
  WHERE org_id = v_org
    AND COALESCE(is_active, true) = true;

  FOR u IN
    SELECT id, full_name, role
    FROM users
    WHERE org_id = v_org
      AND COALESCE(is_active, true) = true
  LOOP
    -- Vẫn đếm số ngày công thực tế để audit (hiển thị trong payroll
    -- breakdown), nhưng KHÔNG dùng để prorate lương cơ bản.
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    -- Lương cơ bản FULL — không prorate theo chấm công.
    v_prorated := v_base_salary;

    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    v_kpi := 0;
    SELECT min_revenue, bonus_type, bonus_value
      INTO v_kpi_tier
    FROM salary_kpi_tiers
    WHERE user_id = u.id AND month = v_month
      AND min_revenue <= v_revenue
    ORDER BY min_revenue DESC
    LIMIT 1;
    IF FOUND THEN
      IF v_kpi_tier.bonus_type = 'percent' THEN
        v_kpi := round(v_revenue * v_kpi_tier.bonus_value / 100, 0);
      ELSE
        v_kpi := v_kpi_tier.bonus_value;
      END IF;
    END IF;

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
        'kpi_tier_min_revenue', COALESCE(v_kpi_tier.min_revenue, 0),
        'kpi_bonus_type', v_kpi_tier.bonus_type,
        'kpi_bonus_value', v_kpi_tier.bonus_value,
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
