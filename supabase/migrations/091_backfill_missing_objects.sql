-- ====================================================================
-- 091_backfill_missing_objects
--
-- BÙ CÁC ĐỐI TƯỢNG SCHEMA CÒN THIẾU trên database production.
--
-- Căn cứ: kết quả chạy supabase/diagnostics/check_migration_drift.sql
-- ngày 2026-08-21 trên DB production. Kết quả đó liệt kê 14 migration
-- "thiếu", nhưng sau khi rà từng cái thì PHẦN LỚN LÀ BÁO ĐỘNG GIẢ —
-- đối tượng bị migration SAU cố ý xoá/thay thế:
--
--   • 087 (users.qr_login_token…)  → 088 CỐ Ý xoá, chuyển sang bảng
--     riêng qr_login_tokens. Thiếu là ĐÚNG.
--   • 002/004 policy bảng users    → 004 rồi 008 thay thế lần lượt.
--   • 005/033/036/037 policy       → 042_customer_row_level thay thế.
--   • 010/012/020 policy           → 034 thay thế.
--   • 014 policy visit_photos      → nằm ở schema `storage`, công cụ dò
--     lại tìm trong schema `public` nên báo nhầm (đã sửa công cụ; xem
--     phần KIỂM TRA THÊM ở cuối file).
--
-- CHỈ 3 MỤC DƯỚI ĐÂY LÀ THIẾU THẬT. Migration này bù đúng 3 mục đó.
-- Toàn bộ đều idempotent — chạy lại nhiều lần không sao.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. products: 3 cột của migration 025 (NGUYÊN NHÂN GỐC lỗi trang
--    Sản phẩm không hiện danh sách).
--
--    Ứng dụng SELECT các cột này; thiếu chúng thì PostgREST trả lỗi 400
--    và danh sách rỗng. Hiện trang vẫn chạy được là nhờ cơ chế dự phòng
--    tự chuyển sang select('*') — nhưng đó chỉ cứu việc ĐỌC. Thao tác
--    GHI vào các cột này vẫn hỏng cho tới khi chạy migration này.
-- --------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allow_price_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_edit_max_type text
    NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS price_edit_max numeric NOT NULL DEFAULT 0;

-- CHECK tách riêng để chạy lại không lỗi "constraint already exists".
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_edit_max_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_price_edit_max_type_check
  CHECK (price_edit_max_type IN ('percent', 'value'));

COMMENT ON COLUMN products.allow_price_edit IS
  'Cho phép nhân viên sửa giá khi tạo đơn cho SKU này.';
COMMENT ON COLUMN products.price_edit_max_type IS
  'Đơn vị của trần điều chỉnh: ''percent'' (%) hoặc ''value'' (VND).';
COMMENT ON COLUMN products.price_edit_max IS
  'Trần được phép sửa: % giá bán hoặc giá trị tuyệt đối tùy max_type.';


-- --------------------------------------------------------------------
-- 2. sales_orders.client_request_id — migration 089.
--
--    Thiếu cột này thì đơn tạo NGOẠI TUYẾN không đẩy lên được: đơn nằm
--    lại trong hàng chờ trên máy nhân viên vô thời hạn. Index unique là
--    thứ bảo đảm đồng bộ lại nhiều lần không tạo đơn trùng.
-- --------------------------------------------------------------------
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_client_request_id
  ON sales_orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN sales_orders.client_request_id IS
  'UUID sinh tại thiết bị cho đơn tạo offline. Unique để đồng bộ idempotent (thử lại không tạo trùng). NULL cho đơn tạo online thông thường.';


-- --------------------------------------------------------------------
-- 3. Index tra cứu nhà cung cấp theo tổ chức — migration 006.
--    Chỉ ảnh hưởng tốc độ, không ảnh hưởng đúng/sai.
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(org_id);


-- ====================================================================
-- KIỂM TRA SAU KHI CHẠY — cả 3 dòng phải trả về true.
-- ====================================================================
-- SELECT
--   (SELECT count(*) = 3 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='products'
--       AND column_name IN ('allow_price_edit','price_edit_max_type','price_edit_max')
--   ) AS cot_products_du,
--   (SELECT count(*) = 1 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='sales_orders'
--       AND column_name='client_request_id'
--   ) AS cot_offline_du,
--   (SELECT count(*) = 1 FROM pg_indexes
--     WHERE schemaname='public' AND indexname='idx_suppliers_org'
--   ) AS index_ncc_du;

-- --------------------------------------------------------------------
-- KIỂM TRA THÊM (không bắt buộc): policy ảnh chuyến thăm nằm ở schema
-- `storage`. Nếu trả về ít hơn 3 dòng thì chức năng chụp ảnh viếng thăm
-- khách hàng đang hỏng — khi đó chạy lại migration 014_visit_photos.sql.
-- --------------------------------------------------------------------
-- SELECT policyname FROM pg_policies
-- WHERE schemaname='storage' AND tablename='objects'
--   AND policyname LIKE 'visit_photos%';
