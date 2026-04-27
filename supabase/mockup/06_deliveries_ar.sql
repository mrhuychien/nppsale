-- =====================================================================
-- Mockup Part 6: Deliveries + Receivables + Payments
-- =====================================================================
-- - Tạo 2 chuyến đang in_transit gắn 2 đơn delivering (008, 009)
-- - Tạo 1 chuyến đã completed cho 3 đơn delivered (010, 011, 012) với
--   POD photo đã có và delivered_at.
-- - Tạo receivables cho 3 đơn delivered, 1 trong số đó đã thu một phần.

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  sales_user uuid;
  driver_user uuid;
  owner_user uuid;

  d1 uuid; d2 uuid; d3 uuid;

  ord_008 uuid; ord_009 uuid;
  ord_010 uuid; ord_011 uuid; ord_012 uuid;
  cust_f uuid; cust_h uuid; cust_l uuid;
  rec_010 uuid; rec_011 uuid; rec_012 uuid;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO sales_user FROM users WHERE org_id = target_org_id AND role = 'sales' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO driver_user FROM users WHERE org_id = target_org_id AND role = 'driver' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO owner_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;
  IF sales_user IS NULL THEN sales_user := owner_user; END IF;
  IF driver_user IS NULL THEN driver_user := owner_user; END IF;

  SELECT id INTO ord_008 FROM sales_orders WHERE order_code = 'DEMO-SO-008';
  SELECT id INTO ord_009 FROM sales_orders WHERE order_code = 'DEMO-SO-009';
  SELECT id INTO ord_010 FROM sales_orders WHERE order_code = 'DEMO-SO-010';
  SELECT id INTO ord_011 FROM sales_orders WHERE order_code = 'DEMO-SO-011';
  SELECT id INTO ord_012 FROM sales_orders WHERE order_code = 'DEMO-SO-012';
  SELECT customer_id INTO cust_f FROM sales_orders WHERE order_code = 'DEMO-SO-010';
  SELECT customer_id INTO cust_h FROM sales_orders WHERE order_code = 'DEMO-SO-011';
  SELECT customer_id INTO cust_l FROM sales_orders WHERE order_code = 'DEMO-SO-012';

  -- Xoá mock cũ
  DELETE FROM delivery_lines WHERE delivery_id IN (
    SELECT id FROM deliveries WHERE route_name LIKE 'DEMO: %'
  );
  DELETE FROM deliveries WHERE route_name LIKE 'DEMO: %';
  DELETE FROM payments WHERE receivable_id IN (
    SELECT id FROM receivables WHERE order_id IN (ord_010, ord_011, ord_012)
  );
  DELETE FROM receivables WHERE order_id IN (ord_010, ord_011, ord_012);

  -- Chuyến 1: in_transit, đang giao ord_008 (cust_e)
  INSERT INTO deliveries (org_id, driver_id, route_name, status, started_at)
  VALUES (target_org_id, driver_user, 'DEMO: Tuyến Q.3 sáng', 'in_transit', NOW() - INTERVAL '3 hours')
  RETURNING id INTO d1;
  INSERT INTO delivery_lines (delivery_id, order_id, status)
  VALUES (d1, ord_008, 'pending');

  -- Chuyến 2: in_transit, đang giao ord_009 (cust_k)
  INSERT INTO deliveries (org_id, driver_id, route_name, status, started_at)
  VALUES (target_org_id, driver_user, 'DEMO: Tuyến Q.5 sáng', 'in_transit', NOW() - INTERVAL '2 hours')
  RETURNING id INTO d2;
  INSERT INTO delivery_lines (delivery_id, order_id, status)
  VALUES (d2, ord_009, 'pending');

  -- Chuyến 3: completed — 3 đơn đã giao
  INSERT INTO deliveries (org_id, driver_id, route_name, status, started_at, completed_at)
  VALUES (target_org_id, driver_user, 'DEMO: Tuyến Q.7+8+1 tuần trước', 'completed',
    NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '4 hours')
  RETURNING id INTO d3;
  INSERT INTO delivery_lines (delivery_id, order_id, status, delivered_at, pod_photo_url, notes) VALUES
    (d3, ord_010, 'delivered', NOW() - INTERVAL '5 days' + INTERVAL '1 hour',  NULL, 'Giao thành công'),
    (d3, ord_011, 'delivered', NOW() - INTERVAL '7 days' + INTERVAL '2 hours', NULL, 'Giao thành công'),
    (d3, ord_012, 'delivered', NOW() - INTERVAL '10 days' + INTERVAL '3 hours', NULL, 'Giao thành công');

  -- Receivables cho 3 đơn delivered
  INSERT INTO receivables (org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status)
  VALUES
    (target_org_id, ord_010, cust_f, sales_user, 1835000, 0,        CURRENT_DATE + 10, 'open')
  RETURNING id INTO rec_010;
  INSERT INTO receivables (org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status)
  VALUES
    (target_org_id, ord_011, cust_h, sales_user, 4100000, 2000000,  CURRENT_DATE + 23, 'partial')
  RETURNING id INTO rec_011;
  INSERT INTO receivables (org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status)
  VALUES
    (target_org_id, ord_012, cust_l, sales_user, 1620000, 1620000,  CURRENT_DATE + 20, 'paid')
  RETURNING id INTO rec_012;

  -- Payments
  INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at, verified_at) VALUES
    (rec_011, sales_user, 2000000, 'cash',     NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
    (rec_012, sales_user, 1620000, 'transfer', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days');

  RAISE NOTICE 'Part 6 OK: 3 chuyến + 3 receivables + 2 payments';
END $$;

COMMIT;

SELECT 'deliveries' AS t, status, count(*) FROM deliveries WHERE route_name LIKE 'DEMO: %' GROUP BY status
UNION ALL SELECT 'receivables', status, count(*) FROM receivables GROUP BY status
UNION ALL SELECT 'payments', method, count(*) FROM payments GROUP BY method;
