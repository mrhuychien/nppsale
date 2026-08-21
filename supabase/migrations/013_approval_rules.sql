-- =====================================================================
-- Migration 013: Auto-approval rules for sales orders
-- =====================================================================
-- Replaces the hardcoded APPROVAL_THRESHOLDS constants with org-scoped
-- configurable rules that factor in: order value, customer debt,
-- customer overdue debt, sales rep portfolio debt.
-- Adds approval_reason to sales_orders so pending orders can surface
-- WHY they were not auto-approved.

CREATE TABLE IF NOT EXISTS approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Auto-approve when order total is strictly less than this
  auto_approve_max numeric NOT NULL DEFAULT 20000000,

  -- Manager role can approve up to this amount (orders above need owner)
  manager_approve_max numeric NOT NULL DEFAULT 50000000,

  -- Block auto-approve if outstanding debt of this customer exceeds this
  -- (0 = disabled)
  customer_debt_max numeric NOT NULL DEFAULT 0,

  -- Block auto-approve if overdue debt of this customer exceeds this
  -- (0 = disabled)
  customer_overdue_max numeric NOT NULL DEFAULT 0,

  -- Block auto-approve if the sales rep's managed portfolio debt exceeds this
  -- (0 = disabled)
  rep_portfolio_debt_max numeric NOT NULL DEFAULT 0,

  -- If customer's credit_limit > 0 and current debt + this order would exceed
  -- it, require approval. Always on when credit_limit is set.
  enforce_credit_limit boolean NOT NULL DEFAULT true,

  -- Freeform note visible in settings UI
  notes text,

  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One active rule set per org
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_rules_org ON approval_rules(org_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION approval_rules_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_rules_touch ON approval_rules;
CREATE TRIGGER trg_approval_rules_touch
  BEFORE UPDATE ON approval_rules
  FOR EACH ROW EXECUTE FUNCTION approval_rules_touch();

-- RLS: only owner/manager can read/write rules
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approval_rules_select" ON approval_rules;
CREATE POLICY "approval_rules_select" ON approval_rules
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

DROP POLICY IF EXISTS "approval_rules_insert" ON approval_rules;
CREATE POLICY "approval_rules_insert" ON approval_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "approval_rules_update" ON approval_rules;
CREATE POLICY "approval_rules_update" ON approval_rules
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE ON approval_rules TO authenticated;

-- Seed a default rule row for every existing organization
INSERT INTO approval_rules (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;

-- =====================================================================
-- sales_orders: approval_reason
-- =====================================================================
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS approval_reason text;

COMMENT ON COLUMN sales_orders.approval_reason IS
  'Why this order is pending manual approval (e.g. value exceeds threshold, customer debt over limit).';
