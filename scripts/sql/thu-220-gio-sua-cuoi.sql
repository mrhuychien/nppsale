-- KIỂM MIG 220 (chủ nhà 01/10/2026: "Giờ sửa cuối. Hiện tại đang giờ tạo lần đầu"): updated_at đổi khi SỬA
-- nội dung chứng từ / dòng hàng; KHÔNG đổi khi chỉ đổi trạng thái / invoiced_qty / lô soạn. In 'ĐẠT'/'LỖI'.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean) ON COMMIT DROP;
DO $t$
DECLARE v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_kh uuid; v_don uuid; v_dong uuid; v_cu timestamptz := '2000-01-01';
  v timestamptz;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address) VALUES (v_org, 'Khách 220', 'A', '0900000220', 'x') RETURNING id INTO v_kh;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total, notes)
  VALUES (v_org, 'DH-220', v_kh, 'e0000000-0000-0000-0000-000000000004', current_date, 'draft', 'NET30', 100, 0, 0, 100, 'a') RETURNING id INTO v_don;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
  VALUES (v_don, 'c0000000-0000-0000-0000-000000000001', 'lon', 10, 10, 0, 100, 1) RETURNING id INTO v_dong;
  INSERT INTO kq SELECT 0, 'đơn mới có giờ sửa = lúc lập', updated_at IS NOT NULL FROM sales_orders WHERE id = v_don;

  UPDATE sales_orders SET updated_at = v_cu WHERE id = v_don;
  UPDATE sales_orders SET notes = 'b' WHERE id = v_don;
  SELECT updated_at INTO v FROM sales_orders WHERE id = v_don;
  INSERT INTO kq VALUES (1, 'sửa ghi chú đơn → giờ sửa đổi', v = now());

  UPDATE sales_orders SET updated_at = v_cu WHERE id = v_don;
  UPDATE sales_order_lines SET note = 'dòng sửa' WHERE id = v_dong;
  SELECT updated_at INTO v FROM sales_orders WHERE id = v_don;
  INSERT INTO kq VALUES (2, 'sửa ghi chú dòng (tổng không đổi) → giờ sửa đổi', v = now());

  UPDATE sales_orders SET updated_at = v_cu WHERE id = v_don;
  UPDATE sales_order_lines SET invoiced_qty = 10 WHERE id = v_dong;
  SELECT updated_at INTO v FROM sales_orders WHERE id = v_don;
  INSERT INTO kq VALUES (3, 'chỉ đổi invoiced_qty → KHÔNG đổi', v = v_cu);

  UPDATE sales_orders SET status = 'submitted' WHERE id = v_don;
  SELECT updated_at INTO v FROM sales_orders WHERE id = v_don;
  INSERT INTO kq VALUES (4, 'chỉ đổi trạng thái → KHÔNG đổi', v = v_cu);

  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
  VALUES (v_don, 'c0000000-0000-0000-0000-000000000001', 'lon', 1, 10, 0, 10, 1);
  SELECT updated_at INTO v FROM sales_orders WHERE id = v_don;
  INSERT INTO kq VALUES (5, 'thêm dòng → giờ sửa đổi', v = now());
END $t$;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten FROM kq ORDER BY buoc;
ROLLBACK;
