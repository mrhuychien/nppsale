-- ====================================================================
-- ĐỘI TEST "KHO & MUA HÀNG" — LỖI SẢN PHẨM ĐÃ XÁC MINH (các phép kiểm này ĐANG ĐỎ; sửa xong phải XANH).
--   psql -h /tmp/pgtest -p 55432 -U postgres -d npp_kho -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/kho-loi.sql
--   BEGIN … ROLLBACK; kết quả ở bảng tạm kq, cuối SELECT.
--
-- LỖI 1 — mig 222 chép lại post_stock_issue / complete_supplier_return / cancel_supplier_return từ bản 144/146/147
--   (TRƯỚC mig 166) nên RƠI MẤT cổng vai "(mig 166)". Luật: CLAUDE.md "Tồn kho, trạng thái chứng từ chỉ đổi qua RPC",
--   CLAUDE.md §3 + mig 166: "Hàm SECURITY DEFINER bỏ qua RLS, nên phải tự kiểm đúng vai mà RLS của bảng đang kiểm"
--   (post_stock_issue: owner,warehouse; trả NCC: owner,manager,accountant,warehouse). Nay NVBH ghi sổ được phiếu
--   xuất kho nháp của thủ kho (trừ kho), gửi / huỷ phiếu trả NCC (xuất kho + đổi công nợ NCC).
--
-- LỖI 2 — Thẻ kho theo kho (v_stock_movements, mig 048 — ngăn kéo "Lịch sử" ở bảng tồn) lấy kho của dòng từ
--   batches(batch_id) và coi mọi loại phiếu ≠ export là số dương. Phiếu chuyển kho (mig 148) và phiếu xuất kho lẻ
--   (mig 144) KHÔNG ghi batch_id lên dòng → dòng rơi về 'sale', phiếu chuyển kho còn mang dấu +. Ngăn kéo hứa
--   "Tồn sau cộng riêng theo từng kho" (stock-history-drawer.tsx) → tồn chạy từng kho sai.
--
-- LỖI 3 — Kiểm kê số lẻ: stock_entry_lines.quantity là integer, màn /inventory/stocktake-adjust gửi
--   quantity = chênh lệch (số lẻ, page.tsx:339) qua PostgREST (json_populate_recordset) → lỗi "invalid input syntax
--   for type integer" — không lưu được phiếu kiểm kê cho hàng tồn lẻ (nhập kho cho phép 2,5 — xem kho.sql A5).
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
GRANT ALL ON kq TO authenticated;
GRANT ALL ON SEQUENCE kq_stt_seq TO authenticated;

CREATE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;
CREATE FUNCTION pg_temp.org() RETURNS uuid LANGUAGE sql AS $f$ SELECT 'a0000000-0000-0000-0000-000000000001'::uuid $f$;
CREATE FUNCTION pg_temp.ghi(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS
$f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi) $f$;
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
CREATE FUNCTION pg_temp.sp(p_tag text) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (pg_temp.org(), 'DKL-' || p_tag, 'Đội kho lỗi ' || p_tag, 'hop', 0, 10000, 'active') RETURNING id $f$;
CREATE FUNCTION pg_temp.ton(p uuid, z text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND (z IS NULL OR warehouse_zone = z) $f$;
CREATE FUNCTION pg_temp.the(p uuid, z text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(signed_qty_in_base_uom), 0) FROM v_stock_movements
   WHERE product_id = p AND warehouse_zone = z AND entry_status = 'posted' $f$;
-- Nhập qua phiếu (thủ kho) để thẻ kho có điểm xuất phát thật.
CREATE FUNCTION pg_temp.nhap(p uuid, p_qty numeric, p_zone text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT pg_temp.lay(5, format('SELECT entry_id FROM post_stock_import(%L::jsonb)', jsonb_build_object(
    'entry_code', 'DKL-N-' || left(gen_random_uuid()::text, 6), 'warehouse_zone', p_zone,
    'lines', jsonb_build_array(jsonb_build_object('product_id', p, 'unit_name', 'hop', 'qty_tx', p_qty, 'conv', 1,
      'base_qty', p_qty, 'base_cost', 1000, 'expires_at', current_date + 400))))) $f$;
CREATE FUNCTION pg_temp.phieu(p_type text, p_zone text, p_dest text, p uuid, p_qty numeric) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE e uuid;
BEGIN
  e := pg_temp.lay(5, format('INSERT INTO stock_entries (org_id, entry_code, type, status, warehouse_zone, dest_warehouse_zone, created_by)
         VALUES (%L, %L, %L, ''draft'', %L, %L, %L) RETURNING id', pg_temp.org(), 'DKL-' || left(gen_random_uuid()::text, 8), p_type, p_zone, p_dest, pg_temp.u(5)));
  PERFORM pg_temp.lay(5, format('INSERT INTO stock_entry_lines (entry_id, product_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot)
         VALUES (%L, %L, ''hop'', %s, %s, %s, ''hop'', 1) RETURNING id', e, p, round(p_qty)::int, p_qty, p_qty));
  RETURN e;
END $f$;

SELECT set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
UPDATE organizations SET allow_oversell = false WHERE id = pg_temp.org();
INSERT INTO suppliers (id, org_id, name) VALUES ('d0c00000-0000-0000-0000-0000000000b1', pg_temp.org(), 'NCC đội kho lỗi');

-- ====================================================================
-- LỖI 1 — cổng vai mig 166 bị mig 222 xoá mất
-- ====================================================================
DO $t$
DECLARE p uuid; x uuid; t uuid; v text;
BEGIN
  p := pg_temp.sp('Q1');
  PERFORM pg_temp.nhap(p, 20, 'sale');
  -- Thủ kho lập phiếu xuất kho NHÁP 5 hộp; NVBH (không được ghi phiếu kho theo RLS) bấm ghi sổ thẳng RPC.
  x := pg_temp.phieu('export', 'sale', NULL, p, 5);
  v := pg_temp.thu(4, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('L1a', 'NVBH ghi sổ phiếu xuất kho lẻ → phải FORBIDDEN, tồn giữ 20',
    v = 'FORBIDDEN' AND pg_temp.ton(p) = 20, format('lỗi=%s, tồn=%s, phiếu=%s', COALESCE(v, 'KHÔNG CHẶN'), pg_temp.ton(p), (SELECT status FROM stock_entries WHERE id = x)));
  x := pg_temp.phieu('export', 'sale', NULL, p, 1);
  v := pg_temp.thu(3, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('L1b', 'kế toán ghi sổ phiếu xuất kho lẻ → phải FORBIDDEN (RLS phiếu kho chỉ owner/warehouse)',
    v = 'FORBIDDEN', format('lỗi=%s, tồn=%s', COALESCE(v, 'KHÔNG CHẶN'), pg_temp.ton(p)));

  -- Phiếu trả NCC nháp (thủ kho lập) 4 hộp; NVBH gửi.
  t := pg_temp.lay(5, format('INSERT INTO supplier_returns (org_id, supplier_id, status, warehouse_zone, created_by) VALUES (%L, %L, ''draft'', ''sale'', %L) RETURNING id',
        pg_temp.org(), 'd0c00000-0000-0000-0000-0000000000b1', pg_temp.u(5)));
  PERFORM pg_temp.thu(5, format('INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total) VALUES (%L, %L, ''hop'', 4, 1000, 1, 4000)', t, p));
  v := pg_temp.thu(4, format('SELECT complete_supplier_return(%L)', t));
  PERFORM pg_temp.ghi('L1c', 'NVBH gửi phiếu trả NCC → phải FORBIDDEN, không xuất kho, không ghi công nợ NCC',
    v = 'FORBIDDEN' AND (SELECT status FROM supplier_returns WHERE id = t) = 'draft',
    format('lỗi=%s, phiếu=%s, nợ NCC=%s', COALESCE(v, 'KHÔNG CHẶN'), (SELECT status FROM supplier_returns WHERE id = t),
      (SELECT amount FROM payables WHERE id = (SELECT payable_credit_id FROM supplier_returns WHERE id = t))));
  -- Bảo đảm phiếu đã hoàn thành (bởi thủ kho) rồi thử NVBH huỷ.
  PERFORM pg_temp.thu(5, format('SELECT complete_supplier_return(%L)', t));
  v := pg_temp.thu(4, format('SELECT cancel_supplier_return(%L, %L)', t, 'NVBH huỷ'));
  PERFORM pg_temp.ghi('L1d', 'NVBH huỷ phiếu trả NCC đã hoàn thành → phải FORBIDDEN (không cộng kho, không xoá công nợ NCC)',
    v = 'FORBIDDEN' AND (SELECT status FROM supplier_returns WHERE id = t) = 'completed',
    format('lỗi=%s, phiếu=%s', COALESCE(v, 'KHÔNG CHẶN'), (SELECT status FROM supplier_returns WHERE id = t)));
  PERFORM pg_temp.ghi('L1e', 'đủ 3 hàm này mang cổng vai "(mig 166)" như 5 hàm anh em',
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%(mig 166)%'
       AND proname IN ('post_stock_issue', 'complete_supplier_return', 'cancel_supplier_return')) = 3,
    (SELECT string_agg(proname, ', ') FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc NOT LIKE '%(mig 166)%'
       AND proname IN ('post_stock_issue', 'complete_supplier_return', 'cancel_supplier_return')) || ' thiếu cổng');
END $t$;

-- ====================================================================
-- LỖI 2 — thẻ kho theo kho sai với phiếu chuyển kho và xuất kho từ kho date
-- ====================================================================
DO $t$
DECLARE p uuid; q uuid; x uuid;
BEGIN
  p := pg_temp.sp('T1');
  PERFORM pg_temp.nhap(p, 30, 'sale');
  x := pg_temp.phieu('transfer', 'sale', 'date', p, 10);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_transfer(%L)', x));
  PERFORM pg_temp.ghi('L2a', 'tồn thật sau chuyển 10 bán→date: bán 20, date 10 (RPC đúng)', pg_temp.ton(p, 'sale') = 20 AND pg_temp.ton(p, 'date') = 10, '');
  PERFORM pg_temp.ghi('L2b', 'thẻ kho kho bán phải = 20 (30 − 10)', pg_temp.the(p, 'sale') = 20, 'thẻ kho bán = ' || pg_temp.the(p, 'sale'));
  PERFORM pg_temp.ghi('L2c', 'thẻ kho kho date phải = 10', pg_temp.the(p, 'date') = 10, 'thẻ kho date = ' || pg_temp.the(p, 'date'));

  q := pg_temp.sp('T2');
  PERFORM pg_temp.nhap(q, 8, 'date');
  x := pg_temp.phieu('export', 'date', NULL, q, 5);
  PERFORM pg_temp.lay(5, format('SELECT post_stock_issue(%L)', x));
  PERFORM pg_temp.ghi('L2d', 'xuất lẻ 5 từ kho date: thẻ kho date phải = 8 − 5 = 3 (tồn thật 3)',
    pg_temp.the(q, 'date') = 3 AND pg_temp.ton(q, 'date') = 3, format('thẻ date = %s, thẻ bán = %s, tồn date = %s', pg_temp.the(q, 'date'), pg_temp.the(q, 'sale'), pg_temp.ton(q, 'date')));
  PERFORM pg_temp.ghi('L2e', 'kho bán không có giao dịch nào → thẻ kho bán phải = 0', pg_temp.the(q, 'sale') = 0, 'thẻ kho bán = ' || pg_temp.the(q, 'sale'));
END $t$;

-- ====================================================================
-- LỖI 3 — phiếu kiểm kê chênh lệch số lẻ không lưu được (cột quantity integer)
-- ====================================================================
DO $t$
DECLARE p uuid; e uuid; v text;
BEGIN
  p := pg_temp.sp('K1');
  PERFORM pg_temp.lay(5, format('SELECT entry_id FROM post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'DKL-K1',
    'lines', jsonb_build_array(jsonb_build_object('product_id', p, 'unit_name', 'hop', 'qty_tx', 2.5, 'conv', 1, 'base_qty', 2.5, 'base_cost', 1000)))));
  e := pg_temp.lay(5, format('INSERT INTO stock_entries (org_id, entry_code, type, status, created_by) VALUES (%L, ''DKL-KK'', ''stocktake'', ''draft'', %L) RETURNING id', pg_temp.org(), pg_temp.u(5)));
  -- Đúng tải trọng màn kiểm kê gửi khi đếm được 2 (hệ thống 2,5) — PostgREST chèn qua json_populate_recordset.
  v := pg_temp.thu(5, format($q$INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot, unit_cost)
        SELECT entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom, transaction_uom, conversion_factor_snapshot, unit_cost
        FROM json_populate_recordset(NULL::stock_entry_lines, %L::json)$q$,
        json_build_array(json_build_object('entry_id', e, 'product_id', p, 'batch_id', (SELECT id FROM batches WHERE product_id = p),
          'unit_name', 'hop', 'quantity', -0.5, 'qty_in_base_uom', -0.5, 'qty_in_transaction_uom', -0.5, 'transaction_uom', 'hop',
          'conversion_factor_snapshot', 1, 'unit_cost', 1000))));
  PERFORM pg_temp.ghi('L3a', 'lưu phiếu kiểm kê chênh −0,5 (tồn 2,5, đếm 2) → phải lưu được',
    v IS NULL AND EXISTS (SELECT 1 FROM stock_entry_lines WHERE entry_id = e), COALESCE(v, 'ok'));
  IF v IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', pg_temp.u(2)::text, true);
    PERFORM post_stock_adjustment(e);
    PERFORM pg_temp.ghi('L3b', 'duyệt → tồn 2,5 − 0,5 = 2 (không làm tròn chênh lệch)', pg_temp.ton(p) = 2, pg_temp.ton(p)::text);
  ELSE
    PERFORM pg_temp.ghi('L3b', 'duyệt → tồn 2,5 − 0,5 = 2 (không làm tròn chênh lệch)', false, 'không lưu được phiếu nên chưa duyệt được');
  END IF;
END $t$;

SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
