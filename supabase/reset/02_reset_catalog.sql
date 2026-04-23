-- =====================================================================
-- 02_reset_catalog.sql — xóa thêm danh mục (KH, NCC, SP)
-- =====================================================================
-- CHẠY SAU 01_reset_transactions.sql. Khi bạn muốn bàn giao hoàn toàn
-- không có mẫu nào cả — NPP sẽ nhập toàn bộ KH, SP, NCC từ đầu.
--
-- GIỮ:
--  - organizations, users
--  - sales_routes (GT/MT/HORECA mặc định)
--  - expense_categories mặc định
--  - approval_rules mặc định
--
-- XÓA:
--  - customers, customer_groups, customer_assignments
--  - pjp_routes (tuyến phân công đi)
--  - suppliers
--  - products, product_units, price_lists
--  - promotions
--  - commission_policies, commission_wallets
--  - hr_salary_config (nếu muốn giao sạch cấu hình lương)
--
-- Lưu ý: các dữ liệu giao dịch PHẢI được xóa trước (01_reset_transactions).
-- Nếu còn giao dịch, FK sẽ chặn xóa danh mục.

BEGIN;

-- 1. Promotions / commission (không còn ai tham chiếu)
TRUNCATE TABLE promotions RESTART IDENTITY CASCADE;
TRUNCATE TABLE commission_wallets RESTART IDENTITY CASCADE;
TRUNCATE TABLE commission_policies RESTART IDENTITY CASCADE;

-- 2. PJP (phụ thuộc customers + users)
TRUNCATE TABLE pjp_routes RESTART IDENTITY CASCADE;

-- 3. Customer assignments + customers + groups
TRUNCATE TABLE customer_assignments RESTART IDENTITY CASCADE;
TRUNCATE TABLE customers RESTART IDENTITY CASCADE;
TRUNCATE TABLE customer_groups RESTART IDENTITY CASCADE;

-- 4. Suppliers
TRUNCATE TABLE suppliers RESTART IDENTITY CASCADE;

-- 5. Products + units + price lists
TRUNCATE TABLE price_lists RESTART IDENTITY CASCADE;
TRUNCATE TABLE product_units RESTART IDENTITY CASCADE;
TRUNCATE TABLE products RESTART IDENTITY CASCADE;

-- 6. HR config (BỎ COMMENT nếu muốn xóa cả lương chuẩn)
-- TRUNCATE TABLE hr_salary_config RESTART IDENTITY CASCADE;

COMMIT;
