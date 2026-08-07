-- ====================================================================
-- CHẨN ĐOÁN: vì sao trang /products không hiện sản phẩm?
--
-- Dán TOÀN BỘ file này vào Supabase Dashboard → SQL Editor → Run.
-- Chỉ ĐỌC, không sửa gì. Đọc kết quả từng phần theo hướng dẫn bên dưới.
-- ====================================================================

-- ---------------------------------------------------------------
-- PHẦN 1: Có sản phẩm trong DB không? (bỏ qua RLS vì SQL Editor
-- chạy quyền admin)
-- ---------------------------------------------------------------
SELECT
  '1. TỔNG SỐ SẢN PHẨM' AS kiem_tra,
  count(*)::text AS ket_qua,
  CASE WHEN count(*) = 0
       THEN 'DB THỰC SỰ TRỐNG → cần nhập sản phẩm, không phải lỗi app'
       ELSE 'Có dữ liệu → lỗi nằm ở tầng app hoặc RLS, xem phần 2-4' END AS ket_luan
FROM products;

-- ---------------------------------------------------------------
-- PHẦN 2: DB có ĐỦ CỘT mà app đang yêu cầu không?
-- Thiếu bất kỳ cột nào → PostgREST trả lỗi 400 → danh sách rỗng.
-- ---------------------------------------------------------------
WITH can_co(ten_cot) AS (
  SELECT unnest(ARRAY[
    'id','org_id','sku','name','category','brand','barcode','base_unit',
    'vat_rate','shelf_life_days','status','created_at','description',
    'warranty_info','cost_price','sell_price','track_serial','min_stock',
    'max_stock','shelf_location','weight','weight_unit','direct_sale',
    'images','allow_price_edit','price_edit_max_type','price_edit_max',
    'primary_supplier_id'
  ])
),
dang_co AS (
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products'
)
SELECT
  '2. CỘT BỊ THIẾU' AS kiem_tra,
  COALESCE(string_agg(c.ten_cot, ', '), '(không thiếu cột nào)') AS ket_qua,
  CASE WHEN count(*) > 0
       THEN 'ĐÂY LÀ NGUYÊN NHÂN → chạy migration 023, 025, 030 còn thiếu'
       ELSE 'Schema đủ → xem phần 3-4' END AS ket_luan
FROM can_co c
LEFT JOIN dang_co d ON d.column_name = c.ten_cot
WHERE d.column_name IS NULL;

-- ---------------------------------------------------------------
-- PHẦN 3: Quan hệ khoá ngoại cho embed supplier có tồn tại không?
-- App dùng: supplier:suppliers!products_primary_supplier_id_fkey(...)
-- ---------------------------------------------------------------
SELECT
  '3. FK products_primary_supplier_id_fkey' AS kiem_tra,
  CASE WHEN count(*) > 0 THEN 'CÓ' ELSE 'KHÔNG CÓ' END AS ket_qua,
  CASE WHEN count(*) = 0
       THEN 'ĐÂY LÀ NGUYÊN NHÂN → chạy migration 030_products_supplier.sql'
       ELSE 'OK' END AS ket_luan
FROM information_schema.table_constraints
WHERE constraint_name = 'products_primary_supplier_id_fkey'
  AND table_schema = 'public';

-- ---------------------------------------------------------------
-- PHẦN 4: RLS có chặn không? Liệt kê từng user và số SP họ THỰC SỰ
-- thấy được theo policy 081 (NV bán hàng chỉ thấy SP thuộc NCC
-- được gán trong user_suppliers).
-- ---------------------------------------------------------------
SELECT
  '4. SỐ SP MỖI USER THẤY' AS kiem_tra,
  u.full_name AS nguoi_dung,
  u.role AS vai_tro,
  (
    SELECT count(*) FROM products p
    WHERE p.org_id = u.org_id
      AND (
        u.role <> 'sales'
        OR p.primary_supplier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM user_suppliers us
          WHERE us.user_id = u.id AND us.supplier_id = p.primary_supplier_id
        )
      )
  )::text AS so_sp_thay_duoc,
  CASE
    WHEN u.role = 'sales' AND NOT EXISTS (
      SELECT 1 FROM user_suppliers us WHERE us.user_id = u.id
    ) THEN 'NV bán hàng CHƯA được gán NCC nào → chỉ thấy SP không có NCC'
    ELSE 'OK'
  END AS ghi_chu
FROM users u
ORDER BY u.role, u.full_name;

-- ---------------------------------------------------------------
-- PHẦN 5: Sản phẩm theo trạng thái — app mặc định lọc status.
-- ---------------------------------------------------------------
SELECT
  '5. SP THEO TRẠNG THÁI' AS kiem_tra,
  COALESCE(status, '(null)') AS trang_thai,
  count(*)::text AS so_luong
FROM products
GROUP BY status
ORDER BY count(*) DESC;
