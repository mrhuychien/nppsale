-- =====================================================================
-- Mockup Part 1: Config (customer_groups + verify routes & categories)
-- =====================================================================
-- Tạo 3 nhóm khách hàng (VIP, Thường, Mới) + chắc chắn sales_routes và
-- expense_categories đã có cho org đầu tiên.
--
-- Idempotent: chạy nhiều lần OK.

DO $$
DECLARE
  target_org_id uuid;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  IF target_org_id IS NULL THEN
    RAISE EXCEPTION 'Không có organization nào. Đăng ký 1 owner ở /login trước.';
  END IF;

  -- Customer groups
  INSERT INTO customer_groups (org_id, name, description)
  VALUES
    (target_org_id, 'VIP', 'Khách hàng lớn, doanh số cao'),
    (target_org_id, 'Thường', 'Khách hàng ổn định'),
    (target_org_id, 'Mới', 'Khách hàng mới khai thác')
  ON CONFLICT DO NOTHING;

  -- Sales routes (nếu chưa có từ migration 018)
  INSERT INTO sales_routes (org_id, code, name, sort_order) VALUES
    (target_org_id, 'GT', 'General Trade', 1),
    (target_org_id, 'MT', 'Modern Trade', 2),
    (target_org_id, 'HORECA', 'Khách sạn / Nhà hàng', 3)
  ON CONFLICT (org_id, code) DO NOTHING;

  -- Expense categories
  INSERT INTO expense_categories (org_id, code, name, bucket) VALUES
    (target_org_id, 'COGS_ADJ', 'Điều chỉnh kiểm kê (giá vốn)', 'cogs'),
    (target_org_id, 'RENT', 'Tiền thuê mặt bằng', 'operating'),
    (target_org_id, 'UTIL', 'Điện nước', 'operating'),
    (target_org_id, 'FUEL', 'Xăng xe / vận chuyển', 'operating'),
    (target_org_id, 'MKT', 'Marketing / khuyến mãi', 'operating'),
    (target_org_id, 'SALARY', 'Lương', 'hr'),
    (target_org_id, 'TAX', 'Thuế', 'tax'),
    (target_org_id, 'OTHER', 'Chi phí khác', 'other')
  ON CONFLICT (org_id, code) DO NOTHING;

  -- Approval rules
  INSERT INTO approval_rules (org_id) VALUES (target_org_id)
  ON CONFLICT (org_id) DO NOTHING;

  RAISE NOTICE 'Part 1 OK cho org %', target_org_id;
END $$;

-- Kiểm tra
SELECT 'customer_groups' AS t, count(*) FROM customer_groups
UNION ALL SELECT 'sales_routes', count(*) FROM sales_routes
UNION ALL SELECT 'expense_categories', count(*) FROM expense_categories
UNION ALL SELECT 'approval_rules', count(*) FROM approval_rules;
