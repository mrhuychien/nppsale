-- KIỂM TOÀN LUỒNG (chủ nhà 28/09/2026 "test logic lại cho tao 1 lần nữa cho chắc"):
-- xuất HĐ kèm hàng trả → nhập kho → thu tiền → sửa HĐ "Có" → nhập kho lại → sửa HĐ "Không"
-- → huỷ nhập → huỷ HĐ (mig 217: đơn + phiếu trả Đã huỷ). Mọi RPC gọi dưới vai `authenticated` (chủ NPP) như từ trình duyệt.
-- Sau MỖI bước kiểm: trạng thái phiếu, tồn kho (kho bán Coca, kho cận date Pepsi), công nợ,
-- tổng nợ khách, doanh số thuần. psql -f trên Postgres ở máy; in 'ĐẠT'/'LỖI' từng bước.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

-- Dựng dữ liệu (vai chủ sở hữu DB): khách mới, đơn 100 lon Coca × 10.000, tồn đủ.
DO $d$
DECLARE v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_kh uuid; v_don uuid; v_dong uuid;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address) VALUES (v_org, 'Khách toàn luồng', 'Anh Toàn', '0900000999', '1 Đường Thử') RETURNING id INTO v_kh;
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, 'c0000000-0000-0000-0000-000000000001', 'LO-TL', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 300, 1000, 1000, 6000, 'sale', now());
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total)
  VALUES (v_org, 'DH-TL', v_kh, 'e0000000-0000-0000-0000-000000000004', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 3, 'submitted', 'NET30', 1000000, 0, 0, 1000000) RETURNING id INTO v_don;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
  VALUES (v_don, 'c0000000-0000-0000-0000-000000000001', 'lon', 100, 10000, 0, 1000000, 1) RETURNING id INTO v_dong;
  INSERT INTO ctx VALUES ('kh', v_kh), ('don', v_don), ('dong', v_dong);
END $d$;

CREATE OR REPLACE FUNCTION pg_temp.ton(p uuid, z text) RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p AND warehouse_zone = z $f$;
CREATE OR REPLACE FUNCTION pg_temp.no_khach() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = (SELECT v FROM ctx WHERE k = 'kh') AND status <> 'paid' $f$;
CREATE OR REPLACE FUNCTION pg_temp.hd() RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM sales_invoices WHERE order_id = (SELECT v FROM ctx WHERE k = 'don') AND status = 'posted' $f$;
CREATE OR REPLACE FUNCTION pg_temp.ret() RETURNS uuid LANGUAGE sql AS
  $f$ SELECT id FROM returns WHERE order_id = (SELECT v FROM ctx WHERE k = 'don') AND status <> 'cancelled' $f$;
CREATE OR REPLACE FUNCTION pg_temp.ghi(b int, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, ok, g) $f$;
CREATE OR REPLACE FUNCTION pg_temp.dong_hd(h uuid, sl numeric) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id, 'unit_name', unit_name,
         'conversion_factor', conversion_factor, 'quantity', sl, 'unit_price', unit_price, 'vat_rate', vat_rate, 'is_exchange', is_exchange))
  FROM sales_invoice_lines WHERE invoice_id = h AND NOT is_exchange $f$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;

-- B0 mốc
DO $t$ BEGIN
  PERFORM pg_temp.ghi(0, 'mốc', pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') >= 1000,
    format('tồn Coca kho bán %s, Pepsi kho date %s', pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale'), pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date')));
END $t$;
CREATE TEMP TABLE moc AS SELECT pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') AS coca, pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') AS pepsi;

-- B1 Xuất HĐ 100 lon + khách trả 10 lon Pepsi × 5.000 (ngày HĐ = hôm kia)
DO $t$ DECLARE h uuid; r uuid; m record;
BEGIN
  SELECT * INTO m FROM moc;
  PERFORM post_invoice(jsonb_build_object('order_id', (SELECT v FROM ctx WHERE k = 'don'), 'invoice_date', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 2,
    'lines', jsonb_build_array(jsonb_build_object('order_line_id', (SELECT v FROM ctx WHERE k = 'dong'), 'product_id', 'c0000000-0000-0000-0000-000000000001',
       'unit_name', 'lon', 'conversion_factor', 1, 'quantity', 100, 'unit_price', 10000, 'vat_rate', 0)),
    'return_adds', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon',
       'quantity', 10, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false))));
  h := pg_temp.hd(); r := pg_temp.ret();
  PERFORM pg_temp.ghi(1, 'xuất HĐ kèm hàng trả',
    (SELECT status FROM returns WHERE id = r) = 'submitted' AND (SELECT credit_with_invoice FROM returns WHERE id = r)
    AND (SELECT amount FROM receivables WHERE invoice_id = h) = 950000 AND pg_temp.no_khach() = 950000
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') = m.coca - 100
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') = m.pepsi
    AND (SELECT revenue_date FROM returns WHERE id = r) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 2,
    format('phiếu %s, nợ HĐ %s (950000), tồn Coca −%s (100), Pepsi date +%s (0), ngày trừ doanh số %s',
      (SELECT status FROM returns WHERE id = r), (SELECT amount FROM receivables WHERE invoice_id = h),
      m.coca - pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale'), pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') - m.pepsi,
      (SELECT revenue_date FROM returns WHERE id = r)));
  -- Phiếu tự sinh Chờ xử lý: không huỷ được
  BEGIN PERFORM cancel_return(r, 'thử'); PERFORM pg_temp.ghi(1, 'chặn huỷ phiếu Chờ xử lý', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(1, 'chặn huỷ phiếu Chờ xử lý', SQLERRM LIKE 'RETURN_FOLLOWS_INVOICE%', left(SQLERRM, 60)); END;
END $t$;

-- B2 Thủ kho nhập kho: kho cận date, ngày hôm qua (mig 211)
DO $t$ DECLARE r uuid := pg_temp.ret(); m record;
BEGIN
  SELECT * INTO m FROM moc;
  PERFORM complete_return(r, 'date', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1);
  PERFORM pg_temp.ghi(2, 'nhập kho phiếu trả',
    (SELECT status FROM returns WHERE id = r) = 'completed' AND pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') = m.pepsi + 10
    AND pg_temp.no_khach() = 950000 AND (SELECT revenue_date FROM returns WHERE id = r) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 2
    AND (SELECT (completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM returns WHERE id = r) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 1,
    format('phiếu %s, Pepsi date +%s (10), nợ khách %s (950000, không đổi), ngày nhập %s',
      (SELECT status FROM returns WHERE id = r), pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') - m.pepsi, pg_temp.no_khach(),
      (SELECT (completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM returns WHERE id = r)));
END $t$;

-- B3 Thu 300.000
DO $t$ BEGIN
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', (SELECT v FROM ctx WHERE k = 'kh'), 'client_key', 'tl-1',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = pg_temp.hd()), 'amount', 300000))));
  -- bấm Lưu lần hai: không ra phiếu thứ hai
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', (SELECT v FROM ctx WHERE k = 'kh'), 'client_key', 'tl-1',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = pg_temp.hd()), 'amount', 300000))));
  PERFORM pg_temp.ghi(3, 'thu 300.000 (bấm Lưu 2 lần)', pg_temp.no_khach() = 650000
      AND (SELECT count(*) FROM cash_receipts WHERE client_key = 'tl-1') = 1,
    format('nợ khách %s (650000), số phiếu thu %s (1)', pg_temp.no_khach(), (SELECT count(*) FROM cash_receipts WHERE client_key = 'tl-1')));
END $t$;

-- B4 Sửa HĐ không chọn → phải hỏi
DO $t$ BEGIN
  PERFORM reissue_invoice(pg_temp.hd(), jsonb_build_object('lines', pg_temp.dong_hd(pg_temp.hd(), 100)));
  PERFORM pg_temp.ghi(4, 'sửa HĐ chưa chọn Có/Không', false, 'LỌT — không hỏi');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(4, 'sửa HĐ chưa chọn Có/Không', SQLERRM LIKE 'REISSUE_RETURN_STOCKED%', left(SQLERRM, 80));
END $t$;

-- B5 Sửa HĐ chọn CÓ: SL bán 100 → 80, SL trả 10 → 6 (không gửi ngày → giữ ngày gốc)
DO $t$ DECLARE h0 uuid := pg_temp.hd(); r uuid := pg_temp.ret(); h uuid; m record; l uuid;
BEGIN
  SELECT * INTO m FROM moc;
  SELECT id INTO l FROM return_lines WHERE return_id = r;
  PERFORM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong_hd(h0, 80), 'tra_da_nhap', 'lam_lai',
    'return_edits', jsonb_build_array(jsonb_build_object('line_id', l, 'quantity', 6))));
  h := pg_temp.hd();
  PERFORM pg_temp.ghi(5, 'sửa HĐ chọn Có',
    h <> h0 AND (SELECT status FROM sales_invoices WHERE id = h0) = 'cancelled'
    AND (SELECT status FROM returns WHERE id = r) = 'submitted' AND (SELECT invoice_id FROM returns WHERE id = r) = h
    AND (SELECT credit_note_amount FROM returns WHERE id = r) = 30000
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') = m.pepsi
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') = m.coca - 80
    AND (SELECT invoice_date FROM sales_invoices WHERE id = h) = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 2
    AND (SELECT amount FROM receivables WHERE invoice_id = h) = 770000
    AND (SELECT paid FROM receivables WHERE invoice_id = h) = 300000
    AND pg_temp.no_khach() = 470000
    AND (SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || r) = 0,
    format('HĐ mới %s; phiếu %s (submitted) bám HĐ mới %s; tiền trả %s (30000); Pepsi date +%s (0 — đã đảo, chưa nhập lại); Coca −%s (80); ngày HĐ %s; nợ HĐ %s/đã thu %s (770000/300000); nợ khách %s (470000)',
      (SELECT invoice_code FROM sales_invoices WHERE id = h), (SELECT status FROM returns WHERE id = r),
      (SELECT invoice_id FROM returns WHERE id = r) = h, (SELECT credit_note_amount FROM returns WHERE id = r),
      pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'date') - m.pepsi, m.coca - pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale'),
      (SELECT invoice_date FROM sales_invoices WHERE id = h), (SELECT amount FROM receivables WHERE invoice_id = h),
      (SELECT paid FROM receivables WHERE invoice_id = h), pg_temp.no_khach()));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(5, 'bước 5 nổ lỗi', false, left(SQLERRM, 120));
END $t$;

-- B6 Thủ kho nhập kho lại (kho bán)
DO $t$ DECLARE r uuid := pg_temp.ret(); m record;
BEGIN
  SELECT * INTO m FROM moc;
  PERFORM complete_return(r, 'sale');
  PERFORM pg_temp.ghi(6, 'nhập kho lại sau khi sửa',
    (SELECT status FROM returns WHERE id = r) = 'completed' AND pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'sale')
      = (SELECT COALESCE(sum(qty_on_hand),0) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000002' AND warehouse_zone = 'sale')
    AND (SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || r) = 1
    AND (SELECT sum(sel.qty_in_base_uom) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes = 'Nhập lại từ phiếu trả ' || r) = 6
    AND pg_temp.no_khach() = 470000,
    format('phiếu %s; phiếu nhập hiệu lực %s (1) với %s lon (6); nợ khách %s (470000)', (SELECT status FROM returns WHERE id = r),
      (SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || r),
      (SELECT sum(sel.qty_in_base_uom) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes = 'Nhập lại từ phiếu trả ' || r),
      pg_temp.no_khach()));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(6, 'bước 6 nổ lỗi', false, left(SQLERRM, 120));
END $t$;

-- B7 Sửa HĐ chọn KHÔNG: SL bán 80 → 90, phiếu trả giữ nguyên phiếu nhập
DO $t$ DECLARE h0 uuid := pg_temp.hd(); r uuid := pg_temp.ret(); h uuid; n_truoc int;
BEGIN
  SELECT count(*) INTO n_truoc FROM stock_entries WHERE notes LIKE '%' || r || '%';
  PERFORM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong_hd(h0, 90), 'tra_da_nhap', 'giu'));
  h := pg_temp.hd();
  PERFORM pg_temp.ghi(7, 'sửa HĐ chọn Không',
    (SELECT status FROM returns WHERE id = r) = 'completed' AND (SELECT invoice_id FROM returns WHERE id = r) = h
    AND (SELECT count(*) FROM stock_entries WHERE notes LIKE '%' || r || '%') = n_truoc
    AND (SELECT amount FROM receivables WHERE invoice_id = h) = 870000 AND pg_temp.no_khach() = 570000,
    format('phiếu %s bám HĐ mới %s; phiếu kho không đổi %s; nợ HĐ %s (870000); nợ khách %s (570000)',
      (SELECT status FROM returns WHERE id = r), (SELECT invoice_id FROM returns WHERE id = r) = h,
      (SELECT count(*) FROM stock_entries WHERE notes LIKE '%' || r || '%') = n_truoc,
      (SELECT amount FROM receivables WHERE invoice_id = h), pg_temp.no_khach()));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(7, 'bước 7 nổ lỗi', false, left(SQLERRM, 120));
END $t$;

-- B8 Huỷ nhập kho (phiếu tự sinh đã nhập → về Chờ xử lý, nợ giữ)
DO $t$ DECLARE r uuid := pg_temp.ret(); pep numeric := pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'sale');
BEGIN
  PERFORM cancel_return(r, 'nhập nhầm kho');
  PERFORM pg_temp.ghi(8, 'huỷ nhập kho',
    (SELECT status FROM returns WHERE id = r) = 'submitted' AND pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'sale') = pep - 6
    AND pg_temp.no_khach() = 570000,
    format('phiếu %s (submitted); Pepsi kho bán −%s (6); nợ khách %s (570000)', (SELECT status FROM returns WHERE id = r),
      pep - pg_temp.ton('c0000000-0000-0000-0000-000000000002', 'sale'), pg_temp.no_khach()));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(8, 'bước 8 nổ lỗi', false, left(SQLERRM, 120));
END $t$;

-- B9 Huỷ HĐ khi đã thu tiền → chặn; huỷ phiếu thu rồi huỷ HĐ
DO $t$ DECLARE h uuid := pg_temp.hd(); r uuid := pg_temp.ret(); m record; pt uuid;
BEGIN
  SELECT * INTO m FROM moc;
  BEGIN PERFORM cancel_invoice(h, 'thử'); PERFORM pg_temp.ghi(9, 'chặn huỷ HĐ đã thu tiền', false, 'LỌT');
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi(9, 'chặn huỷ HĐ đã thu tiền', SQLERRM LIKE 'LOCKED_HAS_PAYMENT%', left(SQLERRM, 60)); END;
  SELECT id INTO pt FROM cash_receipts WHERE client_key = 'tl-1';
  PERFORM void_cash_receipt(pt, 'thu nhầm');
  PERFORM cancel_invoice(h, 'huỷ thử');
  PERFORM pg_temp.ghi(9, 'huỷ phiếu thu rồi huỷ HĐ',
    pg_temp.hd() IS NULL AND pg_temp.no_khach() = 0
    AND (SELECT status FROM returns WHERE id = r) = 'cancelled' AND (SELECT invoice_id FROM returns WHERE id = r) IS NULL
    AND pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') = m.coca
    -- (mig 217) huỷ HĐ = huỷ đơn, phiếu trả huỷ theo
    AND (SELECT status FROM sales_orders WHERE id = (SELECT v FROM ctx WHERE k = 'don')) = 'cancelled',
    format('HĐ còn hiệu lực %s; nợ khách %s (0); phiếu trả %s gắn HĐ %s; Coca về đủ %s; đơn %s',
      pg_temp.hd() IS NOT NULL, pg_temp.no_khach(), (SELECT status FROM returns WHERE id = r), (SELECT invoice_id FROM returns WHERE id = r) IS NOT NULL,
      pg_temp.ton('c0000000-0000-0000-0000-000000000001', 'sale') = m.coca, (SELECT status FROM sales_orders WHERE id = (SELECT v FROM ctx WHERE k = 'don'))));
END $t$;

RESET ROLE;
SELECT buoc AS "B", CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc, ten;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
