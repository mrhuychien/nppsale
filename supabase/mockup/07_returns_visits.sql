-- =====================================================================
-- Mockup Part 7: Returns (approved) + Visit logs
-- =====================================================================
-- - 2 đơn trả hàng đã duyệt — sẽ hiện trong /inventory/pending tab
--   "Đơn chờ nhập", có thể chọn để tạo phiếu Nhập lại kho.
-- - Visit logs 3 ngày gần đây: hỗn hợp order_placed / no_order.

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  sales_user uuid;
  owner_user uuid;
  ord_011 uuid;
  ord_012 uuid;
  cust_h uuid; cust_l uuid;
  p_drink uuid; p_bis uuid; p_milk uuid; p_oil uuid;

  ret_1 uuid;
  ret_2 uuid;

  -- Customer id array for visits
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO sales_user FROM users WHERE org_id = target_org_id AND role = 'sales' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO owner_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;
  IF sales_user IS NULL THEN sales_user := owner_user; END IF;

  SELECT id INTO ord_011 FROM sales_orders WHERE order_code = 'DEMO-SO-011';
  SELECT id INTO ord_012 FROM sales_orders WHERE order_code = 'DEMO-SO-012';
  SELECT customer_id INTO cust_h FROM sales_orders WHERE id = ord_011;
  SELECT customer_id INTO cust_l FROM sales_orders WHERE id = ord_012;

  SELECT id INTO p_drink FROM products WHERE sku = 'DEMO-DRINK-01';
  SELECT id INTO p_bis   FROM products WHERE sku = 'DEMO-BIS-01';
  SELECT id INTO p_milk  FROM products WHERE sku = 'DEMO-MILK-01';
  SELECT id INTO p_oil   FROM products WHERE sku = 'DEMO-OIL-01';

  -- Xoá mock cũ
  DELETE FROM returns WHERE notes LIKE 'DEMO%';
  DELETE FROM visit_logs WHERE notes LIKE 'DEMO%';

  -- === Return 1 (approved) — từ đơn 011 ===
  INSERT INTO returns (org_id, order_id, customer_id, requested_by, reason, status, approved_by, credit_note_amount, notes)
  VALUES (target_org_id, ord_011, cust_h, sales_user, 'damaged', 'approved', owner_user, 180000, 'DEMO: 10 lon bia bị móp')
  RETURNING id INTO ret_1;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total) VALUES
    (ret_1, p_drink, 'lon', 20, 9000, 180000);

  -- === Return 2 (approved) — từ đơn 012 ===
  INSERT INTO returns (org_id, order_id, customer_id, requested_by, reason, status, approved_by, credit_note_amount, notes)
  VALUES (target_org_id, ord_012, cust_l, sales_user, 'near_expiry', 'approved', owner_user, 90000, 'DEMO: Sữa gần hết hạn, KH từ chối')
  RETURNING id INTO ret_2;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, line_total) VALUES
    (ret_2, p_milk, 'hộp', 12, 7500, 90000);

  -- === Visit logs ===
  -- Lấy 6 customer đầu tiên để tạo 6 lượt ghé 3 ngày gần đây
  SELECT id INTO c1 FROM customers WHERE phone = '09DEMO00001';
  SELECT id INTO c2 FROM customers WHERE phone = '09DEMO00002';
  SELECT id INTO c3 FROM customers WHERE phone = '09DEMO00003';
  SELECT id INTO c4 FROM customers WHERE phone = '09DEMO00004';
  SELECT id INTO c5 FROM customers WHERE phone = '09DEMO00005';
  SELECT id INTO c6 FROM customers WHERE phone = '09DEMO00006';

  INSERT INTO visit_logs (org_id, sales_user_id, customer_id, visit_date, check_in_at, check_out_at, check_in_lat, check_in_lng, result, notes) VALUES
    -- Hôm qua
    (target_org_id, sales_user, c1, CURRENT_DATE - 1, NOW() - INTERVAL '1 day 7 hours',  NOW() - INTERVAL '1 day 6 hours 30 min', 10.7769, 106.7009, 'order_placed', 'DEMO: KH đặt thêm dầu ăn'),
    (target_org_id, sales_user, c2, CURRENT_DATE - 1, NOW() - INTERVAL '1 day 6 hours',  NOW() - INTERVAL '1 day 5 hours 45 min', 10.7746, 106.7038, 'order_placed', 'DEMO: KH VIP, quan hệ tốt'),
    (target_org_id, sales_user, c3, CURRENT_DATE - 1, NOW() - INTERVAL '1 day 4 hours',  NOW() - INTERVAL '1 day 3 hours 50 min', 10.7855, 106.6932, 'no_order',     'DEMO: KH chưa cần đặt'),
    -- Hôm nay sáng
    (target_org_id, sales_user, c4, CURRENT_DATE,     NOW() - INTERVAL '3 hours',        NOW() - INTERVAL '2 hours 40 min', 10.7866, 106.6925, 'closed',       'DEMO: Cửa hàng đóng cửa'),
    (target_org_id, sales_user, c5, CURRENT_DATE,     NOW() - INTERVAL '2 hours',        NOW() - INTERVAL '1 hour 45 min', 10.7712, 106.6665, 'order_placed', 'DEMO: Đặt 50 gói mì'),
    (target_org_id, sales_user, c6, CURRENT_DATE,     NOW() - INTERVAL '1 hour',         NULL, 10.7680, 106.6700, 'no_order',     'DEMO: Đang check hàng');

  RAISE NOTICE 'Part 7 OK: 2 returns approved + 6 visit_logs';
END $$;

COMMIT;

SELECT 'returns' AS t, status, count(*) FROM returns WHERE notes LIKE 'DEMO%' GROUP BY status
UNION ALL SELECT 'visits', result, count(*) FROM visit_logs WHERE notes LIKE 'DEMO%' GROUP BY result;
