-- ====================================================================
-- T-13: Per-user permission overrides
--
-- Existing permission system (mig 022/024) defines a role-based
-- matrix in TS lib/permissions.ts. This adds a per-user override
-- layer: explicit grant/revoke per (user, permission_key) takes
-- precedence over the role default.
--
-- Resolver helper user_has_permission(user_id, perm) consults the
-- override first, then falls back to the role matrix. RLS policies
-- in T-14 use this helper.
-- ====================================================================

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(user_id);

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_iso_upo_select ON user_permission_overrides
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
CREATE POLICY org_iso_upo_write ON user_permission_overrides
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner', 'manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON user_permission_overrides TO authenticated;

-- --------------------------------------------------------------------
-- Resolver: override > role default. Role default lives in
-- role_permissions table from mig 022 (if present); otherwise we
-- return false and let the TS resolver decide.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_override boolean;
  v_role_grant boolean;
  v_user_role text;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Role default from role_permissions (if mig 022 was applied).
  SELECT u.role INTO v_user_role FROM users u WHERE u.id = p_user_id;
  IF v_user_role IS NULL THEN RETURN false; END IF;
  IF v_user_role = 'owner' THEN RETURN true; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'role_permissions')
  THEN
    SELECT EXISTS (
      SELECT 1 FROM role_permissions rp
      WHERE rp.role = v_user_role AND rp.permission_key = p_perm
    ) INTO v_role_grant;
    RETURN COALESCE(v_role_grant, false);
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;
