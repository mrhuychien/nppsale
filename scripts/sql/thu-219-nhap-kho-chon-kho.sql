-- KIỂM MIG 219 (chủ nhà 30/09/2026: "làm migrate kho bán / kho date"): phiếu nhập kho ghi đúng kho nhận
-- vào cả phiếu lẫn lô; thiếu thì kho bán như cũ; kho lạ bị chặn. psql -f; in 'ĐẠT'/'LỖI'.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;

DO $t$
DECLARE r record; v_zone_phieu text; v_zone_lo text; v_loi text;
  dong jsonb := jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001',
    'unit_name', 'lon', 'qty_tx', 5, 'conv', 1, 'base_qty', 5, 'base_cost', 6000, 'expires_at', '2027-06-30'));
BEGIN
  -- 1. Kho date
  SELECT * INTO r FROM public.post_stock_import(jsonb_build_object('entry_code', 'IN-219-D', 'lines', dong, 'warehouse_zone', 'date'));
  SELECT warehouse_zone INTO v_zone_phieu FROM stock_entries WHERE id = r.entry_id;
  SELECT b.warehouse_zone INTO v_zone_lo FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = r.entry_id;
  INSERT INTO kq VALUES (1, 'Chọn Kho date → phiếu + lô ở kho date', v_zone_phieu = 'date' AND v_zone_lo = 'date', v_zone_phieu || '/' || v_zone_lo);
  -- 2. Không gửi kho (app cũ) → kho bán
  SELECT * INTO r FROM public.post_stock_import(jsonb_build_object('entry_code', 'IN-219-S', 'lines', dong));
  SELECT warehouse_zone INTO v_zone_phieu FROM stock_entries WHERE id = r.entry_id;
  SELECT b.warehouse_zone INTO v_zone_lo FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = r.entry_id;
  INSERT INTO kq VALUES (2, 'Thiếu kho nhận → kho bán như cũ', v_zone_phieu = 'sale' AND v_zone_lo = 'sale', v_zone_phieu || '/' || v_zone_lo);
  -- 3. Kho lạ → chặn, không ghi gì
  BEGIN
    PERFORM public.post_stock_import(jsonb_build_object('entry_code', 'IN-219-X', 'lines', dong, 'warehouse_zone', 'kho-lung'));
    v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM;
  END;
  INSERT INTO kq VALUES (3, 'Kho lạ bị chặn, không có phiếu', v_loi LIKE 'BAD_PAYLOAD%' AND NOT EXISTS (SELECT 1 FROM stock_entries WHERE entry_code = 'IN-219-X'), v_loi);
END $t$;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
ROLLBACK;
