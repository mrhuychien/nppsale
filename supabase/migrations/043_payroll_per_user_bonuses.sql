-- ====================================================================
-- T-15: Per-user salary KPI tiers + order-count bonus + activity bonus
--
-- Mig 031 đã có per-org bonus jsonb columns trên hr_monthly_bonus
-- (tiers / per_unit_bonuses / order_milestone_tiers / kpi_metrics).
-- Pack3 thêm 3 tables PER-USER cho overrides chi tiết hơn.
-- ====================================================================

-- ---------------------------------------------------------------------
-- 1. KPI tiers theo tháng (bậc thang doanh số per-user)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_kpi_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  min_revenue numeric(18, 2) NOT NULL,
  bonus_type text NOT NULL CHECK (bonus_type IN ('percent', 'fixed')),
  bonus_value numeric(18, 2) NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_user_month ON salary_kpi_tiers(user_id, month);
CREATE INDEX IF NOT EXISTS idx_kpi_org_month ON salary_kpi_tiers(org_id, month);

ALTER TABLE salary_kpi_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_kpi_select ON salary_kpi_tiers
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_kpi_write ON salary_kpi_tiers
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON salary_kpi_tiers TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Order-count bonus configs (D9: thưởng theo số đơn pass cả 2
--    ngưỡng count + value trong period)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_order_count_bonus_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('week', 'month')),
  min_order_count int NOT NULL,
  min_order_value numeric(18, 2) NOT NULL,
  bonus_per_order numeric(18, 2) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocbc_user_eff
  ON salary_order_count_bonus_configs(user_id, effective_from, effective_to);

ALTER TABLE salary_order_count_bonus_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_ocbc_select ON salary_order_count_bonus_configs
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_ocbc_write ON salary_order_count_bonus_configs
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON salary_order_count_bonus_configs TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Activity bonus per tháng (kế toán nhập tay, không rule-based — D11)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_activity_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric(18, 2) NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_mab_org_month
  ON monthly_activity_bonuses(org_id, month);

ALTER TABLE monthly_activity_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_mab_select ON monthly_activity_bonuses
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'accountant', 'manager')
      OR user_id = auth.uid()
    )
  );
CREATE POLICY org_iso_mab_write ON monthly_activity_bonuses
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_activity_bonuses TO authenticated;
