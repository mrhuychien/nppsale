-- ====================================================================
-- Bugfix: user_has_permission resolver phải split key trên dấu chấm
-- CUỐI để hỗ trợ feature-level keys.
--
-- Mig 022 cho phép role_permissions.module chứa feature key có dot
-- (vd "customers.analytics"). Khi user override với key
-- "customers.analytics.read", mig 054 split trên dot ĐẦU (module=
-- "customers", action="analytics.read") — sai.
--
-- Fix: split trên dot cuối → module="customers.analytics", action="read".
-- Vẫn cover keys 1-dot bình thường (orders.read → orders/read).
-- Spec-flat keys (customer.view_all, warehouse.handover…) không có
-- row trong role_permissions nên fallback trả false — override-only
-- behavior được giữ nguyên.
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
  v_last_dot   int;
BEGIN
  -- 1. Explicit override wins.
  SELECT granted INTO v_override
  FROM user_permission_overrides
  WHERE user_id = p_user_id AND permission_key = p_perm;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  -- 2. Owner is always allowed.
  SELECT u.role INTO v_role FROM users u WHERE u.id = p_user_id;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- 3. role_permissions fallback. Split p_perm trên dot CUỐI để
  --    feature keys như "customers.analytics.read" parse đúng:
  --      module  = "customers.analytics"
  --      action  = "read"
  --    Keys 1-dot vẫn ok (orders.read → "orders" / "read").
  --    Keys không có dot không có fallback (return false).
  v_last_dot := length(p_perm) - position('.' IN reverse(p_perm)) + 1;
  IF v_last_dot > 1 AND v_last_dot < length(p_perm) THEN
    v_module := substring(p_perm FROM 1 FOR v_last_dot - 1);
    v_action := substring(p_perm FROM v_last_dot + 1);

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

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_has_permission(uuid, text) IS
  'Resolver — override > role_permissions[<feature_or_module>, <action>] > false. Split trên dot cuối để feature keys (customers.analytics.read) parse đúng.';

REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;
