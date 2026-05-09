-- ====================================================================
-- Bugfix: user_has_permission() resolver in mig 041 referenced
-- role_permissions.permission_key but the table (mig 022) only has
-- (role, module, action) columns. The original lookup raised
-- "column rp.permission_key does not exist" whenever the override
-- table didn't have an entry — so every fallback to role defaults
-- failed at runtime.
--
-- Rewrite to:
--   1. Override table wins exactly as before.
--   2. Fall back to role_permissions only when the requested key has
--      the shape "<module>.<action>" — split it back into the two
--      columns and check `allowed=true`.
--   3. Spec-flat keys ("customer.view_all", "warehouse.handover", …)
--      have no role_permissions row by design; for those, only the
--      override grants. Default = false.
-- Owner role still implicitly true (mig 041 already does that).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_perm text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_override   boolean;
  v_role       text;
  v_module     text;
  v_action     text;
  v_dot        int;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Owner is always allowed (matches DEFAULT_PERMISSION_MAP).
  SELECT u.role INTO v_role FROM users u WHERE u.id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- 3. role_permissions fallback only when the key looks like
  --    "module.action" with EXACTLY one dot. Split + lookup.
  v_dot := position('.' IN p_perm);
  IF v_dot > 0 AND position('.' IN substring(p_perm FROM v_dot + 1)) = 0 THEN
    v_module := substring(p_perm FROM 1 FOR v_dot - 1);
    v_action := substring(p_perm FROM v_dot + 1);

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'role_permissions'
    ) THEN
      RETURN COALESCE(
        (SELECT allowed FROM role_permissions rp
          WHERE rp.role = v_role
            AND rp.module = v_module
            AND rp.action = v_action
          LIMIT 1),
        false
      );
    END IF;
  END IF;

  -- Spec-flat keys ("customer.view_all", "warehouse.handover", …)
  -- have no role default — only override grants.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS
  'Resolver — override > role_permissions[module,action] > false. Spec-flat keys without a "." or with multiple dots are override-only.';

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;
