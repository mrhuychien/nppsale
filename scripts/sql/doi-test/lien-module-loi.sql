-- ====================================================================================================
-- ĐỘI TEST "LIÊN MÔ-ĐUN" — LỖI SẢN PHẨM ĐÃ XÁC MINH. Các phép kiểm dưới đây ĐANG ĐỎ; sửa xong phải XANH.
--   psql -h /tmp/pgtest -p 55432 -U postgres -d npp_lien_module -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/lien-module-loi.sql
--   BEGIN … ROLLBACK; phiên để UTC như Supabase.
--
-- LỖI 1 — Sửa HĐ (reissue_invoice) làm MẤT việc NPP đã giao lại công nợ của nhân viên nghỉ việc.
--   Chuỗi: NV X có HĐ → cho nghỉ (nợ về NPP, mig 223) → NPP giao nợ của khách cho NV Y (giao_cong_no_npp) →
--   Sửa HĐ (dù không đổi gì) → phiếu nợ của tờ mới quay về "NPP / chưa gán" (sales_user_id NULL, ve_npp_luc
--   đặt lại), NV Y mất khoản nợ trên màn công nợ theo NV mà không ai bấm gì.
--   Luật: chủ nhà 02/10/2026 (mig 223) "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại
--   sau"; trigger `_cong_no_giu_ve_npp` ghi rõ ý định "Tính lại nợ theo HĐ của người đã nghỉ: giữ người đang
--   đứng tên (NV được NPP phân lại)". CLAUDE.md: "Sửa HĐ (reissue_invoice) KHÔNG huỷ đơn" — tiền thu chuyển
--   sang tờ mới (mig 184) nhưng người giữ nợ thì không.
--   Chỗ nghi: reissue_invoice → cancel_invoice XOÁ phiếu nợ cũ; post_invoice → _wf2b_recompute_receivable
--   INSERT phiếu mới với sales_user_id = người của ĐƠN (NV X đã nghỉ) → trigger _cong_no_giu_ve_npp (nhánh
--   INSERT) đặt NULL + ve_npp_luc; câu "(mig 182) UPDATE receivables rc182 SET sales_user_id = …" lấy người
--   của TỜ CŨ (vẫn NV X) nên không cứu được. Không chỗ nào chép người giữ nợ của phiếu nợ cũ sang phiếu mới.
--
-- LỖI 2 — Huỷ riêng phiếu kho (cancel_stock_entry, nút "Huỷ phiếu" ở /inventory/entries) với phiếu kho
--   SINH RA TỪ CHỨNG TỪ ĐÃ ĐẢO → kho bị hoàn / rút LẦN HAI, tồn ảo:
--   2a phiếu XUẤT của HĐ ĐÃ HUỶ (cancel_invoice đã hoàn kho bằng phiếu nhập "Hoàn kho do huỷ hóa đơn" và trừ
--      dấu vết lô về 0) → huỷ riêng được: tồn lô không đổi (vết lô đã 0) nhưng phiếu xuất bị gạch trong khi
--      phiếu hoàn kho vẫn ghi sổ → THẺ KHO dư ảo 48 lon so với tồn lô (thẻ kho ≠ tồn).
--   2b phiếu XUẤT của tờ CŨ sau Sửa HĐ — y như 2a.
--   2c phiếu NHẬP "Nhập lại từ phiếu trả … (đã đảo)" của phiếu trả đã huỷ → rút hàng lần hai (tồn 96 → 86).
--   2d phiếu NHẬP "Hoàn kho do huỷ hóa đơn" → 48 lon rút khỏi kho trong khi HĐ vẫn Đã huỷ (tồn 86 → 38).
--   Luật: CLAUDE.md "Tiền, tồn kho, trạng thái chứng từ chỉ đổi qua RPC" — RPC của CHỨNG TỪ GỐC; chính
--   cancel_stock_entry đã chặn phiếu xuất của HĐ còn hiệu lực ("Huỷ hóa đơn đó thay vì huỷ riêng phiếu kho")
--   và phiếu nhập của phiếu trả còn Hoàn thành ("Huỷ phiếu trả hàng đó thay vì huỷ riêng phiếu kho"). Hở ở
--   chỗ chỉ xét HĐ 'posted' và phiếu trả 'completed' khớp đúng ghi chú, nên phiếu kho của chứng từ ĐÃ ĐẢO lọt.
--   Tồn kho phải = nhập − xuất của chứng từ thật (bất biến 1 của đội).
--   Chỗ nghi: cancel_stock_entry (supabase/migrations/139_cancel_stock_entry.sql và bản thay sau) — khối
--   "ENTRY_HAS_INVOICE" (`si.status = 'posted'`) và khối "ENTRY_HAS_SOURCE" phiếu trả (`rt.status = 'completed'`
--   + so khớp nguyên văn ghi chú, phiếu đã đảo có hậu tố " (đã đảo)"); không có chặn cho phiếu
--   "Hoàn kho do huỷ hóa đơn".
--
-- LỖI 3 — Tiền thu trên Tài chính (finance_cash_flow) chia ngày theo UTC: tiền thu lúc 00:00–06:59 giờ VN
--   bị xếp sang NGÀY HÔM TRƯỚC, lệch với Báo cáo công nợ (bao_cao_cong_no 'thu' — mốc +07:00) cho cùng ngày.
--   Luật: CLAUDE.md "so bằng ngày theo giờ VN (vnDateKey), không so với mốc ISO/UTC".
--   Chỗ nghi: finance_cash_flow — `p.collected_at >= p_from::timestamptz AND < (p_to + 1)::timestamptz`
--   (ép DATE → timestamptz theo múi giờ PHIÊN = UTC trên Supabase). Cùng họ với lỗi finance_pnl của đội Báo cáo
--   nhưng là hàm khác (dòng tiền khách trả).
-- ====================================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
SET client_min_messages = warning;
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

CREATE FUNCTION pg_temp.c(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT v FROM ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.hn() RETURNS date LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date $f$;
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), g) $f$;
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RAISE EXCEPTION 'XX_KHONG_LOI';
EXCEPTION WHEN OTHERS THEN RETURN CASE WHEN SQLERRM = 'XX_KHONG_LOI' THEN 'KHÔNG LỖI' ELSE SQLERRM END; END $f$;
CREATE FUNCTION pg_temp.vai(u text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', CASE u WHEN 'owner' THEN 'e0000000-0000-0000-0000-000000000001'
       WHEN 'manager' THEN 'e0000000-0000-0000-0000-000000000002' WHEN 'accountant' THEN 'e0000000-0000-0000-0000-000000000003'
       WHEN 'sales' THEN 'e0000000-0000-0000-0000-000000000004' WHEN 'warehouse' THEN 'e0000000-0000-0000-0000-000000000005'
       ELSE u END, true) $f$;
CREATE FUNCTION pg_temp.ton(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = pg_temp.c(k) $f$;
-- Thẻ kho như màn /inventory/stock-card: Σ dòng phiếu đã ghi sổ (xuất trừ, còn lại cộng), đơn vị cơ sở.
CREATE FUNCTION pg_temp.the_kho(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS $f$
  SELECT COALESCE(sum(CASE WHEN se.type = 'export' THEN -1 ELSE 1 END
           * COALESCE(sel.qty_in_base_uom, sel.quantity * COALESCE(NULLIF(sel.conversion_factor_snapshot, 0), 1))), 0)
  FROM stock_entry_lines sel JOIN stock_entries se ON se.id = sel.entry_id
  WHERE se.status = 'posted' AND sel.product_id = pg_temp.c(k) $f$;
CREATE FUNCTION pg_temp.so(q text) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS
  $f$ DECLARE r numeric; BEGIN EXECUTE q INTO r; RETURN r; END $f$;
CREATE FUNCTION pg_temp.hd(don text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT id FROM sales_invoices WHERE order_id = pg_temp.c(don) AND status = 'posted' $f$;
-- Đơn 2 thùng (48 lon) × 240.000 do NV `nv` lập, xuất HĐ ngay (chủ NPP).
CREATE FUNCTION pg_temp.don_xuat(don text, kh text, nv uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE r record; l uuid;
BEGIN
  PERFORM pg_temp.vai(nv::text);
  SELECT * INTO r FROM create_order_with_lines(jsonb_build_object('client_request_id', gen_random_uuid(),
    'order', jsonb_build_object('customer_id', pg_temp.c(kh), 'status', 'submitted', 'payment_terms', 'NET30', 'subtotal', 480000, 'total', 480000),
    'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('P'), 'unit_name', 'Thung 24', 'quantity', 2,
      'unit_price', 240000, 'line_total', 480000, 'conversion_factor', 24))));
  INSERT INTO ctx VALUES (don, r.order_id);
  SELECT id INTO l FROM sales_order_lines WHERE order_id = r.order_id;
  PERFORM pg_temp.vai('owner');
  RETURN (SELECT invoice_id FROM post_invoice(jsonb_build_object('order_id', r.order_id, 'invoice_date', pg_temp.hn(),
    'lines', jsonb_build_array(jsonb_build_object('order_line_id', l, 'product_id', pg_temp.c('P'), 'unit_name', 'Thung 24',
      'conversion_factor', 24, 'quantity', 2, 'unit_price', 240000, 'vat_rate', 0)))));
END $f$;

DO $d$
DECLARE o uuid := 'a0000000-0000-0000-0000-000000000001'; v uuid; k text;
BEGIN
  INSERT INTO products (org_id, sku, name, base_unit) VALUES (o, 'LM-LOI-P', 'LM lỗi P', 'lon') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('P', v);
  INSERT INTO product_units (product_id, unit_name, conversion) VALUES (v, 'Thung 24', 24);
  FOREACH k IN ARRAY ARRAY['K1', 'K2', 'K3', 'K4', 'K5'] LOOP
    INSERT INTO customers (org_id, store_name, owner_name, phone, address)
    VALUES (o, 'Khách LM lỗi ' || k, 'Anh ' || k, '0966' || lpad((abs(hashtext(k || 'loi')) % 1000000)::text, 6, '0'), 'x') RETURNING id INTO v;
    INSERT INTO ctx VALUES (k, v);
  END LOOP;
  INSERT INTO auth.users (id, email) VALUES ('e7780000-0000-0000-0000-00000000000a', 'lm-loi-x@x.vn'), ('e7780000-0000-0000-0000-00000000000b', 'lm-loi-y@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e7780000-0000-0000-0000-00000000000a', o, 'NV X', 'sales'),
                                                         ('e7780000-0000-0000-0000-00000000000b', o, 'NV Y', 'sales');
  INSERT INTO ctx VALUES ('NVX', 'e7780000-0000-0000-0000-00000000000a'), ('NVY', 'e7780000-0000-0000-0000-00000000000b');
END $d$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('warehouse') \g /dev/null
SELECT post_stock_import(jsonb_build_object('entry_code', 'NK-LM-LOI', 'lines', jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.c('P'), 'base_qty', 240, 'unit_name', 'lon', 'base_cost', 5000)))) \g /dev/null

-- ───────── LỖI 1: Sửa HĐ làm mất việc giao lại công nợ ─────────
DO $t$ DECLARE h uuid; h2 uuid; v_nv uuid; v_co timestamptz; BEGIN
  h := pg_temp.don_xuat('D1', 'K1', pg_temp.c('NVX'));
  PERFORM pg_temp.vai('owner');
  PERFORM cho_nhan_vien_nghi(pg_temp.c('NVX'));
  PERFORM pg_temp.vai('accountant');
  PERFORM giao_cong_no_npp(pg_temp.c('K1'), pg_temp.c('NVY'));
  SELECT sales_user_id INTO v_nv FROM receivables WHERE invoice_id = h;
  PERFORM pg_temp.ghi('L1', '(tiền đề) NPP đã giao nợ HĐ cho NV Y', v_nv = pg_temp.c('NVY'), v_nv::text);
  PERFORM pg_temp.vai('owner');
  PERFORM reissue_invoice(h, jsonb_build_object('lines', (SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id,
    'product_id', product_id, 'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
    'unit_price', unit_price, 'vat_rate', vat_rate)) FROM sales_invoice_lines WHERE invoice_id = h)));
  h2 := pg_temp.hd('D1');
  SELECT sales_user_id, ve_npp_luc INTO v_nv, v_co FROM receivables WHERE invoice_id = h2;
  PERFORM pg_temp.ghi('L1', 'Sửa HĐ (không đổi gì): nợ của tờ mới vẫn do NV Y giữ, không quay về NPP',
    v_nv = pg_temp.c('NVY') AND v_co IS NULL,
    format('người giữ nợ %s, cờ về NPP %s (kỳ vọng NV Y, không cờ)', COALESCE(v_nv::text, 'NULL = NPP'), v_co IS NOT NULL));
  PERFORM pg_temp.ghi('L1', 'công nợ theo NV: NV Y vẫn 480.000 sau Sửa HĐ',
    COALESCE((SELECT total_debt FROM receivables_by_rep() WHERE user_id = pg_temp.c('NVY')), 0) = 480000,
    COALESCE((SELECT total_debt FROM receivables_by_rep() WHERE user_id = pg_temp.c('NVY')), 0)::text);
END $t$;

-- ───────── LỖI 2: huỷ riêng phiếu kho của chứng từ đã đảo ─────────
-- 2a phiếu xuất của HĐ đã huỷ
DO $t$ DECLARE h uuid; e uuid; t0 numeric; v text; BEGIN
  t0 := pg_temp.ton('P');
  h := pg_temp.don_xuat('D2', 'K2', 'e0000000-0000-0000-0000-000000000004');
  e := (SELECT stock_entry_id FROM sales_invoices WHERE id = h);
  PERFORM cancel_invoice(h, 'khách không lấy');
  PERFORM pg_temp.ghi('L2a', '(tiền đề) huỷ HĐ: kho về đủ', pg_temp.ton('P') = t0, format('%s / %s', pg_temp.ton('P'), t0));
  PERFORM pg_temp.vai('warehouse');
  v := pg_temp.thu(format('SELECT cancel_stock_entry(%L, %L)', e, 'huỷ thêm'));
  PERFORM pg_temp.ghi('L2a', 'huỷ riêng phiếu XUẤT của HĐ đã huỷ phải bị chặn (hàng đã hoàn kho rồi)',
    v <> 'KHÔNG LỖI', v);
  PERFORM cancel_stock_entry(e, 'huỷ thêm');
  PERFORM pg_temp.ghi('L2a', 'thẻ kho vẫn = tồn lô (kỳ vọng ' || t0 || ')', pg_temp.ton('P') = t0 AND pg_temp.the_kho('P') = pg_temp.ton('P'),
    format('tồn lô %s, thẻ kho %s — thẻ kho dư ảo %s lon (phiếu xuất bị gạch, phiếu hoàn kho vẫn cộng)', pg_temp.ton('P'), pg_temp.the_kho('P'), pg_temp.the_kho('P') - pg_temp.ton('P')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2a', 'thẻ kho vẫn = tồn lô', true, 'đã chặn: ' || SQLERRM);
END $t$;

-- 2b phiếu xuất của tờ CŨ sau Sửa HĐ
DO $t$ DECLARE h uuid; e uuid; t1 numeric; v text; lech0 numeric; BEGIN
  h := pg_temp.don_xuat('D3', 'K3', 'e0000000-0000-0000-0000-000000000004');
  e := (SELECT stock_entry_id FROM sales_invoices WHERE id = h);
  PERFORM pg_temp.vai('owner');
  PERFORM reissue_invoice(h, jsonb_build_object('lines', (SELECT jsonb_agg(jsonb_build_object('order_line_id', order_line_id,
    'product_id', product_id, 'unit_name', unit_name, 'conversion_factor', conversion_factor, 'quantity', quantity,
    'unit_price', unit_price, 'vat_rate', vat_rate)) FROM sales_invoice_lines WHERE invoice_id = h)));
  t1 := pg_temp.ton('P');
  lech0 := pg_temp.the_kho('P') - pg_temp.ton('P');  -- độ lệch có sẵn (từ 2a), để đo riêng 2b
  PERFORM pg_temp.vai('warehouse');
  v := pg_temp.thu(format('SELECT cancel_stock_entry(%L, %L)', e, 'huỷ phiếu xuất tờ cũ'));
  PERFORM pg_temp.ghi('L2b', 'huỷ riêng phiếu XUẤT của tờ cũ (đã Sửa HĐ) phải bị chặn', v <> 'KHÔNG LỖI', v);
  PERFORM cancel_stock_entry(e, 'huỷ phiếu xuất tờ cũ');
  PERFORM pg_temp.ghi('L2b', 'thẻ kho vẫn = tồn lô khi tờ mới đang giao 48 lon', pg_temp.ton('P') = t1 AND pg_temp.the_kho('P') - pg_temp.ton('P') = lech0,
    format('tồn lô %s (kỳ vọng %s), thẻ kho lệch thêm %s lon', pg_temp.ton('P'), t1, pg_temp.the_kho('P') - pg_temp.ton('P') - lech0));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2b', 'thẻ kho vẫn = tồn lô', true, 'đã chặn: ' || SQLERRM);
END $t$;

-- 2c phiếu nhập của phiếu trả đã huỷ (đã đảo)
DO $t$ DECLARE h uuid; r uuid; e uuid; t1 numeric; v text; BEGIN
  h := pg_temp.don_xuat('D4', 'K4', 'e0000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.vai('manager');
  r := save_pos_return(jsonb_build_object('customer_id', pg_temp.c('K4'), 'invoice_id', h, 'complete', true, 'zone', 'sale',
    'lines', jsonb_build_array(jsonb_build_object('product_id', pg_temp.c('P'), 'unit_name', 'lon', 'quantity', 10, 'unit_price', 10000))));
  e := (SELECT id FROM stock_entries WHERE notes = 'Nhập lại từ phiếu trả ' || r);
  PERFORM cancel_return(r, 'trả nhầm');
  t1 := pg_temp.ton('P');
  PERFORM pg_temp.vai('warehouse');
  v := pg_temp.thu(format('SELECT cancel_stock_entry(%L, %L)', e, 'huỷ'));
  PERFORM pg_temp.ghi('L2c', 'huỷ riêng phiếu NHẬP của phiếu trả đã huỷ (đã đảo) phải bị chặn', v <> 'KHÔNG LỖI', v);
  PERFORM cancel_stock_entry(e, 'huỷ');
  PERFORM pg_temp.ghi('L2c', 'không rút hàng lần hai', pg_temp.ton('P') = t1, format('tồn %s / kỳ vọng %s', pg_temp.ton('P'), t1));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2c', 'không rút hàng lần hai', true, 'đã chặn: ' || SQLERRM);
END $t$;

-- 2d phiếu nhập "Hoàn kho do huỷ hóa đơn"
DO $t$ DECLARE h uuid; e uuid; t1 numeric; v text; BEGIN
  h := pg_temp.don_xuat('D5', 'K5', 'e0000000-0000-0000-0000-000000000004');
  SELECT import_entry_id INTO e FROM cancel_invoice(h, 'khách trả lại cả đơn');
  t1 := pg_temp.ton('P');
  PERFORM pg_temp.vai('warehouse');
  v := pg_temp.thu(format('SELECT cancel_stock_entry(%L, %L)', e, 'huỷ'));
  PERFORM pg_temp.ghi('L2d', 'huỷ riêng phiếu "Hoàn kho do huỷ hóa đơn" phải bị chặn (HĐ vẫn Đã huỷ)', v <> 'KHÔNG LỖI', v);
  PERFORM cancel_stock_entry(e, 'huỷ');
  PERFORM pg_temp.ghi('L2d', 'hàng của HĐ đã huỷ không biến mất khỏi kho', pg_temp.ton('P') = t1, format('tồn %s / kỳ vọng %s', pg_temp.ton('P'), t1));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L2d', 'hàng của HĐ đã huỷ không biến mất khỏi kho', true, 'đã chặn: ' || SQLERRM);
END $t$;

-- ───────── LỖI 3: finance_cash_flow chia ngày theo UTC ─────────
RESET ROLE;
DO $t$ DECLARE rc uuid; T date := pg_temp.hn() - 1; v_tc numeric; v_tc0 numeric; v_cn numeric; BEGIN
  PERFORM pg_temp.vai('owner');
  v_tc0 := (SELECT cash_from_customers FROM finance_cash_flow(T, T));
  -- Dữ liệu thử: khoản nợ đầu kỳ 500.000 thu đủ lúc 00:30 sáng ngày T giờ VN (= 17:30 UTC ngày T−1).
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, note)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('K1'), 500000, 500000, T, 'paid', 'LM lỗi 3') RETURNING id INTO rc;
  INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
  VALUES (rc, 'e0000000-0000-0000-0000-000000000003', 500000, 'cash', (T + time '00:30') AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_tc := (SELECT cash_from_customers FROM finance_cash_flow(T, T));
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_cn FROM jsonb_array_elements(bao_cao_cong_no(T, T)->'thu') x
   WHERE x->>'receivable_id' = rc::text;
  PERFORM pg_temp.ghi('L3', '(đối chứng) Báo cáo công nợ xếp khoản thu 00:30 VN vào đúng ngày T', v_cn = 500000, v_cn::text);
  PERFORM pg_temp.ghi('L3', 'Tài chính: tiền khách trả ngày T phải +500.000 (thu lúc 00:30 giờ VN ngày T)', v_tc - v_tc0 = 500000,
    format('Δ ngày T = %s; ngày T−1 nhận %s', v_tc - v_tc0, (SELECT cash_from_customers FROM finance_cash_flow(T - 1, T - 1))));
END $t$;

\pset footer off
SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
