-- =====================================================================
-- Mockup Part 5: 12 đơn hàng trải đều status
-- =====================================================================
-- 2 draft (có approval_reason), 3 confirmed, 2 picking, 2 delivering,
-- 3 delivered. Mỗi đơn 2-3 line. Giá lấy từ price_lists mặc định.
-- Tồn kho bị TRỪ cho picking/delivering/delivered để đúng với flow
-- bàn giao thực tế.

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  sales_user uuid;
  owner_user uuid;
  today date := CURRENT_DATE;
  -- Helper cục bộ
  cust_a uuid; cust_b uuid; cust_c uuid; cust_d uuid; cust_e uuid; cust_f uuid;
  cust_g uuid; cust_h uuid; cust_i uuid; cust_j uuid; cust_k uuid; cust_l uuid;
  p_oil uuid; p_bis uuid; p_noodle uuid; p_drink uuid; p_milk uuid; p_beer uuid; p_sauce uuid;
  b_oil uuid; b_bis uuid; b_noodle uuid; b_drink uuid; b_milk uuid; b_beer uuid; b_sauce uuid;
  new_order_id uuid;
  subtotal_v numeric;
  vat_v numeric;
  total_v numeric;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO sales_user FROM users WHERE org_id = target_org_id AND role = 'sales' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO owner_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;
  IF sales_user IS NULL THEN sales_user := owner_user; END IF;

  -- Customers
  SELECT id INTO cust_a FROM customers WHERE phone = '09DEMO00001';
  SELECT id INTO cust_b FROM customers WHERE phone = '09DEMO00002';
  SELECT id INTO cust_c FROM customers WHERE phone = '09DEMO00003';
  SELECT id INTO cust_d FROM customers WHERE phone = '09DEMO00004';
  SELECT id INTO cust_e FROM customers WHERE phone = '09DEMO00005';
  SELECT id INTO cust_f FROM customers WHERE phone = '09DEMO00006';
  SELECT id INTO cust_g FROM customers WHERE phone = '09DEMO00007';
  SELECT id INTO cust_h FROM customers WHERE phone = '09DEMO00008';
  SELECT id INTO cust_i FROM customers WHERE phone = '09DEMO00009';
  SELECT id INTO cust_j FROM customers WHERE phone = '09DEMO00010';
  SELECT id INTO cust_k FROM customers WHERE phone = '09DEMO00011';
  SELECT id INTO cust_l FROM customers WHERE phone = '09DEMO00012';

  -- Products & batches
  SELECT id INTO p_oil    FROM products WHERE sku = 'DEMO-OIL-01';
  SELECT id INTO p_bis    FROM products WHERE sku = 'DEMO-BIS-01';
  SELECT id INTO p_noodle FROM products WHERE sku = 'DEMO-NOODLE-01';
  SELECT id INTO p_drink  FROM products WHERE sku = 'DEMO-DRINK-01';
  SELECT id INTO p_milk   FROM products WHERE sku = 'DEMO-MILK-01';
  SELECT id INTO p_beer   FROM products WHERE sku = 'DEMO-BEER-01';
  SELECT id INTO p_sauce  FROM products WHERE sku = 'DEMO-SAUCE-01';

  SELECT id INTO b_oil    FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-OIL-01';
  SELECT id INTO b_bis    FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-BIS-01';
  SELECT id INTO b_noodle FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-NOODLE-01';
  SELECT id INTO b_drink  FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-DRINK-01';
  SELECT id INTO b_milk   FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-MILK-01';
  SELECT id INTO b_beer   FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-BEER-01';
  SELECT id INTO b_sauce  FROM batches WHERE batch_code = 'DEMO-LOT-DEMO-SAUCE-01';

  -- Xóa mock cũ
  DELETE FROM sales_orders WHERE order_code LIKE 'DEMO-SO-%';

  -- =================================================================
  -- Helper: tạo 1 order + 2 lines + auto subtotal/vat/total
  -- Dùng dynamic SQL đơn giản qua INSERT returning id rồi lines riêng.
  -- =================================================================

  -- === ĐƠN 1: draft, CẦN DUYỆT (giá trị lớn) ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approval_reason)
  VALUES (target_org_id, 'DEMO-SO-001', cust_g, sales_user, today - 1, 'draft', 'NET45',
    0, 0, 0,
    'Đơn 25.000.000₫ vượt ngưỡng tự động duyệt (20.000.000₫) — cần Manager duyệt')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES
    (new_order_id, p_oil, 'chai', 200, 45000, 9000000),
    (new_order_id, p_beer, 'lon', 500, 20000, 10000000),
    (new_order_id, p_bis, 'hộp', 120, 50000, 6000000);
  UPDATE sales_orders SET subtotal = 25000000, vat = 2225000, total = 27225000 WHERE id = new_order_id;

  -- === ĐƠN 2: draft, cần duyệt ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approval_reason)
  VALUES (target_org_id, 'DEMO-SO-002', cust_i, sales_user, today, 'draft', 'NET45',
    22500000, 2075000, 24575000,
    'Đơn 24.575.000₫ vượt ngưỡng tự động duyệt')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES
    (new_order_id, p_beer, 'lon', 500, 20000, 10000000),
    (new_order_id, p_drink, 'lon', 1000, 9000, 9000000),
    (new_order_id, p_milk, 'hộp', 500, 7500, 3500000);

  -- === ĐƠN 3-5: confirmed (đã duyệt, chưa xuất) ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-003', cust_a, sales_user, today, 'confirmed', 'NET30',
    2250000, 180000, 2430000, owner_user, NOW() - INTERVAL '2 hours')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES
    (new_order_id, p_oil, 'chai', 30, 45000, 1350000),
    (new_order_id, p_bis, 'hộp', 18, 50000, 900000);

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-004', cust_b, sales_user, today, 'confirmed', 'COD',
    1350000, 120000, 1470000, owner_user, NOW() - INTERVAL '1 hour')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES
    (new_order_id, p_noodle, 'gói', 200, 4500, 900000),
    (new_order_id, p_sauce, 'chai', 15, 28000, 420000);

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-005', cust_j, sales_user, today, 'confirmed', 'NET15',
    1740000, 140000, 1880000, owner_user, NOW())
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total)
  VALUES
    (new_order_id, p_drink, 'lon', 120, 9000, 1080000),
    (new_order_id, p_beer, 'lon', 30, 20000, 600000),
    (new_order_id, p_bis, 'hộp', 2, 50000, 100000);

  -- === ĐƠN 6-7: picking (đã xuất draft, chưa bàn giao) ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-006', cust_c, sales_user, today - 1, 'picking', 'COD',
    1320000, 105000, 1425000, owner_user, NOW() - INTERVAL '1 day')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_oil, 'chai', 20, 45000, 900000, b_oil),
    (new_order_id, p_noodle, 'gói', 80, 4500, 360000, b_noodle);

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-007', cust_d, sales_user, today - 1, 'picking', 'COD',
    880000, 70000, 950000, owner_user, NOW() - INTERVAL '1 day')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_bis, 'hộp', 10, 50000, 500000, b_bis),
    (new_order_id, p_drink, 'lon', 40, 9000, 360000, b_drink);

  -- === ĐƠN 8-9: delivering (đang giao — stock đã trừ) ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-008', cust_e, sales_user, today - 2, 'delivering', 'NET15',
    2160000, 170000, 2330000, owner_user, NOW() - INTERVAL '2 days')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_oil, 'chai', 40, 45000, 1800000, b_oil),
    (new_order_id, p_sauce, 'chai', 12, 28000, 336000, b_sauce);
  -- Trừ tồn
  UPDATE batches SET qty_on_hand = qty_on_hand - 40 WHERE id = b_oil;
  UPDATE batches SET qty_on_hand = qty_on_hand - 12 WHERE id = b_sauce;

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-009', cust_k, sales_user, today - 2, 'delivering', 'NET15',
    2660000, 230000, 2890000, owner_user, NOW() - INTERVAL '2 days')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_beer, 'lon', 100, 20000, 2000000, b_beer),
    (new_order_id, p_drink, 'lon', 60, 9000, 540000, b_drink);
  UPDATE batches SET qty_on_hand = qty_on_hand - 100 WHERE id = b_beer;
  UPDATE batches SET qty_on_hand = qty_on_hand - 60 WHERE id = b_drink;

  -- === ĐƠN 10-12: delivered (đã giao — stock trừ, có receivable) ===
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-010', cust_f, sales_user, today - 5, 'delivered', 'NET15',
    1700000, 135000, 1835000, owner_user, NOW() - INTERVAL '5 days')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_oil, 'chai', 20, 45000, 900000, b_oil),
    (new_order_id, p_noodle, 'gói', 100, 4500, 450000, b_noodle),
    (new_order_id, p_bis, 'hộp', 7, 50000, 350000, b_bis);
  UPDATE batches SET qty_on_hand = qty_on_hand - 20 WHERE id = b_oil;
  UPDATE batches SET qty_on_hand = qty_on_hand - 100 WHERE id = b_noodle;
  UPDATE batches SET qty_on_hand = qty_on_hand - 7 WHERE id = b_bis;

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-011', cust_h, sales_user, today - 7, 'delivered', 'NET30',
    3800000, 300000, 4100000, owner_user, NOW() - INTERVAL '7 days')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_beer, 'lon', 150, 20000, 3000000, b_beer),
    (new_order_id, p_drink, 'lon', 80, 9000, 720000, b_drink),
    (new_order_id, p_milk, 'hộp', 10, 7500, 75000, b_milk);
  UPDATE batches SET qty_on_hand = qty_on_hand - 150 WHERE id = b_beer;
  UPDATE batches SET qty_on_hand = qty_on_hand - 80 WHERE id = b_drink;
  UPDATE batches SET qty_on_hand = qty_on_hand - 10 WHERE id = b_milk;

  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, vat, total, approved_by, approved_at)
  VALUES (target_org_id, 'DEMO-SO-012', cust_l, sales_user, today - 10, 'delivered', 'NET30',
    1500000, 120000, 1620000, owner_user, NOW() - INTERVAL '10 days')
  RETURNING id INTO new_order_id;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, batch_id)
  VALUES
    (new_order_id, p_drink, 'lon', 100, 9000, 900000, b_drink),
    (new_order_id, p_noodle, 'gói', 130, 4500, 585000, b_noodle);
  UPDATE batches SET qty_on_hand = qty_on_hand - 100 WHERE id = b_drink;
  UPDATE batches SET qty_on_hand = qty_on_hand - 130 WHERE id = b_noodle;

  RAISE NOTICE 'Part 5 OK: 12 đơn hàng (2 draft / 3 confirmed / 2 picking / 2 delivering / 3 delivered)';
END $$;

COMMIT;

SELECT status, count(*) FROM sales_orders WHERE order_code LIKE 'DEMO-SO-%' GROUP BY status ORDER BY status;
SELECT 'remaining stock' AS t, batch_code, qty_on_hand FROM batches WHERE batch_code LIKE 'DEMO-LOT-%' ORDER BY batch_code;
