-- ====================================================================================================
-- ĐỘI TEST "LIÊN MÔ-ĐUN (TỔNG HỢP)" — SỔ PHẢI KHỚP NHAU XUYÊN MÔ-ĐUN qua các CHUỖI NGHIỆP VỤ DÀI.
--
-- Sau MỖI bước của mỗi chuỗi: kiểm con số cụ thể của bước (tồn, nợ, trạng thái, tiền, doanh số thuần)
-- VÀ chạy bộ BẤT BIẾN chung `pg_temp.bat_bien` (CLAUDE.md §1):
--   BB1  tồn kho (Σ lô) = thẻ kho (Σ dòng phiếu kho đã ghi sổ: nhập +, xuất −, kiểm kê ±; đơn vị cơ sở)
--   BB2  nợ khách (Σ amount − paid, status <> 'paid' — luật loadCustomerDebt) = Σ HĐ ghi sổ − hàng trả đã trừ
--        (tự sinh: Chờ xử lý/Hoàn thành; tự lập: Hoàn thành) − tiền thu (Σ payments) + nợ đầu kỳ
--   BB2b receivables_by_customer() = nợ khách (không kẹp 0)
--   BB3  doanh số thuần: dashboard_summary = bao_cao_so_ban (Σ HĐ ghi sổ − Σ trả theo revenue_date)
--   BB4  trạng thái đơn khớp HĐ (một đơn ≤ 1 HĐ ghi sổ; có HĐ ⇔ Hoàn thành; HĐ bị huỷ ⇒ Đã huỷ)
--   BB5  paid = Σ payments = Σ dòng phiếu thu chưa huỷ (từng khoản nợ)
--   BB6  không tính hai lần (mỗi HĐ ghi sổ đúng 1 phiếu nợ; không phiếu nợ trỏ HĐ đã huỷ; phiếu trả gắn HĐ
--        không có dòng nợ âm riêng)
--
-- Chuỗi:
--   A  nhập kho NCC → đặt đơn (thùng) → xuất HĐ giao thiếu → thu một phần → trả tự lập GẮN HĐ → trả tự lập
--      KHÔNG gắn HĐ (nợ âm) → thu bằng dư có → Sửa HĐ → huỷ phiếu trả (dư có đã dùng) → huỷ phiếu thu → huỷ HĐ
--   B  thứ tự NGƯỢC: huỷ phiếu thu → huỷ HĐ khi phiếu trả độc lập còn sống, phiếu nháp gắn HĐ huỷ theo
--   C  đơn có hàng trả + hàng ĐỔI khi xuất HĐ (phiếu tự sinh) → nhập kho → Sửa HĐ chọn Có → nhập lại →
--      Sửa HĐ chọn Không → huỷ nhập → huỷ HĐ
--   D  nhân viên nghỉ việc giữa chừng (nợ về NPP, phiếu trả mới, NPP giao lại, trả gắn HĐ, Sửa HĐ)
--   E  kiểm kê lệch (hao hụt có lô + thừa không lô) rồi xuất bán FIFO, kiểm kê cũ bị chặn, bán vượt tồn
--   F  cuối tháng / đầu tháng: HĐ ngày cuối tháng trước, nhập kho phiếu tự sinh ngày đầu tháng, phiếu tự lập
--      ngày đầu tháng — kỳ báo cáo theo ngày VN, phiên Postgres để UTC như Supabase
--   H  số lẻ + quy đổi đơn vị: 1,5 thùng, trả 0,5 thùng, huỷ ngược
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_lien_module -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/lien-module-chuoi.sql
-- Bọc BEGIN … ROLLBACK. Cuối: bảng kq (ĐẠT / LỖI) + tổng. Các dòng 'ANH|{json}' là ảnh chụp sổ cho
-- tests/doi-lien-module-cheo.test.ts kiểm chéo với hàm TypeScript.
-- ====================================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
SET client_min_messages = warning;
-- Supabase chạy phiên ở UTC — mọi phép so ngày phải đúng theo giờ VN dù phiên là UTC.
SET TIME ZONE 'UTC';
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
GRANT USAGE ON SEQUENCE kq_stt_seq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;
CREATE TEMP TABLE moc (k text PRIMARY KEY, v numeric) ON COMMIT DROP;
GRANT ALL ON moc TO authenticated;
CREATE TEMP TABLE anh (stt serial, buoc text, j jsonb) ON COMMIT DROP;
GRANT ALL ON anh TO authenticated;
GRANT USAGE ON SEQUENCE anh_stt_seq TO authenticated;

-- ───────────────────────────── Tiện ích ─────────────────────────────
CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.dat(p_k text, p_v uuid) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO ctx VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $f$;
CREATE FUNCTION pg_temp.m(p_k text) RETURNS numeric LANGUAGE sql STABLE AS $f$ SELECT v FROM moc WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.ghim(p_k text, p_v numeric) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO moc VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $f$;
CREATE FUNCTION pg_temp.hn() RETURNS date LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), g) $f$;
-- Chạy thử một câu dưới vai hiện tại rồi LUÔN rollback; trả thông báo lỗi hoặc 'KHÔNG LỖI'.
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'XX_KHONG_LOI';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM = 'XX_KHONG_LOI' THEN 'KHÔNG LỖI' ELSE SQLERRM END;
END $f$;
CREATE FUNCTION pg_temp.vai(u text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', CASE u WHEN 'owner' THEN 'e0000000-0000-0000-0000-000000000001'
       WHEN 'manager' THEN 'e0000000-0000-0000-0000-000000000002' WHEN 'accountant' THEN 'e0000000-0000-0000-0000-000000000003'
       WHEN 'sales' THEN 'e0000000-0000-0000-0000-000000000004' WHEN 'warehouse' THEN 'e0000000-0000-0000-0000-000000000005'
       ELSE u END, true) $f$;

-- ── Đọc sổ (bỏ RLS: SECURITY DEFINER) ──
CREATE FUNCTION pg_temp.ton(p uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = p $f$;
CREATE FUNCTION pg_temp.ton_k(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT pg_temp.ton(pg_temp.c(k)) $f$;
-- Thẻ kho: đúng luật màn /inventory/stock-card (qty_in_base_uom ?? quantity × hệ số; xuất trừ, còn lại cộng).
CREATE FUNCTION pg_temp.the_kho(p uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT COALESCE(sum(CASE WHEN se.type = 'export' THEN -1 ELSE 1 END
           * COALESCE(sel.qty_in_base_uom, sel.quantity * COALESCE(NULLIF(sel.conversion_factor_snapshot, 0), 1))), 0)
  FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
  WHERE se.status = 'posted' AND sel.product_id = p $f$;
CREATE FUNCTION pg_temp.no(kh uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = kh AND status <> 'paid' $f$;
CREATE FUNCTION pg_temp.no_k(k text) RETURNS numeric LANGUAGE sql STABLE AS $f$ SELECT pg_temp.no(pg_temp.c(k)) $f$;
-- Nợ tính ĐỘC LẬP từ chứng từ (không đọc receivables.amount / paid).
CREATE FUNCTION pg_temp.no_doc_lap(kh uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT COALESCE((SELECT sum(total) FROM sales_invoices WHERE customer_id = kh AND status = 'posted'), 0)
   - COALESCE((SELECT sum(COALESCE(r.credit_note_amount, 0)) FROM returns r
               WHERE r.customer_id = kh AND r.applied_receipt_id IS NULL
                 AND ((r.invoice_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM sales_invoices si WHERE si.id = r.invoice_id AND si.status = 'posted')
                       AND ((COALESCE(r.credit_with_invoice, false) AND r.status IN ('submitted', 'completed'))
                            OR (NOT COALESCE(r.credit_with_invoice, false) AND r.status = 'completed')))
                   OR (r.invoice_id IS NULL AND r.order_id IS NULL AND r.status = 'completed'))), 0)
   - COALESCE((SELECT sum(p.amount) FROM payments p JOIN receivables rc ON rc.id = p.receivable_id WHERE rc.customer_id = kh), 0)
   + COALESCE((SELECT sum(amount) FROM receivables WHERE customer_id = kh AND invoice_id IS NULL AND return_id IS NULL), 0) $f$;
CREATE FUNCTION pg_temp.hd(don text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT id FROM sales_invoices WHERE order_id = pg_temp.c(don) AND status = 'posted' $f$;
CREATE FUNCTION pg_temp.rec(hd uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT id FROM receivables WHERE invoice_id = hd $f$;
CREATE FUNCTION pg_temp.ra(hd uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT amount FROM receivables WHERE invoice_id = hd $f$;
CREATE FUNCTION pg_temp.rp(hd uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT paid FROM receivables WHERE invoice_id = hd $f$;
CREATE FUNCTION pg_temp.rs(hd uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT status FROM receivables WHERE invoice_id = hd $f$;
CREATE FUNCTION pg_temp.don_tt(don text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT status FROM sales_orders WHERE id = pg_temp.c(don) $f$;
CREATE FUNCTION pg_temp.ret_tt(r uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT status FROM returns WHERE id = r $f$;
CREATE FUNCTION pg_temp.ret_c(r uuid, cot text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS
  $f$ DECLARE x text; BEGIN EXECUTE format('SELECT %I::text FROM returns WHERE id = $1', cot) INTO x USING r; RETURN x; END $f$;
CREATE FUNCTION pg_temp.hd_c(h uuid, cot text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS
  $f$ DECLARE x text; BEGIN EXECUTE format('SELECT %I::text FROM sales_invoices WHERE id = $1', cot) INTO x USING h; RETURN x; END $f$;
CREATE FUNCTION pg_temp.so(q text) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS
  $f$ DECLARE r numeric; BEGIN EXECUTE q INTO r; RETURN r; END $f$;
-- Doanh số thuần trên dashboard (kỳ dài 40 ngày) và trên Báo cáo (bao_cao_so_ban) — trừ mốc đầu.
CREATE FUNCTION pg_temp.ds() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT period_revenue FROM dashboard_summary(pg_temp.hn() - 40) $f$;
CREATE FUNCTION pg_temp.sb() RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT sum((h->>'total')::numeric) FROM jsonb_array_elements(j->'hd') h), 0)
       - COALESCE((SELECT sum((t->>'credit_note_amount')::numeric) FROM jsonb_array_elements(j->'tra') t), 0)
  FROM (SELECT bao_cao_so_ban(pg_temp.hn() - 40, pg_temp.hn()) AS j) x $f$;
-- Tiền thu thật: Tài chính (payments trừ cấn trừ / dư có) và phiếu thu (submitted_amount) — kỳ rộng, trừ mốc đầu.
CREATE FUNCTION pg_temp.tt() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT cash_from_customers FROM finance_cash_flow(pg_temp.hn() - 40, pg_temp.hn() + 1) $f$;
CREATE FUNCTION pg_temp.pt() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT cash_received_total(pg_temp.hn() - 40, pg_temp.hn() + 1) $f$;
CREATE FUNCTION pg_temp.dt() RETURNS numeric LANGUAGE sql AS $f$ SELECT pg_temp.ds() - pg_temp.m('ds0') $f$;

-- ── BẤT BIẾN CHUNG ──
CREATE FUNCTION pg_temp.bat_bien(b text, kh text, sps text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$
DECLARE p text; v_kh uuid := pg_temp.c(kh); x numeric; y numeric; z numeric; n int;
BEGIN
  FOREACH p IN ARRAY sps LOOP
    x := pg_temp.ton(pg_temp.c(p)); y := pg_temp.the_kho(pg_temp.c(p));
    PERFORM pg_temp.ghi(b, 'BB1 tồn lô = thẻ kho (' || p || ')', x = y, format('lô %s / thẻ kho %s', x, y));
  END LOOP;
  x := pg_temp.no(v_kh); y := pg_temp.no_doc_lap(v_kh);
  PERFORM pg_temp.ghi(b, 'BB2 nợ ' || kh || ' = HĐ − trả − thu + đầu kỳ', abs(x - y) < 0.01, format('sổ %s / chứng từ %s', x, y));
  z := COALESCE((SELECT remaining FROM receivables_by_customer() WHERE customer_id = v_kh), 0);
  PERFORM pg_temp.ghi(b, 'BB2b receivables_by_customer = nợ ' || kh, abs(x - z) < 0.01, format('rpc %s / sổ %s', z, x));
  x := pg_temp.ds() - pg_temp.m('ds0'); y := pg_temp.sb() - pg_temp.m('sb0');
  PERFORM pg_temp.ghi(b, 'BB3 doanh số thuần dashboard = báo cáo (Δ)', x = y, format('dashboard Δ %s / báo cáo Δ %s', x, y));
  x := pg_temp.tt() - pg_temp.m('tt0'); y := pg_temp.pt() - pg_temp.m('pt0');
  PERFORM pg_temp.ghi(b, 'BB7 tiền thu Tài chính = tổng phiếu thu (Δ, không đếm dư có / cấn trừ)', x = y, format('tài chính Δ %s / phiếu thu Δ %s', x, y));
  SELECT count(*) INTO n FROM sales_orders o
  WHERE o.customer_id = v_kh AND (
    (SELECT count(*) FROM sales_invoices si WHERE si.order_id = o.id AND si.status = 'posted') > 1
    OR ((SELECT count(*) FROM sales_invoices si WHERE si.order_id = o.id AND si.status = 'posted') = 1 AND o.status <> 'completed')
    OR ((SELECT count(*) FROM sales_invoices si WHERE si.order_id = o.id AND si.status = 'posted') = 0 AND o.status = 'completed')
    OR ((SELECT count(*) FROM sales_invoices si WHERE si.order_id = o.id AND si.status = 'posted') = 0
        AND EXISTS (SELECT 1 FROM sales_invoices si WHERE si.order_id = o.id AND si.status = 'cancelled') AND o.status <> 'cancelled'));
  PERFORM pg_temp.ghi(b, 'BB4 trạng thái đơn khớp HĐ (' || kh || ')', n = 0, format('%s đơn lệch', n));
  SELECT count(*) INTO n FROM receivables rc
  WHERE rc.customer_id = v_kh AND (
    abs(COALESCE(rc.paid, 0) - COALESCE((SELECT sum(amount) FROM payments WHERE receivable_id = rc.id), 0)) >= 0.01
    OR abs(COALESCE((SELECT sum(amount) FROM payments WHERE receivable_id = rc.id), 0)
         - COALESCE((SELECT sum(crl.amount) FROM cash_receipt_lines crl JOIN cash_receipts cr ON cr.id = crl.receipt_id
                     WHERE crl.receivable_id = rc.id AND cr.status <> 'voided'), 0)) >= 0.01);
  PERFORM pg_temp.ghi(b, 'BB5 paid = Σ payments = Σ dòng phiếu thu (' || kh || ')', n = 0, format('%s khoản lệch', n));
  SELECT (SELECT count(*) FROM sales_invoices si WHERE si.customer_id = v_kh AND si.status = 'posted'
            AND (SELECT count(*) FROM receivables rc WHERE rc.invoice_id = si.id) <> 1)
       + (SELECT count(*) FROM receivables rc JOIN sales_invoices si ON si.id = rc.invoice_id
            WHERE rc.customer_id = v_kh AND si.status <> 'posted')
       + (SELECT count(*) FROM receivables rc JOIN returns r ON r.id = rc.return_id
            WHERE rc.customer_id = v_kh AND (r.invoice_id IS NOT NULL OR r.order_id IS NOT NULL) AND rc.amount <> 0)
    INTO n;
  PERFORM pg_temp.ghi(b, 'BB6 không tính hai lần (' || kh || ')', n = 0, format('%s chỗ trùng / mồ côi', n));
END $f$;

-- ── Ảnh chụp sổ cho kiểm chéo TypeScript ──
CREATE FUNCTION pg_temp.chup(b text, kh text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$
DECLARE v_kh uuid := pg_temp.c(kh);
BEGIN
  INSERT INTO anh (buoc, j) SELECT b, jsonb_build_object(
    'buoc', b, 'kh', v_kh, 'tu', pg_temp.hn() - 40,
    'no_sql', pg_temp.no(v_kh),
    'ds_delta', pg_temp.ds() - pg_temp.m('ds0'),
    'receivables', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'customer_id', customer_id, 'amount', amount,
        'paid', paid, 'status', status, 'invoice_id', invoice_id, 'return_id', return_id) ORDER BY id)
        FROM receivables WHERE customer_id = v_kh), '[]'),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'total', total, 'status', status,
        'invoice_date', invoice_date, 'customer_id', customer_id) ORDER BY id)
        FROM sales_invoices WHERE customer_id = v_kh), '[]'),
    'returns', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'invoice_id', invoice_id, 'order_id', order_id,
        'status', status, 'credit_with_invoice', credit_with_invoice, 'credit_note_amount', credit_note_amount,
        'revenue_date', revenue_date, 'customer_id', customer_id) ORDER BY id)
        FROM returns WHERE customer_id = v_kh), '[]'));
END $f$;

-- ── Thao tác (đi qua RPC như trình duyệt) ──
-- NVBH lập đơn qua create_order_with_lines (đơn gửi đi = 'submitted').
CREATE FUNCTION pg_temp.lap_don(don text, kh text, dongs jsonb, tra jsonb DEFAULT NULL, nv text DEFAULT 'sales') RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE r record; v_tong numeric;
BEGIN
  PERFORM pg_temp.vai(nv);
  SELECT COALESCE(sum((x->>'line_total')::numeric), 0) INTO v_tong FROM jsonb_array_elements(dongs) x;
  INSERT INTO ctx VALUES (don || '.crid', gen_random_uuid());
  SELECT * INTO r FROM create_order_with_lines(jsonb_build_object(
    'client_request_id', pg_temp.c(don || '.crid'),
    'order', jsonb_build_object('customer_id', pg_temp.c(kh), 'status', 'submitted', 'payment_terms', 'NET30',
                                'subtotal', v_tong, 'total', v_tong),
    'lines', dongs) || CASE WHEN tra IS NULL THEN '{}'::jsonb
                            ELSE jsonb_build_object('returns', '{"reason":"damaged"}'::jsonb, 'return_lines', tra) END);
  PERFORM pg_temp.dat(don, r.order_id);
  RETURN r.order_id;
END $f$;
-- Dòng tải trọng hóa đơn lấy từ dòng đơn (theo sản phẩm + đơn vị).
CREATE FUNCTION pg_temp.dd(don text, sp text, dv text, sl numeric) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT jsonb_build_object('order_line_id', sol.id, 'product_id', sol.product_id, 'unit_name', sol.unit_name,
         'conversion_factor', sol.conversion_factor, 'quantity', sl, 'unit_price', sol.unit_price, 'vat_rate', 0)
  FROM sales_order_lines sol WHERE sol.order_id = pg_temp.c(don) AND sol.product_id = pg_temp.c(sp) AND sol.unit_name = dv $f$;
-- Toàn bộ dòng của một HĐ (kể cả hàng đổi), đổi SL một dòng theo sản phẩm.
CREATE FUNCTION pg_temp.dong_hd(h uuid, sp uuid DEFAULT NULL, sl numeric DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id, 'product_id', product_id, 'unit_name', unit_name,
         'conversion_factor', conversion_factor,
         'quantity', CASE WHEN product_id = sp AND NOT is_exchange THEN sl ELSE quantity END,
         'unit_price', unit_price, 'vat_rate', vat_rate, 'is_exchange', is_exchange) ORDER BY sort_order)
  FROM sales_invoice_lines WHERE invoice_id = h $f$;
CREATE FUNCTION pg_temp.xuat(don text, dongs jsonb, ngay date, them jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record;
BEGIN
  PERFORM pg_temp.vai('owner');
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', pg_temp.c(don), 'lines', dongs, 'invoice_date', ngay) || them);
  RETURN r.invoice_id;
END $f$;
CREATE FUNCTION pg_temp.thu_tien(kh text, rec uuid, so_tien numeric, khoa text, dung_du_co numeric DEFAULT 0) RETURNS uuid
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.vai('accountant');
  RETURN create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c(kh), 'client_key', khoa,
    'use_credit', dung_du_co, 'lines', jsonb_build_array(jsonb_build_object('receivable_id', rec, 'amount', so_tien))));
END $f$;
CREATE FUNCTION pg_temp.tra(kh text, hd uuid, dongs jsonb, xong boolean, nv text DEFAULT 'manager', ngay date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.vai(nv);
  RETURN save_pos_return(jsonb_build_object('customer_id', pg_temp.c(kh), 'invoice_id', hd, 'lines', dongs,
    'complete', xong, 'zone', 'sale', 'reason', 'damaged') || CASE WHEN ngay IS NULL THEN '{}'::jsonb
                                                                    ELSE jsonb_build_object('return_date', ngay) END);
END $f$;

-- ───────────────────────────── Dữ liệu (chủ DB) ─────────────────────────────
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
DO $d$
DECLARE o uuid := 'a0000000-0000-0000-0000-000000000001'; v uuid; k text;
BEGIN
  -- Sản phẩm riêng của đội (tồn bắt đầu từ 0): PA lon + Thung 24; PB lon; PE lon.
  INSERT INTO products (org_id, sku, name, base_unit) VALUES (o, 'LM-PA', 'LM Nước A', 'lon') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('PA', v);
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (v, 'Thung 24', 24);
  INSERT INTO products (org_id, sku, name, base_unit) VALUES (o, 'LM-PB', 'LM Nước B', 'lon') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('PB', v);
  INSERT INTO products (org_id, sku, name, base_unit) VALUES (o, 'LM-PE', 'LM Bánh E', 'lon') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('PE', v);
  INSERT INTO suppliers (org_id, name) VALUES (o, 'NCC Liên mô-đun') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('NCC', v);
  FOREACH k IN ARRAY ARRAY['KA', 'KB', 'KC', 'KD', 'KE', 'KF', 'KH'] LOOP
    INSERT INTO customers (org_id, store_name, owner_name, phone, address)
    VALUES (o, 'Khách LM ' || k, 'Chị ' || k, '0977' || lpad((abs(hashtext(k)) % 1000000)::text, 6, '0'), 'Đường LM')
    RETURNING id INTO v;
    INSERT INTO ctx VALUES (k, v);
  END LOOP;
  -- Hai NVBH riêng cho chuỗi nghỉ việc.
  INSERT INTO auth.users (id, email) VALUES ('e7770000-0000-0000-0000-00000000000a', 'lm-nvx@x.vn'),
                                            ('e7770000-0000-0000-0000-00000000000b', 'lm-nvy@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e7770000-0000-0000-0000-00000000000a', o, 'NV X (nghỉ)', 'sales'),
                                                         ('e7770000-0000-0000-0000-00000000000b', o, 'NV Y (nhận lại)', 'sales');
  INSERT INTO ctx VALUES ('NVX', 'e7770000-0000-0000-0000-00000000000a'), ('NVY', 'e7770000-0000-0000-0000-00000000000b');
  INSERT INTO customer_assignments (customer_id, user_id, role) VALUES (pg_temp.c('KD'), pg_temp.c('NVX'), 'primary');
END $d$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner') \g /dev/null
SELECT pg_temp.ghim('ds0', pg_temp.ds()) \g /dev/null
SELECT pg_temp.ghim('sb0', pg_temp.sb()) \g /dev/null
SELECT pg_temp.ghim('tt0', pg_temp.tt()) \g /dev/null
SELECT pg_temp.ghim('pt0', pg_temp.pt()) \g /dev/null

-- ═════════════════════════════════ CHUỖI A ═════════════════════════════════
-- A1 Nhập kho từ NCC (thủ kho): PA 10 thùng = 240 lon × 5.000; PB 100 lon × 3.000; công nợ NCC 1.500.000.
DO $t$ DECLARE e text; r record; BEGIN
  FOREACH e IN ARRAY ARRAY['sales', 'accountant', 'manager'] LOOP
    PERFORM pg_temp.vai(e);
    PERFORM pg_temp.ghi('A1', 'vai ' || e || ' không lập được phiếu nhập kho',
      pg_temp.thu(format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object('entry_code', 'NK-LM-X', 'lines',
        jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'base_qty', 1, 'base_cost', 1))))) LIKE 'FORBIDDEN%', e);
  END LOOP;
  PERFORM pg_temp.vai('warehouse');
  PERFORM pg_temp.ghi('A1', 'nhập SL 0 bị chặn', pg_temp.thu(format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object(
    'entry_code', 'NK-LM-0', 'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'base_qty', 0, 'base_cost', 1))))) LIKE 'BAD_PAYLOAD%', '');
  PERFORM pg_temp.ghi('A1', 'nhập giá vốn âm bị chặn', pg_temp.thu(format('SELECT post_stock_import(%L::jsonb)', jsonb_build_object(
    'entry_code', 'NK-LM-0', 'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'base_qty', 5, 'base_cost', -1))))) LIKE 'BAD_PAYLOAD%', '');
  SELECT * INTO r FROM post_stock_import(jsonb_build_object('entry_code', 'NK-LM-A', 'supplier_id', pg_temp.c('NCC'),
    'posted_at', now() - interval '3 days', 'payable', jsonb_build_object('amount', 1500000, 'invoice_number', 'HDNCC-1'),
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', pg_temp.c('PA'), 'base_qty', 240, 'qty_tx', 10, 'conv', 24, 'unit_name', 'Thung 24', 'base_cost', 5000, 'batch_code', 'LM-A1'),
      jsonb_build_object('product_id', pg_temp.c('PB'), 'base_qty', 100, 'unit_name', 'lon', 'base_cost', 3000, 'batch_code', 'LM-B1'))));
  PERFORM pg_temp.ghi('A1', 'tồn PA 240 lon, PB 100 lon', pg_temp.ton_k('PA') = 240 AND pg_temp.ton_k('PB') = 100,
    format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('A1', 'công nợ NCC 1.500.000 mở, gắn phiếu nhập', pg_temp.so(format(
    'SELECT amount FROM payables WHERE id = %L AND stock_entry_id = %L AND status = %L AND paid = 0', r.payable_id, r.entry_id, 'open')) = 1500000, '');
  PERFORM pg_temp.ghi('A1', 'nhập kho không đụng doanh số / công nợ khách', pg_temp.dt() = 0 AND pg_temp.no_k('KA') = 0, pg_temp.dt()::text);
END $t$;
SELECT pg_temp.bat_bien('A1', 'KA', ARRAY['PA', 'PB']) \g /dev/null

-- A2 NVBH đặt đơn: PA 5 Thung 24 × 240.000 + PB 20 lon × 10.000 = 1.400.000. Gửi lại (mạng chập) không ra đơn đôi.
DO $t$ DECLARE r record; BEGIN
  PERFORM pg_temp.lap_don('DA', 'KA', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 5, 'unit_price', 240000, 'line_total', 1200000, 'conversion_factor', 24),
    jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 20, 'unit_price', 10000, 'line_total', 200000, 'conversion_factor', 1)));
  SELECT * INTO r FROM create_order_with_lines(jsonb_build_object('client_request_id', pg_temp.c('DA.crid'),
    'order', jsonb_build_object('customer_id', pg_temp.c('KA'), 'status', 'submitted'),
    'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 1))));
  PERFORM pg_temp.ghi('A2', 'gửi lại cùng client_request_id → cùng đơn, không thêm dòng',
    r.already_existed AND r.order_id = pg_temp.c('DA')
    AND pg_temp.so(format('SELECT count(*) FROM sales_order_lines WHERE order_id = %L', pg_temp.c('DA'))) = 2
    AND pg_temp.so(format('SELECT count(*) FROM sales_orders WHERE client_request_id = %L', pg_temp.c('DA.crid'))) = 1, '');
  PERFORM pg_temp.ghi('A2', 'đơn Đã gửi, chưa nợ, chưa doanh số, kho chưa đổi',
    pg_temp.don_tt('DA') = 'submitted' AND pg_temp.no_k('KA') = 0 AND pg_temp.dt() = 0
    AND pg_temp.ton_k('PA') = 240 AND pg_temp.ton_k('PB') = 100,
    format('đơn %s nợ %s Δds %s', pg_temp.don_tt('DA'), pg_temp.no_k('KA'), pg_temp.dt()));
END $t$;
SELECT pg_temp.bat_bien('A2', 'KA', ARRAY['PA', 'PB']) \g /dev/null

-- A3 Xuất HĐ GIAO THIẾU: PA 4/5 thùng, PB 20 → 1.160.000; đơn Hoàn thành.
DO $t$ DECLARE e text; h uuid; v_gv numeric; BEGIN
  FOREACH e IN ARRAY ARRAY['sales', 'accountant', 'warehouse'] LOOP
    PERFORM pg_temp.vai(e);
    PERFORM pg_temp.ghi('A3', 'vai ' || e || ' không xuất được HĐ',
      pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('DA'),
        'lines', jsonb_build_array(pg_temp.dd('DA', 'PB', 'lon', 20))))) LIKE 'FORBIDDEN%', e);
  END LOOP;
  h := pg_temp.xuat('DA', jsonb_build_array(pg_temp.dd('DA', 'PA', 'Thung 24', 4), pg_temp.dd('DA', 'PB', 'lon', 20)), pg_temp.hn() - 1);
  PERFORM pg_temp.dat('DA.hd1', h);
  PERFORM pg_temp.ghi('A3', 'HĐ 1.160.000, ngày hôm qua, đơn Hoàn thành dù giao thiếu',
    pg_temp.hd_c(h, 'total')::numeric = 1160000 AND pg_temp.hd_c(h, 'invoice_date')::date = pg_temp.hn() - 1
    AND pg_temp.don_tt('DA') = 'completed',
    format('total %s đơn %s', pg_temp.hd_c(h, 'total'), pg_temp.don_tt('DA')));
  PERFORM pg_temp.ghi('A3', 'tồn PA 240 − 96 = 144 (4 thùng quy lon), PB 80', pg_temp.ton_k('PA') = 144 AND pg_temp.ton_k('PB') = 80,
    format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('A3', 'công nợ theo HĐ: 1.160.000 mở; nợ khách 1.160.000',
    pg_temp.ra(h) = 1160000 AND pg_temp.rp(h) = 0 AND pg_temp.rs(h) = 'open' AND pg_temp.no_k('KA') = 1160000,
    format('amount %s nợ %s', pg_temp.ra(h), pg_temp.no_k('KA')));
  PERFORM pg_temp.ghi('A3', 'doanh số thuần +1.160.000 (theo HĐ, không theo đơn 1.400.000)', pg_temp.dt() = 1160000, pg_temp.dt()::text);
  v_gv := pg_temp.so(format('SELECT sum(slc.qty_in_base_uom * slc.unit_cost) FROM stock_line_consumptions slc JOIN stock_entry_lines sel ON sel.id = slc.line_id WHERE sel.entry_id = %L', pg_temp.hd_c(h, 'stock_entry_id')));
  PERFORM pg_temp.ghi('A3', 'giá vốn xuất = 96×5.000 + 20×3.000 = 540.000', v_gv = 540000, v_gv::text);
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('A3', 'xuất lần hai cùng đơn bị chặn', pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object(
    'order_id', pg_temp.c('DA'), 'lines', jsonb_build_array(pg_temp.dd('DA', 'PA', 'Thung 24', 1))))) LIKE 'ORDER_NOT_INVOICEABLE%', '');
  PERFORM pg_temp.ghi('A3', 'sau lần bị chặn: kho vẫn 144 / 80', pg_temp.ton_k('PA') = 144 AND pg_temp.ton_k('PB') = 80, '');
END $t$;
SELECT pg_temp.bat_bien('A3', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A3', 'KA') \g /dev/null

-- A4 Thu một phần 300.000 (kế toán), bấm Lưu hai lần.
DO $t$ DECLARE h uuid := pg_temp.hd('DA'); e text; BEGIN
  FOREACH e IN ARRAY ARRAY['sales', 'warehouse'] LOOP
    PERFORM pg_temp.vai(e);
    PERFORM pg_temp.ghi('A4', 'vai ' || e || ' không lập được phiếu thu', pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)',
      jsonb_build_object('customer_id', pg_temp.c('KA'), 'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rec(h), 'amount', 1000))))) LIKE 'FORBIDDEN%', e);
  END LOOP;
  PERFORM pg_temp.dat('PT-A1', pg_temp.thu_tien('KA', pg_temp.rec(h), 300000, 'lm-a-1'));
  PERFORM pg_temp.thu_tien('KA', pg_temp.rec(h), 300000, 'lm-a-1');
  PERFORM pg_temp.ghi('A4', 'thu 300.000 (Lưu 2 lần ra 1 phiếu): nợ 860.000, HĐ partial',
    pg_temp.no_k('KA') = 860000 AND pg_temp.rp(h) = 300000 AND pg_temp.rs(h) = 'partial'
    AND pg_temp.so($q$SELECT count(*) FROM cash_receipts WHERE client_key = 'lm-a-1'$q$) = 1,
    format('nợ %s paid %s %s', pg_temp.no_k('KA'), pg_temp.rp(h), pg_temp.rs(h)));
  PERFORM pg_temp.ghi('A4', 'thu tiền không đổi doanh số', pg_temp.dt() = 1160000, pg_temp.dt()::text);
  PERFORM pg_temp.ghi('A4', 'tiền thu thật +300.000 (Tài chính)', pg_temp.tt() - pg_temp.m('tt0') = 300000, (pg_temp.tt() - pg_temp.m('tt0'))::text);
END $t$;
SELECT pg_temp.bat_bien('A4', 'KA', ARRAY['PA', 'PB']) \g /dev/null

-- A5 Phiếu trả TỰ LẬP GẮN HĐ: 1 Thung 24 PA × 240.000 — hoàn thành = nhập kho + trừ nợ HĐ cùng lúc.
DO $t$ DECLARE h uuid := pg_temp.hd('DA'); r uuid; v_gv numeric; BEGIN
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('A5', 'NVBH không bấm Hoàn thành phiếu trả được', pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)',
    jsonb_build_object('customer_id', pg_temp.c('KA'), 'invoice_id', h, 'complete', true, 'lines',
      jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 240000))))) LIKE 'FORBIDDEN%', '');
  r := pg_temp.tra('KA', h, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 240000)), true);
  PERFORM pg_temp.dat('RA1', r);
  PERFORM pg_temp.ghi('A5', 'phiếu Hoàn thành, 240.000, trừ doanh số hôm nay',
    pg_temp.ret_tt(r) = 'completed' AND pg_temp.ret_c(r, 'credit_note_amount')::numeric = 240000
    AND pg_temp.ret_c(r, 'revenue_date')::date = pg_temp.hn() AND NOT pg_temp.ret_c(r, 'credit_with_invoice')::boolean,
    format('%s %s %s', pg_temp.ret_tt(r), pg_temp.ret_c(r, 'credit_note_amount'), pg_temp.ret_c(r, 'revenue_date')));
  PERFORM pg_temp.ghi('A5', 'kho PA +24 lon (1 thùng quy đổi) = 168', pg_temp.ton_k('PA') = 168, pg_temp.ton_k('PA')::text);
  v_gv := pg_temp.so(format($q$SELECT sum(sel.qty_in_base_uom * sel.unit_cost) FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id WHERE se.notes = 'Nhập lại từ phiếu trả %s'$q$, r));
  PERFORM pg_temp.ghi('A5', 'giá vốn hàng trả theo phiếu xuất của HĐ: 24 × 5.000 = 120.000', v_gv = 120000, v_gv::text);
  PERFORM pg_temp.ghi('A5', 'công nợ HĐ 1.160.000 − 240.000 = 920.000; nợ khách 620.000; không dòng nợ âm riêng',
    pg_temp.ra(h) = 920000 AND pg_temp.no_k('KA') = 620000
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE return_id = %L', r)) = 0,
    format('HĐ %s nợ %s', pg_temp.ra(h), pg_temp.no_k('KA')));
  PERFORM pg_temp.ghi('A5', 'doanh số thuần 1.160.000 − 240.000 = 920.000', pg_temp.dt() = 920000, pg_temp.dt()::text);
END $t$;
SELECT pg_temp.bat_bien('A5', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A5', 'KA') \g /dev/null

-- A6 Phiếu trả TỰ LẬP KHÔNG GẮN HĐ: PB 70 lon × 10.000 = 700.000 > nợ còn lại → công nợ ÂM.
DO $t$ DECLARE r uuid; BEGIN
  r := pg_temp.tra('KA', NULL, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 70, 'unit_price', 10000)), true);
  PERFORM pg_temp.dat('RA2', r);
  PERFORM pg_temp.ghi('A6', 'dòng công nợ âm −700.000 theo phiếu trả, vẫn open',
    pg_temp.so(format('SELECT amount FROM receivables WHERE return_id = %L', r)) = -700000
    AND pg_temp.so(format($q$SELECT count(*) FROM receivables WHERE return_id = %L AND status = 'open'$q$, r)) = 1, '');
  PERFORM pg_temp.ghi('A6', 'nợ khách 620.000 − 700.000 = −80.000 (không kẹp 0)', pg_temp.no_k('KA') = -80000, pg_temp.no_k('KA')::text);
  PERFORM pg_temp.ghi('A6', 'kho PB 80 + 70 = 150', pg_temp.ton_k('PB') = 150, pg_temp.ton_k('PB')::text);
  PERFORM pg_temp.ghi('A6', 'doanh số thuần 920.000 − 700.000 = 220.000', pg_temp.dt() = 220000, pg_temp.dt()::text);
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('A6', 'dashboard: tổng nợ mở cộng cả dòng âm', (SELECT open_receivables FROM dashboard_summary(pg_temp.hn()))
    = pg_temp.so($q$SELECT sum(amount - COALESCE(paid,0)) FROM receivables WHERE org_id = 'a0000000-0000-0000-0000-000000000001' AND status <> 'paid'$q$), '');
END $t$;
SELECT pg_temp.bat_bien('A6', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A6', 'KA') \g /dev/null

-- A7 Thu HĐ 620.000 bằng 600.000 dư có + 20.000 tiền mặt.
DO $t$ DECLARE h uuid := pg_temp.hd('DA'); rn uuid := (SELECT id FROM receivables WHERE return_id = pg_temp.c('RA2')); pt uuid; BEGIN
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.ghi('A7', 'thu vượt số còn nợ (700.000 > 620.000) bị chặn', pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)',
    jsonb_build_object('customer_id', pg_temp.c('KA'), 'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rec(h), 'amount', 700000))))) LIKE 'BAD_RECEIVABLE_LINE%', '');
  PERFORM pg_temp.ghi('A7', 'rút dư có quá số dư (800.000 > 700.000) bị chặn', pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)',
    jsonb_build_object('customer_id', pg_temp.c('KA'), 'use_credit', 800000, 'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rec(h), 'amount', 620000))))) LIKE 'CREDIT_BALANCE_TOO_LOW%', '');
  PERFORM pg_temp.ghi('A7', 'thu vào chính dòng nợ âm bị chặn', pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)',
    jsonb_build_object('customer_id', pg_temp.c('KA'), 'lines', jsonb_build_array(jsonb_build_object('receivable_id', rn, 'amount', 1000))))) LIKE 'BAD_RECEIVABLE_LINE%', '');
  PERFORM pg_temp.ghi('A7', 'thu tiền lẻ 0,5đ bị chặn', pg_temp.thu(format('SELECT create_cash_receipt(%L::jsonb)',
    jsonb_build_object('customer_id', pg_temp.c('KA'), 'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rec(h), 'amount', 1000.5))))) LIKE 'BAD_RECEIVABLE_LINE%', '');
  pt := pg_temp.thu_tien('KA', pg_temp.rec(h), 620000, 'lm-a-2', 600000);
  PERFORM pg_temp.dat('PT-A2', pt);
  PERFORM pg_temp.ghi('A7', 'phiếu thu tiền mặt thật 20.000', pg_temp.so(format('SELECT submitted_amount FROM cash_receipts WHERE id = %L', pt)) = 20000, '');
  PERFORM pg_temp.ghi('A7', 'HĐ đã thu đủ 920.000 → paid; dòng âm đã dùng 600.000 (paid −600.000)',
    pg_temp.rp(h) = 920000 AND pg_temp.rs(h) = 'paid'
    AND pg_temp.so(format('SELECT paid FROM receivables WHERE id = %L', rn)) = -600000,
    format('HĐ %s/%s; âm paid %s', pg_temp.rp(h), pg_temp.rs(h), pg_temp.so(format('SELECT paid FROM receivables WHERE id = %L', rn))));
  PERFORM pg_temp.ghi('A7', 'nợ khách còn −100.000 (dư có còn lại)', pg_temp.no_k('KA') = -100000, pg_temp.no_k('KA')::text);
  PERFORM pg_temp.ghi('A7', 'doanh số không đổi 220.000', pg_temp.dt() = 220000, pg_temp.dt()::text);
  PERFORM pg_temp.ghi('A7', 'tiền thu thật chỉ +20.000 (dư có 600.000 không phải tiền mặt): tổng 320.000',
    pg_temp.tt() - pg_temp.m('tt0') = 320000 AND pg_temp.pt() - pg_temp.m('pt0') = 320000, (pg_temp.tt() - pg_temp.m('tt0'))::text);
END $t$;
SELECT pg_temp.bat_bien('A7', 'KA', ARRAY['PA', 'PB']) \g /dev/null

-- A8 Sửa HĐ: PB 20 → 15. Tiền thu (cả phần dư có) chuyển sang tờ mới; phiếu trả tự lập gắn sang tờ mới.
DO $t$ DECLARE h0 uuid := pg_temp.hd('DA'); h uuid; r record; BEGIN
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.ghi('A8', 'kế toán không Sửa HĐ được', pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h0,
    jsonb_build_object('lines', pg_temp.dong_hd(h0, pg_temp.c('PB'), 15)))) LIKE 'FORBIDDEN%', '');
  PERFORM pg_temp.vai('owner');
  SELECT * INTO r FROM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong_hd(h0, pg_temp.c('PB'), 15)));
  h := pg_temp.hd('DA');
  PERFORM pg_temp.ghi('A8', 'tờ cũ Đã huỷ + trỏ tờ mới; đơn VẪN Hoàn thành; giữ ngày HĐ',
    h = r.invoice_id AND h <> h0 AND pg_temp.hd_c(h0, 'status') = 'cancelled' AND pg_temp.hd_c(h0, 'replaced_by')::uuid = h
    AND pg_temp.don_tt('DA') = 'completed' AND pg_temp.hd_c(h, 'invoice_date')::date = pg_temp.hn() - 1,
    format('đơn %s ngày %s', pg_temp.don_tt('DA'), pg_temp.hd_c(h, 'invoice_date')));
  PERFORM pg_temp.ghi('A8', 'tờ mới 1.110.000; nợ HĐ 1.110.000 − 240.000 = 870.000, đã thu 920.000 → dư 50.000 (open)',
    pg_temp.hd_c(h, 'total')::numeric = 1110000 AND pg_temp.ra(h) = 870000 AND pg_temp.rp(h) = 920000 AND pg_temp.rs(h) = 'open',
    format('total %s amount %s paid %s %s', pg_temp.hd_c(h, 'total'), pg_temp.ra(h), pg_temp.rp(h), pg_temp.rs(h)));
  PERFORM pg_temp.ghi('A8', 'phiếu trả tự lập vẫn Hoàn thành, gắn tờ mới', pg_temp.ret_tt(pg_temp.c('RA1')) = 'completed'
    AND pg_temp.ret_c(pg_temp.c('RA1'), 'invoice_id')::uuid = h, '');
  PERFORM pg_temp.ghi('A8', 'nợ khách −50.000 − 100.000 = −150.000', pg_temp.no_k('KA') = -150000, pg_temp.no_k('KA')::text);
  PERFORM pg_temp.ghi('A8', 'kho PB 150 + 5 = 155, PA giữ 168', pg_temp.ton_k('PB') = 155 AND pg_temp.ton_k('PA') = 168,
    format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('A8', 'doanh số 1.110.000 − 240.000 − 700.000 = 170.000 (tờ cũ không đếm)', pg_temp.dt() = 170000, pg_temp.dt()::text);
  PERFORM pg_temp.ghi('A8', 'không còn phiếu nợ của tờ cũ', pg_temp.rec(h0) IS NULL, '');
  PERFORM pg_temp.ghi('A8', 'Sửa HĐ không đẻ thêm tiền thu (vẫn 320.000)', pg_temp.tt() - pg_temp.m('tt0') = 320000, (pg_temp.tt() - pg_temp.m('tt0'))::text);
END $t$;
SELECT pg_temp.bat_bien('A8', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A8', 'KA') \g /dev/null

-- A9 Huỷ phiếu trả KHÔNG gắn HĐ khi dư có đã dùng 600.000 → nợ tự tăng lại.
DO $t$ DECLARE r uuid := pg_temp.c('RA2'); rn uuid := (SELECT id FROM receivables WHERE return_id = pg_temp.c('RA2')); BEGIN
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.ghi('A9', 'kế toán không huỷ phiếu trả được', pg_temp.thu(format('SELECT cancel_return(%L, %L)', r, 'x')) LIKE 'FORBIDDEN%', '');
  PERFORM pg_temp.vai('manager');
  PERFORM cancel_return(r, 'khách lấy lại hàng');
  PERFORM pg_temp.ghi('A9', 'phiếu Đã huỷ; dòng nợ của phiếu: amount 0, paid −600.000 → khách nợ lại 600.000',
    pg_temp.ret_tt(r) = 'cancelled' AND pg_temp.so(format('SELECT amount FROM receivables WHERE id = %L', rn)) = 0
    AND pg_temp.so(format('SELECT paid FROM receivables WHERE id = %L', rn)) = -600000
    AND pg_temp.so(format($q$SELECT count(*) FROM receivables WHERE id = %L AND status <> 'paid'$q$, rn)) = 1, '');
  PERFORM pg_temp.ghi('A9', 'nợ khách −50.000 + 600.000 = 550.000', pg_temp.no_k('KA') = 550000, pg_temp.no_k('KA')::text);
  PERFORM pg_temp.ghi('A9', 'kho PB 155 − 70 = 85', pg_temp.ton_k('PB') = 85, pg_temp.ton_k('PB')::text);
  PERFORM pg_temp.ghi('A9', 'doanh số 170.000 + 700.000 = 870.000; phiếu huỷ hết ngày trừ', pg_temp.dt() = 870000
    AND pg_temp.ret_c(r, 'revenue_date') IS NULL, pg_temp.dt()::text);
  PERFORM pg_temp.ghi('A9', 'huỷ lần hai bị chặn', pg_temp.thu(format('SELECT cancel_return(%L, %L)', r, 'x')) LIKE 'RETURN_NOT_CANCELLABLE%', '');
END $t$;
SELECT pg_temp.bat_bien('A9', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A9', 'KA') \g /dev/null

-- A10 Huỷ ngược hết: phiếu thu dư có → phiếu thu 300.000 → phiếu trả gắn HĐ → HĐ.
DO $t$ DECLARE h uuid := pg_temp.hd('DA'); e text; BEGIN
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('A10', 'huỷ HĐ đã thu tiền bị chặn', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x')) LIKE 'LOCKED_HAS_PAYMENT%', '');
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('A10', 'NVBH không huỷ phiếu thu được', pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', pg_temp.c('PT-A2'), 'x')) LIKE 'FORBIDDEN%', '');
  PERFORM pg_temp.vai('accountant');
  PERFORM void_cash_receipt(pg_temp.c('PT-A2'), 'thu nhầm');
  PERFORM pg_temp.ghi('A10', 'huỷ phiếu thu dư có: HĐ paid 300.000, dòng âm về 0 → nợ 870.000 − 300.000 = 570.000',
    pg_temp.rp(h) = 300000 AND pg_temp.no_k('KA') = 570000, format('paid %s nợ %s', pg_temp.rp(h), pg_temp.no_k('KA')));
  PERFORM pg_temp.ghi('A10', 'huỷ phiếu thu hai lần bị chặn', pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', pg_temp.c('PT-A2'), 'x')) LIKE 'RECEIPT_NOT_VOIDABLE%', '');
  PERFORM void_cash_receipt(pg_temp.c('PT-A1'), 'thu nhầm');
  PERFORM pg_temp.ghi('A10', 'huỷ phiếu thu 300.000: nợ 870.000', pg_temp.no_k('KA') = 870000 AND pg_temp.rp(h) = 0, pg_temp.no_k('KA')::text);
  PERFORM pg_temp.ghi('A10', 'huỷ hai phiếu thu: tiền thu về 0', pg_temp.tt() - pg_temp.m('tt0') = 0 AND pg_temp.pt() - pg_temp.m('pt0') = 0, (pg_temp.tt() - pg_temp.m('tt0'))::text);
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('A10', 'huỷ HĐ có phiếu trả đã nhập kho bị chặn', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x')) LIKE 'LOCKED_RETURN_DONE%', '');
  PERFORM pg_temp.vai('manager');
  PERFORM cancel_return(pg_temp.c('RA1'), 'trả nhầm');
  PERFORM pg_temp.ghi('A10', 'huỷ phiếu trả gắn HĐ: PA 168 − 24 = 144; nợ HĐ 1.110.000; doanh số 1.110.000',
    pg_temp.ton_k('PA') = 144 AND pg_temp.ra(h) = 1110000 AND pg_temp.no_k('KA') = 1110000 AND pg_temp.dt() = 1110000,
    format('PA %s nợ %s ds %s', pg_temp.ton_k('PA'), pg_temp.no_k('KA'), pg_temp.dt()));
  FOREACH e IN ARRAY ARRAY['accountant', 'sales', 'warehouse'] LOOP
    PERFORM pg_temp.vai(e);
    PERFORM pg_temp.ghi('A10', 'vai ' || e || ' không huỷ HĐ được', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x')) LIKE 'FORBIDDEN%', e);
  END LOOP;
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('A10', 'huỷ HĐ không lý do bị chặn', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, ' ')) LIKE 'REASON_REQUIRED%', '');
  PERFORM cancel_invoice(h, 'khách không lấy');
  PERFORM pg_temp.ghi('A10', 'huỷ HĐ = huỷ đơn; kho về nguyên PA 240, PB 100',
    pg_temp.don_tt('DA') = 'cancelled' AND pg_temp.ton_k('PA') = 240 AND pg_temp.ton_k('PB') = 100,
    format('đơn %s PA %s PB %s', pg_temp.don_tt('DA'), pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('A10', 'nợ khách 0, không còn phiếu nợ HĐ; doanh số về 0',
    pg_temp.no_k('KA') = 0 AND pg_temp.rec(h) IS NULL AND pg_temp.dt() = 0, format('nợ %s ds %s', pg_temp.no_k('KA'), pg_temp.dt()));
  PERFORM pg_temp.ghi('A10', 'lô PA LM-A1 về đúng 240, PB LM-B1 về đúng 100',
    pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-A1'$q$) = 240
    AND pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-B1'$q$) = 100, '');
  PERFORM pg_temp.ghi('A10', 'không còn payments nào của khách', pg_temp.so(format(
    'SELECT count(*) FROM payments p JOIN receivables rc ON rc.id = p.receivable_id WHERE rc.customer_id = %L', pg_temp.c('KA'))) = 0, '');
  PERFORM pg_temp.ghi('A10', 'huỷ HĐ lần hai bị chặn', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'x')) LIKE 'INVOICE_NOT_POSTED%', '');
  PERFORM pg_temp.ghi('A10', 'công nợ NCC không bị đụng (1.500.000)', pg_temp.so(format('SELECT sum(amount) FROM payables WHERE supplier_id = %L', pg_temp.c('NCC'))) = 1500000, '');
END $t$;
SELECT pg_temp.bat_bien('A10', 'KA', ARRAY['PA', 'PB']) \g /dev/null
SELECT pg_temp.chup('A10', 'KA') \g /dev/null

-- ═════════════════════════════════ CHUỖI B (huỷ theo thứ tự khác) ═════════════════════════════════
DO $t$ DECLARE h uuid; r uuid; rd uuid; pt uuid; BEGIN
  PERFORM pg_temp.lap_don('DB', 'KB', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 2, 'unit_price', 240000, 'line_total', 480000, 'conversion_factor', 24),
    jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 10, 'unit_price', 10000, 'line_total', 100000, 'conversion_factor', 1)));
  h := pg_temp.xuat('DB', jsonb_build_array(pg_temp.dd('DB', 'PA', 'Thung 24', 2), pg_temp.dd('DB', 'PB', 'lon', 10)), pg_temp.hn());
  PERFORM pg_temp.ghi('B1', 'xuất đủ 580.000: PA 192, PB 90, nợ 580.000, ds +580.000',
    pg_temp.ton_k('PA') = 192 AND pg_temp.ton_k('PB') = 90 AND pg_temp.no_k('KB') = 580000 AND pg_temp.dt() = 580000,
    format('PA %s PB %s nợ %s ds %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB'), pg_temp.no_k('KB'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('B1', 'KB', ARRAY['PA', 'PB']);
  -- B2 trả độc lập 10 lon PB (100.000) + phiếu NHÁP gắn HĐ (NVBH lập, chưa duyệt)
  r := pg_temp.tra('KB', NULL, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 10, 'unit_price', 10000)), true);
  PERFORM pg_temp.dat('RB1', r);
  rd := pg_temp.tra('KB', h, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000)), false, 'sales');
  PERFORM pg_temp.dat('RB2', rd);
  PERFORM pg_temp.ghi('B2', 'phiếu nháp không đụng nợ / kho / doanh số; phiếu độc lập trừ 100.000',
    pg_temp.ret_tt(rd) = 'draft' AND pg_temp.no_k('KB') = 480000 AND pg_temp.ton_k('PB') = 100 AND pg_temp.ton_k('PA') = 192
    AND pg_temp.dt() = 480000 AND pg_temp.ra(h) = 580000,
    format('nợ %s PB %s ds %s HĐ %s', pg_temp.no_k('KB'), pg_temp.ton_k('PB'), pg_temp.dt(), pg_temp.ra(h)));
  PERFORM pg_temp.bat_bien('B2', 'KB', ARRAY['PA', 'PB']);
  pt := pg_temp.thu_tien('KB', pg_temp.rec(h), 200000, 'lm-b-1');
  PERFORM pg_temp.ghi('B3', 'thu 200.000: nợ 280.000', pg_temp.no_k('KB') = 280000, pg_temp.no_k('KB')::text);
  PERFORM pg_temp.vai('accountant');
  PERFORM void_cash_receipt(pt, 'đảo');
  PERFORM pg_temp.vai('owner');
  PERFORM cancel_invoice(h, 'huỷ thử');
  PERFORM pg_temp.ghi('B4', 'huỷ HĐ trước phiếu trả độc lập: đơn Đã huỷ, phiếu nháp gắn HĐ Đã huỷ, phiếu độc lập còn Hoàn thành',
    pg_temp.don_tt('DB') = 'cancelled' AND pg_temp.ret_tt(rd) = 'cancelled' AND pg_temp.ret_tt(r) = 'completed', '');
  PERFORM pg_temp.ghi('B4', 'kho: PA 240, PB 110 (hàng trả độc lập còn trong kho); nợ −100.000; ds −100.000',
    pg_temp.ton_k('PA') = 240 AND pg_temp.ton_k('PB') = 110 AND pg_temp.no_k('KB') = -100000 AND pg_temp.dt() = -100000,
    format('PA %s PB %s nợ %s ds %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB'), pg_temp.no_k('KB'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('B4', 'KB', ARRAY['PA', 'PB']);
  PERFORM pg_temp.ghi('B5', 'Sửa HĐ đã huỷ bị chặn', pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h,
    jsonb_build_object('lines', pg_temp.dong_hd(h)))) LIKE '%INVOICE_NOT_POSTED%', '');
  PERFORM pg_temp.ghi('B5', 'xuất lại đơn đã huỷ bị chặn', pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object(
    'order_id', pg_temp.c('DB'), 'lines', jsonb_build_array(pg_temp.dd('DB', 'PB', 'lon', 1))))) LIKE 'ORDER_NOT_INVOICEABLE%', '');
  PERFORM pg_temp.ghi('B5', 'nhập kho phiếu nháp đã huỷ theo HĐ bị chặn', pg_temp.thu(format('SELECT complete_return(%L, %L)', rd, 'sale')) LIKE 'RETURN_NOT_SUBMITTED%', '');
  PERFORM pg_temp.vai('manager');
  PERFORM cancel_return(r, 'đảo');
  PERFORM pg_temp.ghi('B6', 'huỷ phiếu độc lập sau cùng: PB 100, nợ 0, ds 0',
    pg_temp.ton_k('PB') = 100 AND pg_temp.no_k('KB') = 0 AND pg_temp.dt() = 0,
    format('PB %s nợ %s ds %s', pg_temp.ton_k('PB'), pg_temp.no_k('KB'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('B6', 'KB', ARRAY['PA', 'PB']);
END $t$;

-- ═════════════════════════════════ CHUỖI C (phiếu tự sinh + hàng đổi) ═════════════════════════════════
-- Đơn 2 Thung 24 PA × 240.000; kèm trả 6 lon PA × 10.000 (60.000) và ĐỔI 5 lon PB.
DO $t$ DECLARE h uuid; r uuid; x record; BEGIN
  PERFORM pg_temp.lap_don('DC', 'KC', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 2, 'unit_price', 240000, 'line_total', 480000, 'conversion_factor', 24)),
    jsonb_build_array(
      jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'lon', 'quantity', 6, 'unit_price', 10000, 'line_total', 60000, 'is_exchange', false),
      jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 5, 'unit_price', 10000, 'line_total', 50000, 'is_exchange', true)));
  r := (SELECT id FROM returns WHERE order_id = pg_temp.c('DC'));
  PERFORM pg_temp.dat('RC', r);
  PERFORM pg_temp.ghi('C0', 'đơn kèm phiếu trả Nháp: chưa trừ nợ / doanh số, chưa nhập kho',
    pg_temp.ret_tt(r) = 'draft' AND pg_temp.no_k('KC') = 0 AND pg_temp.dt() = 0 AND pg_temp.ton_k('PA') = 240, '');
  PERFORM pg_temp.vai('manager');
  PERFORM pg_temp.ghi('C0', 'nhập kho phiếu trả của đơn chưa xuất bị chặn', pg_temp.thu(format('SELECT complete_return(%L, %L)', r, 'sale')) LIKE 'RETURN_NOT_SUBMITTED%', '');
  PERFORM pg_temp.ghi('C0', 'huỷ phiếu trả theo đơn ở màn phiếu trả bị chặn', pg_temp.thu(format('SELECT cancel_return(%L, %L)', r, 'x')) LIKE 'RETURN_FOLLOWS_ORDER%', '');
  PERFORM pg_temp.vai('owner');
  SELECT * INTO x FROM get_invoiceable_lines(pg_temp.c('DC')) g WHERE g.is_exchange;
  PERFORM pg_temp.ghi('C0', 'màn xuất HĐ liệt kê dòng hàng đổi 5 lon PB', FOUND AND x.remaining_qty = 5 AND x.product_id = pg_temp.c('PB'), COALESCE(x.remaining_qty::text, 'không có'));
  h := pg_temp.xuat('DC', jsonb_build_array(pg_temp.dd('DC', 'PA', 'Thung 24', 2),
    jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'conversion_factor', 1, 'quantity', 5, 'unit_price', 0, 'vat_rate', 0, 'is_exchange', true)),
    pg_temp.hn() - 2);
  PERFORM pg_temp.ghi('C1', 'HĐ 480.000; phiếu tự sinh Chờ xử lý 60.000 (hàng đổi không tính tiền), trừ doanh số ngày HĐ',
    pg_temp.hd_c(h, 'total')::numeric = 480000 AND pg_temp.ret_tt(r) = 'submitted' AND pg_temp.ret_c(r, 'credit_with_invoice')::boolean
    AND pg_temp.ret_c(r, 'credit_note_amount')::numeric = 60000 AND pg_temp.ret_c(r, 'revenue_date')::date = pg_temp.hn() - 2
    AND pg_temp.ret_c(r, 'invoice_id')::uuid = h,
    format('total %s phiếu %s credit %s ngày %s', pg_temp.hd_c(h, 'total'), pg_temp.ret_tt(r), pg_temp.ret_c(r, 'credit_note_amount'), pg_temp.ret_c(r, 'revenue_date')));
  PERFORM pg_temp.ghi('C1', 'nợ HĐ 420.000 ngay lúc xuất; ds +420.000', pg_temp.ra(h) = 420000 AND pg_temp.no_k('KC') = 420000 AND pg_temp.dt() = 420000,
    format('HĐ %s nợ %s ds %s', pg_temp.ra(h), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.ghi('C1', 'kho: PA 240 − 48 = 192; PB 100 − 5 (hàng đổi đi) = 95; hàng trả chưa về',
    pg_temp.ton_k('PA') = 192 AND pg_temp.ton_k('PB') = 95, format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('C1', 'xuất xong: màn xuất HĐ không còn liệt kê hàng đổi (không xuất hai lần)',
    NOT EXISTS (SELECT 1 FROM get_invoiceable_lines(pg_temp.c('DC')) g WHERE g.is_exchange), '');
  PERFORM pg_temp.vai('manager');
  PERFORM pg_temp.ghi('C1', 'phiếu tự sinh Chờ xử lý không huỷ được', pg_temp.thu(format('SELECT cancel_return(%L, %L)', r, 'x')) LIKE 'RETURN_FOLLOWS_INVOICE%', '');
  PERFORM pg_temp.ghi('C1', 'phiếu tự sinh không sửa được ở màn phiếu trả', pg_temp.thu(format('SELECT save_pos_return(%L::jsonb)', jsonb_build_object(
    'return_id', r, 'customer_id', pg_temp.c('KC'), 'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'lon', 'quantity', 1, 'unit_price', 1))))) LIKE 'RETURN_FOLLOWS_INVOICE%', '');
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('C1', 'NVBH không nhập kho phiếu trả', pg_temp.thu(format('SELECT complete_return(%L, %L)', r, 'sale')) LIKE 'FORBIDDEN%', '');
  PERFORM pg_temp.bat_bien('C1', 'KC', ARRAY['PA', 'PB']);
  PERFORM pg_temp.chup('C1', 'KC');
END $t$;

DO $t$ DECLARE r uuid := pg_temp.c('RC'); h uuid := pg_temp.hd('DC'); BEGIN
  PERFORM pg_temp.vai('warehouse');
  PERFORM pg_temp.ghi('C2', 'ngày nhập kho trước ngày HĐ bị chặn', pg_temp.thu(format('SELECT complete_return(%L, %L, %L::date)', r, 'sale', pg_temp.hn() - 3)) LIKE 'NGAY_NHAP_TRUOC_HOA_DON%', '');
  PERFORM pg_temp.ghi('C2', 'ngày nhập kho tương lai bị chặn', pg_temp.thu(format('SELECT complete_return(%L, %L, %L::date)', r, 'sale', pg_temp.hn() + 1)) LIKE 'NGAY_NHAP_TUONG_LAI%', '');
  PERFORM complete_return(r, 'sale', pg_temp.hn() - 1);
  PERFORM pg_temp.ghi('C2', 'thủ kho nhập kho: PA +6 = 198, PB +5 (hàng đổi về) = 100; nợ giữ 420.000; ngày trừ ds giữ ngày HĐ',
    pg_temp.ret_tt(r) = 'completed' AND pg_temp.ton_k('PA') = 198 AND pg_temp.ton_k('PB') = 100 AND pg_temp.no_k('KC') = 420000
    AND pg_temp.dt() = 420000 AND pg_temp.ret_c(r, 'revenue_date')::date = pg_temp.hn() - 2,
    format('PA %s PB %s nợ %s ds %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB'), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.ghi('C2', 'nhập kho lần hai bị chặn', pg_temp.thu(format('SELECT complete_return(%L, %L)', r, 'sale')) LIKE 'RETURN_NOT_SUBMITTED%', '');
  PERFORM pg_temp.bat_bien('C2', 'KC', ARRAY['PA', 'PB']);
  PERFORM pg_temp.dat('PT-C', pg_temp.thu_tien('KC', pg_temp.rec(h), 100000, 'lm-c-1'));
  PERFORM pg_temp.ghi('C3', 'thu 100.000: nợ 320.000', pg_temp.no_k('KC') = 320000, pg_temp.no_k('KC')::text);
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('C4', 'Sửa HĐ có phiếu tự sinh đã nhập kho mà chưa chọn Có/Không → hỏi', pg_temp.thu(format(
    'SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', pg_temp.dong_hd(h)))) LIKE 'REISSUE_RETURN_STOCKED%', '');
END $t$;

-- C5 Sửa HĐ chọn CÓ: trả PA 6 → 3 lon.
DO $t$ DECLARE r uuid := pg_temp.c('RC'); h0 uuid := pg_temp.hd('DC'); h uuid; l uuid; BEGIN
  PERFORM pg_temp.vai('owner');
  SELECT id INTO l FROM return_lines WHERE return_id = r AND NOT is_exchange;
  PERFORM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong_hd(h0), 'tra_da_nhap', 'lam_lai',
    'return_edits', jsonb_build_array(jsonb_build_object('line_id', l, 'quantity', 3))));
  h := pg_temp.hd('DC');
  PERFORM pg_temp.ghi('C5', 'Có: phiếu về Chờ xử lý, bám tờ mới, 30.000; không tự nhập kho lại',
    h <> h0 AND pg_temp.ret_tt(r) = 'submitted' AND pg_temp.ret_c(r, 'invoice_id')::uuid = h
    AND pg_temp.ret_c(r, 'credit_note_amount')::numeric = 30000,
    format('%s credit %s', pg_temp.ret_tt(r), pg_temp.ret_c(r, 'credit_note_amount')));
  PERFORM pg_temp.ghi('C5', 'kho: PA 192, PB 95 (đảo nhập + hoàn HĐ cũ + xuất tờ mới kể cả hàng đổi)',
    pg_temp.ton_k('PA') = 192 AND pg_temp.ton_k('PB') = 95, format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.ghi('C5', 'nợ HĐ 480.000 − 30.000 = 450.000, đã thu 100.000 chuyển sang; nợ khách 350.000; ds 450.000',
    pg_temp.ra(h) = 450000 AND pg_temp.rp(h) = 100000 AND pg_temp.no_k('KC') = 350000 AND pg_temp.dt() = 450000,
    format('HĐ %s/%s nợ %s ds %s', pg_temp.ra(h), pg_temp.rp(h), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.ghi('C5', 'đơn vẫn Hoàn thành; ngày HĐ giữ', pg_temp.don_tt('DC') = 'completed' AND pg_temp.hd_c(h, 'invoice_date')::date = pg_temp.hn() - 2, '');
  PERFORM pg_temp.bat_bien('C5', 'KC', ARRAY['PA', 'PB']);
  PERFORM pg_temp.chup('C5', 'KC');
  PERFORM pg_temp.vai('warehouse');
  PERFORM complete_return(r, 'sale');
  PERFORM pg_temp.ghi('C6', 'nhập kho lại: PA 195, PB 100; đúng một phiếu nhập còn hiệu lực',
    pg_temp.ton_k('PA') = 195 AND pg_temp.ton_k('PB') = 100
    AND pg_temp.so(format($q$SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả %s'$q$, r)) = 1,
    format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.bat_bien('C6', 'KC', ARRAY['PA', 'PB']);
END $t$;

-- C7 Sửa HĐ chọn KHÔNG: PA 2 → 1 thùng, giữ phiếu nhập.
DO $t$ DECLARE r uuid := pg_temp.c('RC'); h0 uuid := pg_temp.hd('DC'); h uuid; n0 numeric; BEGIN
  n0 := pg_temp.so(format($q$SELECT count(*) FROM stock_entries WHERE notes LIKE '%%%s%%'$q$, r));
  PERFORM pg_temp.vai('owner');
  PERFORM reissue_invoice(h0, jsonb_build_object('lines', pg_temp.dong_hd(h0, pg_temp.c('PA'), 1), 'tra_da_nhap', 'giu'));
  h := pg_temp.hd('DC');
  PERFORM pg_temp.ghi('C7', 'Không: phiếu giữ Hoàn thành, gắn tờ mới, không thêm phiếu kho',
    pg_temp.ret_tt(r) = 'completed' AND pg_temp.ret_c(r, 'invoice_id')::uuid = h
    AND pg_temp.so(format($q$SELECT count(*) FROM stock_entries WHERE notes LIKE '%%%s%%'$q$, r)) = n0, '');
  PERFORM pg_temp.ghi('C7', 'tờ mới 240.000; nợ HĐ 210.000, đã thu 100.000; nợ khách 110.000; ds 210.000',
    pg_temp.hd_c(h, 'total')::numeric = 240000 AND pg_temp.ra(h) = 210000 AND pg_temp.rp(h) = 100000
    AND pg_temp.no_k('KC') = 110000 AND pg_temp.dt() = 210000,
    format('total %s HĐ %s nợ %s ds %s', pg_temp.hd_c(h, 'total'), pg_temp.ra(h), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.ghi('C7', 'kho: PA 195 + 48 − 24 = 219; PB 100 (đổi hoàn + xuất lại)', pg_temp.ton_k('PA') = 219 AND pg_temp.ton_k('PB') = 100,
    format('PA %s PB %s', pg_temp.ton_k('PA'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.bat_bien('C7', 'KC', ARRAY['PA', 'PB']);
  PERFORM pg_temp.vai('manager');
  PERFORM cancel_return(r, 'nhập nhầm');
  PERFORM pg_temp.ghi('C8', 'huỷ nhập phiếu tự sinh: về Chờ xử lý, PA 216, PB 95, nợ giữ 110.000, ds giữ 210.000',
    pg_temp.ret_tt(r) = 'submitted' AND pg_temp.ton_k('PA') = 216 AND pg_temp.ton_k('PB') = 95
    AND pg_temp.no_k('KC') = 110000 AND pg_temp.dt() = 210000,
    format('%s PA %s PB %s nợ %s ds %s', pg_temp.ret_tt(r), pg_temp.ton_k('PA'), pg_temp.ton_k('PB'), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('C8', 'KC', ARRAY['PA', 'PB']);
  PERFORM pg_temp.vai('accountant');
  PERFORM void_cash_receipt(pg_temp.c('PT-C'), 'đảo');
  PERFORM pg_temp.vai('owner');
  PERFORM cancel_invoice(h, 'huỷ hết');
  PERFORM pg_temp.ghi('C9', 'huỷ HĐ: đơn + phiếu tự sinh Đã huỷ; PA 240, PB 100; nợ 0; ds 0',
    pg_temp.don_tt('DC') = 'cancelled' AND pg_temp.ret_tt(r) = 'cancelled' AND pg_temp.ton_k('PA') = 240 AND pg_temp.ton_k('PB') = 100
    AND pg_temp.no_k('KC') = 0 AND pg_temp.dt() = 0 AND pg_temp.ret_c(r, 'revenue_date') IS NULL,
    format('đơn %s phiếu %s PA %s PB %s nợ %s ds %s', pg_temp.don_tt('DC'), pg_temp.ret_tt(r), pg_temp.ton_k('PA'), pg_temp.ton_k('PB'), pg_temp.no_k('KC'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('C9', 'KC', ARRAY['PA', 'PB']);
END $t$;

-- ═════════════════════════════════ CHUỖI D (nhân viên nghỉ việc giữa chừng) ═════════════════════════════════
DO $t$ DECLARE h uuid; j jsonb; r uuid; BEGIN
  PERFORM pg_temp.lap_don('DD', 'KD', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 2, 'unit_price', 240000, 'line_total', 480000, 'conversion_factor', 24)),
    NULL, 'e7770000-0000-0000-0000-00000000000a');
  h := pg_temp.xuat('DD', jsonb_build_array(pg_temp.dd('DD', 'PA', 'Thung 24', 2)), pg_temp.hn());
  PERFORM pg_temp.ghi('D1', 'HĐ + nợ đứng tên NV X', pg_temp.hd_c(h, 'sales_user_id')::uuid = pg_temp.c('NVX')
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L AND sales_user_id = %L', h, pg_temp.c('NVX'))) = 1, '');
  PERFORM pg_temp.thu_tien('KD', pg_temp.rec(h), 80000, 'lm-d-1');
  PERFORM pg_temp.vai('manager');
  PERFORM pg_temp.ghi('D2', 'quản lý không cho nghỉ việc được (chỉ chủ NPP)', pg_temp.thu(format('SELECT cho_nhan_vien_nghi(%L)', pg_temp.c('NVX'))) LIKE 'KHONG_DU_QUYEN%', '');
  PERFORM pg_temp.vai('owner');
  j := cho_nhan_vien_nghi(pg_temp.c('NVX'));
  PERFORM pg_temp.ghi('D3', 'nghỉ việc: 1 khoản nợ 400.000 về NPP; HĐ vẫn tên NV X (doanh số); khách gỡ',
    (j->>'so_khoan_no')::int = 1 AND (j->>'tien_no')::numeric = 400000
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L AND sales_user_id IS NULL AND ve_npp_luc IS NOT NULL', h)) = 1
    AND pg_temp.hd_c(h, 'sales_user_id')::uuid = pg_temp.c('NVX')
    AND pg_temp.so(format('SELECT count(*) FROM customer_assignments WHERE user_id = %L', pg_temp.c('NVX'))) = 0, j::text);
  PERFORM pg_temp.ghi('D3', 'nghỉ việc không đổi số nợ / doanh số', pg_temp.no_k('KD') = 400000 AND pg_temp.dt() = 480000,
    format('nợ %s ds %s', pg_temp.no_k('KD'), pg_temp.dt()));
  PERFORM pg_temp.bat_bien('D3', 'KD', ARRAY['PA', 'PB']);
  r := pg_temp.tra('KD', NULL, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 5, 'unit_price', 10000)), true);
  PERFORM pg_temp.ghi('D4', 'phiếu trả độc lập sau khi NV nghỉ: dòng âm −50.000 thuộc NPP (không về người đã nghỉ)',
    pg_temp.so(format('SELECT amount FROM receivables WHERE return_id = %L AND sales_user_id IS NULL', r)) = -50000, '');
  PERFORM pg_temp.ghi('D4', 'nợ 350.000; PB 105', pg_temp.no_k('KD') = 350000 AND pg_temp.ton_k('PB') = 105,
    format('nợ %s PB %s', pg_temp.no_k('KD'), pg_temp.ton_k('PB')));
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('D5', 'NVBH không tự nhận nợ', pg_temp.thu(format('SELECT giao_cong_no_npp(%L, %L)', pg_temp.c('KD'), pg_temp.c('NVY'))) LIKE 'KHONG_DU_QUYEN%', '');
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.ghi('D5', 'không giao nợ cho người đã nghỉ', pg_temp.thu(format('SELECT giao_cong_no_npp(%L, %L)', pg_temp.c('KD'), pg_temp.c('NVX'))) LIKE 'NV_KHONG_HOP_LE%', '');
  j := giao_cong_no_npp(pg_temp.c('KD'), pg_temp.c('NVY'));
  PERFORM pg_temp.ghi('D5', 'NPP giao lại cho NV Y: 2 khoản, 350.000', (j->>'so_khoan_no')::int = 2 AND (j->>'tien_no')::numeric = 350000
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE customer_id = %L AND sales_user_id = %L AND ve_npp_luc IS NULL', pg_temp.c('KD'), pg_temp.c('NVY'))) = 2, j::text);
  r := pg_temp.tra('KD', h, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'lon', 'quantity', 12, 'unit_price', 10000)), true);
  PERFORM pg_temp.ghi('D6', 'trả gắn HĐ sau khi giao lại: nợ HĐ 360.000 vẫn của NV Y; nợ khách 230.000',
    pg_temp.ra(h) = 360000 AND pg_temp.no_k('KD') = 230000
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L AND sales_user_id = %L', h, pg_temp.c('NVY'))) = 1,
    format('HĐ %s nợ %s', pg_temp.ra(h), pg_temp.no_k('KD')));
  PERFORM pg_temp.ghi('D6', 'công nợ theo NV (receivables_by_rep): NV Y 230.000, NV X không còn nợ',
    (SELECT total_debt FROM receivables_by_rep() WHERE user_id = pg_temp.c('NVY')) = 230000
    AND COALESCE((SELECT total_debt FROM receivables_by_rep() WHERE user_id = pg_temp.c('NVX')), 0) = 0,
    (SELECT total_debt FROM receivables_by_rep() WHERE user_id = pg_temp.c('NVY'))::text);
  PERFORM pg_temp.bat_bien('D6', 'KD', ARRAY['PA', 'PB']);
  PERFORM pg_temp.vai('owner');
  PERFORM reissue_invoice(h, jsonb_build_object('lines', pg_temp.dong_hd(h)));
  h := pg_temp.hd('DD');
  PERFORM pg_temp.ghi('D7', 'Sửa HĐ của NV đã nghỉ: tiền đúng (nợ HĐ 360.000, đã thu 80.000, nợ khách 230.000)',
    pg_temp.ra(h) = 360000 AND pg_temp.rp(h) = 80000 AND pg_temp.no_k('KD') = 230000,
    format('HĐ %s/%s nợ %s', pg_temp.ra(h), pg_temp.rp(h), pg_temp.no_k('KD')));
  PERFORM pg_temp.ghi('D7', 'Sửa HĐ: doanh số HĐ vẫn tên NV X', pg_temp.hd_c(h, 'sales_user_id')::uuid = pg_temp.c('NVX'), '');
  PERFORM pg_temp.ghi('D7', 'Sửa HĐ: nợ không quay về tên người đã nghỉ',
    pg_temp.so(format('SELECT count(*) FROM receivables WHERE customer_id = %L AND sales_user_id = %L', pg_temp.c('KD'), pg_temp.c('NVX'))) = 0, '');
  PERFORM pg_temp.bat_bien('D7', 'KD', ARRAY['PA', 'PB']);
END $t$;

-- ═════════════════════════════════ CHUỖI E (kiểm kê lệch rồi xuất bán) ═════════════════════════════════
DO $t$ DECLARE e uuid; e2 uuid; r record; h uuid; v text; j jsonb; BEGIN
  PERFORM pg_temp.ghim('dsE', pg_temp.dt());
  PERFORM pg_temp.vai('warehouse');
  PERFORM post_stock_import(jsonb_build_object('entry_code', 'NK-LM-E1', 'posted_at', now() - interval '2 days', 'lines', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PE'), 'base_qty', 50, 'unit_name', 'lon', 'base_cost', 4000, 'batch_code', 'LM-E1', 'expires_at', pg_temp.hn() + 100))));
  PERFORM post_stock_import(jsonb_build_object('entry_code', 'NK-LM-E2', 'posted_at', now() - interval '1 days', 'lines', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PE'), 'base_qty', 30, 'unit_name', 'lon', 'base_cost', 5000, 'batch_code', 'LM-E2', 'expires_at', pg_temp.hn() + 200))));
  PERFORM pg_temp.ghi('E1', 'nhập hai lô: tồn 80', pg_temp.ton_k('PE') = 80, pg_temp.ton_k('PE')::text);
  -- Thủ kho lập phiếu kiểm kê NHÁP: lô E1 thiếu 5; thừa 2 không rõ lô.
  INSERT INTO stock_entries (org_id, entry_code, type, status, created_by, notes)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'KK-LM-1', 'stocktake', 'draft', auth.uid(), 'Kiểm kê LM') RETURNING id INTO e;
  -- Đúng tải trọng màn /inventory/stocktake-adjust (đơn vị cơ sở, hệ số 1).
  INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom,
                                 transaction_uom, conversion_factor_snapshot, unit_cost) VALUES
    (e, pg_temp.c('PE'), (SELECT id FROM batches WHERE batch_code = 'LM-E1'), 'lon', -5, -5, -5, 'lon', 1, 4000),
    (e, pg_temp.c('PE'), NULL, 'lon', 2, 2, 2, 'lon', 1, 0);
  PERFORM pg_temp.ghi('E2', 'phiếu kiểm kê nháp chưa đổi tồn', pg_temp.ton_k('PE') = 80, '');
  PERFORM pg_temp.ghi('E2', 'thủ kho không tự duyệt kiểm kê', pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e)) LIKE 'FORBIDDEN%', '');
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('E2', 'NVBH không duyệt kiểm kê', pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e)) LIKE 'FORBIDDEN%'
    OR pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e)) LIKE 'ENTRY_NOT_FOUND%', pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e)));
  PERFORM pg_temp.vai('manager');
  SELECT * INTO r FROM post_stock_adjustment(e);
  PERFORM pg_temp.ghi('E2', 'duyệt: lô E1 45, thừa vào lô hạn xa nhất E2 = 32; tồn 77',
    pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E1'$q$) = 45
    AND pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E2'$q$) = 32 AND pg_temp.ton_k('PE') = 77,
    format('E1 %s E2 %s', pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E1'$q$), pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E2'$q$)));
  PERFORM pg_temp.ghi('E2', 'hao hụt 5 × 4.000 = 20.000 ghi chi phí cùng lúc; thừa 2 × 5.000',
    r.shrink_qty = 5 AND r.shrink_value = 20000 AND r.surplus_qty = 2 AND r.surplus_value = 10000
    AND pg_temp.so(format('SELECT amount FROM expenses WHERE id = %L', r.expense_id)) = 20000,
    format('hụt %s/%s thừa %s/%s', r.shrink_qty, r.shrink_value, r.surplus_qty, r.surplus_value));
  PERFORM pg_temp.ghi('E2', 'duyệt lần hai bị chặn (không cộng tồn hai lần)', pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e)) LIKE 'ALREADY_POSTED%' AND pg_temp.ton_k('PE') = 77, '');
  PERFORM pg_temp.ghi('E2', 'tồn lô = thẻ kho sau kiểm kê', pg_temp.the_kho(pg_temp.c('PE')) = 77, pg_temp.the_kho(pg_temp.c('PE'))::text);
  -- E3 bán 60 lon: FIFO E1 45 + E2 15.
  PERFORM pg_temp.lap_don('DE', 'KE', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PE'), 'unit_name', 'lon', 'quantity', 60, 'unit_price', 9000, 'line_total', 540000, 'conversion_factor', 1)));
  h := pg_temp.xuat('DE', jsonb_build_array(pg_temp.dd('DE', 'PE', 'lon', 60)), pg_temp.hn());
  PERFORM pg_temp.ghi('E3', 'xuất 60 sau kiểm kê: E1 0, E2 17; tồn 17',
    pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E1'$q$) = 0
    AND pg_temp.so($q$SELECT qty_on_hand FROM batches WHERE batch_code = 'LM-E2'$q$) = 17 AND pg_temp.ton_k('PE') = 17, '');
  j := bao_cao_so_ban(pg_temp.hn(), pg_temp.hn());
  PERFORM pg_temp.ghi('E3', 'giá vốn trên báo cáo = 45×4.000 + 15×5.000 = 255.000 (khớp lô đã tiêu)',
    (SELECT (g->>'tien')::numeric FROM jsonb_array_elements(j->'gv') g WHERE g->>'product_id' = pg_temp.c('PE')::text) = 255000
    AND pg_temp.so(format('SELECT sum(slc.qty_in_base_uom * slc.unit_cost) FROM stock_line_consumptions slc JOIN stock_entry_lines sel ON sel.id = slc.line_id WHERE sel.entry_id = %L', pg_temp.hd_c(h, 'stock_entry_id'))) = 255000,
    (SELECT g->>'tien' FROM jsonb_array_elements(j->'gv') g WHERE g->>'product_id' = pg_temp.c('PE')::text));
  PERFORM pg_temp.ghi('E3', 'nợ 540.000; ds +540.000', pg_temp.no_k('KE') = 540000 AND pg_temp.dt() - pg_temp.m('dsE') = 540000,
    format('nợ %s ds %s', pg_temp.no_k('KE'), pg_temp.dt() - pg_temp.m('dsE')));
  PERFORM pg_temp.bat_bien('E3', 'KE', ARRAY['PE']);
  -- E4 Phiếu kiểm kê cũ (đếm trước khi bán) bị chặn khi tồn lô đã đổi.
  PERFORM pg_temp.vai('warehouse');
  INSERT INTO stock_entries (org_id, entry_code, type, status, created_by, notes)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'KK-LM-2', 'stocktake', 'draft', auth.uid(), 'Kiểm kê cũ') RETURNING id INTO e2;
  INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, qty_in_base_uom, qty_in_transaction_uom,
                                 transaction_uom, conversion_factor_snapshot, unit_cost)
  VALUES (e2, pg_temp.c('PE'), (SELECT id FROM batches WHERE batch_code = 'LM-E1'), 'lon', -5, -5, -5, 'lon', 1, 4000);
  PERFORM pg_temp.vai('manager');
  PERFORM pg_temp.ghi('E4', 'kiểm kê cũ trừ lô đã bán hết bị chặn STOCK_MOVED, tồn giữ 17',
    pg_temp.thu(format('SELECT post_stock_adjustment(%L)', e2)) LIKE 'STOCK_MOVED%' AND pg_temp.ton_k('PE') = 17, '');
  -- E5 Bán vượt tồn (cấm bán âm): chặn, không có HĐ, kho không đổi.
  PERFORM pg_temp.lap_don('DE2', 'KE', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PE'), 'unit_name', 'lon', 'quantity', 30, 'unit_price', 9000, 'line_total', 270000, 'conversion_factor', 1)));
  PERFORM pg_temp.vai('owner');
  v := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('DE2'), 'invoice_date', pg_temp.hn(),
    'lines', jsonb_build_array(pg_temp.dd('DE2', 'PE', 'lon', 30)))));
  PERFORM pg_temp.ghi('E5', 'bán 30 khi còn 17 bị chặn INSUFFICIENT_STOCK', v LIKE 'INSUFFICIENT_STOCK%', left(v, 70));
  PERFORM pg_temp.ghi('E5', 'sau khi chặn: tồn 17, đơn vẫn Đã gửi, nợ 540.000', pg_temp.ton_k('PE') = 17 AND pg_temp.don_tt('DE2') = 'submitted'
    AND pg_temp.no_k('KE') = 540000, '');
  -- Giao thiếu đúng 17 → được, đơn Hoàn thành.
  h := pg_temp.xuat('DE2', jsonb_build_array(pg_temp.dd('DE2', 'PE', 'lon', 17)), pg_temp.hn());
  PERFORM pg_temp.ghi('E5', 'giao thiếu 17/30: tồn 0, HĐ 153.000, đơn Hoàn thành, nợ 693.000',
    pg_temp.ton_k('PE') = 0 AND pg_temp.hd_c(h, 'total')::numeric = 153000 AND pg_temp.don_tt('DE2') = 'completed' AND pg_temp.no_k('KE') = 693000,
    format('tồn %s nợ %s', pg_temp.ton_k('PE'), pg_temp.no_k('KE')));
  PERFORM pg_temp.bat_bien('E5', 'KE', ARRAY['PE']);
END $t$;

-- ═════════════════════════════════ CHUỖI F (cuối tháng / đầu tháng, phiên UTC) ═════════════════════════════════
DO $t$ DECLARE cuoi date := date_trunc('month', pg_temp.hn())::date - 1; dau date := date_trunc('month', pg_temp.hn())::date;
  h uuid; r uuid; r2 uuid; j jsonb; v_ds0 numeric; v_ds1 numeric; BEGIN
  PERFORM pg_temp.vai('owner');
  v_ds0 := (SELECT period_revenue FROM dashboard_summary(dau));
  PERFORM pg_temp.lap_don('DF', 'KF', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 240000, 'line_total', 240000, 'conversion_factor', 24)),
    jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'lon', 'quantity', 2, 'unit_price', 10000, 'line_total', 20000)));
  h := pg_temp.xuat('DF', jsonb_build_array(pg_temp.dd('DF', 'PA', 'Thung 24', 1)), cuoi);
  r := (SELECT id FROM returns WHERE order_id = pg_temp.c('DF'));
  PERFORM pg_temp.ghi('F1', 'HĐ ngày cuối tháng trước; phiếu tự sinh trừ ds đúng ngày cuối tháng; hạn nợ = ngày HĐ + 30',
    pg_temp.hd_c(h, 'invoice_date')::date = cuoi AND pg_temp.ret_c(r, 'revenue_date')::date = cuoi
    AND pg_temp.so(format('SELECT (due_date - %L::date) FROM receivables WHERE invoice_id = %L', cuoi, h)) = 30, '');
  PERFORM pg_temp.vai('warehouse');
  PERFORM complete_return(r, 'sale', dau);
  PERFORM pg_temp.ghi('F2', 'nhập kho ngày đầu tháng: phiếu nhập ghi sổ đúng ngày VN đầu tháng; ngày trừ ds vẫn cuối tháng',
    pg_temp.so(format($q$SELECT count(*) FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả %s' AND (posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = %L$q$, r, dau)) = 1
    AND pg_temp.ret_c(r, 'revenue_date')::date = cuoi, '');
  r2 := pg_temp.tra('KF', NULL, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PB'), 'unit_name', 'lon', 'quantity', 3, 'unit_price', 10000)), true, 'manager', dau);
  PERFORM pg_temp.ghi('F3', 'phiếu tự lập ngày đầu tháng: trừ ds ngày đầu tháng (giờ VN), hạn dòng nợ âm = ngày chứng từ',
    pg_temp.ret_c(r2, 'revenue_date')::date = dau
    AND pg_temp.so(format('SELECT (due_date - %L::date) FROM receivables WHERE return_id = %L', dau, r2)) = 0,
    pg_temp.ret_c(r2, 'revenue_date'));
  PERFORM pg_temp.vai('owner');
  v_ds1 := (SELECT period_revenue FROM dashboard_summary(dau));
  PERFORM pg_temp.ghi('F4', 'dashboard tháng này: chỉ −30.000 (HĐ + phiếu tự sinh thuộc tháng trước)', v_ds1 - v_ds0 = -30000, (v_ds1 - v_ds0)::text);
  j := bao_cao_so_ban(date_trunc('month', cuoi)::date, cuoi);
  PERFORM pg_temp.ghi('F4', 'báo cáo tháng trước: có HĐ 240.000 và trả 20.000 của khách, không có phiếu 30.000',
    (SELECT sum((x->>'total')::numeric) FROM jsonb_array_elements(j->'hd') x WHERE x->>'customer_id' = pg_temp.c('KF')::text) = 240000
    AND (SELECT sum((x->>'credit_note_amount')::numeric) FROM jsonb_array_elements(j->'tra') x WHERE x->>'customer_id' = pg_temp.c('KF')::text) = 20000, '');
  j := bao_cao_so_ban(dau, pg_temp.hn());
  PERFORM pg_temp.ghi('F4', 'báo cáo tháng này: trả 30.000 của khách, không có HĐ của khách',
    (SELECT sum((x->>'credit_note_amount')::numeric) FROM jsonb_array_elements(j->'tra') x WHERE x->>'customer_id' = pg_temp.c('KF')::text) = 30000
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'hd') x WHERE x->>'customer_id' = pg_temp.c('KF')::text), '');
  PERFORM pg_temp.ghi('F4', 'nợ khách = 240.000 − 20.000 − 30.000 = 190.000 (không theo kỳ)', pg_temp.no_k('KF') = 190000, pg_temp.no_k('KF')::text);
  PERFORM pg_temp.bat_bien('F4', 'KF', ARRAY['PA', 'PB']);
  PERFORM pg_temp.chup('F4', 'KF');
END $t$;

-- ═════════════════════════════════ CHUỖI H (số lẻ + quy đổi) ═════════════════════════════════
DO $t$ DECLARE h uuid; r uuid; r2 uuid; t0 numeric := pg_temp.ton_k('PA'); BEGIN
  PERFORM pg_temp.lap_don('DH', 'KH', jsonb_build_array(
    jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 1.5, 'unit_price', 240000, 'line_total', 360000, 'conversion_factor', 24)));
  h := pg_temp.xuat('DH', jsonb_build_array(pg_temp.dd('DH', 'PA', 'Thung 24', 1.5)), pg_temp.hn());
  PERFORM pg_temp.ghi('H1', '1,5 thùng = 36 lon; HĐ 360.000', pg_temp.ton_k('PA') = t0 - 36 AND pg_temp.hd_c(h, 'total')::numeric = 360000,
    format('Δ %s', t0 - pg_temp.ton_k('PA')));
  r := pg_temp.tra('KH', h, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 0.5, 'unit_price', 240000)), true);
  PERFORM pg_temp.ghi('H2', 'trả 0,5 thùng = 12 lon, 120.000: nợ 240.000', pg_temp.ton_k('PA') = t0 - 24 AND pg_temp.no_k('KH') = 240000
    AND pg_temp.ret_c(r, 'credit_note_amount')::numeric = 120000, format('Δ %s nợ %s', t0 - pg_temp.ton_k('PA'), pg_temp.no_k('KH')));
  PERFORM pg_temp.bat_bien('H2', 'KH', ARRAY['PA']);
  -- H2b trả THÊM 2 thùng gắn cùng HĐ (vượt hàng đã mua — trần trả đã bỏ, mig 158) → nợ HĐ ÂM, không kẹp 0.
  r2 := pg_temp.tra('KH', h, jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('PA'), 'unit_name', 'Thung 24', 'quantity', 2, 'unit_price', 240000)), true);
  PERFORM pg_temp.ghi('H2b', 'HĐ 360.000 − 120.000 − 480.000 = −240.000 (công nợ âm trên HĐ, open)',
    pg_temp.ra(h) = -240000 AND pg_temp.rs(h) = 'open' AND pg_temp.no_k('KH') = -240000 AND pg_temp.ton_k('PA') = t0 + 24,
    format('HĐ %s %s nợ %s Δkho %s', pg_temp.ra(h), pg_temp.rs(h), pg_temp.no_k('KH'), pg_temp.ton_k('PA') - t0));
  PERFORM pg_temp.ghi('H2b', 'màn thu tiền: không thu được vào dòng HĐ âm', pg_temp.thu(format('SELECT pg_temp.thu_tien(%L, %L, 1000, %L)', 'KH', pg_temp.rec(h), 'lm-h-x')) LIKE 'BAD_RECEIVABLE_LINE%', '');
  PERFORM pg_temp.bat_bien('H2b', 'KH', ARRAY['PA']);
  PERFORM pg_temp.chup('H2b', 'KH');
  PERFORM pg_temp.vai('manager');
  PERFORM cancel_return(r2, 'đảo');
  PERFORM cancel_return(r, 'đảo');
  PERFORM pg_temp.vai('owner');
  PERFORM cancel_invoice(h, 'đảo');
  PERFORM pg_temp.ghi('H3', 'huỷ trả rồi huỷ HĐ: kho về đúng, nợ 0', pg_temp.ton_k('PA') = t0 AND pg_temp.no_k('KH') = 0,
    format('Δ %s nợ %s', t0 - pg_temp.ton_k('PA'), pg_temp.no_k('KH')));
  PERFORM pg_temp.bat_bien('H3', 'KH', ARRAY['PA']);
END $t$;

RESET ROLE;
\pset footer off
SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
\pset tuples_only on
\pset format unaligned
SELECT 'ANH|' || j::text FROM anh ORDER BY stt;
SELECT 'TONG|' || jsonb_build_object('tong', count(*), 'dat', count(*) FILTER (WHERE ok))::text FROM kq;
ROLLBACK;
