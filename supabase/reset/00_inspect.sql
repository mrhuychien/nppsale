-- =====================================================================
-- 00_inspect.sql — đếm dòng đang có trong mỗi bảng
-- =====================================================================
-- Chạy trước khi reset để biết dữ liệu gì đang tồn tại và cho bạn cảm
-- giác về phạm vi xóa. An toàn, không thay đổi gì.
--
-- Cách dùng: mở Supabase → SQL editor → paste file này → Run.

SELECT 'organizations' AS table_name, count(*) FROM organizations
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'sales_routes', count(*) FROM sales_routes
UNION ALL SELECT 'customer_groups', count(*) FROM customer_groups
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'customer_assignments', count(*) FROM customer_assignments
UNION ALL SELECT 'suppliers', count(*) FROM suppliers
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'product_units', count(*) FROM product_units
UNION ALL SELECT 'price_lists', count(*) FROM price_lists
UNION ALL SELECT 'promotions', count(*) FROM promotions
UNION ALL SELECT 'commission_policies', count(*) FROM commission_policies
UNION ALL SELECT 'expense_categories', count(*) FROM expense_categories
UNION ALL SELECT 'approval_rules', count(*) FROM approval_rules
UNION ALL SELECT 'hr_salary_config', count(*) FROM hr_salary_config
UNION ALL SELECT '— transactions ——', 0
UNION ALL SELECT 'sales_orders', count(*) FROM sales_orders
UNION ALL SELECT 'sales_order_lines', count(*) FROM sales_order_lines
UNION ALL SELECT 'merged_orders', count(*) FROM merged_orders
UNION ALL SELECT 'order_status_history', count(*) FROM order_status_history
UNION ALL SELECT 'batches', count(*) FROM batches
UNION ALL SELECT 'stock_entries', count(*) FROM stock_entries
UNION ALL SELECT 'stock_entry_lines', count(*) FROM stock_entry_lines
UNION ALL SELECT 'deliveries', count(*) FROM deliveries
UNION ALL SELECT 'delivery_lines', count(*) FROM delivery_lines
UNION ALL SELECT 'receivables', count(*) FROM receivables
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'cash_collections', count(*) FROM cash_collections
UNION ALL SELECT 'payables', count(*) FROM payables
UNION ALL SELECT 'payable_payments', count(*) FROM payable_payments
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'returns', count(*) FROM returns
UNION ALL SELECT 'return_lines', count(*) FROM return_lines
UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
UNION ALL SELECT 'purchase_order_lines', count(*) FROM purchase_order_lines
UNION ALL SELECT 'purchase_invoices', count(*) FROM purchase_invoices
UNION ALL SELECT 'expenses', count(*) FROM expenses
UNION ALL SELECT 'pjp_routes', count(*) FROM pjp_routes
UNION ALL SELECT 'visit_logs', count(*) FROM visit_logs
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'commission_wallets', count(*) FROM commission_wallets
UNION ALL SELECT 'hr_attendance', count(*) FROM hr_attendance
UNION ALL SELECT 'hr_payroll', count(*) FROM hr_payroll
UNION ALL SELECT 'hr_monthly_bonus', count(*) FROM hr_monthly_bonus
ORDER BY 1;
