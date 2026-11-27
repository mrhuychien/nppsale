-- ====================================================================
-- ĐIỂM BÁN CẦN CẬP NHẬT: LỌC + ĐẾM THEO NHÂN VIÊN PHỤ TRÁCH
--
-- VÌ SAO — chủ nhà 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật thêm lọc theo nhân viên bán hàng để xem nhân viên
--   bán hàng nào còn bao nhiêu điểm chưa cập nhật". Màn /customers/missing-photos đọc qua RPC mig 253 (máy chủ lọc + phân
--   trang) nên lọc theo NV phải làm ở máy chủ — lọc ở máy trong trang 50 dòng đang tải là thiếu (bài học "nhân viên 60
--   khách mà có 3 khách hiện", chủ nhà 03/10/2026).
--
-- LÀM GÌ
--   1. khach_thieu_anh(p_tab, p_offset, p_limit, p_nv) và khach_cho_duyet_anh(p_offset, p_limit, p_nv): thêm p_nv —
--      NULL = như cũ (mọi khách người gọi thấy); '_none' = khách CHƯA có NV chính; mã NV = khách có NV ấy là NV CHÍNH ĐANG
--      LÀM (role 'primary', status 'active') — cùng nghĩa bộ lọc "Nhân viên" của danh sách khách
--      (`src/lib/customers/loc-nhan-vien.ts`), cột "Phụ trách", RLS (mig 154) và bàn giao khách (mig 246).
--      ⚠ DROP bản cũ rồi mới tạo: CREATE OR REPLACE với danh sách tham số khác là tạo HÀM THỨ HAI cùng tên — PostgREST gặp
--        hai hàm khớp cùng bộ tên tham số thì báo PGRST203 (không chọn được hàm) và cả màn hỏng. p_nv mặc định NULL nên app
--        bản cũ (gọi ba tham số) vẫn chạy y như trước.
--   2. khach_thieu_anh_theo_nv(): mỗi NV chính (+ một dòng nv_id NULL = chưa phân công) — số điểm bán còn thiếu (thiếu ảnh
--      HOẶC vị trí) / chưa có ảnh / chưa có vị trí / chờ duyệt, ĐÚNG luật lọc của hai hàm trên. Điểm bán có hai NV chính
--      (dữ liệu lệch) đếm cho cả hai. Chỉ trả NV còn việc (> 0 ở một cột) — NV đã xong không có dòng, màn hiện 0.
--   ⚠ SECURITY INVOKER như mig 253: RLS của customers / customer_assignments / customer_photos tự lọc — NVBH chỉ thấy khách
--     mình. Không viết lại luật quyền ở đây.
-- ====================================================================

DROP FUNCTION IF EXISTS public.khach_thieu_anh(text, integer, integer);
CREATE OR REPLACE FUNCTION public.khach_thieu_anh(
  p_tab text DEFAULT 'all',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50,
  p_nv text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  store_name text,
  address text,
  phone text,
  gps_lat numeric,
  gps_lng numeric,
  photo_count integer,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH kh AS (
    SELECT c.id, c.store_name, c.address, c.phone, c.gps_lat, c.gps_lng,
           (SELECT count(*) FROM public.customer_photos p WHERE p.customer_id = c.id)::integer AS photo_count
    FROM public.customers c
    WHERE c.status = 'active'
      /* NV chính đang làm — cùng luật khach_thieu_anh_theo_nv / khach_cho_duyet_anh (mig 264). */
      AND (p_nv IS NULL
           OR CASE WHEN p_nv = '_none'
                   THEN NOT EXISTS (SELECT 1 FROM public.customer_assignments ca
                                     WHERE ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active')
                   ELSE EXISTS (SELECT 1 FROM public.customer_assignments ca
                                 WHERE ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
                                   AND ca.user_id::text = lower(p_nv))
              END)
  ),
  loc AS (
    /* Gọi đích danh `kh.` — tên trần trùng tham số OUT của RETURNS TABLE (chốt tests/rpc-out-param-ambiguous.test.ts). */
    SELECT * FROM kh
    WHERE CASE coalesce(p_tab, 'all')
            WHEN 'no_photo' THEN kh.photo_count = 0
            WHEN 'no_gps'   THEN kh.gps_lat IS NULL OR kh.gps_lng IS NULL
            ELSE kh.photo_count = 0 OR kh.gps_lat IS NULL OR kh.gps_lng IS NULL
          END
  )
  SELECT l.id, l.store_name, l.address, l.phone, l.gps_lat, l.gps_lng, l.photo_count, count(*) OVER () AS total_count
  FROM loc l
  ORDER BY l.store_name, l.id
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;
GRANT EXECUTE ON FUNCTION public.khach_thieu_anh(text, integer, integer, text) TO authenticated;
COMMENT ON FUNCTION public.khach_thieu_anh(text, integer, integer, text) IS
  'Điểm bán đang hoạt động còn thiếu ảnh / vị trí (mig 253, lọc NV chính mig 264) — lọc + đếm ảnh + phân trang trên máy chủ, RLS tự lọc theo người gọi.';

DROP FUNCTION IF EXISTS public.khach_cho_duyet_anh(integer, integer);
CREATE OR REPLACE FUNCTION public.khach_cho_duyet_anh(
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50,
  p_nv text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  store_name text,
  address text,
  phone text,
  gps_lat numeric,
  gps_lng numeric,
  photo_count integer,
  da_duyet boolean,
  so_yeu_cau integer,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH kh AS (
    SELECT c.id, c.store_name, c.address, c.phone, c.gps_lat, c.gps_lng,
           (SELECT count(*) FROM public.customer_photos p WHERE p.customer_id = c.id)::integer AS photo_count,
           (c.photo_approved_at IS NOT NULL) AS da_duyet,
           (SELECT count(*) FROM public.customer_photo_requests r WHERE r.customer_id = c.id AND r.status = 'pending')::integer AS so_yeu_cau
    FROM public.customers c
    WHERE c.status = 'active'
      AND (p_nv IS NULL
           OR CASE WHEN p_nv = '_none'
                   THEN NOT EXISTS (SELECT 1 FROM public.customer_assignments ca
                                     WHERE ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active')
                   ELSE EXISTS (SELECT 1 FROM public.customer_assignments ca
                                 WHERE ca.customer_id = c.id AND ca.role = 'primary' AND ca.status = 'active'
                                   AND ca.user_id::text = lower(p_nv))
              END)
  ),
  loc AS (
    SELECT * FROM kh
    WHERE kh.so_yeu_cau > 0
       OR (NOT kh.da_duyet AND (kh.photo_count > 0 OR (kh.gps_lat IS NOT NULL AND kh.gps_lng IS NOT NULL)))
  )
  SELECT l.id, l.store_name, l.address, l.phone, l.gps_lat, l.gps_lng, l.photo_count, l.da_duyet, l.so_yeu_cau,
         count(*) OVER () AS total_count
  FROM loc l
  ORDER BY l.store_name, l.id
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$fn$;
GRANT EXECUTE ON FUNCTION public.khach_cho_duyet_anh(integer, integer, text) TO authenticated;
COMMENT ON FUNCTION public.khach_cho_duyet_anh(integer, integer, text) IS
  'Điểm bán chờ duyệt ảnh + vị trí (mig 244 / 253, lọc NV chính mig 264): có yêu cầu đổi đang chờ, hoặc chưa duyệt mà đã có ảnh / vị trí.';

CREATE OR REPLACE FUNCTION public.khach_thieu_anh_theo_nv()
RETURNS TABLE (
  nv_id uuid,
  so_thieu integer,
  so_chua_anh integer,
  so_chua_vi_tri integer,
  so_cho_duyet integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH kh AS (
    SELECT c.id,
           (SELECT count(*) FROM public.customer_photos p WHERE p.customer_id = c.id) AS so_anh,
           (c.gps_lat IS NULL OR c.gps_lng IS NULL) AS thieu_vt,
           (c.photo_approved_at IS NOT NULL) AS da_duyet,
           (SELECT count(*) FROM public.customer_photo_requests r WHERE r.customer_id = c.id AND r.status = 'pending') AS so_yc
    FROM public.customers c
    WHERE c.status = 'active'
  ),
  co AS (
    /* Đúng luật lọc của khach_thieu_anh (all / no_photo / no_gps) và khach_cho_duyet_anh. */
    SELECT kh.id,
           (kh.so_anh = 0 OR kh.thieu_vt) AS thieu,
           (kh.so_anh = 0) AS chua_anh,
           kh.thieu_vt AS chua_vt,
           (kh.so_yc > 0 OR (NOT kh.da_duyet AND (kh.so_anh > 0 OR NOT kh.thieu_vt))) AS cho_duyet
    FROM kh
  ),
  gan AS (
    SELECT co.thieu, co.chua_anh, co.chua_vt, co.cho_duyet, ca.user_id AS nv
    FROM co
    LEFT JOIN public.customer_assignments ca
      ON ca.customer_id = co.id AND ca.role = 'primary' AND ca.status = 'active'
  )
  SELECT g.nv,
         (count(*) FILTER (WHERE g.thieu))::integer,
         (count(*) FILTER (WHERE g.chua_anh))::integer,
         (count(*) FILTER (WHERE g.chua_vt))::integer,
         (count(*) FILTER (WHERE g.cho_duyet))::integer
  FROM gan g
  GROUP BY g.nv
  HAVING count(*) FILTER (WHERE g.thieu OR g.cho_duyet) > 0;
$fn$;
GRANT EXECUTE ON FUNCTION public.khach_thieu_anh_theo_nv() TO authenticated;
COMMENT ON FUNCTION public.khach_thieu_anh_theo_nv() IS
  'Điểm bán cần cập nhật theo NV chính đang làm (mig 264): còn thiếu / chưa ảnh / chưa vị trí / chờ duyệt; nv_id NULL = chưa phân công.';

NOTIFY pgrst, 'reload schema';

SELECT 'Lọc + đếm điểm bán cần cập nhật theo nhân viên (mig 264)' AS hang_muc,
       (SELECT string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', '; ' ORDER BY proname)
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('khach_thieu_anh', 'khach_cho_duyet_anh', 'khach_thieu_anh_theo_nv')) AS cac_ham;
