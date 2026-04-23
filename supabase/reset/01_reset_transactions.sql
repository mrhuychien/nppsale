-- =====================================================================
-- 01_reset_transactions.sql — xóa dữ liệu giao dịch, GIỮ danh mục
-- =====================================================================
-- DÙNG KHI: bạn muốn bàn giao với danh mục (SP, KH, NCC, cấu hình) còn
-- nguyên nhưng xóa sạch lịch sử giao dịch (đơn, giao, công nợ, chi phí,
-- ghé thăm, thông báo, v.v.) để NPP bắt đầu chạy từ ngày 0 với dữ liệu
-- của họ.
--
-- GIỮ:
--  - organizations, users (auth)
--  - sales_routes, customer_groups, customers, customer_assignments
--  - suppliers
--  - products, product_units, price_lists
--  - promotions, commission_policies
--  - expense_categories, approval_rules
--  - hr_salary_config, hr_bonus_configs (nếu có), hr_monthly_bonus
--    (CHÚ Ý: nếu muốn xóa cấu hình lương cũng, xem 02_reset_catalog.sql)
--  - pjp_routes (phân công tuyến — phụ thuộc vào KH/NV)
--
-- XÓA:
--  - mọi giao dịch bên dưới + dọn commission_wallets.balance về 0
--
-- Chạy trong transaction để có thể ROLLBACK nếu gặp lỗi ràng buộc FK.

BEGIN;

-- 1. Notifications (không có FK outbound gì phức tạp)
TRUNCATE TABLE notifications RESTART IDENTITY CASCADE;

-- 2. Payments + collections (phụ thuộc receivables)
TRUNCATE TABLE cash_collections RESTART IDENTITY CASCADE;
TRUNCATE TABLE payments RESTART IDENTITY CASCADE;
TRUNCATE TABLE payable_payments RESTART IDENTITY CASCADE;

-- 3. Invoices (phụ thuộc orders)
TRUNCATE TABLE invoices RESTART IDENTITY CASCADE;

-- 4. Receivables / Payables
TRUNCATE TABLE receivables RESTART IDENTITY CASCADE;
TRUNCATE TABLE payables RESTART IDENTITY CASCADE;

-- 5. Deliveries
TRUNCATE TABLE delivery_lines RESTART IDENTITY CASCADE;
TRUNCATE TABLE deliveries RESTART IDENTITY CASCADE;

-- 6. Returns
TRUNCATE TABLE return_lines RESTART IDENTITY CASCADE;
TRUNCATE TABLE returns RESTART IDENTITY CASCADE;

-- 7. Purchase orders / invoices
TRUNCATE TABLE purchase_invoices RESTART IDENTITY CASCADE;
TRUNCATE TABLE purchase_order_lines RESTART IDENTITY CASCADE;
TRUNCATE TABLE purchase_orders RESTART IDENTITY CASCADE;

-- 8. Sales orders + status history + merge links
TRUNCATE TABLE order_status_history RESTART IDENTITY CASCADE;
TRUNCATE TABLE merged_orders RESTART IDENTITY CASCADE;
TRUNCATE TABLE sales_order_lines RESTART IDENTITY CASCADE;
TRUNCATE TABLE sales_orders RESTART IDENTITY CASCADE;

-- 9. Inventory movements — XÓA stock_entries + lines, cả batches
--    (khi giao NPP thực sự bắt đầu, họ sẽ nhập kho đợt đầu mới có tồn)
TRUNCATE TABLE stock_entry_lines RESTART IDENTITY CASCADE;
TRUNCATE TABLE stock_entries RESTART IDENTITY CASCADE;
TRUNCATE TABLE batches RESTART IDENTITY CASCADE;

-- 10. Visits + PJP execution history
TRUNCATE TABLE visit_logs RESTART IDENTITY CASCADE;

-- 11. Expenses (tất cả chi phí phát sinh + auto-generate từ kiểm kê)
TRUNCATE TABLE expenses RESTART IDENTITY CASCADE;

-- 12. HR transactional
TRUNCATE TABLE hr_monthly_bonus RESTART IDENTITY CASCADE;
TRUNCATE TABLE hr_payroll RESTART IDENTITY CASCADE;
TRUNCATE TABLE hr_attendance RESTART IDENTITY CASCADE;

-- 13. Commission wallets — reset số dư
UPDATE commission_wallets
SET total_earned = 0, total_withdrawn = 0, balance = 0;

-- Kiểm tra lại: tất cả bảng giao dịch phải rỗng.
-- Nếu CÒN dòng nào, TRUNCATE ... CASCADE sẽ báo lỗi ở lần chạy
-- trước đó. Uncomment để xác nhận:
-- SELECT 'sales_orders' AS t, count(*) FROM sales_orders
-- UNION ALL SELECT 'batches', count(*) FROM batches
-- UNION ALL SELECT 'notifications', count(*) FROM notifications;

COMMIT;
