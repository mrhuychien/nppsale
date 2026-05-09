-- ====================================================================
-- T-16: Bảng lương — payroll_runs + payroll_run_items
--
-- Header (payroll_runs) = one (org, month) period; items = per-user
-- breakdown. Sits alongside the existing legacy hr_payroll table — the
-- Pack3 flow stores the canonical breakdown here and uses the existing
-- hr_payroll row only for display compatibility with the legacy
-- /hr/payroll page.
--
-- Compute pulls from:
--   - hr_attendance / hr_salary_config (existing)
--   - salary_kpi_tiers              (T-15 mig 043)
--   - salary_order_count_bonus_configs (T-15 mig 043)
--   - monthly_activity_bonuses       (T-15 mig 043)
--   - sales_orders                   (revenue per user per month)
-- ====================================================================

CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  /* First day of the period (yyyy-mm-01 by convention). */
  month date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'locked')),
  computed_at timestamptz,
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  UNIQUE (org_id, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_status
  ON payroll_runs (org_id, status, month DESC);

CREATE TABLE IF NOT EXISTS payroll_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  base_salary numeric(18, 2) NOT NULL DEFAULT 0,
  standard_workdays numeric(6, 2) NOT NULL DEFAULT 0,
  actual_workdays numeric(6, 2) NOT NULL DEFAULT 0,
  prorated_base numeric(18, 2) NOT NULL DEFAULT 0,
  kpi_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  order_count_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  activity_bonus numeric(18, 2) NOT NULL DEFAULT 0,
  overtime numeric(18, 2) NOT NULL DEFAULT 0,
  deductions numeric(18, 2) NOT NULL DEFAULT 0,
  social_insurance numeric(18, 2) NOT NULL DEFAULT 0,
  manual_adjustment numeric(18, 2) NOT NULL DEFAULT 0,
  net_salary numeric(18, 2) NOT NULL DEFAULT 0,
  notes text,
  computed_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_user
  ON payroll_run_items (user_id);

ALTER TABLE payroll_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_pr ON payroll_runs
  USING (org_id = public.user_org_id()
         AND public.user_role() IN ('owner','manager'))
  WITH CHECK (org_id = public.user_org_id()
              AND public.user_role() IN ('owner','manager'));

CREATE POLICY org_iso_pri ON payroll_run_items
  USING (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner','manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM payroll_runs pr
    WHERE pr.id = payroll_run_id
      AND pr.org_id = public.user_org_id()
      AND public.user_role() IN ('owner','manager')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_items TO authenticated;

-- --------------------------------------------------------------------
-- compute_payroll_run — recompute all items for a run from current
-- attendance / KPI tiers / order-count config / activity bonuses /
-- monthly revenue. Idempotent: deletes existing items first.
-- Cannot run on a locked run.
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

  -- Wipe & recompute.
  DELETE FROM payroll_run_items WHERE payroll_run_id = p_run_id;

  -- hr_salary_config is org-scoped (one active row per org). Pull
  -- base_salary + working_days_per_month once per run.
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
    -- Actual days from per-user attendance rows in the period.
    SELECT
      COUNT(*) FILTER (WHERE status IN ('present','holiday'))::numeric
      + 0.5 * COUNT(*) FILTER (WHERE status = 'half_day')::numeric
    INTO v_act_days
    FROM hr_attendance
    WHERE user_id = u.id
      AND work_date BETWEEN v_period_start AND v_period_end;
    v_act_days := COALESCE(v_act_days, 0);

    IF v_std_days > 0 THEN
      v_prorated := round((v_base_salary / v_std_days) * v_act_days, 0);
    ELSE
      v_prorated := 0;
    END IF;

    -- Monthly revenue (paid + delivered orders within period).
    SELECT COALESCE(SUM(total), 0) INTO v_revenue
    FROM sales_orders
    WHERE sales_user_id = u.id
      AND status IN ('delivered','confirmed')
      AND order_date BETWEEN v_period_start AND v_period_end;

    -- KPI tier — pick highest tier whose min_revenue is met.
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

    -- Order-count bonus — apply latest config that overlaps this month.
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

    -- Activity bonus (manual entry per user/month).
    SELECT COALESCE(SUM(amount), 0) INTO v_activity
    FROM monthly_activity_bonuses
    WHERE user_id = u.id AND month = v_month;

    -- Social insurance — flat 10.5% of base salary (BHXH 8 + BHYT 1.5 + BHTN 1).
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
        'oc_bonus_per_order', COALESCE(v_oc_cfg.bonus_per_order, 0)
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

REVOKE EXECUTE ON FUNCTION compute_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_payroll_run(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- lock_payroll_run — final sign-off; once locked, items are read-only.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lock_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_RUN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE payroll_runs
  SET status = 'locked',
      locked_at = now(),
      locked_by = auth.uid()
  WHERE id = p_run_id
    AND status = 'draft';
END;
$$;

REVOKE EXECUTE ON FUNCTION lock_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_payroll_run(uuid) TO authenticated;

-- --------------------------------------------------------------------
-- Trigger: block any UPDATE/DELETE on items once run is locked.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payroll_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_run uuid;
BEGIN
  v_run := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  SELECT status INTO v_status FROM payroll_runs WHERE id = v_run;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payroll_lock ON payroll_run_items;
CREATE TRIGGER trg_enforce_payroll_lock
  BEFORE UPDATE OR DELETE ON payroll_run_items
  FOR EACH ROW EXECUTE FUNCTION enforce_payroll_lock();
