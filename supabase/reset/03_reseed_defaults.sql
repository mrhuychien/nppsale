-- =====================================================================
-- 03_reseed_defaults.sql — seed lại các config tối thiểu nếu thiếu
-- =====================================================================
-- Chạy sau khi reset nếu các bảng config rỗng (do truncate vô tình
-- hoặc do org mới tạo). An toàn chạy nhiều lần — dùng ON CONFLICT DO
-- NOTHING nên không ghi đè config đã chỉnh.

-- 1. Sales routes mặc định
INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'GT', 'General Trade', 1 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'MT', 'Modern Trade', 2 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'HORECA', 'Khách sạn / Nhà hàng', 3 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

-- 2. Expense categories mặc định
INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'COGS_ADJ', 'Điều chỉnh kiểm kê (giá vốn)', 'cogs' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'RENT', 'Tiền thuê mặt bằng', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'UTIL', 'Điện nước', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'FUEL', 'Xăng xe / vận chuyển', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'MKT', 'Marketing / khuyến mãi', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'SALARY', 'Lương', 'hr' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'TAX', 'Thuế', 'tax' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'OTHER', 'Chi phí khác', 'other' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

-- 3. Approval rules mặc định (1 row per org)
INSERT INTO approval_rules (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;
