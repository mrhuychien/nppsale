-- ====================================================================
-- 022_role_permissions
--
-- Detailed role-based access control. Each org can override the static
-- permission matrix per (role, module, action). When a row is missing
-- the client falls back to the built-in DEFAULT_PERMISSION_MAP, so this
-- migration is purely additive — existing orgs keep working unchanged.
-- ====================================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','accountant','sales','warehouse','driver')),
  module text NOT NULL CHECK (module IN (
    'orders','customers','inventory','products','commissions',
    'receivables','deliveries','promotions','invoices','returns',
    'reports','settings'
  )),
  action text NOT NULL CHECK (action IN ('read','create','update','delete','approve','export')),
  allowed boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, module, action)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_org_role
  ON role_permissions(org_id, role);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Every org member can read so the client can enforce UI visibility.
DROP POLICY IF EXISTS "role_permissions_select" ON role_permissions;
CREATE POLICY "role_permissions_select" ON role_permissions
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

-- Only owners can mutate the matrix.
DROP POLICY IF EXISTS "role_permissions_owner_write" ON role_permissions;
CREATE POLICY "role_permissions_owner_write" ON role_permissions
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() = 'owner')
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() = 'owner');

-- Auto-bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.touch_role_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_permissions_touch ON role_permissions;
CREATE TRIGGER trg_role_permissions_touch
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_role_permissions_updated_at();

COMMENT ON TABLE role_permissions IS
  'Per-org overrides for the role-based permission matrix. Missing rows fall back to DEFAULT_PERMISSION_MAP in src/lib/permissions.ts.';
