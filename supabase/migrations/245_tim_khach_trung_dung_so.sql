-- ====================================================================
-- 245 — TÌM KHÁCH ĐÃ CÓ TRƯỚC KHI TẠO: CHỈ KHỚP ĐÚNG SỐ ĐIỆN THOẠI
--
-- VÌ SAO — chủ nhà 15/10/2026: "Tìm kiếm như vậy là sai. ở máy tính tao chỉ cho tìm kiếm chính xác, nghĩa là nhập
--   đúng số điện thoại của khách thì khách mới hiện ra."
--   `search_customer_dupes` (mig 082, viết lại ở mig 205) khớp TỪNG PHẦN theo tên / chủ / SĐT / địa chỉ / phường của
--   CẢ đơn vị, và là SECURITY DEFINER (vượt RLS): NVBH gõ "Lê Lợi" hay "0911" là thấy khách nhân viên khác phụ trách —
--   tên, chủ, số, địa chỉ, người phụ trách chính.
--
-- CÁCH LÀM
--   - Chỉ trả khách có SĐT trùng HẲN số đã nhập: so bằng chữ số ("0911 111 111" = "0911111111"; "+84 911…" = "0911…").
--   - Số chưa đủ (không phải 10–11 chữ số bắt đầu bằng 0) → không trả gì: gõ dở số không lộ khách nào.
--   - Giữ nguyên chữ ký + cột trả về: màn "Tìm khách hàng đã có" (máy tính, điện thoại) và phép kiểm trùng số trước khi
--     ghi khách mới (`timKhachTrungSdt`) cùng gọi hàm này từ trình duyệt.
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
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
  v_uid uuid := (SELECT auth.uid());
  v_so text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
BEGIN
  IF v_so ~ '^84[0-9]{9}$' THEN
    v_so := '0' || substr(v_so, 3);
  END IF;
  IF v_org IS NULL OR v_so !~ '^0[0-9]{9,10}$' THEN
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
  CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') AS d) s
  LEFT JOIN customer_assignments ca
    ON ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
  LEFT JOIN users u ON u.id = ca.user_id
  WHERE c.org_id = v_org
    AND (CASE WHEN s.d ~ '^84[0-9]{9}$' THEN '0' || substr(s.d, 3) ELSE s.d END) = v_so
  ORDER BY c.store_name
  LIMIT 20;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.search_customer_dupes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_customer_dupes(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Tóm tắt — chỉ đọc. Mong đợi: thân hàm là bản 245 (so đúng số), không còn khớp từng phần theo tim_kd.
SELECT 'search_customer_dupes chỉ khớp đúng số' AS hang_muc,
       CASE WHEN position('v_so !~ ''^0[0-9]{9,10}$''' IN prosrc) > 0 AND position('tim_kd' IN prosrc) = 0
            THEN 'OK' ELSE 'CHƯA' END AS gia_tri
FROM pg_proc WHERE proname = 'search_customer_dupes' AND pronamespace = 'public'::regnamespace;
