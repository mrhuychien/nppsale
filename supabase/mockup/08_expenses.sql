-- =====================================================================
-- Mockup Part 8: Chi phí vận hành tháng hiện tại
-- =====================================================================
-- 8 dòng expenses phân bổ qua các bucket: operating, hr, tax, other.
-- Sẽ xuất hiện trong /finance/expenses và P&L /reports/finance/pnl.

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  owner_user uuid;
  cat_rent uuid; cat_util uuid; cat_fuel uuid; cat_mkt uuid;
  cat_salary uuid; cat_tax uuid; cat_other uuid;
  month_start date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO owner_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;

  SELECT id INTO cat_rent   FROM expense_categories WHERE org_id = target_org_id AND code = 'RENT';
  SELECT id INTO cat_util   FROM expense_categories WHERE org_id = target_org_id AND code = 'UTIL';
  SELECT id INTO cat_fuel   FROM expense_categories WHERE org_id = target_org_id AND code = 'FUEL';
  SELECT id INTO cat_mkt    FROM expense_categories WHERE org_id = target_org_id AND code = 'MKT';
  SELECT id INTO cat_salary FROM expense_categories WHERE org_id = target_org_id AND code = 'SALARY';
  SELECT id INTO cat_tax    FROM expense_categories WHERE org_id = target_org_id AND code = 'TAX';
  SELECT id INTO cat_other  FROM expense_categories WHERE org_id = target_org_id AND code = 'OTHER';

  -- Xoá mock cũ
  DELETE FROM expenses WHERE reference_code LIKE 'DEMO-%';

  INSERT INTO expenses (org_id, category_id, expense_date, amount, description, reference_code, is_paid, paid_at, payment_method, created_by) VALUES
    (target_org_id, cat_rent,   month_start + 0,  15000000, 'Thuê kho Tân Bình tháng hiện tại',       'DEMO-RENT-01',   true,  month_start + 0  + INTERVAL '8 hours', 'transfer', owner_user),
    (target_org_id, cat_salary, month_start + 0,  42000000, 'Lương NV tháng hiện tại (5 người)',      'DEMO-SAL-01',    true,  month_start + 0  + INTERVAL '9 hours', 'transfer', owner_user),
    (target_org_id, cat_util,   month_start + 2,  2800000,  'Tiền điện kho + văn phòng',              'DEMO-UTIL-01',   true,  month_start + 2  + INTERVAL '10 hours','transfer', owner_user),
    (target_org_id, cat_util,   month_start + 3,  850000,   'Tiền nước',                              'DEMO-UTIL-02',   true,  month_start + 3  + INTERVAL '10 hours','cash',     owner_user),
    (target_org_id, cat_fuel,   month_start + 5,  3500000,  'Xăng xe tải giao hàng 2 tuần đầu',       'DEMO-FUEL-01',   true,  month_start + 5  + INTERVAL '14 hours','cash',     owner_user),
    (target_org_id, cat_mkt,    month_start + 7,  5000000,  'In banner + tờ rơi chương trình KM',     'DEMO-MKT-01',    true,  month_start + 7  + INTERVAL '11 hours','transfer', owner_user),
    (target_org_id, cat_tax,    month_start + 10, 1200000,  'Thuế môn bài quý',                       'DEMO-TAX-01',    false, NULL, NULL, owner_user),
    (target_org_id, cat_other,  month_start + 12, 450000,   'Văn phòng phẩm + bảo trì máy in',        'DEMO-OTHER-01',  true,  month_start + 12 + INTERVAL '16 hours','cash',     owner_user);

  RAISE NOTICE 'Part 8 OK: 8 chi phí vận hành tháng hiện tại';
END $$;

COMMIT;

SELECT
  ec.bucket,
  count(*) AS n,
  sum(e.amount) AS total
FROM expenses e
JOIN expense_categories ec ON ec.id = e.category_id
WHERE e.reference_code LIKE 'DEMO-%'
GROUP BY ec.bucket
ORDER BY ec.bucket;
