-- ====================================================================
-- ĐỘI TEST "KHO & MUA HÀNG" — bộ chống lỗi lâu dài (các phép kiểm ĐANG XANH).
--   Chạy (DB thử ở máy, KHÔNG chạy trên Supabase):
--     psql -h /tmp/pgtest -p 55432 -U postgres -d npp_kho -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/kho.sql
--   Toàn bộ trong BEGIN … ROLLBACK; kết quả ở bảng tạm kq(buoc, ten, ok, ghi), cuối SELECT.
--   Mỗi kịch bản là một khối DO có bẫy lỗi: nổ bất ngờ → một dòng ok=false "NỔ".
--   Lỗi sản phẩm đã xác minh nằm riêng ở kho-loi.sql (đang ĐỎ, sửa xong thành xanh).
--
-- Luật đem ra kiểm (CLAUDE.md + lời chủ nhà trong migration):
--   · `unit_cost` (kho) là giá MỖI ĐƠN VỊ CƠ SỞ; số lượng quy về đơn vị cơ sở (thùng × hệ số).
--   · Tồn kho / trạng thái chứng từ chỉ đổi qua RPC — không ghi thẳng (mig 214).
--   · Nhập kho: chỉ chủ NPP / thủ kho; kho nhận sale|date (mig 219); ngày ghi sổ là mốc FIFO.
--   · Xuất kho: FIFO kho bán (post_stock_export) / hạn cũ trước (post_stock_issue); bấm hai lần không trừ hai lần;
--     không đủ hàng → chặn (trừ khi bật allow_oversell, mig 222).
--   · Huỷ phiếu = hoàn đúng lô; phiếu có chứng từ gốc phải huỷ ở chứng từ gốc (mig 166).
--   · Kiểm kê: thủ kho lập NHÁP, người có quyền inventory.approve duyệt; hao hụt ghi chi phí.
--   · Phiếu nhập NCC: giá vốn = (SL × giá − CK dòng) / SL cơ sở; công nợ NCC = tiền hàng + thuế − CK phiếu.
--   · Soạn hàng (mig 224-225): chỉ owner/manager/warehouse/accountant; hoàn tất KHÔNG trừ kho.
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;

-- Quyền như Supabase cho vai trình duyệt (chỉ DB thử của đội).
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON luot_soan FROM authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
GRANT ALL ON kq TO authenticated;
GRANT ALL ON SEQUENCE kq_stt_seq TO authenticated;

-- ---------------------------------------------------------------------
-- Tiện ích (1 owner, 2 manager, 3 accountant, 4 sales, 5 warehouse)
-- ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;
CREATE FUNCTION pg_temp.org() RETURNS uuid LANGUAGE sql AS $f$ SELECT 'a0000000-0000-0000-0000-000000000001'::uuid $f$;

CREATE FUNCTION pg_temp.ghi(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS
$f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi) $f$;

-- Chạy một câu dưới danh nghĩa user n, vai Postgres `authenticated` như trình duyệt. Trả mã lỗi (phần trước
-- dấu ':' đầu tiên) hoặc NULL khi chạy được.
CREATE FUNCTION pg_temp.thu(p_n int, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN split_part(SQLERRM, ':', 1);
END $f$;
-- Như thu() nhưng trả nguyên câu lỗi.
CREATE FUNCTION pg_temp.loi(p_n int, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN SQLERRM;
END $f$;
-- Chạy câu trả MỘT giá trị (uuid) dưới danh nghĩa user n.
CREATE FUNCTION pg_temp.lay(p_n int, p_sql text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO v;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.lay_json(p_n int, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p_n)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO v;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN v;
END $f$;

-- Sản phẩm riêng của đội: đơn vị cơ sở 'hop', đơn vị lớn 'thung' = 24.
CREATE FUNCTION pg_temp.sp(p_tag text, p_shelf int DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status, shelf_life_days)
  VALUES (pg_temp.org(), 'DK-' || p_tag, 'Đội kho ' || p_tag, 'hop', 0, 10000, 'active', p_shelf) RETURNING id INTO v;
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (v, 'thung', 24);
  RETURN v;
END $f$;
-- Lô dựng sẵn (quyền chủ DB — chỉ là dữ liệu thử): tồn, giá vốn, hạn sau n ngày, kho, ngày nhận lùi n ngày.
CREATE FUNCTION pg_temp.lo(p uuid, p_code text, p_qty numeric, p_cost numeric, p_han int, p_zone text DEFAULT 'sale', p_lui int DEFAULT 10)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (pg_temp.org(), p, p_code, current_date + p_han, p_qty, p_qty, p_cost, p_zone, now() - make_interval(days => p_lui))
  RETURNING id INTO v;
  -- Trigger tự đẩy lô cận hạn về kho date; ép lại đúng kho thử muốn.
  UPDATE batches SET warehouse_zone = p_zone WHERE id = v;
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.ton(p uuid, z text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND (z IS NULL OR warehouse_zone = z) $f$;
CREATE FUNCTION pg_temp.ton_lo(b uuid) RETURNS numeric LANGUAGE sql AS $f$ SELECT qty_on_hand FROM batches WHERE id = b $f$;
-- Thẻ kho (v_stock_movements, chỉ phiếu đã ghi sổ — như ngăn kéo Lịch sử) cộng theo kho.
CREATE FUNCTION pg_temp.the(p uuid, z text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(signed_qty_in_base_uom), 0) FROM v_stock_movements
   WHERE product_id = p AND warehouse_zone = z AND entry_status = 'posted' $f$;
-- Payload một dòng nhập kho.
CREATE FUNCTION pg_temp.dn(p uuid, p_unit text, p_qty numeric, p_conv numeric, p_cost numeric, p_han date DEFAULT current_date + 400, p_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object('product_id', p, 'unit_name', p_unit, 'qty_tx', p_qty, 'conv', p_conv,
    'base_qty', p_qty * p_conv, 'base_cost', p_cost, 'expires_at', p_han, 'batch_code', p_code)) $f$;
-- Phiếu nhập kho qua RPC dưới danh nghĩa user n → entry_id.
CREATE FUNCTION pg_temp.nhap(p_n int, p jsonb) RETURNS uuid LANGUAGE sql AS $f$
  SELECT pg_temp.lay(p_n, format('SELECT entry_id FROM post_stock_import(%L::jsonb)', p)) $f$;
-- Phiếu nháp (xuất lẻ / chuyển kho / kiểm kê) do THỦ KHO lập từ màn hình (ghi thẳng phiếu NHÁP như trang).
CREATE FUNCTION pg_temp.phieu_nhap(p_type text, p_zone text DEFAULT 'sale', p_dest text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $f$
  SELECT pg_temp.lay(5, format(
    'INSERT INTO stock_entries (org_id, entry_code, type, status, warehouse_zone, dest_warehouse_zone, created_by, issue_reason)
     VALUES (%L, %L, %L, ''draft'', %L, %L, %L, %L) RETURNING id',
    pg_temp.org(), 'DK-' || p_type || '-' || left(gen_random_uuid()::text, 8), p_type, p_zone, p_dest, pg_temp.u(5),
    CASE WHEN p_type = 'export' THEN 'damaged' END)) $f$;
CREATE FUNCTION pg_temp.dong(e uuid, p uuid, p_base numeric, p_batch uuid DEFAULT NULL, p_cost numeric DEFAULT 0, p_unit text DEFAULT 'hop')
RETURNS uuid LANGUAGE sql AS $f$
  SELECT pg_temp.lay(5, format(
    'INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot, unit_cost)
     VALUES (%L, %L, %L, %L, %s, %s, %s, %L, 1, %s) RETURNING id',
    e, p, p_batch, p_unit, round(p_base)::int, p_base, p_base, p_unit, p_cost)) $f$;

-- Đơn hàng thử: khách mới + đơn 'submitted' một dòng (SL theo đơn vị dòng, hệ số).
CREATE TYPE pg_temp.don AS (ord uuid, line uuid, cust uuid);
CREATE FUNCTION pg_temp.don(p uuid, p_unit text, p_qty numeric, p_conv numeric, p_price numeric, p_status text DEFAULT 'submitted')
RETURNS pg_temp.don LANGUAGE plpgsql AS $f$
DECLARE c uuid; o uuid; l uuid; v_seq int;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES (pg_temp.org(), 'KH đội kho', 'Chủ', '07' || lpad((random()*1e8)::int::text, 8, '0'), 'Đ/c') RETURNING id INTO c;
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq, subtotal, total, payment_terms, order_date)
  VALUES (pg_temp.org(), 'DKDH-' || v_seq, c, pg_temp.u(4), CASE WHEN p_status = 'cancelled' THEN 'submitted' ELSE p_status END, v_seq, p_qty * p_price, p_qty * p_price, 'COD', current_date)
  RETURNING id INTO o;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (o, p, p_unit, p_qty, p_price, p_qty * p_price, p_conv, 0) RETURNING id INTO l;
  IF p_status = 'cancelled' THEN UPDATE sales_orders SET status = 'cancelled' WHERE id = o; END IF;
  RETURN ROW(o, l, c)::pg_temp.don;
END $f$;
-- Xuất HĐ đủ đơn (chủ NPP) → invoice_id.
CREATE FUNCTION pg_temp.xuat_hd(d pg_temp.don) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record; l record;
BEGIN
  SELECT * INTO l FROM sales_order_lines WHERE id = d.line;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', d.ord, 'lines', jsonb_build_array(jsonb_build_object(
    'order_line_id', l.id, 'product_id', l.product_id, 'unit_name', l.unit_name, 'quantity', l.quantity,
    'unit_price', l.unit_price, 'vat_rate', 0))));
  -- post_invoice bật cờ npp.via_rpc tới hết giao dịch; ngoài đời mỗi RPC là một giao dịch riêng → tắt lại
  -- để các phép kiểm vai sau đó không bị cờ này cho qua.
  PERFORM set_config('npp.via_rpc', '', true);
  RETURN r.invoice_id;
END $f$;

SELECT set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
UPDATE organizations SET allow_oversell = false WHERE id = pg_temp.org();
INSERT INTO suppliers (id, org_id, name) VALUES ('d0c00000-0000-0000-0000-0000000000a1', pg_temp.org(), 'NCC đội kho');
-- Một NPP khác (cho phép kiểm ORG_MISMATCH).
INSERT INTO organizations (id, name, slug) VALUES ('d0c00000-0000-0000-0000-0000000000f0', 'NPP khác', 'npp-khac-doi-kho');
INSERT INTO suppliers (id, org_id, name) VALUES ('d0c00000-0000-0000-0000-0000000000f1', 'd0c00000-0000-0000-0000-0000000000f0', 'NCC NPP khác');
INSERT INTO products (id, org_id, sku, name, base_unit) VALUES ('d0c00000-0000-0000-0000-0000000000f2', 'd0c00000-0000-0000-0000-0000000000f0', 'KHAC1', 'Hàng NPP khác', 'hop');

-- ====================================================================
-- A. NHẬP KHO (post_stock_import)
-- ====================================================================
DO $t$
DECLARE p uuid; e uuid; v_n int; v_ok boolean; r record; v text;
BEGIN
  p := pg_temp.sp('A1');
  -- A1: chủ NPP nhập 2 thùng (×24) giá vốn 5.000/hộp + 10 hộp giá 5.200/hộp, kho bán.
  e := pg_temp.nhap(1, jsonb_build_object('entry_code', 'DK-A1', 'warehouse_zone', 'sale',
        'lines', jsonb_build_array(pg_temp.dn(p, 'thung', 2, 24, 5000), pg_temp.dn(p, 'hop', 10, 1, 5200))));
  SELECT count(*) INTO v_n FROM batches WHERE product_id = p;
  PERFORM pg_temp.ghi('A1', 'nhập 2 thùng + 10 hộp → tồn kho bán 58 hộp (đơn vị cơ sở), 2 lô',
    pg_temp.ton(p, 'sale') = 58 AND v_n = 2, format('tồn %s, lô %s', pg_temp.ton(p, 'sale'), v_n));
  SELECT bool_and(CASE WHEN b.qty_initial = 48 THEN b.unit_cost = 5000 ELSE b.unit_cost = 5200 END) INTO v_ok FROM batches b WHERE b.product_id = p;
  PERFORM pg_temp.ghi('A1', 'unit_cost của lô là giá MỖI HỘP (5.000 / 5.200), không phải giá thùng', v_ok,
    (SELECT string_agg(qty_initial || '@' || unit_cost, ', ') FROM batches WHERE product_id = p));
  SELECT * INTO r FROM stock_entry_lines WHERE entry_id = e AND unit_name = 'thung';
  PERFORM pg_temp.ghi('A1', 'dòng phiếu giữ SL giao dịch 2 thùng, hệ số 24, SL cơ sở 48',
    r.qty_in_transaction_uom = 2 AND r.conversion_factor_snapshot = 24 AND r.qty_in_base_uom = 48 AND r.quantity = 48,
    format('tx %s, hệ số %s, cơ sở %s, quantity %s', r.qty_in_transaction_uom, r.conversion_factor_snapshot, r.qty_in_base_uom, r.quantity));
  PERFORM pg_temp.ghi('A1', 'phiếu đã ghi sổ, loại import, kho sale, người lập = chủ NPP',
    (SELECT status = 'posted' AND type = 'import' AND warehouse_zone = 'sale' AND created_by = pg_temp.u(1) FROM stock_entries WHERE id = e), '');
  PERFORM pg_temp.ghi('A1', 'v_stock_balance_by_zone: 58 hộp, giá trị 48×5.000 + 10×5.200 = 292.000',
    (SELECT qty_in_base_uom = 58 AND value = 292000 FROM v_stock_balance_by_zone WHERE product_id = p AND warehouse_zone = 'sale'),
    (SELECT format('%s / %s', qty_in_base_uom, value) FROM v_stock_balance_by_zone WHERE product_id = p AND warehouse_zone = 'sale'));
  PERFORM pg_temp.ghi('A1', 'thẻ kho (v_stock_movements) kho bán = +58 = tồn thật', pg_temp.the(p, 'sale') = 58, pg_temp.the(p, 'sale')::text);

  -- A2: thủ kho nhập kho DATE (mig 219) → phiếu + lô ở kho date.
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-A2', 'warehouse_zone', 'date',
        'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 7, 1, 4000))));
  PERFORM pg_temp.ghi('A2', 'thủ kho nhập kho date 7 → date 7, kho bán vẫn 58, phiếu kho date',
    pg_temp.ton(p, 'date') = 7 AND pg_temp.ton(p, 'sale') = 58 AND (SELECT warehouse_zone FROM stock_entries WHERE id = e) = 'date',
    format('date %s, sale %s', pg_temp.ton(p, 'date'), pg_temp.ton(p, 'sale')));

  -- A3: vai khác không nhập được, không ghi gì.
  FOR r IN SELECT * FROM (VALUES (2, 'quản lý'), (3, 'kế toán'), (4, 'NVBH')) t(n, ten) LOOP
    v := pg_temp.thu(r.n, format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'DK-A3-' || r.n,
          'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 1, 1, 1000)))));
    PERFORM pg_temp.ghi('A3', r.ten || ' nhập kho → FORBIDDEN, không có phiếu',
      v = 'FORBIDDEN' AND NOT EXISTS (SELECT 1 FROM stock_entries WHERE entry_code = 'DK-A3-' || r.n), COALESCE(v, 'KHÔNG CHẶN'));
  END LOOP;
  PERFORM pg_temp.ghi('A3', 'sau 3 lần bị chặn tồn vẫn 58 + 7', pg_temp.ton(p) = 65, pg_temp.ton(p)::text);
END $t$;

DO $t$
DECLARE p uuid; v text; e uuid; r record;
BEGIN
  p := pg_temp.sp('A4');
  -- A4: biên số lượng / giá / thiếu mã / không dòng.
  FOR r IN SELECT * FROM (VALUES
      ('SL 0', jsonb_build_object('entry_code', 'DK-A4a', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 0, 1, 1000)))),
      ('SL âm', jsonb_build_object('entry_code', 'DK-A4b', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', -5, 1, 1000)))),
      ('giá vốn âm', jsonb_build_object('entry_code', 'DK-A4c', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, -1)))),
      ('không dòng', jsonb_build_object('entry_code', 'DK-A4d', 'lines', '[]'::jsonb)),
      ('thiếu mã phiếu', jsonb_build_object('entry_code', '  ', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 1000)))),
      ('kho lạ', jsonb_build_object('entry_code', 'DK-A4f', 'warehouse_zone', 'kho-lung', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 1000)))),
      ('nợ NCC âm', jsonb_build_object('entry_code', 'DK-A4g', 'supplier_id', 'd0c00000-0000-0000-0000-0000000000a1',
          'payable', jsonb_build_object('amount', -1), 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 1000))))
    ) t(ten, pl) LOOP
    v := pg_temp.thu(5, format('SELECT post_stock_import(%L::jsonb)', r.pl));
    PERFORM pg_temp.ghi('A4', r.ten || ' → BAD_PAYLOAD', v = 'BAD_PAYLOAD', COALESCE(v, 'KHÔNG CHẶN'));
  END LOOP;
  -- Dòng 2 hỏng → cả phiếu quay lui (dòng 1 không vào kho).
  v := pg_temp.thu(5, format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'DK-A4h',
        'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 1000), pg_temp.dn(p, 'hop', 0, 1, 1000)))));
  PERFORM pg_temp.ghi('A4', 'dòng 2 SL 0 → cả phiếu bị chặn, dòng 1 không vào kho, không có phiếu',
    v = 'BAD_PAYLOAD' AND pg_temp.ton(p) = 0 AND NOT EXISTS (SELECT 1 FROM stock_entries WHERE entry_code = 'DK-A4h'), COALESCE(v, 'KHÔNG CHẶN') || ' tồn ' || pg_temp.ton(p));
  -- NPP khác.
  v := pg_temp.thu(5, format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'DK-A4i',
        'lines', jsonb_build_array(pg_temp.dn('d0c00000-0000-0000-0000-0000000000f2', 'hop', 5, 1, 1000)))));
  PERFORM pg_temp.ghi('A4', 'hàng của NPP khác → ORG_MISMATCH', v = 'ORG_MISMATCH', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(5, format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'DK-A4j',
        'supplier_id', 'd0c00000-0000-0000-0000-0000000000f1', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 1000)))));
  PERFORM pg_temp.ghi('A4', 'NCC của NPP khác → ORG_MISMATCH', v = 'ORG_MISMATCH', COALESCE(v, 'KHÔNG CHẶN'));

  -- A5: số lẻ đơn vị cơ sở 2,5 giữ nguyên ở lô và dòng (numeric).
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-A5', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 2.5, 1, 3000))));
  PERFORM pg_temp.ghi('A5', 'nhập 2,5 hộp → lô 2,5; dòng qty_in_base_uom 2,5',
    pg_temp.ton(p) = 2.5 AND (SELECT qty_in_base_uom FROM stock_entry_lines WHERE entry_id = e) = 2.5,
    format('tồn %s', pg_temp.ton(p)));
  -- A7: thiếu hạn dùng → 31/12/2099; thiếu mã lô → LOT-<mã phiếu>-<stt>.
  SELECT b.expires_at, b.batch_code INTO r FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = e;
  PERFORM pg_temp.ghi('A7', 'lô có hạn mặc định không bị kẹp: mã lô tự sinh LOT-DK-A5-1',
    r.batch_code = 'LOT-DK-A5-1', format('%s / %s', r.batch_code, r.expires_at));
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-A7', 'lines', jsonb_build_array(
        jsonb_build_object('product_id', p, 'unit_name', 'hop', 'qty_tx', 1, 'conv', 1, 'base_qty', 1, 'base_cost', 1000))));
  PERFORM pg_temp.ghi('A7', 'không gửi hạn dùng → 2099-12-31',
    (SELECT b.expires_at FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = e) = DATE '2099-12-31', '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A4', 'NỔ', false, SQLERRM);
END $t$;

DO $t$
DECLARE p uuid; e uuid; v_pa timestamptz; r record;
BEGIN
  p := pg_temp.sp('A6');
  -- A6: ngày nhập lùi 00:30 giờ VN ngày 16/09 (= 17:30 UTC ngày 15) → ghi sổ đúng mốc, ngày VN là 16/09.
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-A6', 'posted_at', '2026-09-16T00:30:00+07:00',
        'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 10, 1, 1000))));
  SELECT posted_at INTO v_pa FROM stock_entries WHERE id = e;
  PERFORM pg_temp.ghi('A6', 'posted_at = 2026-09-15 17:30 UTC; ngày theo giờ VN = 16/09 (không lệch ngày)',
    v_pa = '2026-09-15T17:30:00Z'::timestamptz AND (v_pa AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = DATE '2026-09-16', v_pa::text);
  PERFORM pg_temp.ghi('A6', 'lô nhận received_at = ngày ghi sổ (khoá FIFO)',
    (SELECT b.received_at FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = e) = v_pa, '');

  -- A8: chọn kho bán nhưng hạn còn 10 ngày (< ngưỡng 30) → trigger đẩy lô về kho date (đúng thiết kế mig 028).
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-A8', 'warehouse_zone', 'sale',
        'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 4, 1, 1000, current_date + 10))));
  PERFORM pg_temp.ghi('A8', 'nhập kho bán hàng còn 10 ngày hạn → lô tự về kho date (an toàn: không bán hàng cận date)',
    (SELECT b.warehouse_zone FROM stock_entry_lines l JOIN batches b ON b.id = l.batch_id WHERE l.entry_id = e) = 'date', '');

  -- A9: có NCC + tiền → công nợ NCC cùng giao dịch.
  SELECT * INTO r FROM post_stock_import(jsonb_build_object('entry_code', 'DK-A9', 'supplier_id', 'd0c00000-0000-0000-0000-0000000000a1',
        'payable', jsonb_build_object('amount', 300000, 'invoice_number', 'HDNCC-9'), 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 30, 1, 10000))));
  PERFORM pg_temp.ghi('A9', 'nhập có NCC 300.000 → 1 dòng công nợ NCC open 300.000 gắn phiếu',
    (SELECT amount = 300000 AND status = 'open' AND stock_entry_id = r.entry_id AND invoice_number = 'HDNCC-9' FROM payables WHERE id = r.payable_id),
    (SELECT format('%s %s', amount, status) FROM payables WHERE id = r.payable_id));
  SELECT * INTO r FROM post_stock_import(jsonb_build_object('entry_code', 'DK-A9b', 'supplier_id', 'd0c00000-0000-0000-0000-0000000000a1',
        'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 1, 1, 10000))));
  PERFORM pg_temp.ghi('A9', 'có NCC mà không có tiền → không sinh công nợ', r.payable_id IS NULL, COALESCE(r.payable_id::text, 'NULL'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A6', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- B. HUỶ PHIẾU NHẬP (cancel_stock_entry)
-- ====================================================================
DO $t$
DECLARE p uuid; e uuid; e2 uuid; x uuid; v text; r record;
BEGIN
  p := pg_temp.sp('B1');
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-B1', 'lines', jsonb_build_array(pg_temp.dn(p, 'thung', 1, 24, 2000), pg_temp.dn(p, 'hop', 6, 1, 2100))));
  v := pg_temp.thu(4, format('SELECT cancel_stock_entry(%L, %L)', e, 'NVBH'));
  PERFORM pg_temp.ghi('B1', 'NVBH huỷ phiếu nhập → FORBIDDEN, tồn giữ 30', v = 'FORBIDDEN' AND pg_temp.ton(p) = 30, COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(3, format('SELECT cancel_stock_entry(%L, %L)', e, 'KT'));
  PERFORM pg_temp.ghi('B1', 'kế toán huỷ phiếu nhập → FORBIDDEN', v = 'FORBIDDEN', COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(5)::text, true);
  SELECT * INTO r FROM cancel_stock_entry(e, 'nhập nhầm');
  PERFORM pg_temp.ghi('B1', 'thủ kho huỷ phiếu nhập chưa xuất → reversed, 2 dòng, tồn 0, phiếu Đã huỷ có lý do',
    r.cancelled AND r.reversed AND r.lines_reversed = 2 AND pg_temp.ton(p) = 0
      AND (SELECT status = 'cancelled' AND notes LIKE '%Huỷ phiếu: nhập nhầm%' FROM stock_entries WHERE id = e),
    format('%s/%s/%s tồn %s', r.cancelled, r.reversed, r.lines_reversed, pg_temp.ton(p)));
  SELECT * INTO r FROM cancel_stock_entry(e, 'bấm lại');
  PERFORM pg_temp.ghi('B1', 'huỷ lần hai → không làm gì (reversed=false), tồn vẫn 0 (không âm)',
    r.cancelled AND NOT r.reversed AND pg_temp.ton(p) = 0, format('%s tồn %s', r.reversed, pg_temp.ton(p)));
  PERFORM pg_temp.ghi('B1', 'thẻ kho bỏ phiếu đã huỷ → 0', pg_temp.the(p, 'sale') = 0, pg_temp.the(p, 'sale')::text);

  -- B2: phiếu có công nợ NCC → phải xoá công nợ trước.
  SELECT entry_id INTO e2 FROM post_stock_import(jsonb_build_object('entry_code', 'DK-B2', 'supplier_id', 'd0c00000-0000-0000-0000-0000000000a1',
        'payable', jsonb_build_object('amount', 50000), 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 5, 1, 10000))));
  v := pg_temp.thu(5, format('SELECT cancel_stock_entry(%L, %L)', e2, 'x'));
  PERFORM pg_temp.ghi('B2', 'phiếu nhập còn công nợ NCC → ENTRY_HAS_SOURCE, tồn giữ 5', v = 'ENTRY_HAS_SOURCE' AND pg_temp.ton(p) = 5, COALESCE(v, 'KHÔNG CHẶN'));

  -- B3: hàng đã xuất bớt → không huỷ được.
  e := pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-B3', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 10, 1, 1000, current_date + 1)))); -- hạn gần nhất → xuất lẻ lấy trước
  UPDATE batches SET warehouse_zone = 'sale' WHERE id = (SELECT batch_id FROM stock_entry_lines WHERE entry_id = e);
  x := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(x, p, 3);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  v := pg_temp.loi(5, format('SELECT cancel_stock_entry(%L, %L)', e, 'x'));
  PERFORM pg_temp.ghi('B3', 'phiếu nhập đã xuất bớt 3 → ALREADY_ISSUED (nói rõ nhập 10, lô còn 7), tồn không đổi',
    v LIKE 'ALREADY_ISSUED%' AND v LIKE '%nhập 10%' AND v LIKE '%còn 7%' AND pg_temp.ton(p) = 12, COALESCE(v, 'KHÔNG CHẶN') || ' tồn ' || pg_temp.ton(p));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- C. XUẤT KHO LẺ (post_stock_issue) + huỷ
-- ====================================================================
DO $t$
DECLARE p uuid; l1 uuid; l2 uuid; l3 uuid; x uuid; v text; v_n numeric; v_c bigint;
BEGIN
  p := pg_temp.sp('C1');
  l1 := pg_temp.lo(p, 'C-L1', 10, 1000, 100);   -- hạn gần
  l2 := pg_temp.lo(p, 'C-L2', 10, 2000, 200);   -- hạn xa
  l3 := pg_temp.lo(p, 'C-L3', 50, 500, 300, 'date');
  -- C1: hai dòng CÙNG mã 6 + 8 = 14 → lấy hạn cũ trước: L1 hết, L2 còn 6; kho date không đụng.
  x := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(x, p, 6);
  PERFORM pg_temp.dong(x, p, 8);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('C1', 'xuất lẻ 6 + 8 cùng mã: L1 10→0, L2 10→6, kho date giữ 50',
    pg_temp.ton_lo(l1) = 0 AND pg_temp.ton_lo(l2) = 6 AND pg_temp.ton_lo(l3) = 50,
    format('L1 %s L2 %s L3 %s', pg_temp.ton_lo(l1), pg_temp.ton_lo(l2), pg_temp.ton_lo(l3)));
  SELECT sum(c.qty_in_base_uom), count(*) INTO v_n, v_c FROM stock_line_consumptions c JOIN stock_entry_lines l ON l.id = c.line_id WHERE l.entry_id = x;
  PERFORM pg_temp.ghi('C1', 'vết lấy lô đủ 14 (3 lần lấy: 6 từ L1, 4 từ L1 + 4 từ L2)', v_n = 14 AND v_c = 3, format('%s / %s', v_n, v_c));
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('C1', 'ghi sổ lần hai (bấm lại) → không trừ thêm: L2 vẫn 6', pg_temp.ton_lo(l2) = 6 AND pg_temp.ton(p, 'sale') = 6, pg_temp.ton(p, 'sale')::text);
  -- (lô dựng thẳng không qua phiếu nên thẻ kho chỉ có phiếu xuất: −14)
  PERFORM pg_temp.ghi('C1', 'thẻ kho kho bán ghi đúng −14 cho phiếu xuất (ghi sổ hai lần không thành −28)', pg_temp.the(p, 'sale') = -14, (pg_temp.the(p, 'sale'))::text);

  -- C2: thiếu hàng (cờ bán âm TẮT) → chặn, không đụng lô nào.
  x := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(x, p, 7);
  v := pg_temp.loi(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('C2', 'xuất 7 khi kho bán còn 6 → KHONG_DU_TON (nói cần 7, còn 6), tồn giữ 6, phiếu vẫn nháp',
    v LIKE 'KHONG_DU_TON%' AND v LIKE '%cần 7%' AND v LIKE '%còn 6%' AND pg_temp.ton(p, 'sale') = 6
      AND (SELECT status FROM stock_entries WHERE id = x) = 'draft', COALESCE(v, 'KHÔNG CHẶN'));
  -- C3: xuất từ kho date chỉ đụng kho date.
  x := pg_temp.phieu_nhap('export', 'date');
  PERFORM pg_temp.dong(x, p, 1, NULL, 0, 'thung');
  UPDATE stock_entry_lines SET qty_in_base_uom = 24, qty_in_transaction_uom = 1, conversion_factor_snapshot = 24, quantity = 1 WHERE entry_id = x;
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('C3', 'xuất 1 thùng (24 hộp) từ kho date → date 50→26, kho bán giữ 6',
    pg_temp.ton(p, 'date') = 26 AND pg_temp.ton(p, 'sale') = 6, format('date %s sale %s', pg_temp.ton(p, 'date'), pg_temp.ton(p, 'sale')));
  -- C4: huỷ phiếu xuất C3 → về đúng lô date.
  v := pg_temp.loi(5, format('SELECT cancel_stock_entry(%L, %L)', x, 'nhầm'));
  PERFORM pg_temp.ghi('C4', 'huỷ phiếu xuất kho date → L3 về 50, phiếu Đã huỷ',
    pg_temp.ton_lo(l3) = 50 AND (SELECT status FROM stock_entries WHERE id = x) = 'cancelled', pg_temp.ton_lo(l3)::text);
  v := pg_temp.loi(5, format('SELECT cancel_stock_entry(%L, %L)', x, 'bấm lại'));
  PERFORM pg_temp.ghi('C4', 'huỷ lần hai không cộng thêm: L3 vẫn 50', pg_temp.ton_lo(l3) = 50, pg_temp.ton_lo(l3)::text);
  -- C5: phiếu không dòng.
  x := pg_temp.phieu_nhap('export');
  v := pg_temp.thu(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('C5', 'phiếu xuất không dòng → PHIEU_KHONG_CO_HANG', v = 'PHIEU_KHONG_CO_HANG', COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C1', 'NỔ', false, SQLERRM);
END $t$;

DO $t$
DECLARE p uuid; b uuid; e uuid; v text;
BEGIN
  -- C6: khoá ghi thẳng (mig 214) — kể cả thủ kho / chủ NPP.
  p := pg_temp.sp('C6');
  b := pg_temp.lo(p, 'C6-L', 10, 1000, 300);
  v := pg_temp.loi(5, format('UPDATE batches SET qty_on_hand = 999 WHERE id = %L', b));
  PERFORM pg_temp.ghi('C6', 'thủ kho sửa thẳng tồn lô → SO_KHO_KHOA, tồn giữ 10', v LIKE 'SO_KHO_KHOA%' AND pg_temp.ton_lo(b) = 10, COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.loi(1, format('INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand) VALUES (%L, %L, %L, current_date + 300, 5, 5)', pg_temp.org(), p, 'C6-X'));
  PERFORM pg_temp.ghi('C6', 'chủ NPP tạo lô có tồn trực tiếp → SO_KHO_KHOA', v LIKE 'SO_KHO_KHOA%', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.loi(5, format('INSERT INTO stock_entries (org_id, entry_code, type, status) VALUES (%L, %L, %L, %L)', pg_temp.org(), 'DK-C6', 'import', 'posted'));
  PERFORM pg_temp.ghi('C6', 'thủ kho chèn phiếu ĐÃ GHI SỔ từ màn hình → SO_KHO_KHOA', v LIKE 'SO_KHO_KHOA%', COALESCE(v, 'KHÔNG CHẶN'));
  e := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(e, p, 1);
  v := pg_temp.loi(5, format('UPDATE stock_entries SET status = %L WHERE id = %L', 'posted', e));
  PERFORM pg_temp.ghi('C6', 'đổi thẳng nháp → đã ghi sổ (không trừ kho) → SO_KHO_KHOA', v LIKE 'SO_KHO_KHOA%', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.loi(5, format('UPDATE stock_entries SET status = %L WHERE id = %L', 'cancelled', e));
  PERFORM pg_temp.ghi('C6', 'huỷ phiếu NHÁP ghi thẳng được (không động kho)', v IS NULL, COALESCE(v, 'ok'));
  v := pg_temp.loi(4, format('INSERT INTO stock_entries (org_id, entry_code, type, status) VALUES (%L, %L, %L, %L)', pg_temp.org(), 'DK-C6s', 'export', 'draft'));
  PERFORM pg_temp.ghi('C6', 'NVBH chèn phiếu kho nháp → RLS chặn', v LIKE '%row-level security%', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.loi(3, format('INSERT INTO stock_entries (org_id, entry_code, type, status) VALUES (%L, %L, %L, %L)', pg_temp.org(), 'DK-C6k', 'export', 'draft'));
  PERFORM pg_temp.ghi('C6', 'kế toán chèn phiếu kho nháp → RLS chặn', v LIKE '%row-level security%', COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C6', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- D. XUẤT THEO ĐƠN / HOÁ ĐƠN (post_stock_export qua post_invoice) — FIFO + giá vốn + hoàn kho khi huỷ HĐ
-- ====================================================================
DO $t$
DECLARE p uuid; cu uuid; mo uuid; dt uuid; d pg_temp.don; inv uuid; e uuid; r record; v text;
BEGIN
  p := pg_temp.sp('D1');
  cu := pg_temp.lo(p, 'D-CU', 10, 1000, 400, 'sale', 20);  -- nhận trước
  mo := pg_temp.lo(p, 'D-MOI', 100, 2000, 100, 'sale', 1); -- nhận sau, hạn GẦN hơn
  dt := pg_temp.lo(p, 'D-DATE', 500, 100, 300, 'date', 30);
  d := pg_temp.don(p, 'hop', 15, 1, 10000);
  inv := pg_temp.xuat_hd(d);
  SELECT stock_entry_id INTO e FROM sales_invoices WHERE id = inv;
  PERFORM pg_temp.ghi('D1', 'HĐ 15 hộp: FIFO theo NGÀY NHẬN (không theo hạn) → lô cũ 10→0, lô mới 100→95, kho date không đụng',
    pg_temp.ton_lo(cu) = 0 AND pg_temp.ton_lo(mo) = 95 AND pg_temp.ton_lo(dt) = 500,
    format('cũ %s mới %s date %s', pg_temp.ton_lo(cu), pg_temp.ton_lo(mo), pg_temp.ton_lo(dt)));
  SELECT * INTO r FROM stock_entry_lines WHERE entry_id = e;
  PERFORM pg_temp.ghi('D1', 'giá vốn dòng = (10×1.000 + 5×2.000)/15 = 1.333,33; lô ghi trên dòng = lô lấy nhiều nhất (lô cũ)',
    round(r.unit_cost, 2) = 1333.33 AND r.batch_id = cu AND r.notes LIKE '%D-CU×10%D-MOI×5%',
    format('%s %s', round(r.unit_cost, 2), r.notes));
  PERFORM pg_temp.ghi('D1', 'phiếu xuất đã ghi sổ, đơn Hoàn thành', (SELECT status FROM stock_entries WHERE id = e) = 'posted'
    AND (SELECT status FROM sales_orders WHERE id = d.ord) = 'completed', (SELECT status FROM sales_orders WHERE id = d.ord));
  -- D2: huỷ HĐ → hàng về ĐÚNG lô đã lấy; đơn Đã huỷ (mig 217).
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  PERFORM cancel_invoice(inv, 'thử kho');
  PERFORM set_config('npp.via_rpc', '', true);
  PERFORM pg_temp.ghi('D2', 'huỷ HĐ → lô cũ về 10, lô mới về 100; đơn Đã huỷ',
    pg_temp.ton_lo(cu) = 10 AND pg_temp.ton_lo(mo) = 100 AND (SELECT status FROM sales_orders WHERE id = d.ord) = 'cancelled',
    format('cũ %s mới %s đơn %s', pg_temp.ton_lo(cu), pg_temp.ton_lo(mo), (SELECT status FROM sales_orders WHERE id = d.ord)));
  PERFORM pg_temp.ghi('D2', 'thẻ kho kho bán: xuất −15 rồi phiếu hoàn +15 → 0 (lô dựng không qua phiếu)', pg_temp.the(p, 'sale') = 0,
    format('thẻ %s', pg_temp.the(p, 'sale')));
  -- D3: đơn theo THÙNG (×24) → trừ 24 hộp.
  d := pg_temp.don(p, 'thung', 1, 24, 230000);
  inv := pg_temp.xuat_hd(d);
  PERFORM pg_temp.ghi('D3', 'HĐ 1 thùng → kho bán 110 → 86 (trừ 24 hộp, không phải 1)', pg_temp.ton(p, 'sale') = 86, pg_temp.ton(p, 'sale')::text);
  -- D4: cancel_stock_entry riêng phiếu xuất của HĐ còn hiệu lực → phải huỷ HĐ.
  SELECT stock_entry_id INTO e FROM sales_invoices WHERE id = inv;
  v := pg_temp.thu(5, format('SELECT cancel_stock_entry(%L, %L)', e, 'x'));
  PERFORM pg_temp.ghi('D4', 'huỷ riêng phiếu xuất của HĐ → ENTRY_HAS_INVOICE, tồn giữ 86', v = 'ENTRY_HAS_INVOICE' AND pg_temp.ton(p, 'sale') = 86, COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D1', 'NỔ', false, SQLERRM);
END $t$;

DO $t$
DECLARE p uuid; s uuid; dt uuid; x uuid; v text; r record;
BEGIN
  -- D5: kho bán thiếu, hàng nằm ở kho date → câu lỗi nói rõ KHO CẬN DATE; bật bán âm thì ghi được, phần thiếu trả về.
  p := pg_temp.sp('D5');
  s := pg_temp.lo(p, 'D5-S', 5, 1000, 400);
  dt := pg_temp.lo(p, 'D5-D', 50, 1000, 300, 'date');
  x := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(x, p, 30);
  v := pg_temp.loi(5, format('SELECT post_stock_export(%L)', x));
  PERFORM pg_temp.ghi('D5', 'xuất 30 khi kho bán 5, kho date 50 → INSUFFICIENT_STOCK nói "KHO CẬN DATE", không trừ',
    v LIKE 'INSUFFICIENT_STOCK%' AND v LIKE '%KHO CẬN DATE%' AND pg_temp.ton(p) = 55, COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(4, format('SELECT post_stock_export(%L)', x));
  PERFORM pg_temp.ghi('D5', 'NVBH gọi thẳng post_stock_export → FORBIDDEN', v = 'FORBIDDEN', COALESCE(v, 'KHÔNG CHẶN'));
  UPDATE organizations SET allow_oversell = true WHERE id = pg_temp.org();
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(5)::text, true);
  SELECT * INTO r FROM post_stock_export(x);
  PERFORM pg_temp.ghi('D5', 'bật bán vượt tồn: ghi sổ được, short_qty 25, kho bán 0, kho date giữ 50',
    r.posted AND r.short_qty = 25 AND pg_temp.ton(p, 'sale') = 0 AND pg_temp.ton(p, 'date') = 50,
    format('%s short %s sale %s date %s', r.posted, r.short_qty, pg_temp.ton(p, 'sale'), pg_temp.ton(p, 'date')));
  SELECT * INTO r FROM post_stock_export(x);
  PERFORM pg_temp.ghi('D5', 'gọi lại phiếu đã ghi sổ → posted=false, không làm gì', NOT r.posted AND r.total_cost = 0, r.posted::text);
  UPDATE organizations SET allow_oversell = false WHERE id = pg_temp.org();
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D5', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- E. CHUYỂN KHO (post_stock_transfer)
-- ====================================================================
DO $t$
DECLARE p uuid; s uuid; g uuid; x uuid; v text; nb uuid; r record;
BEGIN
  p := pg_temp.sp('E1');
  s := pg_temp.lo(p, 'E-S', 30, 1500, 400, 'sale', 15);
  g := pg_temp.lo(p, 'E-GAN', 8, 900, 5, 'date', 40);
  -- E1: bán → date 10.
  x := pg_temp.phieu_nhap('transfer', 'sale', 'date');
  PERFORM pg_temp.dong(x, p, 10);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_transfer(%L)', x));
  SELECT * INTO r FROM batches WHERE product_id = p AND warehouse_zone = 'date' AND batch_code = 'E-S';
  PERFORM pg_temp.ghi('E1', 'chuyển 10 bán→date: kho bán 20, lô mới ở date 10, cùng mã lô / giá vốn / ngày nhận gốc',
    pg_temp.ton(p, 'sale') = 20 AND r.qty_on_hand = 10 AND r.unit_cost = 1500
      AND r.received_at = (SELECT received_at FROM batches WHERE id = s),
    format('sale %s date-lô %s giá %s', pg_temp.ton(p, 'sale'), r.qty_on_hand, r.unit_cost));
  PERFORM pg_temp.ghi('E1', 'tổng tồn không đổi (38)', pg_temp.ton(p) = 38, pg_temp.ton(p)::text);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('E1', 'ghi sổ lại → không chuyển lần hai', pg_temp.ton(p, 'sale') = 20, pg_temp.ton(p, 'sale')::text);
  -- E2: chuyển ngược date → bán 4 lô E-S (hạn xa) → gộp vào lô gốc.
  nb := r.id;
  x := pg_temp.phieu_nhap('transfer', 'date', 'sale');
  PERFORM pg_temp.dong(x, p, 4);
  v := pg_temp.loi(5, format('SELECT post_stock_transfer(%L)', x));
  -- hạn cũ đi trước: lô E-GAN (hạn 5 ngày) bị lấy trước → không được vào kho bán.
  PERFORM pg_temp.ghi('E2', 'date→bán khi lô hạn gần nhất còn 5 ngày → HANG_GAN_HAN, không đổi gì',
    v LIKE 'HANG_GAN_HAN%' AND pg_temp.ton(p, 'sale') = 20 AND pg_temp.ton_lo(g) = 8, COALESCE(v, 'KHÔNG CHẶN'));
  -- E3: biên.
  x := pg_temp.phieu_nhap('transfer', 'sale', 'sale');
  PERFORM pg_temp.dong(x, p, 1);
  v := pg_temp.thu(5, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('E3', 'kho nguồn = kho đích → TRUNG_KHO', v = 'TRUNG_KHO', COALESCE(v, 'KHÔNG CHẶN'));
  x := pg_temp.phieu_nhap('transfer', 'sale', 'date');
  PERFORM pg_temp.dong(x, p, 21);
  v := pg_temp.thu(5, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('E3', 'chuyển 21 khi kho bán 20 → KHONG_DU_TON (chuyển kho không bao giờ âm)', v = 'KHONG_DU_TON', COALESCE(v, 'KHÔNG CHẶN'));
  UPDATE organizations SET allow_oversell = true WHERE id = pg_temp.org();
  v := pg_temp.thu(5, format('SELECT post_stock_transfer(%L)', x));
  UPDATE organizations SET allow_oversell = false WHERE id = pg_temp.org();
  PERFORM pg_temp.ghi('E3', 'kể cả bật bán vượt tồn: chuyển 21 vẫn KHONG_DU_TON (mig 222)', v = 'KHONG_DU_TON', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(4, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('E3', 'NVBH ghi sổ phiếu chuyển → FORBIDDEN', v = 'FORBIDDEN', COALESCE(v, 'KHÔNG CHẶN'));
  x := pg_temp.phieu_nhap('transfer', 'sale', 'date');
  PERFORM pg_temp.dong(x, p, 2);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('E3', 'chuyển thêm 2 bán→date gộp vào lô date cùng danh tính (không đẻ lô mới)',
    pg_temp.ton_lo(nb) = 12 AND (SELECT count(*) FROM batches WHERE product_id = p AND warehouse_zone = 'date' AND batch_code = 'E-S') = 1,
    pg_temp.ton_lo(nb)::text);
  v := pg_temp.thu(5, format('SELECT cancel_stock_entry(%L, %L)', x, 'x'));
  PERFORM pg_temp.ghi('E3', 'huỷ phiếu chuyển đã ghi sổ → CANNOT_REVERSE_TYPE', v = 'CANNOT_REVERSE_TYPE', COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- F. KIỂM KÊ + DUYỆT ĐIỀU CHỈNH (post_stock_adjustment / reject_stock_adjustment)
-- ====================================================================
DO $t$
DECLARE p uuid; a uuid; b uuid; x uuid; v text; r record; v_ex record;
BEGIN
  p := pg_temp.sp('F1');
  a := pg_temp.lo(p, 'F-A', 10, 1000, 100);
  b := pg_temp.lo(p, 'F-B', 10, 2000, 200);
  -- F1: thủ kho lập phiếu kiểm kê NHÁP: lô A thiếu 3; thừa 4 không rõ lô.
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, p, -3, a, 1000);
  PERFORM pg_temp.dong(x, p, 4, NULL, 0);
  PERFORM pg_temp.dong(x, p, 0, b, 2000);
  PERFORM pg_temp.ghi('F1', 'phiếu kiểm kê nháp CHƯA động kho (A 10, B 10)', pg_temp.ton_lo(a) = 10 AND pg_temp.ton_lo(b) = 10, '');
  FOR r IN SELECT * FROM (VALUES (3, 'kế toán'), (4, 'NVBH'), (5, 'thủ kho')) t(n, ten) LOOP
    v := pg_temp.thu(r.n, format('SELECT post_stock_adjustment(%L)', x));
    PERFORM pg_temp.ghi('F1', r.ten || ' duyệt điều chỉnh → FORBIDDEN (chỉ quyền inventory.approve)', v = 'FORBIDDEN', COALESCE(v, 'KHÔNG CHẶN'));
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
  SELECT * INTO r FROM post_stock_adjustment(x);
  PERFORM pg_temp.ghi('F1', 'quản lý duyệt: A 10→7; thừa 4 vào lô hạn XA nhất (B 10→14); dòng 0 bỏ qua',
    pg_temp.ton_lo(a) = 7 AND pg_temp.ton_lo(b) = 14 AND r.batches_touched = 2,
    format('A %s B %s chạm %s', pg_temp.ton_lo(a), pg_temp.ton_lo(b), r.batches_touched));
  PERFORM pg_temp.ghi('F1', 'hao hụt 3 × 1.000 = 3.000; thừa 4 × giá lô B 2.000 = 8.000',
    r.shrink_qty = 3 AND r.shrink_value = 3000 AND r.surplus_qty = 4 AND r.surplus_value = 8000,
    format('%s/%s %s/%s', r.shrink_qty, r.shrink_value, r.surplus_qty, r.surplus_value));
  SELECT * INTO v_ex FROM expenses WHERE id = r.expense_id;
  PERFORM pg_temp.ghi('F1', 'chi phí hao hụt 3.000 cùng giao dịch, nguồn stocktake, nhóm COGS_ADJ',
    v_ex.amount = 3000 AND v_ex.source_type = 'stocktake' AND v_ex.source_id = x
      AND (SELECT code FROM expense_categories WHERE id = v_ex.category_id) = 'COGS_ADJ', format('%s %s', v_ex.amount, v_ex.source_type));
  PERFORM pg_temp.ghi('F1', 'phiếu đã ghi sổ; dòng thừa được gắn lô B', (SELECT status FROM stock_entries WHERE id = x) = 'posted'
    AND EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = x AND quantity = 4 AND batch_id = b), '');
  v := pg_temp.thu(2, format('SELECT post_stock_adjustment(%L)', x));
  PERFORM pg_temp.ghi('F1', 'duyệt lần hai → ALREADY_POSTED, tồn không đổi (A 7 B 14)', v = 'ALREADY_POSTED' AND pg_temp.ton_lo(a) = 7 AND pg_temp.ton_lo(b) = 14, COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM pg_temp.ghi('F1', 'chỉ một khoản chi phí hao hụt cho phiếu', (SELECT count(*) FROM expenses WHERE source_id = x) = 1, '');
  v := pg_temp.thu(2, format('SELECT reject_stock_adjustment(%L, %L)', x, 'muộn'));
  PERFORM pg_temp.ghi('F1', 'từ chối phiếu đã duyệt → ALREADY_POSTED', v = 'ALREADY_POSTED', COALESCE(v, 'KHÔNG CHẶN'));

  -- F2: hao hụt không rõ lô 9 → hạn gần trước: A 7→0, B 14→12.
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, p, -9, NULL, 0);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  SELECT * INTO r FROM post_stock_adjustment(x);
  PERFORM pg_temp.ghi('F2', 'chủ NPP duyệt hao hụt 9 không rõ lô → FEFO: A 0, B 12', pg_temp.ton_lo(a) = 0 AND pg_temp.ton_lo(b) = 12,
    format('A %s B %s', pg_temp.ton_lo(a), pg_temp.ton_lo(b)));
  -- F3: lô đã đổi từ lúc đếm → STOCK_MOVED; không đủ → NOT_ENOUGH_STOCK; chưa có lô → NO_BATCH.
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, p, -13, b, 2000);
  v := pg_temp.loi(2, format('SELECT post_stock_adjustment(%L)', x));
  PERFORM pg_temp.ghi('F3', 'trừ 13 ở lô B còn 12 → STOCK_MOVED, không kẹp 0 im lặng', v LIKE 'STOCK_MOVED%' AND pg_temp.ton_lo(b) = 12, COALESCE(v, 'KHÔNG CHẶN'));
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, p, -100, NULL, 0);
  v := pg_temp.thu(2, format('SELECT post_stock_adjustment(%L)', x));
  PERFORM pg_temp.ghi('F3', 'hao hụt 100 không rõ lô khi còn 12 → NOT_ENOUGH_STOCK, tồn giữ 12', v = 'NOT_ENOUGH_STOCK' AND pg_temp.ton(p) = 12, COALESCE(v, 'KHÔNG CHẶN'));
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, pg_temp.sp('F3-rong'), 5, NULL, 0);
  v := pg_temp.thu(2, format('SELECT post_stock_adjustment(%L)', x));
  PERFORM pg_temp.ghi('F3', 'thừa 5 của mặt hàng chưa có lô → NO_BATCH (không nuốt)', v = 'NO_BATCH', COALESCE(v, 'KHÔNG CHẶN'));
  -- F4: từ chối phiếu nháp.
  v := pg_temp.thu(5, format('SELECT reject_stock_adjustment(%L, %L)', x, 'x'));
  PERFORM pg_temp.ghi('F4', 'thủ kho từ chối phiếu → FORBIDDEN', v = 'FORBIDDEN', COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
  PERFORM pg_temp.ghi('F4', 'quản lý từ chối → true', reject_stock_adjustment(x, 'đếm sai'), '');
  PERFORM pg_temp.ghi('F4', 'phiếu từ chối Đã huỷ, ghi chú "Từ chối: đếm sai"',
    (SELECT status = 'cancelled' AND notes LIKE '%Từ chối: đếm sai%' FROM stock_entries WHERE id = x), (SELECT status FROM stock_entries WHERE id = x));
  PERFORM pg_temp.ghi('F4', 'từ chối lần hai → false (không lỗi)', NOT reject_stock_adjustment(x, 'lại'), '');
  v := pg_temp.thu(2, format('SELECT post_stock_adjustment(%L)', x));
  PERFORM pg_temp.ghi('F4', 'duyệt phiếu đã từ chối → BAD_STATUS', v = 'BAD_STATUS', COALESCE(v, 'KHÔNG CHẶN'));
  x := pg_temp.phieu_nhap('export');
  v := pg_temp.thu(2, format('SELECT reject_stock_adjustment(%L, %L)', x, 'x'));
  PERFORM pg_temp.ghi('F4', 'từ chối phiếu không phải kiểm kê → BAD_TYPE', v = 'BAD_TYPE', COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('F1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- G. PHIẾU NHẬP NCC (complete_purchase_invoice / cancel_purchase_invoice)
-- ====================================================================
CREATE FUNCTION pg_temp.pn(p1 uuid, p2 uuid, p_zone text DEFAULT 'sale', p_vat_ovr numeric DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  -- Kế toán lập phiếu nháp (RLS cho kế toán ghi phiếu nhập).
  v := pg_temp.lay(3, format('INSERT INTO purchase_invoices (org_id, supplier_id, invoice_number, status, discount, warehouse_zone, vat_override, created_by)
        VALUES (%L, %L, %L, ''draft'', 6000, %L, %s, %L) RETURNING id', pg_temp.org(), 'd0c00000-0000-0000-0000-0000000000a1', 'HDV-' || left(gen_random_uuid()::text, 6),
        p_zone, COALESCE(p_vat_ovr::text, 'NULL'), pg_temp.u(3)));
  PERFORM pg_temp.thu(3, format('INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, vat_rate, conversion_factor, line_discount, sort_order)
        VALUES (%L, %L, ''thung'', 3, 240000, 0.1, 24, 24000, 1), (%L, %L, ''hop'', 10, 10000, 0, 1, 0, 2)', v, p1, v, p2));
  RETURN v;
END $f$;

DO $t$
DECLARE p1 uuid; p2 uuid; pi uuid; r record; v text; v_n bigint; e uuid; x uuid;
BEGIN
  p1 := pg_temp.sp('G1a'); p2 := pg_temp.sp('G1b');
  pi := pg_temp.pn(p1, p2);
  PERFORM pg_temp.ghi('G0', 'kế toán lập phiếu nhập nháp 2 dòng', (SELECT count(*) FROM purchase_invoice_lines WHERE invoice_id = pi) = 2, '');
  v := pg_temp.thu(4, format('SELECT complete_purchase_invoice(%L)', pi));
  PERFORM pg_temp.ghi('G1', 'NVBH hoàn thành phiếu nhập → FORBIDDEN, không vào kho', v = 'FORBIDDEN' AND pg_temp.ton(p1) = 0, COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM pg_temp.lay(5, format('SELECT complete_purchase_invoice(%L)', pi));
  SELECT * INTO r FROM purchase_invoices WHERE id = pi;
  PERFORM pg_temp.ghi('G1', 'thủ kho hoàn thành: 3 thùng → 72 hộp, 10 hộp → 10',
    pg_temp.ton(p1, 'sale') = 72 AND pg_temp.ton(p2, 'sale') = 10, format('%s / %s', pg_temp.ton(p1), pg_temp.ton(p2)));
  PERFORM pg_temp.ghi('G1', 'giá vốn mỗi HỘP = (3×240.000 − 24.000)/72 = 9.666,67 (đã trừ CK dòng, không phải giá thùng)',
    (SELECT round(unit_cost, 2) FROM batches WHERE product_id = p1) = 9666.67 AND (SELECT unit_cost FROM batches WHERE product_id = p2) = 10000,
    (SELECT unit_cost::text FROM batches WHERE product_id = p1));
  PERFORM pg_temp.ghi('G1', 'tiền: hàng 796.000 + VAT 69.600 − CK phiếu 6.000 = 859.600',
    r.subtotal = 796000 AND r.vat = 69600 AND r.total = 859600, format('%s + %s = %s', r.subtotal, r.vat, r.total));
  PERFORM pg_temp.ghi('G1', 'công nợ NCC open 859.600 gắn phiếu kho; phiếu Hoàn thành có mã phiếu',
    (SELECT amount = 859600 AND status = 'open' AND stock_entry_id = r.stock_entry_id FROM payables WHERE id = r.payable_id)
      AND r.status = 'completed' AND r.receipt_code IS NOT NULL, format('%s %s', r.status, r.receipt_code));
  PERFORM pg_temp.ghi('G1', 'dòng phiếu kho giữ SL giao dịch 3 thùng, hệ số 24',
    EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = r.stock_entry_id AND qty_in_transaction_uom = 3 AND conversion_factor_snapshot = 24 AND qty_in_base_uom = 72), '');
  SELECT count(*) INTO v_n FROM batches WHERE product_id IN (p1, p2);
  PERFORM pg_temp.lay(5, format('SELECT complete_purchase_invoice(%L)', pi));
  PERFORM pg_temp.ghi('G2', 'hoàn thành lần hai → không nhập thêm (vẫn 2 lô, 72 hộp), một công nợ',
    v_n = 2 AND (SELECT count(*) FROM batches WHERE product_id IN (p1, p2)) = 2 AND pg_temp.ton(p1) = 72
      AND (SELECT count(*) FROM payables WHERE stock_entry_id = r.stock_entry_id) = 1, '');
  v := pg_temp.thu(5, format('SELECT cancel_stock_entry(%L, %L)', r.stock_entry_id, 'x'));
  PERFORM pg_temp.ghi('G3', 'huỷ riêng phiếu kho của phiếu nhập → ENTRY_HAS_SOURCE', v = 'ENTRY_HAS_SOURCE', COALESCE(v, 'KHÔNG CHẶN'));
  -- G4: huỷ phiếu nhập chưa động hàng → lô về 0 (cancelled), công nợ xoá.
  PERFORM pg_temp.lay(3, format('SELECT cancel_purchase_invoice(%L, %L)', pi, 'NCC giao nhầm'));
  PERFORM pg_temp.ghi('G4', 'kế toán huỷ phiếu nhập: tồn 0, lô cancelled, công nợ NCC xoá hẳn, phiếu kho Đã huỷ',
    pg_temp.ton(p1) = 0 AND pg_temp.ton(p2) = 0 AND NOT EXISTS (SELECT 1 FROM payables WHERE id = r.payable_id)
      AND (SELECT status FROM stock_entries WHERE id = r.stock_entry_id) = 'cancelled'
      AND (SELECT bool_and(status = 'cancelled') FROM batches WHERE product_id IN (p1, p2))
      AND (SELECT status = 'cancelled' AND payable_id IS NULL AND cancel_reason = 'NCC giao nhầm' FROM purchase_invoices WHERE id = pi), '');
  PERFORM pg_temp.ghi('G4', 'v_stock_balance_by_zone không còn dòng của phiếu đã huỷ',
    NOT EXISTS (SELECT 1 FROM v_stock_balance_by_zone WHERE product_id IN (p1, p2)), '');
  PERFORM pg_temp.lay(3, format('SELECT cancel_purchase_invoice(%L, %L)', pi, 'lại'));
  PERFORM pg_temp.ghi('G4', 'huỷ lần hai không lỗi, không đổi', (SELECT status FROM purchase_invoices WHERE id = pi) = 'cancelled', '');

  -- G5: phiếu kho date + VAT gõ tay.
  pi := pg_temp.pn(p1, p2, 'date', 50000);
  PERFORM pg_temp.lay(1, format('SELECT complete_purchase_invoice(%L)', pi));
  SELECT * INTO r FROM purchase_invoices WHERE id = pi;
  PERFORM pg_temp.ghi('G5', 'kho date: hàng vào kho date; VAT gõ tay 50.000 thắng VAT tự cộng → tổng 840.000',
    pg_temp.ton(p1, 'date') = 72 AND pg_temp.ton(p1, 'sale') = 0 AND r.vat = 50000 AND r.total = 796000 + 50000 - 6000,
    format('date %s vat %s total %s', pg_temp.ton(p1, 'date'), r.vat, r.total));
  -- G6: đã xuất bớt → không huỷ được.
  x := pg_temp.phieu_nhap('export', 'date');
  PERFORM pg_temp.dong(x, p1, 2);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  v := pg_temp.thu(3, format('SELECT cancel_purchase_invoice(%L, %L)', pi, 'x'));
  PERFORM pg_temp.ghi('G6', 'phiếu nhập đã xuất bớt 2 → HANG_DA_XUAT, tồn 70 giữ nguyên', v = 'HANG_DA_XUAT' AND pg_temp.ton(p1) = 70, COALESCE(v, 'KHÔNG CHẶN'));
  -- G7: đã trả NCC → không huỷ.
  pi := pg_temp.pn(p1, p2, 'sale', -5);
  PERFORM pg_temp.lay(5, format('SELECT complete_purchase_invoice(%L)', pi));
  PERFORM pg_temp.ghi('G7', 'VAT gõ tay âm kẹp về 0 → tổng 790.000', (SELECT vat = 0 AND total = 790000 FROM purchase_invoices WHERE id = pi),
    (SELECT vat || ' ' || total FROM purchase_invoices WHERE id = pi));
  UPDATE payables SET paid = 100000, status = 'partial' WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = pi);
  v := pg_temp.thu(3, format('SELECT cancel_purchase_invoice(%L, %L)', pi, 'x'));
  PERFORM pg_temp.ghi('G7', 'phiếu nhập đã trả NCC 100.000 → DA_TRA_TIEN', v = 'DA_TRA_TIEN', COALESCE(v, 'KHÔNG CHẶN'));
  -- G8: dòng SL 0 → chặn cả phiếu.
  pi := pg_temp.lay(3, format('INSERT INTO purchase_invoices (org_id, supplier_id, status) VALUES (%L, %L, ''draft'') RETURNING id', pg_temp.org(), 'd0c00000-0000-0000-0000-0000000000a1'));
  PERFORM pg_temp.thu(3, format('INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor) VALUES (%L, %L, ''hop'', 0, 1000, 1)', pi, p2));
  v := pg_temp.thu(5, format('SELECT complete_purchase_invoice(%L)', pi));
  PERFORM pg_temp.ghi('G8', 'phiếu nhập có dòng SL 0 → SO_LUONG_KHONG_HOP_LE, không có công nợ',
    v = 'SO_LUONG_KHONG_HOP_LE' AND (SELECT status FROM purchase_invoices WHERE id = pi) = 'draft', COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM pg_temp.thu(3, format('DELETE FROM purchase_invoice_lines WHERE invoice_id = %L', pi));
  v := pg_temp.thu(5, format('SELECT complete_purchase_invoice(%L)', pi));
  PERFORM pg_temp.ghi('G8', 'phiếu nhập không dòng → PHIEU_KHONG_CO_HANG', v = 'PHIEU_KHONG_CO_HANG', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.loi(4, format('INSERT INTO purchase_invoices (org_id, supplier_id, status) VALUES (%L, %L, ''draft'')', pg_temp.org(), 'd0c00000-0000-0000-0000-0000000000a1'));
  PERFORM pg_temp.ghi('G9', 'NVBH lập phiếu nhập → RLS chặn', v LIKE '%row-level security%', COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('G1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- H. TRẢ HÀNG NCC (complete_supplier_return / cancel_supplier_return)
-- ====================================================================
CREATE FUNCTION pg_temp.tncc(p uuid, p_qty numeric, p_conv numeric DEFAULT 1, p_zone text DEFAULT 'sale', p_unit text DEFAULT 'hop') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  v := pg_temp.lay(5, format('INSERT INTO supplier_returns (org_id, supplier_id, status, warehouse_zone, created_by)
        VALUES (%L, %L, ''draft'', %L, %L) RETURNING id', pg_temp.org(), 'd0c00000-0000-0000-0000-0000000000a1', p_zone, pg_temp.u(5)));
  PERFORM pg_temp.thu(5, format('INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, conversion_factor, line_total, sort_order)
        VALUES (%L, %L, %L, %s, 1500, 0, %s, %s, 1)', v, p, p_unit, p_qty, p_conv, p_qty * 1500));
  RETURN v;
END $f$;

DO $t$
DECLARE p uuid; x uuid; y uuid; t uuid; r record; v text; v_pay uuid;
BEGIN
  p := pg_temp.sp('H1');
  x := pg_temp.lo(p, 'H-X', 10, 1000, 100);
  y := pg_temp.lo(p, 'H-Y', 10, 3000, 200);
  t := pg_temp.tncc(p, 15);
  PERFORM pg_temp.lay(5, format('SELECT complete_supplier_return(%L)', t));
  SELECT * INTO r FROM supplier_returns WHERE id = t;
  PERFORM pg_temp.ghi('H1', 'trả NCC 15 hộp: hạn cũ trước → X 10→0, Y 10→5; phiếu Hoàn thành',
    pg_temp.ton_lo(x) = 0 AND pg_temp.ton_lo(y) = 5 AND r.status = 'completed', format('X %s Y %s %s', pg_temp.ton_lo(x), pg_temp.ton_lo(y), r.status));
  PERFORM pg_temp.ghi('H1', 'dòng NỢ ÂM −22.500 (NCC nợ lại mình), tổng phiếu 22.500',
    (SELECT amount FROM payables WHERE id = r.payable_credit_id) = -22500 AND r.total = 22500, (SELECT amount::text FROM payables WHERE id = r.payable_credit_id));
  PERFORM pg_temp.ghi('H1', 'phiếu xuất kho 2 dòng theo lô, giá vốn từng lô (1.000 / 3.000)',
    (SELECT count(*) FROM stock_entry_lines WHERE entry_id = r.stock_entry_id) = 2
      AND EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = r.stock_entry_id AND batch_id = y AND qty_in_base_uom = 5 AND unit_cost = 3000), '');
  PERFORM pg_temp.lay(5, format('SELECT complete_supplier_return(%L)', t));
  PERFORM pg_temp.ghi('H2', 'gửi lần hai → không xuất thêm (Y vẫn 5), một dòng nợ', pg_temp.ton_lo(y) = 5
    AND (SELECT count(*) FROM payables WHERE invoice_number = r.return_code) = 1, '');
  v_pay := r.payable_credit_id;
  PERFORM pg_temp.lay(5, format('SELECT cancel_supplier_return(%L, %L)', t, 'NCC không nhận'));
  PERFORM pg_temp.ghi('H3', 'huỷ phiếu trả NCC → X 10, Y 10, dòng nợ âm xoá, phiếu kho Đã huỷ',
    pg_temp.ton_lo(x) = 10 AND pg_temp.ton_lo(y) = 10 AND NOT EXISTS (SELECT 1 FROM payables WHERE id = v_pay)
      AND (SELECT status FROM stock_entries WHERE id = r.stock_entry_id) = 'cancelled'
      AND (SELECT status FROM supplier_returns WHERE id = t) = 'cancelled', format('X %s Y %s', pg_temp.ton_lo(x), pg_temp.ton_lo(y)));
  PERFORM pg_temp.lay(5, format('SELECT cancel_supplier_return(%L, %L)', t, 'lại'));
  PERFORM pg_temp.ghi('H3', 'huỷ lần hai không cộng thêm (vẫn 20)', pg_temp.ton(p) = 20, pg_temp.ton(p)::text);
  -- H4: thiếu hàng → chặn.
  t := pg_temp.tncc(p, 21);
  v := pg_temp.loi(5, format('SELECT complete_supplier_return(%L)', t));
  PERFORM pg_temp.ghi('H4', 'trả NCC 21 khi kho bán 20 (cờ bán âm tắt) → INSUFFICIENT_STOCK, tồn giữ 20',
    v LIKE 'INSUFFICIENT_STOCK%' AND pg_temp.ton(p) = 20, COALESCE(v, 'KHÔNG CHẶN'));
  -- H5: trả theo thùng (×24 hộp) — kho bán chỉ 20 → thiếu; nhập thêm rồi trả.
  PERFORM pg_temp.lo(p, 'H-Z', 30, 2000, 300);
  t := pg_temp.tncc(p, 1, 24, 'sale', 'thung');
  PERFORM pg_temp.lay(5, format('SELECT complete_supplier_return(%L)', t));
  PERFORM pg_temp.ghi('H5', 'trả NCC 1 thùng → trừ 24 hộp (50 → 26)', pg_temp.ton(p) = 26, pg_temp.ton(p)::text);
  UPDATE payables SET paid = -1000 WHERE id = (SELECT payable_credit_id FROM supplier_returns WHERE id = t);
  v := pg_temp.thu(5, format('SELECT cancel_supplier_return(%L, %L)', t, 'x'));
  PERFORM pg_temp.ghi('H5', 'đã cấn trừ khoản giảm nợ → DA_CAN_TRU, tồn giữ 26', v = 'DA_CAN_TRU' AND pg_temp.ton(p) = 26, COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('H1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- I. TỒN ĐÃ ĐẶT (committed_stock_by_product)
-- ====================================================================
DO $t$
DECLARE p uuid; d1 pg_temp.don; d2 pg_temp.don; d3 pg_temp.don; d4 pg_temp.don; v numeric; inv uuid;
BEGIN
  p := pg_temp.sp('I1');
  PERFORM pg_temp.lo(p, 'I-L', 1000, 1000, 400);
  d1 := pg_temp.don(p, 'thung', 2, 24, 230000);          -- 48 hộp
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (d1.ord, p, 'hop', 5, 10000, 50000, 1, 0);     -- + 5 hộp
  d2 := pg_temp.don(p, 'hop', 10, 1, 10000);
  d3 := pg_temp.don(p, 'hop', 7, 1, 10000, 'draft');
  d4 := pg_temp.don(p, 'hop', 9, 1, 10000, 'cancelled');
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(4)::text, true);
  SELECT committed_base INTO v FROM committed_stock_by_product() WHERE product_id = p;
  PERFORM pg_temp.ghi('I1', 'đã đặt = 2 thùng×24 + 5 hộp + 10 hộp = 63 (nháp / huỷ không tính)', v = 63, COALESCE(v::text, 'NULL'));
  SELECT committed_base INTO v FROM committed_stock_by_product(d1.ord) WHERE product_id = p;
  PERFORM pg_temp.ghi('I1', 'trừ chính đơn đang sửa (p_exclude_order) → 10', v = 10, COALESCE(v::text, 'NULL'));
  inv := pg_temp.xuat_hd(d2);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(4)::text, true);
  SELECT committed_base INTO v FROM committed_stock_by_product() WHERE product_id = p;
  PERFORM pg_temp.ghi('I2', 'đơn 10 hộp đã xuất HĐ (Hoàn thành) → không còn giữ hàng: 53', v = 53, COALESCE(v::text, 'NULL'));
  SELECT committed_base INTO v FROM committed_stock_by_product(d1.ord) WHERE product_id = p;
  PERFORM pg_temp.ghi('I2', 'loại đơn còn lại → mặt hàng không còn dòng (0 không trả về)', v IS NULL, COALESCE(v::text, 'NULL'));
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('I1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- K. SOẠN HÀNG / LƯỢT SOẠN (mig 224-225) — hoàn tất KHÔNG trừ kho
-- ====================================================================
CREATE TEMP TABLE ton_truoc (id uuid, qty numeric);
GRANT ALL ON ton_truoc TO authenticated;
DO $t$
DECLARE p uuid; i1 uuid; i2 uuid; i3 uuid; l uuid; l2 uuid; v text; v_n int; v_ma text; ids uuid[];
BEGIN
  p := pg_temp.sp('K1');
  PERFORM pg_temp.lo(p, 'K-L', 1000, 1000, 400);
  i1 := pg_temp.xuat_hd(pg_temp.don(p, 'hop', 3, 1, 10000));
  i2 := pg_temp.xuat_hd(pg_temp.don(p, 'thung', 1, 24, 230000));
  i3 := pg_temp.xuat_hd(pg_temp.don(p, 'hop', 2, 1, 10000));
  v := pg_temp.thu(4, format('SELECT tao_luot_soan(ARRAY[%L]::uuid[])', i1));
  PERFORM pg_temp.ghi('K1', 'NVBH tạo lượt soạn → KHONG_DU_QUYEN', v = 'KHONG_DU_QUYEN', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(5, 'SELECT tao_luot_soan(ARRAY[]::uuid[])');
  PERFORM pg_temp.ghi('K1', 'lượt không hoá đơn → CHUA_CHON_HOA_DON', v = 'CHUA_CHON_HOA_DON', COALESCE(v, 'KHÔNG CHẶN'));
  SELECT array_agg(gen_random_uuid()) INTO ids FROM generate_series(1, 27);
  v := pg_temp.thu(5, format('SELECT tao_luot_soan(%L::uuid[])', ids));
  PERFORM pg_temp.ghi('K1', '27 hoá đơn (quá rổ A–Z) → QUA_NHIEU_RO', v = 'QUA_NHIEU_RO', COALESCE(v, 'KHÔNG CHẶN'));
  l := pg_temp.lay(5, format('SELECT tao_luot_soan(ARRAY[%L, %L, %L]::uuid[])', i2, i1, i2));
  SELECT ma INTO v_ma FROM luot_soan WHERE id = l;
  PERFORM pg_temp.ghi('K1', 'thủ kho tạo lượt: giữ thứ tự rổ (i2, i1), bỏ trùng, mã SH-dd/mm-NN theo ngày VN',
    (SELECT invoice_ids FROM luot_soan WHERE id = l) = ARRAY[i2, i1]
      AND v_ma = 'SH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM') || '-' || lpad((SELECT count(*) FROM luot_soan WHERE org_id = pg_temp.org())::text, 2, '0'),
    v_ma);
  l2 := pg_temp.lay(3, format('SELECT tao_luot_soan(ARRAY[%L]::uuid[])', i3));
  PERFORM pg_temp.ghi('K1', 'kế toán tạo được lượt thứ hai; số thứ tự tăng 1',
    right((SELECT ma FROM luot_soan WHERE id = l2), 2)::int = right(v_ma, 2)::int + 1, (SELECT ma FROM luot_soan WHERE id = l2));
  -- Huỷ HĐ i3 rồi thêm vào lượt → chặn.
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  PERFORM cancel_invoice(i3, 'thử soạn');
  PERFORM set_config('npp.via_rpc', '', true);
  INSERT INTO ton_truoc SELECT id, qty_on_hand FROM batches;
  v := pg_temp.thu(5, format('SELECT cap_nhat_luot_soan(%L, ARRAY[%L, %L]::uuid[])', l, i1, i3));
  PERFORM pg_temp.ghi('K2', 'thêm HĐ đã huỷ vào lượt → HOA_DON_KHONG_HOP_LE', v = 'HOA_DON_KHONG_HOP_LE', COALESCE(v, 'KHÔNG CHẶN'));
  PERFORM pg_temp.thu(2, format('SELECT cap_nhat_luot_soan(%L, NULL, %L::jsonb, NULL)', l, jsonb_build_object(p::text, 27)));
  PERFORM pg_temp.ghi('K2', 'quản lý ghi tiến độ nhặt 27 (đơn vị cơ sở)', (SELECT tien_do -> 'nhat' ->> p::text FROM luot_soan WHERE id = l) = '27', '');
  -- Đánh dấu i1 đã soạn trước bằng tay → hoàn tất chỉ đánh dấu thêm i2, giữ mốc cũ của i1.
  PERFORM pg_temp.thu(5, format('SELECT danh_dau_soan_hang(ARRAY[%L]::uuid[], true)', i1));
  v_n := (pg_temp.lay_json(5, format('SELECT to_jsonb(hoan_tat_luot_soan(%L))', l)))::text::int;
  PERFORM pg_temp.ghi('K3', 'hoàn tất lượt: chỉ HĐ chưa soạn được đánh dấu (1), lượt "xong"',
    v_n = 1 AND (SELECT trang_thai FROM luot_soan WHERE id = l) = 'xong' AND (SELECT soan_luc IS NOT NULL FROM sales_invoices WHERE id = i2),
    format('n=%s', v_n));
  PERFORM pg_temp.ghi('K3', 'hoàn tất soạn KHÔNG trừ kho (mọi lô giữ nguyên số)',
    NOT EXISTS (SELECT 1 FROM batches b JOIN ton_truoc t USING (id) WHERE b.qty_on_hand IS DISTINCT FROM t.qty), '');
  v := pg_temp.thu(5, format('SELECT hoan_tat_luot_soan(%L)', l));
  PERFORM pg_temp.ghi('K3', 'hoàn tất lần hai → LUOT_DA_DONG', v = 'LUOT_DA_DONG', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(5, format('SELECT huy_luot_soan(%L)', l));
  PERFORM pg_temp.ghi('K3', 'huỷ lượt đã xong → KHONG_TIM_THAY_LUOT', v = 'KHONG_TIM_THAY_LUOT', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(4, format('SELECT huy_luot_soan(%L)', l2));
  PERFORM pg_temp.ghi('K4', 'NVBH huỷ lượt → KHONG_DU_QUYEN', v = 'KHONG_DU_QUYEN', COALESCE(v, 'KHÔNG CHẶN'));
  v := pg_temp.thu(5, format('SELECT huy_luot_soan(%L)', l2));
  PERFORM pg_temp.ghi('K4', 'thủ kho huỷ lượt đang soạn → trạng thái huy', v IS NULL AND (SELECT trang_thai FROM luot_soan WHERE id = l2) = 'huy', COALESCE(v, 'ok'));
  v_n := (pg_temp.lay_json(5, format('SELECT to_jsonb(danh_dau_soan_hang(ARRAY[%L, %L]::uuid[], false))', i1, i2)))::text::int;
  PERFORM pg_temp.ghi('K5', 'bỏ dấu đã soạn 2 HĐ → 2 dòng, soan_luc/soan_boi về NULL',
    v_n = 2 AND (SELECT bool_and(soan_luc IS NULL AND soan_boi IS NULL) FROM sales_invoices WHERE id IN (i1, i2)), format('n=%s', v_n));
  v := pg_temp.thu(4, format('SELECT danh_dau_soan_hang(ARRAY[%L]::uuid[], true)', i1));
  PERFORM pg_temp.ghi('K5', 'NVBH đánh dấu soạn → KHONG_DU_QUYEN', v = 'KHONG_DU_QUYEN', COALESCE(v, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('K1', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- L. THẺ KHO KHỚP TỒN THẬT — sau chuỗi nhập / xuất lẻ / HĐ / huỷ HĐ / kiểm kê / trả NCC (chỉ qua phiếu)
-- ====================================================================
DO $t$
DECLARE p uuid; x uuid; inv uuid; t uuid; b uuid;
BEGIN
  p := pg_temp.sp('L1');
  PERFORM pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-L1a', 'lines', jsonb_build_array(pg_temp.dn(p, 'thung', 3, 24, 1000))));
  PERFORM pg_temp.nhap(5, jsonb_build_object('entry_code', 'DK-L1b', 'lines', jsonb_build_array(pg_temp.dn(p, 'hop', 12.5, 1, 1100))));
  x := pg_temp.phieu_nhap('export');
  PERFORM pg_temp.dong(x, p, 4.5);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  inv := pg_temp.xuat_hd(pg_temp.don(p, 'thung', 1, 24, 230000));
  PERFORM pg_temp.xuat_hd(pg_temp.don(p, 'hop', 6, 1, 10000));
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  PERFORM cancel_invoice(inv, 'thẻ kho');
  PERFORM set_config('npp.via_rpc', '', true);
  SELECT batch_id INTO b FROM stock_entry_lines l JOIN stock_entries e ON e.id = l.entry_id WHERE e.entry_code = 'DK-L1a';
  x := pg_temp.phieu_nhap('stocktake');
  PERFORM pg_temp.dong(x, p, -2, b, 1000);
  PERFORM pg_temp.ghi('L1', 'quản lý duyệt kiểm kê −2 chạy được', pg_temp.loi(2, format('SELECT post_stock_adjustment(%L)', x)) IS NULL, '');
  t := pg_temp.tncc(p, 3);
  PERFORM pg_temp.lay(5, format('SELECT complete_supplier_return(%L)', t));
  -- 72 + 12,5 − 4,5 − 24 + 24 − 6 − 2 − 3 = 69
  PERFORM pg_temp.ghi('L1', 'tồn sau chuỗi phiếu = 72 + 12,5 − 4,5 − 24 + 24 − 6 − 2 − 3 = 69', pg_temp.ton(p) = 69, pg_temp.ton(p)::text);
  PERFORM pg_temp.ghi('L1', 'thẻ kho (v_stock_movements, đã ghi sổ) kho bán = tồn thật 69', pg_temp.the(p, 'sale') = 69 AND pg_temp.the(p, 'date') = 0,
    format('thẻ sale %s date %s', pg_temp.the(p, 'sale'), pg_temp.the(p, 'date')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L1', 'NỔ', false, SQLERRM);
END $t$;

SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
