-- =====================================================================
-- Migration 021: Pricing rules (cài đặt giá cho nhân viên)
-- =====================================================================
-- Single row per org. Owner/manager toggles whether sales reps can
-- override the unit price on order/return lines, and how far they can
-- deviate from the default price-list value.
--
-- Sale order:    rep may LOWER price; min = default - max(sale_min_pct, sale_min_value)
-- Return order:  rep may RAISE price; max = default + max(return_max_pct, return_max_value)
--
-- A NULL/0 limit means "no override allowed in that direction" so the
-- default rules are conservative (no override at all).

CREATE TABLE IF NOT EXISTS pricing_rules (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Master switch: when false, sales reps can't edit price at all
  allow_sales_override boolean NOT NULL DEFAULT false,
  -- Sale-order rule: cap the discount the rep can give
  sale_min_pct numeric(5, 2) NOT NULL DEFAULT 0,    -- 0..100, % off default
  sale_min_value numeric(15, 2) NOT NULL DEFAULT 0, -- absolute đ off default
  -- Return-order rule: cap the markup the rep can apply
  return_max_pct numeric(5, 2) NOT NULL DEFAULT 0,    -- 0..100, % above default
  return_max_value numeric(15, 2) NOT NULL DEFAULT 0, -- absolute đ above default
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE OR REPLACE FUNCTION pricing_rules_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pricing_rules_touch ON pricing_rules;
CREATE TRIGGER trg_pricing_rules_touch
  BEFORE UPDATE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION pricing_rules_touch();

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (so the order form can validate input)
CREATE POLICY "pricing_rules_select" ON pricing_rules
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

CREATE POLICY "pricing_rules_insert" ON pricing_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "pricing_rules_update" ON pricing_rules
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE ON pricing_rules TO authenticated;

-- Seed an empty rule for every existing org so the order form's
-- "fetch single row" never returns null.
INSERT INTO pricing_rules (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;
