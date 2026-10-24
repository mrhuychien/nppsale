-- ====================================================================
-- RPC "ĐIỂM BÁN CÒN THIẾU ẢNH / VỊ TRÍ" + "ĐIỂM BÁN CHỜ DUYỆT ẢNH" — lọc trên máy chủ, có phân trang
--
-- VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: màn Điểm bán cần cập nhật
--   (/customers/missing-photos — nút mới trên trang chủ NVBH) kéo CẢ sổ khách (≈570 KB với 3.000 khách) + cả bảng ảnh
--   về rồi mới lọc "chưa có ảnh / chưa có vị trí" trên máy, vẽ hết một lượt — đo điện thoại 4G: 5,9 giây.
--   Nay máy chủ lọc + đếm ảnh + phân trang; máy chỉ nhận trang đang xem (50 dòng) kèm tổng số dòng khớp.
--
-- LÀM GÌ
--   1. khach_thieu_anh(p_tab, p_offset, p_limit): khách đang hoạt động còn thiếu — p_tab 'all' (thiếu ảnh HOẶC thiếu
--      vị trí) / 'no_photo' / 'no_gps'; mỗi dòng kèm số ảnh (photo_count) và tổng số dòng khớp (total_count).
--   2. khach_cho_duyet_anh(p_offset, p_limit): điểm bán CHỜ DUYỆT (mig 244) — có yêu cầu đổi đang chờ, hoặc chưa duyệt
--      mà đã có ảnh / vị trí để duyệt (luật `canDuyet` của màn cũ) — kèm da_duyet, so_yeu_cau.
--   ⚠ SECURITY INVOKER: RLS của customers / customer_photos / customer_photo_requests tự lọc — NVBH chỉ thấy khách mình
--     phụ trách, đúng tập khách màn cũ thấy. Không viết lại luật quyền ở đây. Sắp theo tên cửa hàng + id như màn cũ.
--   ⚠ Trình duyệt chưa gọi được RPC (sổ chưa chạy migration) thì màn lùi về cách cũ — xem page.tsx.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.khach_thieu_anh(
  p_tab text DEFAULT 'all',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
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
GRANT EXECUTE ON FUNCTION public.khach_thieu_anh(text, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.khach_thieu_anh(text, integer, integer) IS
  'Điểm bán đang hoạt động còn thiếu ảnh / vị trí (mig 253) — lọc + đếm ảnh + phân trang trên máy chủ, RLS tự lọc theo người gọi.';

CREATE OR REPLACE FUNCTION public.khach_cho_duyet_anh(
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
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
GRANT EXECUTE ON FUNCTION public.khach_cho_duyet_anh(integer, integer) TO authenticated;
COMMENT ON FUNCTION public.khach_cho_duyet_anh(integer, integer) IS
  'Điểm bán chờ duyệt ảnh + vị trí (mig 244 / 253): có yêu cầu đổi đang chờ, hoặc chưa duyệt mà đã có ảnh / vị trí.';

NOTIFY pgrst, 'reload schema';

SELECT 'RPC điểm bán thiếu ảnh / chờ duyệt (mig 253)' AS hang_muc,
       (SELECT count(*) FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace AND proname IN ('khach_thieu_anh', 'khach_cho_duyet_anh')) AS so_ham;
