-- ====================================================================
-- ĐỘI TEST "TRẢ HÀNG" — bộ chống lỗi lâu dài cho phiếu trả TỰ SINH / TỰ LẬP.
--   Chạy (DB thử ở máy, KHÔNG chạy trên Supabase):
--     psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tra_hang -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/tra-hang.sql
--   Toàn bộ trong BEGIN … ROLLBACK; kết quả ở bảng tạm kq(buoc, ten, ok, ghi), cuối SELECT.
--   Mỗi kịch bản là một khối DO có bẫy lỗi: nổ bất ngờ → một dòng ok=false "NỔ".
--
-- Luật (CLAUDE.md, mig 186/188/191/192/210/211/214/216/217):
--   · Tự sinh (credit_with_invoice): trừ nợ vào HĐ NGAY lúc xuất; phiếu treo Chờ xử lý;
--     không huỷ khi Chờ xử lý; đã nhập kho thì huỷ = đảo kho, về Chờ xử lý, nợ giữ nguyên.
--   · Tự lập: Nháp → Hoàn thành → Đã huỷ; hoàn thành = nhập kho + trừ nợ (gắn HĐ → vào HĐ;
--     không gắn → dòng công nợ âm receivables.return_id). Sửa / huỷ luôn được.
--   · Hàng đổi không tính tiền. revenue_date: tự sinh = ngày HĐ; tự lập = ngày hoàn thành (giờ VN).
--   · Công nợ âm không kẹp 0. Chỉ phiếu Nháp ghi thẳng được từ trình duyệt.
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;

-- Quyền như Supabase cho vai trình duyệt (chỉ DB thử của đội).
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
GRANT ALL ON kq TO authenticated;
GRANT ALL ON SEQUENCE kq_stt_seq TO authenticated;

-- ---------------------------------------------------------------------
-- Tiện ích
-- ---------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(p_n int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('e0000000-0000-0000-0000-00000000000' || p_n)::uuid $f$;

CREATE FUNCTION pg_temp.ghi(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS
$f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi) $f$;

-- Chạy một câu dưới danh nghĩa user n (1 owner, 2 manager, 3 accountant, 4 sales, 5 warehouse,
-- 6 sales thứ hai), vai Postgres `authenticated` như trình duyệt. Trả mã lỗi hoặc NULL.
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

-- Như thu() nhưng trả uuid do câu lệnh trả về (RPC trả uuid).
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

-- User phụ: sales thứ hai (6).
-- (vai driver đã ngưng — trigger trg_block_driver_role chặn tạo.)
INSERT INTO auth.users (id, email) VALUES (pg_temp.u(6), 'sales2@doi-test.vn');
INSERT INTO users (id, org_id, full_name, role) VALUES
  (pg_temp.u(6), 'a0000000-0000-0000-0000-000000000001', 'NVBH Hai', 'sales');
SELECT set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);

-- Bộ dữ liệu riêng: khách mới, P1 (hop, thung=12), P2 (goi), P3 (chai, không có trên đơn); đơn submitted.
--   Đơn: 5 thùng P1 × 120.000 = 600.000 + 20 gói P2 × 5.000 = 100.000 → 700.000.
--   Tồn sale: P1 1000 hộp (giá vốn 800/hộp), P2 500 gói (3.000), P3 100 chai (5.000).
CREATE TYPE pg_temp.bo AS (cust uuid, p1 uuid, p2 uuid, p3 uuid, ord uuid, l1 uuid, l2 uuid);
CREATE FUNCTION pg_temp.moi(p_tag text, p_nv int DEFAULT 4) RETURNS pg_temp.bo LANGUAGE plpgsql AS $f$
DECLARE cust uuid; p1 uuid; p2 uuid; p3 uuid; ord uuid; l1 uuid; l2 uuid;
  v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_seq int;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES (v_org, 'KH đội trả ' || p_tag, 'Chủ ' || p_tag, '08' || lpad((random()*1e8)::int::text, 8, '0'), 'Đ/c ' || p_tag)
  RETURNING id INTO cust;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT1-' || p_tag, 'Đội trả P1 ' || p_tag, 'hop', 0, 10000, 'active') RETURNING id INTO p1;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT2-' || p_tag, 'Đội trả P2 ' || p_tag, 'goi', 0, 5000, 'active') RETURNING id INTO p2;
  INSERT INTO products (org_id, sku, name, base_unit, vat_rate, sell_price, status)
  VALUES (v_org, 'DT3-' || p_tag, 'Đội trả P3 ' || p_tag, 'chai', 0, 8000, 'active') RETURNING id INTO p3;
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (p1, 'thung', 12);
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, p1, 'DB1-' || p_tag, current_date + 400, 1000, 1000, 800, 'sale', now() - interval '10 day'),
         (v_org, p2, 'DB2-' || p_tag, current_date + 400, 500, 500, 3000, 'sale', now() - interval '10 day'),
         (v_org, p3, 'DB3-' || p_tag, current_date + 400, 100, 100, 5000, 'sale', now() - interval '10 day');
  UPDATE batches SET warehouse_zone = 'sale' WHERE product_id IN (p1, p2, p3);
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_seq FROM sales_orders;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, status, order_seq, subtotal, total, payment_terms, order_date)
  VALUES (v_org, 'DTDH-' || p_tag || '-' || v_seq, cust, pg_temp.u(p_nv), 'submitted', v_seq, 700000, 700000, 'COD', current_date)
  RETURNING id INTO ord;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p1, 'thung', 5, 120000, 600000, 12, 0) RETURNING id INTO l1;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_total, conversion_factor, vat_rate)
  VALUES (ord, p2, 'goi', 20, 5000, 100000, 1, 0) RETURNING id INTO l2;
  RETURN ROW(cust, p1, p2, p3, ord, l1, l2)::pg_temp.bo;
END $f$;

CREATE FUNCTION pg_temp.dong_don(d pg_temp.bo) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(
    jsonb_build_object('order_line_id', d.l1, 'product_id', d.p1, 'unit_name', 'thung', 'quantity', 5, 'unit_price', 120000, 'vat_rate', 0),
    jsonb_build_object('order_line_id', d.l2, 'product_id', d.p2, 'unit_name', 'goi', 'quantity', 20, 'unit_price', 5000, 'vat_rate', 0))
$f$;
CREATE FUNCTION pg_temp.dong_hd(p_inv uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id,
           'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
           'unit_price', unit_price, 'is_exchange', is_exchange, 'vat_rate', vat_rate) ORDER BY sort_order)
  FROM sales_invoice_lines WHERE invoice_id = p_inv
$f$;
CREATE FUNCTION pg_temp.xuat(p_ord uuid, p_lines jsonb, p_adds jsonb DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  SELECT * INTO r FROM post_invoice(jsonb_strip_nulls(jsonb_build_object(
    'order_id', p_ord, 'lines', p_lines, 'return_adds', p_adds, 'invoice_date', p_date, 'allow_oversell', true)));
  RETURN r.invoice_id;
END $f$;
CREATE FUNCTION pg_temp.tra(d pg_temp.bo, p_qty numeric DEFAULT 1, p_unit text DEFAULT 'thung', p_price numeric DEFAULT 120000, p_vat numeric DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_array(jsonb_build_object('product_id', d.p1, 'unit_name', p_unit, 'quantity', p_qty, 'unit_price', p_price, 'vat_rate', p_vat))
$f$;
-- Nợ màn hình (loadCustomerDebt): Σ(amount − paid) các dòng status <> 'paid'.
CREATE FUNCTION pg_temp.no(c uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = c AND status <> 'paid' $f$;
CREATE FUNCTION pg_temp.no_hd(p_inv uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT amount FROM receivables WHERE invoice_id = p_inv $f$;
CREATE FUNCTION pg_temp.ton(p uuid, z text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND (z IS NULL OR warehouse_zone = z) $f$;
CREATE FUNCTION pg_temp.st(p_ret uuid) RETURNS text LANGUAGE sql AS $f$ SELECT status FROM returns WHERE id = p_ret $f$;
CREATE FUNCTION pg_temp.cr(p_ret uuid) RETURNS numeric LANGUAGE sql AS $f$ SELECT COALESCE(credit_note_amount, 0) FROM returns WHERE id = p_ret $f$;
CREATE FUNCTION pg_temp.rd(p_ret uuid) RETURNS date LANGUAGE sql AS $f$ SELECT revenue_date FROM returns WHERE id = p_ret $f$;
-- Dòng công nợ âm của phiếu tự lập độc lập.
CREATE FUNCTION pg_temp.no_tra(p_ret uuid) RETURNS numeric LANGUAGE sql AS $f$ SELECT amount FROM receivables WHERE return_id = p_ret $f$;
CREATE FUNCTION pg_temp.thu_tien(c uuid, p_rc uuid, p_amt numeric, p_use numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  RETURN create_cash_receipt(jsonb_build_object('customer_id', c, 'method', 'cash', 'use_credit', p_use,
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', p_rc, 'amount', p_amt))));
END $f$;
CREATE FUNCTION pg_temp.hom_nay() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
-- Số phiếu nhập còn hiệu lực (chưa đảo) của một phiếu trả.
CREATE FUNCTION pg_temp.so_nhap(p_ret uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || p_ret $f$;

-- ====================================================================
-- A. TỰ SINH — xuất HĐ kèm hàng trả
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_err text; v_e uuid; v_ngay date := pg_temp.hom_nay() - 3;
BEGIN
  d := pg_temp.moi('A1');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d), v_ngay);
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.ghi('A1', 'xuất HĐ kèm trả: phiếu tự sinh Chờ xử lý, mã TH-',
    pg_temp.st(v_ret) = 'submitted' AND (SELECT credit_with_invoice FROM returns WHERE id = v_ret)
      AND (SELECT return_code FROM returns WHERE id = v_ret) LIKE 'TH-%',
    format('status %s, cwi %s, mã %s', pg_temp.st(v_ret), (SELECT credit_with_invoice FROM returns WHERE id = v_ret), (SELECT return_code FROM returns WHERE id = v_ret)));
  PERFORM pg_temp.ghi('A1', 'nợ HĐ trừ NGAY lúc xuất: 700.000 − 120.000 = 580.000; kho CHƯA nhập (P1 940)',
    pg_temp.no_hd(v_inv) = 580000 AND pg_temp.ton(d.p1) = 940 AND pg_temp.cr(v_ret) = 120000,
    format('nợ %s, tồn P1 %s, credit %s', pg_temp.no_hd(v_inv), pg_temp.ton(d.p1), pg_temp.cr(v_ret)));
  PERFORM pg_temp.ghi('A1', 'revenue_date = ngày HĐ (lùi 3 ngày) ngay khi Chờ xử lý',
    pg_temp.rd(v_ret) = v_ngay, format('%s vs %s', pg_temp.rd(v_ret), v_ngay));

  -- A2: huỷ khi Chờ xử lý bị chặn, mọi vai có quyền
  v_err := pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ghi('A2', 'chủ huỷ phiếu tự sinh Chờ xử lý → RETURN_FOLLOWS_INVOICE', v_err = 'RETURN_FOLLOWS_INVOICE', COALESCE(v_err, 'KHÔNG CHẶN'));

  -- A3: ngày nhập kho (mig 211): tương lai / trước HĐ bị chặn
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L, %L::date)', v_ret, 'sale', pg_temp.hom_nay() + 1));
  PERFORM pg_temp.ghi('A3', 'nhập kho ngày mai → NGAY_NHAP_TUONG_LAI', v_err = 'NGAY_NHAP_TUONG_LAI', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L, %L::date)', v_ret, 'sale', v_ngay - 1));
  PERFORM pg_temp.ghi('A3', 'nhập kho trước ngày HĐ → NGAY_NHAP_TRUOC_HOA_DON', v_err = 'NGAY_NHAP_TRUOC_HOA_DON', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'kho_la'));
  PERFORM pg_temp.ghi('A3', 'kho nhận lạ → BAD_ZONE, phiếu vẫn Chờ xử lý',
    v_err = 'BAD_ZONE' AND pg_temp.st(v_ret) = 'submitted', COALESCE(v_err, 'KHÔNG CHẶN') || ' / ' || pg_temp.st(v_ret));
  PERFORM pg_temp.ghi('A3', 'sau 3 lần bị chặn: không có phiếu nhập, tồn P1 vẫn 940',
    pg_temp.so_nhap(v_ret) = 0 AND pg_temp.ton(d.p1) = 940, format('phiếu nhập %s, tồn %s', pg_temp.so_nhap(v_ret), pg_temp.ton(d.p1)));

  -- A4: thủ kho nhập kho ngày HĐ + 1 (lùi): mốc 12:00 VN, nợ giữ, revenue_date vẫn ngày HĐ
  v_e := pg_temp.lay(5, format('SELECT entry_id FROM complete_return(%L, %L, %L::date)', v_ret, 'date', v_ngay + 1));
  PERFORM pg_temp.ghi('A4', 'thủ kho nhập kho date ngày lùi: completed, tồn date P1 12, nợ HĐ vẫn 580.000',
    pg_temp.st(v_ret) = 'completed' AND pg_temp.ton(d.p1, 'date') = 12 AND pg_temp.no_hd(v_inv) = 580000,
    format('%s, date %s, nợ %s', pg_temp.st(v_ret), pg_temp.ton(d.p1, 'date'), pg_temp.no_hd(v_inv)));
  PERFORM pg_temp.ghi('A4', 'phiếu nhập & completed_at = 12:00 giờ VN ngày chọn (05:00 UTC)',
    (SELECT posted_at FROM stock_entries WHERE id = v_e) = ((v_ngay + 1) + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND (SELECT completed_at FROM returns WHERE id = v_ret) = ((v_ngay + 1) + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND to_char((SELECT posted_at FROM stock_entries WHERE id = v_e) AT TIME ZONE 'UTC', 'HH24:MI') = '05:00',
    format('posted_at %s', (SELECT posted_at FROM stock_entries WHERE id = v_e)));
  PERFORM pg_temp.ghi('A4', 'revenue_date tự sinh không đổi theo ngày nhập kho (vẫn ngày HĐ)',
    pg_temp.rd(v_ret) = v_ngay, format('%s', pg_temp.rd(v_ret)));

  -- A5: gửi hai lần Hoàn thành → lần 2 chặn, kho không cộng hai lần
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'date'));
  PERFORM pg_temp.ghi('A5', 'bấm Hoàn thành lần 2 → RETURN_NOT_SUBMITTED, tồn date P1 vẫn 12',
    v_err = 'RETURN_NOT_SUBMITTED' AND pg_temp.ton(d.p1, 'date') = 12, COALESCE(v_err, 'KHÔNG CHẶN') || format(' / date %s', pg_temp.ton(d.p1, 'date')));

  -- A6: huỷ khi đã nhập = đảo kho, VỀ Chờ xử lý, nợ giữ; huỷ lần 2 (đang Chờ xử lý) bị chặn
  v_err := pg_temp.thu(2, format('SELECT cancel_return(%L, %L)', v_ret, 'nhập nhầm kho'));
  PERFORM pg_temp.ghi('A6', 'quản lý huỷ nhập kho: về submitted, date P1 0, nợ HĐ 580.000, completed_at NULL',
    v_err IS NULL AND pg_temp.st(v_ret) = 'submitted' AND pg_temp.ton(d.p1, 'date') = 0 AND pg_temp.no_hd(v_inv) = 580000
      AND (SELECT completed_at FROM returns WHERE id = v_ret) IS NULL,
    format('err %s, %s, date %s, nợ %s', v_err, pg_temp.st(v_ret), pg_temp.ton(d.p1, 'date'), pg_temp.no_hd(v_inv)));
  PERFORM pg_temp.ghi('A6', 'revenue_date sau khi về Chờ xử lý vẫn = ngày HĐ', pg_temp.rd(v_ret) = v_ngay, format('%s', pg_temp.rd(v_ret)));
  v_err := pg_temp.thu(2, format('SELECT cancel_return(%L, %L)', v_ret, 'lần 2'));
  PERFORM pg_temp.ghi('A6', 'huỷ lần 2 (đang Chờ xử lý) → RETURN_FOLLOWS_INVOICE, kho không âm thêm',
    v_err = 'RETURN_FOLLOWS_INVOICE' AND pg_temp.ton(d.p1) = 940, COALESCE(v_err, 'KHÔNG CHẶN') || format(' / tồn %s', pg_temp.ton(d.p1)));
  -- nhập lại vào sale (hôm nay)
  PERFORM pg_temp.thu(1, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ghi('A6', 'nhập lại kho sale sau khi huỷ: tồn P1 952, chỉ 1 phiếu nhập hiệu lực',
    pg_temp.ton(d.p1) = 952 AND pg_temp.so_nhap(v_ret) = 1, format('tồn %s, phiếu nhập hiệu lực %s', pg_temp.ton(d.p1), pg_temp.so_nhap(v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A', 'NỔ', false, SQLERRM);
END $t$;

-- A7: số lẻ + thuế + quy đổi: trả 1,5 thùng × 120.000 × (1 + 10%) = 198.000; nhập 18 hộp
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid;
BEGIN
  d := pg_temp.moi('A7');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 1.5, 'thung', 120000, 0.1));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.ghi('A7', 'trả 1,5 thùng VAT 10%: credit 198.000, nợ HĐ 502.000',
    pg_temp.cr(v_ret) = 198000 AND pg_temp.no_hd(v_inv) = 502000, format('credit %s, nợ %s', pg_temp.cr(v_ret), pg_temp.no_hd(v_inv)));
  PERFORM pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ghi('A7', 'nhập kho 1,5 thùng = 18 hộp (cơ sở): tồn P1 958',
    pg_temp.ton(d.p1) = 958 AND (SELECT sum(sel.qty_in_base_uom) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
                                 WHERE se.notes = 'Nhập lại từ phiếu trả ' || v_ret) = 18,
    format('tồn %s', pg_temp.ton(d.p1)));
  PERFORM pg_temp.thu(5, format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ghi('A7', 'huỷ nhập số lẻ: đảo đúng 18 hộp, tồn P1 940', pg_temp.ton(d.p1) = 940, format('tồn %s', pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A7', 'NỔ', false, SQLERRM);
END $t$;

-- A8: dòng trả SL 0 / âm trong return_adds bị bỏ; chỉ dòng dương ghi
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid;
BEGIN
  d := pg_temp.moi('A8');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d),
     pg_temp.tra(d, 0) || pg_temp.tra(d, -2) || pg_temp.tra(d, 1));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.ghi('A8', 'return_adds SL 0 / −2 / 1: chỉ 1 dòng, credit 120.000, nợ 580.000',
    (SELECT count(*) FROM return_lines WHERE return_id = v_ret) = 1 AND pg_temp.cr(v_ret) = 120000 AND pg_temp.no_hd(v_inv) = 580000,
    format('dòng %s, credit %s, nợ %s', (SELECT count(*) FROM return_lines WHERE return_id = v_ret), pg_temp.cr(v_ret), pg_temp.no_hd(v_inv)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A8', 'NỔ', false, SQLERRM);
END $t$;

-- A9: HĐ đã thu đủ (580.000) → huỷ nhập kho tự sinh: nợ không đổi; sửa HĐ bỏ hết hàng trả → nợ còn 120.000
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; r record; v_err text;
BEGIN
  d := pg_temp.moi('A9');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.thu_tien(d.cust, (SELECT id FROM receivables WHERE invoice_id = v_inv), 580000);
  PERFORM pg_temp.ghi('A9', 'thu đủ 580.000: công nợ HĐ paid, nợ khách 0',
    (SELECT status FROM receivables WHERE invoice_id = v_inv) = 'paid' AND pg_temp.no(d.cust) = 0,
    format('%s, nợ %s', (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust)));
  PERFORM pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  v_err := pg_temp.thu(5, format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ghi('A9', 'tiền đã thu: nhập rồi huỷ nhập vẫn được, nợ khách vẫn 0',
    v_err IS NULL AND pg_temp.st(v_ret) = 'submitted' AND pg_temp.no(d.cust) = 0, format('err %s, nợ %s', v_err, pg_temp.no(d.cust)));
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true,
     'return_edits', (SELECT jsonb_agg(jsonb_build_object('line_id', id, 'quantity', 0)) FROM return_lines WHERE return_id = v_ret)));
  PERFORM pg_temp.ghi('A9', 'sửa HĐ bỏ hết hàng trả sau khi đã thu 580.000: nợ khách tăng lại 120.000',
    pg_temp.no(d.cust) = 120000 AND pg_temp.no_hd(r.invoice_id) = 700000,
    format('nợ khách %s, nợ HĐ mới %s', pg_temp.no(d.cust), pg_temp.no_hd(r.invoice_id)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A9', 'NỔ', false, SQLERRM);
END $t$;

-- A10: sửa HĐ có phiếu đã nhập: Có (lam_lai) chỉ đổi giá bán, KHÔNG sửa dòng trả → phiếu về Chờ xử lý, kho đảo,
--      nợ = tổng mới − credit; Không (giu) → giữ nhập kho, gắn tờ mới.
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; r record; v_lines jsonb;
BEGIN
  d := pg_temp.moi('A10');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 2));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  SELECT jsonb_agg(CASE WHEN (x->>'product_id')::uuid = d.p2 THEN x || '{"unit_price": 6000}'::jsonb ELSE x END)
    INTO v_lines FROM jsonb_array_elements(pg_temp.dong_hd(v_inv)) x;
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', v_lines, 'allow_oversell', true, 'tra_da_nhap', 'lam_lai'));
  PERFORM pg_temp.ghi('A10', 'Có (lam_lai) không sửa dòng trả: phiếu về Chờ xử lý, bám tờ mới, tồn P1 940, nợ 720.000 − 240.000',
    pg_temp.st(v_ret) = 'submitted' AND (SELECT invoice_id FROM returns WHERE id = v_ret) = r.invoice_id
      AND pg_temp.ton(d.p1) = 940 AND pg_temp.no_hd(r.invoice_id) = 480000 AND pg_temp.so_nhap(v_ret) = 0,
    format('%s, tồn %s, nợ %s, phiếu nhập hiệu lực %s', pg_temp.st(v_ret), pg_temp.ton(d.p1), pg_temp.no_hd(r.invoice_id), pg_temp.so_nhap(v_ret)));
  PERFORM pg_temp.ghi('A10', 'tờ cũ không còn dòng công nợ (một HĐ một phiếu nợ)', pg_temp.no_hd(v_inv) IS NULL, format('%s', pg_temp.no_hd(v_inv)));
  v_inv := r.invoice_id;
  PERFORM pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  SELECT * INTO r FROM reissue_invoice(v_inv, jsonb_build_object('lines', pg_temp.dong_hd(v_inv), 'allow_oversell', true, 'tra_da_nhap', 'giu'));
  PERFORM pg_temp.ghi('A10', 'Không (giu): phiếu vẫn completed, tồn P1 964, gắn tờ mới, nợ 480.000',
    pg_temp.st(v_ret) = 'completed' AND pg_temp.ton(d.p1) = 964 AND (SELECT invoice_id FROM returns WHERE id = v_ret) = r.invoice_id
      AND pg_temp.no_hd(r.invoice_id) = 480000 AND pg_temp.so_nhap(v_ret) = 1,
    format('%s, tồn %s, nợ %s', pg_temp.st(v_ret), pg_temp.ton(d.p1), pg_temp.no_hd(r.invoice_id)));
  PERFORM pg_temp.ghi('A10', 'qua hai lần sửa vẫn chỉ MỘT phiếu trả của khách', (SELECT count(*) FROM returns WHERE customer_id = d.cust) = 1,
    format('%s', (SELECT count(*) FROM returns WHERE customer_id = d.cust)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A10', 'NỔ', false, SQLERRM);
END $t$;

-- A11: huỷ HĐ có phiếu tự sinh Chờ xử lý → phiếu Đã huỷ, revenue_date NULL, đơn Đã huỷ (mig 217)
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid;
BEGIN
  d := pg_temp.moi('A11');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = v_inv;
  PERFORM cancel_invoice(v_inv, 'khách huỷ');
  PERFORM pg_temp.ghi('A11', 'huỷ HĐ: phiếu tự sinh cancelled, revenue_date NULL, đơn cancelled, nợ khách 0, tồn P1 1000',
    pg_temp.st(v_ret) = 'cancelled' AND pg_temp.rd(v_ret) IS NULL AND (SELECT status FROM sales_orders WHERE id = d.ord) = 'cancelled'
      AND pg_temp.no(d.cust) = 0 AND pg_temp.ton(d.p1) = 1000,
    format('%s, rd %s, đơn %s, nợ %s, tồn %s', pg_temp.st(v_ret), pg_temp.rd(v_ret), (SELECT status FROM sales_orders WHERE id = d.ord), pg_temp.no(d.cust), pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A11', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- B. TỰ LẬP độc lập (không gắn HĐ) — công nợ âm receivables.return_id
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_err text; v_l jsonb;
BEGIN
  d := pg_temp.moi('B1');
  -- 2 thùng P1 (240.000) + 3 chai P3 hàng ĐỔI (8.000, không tính tiền)
  v_l := pg_temp.tra(d, 2) || jsonb_build_array(jsonb_build_object('product_id', d.p3, 'unit_name', 'chai', 'quantity', 3, 'unit_price', 8000, 'is_exchange', true));
  v_ret := pg_temp.lay(2, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'reason', 'damaged', 'lines', v_l)));
  PERFORM pg_temp.ghi('B1', 'quản lý lập Nháp: draft, không tự sinh, credit 240.000 (hàng đổi 0đ), chưa có dòng công nợ, kho chưa đổi',
    pg_temp.st(v_ret) = 'draft' AND NOT COALESCE((SELECT credit_with_invoice FROM returns WHERE id = v_ret), false)
      AND pg_temp.cr(v_ret) = 240000 AND pg_temp.no_tra(v_ret) IS NULL AND pg_temp.ton(d.p1) = 1000 AND pg_temp.rd(v_ret) IS NULL,
    format('%s, credit %s, nợ trả %s, tồn %s, rd %s', pg_temp.st(v_ret), pg_temp.cr(v_ret), pg_temp.no_tra(v_ret), pg_temp.ton(d.p1), pg_temp.rd(v_ret)));
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L, %L::date)', v_ret, 'sale', pg_temp.hom_nay()));
  PERFORM pg_temp.ghi('B1', 'tự lập không chọn ngày nhập kho (mig 211) → NGAY_NHAP_CHI_TU_SINH', v_err = 'NGAY_NHAP_CHI_TU_SINH', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ghi('B1', 'thủ kho hoàn thành Nháp: completed, P1 +24 hộp (1024), P3 +3 (hàng đổi vẫn vào kho, 103)',
    v_err IS NULL AND pg_temp.st(v_ret) = 'completed' AND pg_temp.ton(d.p1) = 1024 AND pg_temp.ton(d.p3) = 103,
    format('err %s, %s, P1 %s, P3 %s', v_err, pg_temp.st(v_ret), pg_temp.ton(d.p1), pg_temp.ton(d.p3)));
  PERFORM pg_temp.ghi('B1', 'dòng công nợ âm −240.000, open, nợ khách −240.000, revenue_date hôm nay (giờ VN)',
    pg_temp.no_tra(v_ret) = -240000 AND (SELECT status FROM receivables WHERE return_id = v_ret) = 'open' AND pg_temp.no(d.cust) = -240000
      AND pg_temp.rd(v_ret) = pg_temp.hom_nay(),
    format('dòng %s/%s, nợ khách %s, rd %s', pg_temp.no_tra(v_ret), (SELECT status FROM receivables WHERE return_id = v_ret), pg_temp.no(d.cust), pg_temp.rd(v_ret)));
  -- gửi hai lần Ghi nhận (save_pos_return complete=true, cùng nội dung) → kho & nợ không nhân đôi
  PERFORM pg_temp.lay(2, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'reason', 'damaged', 'lines', v_l, 'complete', true)));
  PERFORM pg_temp.lay(2, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'reason', 'damaged', 'lines', v_l, 'complete', true)));
  PERFORM pg_temp.ghi('B1', 'Ghi nhận lại 2 lần cùng nội dung: tồn P1 1024, P3 103, dòng âm −240.000, 1 phiếu nhập hiệu lực, 1 dòng công nợ',
    pg_temp.ton(d.p1) = 1024 AND pg_temp.ton(d.p3) = 103 AND pg_temp.no_tra(v_ret) = -240000 AND pg_temp.so_nhap(v_ret) = 1
      AND (SELECT count(*) FROM receivables WHERE return_id = v_ret) = 1,
    format('P1 %s, P3 %s, nợ %s, nhập %s', pg_temp.ton(d.p1), pg_temp.ton(d.p3), pg_temp.no_tra(v_ret), pg_temp.so_nhap(v_ret)));
  -- sửa giảm còn 1 thùng (Ghi nhận)
  PERFORM pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'lines', pg_temp.tra(d, 1), 'complete', true, 'zone', 'date')));
  PERFORM pg_temp.ghi('B1', 'sửa còn 1 thùng vào kho date: P1 sale 1000 + date 12, P3 về 100, dòng âm −120.000',
    pg_temp.ton(d.p1, 'sale') = 1000 AND pg_temp.ton(d.p1, 'date') = 12 AND pg_temp.ton(d.p3) = 100 AND pg_temp.no_tra(v_ret) = -120000,
    format('sale %s, date %s, P3 %s, nợ %s', pg_temp.ton(d.p1, 'sale'), pg_temp.ton(d.p1, 'date'), pg_temp.ton(d.p3), pg_temp.no_tra(v_ret)));
  -- huỷ, rồi huỷ lần 2
  v_err := pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'khách lấy lại'));
  PERFORM pg_temp.ghi('B1', 'huỷ tự lập đã hoàn thành: cancelled, P1 1000, dòng công nợ 0, nợ khách 0, revenue_date NULL',
    v_err IS NULL AND pg_temp.st(v_ret) = 'cancelled' AND pg_temp.ton(d.p1) = 1000 AND pg_temp.no_tra(v_ret) = 0 AND pg_temp.no(d.cust) = 0
      AND pg_temp.rd(v_ret) IS NULL,
    format('err %s, %s, P1 %s, nợ trả %s, nợ %s, rd %s', v_err, pg_temp.st(v_ret), pg_temp.ton(d.p1), pg_temp.no_tra(v_ret), pg_temp.no(d.cust), pg_temp.rd(v_ret)));
  v_err := pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'lần 2'));
  PERFORM pg_temp.ghi('B1', 'huỷ lần 2 → RETURN_NOT_CANCELLABLE, kho không trừ thêm',
    v_err = 'RETURN_NOT_CANCELLABLE' AND pg_temp.ton(d.p1) = 1000, COALESCE(v_err, 'KHÔNG CHẶN') || format(' / P1 %s', pg_temp.ton(d.p1)));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'lines', pg_temp.tra(d, 1))));
  PERFORM pg_temp.ghi('B1', 'sửa phiếu đã huỷ → RETURN_LOCKED', v_err = 'RETURN_LOCKED', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(1, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ghi('B1', 'hoàn thành phiếu đã huỷ → RETURN_NOT_SUBMITTED', v_err = 'RETURN_NOT_SUBMITTED', COALESCE(v_err, 'KHÔNG CHẶN'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B1', 'NỔ', false, SQLERRM);
END $t$;

-- B2: biên dòng hàng: SL 0 / âm bị bỏ; toàn 0 → BAD_PAYLOAD; mảng rỗng → BAD_PAYLOAD; trùng dòng cộng dồn
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_err text;
BEGIN
  d := pg_temp.moi('B2');
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
            'lines', pg_temp.tra(d, 0) || pg_temp.tra(d, -3) || pg_temp.tra(d, 2))));
  PERFORM pg_temp.ghi('B2', 'dòng SL 0 / −3 bị bỏ, chỉ giữ 2 thùng: 1 dòng, credit 240.000',
    (SELECT count(*) FROM return_lines WHERE return_id = v_ret) = 1 AND pg_temp.cr(v_ret) = 240000,
    format('dòng %s, credit %s', (SELECT count(*) FROM return_lines WHERE return_id = v_ret), pg_temp.cr(v_ret)));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 0))));
  PERFORM pg_temp.ghi('B2', 'mọi dòng SL 0 → BAD_PAYLOAD', v_err = 'BAD_PAYLOAD', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', '[]'::jsonb)));
  PERFORM pg_temp.ghi('B2', 'mảng dòng rỗng → BAD_PAYLOAD', v_err = 'BAD_PAYLOAD', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', gen_random_uuid(), 'lines', pg_temp.tra(d, 1))));
  PERFORM pg_temp.ghi('B2', 'khách không tồn tại → CUSTOMER_NOT_FOUND', v_err = 'CUSTOMER_NOT_FOUND', COALESCE(v_err, 'KHÔNG CHẶN'));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', gen_random_uuid(), 'lines', pg_temp.tra(d, 1))));
  PERFORM pg_temp.ghi('B2', 'HĐ gốc không tồn tại → INVOICE_NOT_FOUND', v_err = 'INVOICE_NOT_FOUND', COALESCE(v_err, 'KHÔNG CHẶN'));
  -- trùng dòng: 1 thùng + 1 thùng + 6 hộp (10.000) → 2 dòng thùng + 1 dòng hộp; credit 300.000; nhập 30 hộp
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
            'lines', pg_temp.tra(d, 1) || pg_temp.tra(d, 1) || pg_temp.tra(d, 6, 'hop', 10000), 'complete', true)));
  PERFORM pg_temp.ghi('B2', 'trùng dòng + đơn vị cơ sở: 3 dòng, credit 300.000, P1 1030, dòng âm −300.000',
    (SELECT count(*) FROM return_lines WHERE return_id = v_ret) = 3 AND pg_temp.cr(v_ret) = 300000 AND pg_temp.ton(d.p1) = 1030
      AND pg_temp.no_tra(v_ret) = -300000,
    format('dòng %s, credit %s, P1 %s, nợ %s', (SELECT count(*) FROM return_lines WHERE return_id = v_ret), pg_temp.cr(v_ret), pg_temp.ton(d.p1), pg_temp.no_tra(v_ret)));
  -- thành tiền máy chủ tự tính: gửi line_total khống không ăn
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
            'lines', jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi', 'quantity', 3, 'unit_price', 3333.33, 'vat_rate', 0.08, 'line_total', 99999999)))));
  PERFORM pg_temp.ghi('B2', 'thành tiền = round(3 × 3.333,33 × 1,08) = 10.800, bỏ line_total gửi lên',
    pg_temp.cr(v_ret) = 10800 AND (SELECT line_total FROM return_lines WHERE return_id = v_ret) = 10800,
    format('credit %s', pg_temp.cr(v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B2', 'NỔ', false, SQLERRM);
END $t$;

-- B3: ngày chứng từ lùi (return_date) → revenue_date & hạn công nợ âm theo ngày đó; giờ phiên UTC không đổi kết quả
DO $t$
DECLARE d pg_temp.bo; v_ret uuid; v_ngay date := pg_temp.hom_nay() - 9;
BEGIN
  PERFORM set_config('TimeZone', 'UTC', true);
  d := pg_temp.moi('B3');
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust,
            'lines', pg_temp.tra(d, 1), 'complete', true, 'return_date', v_ngay)));
  PERFORM pg_temp.ghi('B3', 'phiên giờ UTC, ngày chứng từ lùi 9 ngày: revenue_date = ngày chứng từ, credited_at = 12:00 VN',
    pg_temp.rd(v_ret) = v_ngay AND (SELECT credited_at FROM returns WHERE id = v_ret) = (v_ngay + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',
    format('rd %s, credited_at %s', pg_temp.rd(v_ret), (SELECT credited_at FROM returns WHERE id = v_ret)));
  PERFORM pg_temp.ghi('B3', 'dòng công nợ âm hạn = ngày chứng từ', (SELECT due_date FROM receivables WHERE return_id = v_ret) = v_ngay,
    format('%s', (SELECT due_date FROM receivables WHERE return_id = v_ret)));
  PERFORM set_config('TimeZone', 'Asia/Ho_Chi_Minh', true);
  PERFORM pg_temp.ghi('B3', 'đổi phiên sang giờ VN: revenue_date (DATE) không xê dịch', pg_temp.rd(v_ret) = v_ngay, format('%s', pg_temp.rd(v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B3', 'NỔ', false, SQLERRM);
END $t$;

-- B4: dư có đã dùng ở phiếu thu → sửa / huỷ vẫn được, nợ tăng lại
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_err text;
BEGIN
  d := pg_temp.moi('B4');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  -- độc lập 1 thùng −120.000
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 1), 'complete', true)));
  PERFORM pg_temp.ghi('B4', 'HĐ 700.000 + độc lập −120.000: nợ khách 580.000', pg_temp.no(d.cust) = 580000, format('%s', pg_temp.no(d.cust)));
  PERFORM pg_temp.thu_tien(d.cust, (SELECT id FROM receivables WHERE invoice_id = v_inv), 700000, 120000);
  PERFORM pg_temp.ghi('B4', 'thu HĐ 700.000 rút 120.000 dư có: nợ khách 0, dòng âm paid',
    pg_temp.no(d.cust) = 0 AND (SELECT status FROM receivables WHERE return_id = v_ret) = 'paid',
    format('nợ %s, dòng âm %s', pg_temp.no(d.cust), (SELECT status FROM receivables WHERE return_id = v_ret)));
  v_err := pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'huỷ sau khi dùng dư có'));
  PERFORM pg_temp.ghi('B4', 'huỷ phiếu khi dư có đã dùng: được, nợ khách tăng lại 120.000, kho đảo',
    v_err IS NULL AND pg_temp.no(d.cust) = 120000 AND pg_temp.ton(d.p1) = 940,
    format('err %s, nợ %s, P1 %s', v_err, pg_temp.no(d.cust), pg_temp.ton(d.p1)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B4', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- C. TỰ LẬP gắn HĐ
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_err text; d2 pg_temp.bo; v_inv2 uuid;
BEGIN
  d := pg_temp.moi('C1');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  -- trả 7 thùng (840.000) > HĐ 700.000 → công nợ âm −140.000
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 7))));
  PERFORM pg_temp.ghi('C1', 'Nháp gắn HĐ: chưa trừ nợ (700.000), không dòng công nợ riêng',
    pg_temp.no_hd(v_inv) = 700000 AND pg_temp.no_tra(v_ret) IS NULL, format('nợ %s', pg_temp.no_hd(v_inv)));
  PERFORM pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ret, 'sale'));
  PERFORM pg_temp.ghi('C1', 'hoàn thành trả vượt: nợ HĐ −140.000 (âm, không kẹp 0), open, nợ khách −140.000, P1 1024',
    pg_temp.no_hd(v_inv) = -140000 AND (SELECT status FROM receivables WHERE invoice_id = v_inv) = 'open' AND pg_temp.no(d.cust) = -140000
      AND pg_temp.ton(d.p1) = 1024 AND pg_temp.no_tra(v_ret) IS NULL,
    format('nợ HĐ %s/%s, nợ khách %s, P1 %s', pg_temp.no_hd(v_inv), (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust), pg_temp.ton(d.p1)));
  PERFORM pg_temp.ghi('C1', 'revenue_date tự lập gắn HĐ = ngày hoàn thành (không phải ngày HĐ)', pg_temp.rd(v_ret) = pg_temp.hom_nay(), format('%s', pg_temp.rd(v_ret)));
  -- gỡ HĐ (sửa thành độc lập) → nợ HĐ về 700.000, dòng âm −840.000
  PERFORM pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'lines', pg_temp.tra(d, 7), 'complete', true)));
  PERFORM pg_temp.ghi('C1', 'gỡ HĐ: nợ HĐ 700.000, dòng âm −840.000, nợ khách −140.000, P1 1024',
    pg_temp.no_hd(v_inv) = 700000 AND pg_temp.no_tra(v_ret) = -840000 AND pg_temp.no(d.cust) = -140000 AND pg_temp.ton(d.p1) = 1024,
    format('nợ HĐ %s, dòng âm %s, nợ khách %s, P1 %s', pg_temp.no_hd(v_inv), pg_temp.no_tra(v_ret), pg_temp.no(d.cust), pg_temp.ton(d.p1)));
  -- gắn sang HĐ của khách khác → chặn
  d2 := pg_temp.moi('C1b');
  v_inv2 := pg_temp.xuat(d2.ord, pg_temp.dong_don(d2));
  v_err := pg_temp.thu(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv2, 'lines', pg_temp.tra(d, 1), 'complete', true)));
  PERFORM pg_temp.ghi('C1', 'gắn HĐ của khách khác → INVOICE_CUSTOMER_MISMATCH, mọi thứ giữ nguyên',
    v_err = 'INVOICE_CUSTOMER_MISMATCH' AND pg_temp.no_hd(v_inv2) = 700000 AND pg_temp.no_tra(v_ret) = -840000 AND pg_temp.ton(d.p1) = 1024,
    format('%s / nợ B %s, dòng âm A %s', COALESCE(v_err, 'KHÔNG CHẶN'), pg_temp.no_hd(v_inv2), pg_temp.no_tra(v_ret)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C1', 'NỔ', false, SQLERRM);
END $t$;

-- C2: HĐ đã thu đủ → tự lập gắn HĐ hoàn thành: dư có (paid > amount) vẫn open, trừ vào nợ; huỷ → về paid
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid;
BEGIN
  d := pg_temp.moi('C2');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d));
  PERFORM pg_temp.thu_tien(d.cust, (SELECT id FROM receivables WHERE invoice_id = v_inv), 700000);
  v_ret := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 1), 'complete', true)));
  PERFORM pg_temp.ghi('C2', 'HĐ đã thu đủ, trả 120.000: dòng HĐ 580.000/paid 700.000 open, nợ khách −120.000',
    pg_temp.no_hd(v_inv) = 580000 AND (SELECT status FROM receivables WHERE invoice_id = v_inv) = 'open' AND pg_temp.no(d.cust) = -120000,
    format('%s/%s, nợ %s', pg_temp.no_hd(v_inv), (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust)));
  PERFORM pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_ret, 'x'));
  PERFORM pg_temp.ghi('C2', 'huỷ: dòng HĐ 700.000 paid, nợ khách 0',
    pg_temp.no_hd(v_inv) = 700000 AND (SELECT status FROM receivables WHERE invoice_id = v_inv) = 'paid' AND pg_temp.no(d.cust) = 0,
    format('%s/%s, nợ %s', pg_temp.no_hd(v_inv), (SELECT status FROM receivables WHERE invoice_id = v_inv), pg_temp.no(d.cust)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C2', 'NỔ', false, SQLERRM);
END $t$;

-- C3: phiếu tự sinh + phiếu tự lập trên CÙNG HĐ → nợ trừ cả hai, không trùng
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ts uuid; v_tl uuid;
BEGIN
  d := pg_temp.moi('C3');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 1));
  SELECT id INTO v_ts FROM returns WHERE invoice_id = v_inv;
  v_tl := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv,
            'lines', jsonb_build_array(jsonb_build_object('product_id', d.p2, 'unit_name', 'goi', 'quantity', 4, 'unit_price', 5000)), 'complete', true)));
  PERFORM pg_temp.ghi('C3', 'HĐ 700.000 − tự sinh 120.000 − tự lập 20.000 = 560.000; P2 tồn 484',
    pg_temp.no_hd(v_inv) = 560000 AND pg_temp.ton(d.p2) = 484 AND pg_temp.st(v_ts) = 'submitted' AND pg_temp.st(v_tl) = 'completed',
    format('nợ %s, P2 %s', pg_temp.no_hd(v_inv), pg_temp.ton(d.p2)));
  PERFORM pg_temp.thu(1, format('SELECT complete_return(%L, %L)', v_ts, 'sale'));
  PERFORM pg_temp.ghi('C3', 'nhập kho tự sinh: nợ HĐ không đổi 560.000', pg_temp.no_hd(v_inv) = 560000, format('%s', pg_temp.no_hd(v_inv)));
  PERFORM pg_temp.thu(1, format('SELECT cancel_return(%L, %L)', v_tl, 'x'));
  PERFORM pg_temp.ghi('C3', 'huỷ tự lập: nợ HĐ 580.000 (chỉ còn trừ tự sinh)', pg_temp.no_hd(v_inv) = 580000, format('%s', pg_temp.no_hd(v_inv)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C3', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- D. QUYỀN theo vai (gọi RPC dưới vai authenticated như trình duyệt)
-- ====================================================================
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ret uuid; v_ts uuid; v_err text; n int; v_ok text := ''; v_kt text;
BEGIN
  d := pg_temp.moi('D1');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 1));
  SELECT id INTO v_ts FROM returns WHERE invoice_id = v_inv;
  -- Lập phiếu POS: owner / manager / sales được; accountant / warehouse / driver bị chặn
  FOREACH n IN ARRAY ARRAY[1, 2, 4, 3, 5] LOOP
    v_err := pg_temp.thu(n, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 1))));
    v_ok := v_ok || format('u%s=%s ', n, COALESCE(v_err, 'được'));
  END LOOP;
  PERFORM pg_temp.ghi('D1', 'lập phiếu trả POS: chủ/QL/NVBH được; kế toán/thủ kho FORBIDDEN',
    v_ok = 'u1=được u2=được u4=được u3=FORBIDDEN u5=FORBIDDEN ', v_ok);
  -- Hoàn thành: owner / manager / warehouse được; accountant / sales / driver bị chặn
  v_ok := '';
  FOREACH n IN ARRAY ARRAY[3, 4] LOOP
    v_err := pg_temp.thu(n, format('SELECT complete_return(%L, %L)', v_ts, 'sale'));
    v_ok := v_ok || format('u%s=%s ', n, COALESCE(v_err, 'được'));
  END LOOP;
  PERFORM pg_temp.ghi('D1', 'hoàn thành phiếu tự sinh: kế toán / NVBH FORBIDDEN, phiếu vẫn Chờ xử lý, kho không đổi',
    v_ok = 'u3=FORBIDDEN u4=FORBIDDEN ' AND pg_temp.st(v_ts) = 'submitted' AND pg_temp.ton(d.p1) = 940, v_ok);
  v_err := pg_temp.thu(5, format('SELECT complete_return(%L, %L)', v_ts, 'sale'));
  PERFORM pg_temp.ghi('D1', 'thủ kho hoàn thành được (returns.approve)', v_err IS NULL AND pg_temp.st(v_ts) = 'completed', COALESCE(v_err, 'được'));
  v_ok := '';
  FOREACH n IN ARRAY ARRAY[3, 4] LOOP
    v_err := pg_temp.thu(n, format('SELECT cancel_return(%L, %L)', v_ts, 'x'));
    v_ok := v_ok || format('u%s=%s ', n, COALESCE(v_err, 'được'));
  END LOOP;
  PERFORM pg_temp.ghi('D1', 'huỷ nhập kho: kế toán / NVBH FORBIDDEN, phiếu vẫn completed',
    v_ok = 'u3=FORBIDDEN u4=FORBIDDEN ' AND pg_temp.st(v_ts) = 'completed', v_ok);
  -- NVBH: sửa Nháp của mình được; Ghi nhận (complete) thì không
  v_ret := pg_temp.lay(4, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 1))));
  v_err := pg_temp.thu(4, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 2))));
  PERFORM pg_temp.ghi('D1', 'NVBH sửa Nháp của mình (HĐ của mình) được: SL 2, credit 240.000',
    v_err IS NULL AND pg_temp.cr(v_ret) = 240000, COALESCE(v_err, 'được') || format(' / credit %s', pg_temp.cr(v_ret)));
  v_err := pg_temp.thu(4, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 2), 'complete', true)));
  PERFORM pg_temp.ghi('D1', 'NVBH Ghi nhận (nhập kho + trừ nợ) → FORBIDDEN, phiếu vẫn Nháp, nợ không đổi',
    v_err = 'FORBIDDEN' AND pg_temp.st(v_ret) = 'draft' AND pg_temp.no_hd(v_inv) = 580000,
    COALESCE(v_err, 'KHÔNG CHẶN') || format(' / %s, nợ %s', pg_temp.st(v_ret), pg_temp.no_hd(v_inv)));
  -- NVBH thứ hai không sửa Nháp của NVBH một
  v_err := pg_temp.thu(6, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('return_id', v_ret, 'customer_id', d.cust, 'invoice_id', v_inv, 'lines', pg_temp.tra(d, 9))));
  PERFORM pg_temp.ghi('D1', 'NVBH khác sửa Nháp không phải của mình → FORBIDDEN, credit giữ 240.000',
    v_err = 'FORBIDDEN' AND pg_temp.cr(v_ret) = 240000, COALESCE(v_err, 'KHÔNG CHẶN'));
  -- Kế toán đọc được phiếu; NVBH khác không thấy phiếu (RLS)
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(6)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*)::text INTO v_kt FROM returns WHERE id = v_ts;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.ghi('D1', 'RLS: NVBH khác không đọc được phiếu tự sinh của HĐ người khác', v_kt = '0', 'thấy ' || v_kt);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(3)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*)::text INTO v_kt FROM returns WHERE id = v_ts;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(1)::text, true);
  PERFORM pg_temp.ghi('D1', 'RLS: kế toán đọc được phiếu', v_kt = '1', 'thấy ' || v_kt);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D1', 'NỔ', false, SQLERRM);
END $t$;

-- D2: ghi thẳng từ trình duyệt (mig 214) — chỉ phiếu Nháp
DO $t$
DECLARE d pg_temp.bo; v_inv uuid; v_ts uuid; v_tl uuid; v_err text; v_cr numeric;
BEGIN
  d := pg_temp.moi('D2');
  v_inv := pg_temp.xuat(d.ord, pg_temp.dong_don(d), pg_temp.tra(d, 1));
  SELECT id INTO v_ts FROM returns WHERE invoice_id = v_inv;
  v_tl := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 1), 'complete', true)));
  v_err := pg_temp.thu(2, format('INSERT INTO returns (org_id, customer_id, requested_by, reason, status) VALUES (%L, %L, %L, %L, %L)',
             'a0000000-0000-0000-0000-000000000001', d.cust, pg_temp.u(2), 'damaged', 'completed'));
  PERFORM pg_temp.ghi('D2', 'chèn thẳng phiếu completed → PHIEU_TRA_KHOA', v_err = 'PHIEU_TRA_KHOA', COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(2, format('UPDATE return_lines SET quantity = 10 WHERE return_id = %L', v_tl));
  PERFORM pg_temp.ghi('D2', 'sửa thẳng dòng phiếu tự lập đã hoàn thành → chặn, dòng âm giữ −120.000',
    v_err = 'PHIEU_TRA_KHOA' AND pg_temp.no_tra(v_tl) = -120000 AND pg_temp.cr(v_tl) = 120000, COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(1, format('UPDATE returns SET credit_note_amount = 1 WHERE id = %L', v_tl));
  PERFORM pg_temp.ghi('D2', 'chủ sửa thẳng credit_note_amount phiếu đã hoàn thành → PHIEU_TRA_KHOA', v_err = 'PHIEU_TRA_KHOA', COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(1, format('UPDATE returns SET status = %L WHERE id = %L', 'cancelled', v_tl));
  PERFORM pg_temp.ghi('D2', 'chủ đổi thẳng trạng thái → PHIEU_TRA_KHOA, kho không lệch',
    v_err = 'PHIEU_TRA_KHOA' AND pg_temp.st(v_tl) = 'completed' AND pg_temp.ton(d.p1) = 952, COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(1, format('DELETE FROM returns WHERE id = %L', v_tl));
  PERFORM pg_temp.ghi('D2', 'xoá thẳng phiếu đã hoàn thành → bị chặn (lỗi hoặc RLS 0 dòng), phiếu còn',
    EXISTS (SELECT 1 FROM returns WHERE id = v_tl), COALESCE(v_err, 'RLS lọc'));
  v_err := pg_temp.thu(1, format('UPDATE returns SET status = %L WHERE id = %L', 'cancelled', v_ts));
  PERFORM pg_temp.ghi('D2', 'chủ huỷ thẳng phiếu tự sinh → bị chặn', v_err IN ('PHIEU_TRA_KHOA', 'RETURN_FOLLOWS_INVOICE') AND pg_temp.st(v_ts) = 'submitted', COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(1, format('INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, return_id) VALUES (%L, %L, -500000, 0, current_date, %L, %L)',
             'a0000000-0000-0000-0000-000000000001', d.cust, 'open', v_tl));
  PERFORM pg_temp.ghi('D2', 'chèn thẳng dòng công nợ âm theo phiếu trả → CONG_NO_KHOA', v_err = 'CONG_NO_KHOA', COALESCE(v_err, 'LỌT'));
  v_err := pg_temp.thu(1, format('UPDATE returns SET notes = %L WHERE id = %L', 'ghi chú mới', v_tl));
  PERFORM pg_temp.ghi('D2', 'sửa ghi chú phiếu đã hoàn thành → được', v_err IS NULL AND (SELECT notes FROM returns WHERE id = v_tl) = 'ghi chú mới', COALESCE(v_err, 'được'));
  -- Nháp: chèn dòng với line_total khống → máy chủ tính lại
  v_tl := pg_temp.lay(1, format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object('customer_id', d.cust, 'lines', pg_temp.tra(d, 1))));
  v_err := pg_temp.thu(4, format('INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange) VALUES (%L, %L, %L, 2, 5000, 0, 9999999, false)', v_tl, d.p2, 'goi'));
  SELECT credit_note_amount INTO v_cr FROM returns WHERE id = v_tl;
  PERFORM pg_temp.ghi('D2', 'Nháp: chèn dòng line_total 9.999.999 → máy chủ tính 10.000; credit 130.000',
    v_cr = 130000, COALESCE(v_err, 'được') || format(' / credit %s', v_cr));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D2', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- Kết quả
-- ====================================================================
SELECT stt, buoc, ok, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS xanh, count(*) FILTER (WHERE NOT ok) AS do FROM kq;
ROLLBACK;
