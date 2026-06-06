-- ====================================================================
-- 082_search_customer_dupes
--
-- RPC tìm KH trùng theo SĐT/địa chỉ/tên, scope toàn org (bypass RLS).
-- Sales role hiện chỉ thấy KH được gán → tìm trùng sẽ trả 0 → NV
-- tạo trùng. RPC SECURITY DEFINER trả về basic info đủ để NV nhận diện
-- và biết KH đang do ai phụ trách.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.search_customer_dupes(p_q text)
RETURNS TABLE (
  id uuid,
  store_name text,
  owner_name text,
  phone text,
  address text,
  ward text,
  primary_user_name text,
  has_my_assignment boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.user_org_id();
  v_uid uuid := (SELECT auth.uid());
  v_q text := lower(trim(coalesce(p_q, '')));
BEGIN
  IF v_org IS NULL OR length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.store_name,
    c.owner_name,
    c.phone,
    c.address,
    c.ward,
    u.full_name AS primary_user_name,
    EXISTS (
      SELECT 1 FROM customer_assignments
      WHERE customer_id = c.id AND user_id = v_uid AND status = 'active'
    ) AS has_my_assignment
  FROM customers c
  LEFT JOIN customer_assignments ca
    ON ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
  LEFT JOIN users u ON u.id = ca.user_id
  WHERE c.org_id = v_org
    AND (
      lower(c.phone) LIKE '%' || v_q || '%'
      OR lower(coalesce(c.address, '')) LIKE '%' || v_q || '%'
      OR lower(c.store_name) LIKE '%' || v_q || '%'
      OR lower(c.owner_name) LIKE '%' || v_q || '%'
    )
  ORDER BY
    -- Priority: exact phone → phone partial → address → tên
    CASE
      WHEN lower(c.phone) = v_q THEN 0
      WHEN lower(c.phone) LIKE '%' || v_q || '%' THEN 1
      WHEN lower(coalesce(c.address, '')) LIKE '%' || v_q || '%' THEN 2
      ELSE 3
    END,
    c.store_name
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_customer_dupes(text) TO authenticated;

COMMENT ON FUNCTION public.search_customer_dupes(text) IS
  'Tìm KH trùng toàn org. Sales dùng để check trước khi tạo mới.';
