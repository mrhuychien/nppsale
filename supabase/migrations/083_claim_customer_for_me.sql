-- ====================================================================
-- 083_claim_customer_for_me
--
-- Cho phép NV sales tự thêm 1 KH vào danh sách phụ trách (qua bảng
-- customer_assignments). RLS hiện tại chỉ owner/manager được INSERT
-- assignments → cần RPC SECURITY DEFINER.
--
-- Logic role mới:
--   - KH chưa có primary nào → claim với role='primary'
--   - KH đã có primary của NV khác → claim với role='secondary'
--   - User đã có assignment active rồi → no-op
-- ====================================================================

CREATE OR REPLACE FUNCTION public.claim_customer_for_me(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.user_org_id();
  v_role text := public.user_role();
  v_uid uuid := (SELECT auth.uid());
  v_has_primary boolean;
  v_new_role text;
BEGIN
  IF v_role <> 'sales' THEN
    RAISE EXCEPTION 'Chỉ vai trò sales mới được tự thêm khách hàng vào danh sách của mình';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'Khách hàng không tồn tại trong tổ chức';
  END IF;

  IF EXISTS (
    SELECT 1 FROM customer_assignments
    WHERE customer_id = p_customer_id AND user_id = v_uid AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('status', 'already_assigned');
  END IF;

  v_has_primary := EXISTS (
    SELECT 1 FROM customer_assignments
    WHERE customer_id = p_customer_id AND role = 'primary' AND status = 'active'
  );
  v_new_role := CASE WHEN v_has_primary THEN 'secondary' ELSE 'primary' END;

  INSERT INTO customer_assignments (customer_id, user_id, role, status, assigned_at)
  VALUES (p_customer_id, v_uid, v_new_role, 'active', CURRENT_DATE);

  RETURN jsonb_build_object('status', 'claimed', 'role', v_new_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_customer_for_me(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_customer_for_me(uuid) IS
  'NV sales tự thêm 1 KH vào danh sách của mình. Auto chọn role primary/secondary.';
