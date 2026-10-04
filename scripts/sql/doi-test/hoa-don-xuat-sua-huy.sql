-- ĐỘI TEST HOÁ ĐƠN — bộ chống lỗi lâu dài cho: xuất HĐ từ đơn (post_invoice), một đơn một HĐ,
-- trừ kho đúng lô / đơn vị cơ sở, công nợ theo HĐ (_wf2b_recompute_receivable), Sửa HĐ (reissue_invoice),
-- Huỷ HĐ (cancel_invoice = huỷ đơn, mig 217), hàng trả tự sinh, phiếu thu, xuất âm (mig 222/138),
-- quyền theo vai, giảm giá đơn, số lẻ, quy đổi đơn vị.
--
-- Luật đối chiếu: CLAUDE.md §1 (công nợ theo HĐ; một đơn một HĐ; huỷ HĐ = huỷ đơn; Sửa HĐ không huỷ đơn;
-- công nợ âm; phiếu tự sinh / tự lập; quyền qua RPC).
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_hoa_don -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/hoa-don-xuat-sua-huy.sql
-- Bọc BEGIN … ROLLBACK, không để lại dữ liệu. In bảng kq: 'ĐẠT' / 'LỖI' từng phép kiểm + tổng.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
GRANT USAGE ON SEQUENCE kq_stt_seq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

-- ───────────────────────── Tiện ích ─────────────────────────
CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.hn() RETURNS date LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), g) $f$;
-- Đọc như chủ máy (bỏ RLS) — để phép kiểm không phụ thuộc vai đang đóng.
CREATE FUNCTION pg_temp.so(q text) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS
  $f$ DECLARE r numeric; BEGIN EXECUTE q INTO r; RETURN r; END $f$;
CREATE FUNCTION pg_temp.chu(q text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS
  $f$ DECLARE r text; BEGIN EXECUTE q INTO r; RETURN r; END $f$;
-- Chạy thử một câu dưới vai hiện tại rồi LUÔN rollback; trả lỗi hoặc 'KHÔNG LỖI'.
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
CREATE FUNCTION pg_temp.lo(code text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT qty_on_hand FROM batches WHERE batch_code = code $f$;
CREATE FUNCTION pg_temp.hd(k text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT id FROM sales_invoices WHERE order_id = pg_temp.c(k) AND status = 'posted' $f$;
CREATE FUNCTION pg_temp.don(k text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT status FROM sales_orders WHERE id = pg_temp.c(k) $f$;
CREATE FUNCTION pg_temp.no_kh(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables
      WHERE customer_id = pg_temp.c(k || '.kh') AND status <> 'paid' $f$;
CREATE FUNCTION pg_temp.rc(k text, cot text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS
  $f$ DECLARE r text; BEGIN EXECUTE format('SELECT %I::text FROM receivables WHERE invoice_id = $1', cot) INTO r USING pg_temp.hd(k); RETURN r; END $f$;
CREATE FUNCTION pg_temp.hdc(k text, cot text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS
  $f$ DECLARE r text; BEGIN EXECUTE format('SELECT %I::text FROM sales_invoices WHERE id = $1', cot) INTO r USING pg_temp.hd(k); RETURN r; END $f$;
-- Dòng tải trọng lấy từ dòng đơn thứ i.
CREATE FUNCTION pg_temp.dl(k text, i int, sl numeric, vat numeric DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT jsonb_build_object('order_line_id', sol.id, 'product_id', sol.product_id, 'unit_name', sol.unit_name,
         'conversion_factor', sol.conversion_factor, 'quantity', sl, 'unit_price', sol.unit_price, 'vat_rate', vat)
  FROM sales_order_lines sol WHERE sol.id = pg_temp.c(k || '#' || i) $f$;
CREATE FUNCTION pg_temp.xuat(k text, dongs jsonb, them jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql AS $f$
  SELECT invoice_id FROM post_invoice(jsonb_build_object('order_id', pg_temp.c(k), 'lines', dongs,
         'invoice_date', pg_temp.hn()) || them) $f$;
-- Tạo đơn (siêu người dùng): mỗi đơn một khách riêng để công nợ không lẫn.
CREATE FUNCTION pg_temp.tao_don(k text, dongs jsonb, trang_thai text DEFAULT 'submitted') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_kh uuid; v_don uuid; v_dong uuid; d jsonb; i int := 0; v_tong numeric;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'Khách HD ' || k, 'Chị Thử', '08' || lpad((abs(hashtext(k)) % 100000000)::text, 8, '0'), 'Đường thử')
  RETURNING id INTO v_kh;
  SELECT COALESCE(sum((x->>'sl')::numeric * (x->>'gia')::numeric), 0) INTO v_tong FROM jsonb_array_elements(dongs) x;
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'DH-HD-' || k, v_kh, 'e0000000-0000-0000-0000-000000000004',
          pg_temp.hn() - 1, trang_thai, 'NET30', v_tong, 0, 0, v_tong)
  RETURNING id INTO v_don;
  FOR d IN SELECT * FROM jsonb_array_elements(dongs) LOOP
    i := i + 1;
    INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
    VALUES (v_don, (d->>'p')::uuid, d->>'u', (d->>'sl')::numeric, (d->>'gia')::numeric, 0,
            (d->>'sl')::numeric * (d->>'gia')::numeric, COALESCE((d->>'hs')::numeric, 1))
    RETURNING id INTO v_dong;
    INSERT INTO ctx VALUES (k || '#' || i, v_dong);
  END LOOP;
  INSERT INTO ctx VALUES (k, v_don), (k || '.kh', v_kh);
  RETURN v_don;
END $f$;

-- ───────────────────────── Dữ liệu ─────────────────────────
-- P1 = SNP-001 (lon; Loc 6, Thung 24); P2 = SNP-002 (lon); P5 = SNP-005 (lon, không đơn vị phụ).
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'HD-A', pg_temp.hn() + 200, 100, 100, 5000, 'sale', now() - interval '10 days'),
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'HD-B', pg_temp.hn() + 300, 1000, 1000, 6000, 'sale', now() - interval '5 days'),
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'HD-C', pg_temp.hn() + 300, 500, 500, 3000, 'sale', now() - interval '5 days'),
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'HD-D', pg_temp.hn() + 300, 10, 10, 1000, 'sale', now() - interval '5 days'),
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'HD-E', pg_temp.hn() + 20, 50, 50, 1000, 'date', now() - interval '5 days');

SELECT pg_temp.tao_don('X1', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"Thung 24","sl":2,"gia":240000,"hs":24},
                               {"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('X2', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":100,"gia":10000}]');
SELECT pg_temp.tao_don('X3', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":80,"gia":10000}]');
SELECT pg_temp.tao_don('X4', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"Loc 6","sl":2,"gia":55000,"hs":6}]');
SELECT pg_temp.tao_don('X5', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":30,"gia":10000}]');
SELECT pg_temp.tao_don('X6', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('X7', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('X8', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('X9', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":3,"gia":3333.33}]');
SELECT pg_temp.tao_don('X10', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":5,"gia":10000}]');
SELECT pg_temp.tao_don('X11', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":5,"gia":10000}]', 'draft');
SELECT pg_temp.tao_don('X12', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":5,"gia":10000}]');
SELECT pg_temp.tao_don('Q1', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":4,"gia":10000}]');
SELECT pg_temp.tao_don('Q2', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":4,"gia":10000}]');
SELECT pg_temp.tao_don('T1', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('T2', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":1,"gia":10000}]');
SELECT pg_temp.tao_don('T3', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('F1', '[{"p":"c0000000-0000-0000-0000-000000000005","u":"lon","sl":20,"gia":1000}]');
SELECT pg_temp.tao_don('F2', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10000,"gia":1000}]');

-- Phiếu trả lập KÈM ĐƠN T3 (nháp, chưa có HĐ) — 2 lon P2 × 5.000.
DO $d$ DECLARE v uuid; BEGIN
  INSERT INTO returns (org_id, order_id, customer_id, requested_by, status, reason)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('T3'), pg_temp.c('T3.kh'), 'e0000000-0000-0000-0000-000000000004', 'draft', 'damaged')
  RETURNING id INTO v;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  VALUES (v, 'c0000000-0000-0000-0000-000000000002', 'lon', 2, 5000, 0, 10000, false);
  INSERT INTO ctx VALUES ('T3.ret', v);
END $d$;

-- NPP khác + chủ NPP khác (để thử ORG_MISMATCH).
DO $d$ DECLARE v_org uuid; BEGIN
  INSERT INTO organizations (name, slug) VALUES ('NPP khác', 'npp-khac-hd') RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email) VALUES ('e9990000-0000-0000-0000-000000000001', 'khac-hd@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e9990000-0000-0000-0000-000000000001', v_org, 'Chủ khác', 'owner');
END $d$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');

-- ═════════════════════ A. XUẤT HÓA ĐƠN — đường xuôi + biên ═════════════════════
DO $t$ DECLARE r record; v_inv uuid; BEGIN
  -- Dòng thùng gửi hệ số 1 (tải trọng sai) — máy chủ phải tự tra hệ số 24 (mig 174).
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('X1'), 'invoice_date', pg_temp.hn(),
    'lines', jsonb_build_array(pg_temp.dl('X1', 1, 2) || '{"conversion_factor":1}', pg_temp.dl('X1', 2, 10))));
  v_inv := r.invoice_id;
  INSERT INTO ctx VALUES ('X1.hd0', v_inv);
  PERFORM pg_temp.ghi('A1', 'xuất đủ → đơn Hoàn thành, RPC trả completed', pg_temp.don('X1') = 'completed' AND r.order_status = 'completed',
    format('đơn %s, rpc %s', pg_temp.don('X1'), r.order_status));
  PERFORM pg_temp.ghi('A1', 'tiền HĐ = 2×240.000 + 10×10.000 = 580.000', pg_temp.hdc('X1', 'total')::numeric = 580000
      AND pg_temp.hdc('X1', 'subtotal')::numeric = 580000 AND pg_temp.hdc('X1', 'vat')::numeric = 0 AND pg_temp.hdc('X1', 'status') = 'posted',
    format('total %s subtotal %s vat %s', pg_temp.hdc('X1', 'total'), pg_temp.hdc('X1', 'subtotal'), pg_temp.hdc('X1', 'vat')));
  PERFORM pg_temp.ghi('A1', 'mã HĐ dạng HD-NNNN', r.invoice_code ~ '^HD-[0-9]{4,}$', r.invoice_code);
  PERFORM pg_temp.ghi('A1', 'trừ kho quy về đơn vị cơ sở: 2 thùng = 48 lon từ lô cũ nhất HD-A; P2 −10',
    pg_temp.lo('HD-A') = 52 AND pg_temp.lo('HD-B') = 1000 AND pg_temp.lo('HD-C') = 490,
    format('HD-A %s (52), HD-B %s (1000), HD-C %s (490)', pg_temp.lo('HD-A'), pg_temp.lo('HD-B'), pg_temp.lo('HD-C')));
  PERFORM pg_temp.ghi('A1', 'dòng HĐ chụp hệ số 24 do máy chủ tra, phiếu xuất 48 lon cơ sở',
    pg_temp.so(format('SELECT conversion_factor FROM sales_invoice_lines WHERE invoice_id = %L AND unit_name = %L', v_inv, 'Thung 24')) = 24
    AND pg_temp.so(format('SELECT sum(qty_in_base_uom) FROM stock_entry_lines WHERE entry_id = %L', r.entry_id)) = 58
    AND pg_temp.so(format('SELECT sum(slc.qty_in_base_uom) FROM stock_line_consumptions slc JOIN stock_entry_lines sel ON sel.id = slc.line_id WHERE sel.entry_id = %L', r.entry_id)) = 58,
    'hệ số ' || pg_temp.so(format('SELECT conversion_factor FROM sales_invoice_lines WHERE invoice_id = %L AND unit_name = %L', v_inv, 'Thung 24')));
  PERFORM pg_temp.ghi('A1', 'công nợ: MỘT phiếu theo HĐ, 580.000, chưa thu, open, hạn = ngày HĐ + 30',
    pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L', v_inv)) = 1
    AND pg_temp.rc('X1', 'amount')::numeric = 580000 AND pg_temp.rc('X1', 'paid')::numeric = 0 AND pg_temp.rc('X1', 'status') = 'open'
    AND pg_temp.rc('X1', 'due_date')::date = pg_temp.hn() + 30
    AND pg_temp.rc('X1', 'id')::uuid = r.receivable_id AND pg_temp.rc('X1', 'customer_id')::uuid = pg_temp.c('X1.kh'),
    format('amount %s paid %s status %s due %s', pg_temp.rc('X1', 'amount'), pg_temp.rc('X1', 'paid'), pg_temp.rc('X1', 'status'), pg_temp.rc('X1', 'due_date')));
  PERFORM pg_temp.ghi('A1', 'dòng đơn ghi đã xuất 2 / 10',
    pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X1#1'))) = 2
    AND pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X1#2'))) = 10, '');
  PERFORM pg_temp.ghi('A1', 'nhật ký đơn có invoice_posted', pg_temp.so(format(
    'SELECT count(*) FROM order_activity_log WHERE order_id = %L AND action = %L', pg_temp.c('X1'), 'invoice_posted')) = 1, '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A1', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A2 Gửi hai lần / HĐ thứ hai cho cùng đơn → chặn, kho không đổi
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X1'), 'lines', jsonb_build_array(pg_temp.dl('X1', 2, 1)))));
  PERFORM pg_temp.ghi('A2', 'xuất lần hai cùng đơn bị chặn ORDER_NOT_INVOICEABLE', e LIKE 'ORDER_NOT_INVOICEABLE%', left(e, 80));
  PERFORM pg_temp.ghi('A2', 'vẫn đúng 1 HĐ ghi sổ, kho không đổi',
    pg_temp.so(format('SELECT count(*) FROM sales_invoices WHERE order_id = %L AND status = %L', pg_temp.c('X1'), 'posted')) = 1
    AND pg_temp.lo('HD-C') = 490, '');
END $t$;
RESET ROLE;
-- A3 Lách RPC chèn HĐ thứ hai → chỉ mục một đơn một HĐ chặn
DO $t$ BEGIN
  BEGIN
    INSERT INTO sales_invoices (org_id, invoice_code, invoice_seq, reissue_no, order_id, customer_id, invoice_date, status, subtotal, vat, total)
    SELECT org_id, 'HD-LACH', 99999, 0, order_id, customer_id, invoice_date, 'posted', 0, 0, 0 FROM sales_invoices WHERE id = pg_temp.hd('X1');
    PERFORM pg_temp.ghi('A3', 'chỉ mục uq_sales_invoices_mot_don_mot_hd chặn HĐ thứ hai', false, 'LỌT');
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.ghi('A3', 'chỉ mục uq_sales_invoices_mot_don_mot_hd chặn HĐ thứ hai', SQLERRM LIKE '%uq_sales_invoices_mot_don_mot_hd%', left(SQLERRM, 80));
  END;
END $t$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');

-- A4 Xuất THIẾU 60/100 → vẫn Hoàn thành
DO $t$ BEGIN
  PERFORM pg_temp.xuat('X2', jsonb_build_array(pg_temp.dl('X2', 1, 60)));
  PERFORM pg_temp.ghi('A4', 'xuất thiếu 60/100 → Hoàn thành, không treo đơn', pg_temp.don('X2') = 'completed', pg_temp.don('X2'));
  PERFORM pg_temp.ghi('A4', 'tiền 600.000, nợ 600.000, kho P2 490→430, đã xuất 60',
    pg_temp.hdc('X2', 'total')::numeric = 600000 AND pg_temp.rc('X2', 'amount')::numeric = 600000 AND pg_temp.lo('HD-C') = 430
    AND pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X2#1'))) = 60,
    format('total %s nợ %s HD-C %s', pg_temp.hdc('X2', 'total'), pg_temp.rc('X2', 'amount'), pg_temp.lo('HD-C')));
  PERFORM pg_temp.ghi('A4', 'đơn đã Hoàn thành không xuất nốt 40 được', pg_temp.thu(format('SELECT post_invoice(%L::jsonb)',
    jsonb_build_object('order_id', pg_temp.c('X2'), 'lines', jsonb_build_array(pg_temp.dl('X2', 1, 40))))) LIKE 'ORDER_NOT_INVOICEABLE%', '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A4', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A5 FIFO qua hai lô: 80 lon P1 khi HD-A còn 52 → 52 từ A + 28 từ B; giá vốn bình quân
DO $t$ DECLARE r record; BEGIN
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('X3'), 'invoice_date', pg_temp.hn(), 'lines', jsonb_build_array(pg_temp.dl('X3', 1, 80))));
  PERFORM pg_temp.ghi('A5', 'FIFO: HD-A 52→0, HD-B 1000→972', pg_temp.lo('HD-A') = 0 AND pg_temp.lo('HD-B') = 972,
    format('HD-A %s HD-B %s', pg_temp.lo('HD-A'), pg_temp.lo('HD-B')));
  PERFORM pg_temp.ghi('A5', 'dấu vết 2 lượt lấy (52, 28) và giá vốn dòng = (52×5000+28×6000)/80 = 5350',
    pg_temp.chu(format('SELECT string_agg(round(slc.qty_in_base_uom, 2)::numeric(12,0)::text, %L ORDER BY slc.qty_in_base_uom DESC) FROM stock_line_consumptions slc JOIN stock_entry_lines sel ON sel.id = slc.line_id WHERE sel.entry_id = %L', ',', r.entry_id)) = '52,28'
    AND pg_temp.so(format('SELECT unit_cost FROM stock_entry_lines WHERE entry_id = %L', r.entry_id)) = 5350,
    pg_temp.chu(format('SELECT string_agg(slc.qty_in_base_uom::text, %L) FROM stock_line_consumptions slc JOIN stock_entry_lines sel ON sel.id = slc.line_id WHERE sel.entry_id = %L', ',', r.entry_id))
    || ' · giá vốn ' || pg_temp.so(format('SELECT unit_cost FROM stock_entry_lines WHERE entry_id = %L', r.entry_id)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A5', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A6 Số lẻ + đơn vị trung gian: 1,5 lốc (×6) = 9 lon
DO $t$ BEGIN
  PERFORM pg_temp.xuat('X4', jsonb_build_array(pg_temp.dl('X4', 1, 1.5)));
  PERFORM pg_temp.ghi('A6', '1,5 lốc → trừ 9 lon cơ sở (HD-B 972→963)', pg_temp.lo('HD-B') = 963, 'HD-B ' || pg_temp.lo('HD-B'));
  PERFORM pg_temp.ghi('A6', 'tiền = 1,5 × 55.000 = 82.500; nợ 82.500', pg_temp.hdc('X4', 'total')::numeric = 82500 AND pg_temp.rc('X4', 'amount')::numeric = 82500,
    pg_temp.hdc('X4', 'total'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A6', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A7..A9 Giảm giá đơn + thuế + kẹp
DO $t$ BEGIN
  PERFORM pg_temp.xuat('X5', jsonb_build_array(pg_temp.dl('X5', 1, 30, 0.1)), '{"discount":50000}');
  PERFORM pg_temp.ghi('A7', 'giảm 50.000 trên 300.000, thuế 10% trên giá dòng: subtotal 250.000, vat 30.000, total 280.000, nợ 280.000',
    pg_temp.hdc('X5', 'subtotal')::numeric = 250000 AND pg_temp.hdc('X5', 'vat')::numeric = 30000 AND pg_temp.hdc('X5', 'total')::numeric = 280000
    AND pg_temp.rc('X5', 'amount')::numeric = 280000,
    format('%s / %s / %s / nợ %s', pg_temp.hdc('X5', 'subtotal'), pg_temp.hdc('X5', 'vat'), pg_temp.hdc('X5', 'total'), pg_temp.rc('X5', 'amount')));
  PERFORM pg_temp.xuat('X6', jsonb_build_array(pg_temp.dl('X6', 1, 10)), '{"discount":999999}');
  PERFORM pg_temp.ghi('A8', 'giảm vượt tiền hàng bị kẹp: total 0, nợ 0 (paid)',
    pg_temp.hdc('X6', 'total')::numeric = 0 AND pg_temp.hdc('X6', 'subtotal')::numeric = 0 AND pg_temp.rc('X6', 'amount')::numeric = 0
    AND pg_temp.rc('X6', 'status') = 'paid', format('total %s nợ %s %s', pg_temp.hdc('X6', 'total'), pg_temp.rc('X6', 'amount'), pg_temp.rc('X6', 'status')));
  PERFORM pg_temp.xuat('X7', jsonb_build_array(pg_temp.dl('X7', 1, 10)), '{"discount":-5000}');
  PERFORM pg_temp.xuat('X8', jsonb_build_array(pg_temp.dl('X8', 1, 10)), '{"discount":"abc"}');
  PERFORM pg_temp.ghi('A9', 'giảm âm / chữ → 0: total 100.000',
    pg_temp.hdc('X7', 'total')::numeric = 100000 AND pg_temp.hdc('X8', 'total')::numeric = 100000,
    format('X7 %s X8 %s', pg_temp.hdc('X7', 'total'), pg_temp.hdc('X8', 'total')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A7', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A10 Làm tròn ở tổng
DO $t$ BEGIN
  PERFORM pg_temp.xuat('X9', jsonb_build_array(pg_temp.dl('X9', 1, 3)));
  PERFORM pg_temp.ghi('A10', '3 × 3.333,33 = 9.999,99 → total làm tròn 10.000; dòng giữ 9.999,99',
    pg_temp.hdc('X9', 'total')::numeric = 10000
    AND pg_temp.so(format('SELECT line_total FROM sales_invoice_lines WHERE invoice_id = %L', pg_temp.hd('X9'))) = 9999.99,
    pg_temp.hdc('X9', 'total'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A10', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A11 Không dòng / SL 0 / SL âm → NO_LINES; A12 dòng lạ → BAD_LINE
DO $t$ DECLARE e1 text; e2 text; e3 text; e4 text; e5 text; BEGIN
  e1 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X10'), 'lines', '[]'::jsonb)));
  e2 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X10'), 'lines', jsonb_build_array(pg_temp.dl('X10', 1, 0)))));
  e3 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X10'), 'lines', jsonb_build_array(pg_temp.dl('X10', 1, -3)))));
  PERFORM pg_temp.ghi('A11', 'rỗng / SL 0 / SL âm đều NO_LINES', e1 LIKE 'NO_LINES%' AND e2 LIKE 'NO_LINES%' AND e3 LIKE 'NO_LINES%',
    left(e1, 20) || ' | ' || left(e2, 20) || ' | ' || left(e3, 20));
  e4 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X10'), 'lines', jsonb_build_array(pg_temp.dl('X1', 2, 1)))));
  e5 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X10'),
          'lines', jsonb_build_array(pg_temp.dl('X10', 1, 1) || '{"product_id":"c0000000-0000-0000-0000-000000000001"}'))));
  PERFORM pg_temp.ghi('A12', 'dòng của đơn khác / sai sản phẩm → BAD_LINE', e4 LIKE 'BAD_LINE%' AND e5 LIKE 'BAD_LINE%', left(e4, 30) || ' | ' || left(e5, 30));
  PERFORM pg_temp.ghi('A12', 'các lần bị chặn không đổi đơn / kho', pg_temp.don('X10') = 'submitted' AND pg_temp.lo('HD-C') = 430 - 30 - 10 - 10 - 10 - 3,
    format('đơn %s HD-C %s', pg_temp.don('X10'), pg_temp.lo('HD-C')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A11', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A13 Ngày HĐ + điều khoản tuỳ chọn → hạn nợ
DO $t$ BEGIN
  PERFORM post_invoice(jsonb_build_object('order_id', pg_temp.c('X10'), 'invoice_date', '2026-09-30', 'payment_terms', 'NET7',
    'lines', jsonb_build_array(pg_temp.dl('X10', 1, 5))));
  PERFORM pg_temp.ghi('A13', 'ngày HĐ 30/09 + NET7 → hạn HĐ và hạn công nợ 07/10',
    pg_temp.hdc('X10', 'invoice_date') = '2026-09-30' AND pg_temp.hdc('X10', 'due_date') = '2026-10-07'
    AND pg_temp.rc('X10', 'due_date') = '2026-10-07' AND pg_temp.hdc('X10', 'payment_terms') = 'NET7',
    format('ngày %s hạn %s hạn nợ %s', pg_temp.hdc('X10', 'invoice_date'), pg_temp.hdc('X10', 'due_date'), pg_temp.rc('X10', 'due_date')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A13', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- A14 Đơn nháp / đơn không tồn tại
DO $t$ DECLARE e1 text; e2 text; BEGIN
  e1 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('X11'), 'lines', jsonb_build_array(pg_temp.dl('X11', 1, 5)))));
  e2 := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', gen_random_uuid(), 'lines', jsonb_build_array(pg_temp.dl('X11', 1, 5)))));
  PERFORM pg_temp.ghi('A14', 'đơn Nháp không xuất được; đơn không có → ORDER_NOT_FOUND', e1 LIKE 'ORDER_NOT_INVOICEABLE%' AND e2 LIKE 'ORDER_NOT_FOUND%',
    left(e1, 40) || ' | ' || e2);
END $t$;

-- A15 Dòng hàng ngoài đơn (không order_line_id) đi cùng
DO $t$ BEGIN
  PERFORM pg_temp.xuat('X12', jsonb_build_array(pg_temp.dl('X12', 1, 5),
    jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000005', 'unit_name', 'lon', 'quantity', 2, 'unit_price', 7000, 'vat_rate', 0)));
  PERFORM pg_temp.ghi('A15', 'thêm 2 lon P5 ngoài đơn: total 64.000, kho P5 10→8',
    pg_temp.hdc('X12', 'total')::numeric = 64000 AND pg_temp.lo('HD-D') = 8 AND pg_temp.rc('X12', 'amount')::numeric = 64000,
    format('total %s HD-D %s', pg_temp.hdc('X12', 'total'), pg_temp.lo('HD-D')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A15', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ B. QUYỀN ═════════════════════
DO $t$ DECLARE e text; v text; q text; BEGIN
  q := format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('Q1'), 'invoice_date', pg_temp.hn(), 'lines', jsonb_build_array(pg_temp.dl('Q1', 1, 4))));
  FOREACH v IN ARRAY ARRAY['sales', 'warehouse', 'accountant'] LOOP
    PERFORM pg_temp.vai(v);
    e := pg_temp.thu(q);
    PERFORM pg_temp.ghi('B1', v || ' không xuất HĐ được (FORBIDDEN)', e LIKE 'FORBIDDEN%', left(e, 60));
  END LOOP;
  PERFORM pg_temp.vai('e9990000-0000-0000-0000-000000000001');
  e := pg_temp.thu(q);
  PERFORM pg_temp.ghi('B1', 'chủ NPP khác → ORG_MISMATCH', e LIKE 'ORG_MISMATCH%', e);
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('X2'), 'thử'));
  PERFORM pg_temp.ghi('B1', 'chủ NPP khác huỷ HĐ → ORG_MISMATCH', e LIKE 'ORG_MISMATCH%', e);
  PERFORM pg_temp.ghi('B1', 'sau các lần bị chặn: đơn Q1 vẫn Gửi, chưa có HĐ', pg_temp.don('Q1') = 'submitted' AND pg_temp.hd('Q1') IS NULL, pg_temp.don('Q1'));
  PERFORM pg_temp.vai('manager');
  PERFORM pg_temp.xuat('Q1', jsonb_build_array(pg_temp.dl('Q1', 1, 4)));
  PERFORM pg_temp.ghi('B2', 'quản lý xuất HĐ được; posted_by = quản lý',
    pg_temp.don('Q1') = 'completed' AND pg_temp.hdc('Q1', 'posted_by') = 'e0000000-0000-0000-0000-000000000002', pg_temp.hdc('Q1', 'posted_by'));
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('Q1'), 'thử'));
  PERFORM pg_temp.ghi('B3', 'NVBH không huỷ HĐ được', e LIKE 'FORBIDDEN%', left(e, 60));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', pg_temp.hd('Q1'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('Q1', 1, 1)))));
  PERFORM pg_temp.ghi('B3', 'NVBH không sửa HĐ được', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('Q1'), 'thử'));
  PERFORM pg_temp.ghi('B3', 'thủ kho không huỷ HĐ được', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('B3', 'HĐ Q1 vẫn ghi sổ, nợ 40.000', pg_temp.hdc('Q1', 'status') = 'posted' AND pg_temp.rc('Q1', 'amount')::numeric = 40000, '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
SELECT pg_temp.vai('owner');

-- B4 Override quyền đúng NPP: tước orders.approve của quản lý → bị chặn; cấp cho NVBH → được
RESET ROLE;
INSERT INTO user_permission_overrides (user_id, permission_key, granted, org_id) VALUES
 ('e0000000-0000-0000-0000-000000000002', 'orders.approve', false, 'a0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-000000000004', 'orders.approve', true, 'a0000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
DO $t$ DECLARE e text; q text; BEGIN
  q := format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('Q2'), 'invoice_date', pg_temp.hn(), 'lines', jsonb_build_array(pg_temp.dl('Q2', 1, 4))));
  PERFORM pg_temp.vai('manager');
  e := pg_temp.thu(q);
  PERFORM pg_temp.ghi('B4', 'quản lý bị tước quyền xuất → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 50));
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(q);
  PERFORM pg_temp.ghi('B4', 'NVBH được cấp riêng quyền xuất → xuất được', e = 'KHÔNG LỖI', left(e, 80));
  PERFORM pg_temp.vai('owner');
END $t$;
RESET ROLE;
DELETE FROM user_permission_overrides WHERE org_id = 'a0000000-0000-0000-0000-000000000001' AND permission_key = 'orders.approve';
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');

-- B5 Không ghi thẳng tiền / trạng thái / công nợ từ trình duyệt (mig 214)
DO $t$ DECLARE e text; n int; BEGIN
  BEGIN
    UPDATE sales_invoices SET status = 'cancelled' WHERE id = pg_temp.hd('X2');
    GET DIAGNOSTICS n = ROW_COUNT;
    e := 'ghi được ' || n || ' dòng';
  EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  PERFORM pg_temp.ghi('B5', 'chủ NPP UPDATE thẳng trạng thái HĐ không ăn', pg_temp.hdc('X2', 'status') = 'posted', e);
  e := pg_temp.thu(format('UPDATE receivables SET amount = 1 WHERE invoice_id = %L', pg_temp.hd('X2')));
  PERFORM pg_temp.ghi('B5', 'UPDATE thẳng số nợ → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.thu(format('UPDATE receivables SET paid = 600000 WHERE invoice_id = %L', pg_temp.hd('X2')));
  PERFORM pg_temp.ghi('B5', 'UPDATE thẳng số đã thu → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.thu(format('INSERT INTO receivables (org_id, customer_id, invoice_id, amount, paid, status) VALUES (%L, %L, %L, 5, 0, %L)',
        'a0000000-0000-0000-0000-000000000001', pg_temp.c('X2.kh'), pg_temp.hd('X2'), 'open'));
  PERFORM pg_temp.ghi('B5', 'INSERT công nợ theo HĐ từ trình duyệt → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.thu(format('SELECT _wf2b_recompute_receivable(%L)', pg_temp.hd('X2')));
  PERFORM pg_temp.ghi('B5', 'hàm nội bộ _wf2b_recompute_receivable không gọi được từ trình duyệt', e LIKE '%permission denied%', left(e, 60));
  e := pg_temp.thu(format('SELECT _huy_don_theo_hoa_don(%L, %L, %L, %L)', pg_temp.c('X2'), 'x', 'x', 'submitted'));
  PERFORM pg_temp.ghi('B5', 'hàm nội bộ _huy_don_theo_hoa_don không gọi được từ trình duyệt', e LIKE '%permission denied%', left(e, 60));
  e := pg_temp.thu(format('UPDATE sales_orders SET status = %L WHERE id = %L', 'cancelled', pg_temp.c('X2')));
  PERFORM pg_temp.ghi('B5', 'UPDATE thẳng trạng thái đơn bị chặn hoặc không ăn', e <> 'KHÔNG LỖI' OR pg_temp.don('X2') = 'completed', left(e, 60));
END $t$;

-- ═════════════════════ C. HÀNG ĐỔI TRẢ KHI XUẤT (phiếu tự sinh) ═════════════════════
DO $t$ DECLARE v_ret uuid; BEGIN
  PERFORM pg_temp.xuat('T1', jsonb_build_array(pg_temp.dl('T1', 1, 10)), jsonb_build_object('return_adds', jsonb_build_array(
    jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 3, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false),
    jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 2, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', true))));
  SELECT id INTO v_ret FROM returns WHERE order_id = pg_temp.c('T1');
  INSERT INTO ctx VALUES ('T1.ret', v_ret);
  PERFORM pg_temp.ghi('C1', 'đúng MỘT phiếu tự sinh, Chờ xử lý, bám HĐ, 2 dòng',
    pg_temp.so(format('SELECT count(*) FROM returns WHERE order_id = %L', pg_temp.c('T1'))) = 1
    AND pg_temp.chu(format('SELECT status || %L || credit_with_invoice || %L || (invoice_id = %L) FROM returns WHERE id = %L', '/', '/', pg_temp.hd('T1'), v_ret)) = 'submitted/true/true'
    AND pg_temp.so(format('SELECT count(*) FROM return_lines WHERE return_id = %L', v_ret)) = 2,
    pg_temp.chu(format('SELECT status || %L || credit_with_invoice FROM returns WHERE id = %L', '/', v_ret)));
  PERFORM pg_temp.ghi('C1', 'tiền phiếu = 3×5.000 (hàng đổi không tính) = 15.000; nợ HĐ = 100.000 − 15.000 = 85.000 ngay lúc xuất',
    pg_temp.so(format('SELECT credit_note_amount FROM returns WHERE id = %L', v_ret)) = 15000 AND pg_temp.rc('T1', 'amount')::numeric = 85000
    AND pg_temp.no_kh('T1') = 85000,
    format('phiếu %s nợ %s', pg_temp.so(format('SELECT credit_note_amount FROM returns WHERE id = %L', v_ret)), pg_temp.rc('T1', 'amount')));
  PERFORM pg_temp.ghi('C1', 'phiếu tự sinh trừ doanh số vào NGÀY HĐ (revenue_date)',
    pg_temp.chu(format('SELECT revenue_date::text FROM returns WHERE id = %L', v_ret)) = pg_temp.hdc('T1', 'invoice_date'),
    pg_temp.chu(format('SELECT revenue_date::text FROM returns WHERE id = %L', v_ret)));
  PERFORM pg_temp.ghi('C2', 'huỷ phiếu tự sinh Chờ xử lý bằng RPC → RETURN_FOLLOWS_INVOICE',
    pg_temp.thu(format('SELECT cancel_return(%L, %L)', v_ret, 'thử')) LIKE 'RETURN_FOLLOWS_INVOICE%', '');
  PERFORM pg_temp.ghi('C2', 'sửa thẳng tiền phiếu tự sinh → bị chặn',
    pg_temp.thu(format('UPDATE returns SET credit_note_amount = 0 WHERE id = %L', v_ret)) <> 'KHÔNG LỖI', '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C1', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- C3 Trả nhiều hơn mua → công nợ ÂM, vẫn open
DO $t$ BEGIN
  PERFORM pg_temp.xuat('T2', jsonb_build_array(pg_temp.dl('T2', 1, 1)), jsonb_build_object('return_adds', jsonb_build_array(
    jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 5, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false))));
  PERFORM pg_temp.ghi('C3', 'mua 10.000 trả 25.000 → nợ −15.000, open (không kẹp 0)',
    pg_temp.rc('T2', 'amount')::numeric = -15000 AND pg_temp.rc('T2', 'status') = 'open' AND pg_temp.no_kh('T2') = -15000,
    format('nợ %s %s', pg_temp.rc('T2', 'amount'), pg_temp.rc('T2', 'status')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C3', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- C4 Phiếu trả nháp KÈM ĐƠN + thêm hàng trả lúc xuất → gộp một phiếu, tự sinh
DO $t$ BEGIN
  PERFORM pg_temp.xuat('T3', jsonb_build_array(pg_temp.dl('T3', 1, 10)), jsonb_build_object('return_adds', jsonb_build_array(
    jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false))));
  PERFORM pg_temp.ghi('C4', 'phiếu nháp kèm đơn thành tự sinh Chờ xử lý, gộp dòng thêm (1 phiếu, 2 dòng, 15.000)',
    pg_temp.so(format('SELECT count(*) FROM returns WHERE order_id = %L', pg_temp.c('T3'))) = 1
    AND pg_temp.chu(format('SELECT status || %L || credit_with_invoice FROM returns WHERE id = %L', '/', pg_temp.c('T3.ret'))) = 'submitted/true'
    AND pg_temp.so(format('SELECT count(*) FROM return_lines WHERE return_id = %L', pg_temp.c('T3.ret'))) = 2
    AND pg_temp.so(format('SELECT credit_note_amount FROM returns WHERE id = %L', pg_temp.c('T3.ret'))) = 15000,
    pg_temp.chu(format('SELECT status || %L || credit_note_amount FROM returns WHERE id = %L', '/', pg_temp.c('T3.ret'))));
  PERFORM pg_temp.ghi('C4', 'nợ HĐ = 100.000 − 15.000 = 85.000', pg_temp.rc('T3', 'amount')::numeric = 85000, pg_temp.rc('T3', 'amount'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C4', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ D. PHIẾU THU + SỬA HĐ (reissue_invoice) ═════════════════════
DO $t$ DECLARE h0 uuid := pg_temp.hd('X1'); m numeric; e text; r record; c0 text; BEGIN
  c0 := pg_temp.hdc('X1', 'invoice_code');
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c('X1.kh'), 'client_key', 'hd-doi-x1',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rc('X1', 'id'), 'amount', 30000))));
  PERFORM pg_temp.ghi('D1', 'thu 30.000 → paid 30.000, partial, nợ khách 550.000',
    pg_temp.rc('X1', 'paid')::numeric = 30000 AND pg_temp.rc('X1', 'status') = 'partial' AND pg_temp.no_kh('X1') = 550000,
    format('paid %s %s nợ %s', pg_temp.rc('X1', 'paid'), pg_temp.rc('X1', 'status'), pg_temp.no_kh('X1')));
  m := pg_temp.so($q$SELECT sum(qty_on_hand) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale'$q$);
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h0, 'thử'));
  PERFORM pg_temp.ghi('D2', 'HĐ đã thu tiền: huỷ bị chặn LOCKED_HAS_PAYMENT, đơn giữ Hoàn thành', e LIKE 'LOCKED_HAS_PAYMENT%' AND pg_temp.don('X1') = 'completed', left(e, 50));
  -- Sửa HĐ: còn 1 thùng + 10 lon = 340.000
  SELECT * INTO r FROM reissue_invoice(h0, jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X1', 1, 1), pg_temp.dl('X1', 2, 10))));
  INSERT INTO ctx VALUES ('X1.hd1', r.invoice_id);
  PERFORM pg_temp.ghi('D3', 'Sửa HĐ KHÔNG huỷ đơn: đơn Hoàn thành, không ghi nhật ký cancel_after_complete',
    pg_temp.don('X1') = 'completed' AND r.order_status = 'completed'
    AND pg_temp.so(format('SELECT count(*) FROM order_activity_log WHERE order_id = %L AND action = %L', pg_temp.c('X1'), 'cancel_after_complete')) = 0,
    pg_temp.don('X1'));
  PERFORM pg_temp.ghi('D3', 'tờ cũ Đã huỷ + replaced_by; tờ mới mã ' || c0 || '-1 + replaced_from',
    pg_temp.chu(format('SELECT status FROM sales_invoices WHERE id = %L', h0)) = 'cancelled'
    AND pg_temp.chu(format('SELECT replaced_by::text FROM sales_invoices WHERE id = %L', h0)) = r.invoice_id::text
    AND pg_temp.hdc('X1', 'replaced_from') = h0::text AND r.invoice_code = c0 || '-1' AND pg_temp.hd('X1') = r.invoice_id,
    r.invoice_code);
  PERFORM pg_temp.ghi('D3', 'tờ mới 340.000; tiền thu chuyển sang: nợ 340.000, paid 30.000, partial; công nợ tờ cũ xoá',
    pg_temp.hdc('X1', 'total')::numeric = 340000 AND pg_temp.rc('X1', 'amount')::numeric = 340000 AND pg_temp.rc('X1', 'paid')::numeric = 30000
    AND pg_temp.rc('X1', 'status') = 'partial' AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L', h0)) = 0
    AND pg_temp.no_kh('X1') = 310000,
    format('total %s nợ %s paid %s %s; nợ khách %s', pg_temp.hdc('X1', 'total'), pg_temp.rc('X1', 'amount'), pg_temp.rc('X1', 'paid'), pg_temp.rc('X1', 'status'), pg_temp.no_kh('X1')));
  PERFORM pg_temp.ghi('D3', 'dòng phiếu thu + payment trỏ sang tờ / công nợ mới',
    pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines crl JOIN cash_receipts cr ON cr.id = crl.receipt_id WHERE cr.client_key = %L AND crl.invoice_id = %L AND crl.receivable_id = %L',
      'hd-doi-x1', r.invoice_id, pg_temp.rc('X1', 'id'))) = 1
    AND pg_temp.so(format('SELECT sum(amount) FROM payments WHERE receivable_id = %L', pg_temp.rc('X1', 'id'))) = 30000, '');
  PERFORM pg_temp.ghi('D3', 'kho P1: hoàn 48 lon rồi xuất lại 24 → tồn bán +24; ngày HĐ giữ nguyên',
    pg_temp.so($q$SELECT sum(qty_on_hand) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale'$q$) = m + 24
    AND pg_temp.hdc('X1', 'invoice_date') = pg_temp.chu(format('SELECT invoice_date::text FROM sales_invoices WHERE id = %L', h0)),
    format('trước %s sau %s', m, pg_temp.so($q$SELECT sum(qty_on_hand) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale'$q$)));
  PERFORM pg_temp.ghi('D3', 'dòng đơn: đã xuất 1 thùng (tờ cũ nhả móc nối)',
    pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X1#1'))) = 1,
    pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X1#1')))::text);
  -- Sửa lần hai: chỉ còn 1 lon P2 → tổng 10.000 < đã thu 30.000 → dư có 20.000
  SELECT * INTO r FROM reissue_invoice(r.invoice_id, jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X1', 2, 1))));
  PERFORM pg_temp.ghi('D4', 'sửa lần hai: mã ' || c0 || '-2, chuỗi replaced_from đúng',
    r.invoice_code = c0 || '-2' AND pg_temp.hdc('X1', 'replaced_from') = pg_temp.c('X1.hd1')::text, r.invoice_code);
  PERFORM pg_temp.ghi('D4', 'tổng 10.000 < đã thu 30.000 → open (dư có), nợ khách −20.000',
    pg_temp.rc('X1', 'amount')::numeric = 10000 AND pg_temp.rc('X1', 'paid')::numeric = 30000 AND pg_temp.rc('X1', 'status') = 'open'
    AND pg_temp.no_kh('X1') = -20000,
    format('nợ %s paid %s %s; khách %s', pg_temp.rc('X1', 'amount'), pg_temp.rc('X1', 'paid'), pg_temp.rc('X1', 'status'), pg_temp.no_kh('X1')));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h0, jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X1', 2, 1)))));
  PERFORM pg_temp.ghi('D5', 'sửa tờ đã huỷ → INVOICE_NOT_POSTED', e LIKE 'INVOICE_NOT_POSTED%', left(e, 50));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', pg_temp.hd('X1'), '{"lines":[]}'));
  PERFORM pg_temp.ghi('D5', 'sửa HĐ thành rỗng → NO_LINES, tờ hiện tại vẫn ghi sổ', e LIKE 'NO_LINES%' AND pg_temp.hdc('X1', 'status') = 'posted', left(e, 50));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- D6 Sửa HĐ GIỮ giảm giá khi tải trọng không gửi khoá discount; gửi 0 = bỏ giảm
DO $t$ BEGIN
  PERFORM reissue_invoice(pg_temp.hd('X5'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X5', 1, 30, 0.1))));
  PERFORM pg_temp.ghi('D6', 'vắng discount → giữ giảm 50.000: total 280.000',
    pg_temp.hdc('X5', 'subtotal')::numeric = 250000 AND pg_temp.hdc('X5', 'total')::numeric = 280000 AND pg_temp.rc('X5', 'amount')::numeric = 280000,
    pg_temp.hdc('X5', 'total'));
  PERFORM reissue_invoice(pg_temp.hd('X5'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X5', 1, 30, 0.1)), 'discount', 0));
  PERFORM pg_temp.ghi('D6', 'discount 0 → bỏ giảm: total 330.000', pg_temp.hdc('X5', 'total')::numeric = 330000 AND pg_temp.rc('X5', 'amount')::numeric = 330000,
    pg_temp.hdc('X5', 'total'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D6', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- D7 Sửa HĐ GIỮ ngày + điều khoản tờ cũ
DO $t$ BEGIN
  PERFORM reissue_invoice(pg_temp.hd('X10'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X10', 1, 4))));
  PERFORM pg_temp.ghi('D7', 'giữ ngày 30/09, NET7, hạn 07/10; nợ 40.000',
    pg_temp.hdc('X10', 'invoice_date') = '2026-09-30' AND pg_temp.hdc('X10', 'payment_terms') = 'NET7' AND pg_temp.rc('X10', 'due_date') = '2026-10-07'
    AND pg_temp.rc('X10', 'amount')::numeric = 40000,
    format('%s %s %s', pg_temp.hdc('X10', 'invoice_date'), pg_temp.hdc('X10', 'payment_terms'), pg_temp.rc('X10', 'due_date')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D7', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- D8 Sửa HĐ có phiếu tự sinh Chờ xử lý: phiếu theo tờ mới, vẫn trừ nợ
DO $t$ BEGIN
  PERFORM reissue_invoice(pg_temp.hd('T1'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('T1', 1, 8))));
  PERFORM pg_temp.ghi('D8', 'phiếu tự sinh bám tờ mới, Chờ xử lý; nợ = 80.000 − 15.000 = 65.000; đơn Hoàn thành',
    pg_temp.chu(format('SELECT status || %L || (invoice_id = %L) FROM returns WHERE id = %L', '/', pg_temp.hd('T1'), pg_temp.c('T1.ret'))) = 'submitted/true'
    AND pg_temp.rc('T1', 'amount')::numeric = 65000 AND pg_temp.don('T1') = 'completed',
    format('phiếu %s nợ %s đơn %s', pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('T1.ret'))), pg_temp.rc('T1', 'amount'), pg_temp.don('T1')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D8', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ E. HUỶ HĐ = HUỶ ĐƠN ═════════════════════
DO $t$ DECLARE e1 text; e2 text; e3 text; BEGIN
  e1 := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('X3'), ''));
  e2 := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('X3'), '   '));
  e3 := pg_temp.thu(format('SELECT cancel_invoice(%L, NULL)', pg_temp.hd('X3')));
  PERFORM pg_temp.ghi('E1', 'huỷ không lý do / khoảng trắng / NULL → REASON_REQUIRED',
    e1 LIKE 'REASON_REQUIRED%' AND e2 LIKE 'REASON_REQUIRED%' AND e3 LIKE 'REASON_REQUIRED%', left(e1, 20) || '|' || left(e3, 20));
END $t$;

DO $t$ DECLARE a0 numeric := pg_temp.lo('HD-A'); b0 numeric := pg_temp.lo('HD-B'); h uuid := pg_temp.hd('X3'); r record; BEGIN
  SELECT * INTO r FROM cancel_invoice(h, 'khách đổi ý');
  PERFORM pg_temp.ghi('E2', 'huỷ HĐ → RPC trả cancelled; đơn Đã huỷ, lý do "Huỷ theo hóa đơn …"',
    r.order_status = 'cancelled' AND pg_temp.don('X3') = 'cancelled'
    AND pg_temp.chu(format('SELECT cancel_reason FROM sales_orders WHERE id = %L', pg_temp.c('X3'))) LIKE 'Huỷ theo hóa đơn%khách đổi ý',
    pg_temp.chu(format('SELECT cancel_reason FROM sales_orders WHERE id = %L', pg_temp.c('X3'))));
  PERFORM pg_temp.ghi('E2', 'hoàn kho ĐÚNG LÔ đã lấy: HD-A +52, HD-B +28',
    pg_temp.lo('HD-A') = a0 + 52 AND pg_temp.lo('HD-B') = b0 + 28,
    format('HD-A %s→%s, HD-B %s→%s', a0, pg_temp.lo('HD-A'), b0, pg_temp.lo('HD-B')));
  PERFORM pg_temp.ghi('E2', 'HĐ Đã huỷ (người huỷ, lý do); công nợ xoá; nợ khách 0; phiếu nhập hoàn kho',
    pg_temp.chu(format('SELECT status || %L || cancelled_by || %L || cancel_reason FROM sales_invoices WHERE id = %L', '/', '/', h))
      = 'cancelled/e0000000-0000-0000-0000-000000000001/khách đổi ý'
    AND pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L', h)) = 0 AND pg_temp.no_kh('X3') = 0
    AND pg_temp.so(format('SELECT sum(qty_in_base_uom) FROM stock_entry_lines WHERE entry_id = %L', r.import_entry_id)) = 80,
    pg_temp.chu(format('SELECT status FROM sales_invoices WHERE id = %L', h)));
  PERFORM pg_temp.ghi('E2', 'dòng đơn về đã xuất 0', pg_temp.so(format('SELECT invoiced_qty FROM sales_order_lines WHERE id = %L', pg_temp.c('X3#1'))) = 0, '');
  PERFORM pg_temp.ghi('E3', 'huỷ lần hai → INVOICE_NOT_POSTED', pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', h, 'lại')) LIKE 'INVOICE_NOT_POSTED%', '');
  PERFORM pg_temp.ghi('E3', 'đơn đã huỷ không xuất lại', pg_temp.thu(format('SELECT post_invoice(%L::jsonb)',
    jsonb_build_object('order_id', pg_temp.c('X3'), 'lines', jsonb_build_array(pg_temp.dl('X3', 1, 5))))) LIKE 'ORDER_NOT_INVOICEABLE%', '');
  PERFORM pg_temp.ghi('E3', 'sửa HĐ đã huỷ → INVOICE_NOT_POSTED', pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h,
    jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('X3', 1, 5))))) LIKE 'INVOICE_NOT_POSTED%', '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E2', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E4 Huỷ HĐ có phiếu tự sinh Chờ xử lý → phiếu Đã huỷ (không về Nháp), hết nợ, kho P1 về
DO $t$ DECLARE h uuid := pg_temp.hd('T1'); m numeric; BEGIN
  m := pg_temp.so($q$SELECT sum(qty_on_hand) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale'$q$);
  PERFORM cancel_invoice(h, 'giao nhầm');
  PERFORM pg_temp.ghi('E4', 'đơn Đã huỷ, phiếu tự sinh Đã huỷ, nợ khách 0, hoàn 8 lon',
    pg_temp.don('T1') = 'cancelled' AND pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('T1.ret'))) = 'cancelled'
    AND pg_temp.no_kh('T1') = 0
    AND pg_temp.so($q$SELECT sum(qty_on_hand) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' AND warehouse_zone = 'sale'$q$) = m + 8,
    format('đơn %s phiếu %s nợ %s', pg_temp.don('T1'), pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('T1.ret'))), pg_temp.no_kh('T1')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E4', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E5 Phiếu trả TỰ LẬP gắn HĐ hoàn thành → trừ nợ ngay; huỷ HĐ bị chặn LOCKED_RETURN_DONE
DO $t$ DECLARE v uuid; e text; BEGIN
  INSERT INTO returns (org_id, invoice_id, customer_id, status, credit_with_invoice, reason, requested_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.hd('X2'), pg_temp.c('X2.kh'), 'draft', false, 'damaged', 'e0000000-0000-0000-0000-000000000001')
  RETURNING id INTO v;
  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange)
  VALUES (v, 'c0000000-0000-0000-0000-000000000002', 'lon', 5, 10000, 0, 50000, false);
  PERFORM pg_temp.ghi('E5', 'phiếu tự lập Nháp chưa trừ nợ (600.000)', pg_temp.rc('X2', 'amount')::numeric = 600000, pg_temp.rc('X2', 'amount'));
  PERFORM complete_return(v, 'sale');
  PERFORM pg_temp.ghi('E5', 'hoàn thành → nợ HĐ 550.000, kho P2 +5',
    pg_temp.rc('X2', 'amount')::numeric = 550000 AND pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', v)) = 'completed',
    format('nợ %s', pg_temp.rc('X2', 'amount')));
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('X2'), 'thử'));
  PERFORM pg_temp.ghi('E5', 'huỷ HĐ có phiếu trả hoàn thành → LOCKED_RETURN_DONE, đơn giữ Hoàn thành',
    e LIKE 'LOCKED_RETURN_DONE%' AND pg_temp.don('X2') = 'completed', left(e, 50));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E5', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E6 HĐ điện tử đã phát hành → khoá huỷ
RESET ROLE;
INSERT INTO invoices (org_id, customer_name, sales_invoice_id, status) SELECT org_id, 'Khách X4', id, 'issued' FROM sales_invoices WHERE id = pg_temp.hd('X4');
SET LOCAL ROLE authenticated;
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.hd('X4'), 'thử'));
  PERFORM pg_temp.ghi('E6', 'HĐ điện tử đã phát hành → LOCKED_EINVOICE', e LIKE 'LOCKED_EINVOICE%', left(e, 50));
END $t$;

-- E7 Phiếu thu đã huỷ → huỷ HĐ được, dòng phiếu thu nhả con trỏ công nợ
DO $t$ DECLARE h uuid := pg_temp.hd('X12'); BEGIN
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c('X12.kh'), 'client_key', 'hd-doi-x12',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', pg_temp.rc('X12', 'id'), 'amount', 64000))));
  PERFORM pg_temp.ghi('E7', 'thu đủ 64.000 → paid', pg_temp.rc('X12', 'status') = 'paid' AND pg_temp.no_kh('X12') = 0, pg_temp.rc('X12', 'status'));
  PERFORM void_cash_receipt((SELECT id FROM cash_receipts WHERE client_key = 'hd-doi-x12'), 'thu nhầm');
  PERFORM pg_temp.ghi('E7', 'huỷ phiếu thu → nợ về 64.000 open', pg_temp.rc('X12', 'paid')::numeric = 0 AND pg_temp.no_kh('X12') = 64000, pg_temp.rc('X12', 'paid'));
  PERFORM cancel_invoice(h, 'không giao');
  PERFORM pg_temp.ghi('E7', 'sau đó huỷ HĐ được: đơn Đã huỷ, nợ 0, HD-D về 10, dòng phiếu thu không còn trỏ công nợ',
    pg_temp.don('X12') = 'cancelled' AND pg_temp.no_kh('X12') = 0 AND pg_temp.lo('HD-D') = 10
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines crl JOIN cash_receipts cr ON cr.id = crl.receipt_id WHERE cr.client_key = %L AND crl.receivable_id IS NOT NULL', 'hd-doi-x12')) = 0,
    format('đơn %s HD-D %s', pg_temp.don('X12'), pg_temp.lo('HD-D')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E7', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E8 Phiếu tự lập NHÁP gắn HĐ → huỷ HĐ thì phiếu Đã huỷ (không về Nháp)
DO $t$ DECLARE v uuid; BEGIN
  INSERT INTO returns (org_id, invoice_id, customer_id, status, credit_with_invoice, reason, requested_by)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.hd('X9'), pg_temp.c('X9.kh'), 'draft', false, 'damaged', 'e0000000-0000-0000-0000-000000000001')
  RETURNING id INTO v;
  PERFORM cancel_invoice(pg_temp.hd('X9'), 'sai giá');
  PERFORM pg_temp.ghi('E8', 'phiếu tự lập Nháp Đã huỷ theo HĐ; đơn Đã huỷ',
    pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', v)) = 'cancelled' AND pg_temp.don('X9') = 'cancelled',
    pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', v)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E8', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ F. XUẤT ÂM (allow_oversell) ═════════════════════
DO $t$ DECLARE e text; BEGIN
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('F1'), 'lines', jsonb_build_array(pg_temp.dl('F1', 1, 20)))));
  PERFORM pg_temp.ghi('F1', 'tắt bán âm: thiếu P5 (hàng nằm kho cận date) → INSUFFICIENT_STOCK nói rõ KHO CẬN DATE',
    e LIKE 'INSUFFICIENT_STOCK%KHO CẬN DATE%', left(e, 90));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('F2'), 'lines', jsonb_build_array(pg_temp.dl('F2', 1, 10000)))));
  PERFORM pg_temp.ghi('F1', 'tắt bán âm: thiếu P2 → INSUFFICIENT_STOCK tồn kho âm', e LIKE 'INSUFFICIENT_STOCK%tồn kho âm%', left(e, 90));
  PERFORM pg_temp.ghi('F1', 'bị chặn: đơn vẫn Gửi, không HĐ, HD-D vẫn 10', pg_temp.don('F1') = 'submitted' AND pg_temp.hd('F1') IS NULL AND pg_temp.lo('HD-D') = 10, '');
END $t$;
RESET ROLE;
UPDATE organizations SET allow_oversell = true WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $t$ DECLARE r record; BEGIN
  SELECT * INTO r FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('F1'), 'invoice_date', pg_temp.hn(), 'lines', jsonb_build_array(pg_temp.dl('F1', 1, 20))));
  PERFORM pg_temp.ghi('F2', 'bật bán âm: xuất 20 khi kho bán có 10 → short_qty 10, lô về 0 (không âm), kho date không đụng',
    r.short_qty = 10 AND pg_temp.lo('HD-D') = 0 AND pg_temp.lo('HD-E') = 50, format('short %s HD-D %s HD-E %s', r.short_qty, pg_temp.lo('HD-D'), pg_temp.lo('HD-E')));
  PERFORM pg_temp.ghi('F2', 'HĐ + công nợ ĐỦ 20.000, đơn Hoàn thành', pg_temp.hdc('F1', 'total')::numeric = 20000 AND pg_temp.rc('F1', 'amount')::numeric = 20000
    AND pg_temp.don('F1') = 'completed', pg_temp.hdc('F1', 'total'));
  PERFORM cancel_invoice(pg_temp.hd('F1'), 'thử âm');
  PERFORM pg_temp.ghi('F3', 'huỷ HĐ bán âm chỉ hoàn phần thật đã lấy: HD-D về 10 (không phải 20)', pg_temp.lo('HD-D') = 10 AND pg_temp.lo('HD-E') = 50,
    format('HD-D %s', pg_temp.lo('HD-D')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('F2', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
RESET ROLE;
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- ═════════════════════ TỔNG ═════════════════════
SELECT stt, buoc AS "B", CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
