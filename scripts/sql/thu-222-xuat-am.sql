-- KIỂM MIG 222 (chủ nhà 02/10/2026: "Khi bật cho phép xuất tồn âm thì các phiếu xuất, trả ... liên quan đến kho
-- cho phép âm hết, hiện tại xuất trả NCC ko cho phép xuất tồn âm"). Kho bán có 5 lon:
--   tắt cờ → trả NCC 8 / xuất kho 9 bị chặn như cũ; bật cờ → ghi sổ được, lô về 0, phần thiếu nằm trên phiếu;
--   huỷ phiếu trả NCC chỉ hoàn 5 (không cộng khống 3). psql -f; in 'ĐẠT'/'LỖI'.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);

-- Dựng: NCC + tồn sạch 5 lon ở kho bán (quyền chủ DB — chỉ là dữ liệu thử).
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO suppliers (id, org_id, name) VALUES ('f2220000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 222')
  ON CONFLICT (id) DO NOTHING;
ALTER TABLE batches DISABLE TRIGGER USER;
UPDATE batches SET qty_on_hand = 0 WHERE product_id = 'c0000000-0000-0000-0000-000000000001';
ALTER TABLE batches ENABLE TRIGGER USER;

SET LOCAL ROLE authenticated;
DO $t$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.post_stock_import(jsonb_build_object('entry_code', 'IN-222', 'warehouse_zone', 'sale', 'lines',
    jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon',
      'qty_tx', 5, 'conv', 1, 'base_qty', 5, 'base_cost', 6000, 'expires_at', '2027-06-30'))));
END $t$;
RESET ROLE;

-- Phiếu nháp: trả NCC 8 lon, xuất kho lẻ 9 lon.
INSERT INTO supplier_returns (id, org_id, supplier_id, status, warehouse_zone, created_by)
VALUES ('f2220000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'f2220000-0000-0000-0000-000000000001', 'draft', 'sale', 'e0000000-0000-0000-0000-000000000001');
INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, conversion_factor, line_total, line_discount, sort_order)
VALUES ('f2220000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', 'lon', 8, 6000, 0, 1, 48000, 0, 1);
INSERT INTO stock_entries (id, org_id, entry_code, type, status, warehouse_zone, created_by, issue_reason)
VALUES ('f2220000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'XK-222', 'export', 'draft', 'sale', 'e0000000-0000-0000-0000-000000000001', 'damaged');
INSERT INTO stock_entry_lines (entry_id, product_id, unit_name, quantity, qty_in_base_uom)
VALUES ('f2220000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-000000000001', 'lon', 9, 9);

-- 1–2. Tắt cờ: chặn như cũ.
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.complete_supplier_return('f2220000-0000-0000-0000-0000000000a1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'Tắt cờ: trả NCC vượt tồn bị chặn', v_loi LIKE 'INSUFFICIENT_STOCK%', v_loi);
  BEGIN PERFORM public.post_stock_issue('f2220000-0000-0000-0000-0000000000b1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (2, 'Tắt cờ: phiếu xuất kho vượt tồn bị chặn', v_loi LIKE 'KHONG_DU_TON%', v_loi);
END $t$;
RESET ROLE;

-- 3–6. Bật cờ "Cho phép bán vượt tồn kho".
UPDATE organizations SET allow_oversell = true WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_ton numeric; v_tren_phieu numeric; v_thieu numeric; v_no numeric; v_tt text;
BEGIN
  PERFORM public.complete_supplier_return('f2220000-0000-0000-0000-0000000000a1');
  SELECT status INTO v_tt FROM supplier_returns WHERE id = 'f2220000-0000-0000-0000-0000000000a1';
  SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_ton FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale';
  SELECT SUM(l.qty_in_base_uom), SUM(l.qty_in_base_uom) FILTER (WHERE l.batch_id IS NULL) INTO v_tren_phieu, v_thieu
    FROM stock_entry_lines l JOIN supplier_returns s ON s.stock_entry_id = l.entry_id WHERE s.id = 'f2220000-0000-0000-0000-0000000000a1';
  SELECT p.amount INTO v_no FROM payables p JOIN supplier_returns s ON s.payable_credit_id = p.id WHERE s.id = 'f2220000-0000-0000-0000-0000000000a1';
  INSERT INTO kq VALUES (3, 'Bật cờ: trả NCC 8 khi còn 5 → gửi được, lô về 0, phiếu ghi đủ 8 (3 không lô), giảm nợ đủ 48.000',
    v_tt = 'completed' AND v_ton = 0 AND v_tren_phieu = 8 AND v_thieu = 3 AND v_no = -48000,
    format('tt=%s tồn=%s phiếu=%s thiếu=%s nợ=%s', v_tt, v_ton, v_tren_phieu, v_thieu, v_no));

  PERFORM public.cancel_supplier_return('f2220000-0000-0000-0000-0000000000a1', 'thử 222');
  SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_ton FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale';
  INSERT INTO kq VALUES (4, 'Huỷ phiếu trả NCC đó → kho về 5 (không cộng khống phần thiếu)', v_ton = 5, 'tồn=' || v_ton);

  PERFORM public.post_stock_issue('f2220000-0000-0000-0000-0000000000b1');
  SELECT status INTO v_tt FROM stock_entries WHERE id = 'f2220000-0000-0000-0000-0000000000b1';
  SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_ton FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale';
  SELECT COALESCE(SUM(c.qty_in_base_uom), 0) INTO v_thieu FROM stock_line_consumptions c JOIN stock_entry_lines l ON l.id = c.line_id
   WHERE l.entry_id = 'f2220000-0000-0000-0000-0000000000b1';
  INSERT INTO kq VALUES (5, 'Bật cờ: phiếu xuất kho 9 khi còn 5 → ghi sổ được, lô về 0, vết lấy lô 5',
    v_tt = 'posted' AND v_ton = 0 AND v_thieu = 5, format('tt=%s tồn=%s vết=%s', v_tt, v_ton, v_thieu));
END $t$;
RESET ROLE;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
ROLLBACK;
