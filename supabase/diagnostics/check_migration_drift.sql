-- ====================================================================
-- DÒ LỆCH MIGRATION — file TỰ SINH, KHÔNG sửa tay.
-- Sinh lại bằng: python3 scripts/build-drift-check.py
--
-- MỤC ĐÍCH: trả lời dứt điểm "database này có đủ schema mà mã nguồn
-- đang mong đợi không?".
--
-- CÁCH HOẠT ĐỘNG: duyệt toàn bộ 92 migration theo thứ tự và tính
-- TRẠNG THÁI CUỐI CÙNG của từng đối tượng. Đối tượng bị migration sau
-- xoá/thay thế (vd cột qr_login_token của 087 bị 088 chuyển sang bảng
-- riêng, hay policy bị đổi tên qua nhiều đợt sửa RLS) sẽ KHÔNG bị kiểm —
-- nhờ vậy không còn báo động giả.
--
-- Tổng số đối tượng schema cần có ở hiện tại: 462
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run.
-- Chỉ ĐỌC metadata schema, KHÔNG đụng dữ liệu.
--
-- ĐỌC KẾT QUẢ: mỗi dòng trả về là MỘT ĐỐI TƯỢNG ĐANG THIẾU, kèm tên
-- migration cần chạy để bù. Không có dòng nào = schema đã khớp mã nguồn.
-- ====================================================================

WITH mong_doi(migration, doi_tuong, co) AS (
  SELECT '001_schema.sql' AS migration, 'bảng organizations' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng users' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_users_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_users_role' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_role')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng customer_groups' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_groups')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_customer_groups_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customer_groups_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng customers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_customers_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customers_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_customers_group' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customers_group')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_customers_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customers_status')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng customer_assignments' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_assignments')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_assignments_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_assignments_user')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_assignments_customer' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_assignments_customer')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng products' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_products_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_products_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_products_category' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_products_category')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng product_units' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='product_units')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_product_units_product' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_product_units_product')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng price_lists' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='price_lists')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_price_lists_product' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_price_lists_product')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_price_lists_group' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_price_lists_group')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng batches' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='batches')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_batches_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_batches_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_batches_product' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_batches_product')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_batches_expiry' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_batches_expiry')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng stock_entries' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_entries')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_stock_entries_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_stock_entries_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng stock_entry_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stock_entry_lines')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_stock_entry_lines_entry' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_stock_entry_lines_entry')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng sales_orders' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_orders')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_orders_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_orders_customer' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_customer')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_orders_sales_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_sales_user')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_orders_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_status')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_orders_date' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_orders_date')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng sales_order_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_order_lines')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_order_lines_order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_order_lines_order')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng merged_orders' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='merged_orders')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng commission_policies' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='commission_policies')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_commission_policies_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_commission_policies_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng commission_wallets' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='commission_wallets')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_commission_wallets_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_commission_wallets_user')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng receivables' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='receivables')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_receivables_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_receivables_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_receivables_customer' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_receivables_customer')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_receivables_sales_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_receivables_sales_user')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_receivables_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_receivables_status')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng payments' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payments')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_payments_receivable' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payments_receivable')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng deliveries' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deliveries')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_deliveries_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_deliveries_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_deliveries_driver' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_deliveries_driver')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng delivery_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='delivery_lines')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_delivery_lines_delivery' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_delivery_lines_delivery')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng promotions' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='promotions')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_promotions_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_promotions_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng invoices' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='invoices')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_invoices_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_invoices_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng returns' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='returns')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_returns_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_returns_org')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng return_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='return_lines')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'index idx_return_lines_return' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_return_lines_return')) AS co
  UNION ALL
  SELECT '001_schema.sql' AS migration, 'bảng reports_config' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reports_config')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'hàm user_org_id()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_org_id')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'hàm user_role()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_role')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy organizations/Users can view their own org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organizations' AND policyname='Users can view their own org')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy organizations/Owners can update their org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='organizations' AND policyname='Owners can update their org')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy customer_groups/Org members can view customer ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_groups' AND policyname='Org members can view customer groups')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy customer_groups/Owner/Manager can manage custo' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_groups' AND policyname='Owner/Manager can manage customer groups')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy customers/Owner/Manager/Sales can create' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND policyname='Owner/Manager/Sales can create customers')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy customers/Owner/Manager/Sales can update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND policyname='Owner/Manager/Sales can update customers')) AS co
  UNION ALL
  SELECT '005_fix_customers_recursion.sql' AS migration, 'policy customers/Owner can delete customers' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND policyname='Owner can delete customers')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy products/Owner/Manager can manage produ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname='Owner/Manager can manage products')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy product_units/Org members can view product u' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_units' AND policyname='Org members can view product units')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy product_units/Owner/Manager can manage produ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_units' AND policyname='Owner/Manager can manage product units')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy price_lists/Org members can view price lis' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='price_lists' AND policyname='Org members can view price lists')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy price_lists/Owner/Manager can manage price' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='price_lists' AND policyname='Owner/Manager can manage price lists')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy batches/Org members can view batches' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='batches' AND policyname='Org members can view batches')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy batches/Owner/Warehouse can manage bat' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='batches' AND policyname='Owner/Warehouse can manage batches')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy stock_entries/Org members can view stock ent' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_entries' AND policyname='Org members can view stock entries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy stock_entries/Owner/Warehouse can manage sto' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_entries' AND policyname='Owner/Warehouse can manage stock entries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy stock_entry_lines/Org members can view stock ent' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_entry_lines' AND policyname='Org members can view stock entry lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy stock_entry_lines/Owner/Warehouse can manage sto' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_entry_lines' AND policyname='Owner/Warehouse can manage stock entry lines')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy sales_orders/Owner/Manager/Sales can create' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_orders' AND policyname='Owner/Manager/Sales can create orders')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy sales_orders/Owner/Manager can update order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_orders' AND policyname='Owner/Manager can update orders')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy sales_orders/Sales can update own draft ord' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_orders' AND policyname='Sales can update own draft orders')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy sales_order_lines/Users can view order lines of ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_order_lines' AND policyname='Users can view order lines of visible orders')) AS co
  UNION ALL
  SELECT '036_rls_repair.sql' AS migration, 'policy sales_order_lines/Owner/Manager/Sales can manage' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_order_lines' AND policyname='Owner/Manager/Sales can manage order lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy merged_orders/Org members can view merged or' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='merged_orders' AND policyname='Org members can view merged orders')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy merged_orders/Owner/Manager can manage merge' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='merged_orders' AND policyname='Owner/Manager can manage merged orders')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy commission_policies/Org members can view commissio' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='commission_policies' AND policyname='Org members can view commission policies')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy commission_policies/Owner can manage commission po' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='commission_policies' AND policyname='Owner can manage commission policies')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy commission_wallets/Users can view own wallet' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='commission_wallets' AND policyname='Users can view own wallet')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy commission_wallets/Owner/Accountant can view all ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='commission_wallets' AND policyname='Owner/Accountant can view all wallets')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy commission_wallets/Owner/Accountant can manage wa' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='commission_wallets' AND policyname='Owner/Accountant can manage wallets')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy receivables/Admin roles can view all recei' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receivables' AND policyname='Admin roles can view all receivables')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy receivables/Sales see own receivables' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receivables' AND policyname='Sales see own receivables')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy receivables/Driver see assigned receivable' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receivables' AND policyname='Driver see assigned receivables')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy receivables/Authorized roles can create re' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receivables' AND policyname='Authorized roles can create receivables')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy receivables/Accountant/Owner can update re' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receivables' AND policyname='Accountant/Owner can update receivables')) AS co
  UNION ALL
  SELECT '092_rls_hardening.sql' AS migration, 'policy payments/Org members can view payments' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Org members can view payments')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy payments/Sales/Driver/Accountant can cr' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Sales/Driver/Accountant can create payments')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy payments/Accountant can verify payments' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Accountant can verify payments')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy deliveries/Admin roles can view all deliv' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deliveries' AND policyname='Admin roles can view all deliveries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy deliveries/Driver sees own deliveries' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deliveries' AND policyname='Driver sees own deliveries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy deliveries/Owner/Manager/Warehouse can ma' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deliveries' AND policyname='Owner/Manager/Warehouse can manage deliveries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy deliveries/Driver can update own deliveri' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='deliveries' AND policyname='Driver can update own deliveries')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy delivery_lines/Users can view delivery lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='delivery_lines' AND policyname='Users can view delivery lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy delivery_lines/Authorized roles can manage de' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='delivery_lines' AND policyname='Authorized roles can manage delivery lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy promotions/Org members can view promotion' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promotions' AND policyname='Org members can view promotions')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy promotions/Owner/Manager can manage promo' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='promotions' AND policyname='Owner/Manager can manage promotions')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy invoices/Owner/Accountant can manage in' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Owner/Accountant can manage invoices')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy returns/Admin roles can view all retur' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='returns' AND policyname='Admin roles can view all returns')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy returns/Sales see own returns' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='returns' AND policyname='Sales see own returns')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy returns/Sales can create returns' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='returns' AND policyname='Sales can create returns')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy returns/Owner/Manager can approve retu' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='returns' AND policyname='Owner/Manager can approve returns')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy return_lines/Users can view return lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='return_lines' AND policyname='Users can view return lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy return_lines/Authorized roles can manage re' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='return_lines' AND policyname='Authorized roles can manage return lines')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy reports_config/Org members can view reports c' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reports_config' AND policyname='Org members can view reports config')) AS co
  UNION ALL
  SELECT '002_rls_policies.sql' AS migration, 'policy reports_config/Owner can manage reports confi' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reports_config' AND policyname='Owner can manage reports config')) AS co
  UNION ALL
  SELECT '005_fix_customers_recursion.sql' AS migration, 'hàm user_is_assigned_to_customer()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_is_assigned_to_customer')) AS co
  UNION ALL
  SELECT '006_suppliers.sql' AS migration, 'bảng suppliers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='suppliers')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'index idx_suppliers_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_suppliers_org')) AS co
  UNION ALL
  SELECT '092_rls_hardening.sql' AS migration, 'policy suppliers/Authenticated can view supplie' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Authenticated can view suppliers')) AS co
  UNION ALL
  SELECT '006_suppliers.sql' AS migration, 'policy suppliers/Owner/Manager can manage suppl' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Owner/Manager can manage suppliers')) AS co
  UNION ALL
  SELECT '006_suppliers.sql' AS migration, 'stock_entries.supplier_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entries' AND column_name='supplier_id')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'bảng hr_salary_config' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hr_salary_config')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_salary_config_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_salary_config_org')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'bảng hr_monthly_bonus' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hr_monthly_bonus')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_monthly_bonus_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_monthly_bonus_org')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'bảng hr_attendance' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hr_attendance')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_attendance_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_attendance_org')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_attendance_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_attendance_user')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'bảng hr_payroll' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hr_payroll')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_payroll_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_payroll_org')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'index idx_hr_payroll_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_hr_payroll_user')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_salary_config/View salary config' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_salary_config' AND policyname='View salary config')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_salary_config/Manage salary config' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_salary_config' AND policyname='Manage salary config')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_monthly_bonus/View monthly bonus' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_monthly_bonus' AND policyname='View monthly bonus')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_monthly_bonus/Manage monthly bonus' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_monthly_bonus' AND policyname='Manage monthly bonus')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_attendance/View attendance' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_attendance' AND policyname='View attendance')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_attendance/Manage attendance' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_attendance' AND policyname='Manage attendance')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_payroll/View own payroll' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_payroll' AND policyname='View own payroll')) AS co
  UNION ALL
  SELECT '007_hr_module.sql' AS migration, 'policy hr_payroll/Manage payroll' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hr_payroll' AND policyname='Manage payroll')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'policy users/Users view own org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='Users view own org')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'policy users/Owner insert users' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='Owner insert users')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'policy users/Owner update users' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='Owner update users')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'policy users/Owner delete users' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='Owner delete users')) AS co
  UNION ALL
  SELECT '037_fix_rls_recursion.sql' AS migration, 'policy customer_assignments/View assignments in org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_assignments' AND policyname='View assignments in org')) AS co
  UNION ALL
  SELECT '037_fix_rls_recursion.sql' AS migration, 'policy customer_assignments/Owner/Manager manage assignmen' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='customer_assignments' AND policyname='Owner/Manager manage assignments')) AS co
  UNION ALL
  SELECT '059_allow_delivering_to_cancelled.sql' AS migration, 'hàm check_order_status_transition()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='check_order_status_transition')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'bảng order_status_history' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_status_history')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'index idx_order_history_order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_order_history_order')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'hàm log_order_status_change()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='log_order_status_change')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'policy order_status_history/View order history' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_status_history' AND policyname='View order history')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'hàm auto_restock_on_return()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='auto_restock_on_return')) AS co
  UNION ALL
  SELECT '008_fix_security_audit.sql' AS migration, 'commission_wallets.org_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='commission_wallets' AND column_name='org_id')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'bảng cash_collections' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_collections')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'index idx_cash_collections_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_cash_collections_org')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'index idx_cash_collections_driver' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_cash_collections_driver')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy cash_collections/View cash collections' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_collections' AND policyname='View cash collections')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy cash_collections/Driver submit cash' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_collections' AND policyname='Driver submit cash')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy cash_collections/Accountant verify cash' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_collections' AND policyname='Accountant verify cash')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'delivery_lines.payment_method' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_lines' AND column_name='payment_method')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'delivery_lines.amount_collected' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_lines' AND column_name='amount_collected')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'bảng pjp_routes' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pjp_routes')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'index idx_pjp_routes_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pjp_routes_user')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'bảng visit_logs' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='visit_logs')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'index idx_visit_logs_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_visit_logs_user')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'index idx_visit_logs_customer' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_visit_logs_customer')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy pjp_routes/View own PJP' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pjp_routes' AND policyname='View own PJP')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy pjp_routes/Manager manage PJP' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pjp_routes' AND policyname='Manager manage PJP')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy visit_logs/View visits' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='visit_logs' AND policyname='View visits')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy visit_logs/Sales log visits' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='visit_logs' AND policyname='Sales log visits')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'policy visit_logs/Sales update own visits' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='visit_logs' AND policyname='Sales update own visits')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'deliveries.warehouse_confirmed_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='warehouse_confirmed_by')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'deliveries.warehouse_confirmed_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='warehouse_confirmed_at')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'deliveries.driver_confirmed_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='driver_confirmed_by')) AS co
  UNION ALL
  SELECT '009_business_flow_p1.sql' AS migration, 'deliveries.driver_confirmed_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='driver_confirmed_at')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'bảng payables' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payables')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'index idx_payables_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payables_org')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'index idx_payables_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payables_supplier')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'bảng payable_payments' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payable_payments')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'index idx_payable_payments' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payable_payments')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'policy payables/Manage payables' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payables' AND policyname='Manage payables')) AS co
  UNION ALL
  SELECT '010_supplier_payables.sql' AS migration, 'policy payable_payments/Manage payable payments' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payable_payments' AND policyname='Manage payable payments')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'customers.billing_name' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='billing_name')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'customers.tax_code' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='tax_code')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'customers.billing_address' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='billing_address')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'customers.billing_email' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='billing_email')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'customers.payment_method_label' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='payment_method_label')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_invoice_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_invoice_id')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_invoice_url' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_invoice_url')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_status' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_status')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_error' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_error')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_sent_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_sent_at')) AS co
  UNION ALL
  SELECT '011_misa_invoice.sql' AS migration, 'invoices.misa_signed_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_signed_at')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'bảng purchase_orders' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_orders')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'index idx_po_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_po_org')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'index idx_po_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_po_supplier')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'bảng purchase_order_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_order_lines')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'index idx_po_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_po_lines')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'bảng purchase_invoices' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_invoices')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'index idx_pinv_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pinv_org')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'policy purchase_orders/Manage POs' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='Manage POs')) AS co
  UNION ALL
  SELECT '012_purchase_orders.sql' AS migration, 'policy purchase_order_lines/Manage PO lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_order_lines' AND policyname='Manage PO lines')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'policy purchase_invoices/Manage purchase invoices' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoices' AND policyname='Manage purchase invoices')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'bảng approval_rules' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='approval_rules')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'index idx_approval_rules_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_approval_rules_org')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'hàm approval_rules_touch()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='approval_rules_touch')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'policy approval_rules/approval_rules_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_rules' AND policyname='approval_rules_select')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'policy approval_rules/approval_rules_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_rules' AND policyname='approval_rules_insert')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'policy approval_rules/approval_rules_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_rules' AND policyname='approval_rules_update')) AS co
  UNION ALL
  SELECT '013_approval_rules.sql' AS migration, 'sales_orders.approval_reason' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name='approval_reason')) AS co
  UNION ALL
  SELECT '014_visit_photos.sql' AS migration, 'visit_logs.photo_url' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='visit_logs' AND column_name='photo_url')) AS co
  UNION ALL
  SELECT '014_visit_photos.sql' AS migration, 'visit_logs.check_in_address' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='visit_logs' AND column_name='check_in_address')) AS co
  UNION ALL
  SELECT '014_visit_photos.sql' AS migration, 'policy objects/visit_photos_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='visit_photos_insert')) AS co
  UNION ALL
  SELECT '014_visit_photos.sql' AS migration, 'policy objects/visit_photos_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='visit_photos_select')) AS co
  UNION ALL
  SELECT '014_visit_photos.sql' AS migration, 'policy objects/visit_photos_delete' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='visit_photos_delete')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'bảng notifications' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notifications')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'index idx_notifications_user_unread' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_notifications_user_unread')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'index idx_notifications_user_recent' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_notifications_user_recent')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'policy notifications/notifications_select_own' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_select_own')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'policy notifications/notifications_insert_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_insert_org')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'policy notifications/notifications_update_own' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_update_own')) AS co
  UNION ALL
  SELECT '015_notifications.sql' AS migration, 'policy notifications/notifications_delete_own' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_delete_own')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'stock_entries.status' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entries' AND column_name='status')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'stock_entries.posted_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entries' AND column_name='posted_at')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'index idx_stock_entries_status_type' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_stock_entries_status_type')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'stock_entry_lines.unit_cost' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entry_lines' AND column_name='unit_cost')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'batches.unit_cost' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='batches' AND column_name='unit_cost')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'bảng expense_categories' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='expense_categories')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'bảng expenses' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='expenses')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'index idx_expenses_org_date' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_expenses_org_date')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'index idx_expenses_category' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_expenses_category')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'index idx_expenses_source' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_expenses_source')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'hàm expenses_touch()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='expenses_touch')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'policy expense_categories/expense_categories_all' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expense_categories' AND policyname='expense_categories_all')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'policy expenses/expenses_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='expenses_select')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'policy expenses/expenses_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='expenses_insert')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'policy expenses/expenses_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='expenses_update')) AS co
  UNION ALL
  SELECT '016_inventory_costs_expenses.sql' AS migration, 'policy expenses/expenses_delete' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expenses' AND policyname='expenses_delete')) AS co
  UNION ALL
  SELECT '017_stock_entries_order_link.sql' AS migration, 'stock_entries.ref_order_ids' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entries' AND column_name='ref_order_ids')) AS co
  UNION ALL
  SELECT '017_stock_entries_order_link.sql' AS migration, 'index idx_stock_entries_ref_orders' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_stock_entries_ref_orders')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'bảng sales_routes' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sales_routes')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'index idx_sales_routes_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sales_routes_org')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'hàm sales_routes_touch()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sales_routes_touch')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'policy sales_routes/sales_routes_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_routes' AND policyname='sales_routes_select')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'policy sales_routes/sales_routes_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_routes' AND policyname='sales_routes_insert')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'policy sales_routes/sales_routes_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_routes' AND policyname='sales_routes_update')) AS co
  UNION ALL
  SELECT '018_sales_routes.sql' AS migration, 'policy sales_routes/sales_routes_delete' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales_routes' AND policyname='sales_routes_delete')) AS co
  UNION ALL
  SELECT '019_delivery_settlement.sql' AS migration, 'deliveries.settled_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='settled_at')) AS co
  UNION ALL
  SELECT '019_delivery_settlement.sql' AS migration, 'deliveries.settled_amount' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='settled_amount')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'bảng cash_receipts' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_receipts')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'index idx_cash_receipts_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_cash_receipts_org')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'index idx_cash_receipts_source' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_cash_receipts_source')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'bảng cash_receipt_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cash_receipt_lines')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'index idx_cash_receipt_lines_receipt' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_cash_receipt_lines_receipt')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipts/cash_receipts_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipts' AND policyname='cash_receipts_insert')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipts/cash_receipts_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipts' AND policyname='cash_receipts_update')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipts/cash_receipts_delete' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipts' AND policyname='cash_receipts_delete')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipt_lines/cash_receipt_lines_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipt_lines' AND policyname='cash_receipt_lines_select')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipt_lines/cash_receipt_lines_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipt_lines' AND policyname='cash_receipt_lines_insert')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipt_lines/cash_receipt_lines_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipt_lines' AND policyname='cash_receipt_lines_update')) AS co
  UNION ALL
  SELECT '020_cash_receipts.sql' AS migration, 'policy cash_receipt_lines/cash_receipt_lines_delete' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipt_lines' AND policyname='cash_receipt_lines_delete')) AS co
  UNION ALL
  SELECT '021_pricing_rules.sql' AS migration, 'bảng pricing_rules' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pricing_rules')) AS co
  UNION ALL
  SELECT '021_pricing_rules.sql' AS migration, 'hàm pricing_rules_touch()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pricing_rules_touch')) AS co
  UNION ALL
  SELECT '021_pricing_rules.sql' AS migration, 'policy pricing_rules/pricing_rules_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pricing_rules' AND policyname='pricing_rules_select')) AS co
  UNION ALL
  SELECT '021_pricing_rules.sql' AS migration, 'policy pricing_rules/pricing_rules_insert' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pricing_rules' AND policyname='pricing_rules_insert')) AS co
  UNION ALL
  SELECT '021_pricing_rules.sql' AS migration, 'policy pricing_rules/pricing_rules_update' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pricing_rules' AND policyname='pricing_rules_update')) AS co
  UNION ALL
  SELECT '022_role_permissions.sql' AS migration, 'bảng role_permissions' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='role_permissions')) AS co
  UNION ALL
  SELECT '022_role_permissions.sql' AS migration, 'index idx_role_permissions_org_role' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_role_permissions_org_role')) AS co
  UNION ALL
  SELECT '022_role_permissions.sql' AS migration, 'policy role_permissions/role_permissions_select' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions' AND policyname='role_permissions_select')) AS co
  UNION ALL
  SELECT '022_role_permissions.sql' AS migration, 'policy role_permissions/role_permissions_owner_write' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions' AND policyname='role_permissions_owner_write')) AS co
  UNION ALL
  SELECT '022_role_permissions.sql' AS migration, 'hàm touch_role_permissions_updated_at()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='touch_role_permissions_updated_at')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.description' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='description')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.warranty_info' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='warranty_info')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.cost_price' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='cost_price')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.sell_price' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='sell_price')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.track_serial' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='track_serial')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.min_stock' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='min_stock')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.max_stock' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='max_stock')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.shelf_location' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='shelf_location')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.weight' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='weight')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.weight_unit' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='weight_unit')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.direct_sale' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='direct_sale')) AS co
  UNION ALL
  SELECT '023_products_extras.sql' AS migration, 'products.images' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='images')) AS co
  UNION ALL
  SELECT '090_fix_role_permissions_module_check.sql' AS migration, 'constraint role_permissions_module_check' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='role_permissions' AND c.conname='role_permissions_module_check')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'products.allow_price_edit' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='allow_price_edit')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'products.price_edit_max_type' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='price_edit_max_type')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'products.price_edit_max' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='price_edit_max')) AS co
  UNION ALL
  SELECT '026_salary_bypass_attendance.sql' AS migration, 'hr_salary_config.bypass_attendance_roles' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_salary_config' AND column_name='bypass_attendance_roles')) AS co
  UNION ALL
  SELECT '027_user_price_edit.sql' AS migration, 'users.allow_price_edit' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='allow_price_edit')) AS co
  UNION ALL
  SELECT '027_user_price_edit.sql' AS migration, 'users.price_edit_max_increase_pct' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='price_edit_max_increase_pct')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'batches.warehouse_zone' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='batches' AND column_name='warehouse_zone')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'batches.zone_moved_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='batches' AND column_name='zone_moved_at')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'batches.zone_moved_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='batches' AND column_name='zone_moved_by')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'index idx_batches_zone' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_batches_zone')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'pricing_rules.date_warehouse_threshold_days' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pricing_rules' AND column_name='date_warehouse_threshold_days')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'hàm batches_auto_zone()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='batches_auto_zone')) AS co
  UNION ALL
  SELECT '028_warehouse_zones.sql' AS migration, 'hàm refresh_warehouse_zones()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='refresh_warehouse_zones')) AS co
  UNION ALL
  SELECT '029_line_notes.sql' AS migration, 'sales_order_lines.note' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_order_lines' AND column_name='note')) AS co
  UNION ALL
  SELECT '029_line_notes.sql' AS migration, 'return_lines.note' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='return_lines' AND column_name='note')) AS co
  UNION ALL
  SELECT '030_products_supplier.sql' AS migration, 'products.primary_supplier_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='primary_supplier_id')) AS co
  UNION ALL
  SELECT '030_products_supplier.sql' AS migration, 'index idx_products_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_products_supplier')) AS co
  UNION ALL
  SELECT '031_hr_bonus_extensions.sql' AS migration, 'hr_monthly_bonus.per_unit_bonuses' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_monthly_bonus' AND column_name='per_unit_bonuses')) AS co
  UNION ALL
  SELECT '031_hr_bonus_extensions.sql' AS migration, 'hr_monthly_bonus.order_milestone_tiers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_monthly_bonus' AND column_name='order_milestone_tiers')) AS co
  UNION ALL
  SELECT '031_hr_bonus_extensions.sql' AS migration, 'hr_monthly_bonus.kpi_metrics' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_monthly_bonus' AND column_name='kpi_metrics')) AS co
  UNION ALL
  SELECT '032_customers_created_by.sql' AS migration, 'customers.created_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='created_by')) AS co
  UNION ALL
  SELECT '032_customers_created_by.sql' AS migration, 'index idx_customers_created_by' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_customers_created_by')) AS co
  UNION ALL
  SELECT '092_rls_hardening.sql' AS migration, 'policy payments/Sales see own order payments' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payments' AND policyname='Sales see own order payments')) AS co
  UNION ALL
  SELECT '033_per_user_data_filtering.sql' AS migration, 'policy notifications/Users see own notifications' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='Users see own notifications')) AS co
  UNION ALL
  SELECT '033_per_user_data_filtering.sql' AS migration, 'policy order_status_history/View history of visible orders' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_status_history' AND policyname='View history of visible orders')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy payables/Financial roles view payables' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payables' AND policyname='Financial roles view payables')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy payable_payments/Financial roles view payable p' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='payable_payments' AND policyname='Financial roles view payable payments')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy purchase_orders/Ops roles view POs' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='Ops roles view POs')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy purchase_order_lines/Ops roles view PO lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_order_lines' AND policyname='Ops roles view PO lines')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy purchase_invoices/Financial roles view purchase ' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoices' AND policyname='Financial roles view purchase invoices')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy cash_receipts/cash_receipts_select_admin' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipts' AND policyname='cash_receipts_select_admin')) AS co
  UNION ALL
  SELECT '034_per_user_data_filtering_part2.sql' AS migration, 'policy cash_receipts/cash_receipts_select_own' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cash_receipts' AND policyname='cash_receipts_select_own')) AS co
  UNION ALL
  SELECT '035_return_exchange.sql' AS migration, 'return_lines.is_exchange' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='return_lines' AND column_name='is_exchange')) AS co
  UNION ALL
  SELECT '035_return_exchange.sql' AS migration, 'index idx_return_lines_exchange' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_return_lines_exchange')) AS co
  UNION ALL
  SELECT '035_return_exchange.sql' AS migration, 'hàm sync_return_credit_amount()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_return_credit_amount')) AS co
  UNION ALL
  SELECT '037_fix_rls_recursion.sql' AS migration, 'hàm user_assigned_customer_ids()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_assigned_customer_ids')) AS co
  UNION ALL
  SELECT '037_fix_rls_recursion.sql' AS migration, 'hàm customer_org_id()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='customer_org_id')) AS co
  UNION ALL
  SELECT '038_delivery_goods_handover.sql' AS migration, 'deliveries.goods_handover_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='goods_handover_at')) AS co
  UNION ALL
  SELECT '038_delivery_goods_handover.sql' AS migration, 'deliveries.goods_handover_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='goods_handover_by')) AS co
  UNION ALL
  SELECT '038_delivery_goods_handover.sql' AS migration, 'deliveries.goods_handover_notes' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='goods_handover_notes')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'sales_order_lines.conversion_factor' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_order_lines' AND column_name='conversion_factor')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'stock_entry_lines.qty_in_base_uom' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entry_lines' AND column_name='qty_in_base_uom')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'stock_entry_lines.qty_in_transaction_uom' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entry_lines' AND column_name='qty_in_transaction_uom')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'stock_entry_lines.transaction_uom' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entry_lines' AND column_name='transaction_uom')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'stock_entry_lines.conversion_factor_snapshot' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_entry_lines' AND column_name='conversion_factor_snapshot')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'view v_uom_audit' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_uom_audit')) AS co
  UNION ALL
  SELECT '039_uom_conversion_fix.sql' AS migration, 'index idx_sel_product_entry_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sel_product_entry_org')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'bảng fifo_layers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fifo_layers')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'index idx_fifo_consume' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_fifo_consume')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'bảng fifo_consumptions' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fifo_consumptions')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'index idx_fifo_cons_out' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_fifo_cons_out')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'index idx_fifo_cons_layer' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_fifo_cons_layer')) AS co
  UNION ALL
  SELECT '040_fifo_layers.sql' AS migration, 'hàm fifo_consume()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fifo_consume')) AS co
  UNION ALL
  SELECT '041_user_permission_overrides.sql' AS migration, 'bảng user_permission_overrides' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_permission_overrides')) AS co
  UNION ALL
  SELECT '041_user_permission_overrides.sql' AS migration, 'index idx_upo_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_upo_user')) AS co
  UNION ALL
  SELECT '058_user_has_permission_split_last_dot.sql' AS migration, 'hàm user_has_permission()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='user_has_permission')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'bảng salary_kpi_tiers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='salary_kpi_tiers')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'index idx_kpi_user_month' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_kpi_user_month')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'index idx_kpi_org_month' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_kpi_org_month')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'bảng salary_order_count_bonus_configs' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='salary_order_count_bonus_configs')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'index idx_ocbc_user_eff' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ocbc_user_eff')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'bảng monthly_activity_bonuses' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='monthly_activity_bonuses')) AS co
  UNION ALL
  SELECT '043_payroll_per_user_bonuses.sql' AS migration, 'index idx_mab_org_month' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_mab_org_month')) AS co
  UNION ALL
  SELECT '044_workflow_stage.sql' AS migration, 'sales_orders.current_workflow_stage' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name='current_workflow_stage')) AS co
  UNION ALL
  SELECT '044_workflow_stage.sql' AS migration, 'constraint chk_sales_orders_workflow_stage' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='sales_orders' AND c.conname='chk_sales_orders_workflow_stage')) AS co
  UNION ALL
  SELECT '044_workflow_stage.sql' AS migration, 'hàm sync_sales_order_workflow_stage()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_sales_order_workflow_stage')) AS co
  UNION ALL
  SELECT '044_workflow_stage.sql' AS migration, 'view v_sales_order_line_picked' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_sales_order_line_picked')) AS co
  UNION ALL
  SELECT '044_workflow_stage.sql' AS migration, 'hàm enforce_picked_line_lock()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enforce_picked_line_lock')) AS co
  UNION ALL
  SELECT '045_workflow_sessions.sql' AS migration, 'bảng workflow_sessions' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='workflow_sessions')) AS co
  UNION ALL
  SELECT '045_workflow_sessions.sql' AS migration, 'index uniq_workflow_session_open' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_workflow_session_open')) AS co
  UNION ALL
  SELECT '045_workflow_sessions.sql' AS migration, 'index idx_ws_user_open' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ws_user_open')) AS co
  UNION ALL
  SELECT '045_workflow_sessions.sql' AS migration, 'hàm bump_workflow_session_action()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bump_workflow_session_action')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'bảng entity_locks' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='entity_locks')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'index idx_entity_locks_heartbeat' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_entity_locks_heartbeat')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'index idx_entity_locks_holder' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_entity_locks_holder')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'hàm release_stale_entity_locks()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='release_stale_entity_locks')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'hàm acquire_entity_lock()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='acquire_entity_lock')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'hàm heartbeat_entity_lock()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='heartbeat_entity_lock')) AS co
  UNION ALL
  SELECT '046_entity_locks.sql' AS migration, 'hàm release_entity_lock()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='release_entity_lock')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'bảng driver_handovers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_handovers')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dh_delivery' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dh_delivery')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dh_org_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dh_org_status')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'bảng driver_handover_failed_orders' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_handover_failed_orders')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dhfo_handover' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dhfo_handover')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dhfo_order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dhfo_order')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'bảng driver_handover_items' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_handover_items')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dhi_handover' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dhi_handover')) AS co
  UNION ALL
  SELECT '047_driver_handovers.sql' AS migration, 'index idx_dhi_product' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dhi_product')) AS co
  UNION ALL
  SELECT '057_handover_batch_code_fix.sql' AS migration, 'hàm confirm_driver_handover()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='confirm_driver_handover')) AS co
  UNION ALL
  SELECT '048_stock_balance_views.sql' AS migration, 'view v_stock_balance_by_zone' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_stock_balance_by_zone')) AS co
  UNION ALL
  SELECT '048_stock_balance_views.sql' AS migration, 'view v_stock_movements' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_stock_movements')) AS co
  UNION ALL
  SELECT '049_swap_stock.sql' AS migration, 'bảng swap_stock_movements' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='swap_stock_movements')) AS co
  UNION ALL
  SELECT '049_swap_stock.sql' AS migration, 'index idx_swap_entry' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_swap_entry')) AS co
  UNION ALL
  SELECT '049_swap_stock.sql' AS migration, 'index idx_swap_delivery' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_swap_delivery')) AS co
  UNION ALL
  SELECT '049_swap_stock.sql' AS migration, 'index idx_swap_open' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_swap_open')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'bảng payroll_runs' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payroll_runs')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'index idx_payroll_runs_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payroll_runs_status')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'bảng payroll_run_items' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payroll_run_items')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'index idx_payroll_items_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_payroll_items_user')) AS co
  UNION ALL
  SELECT '067_payroll_no_allowance_when_under_60.sql' AS migration, 'hàm compute_payroll_run()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='compute_payroll_run')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'hàm lock_payroll_run()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lock_payroll_run')) AS co
  UNION ALL
  SELECT '050_payroll.sql' AS migration, 'hàm enforce_payroll_lock()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enforce_payroll_lock')) AS co
  UNION ALL
  SELECT '051_handover_swap_link.sql' AS migration, 'driver_handover_items.swap_movement_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_handover_items' AND column_name='swap_movement_id')) AS co
  UNION ALL
  SELECT '051_handover_swap_link.sql' AS migration, 'index idx_dhi_swap' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dhi_swap')) AS co
  UNION ALL
  SELECT '052_order_activity_log.sql' AS migration, 'bảng order_activity_log' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='order_activity_log')) AS co
  UNION ALL
  SELECT '052_order_activity_log.sql' AS migration, 'index idx_oal_order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_oal_order')) AS co
  UNION ALL
  SELECT '052_order_activity_log.sql' AS migration, 'index idx_oal_actor' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_oal_actor')) AS co
  UNION ALL
  SELECT '052_order_activity_log.sql' AS migration, 'hàm log_sales_order_line_change()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='log_sales_order_line_change')) AS co
  UNION ALL
  SELECT '055_return_credit_excludes_exchange.sql' AS migration, 'hàm compute_return_credit()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='compute_return_credit')) AS co
  UNION ALL
  SELECT '055_return_credit_excludes_exchange.sql' AS migration, 'hàm sync_return_credit_note_amount()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_return_credit_note_amount')) AS co
  UNION ALL
  SELECT '056_deliveries_source_stock_entry.sql' AS migration, 'deliveries.source_stock_entry_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deliveries' AND column_name='source_stock_entry_id')) AS co
  UNION ALL
  SELECT '056_deliveries_source_stock_entry.sql' AS migration, 'index uniq_deliveries_source_stock_entry' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_deliveries_source_stock_entry')) AS co
  UNION ALL
  SELECT '061_hr_salary_kpi_target_revenue.sql' AS migration, 'hr_salary_config.kpi_target_revenue' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_salary_config' AND column_name='kpi_target_revenue')) AS co
  UNION ALL
  SELECT '064_payroll_allowances_and_breakdown.sql' AS migration, 'payroll_run_items.allowances' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payroll_run_items' AND column_name='allowances')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'purchase_invoices.created_by' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_invoices' AND column_name='created_by')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'purchase_invoices.completed_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_invoices' AND column_name='completed_at')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'purchase_invoices.stock_entry_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_invoices' AND column_name='stock_entry_id')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'constraint purchase_invoices_status_chk' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='purchase_invoices' AND c.conname='purchase_invoices_status_chk')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'bảng purchase_invoice_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='purchase_invoice_lines')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'index idx_pinv_lines_invoice' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pinv_lines_invoice')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'policy purchase_invoice_lines/View pinv lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoice_lines' AND policyname='View pinv lines')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'policy purchase_invoice_lines/Manage pinv lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_invoice_lines' AND policyname='Manage pinv lines')) AS co
  UNION ALL
  SELECT '065_purchase_invoice_simplified.sql' AS migration, 'hàm complete_purchase_invoice()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='complete_purchase_invoice')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'bảng supplier_returns' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_returns')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'index idx_sup_returns_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sup_returns_org')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'index idx_sup_returns_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sup_returns_supplier')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'index idx_sup_returns_status' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sup_returns_status')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'bảng supplier_return_lines' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='supplier_return_lines')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'index idx_sup_return_lines_return' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sup_return_lines_return')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'policy supplier_returns/View supplier returns' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_returns' AND policyname='View supplier returns')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'policy supplier_returns/Manage supplier returns' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_returns' AND policyname='Manage supplier returns')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'policy supplier_return_lines/View supplier return lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_return_lines' AND policyname='View supplier return lines')) AS co
  UNION ALL
  SELECT '068_supplier_returns.sql' AS migration, 'policy supplier_return_lines/Manage supplier return lines' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_return_lines' AND policyname='Manage supplier return lines')) AS co
  UNION ALL
  SELECT '071_supplier_return_better_stock_error.sql' AS migration, 'hàm complete_supplier_return()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='complete_supplier_return')) AS co
  UNION ALL
  SELECT '069_return_lines_vat.sql' AS migration, 'return_lines.vat_rate' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='return_lines' AND column_name='vat_rate')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'bảng company_einvoice_config' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_einvoice_config')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'policy company_einvoice_config/View einvoice config' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_einvoice_config' AND policyname='View einvoice config')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'policy company_einvoice_config/Manage einvoice config' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_einvoice_config' AND policyname='Manage einvoice config')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'bảng einvoice_logs' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='einvoice_logs')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'index idx_einvoice_logs_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_einvoice_logs_org')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'index idx_einvoice_logs_invoice' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_einvoice_logs_invoice')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'index idx_einvoice_logs_order' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_einvoice_logs_order')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'policy einvoice_logs/View einvoice logs' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='einvoice_logs' AND policyname='View einvoice logs')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'policy einvoice_logs/Manage einvoice logs' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='einvoice_logs' AND policyname='Manage einvoice logs')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'invoices.misa_lookup_code' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_lookup_code')) AS co
  UNION ALL
  SELECT '072_einvoice_misa.sql' AS migration, 'invoices.misa_published_at' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='misa_published_at')) AS co
  UNION ALL
  SELECT '075_einvoice_misa_paths.sql' AS migration, 'company_einvoice_config.token_path' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='token_path')) AS co
  UNION ALL
  SELECT '075_einvoice_misa_paths.sql' AS migration, 'company_einvoice_config.publish_path' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='publish_path')) AS co
  UNION ALL
  SELECT '076_einvoice_misa_appid_signtype.sql' AS migration, 'company_einvoice_config.misa_app_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='misa_app_id')) AS co
  UNION ALL
  SELECT '076_einvoice_misa_appid_signtype.sql' AS migration, 'company_einvoice_config.sign_type' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='sign_type')) AS co
  UNION ALL
  SELECT '078_einvoice_v3sainvoice.sql' AS migration, 'company_einvoice_config.invoice_type' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='invoice_type')) AS co
  UNION ALL
  SELECT '078_einvoice_v3sainvoice.sql' AS migration, 'company_einvoice_config.is_inherit_from_old_template' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='is_inherit_from_old_template')) AS co
  UNION ALL
  SELECT '079_einvoice_misa_with_code.sql' AS migration, 'company_einvoice_config.misa_is_invoice_with_code' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_einvoice_config' AND column_name='misa_is_invoice_with_code')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'bảng user_suppliers' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_suppliers')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'index idx_user_suppliers_user' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_user_suppliers_user')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'index idx_user_suppliers_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_user_suppliers_supplier')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'index idx_user_suppliers_org' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_user_suppliers_org')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'policy user_suppliers/Org members view user_supplier' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_suppliers' AND policyname='Org members view user_suppliers')) AS co
  UNION ALL
  SELECT '080_user_suppliers.sql' AS migration, 'policy user_suppliers/Owner/Manager manage user_supp' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_suppliers' AND policyname='Owner/Manager manage user_suppliers')) AS co
  UNION ALL
  SELECT '081_products_supplier_scope.sql' AS migration, 'policy products/View products (sales scoped by' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname='View products (sales scoped by supplier)')) AS co
  UNION ALL
  SELECT '082_search_customer_dupes.sql' AS migration, 'hàm search_customer_dupes()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='search_customer_dupes')) AS co
  UNION ALL
  SELECT '083_claim_customer_for_me.sql' AS migration, 'hàm claim_customer_for_me()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='claim_customer_for_me')) AS co
  UNION ALL
  SELECT '084_invoices_sales_scope.sql' AS migration, 'policy invoices/Admin roles can view all invoi' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Admin roles can view all invoices')) AS co
  UNION ALL
  SELECT '084_invoices_sales_scope.sql' AS migration, 'policy invoices/Sales see own invoices' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Sales see own invoices')) AS co
  UNION ALL
  SELECT '085_login_by_username_phone.sql' AS migration, 'users.username' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='username')) AS co
  UNION ALL
  SELECT '085_login_by_username_phone.sql' AS migration, 'index idx_users_username_unique' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_username_unique')) AS co
  UNION ALL
  SELECT '085_login_by_username_phone.sql' AS migration, 'index idx_users_phone_unique' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_users_phone_unique')) AS co
  UNION ALL
  SELECT '085_login_by_username_phone.sql' AS migration, 'hàm lookup_email_by_identifier()' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lookup_email_by_identifier')) AS co
  UNION ALL
  SELECT '086_allow_oversell.sql' AS migration, 'organizations.allow_oversell' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='allow_oversell')) AS co
  UNION ALL
  SELECT '088_qr_token_isolation.sql' AS migration, 'bảng qr_login_tokens' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='qr_login_tokens')) AS co
  UNION ALL
  SELECT '088_qr_token_isolation.sql' AS migration, 'index idx_qr_login_tokens_token' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_qr_login_tokens_token')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'sales_orders.client_request_id' AS doi_tuong, (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name='client_request_id')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'index idx_sales_orders_client_request_id' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sales_orders_client_request_id')) AS co
  UNION ALL
  SELECT '091_backfill_missing_objects.sql' AS migration, 'constraint products_price_edit_max_type_check' AS doi_tuong, (EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='products' AND c.conname='products_price_edit_max_type_check')) AS co
)
SELECT
  migration AS chay_migration_nay_de_bu,
  string_agg(doi_tuong, ', ' ORDER BY doi_tuong) AS doi_tuong_dang_thieu,
  count(*) AS so_luong
FROM mong_doi
WHERE NOT co
GROUP BY migration
ORDER BY migration;

-- Muốn xem toàn bộ (kể cả đối tượng đã có): đổi "WHERE NOT co" thành
-- "WHERE true" và bỏ GROUP BY.
