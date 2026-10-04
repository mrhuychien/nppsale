-- ĐỘI TEST HOÁ ĐƠN — đánh dấu đã soạn (mig 224), lượt soạn (mig 225), Sửa HĐ có phiếu tự sinh đã nhập kho
-- (mig 210/216), huỷ phiếu tự sinh đã nhập kho (mig 191), khoá HĐ điện tử khi sửa.
-- Luật: CLAUDE.md §1 "Phiếu trả TỰ SINH": đã nhập kho thì huỷ = đảo kho, phiếu về Chờ xử lý, nợ giữ nguyên;
--   sửa HĐ có phiếu tự sinh đã nhập kho → hỏi; Có = huỷ phiếu nhập → phiếu về Chờ xử lý (mig 216); Không = gắn tờ mới.
--   Mig 224/225: chỉ chủ NPP, quản lý, thủ kho, kế toán; đánh dấu không đổi giờ sửa cuối; hoàn tất KHÔNG trừ kho.
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_hoa_don -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/hoa-don-soan-hang-tra-da-nhap.sql
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

-- NPP khác + chủ NPP khác.
DO $d$ DECLARE v_org uuid; BEGIN
  INSERT INTO organizations (name, slug) VALUES ('NPP khác', 'npp-khac-sh') RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email) VALUES ('e9990000-0000-0000-0000-000000000001', 'khac-sh@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e9990000-0000-0000-0000-000000000001', v_org, 'Chủ khác', 'owner');
END $d$;

-- ───────────────────────── Dữ liệu ─────────────────────────
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'SH-A', pg_temp.hn() + 200, 1000, 1000, 5000, 'sale', now() - interval '10 days'),
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'SH-C', pg_temp.hn() + 300, 1000, 1000, 3000, 'sale', now() - interval '5 days');
SELECT pg_temp.tao_don('S1', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"Thung 24","sl":1,"gia":240000,"hs":24}]');
SELECT pg_temp.tao_don('S2', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]');
SELECT pg_temp.tao_don('S3', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":5,"gia":10000}]');
SELECT pg_temp.tao_don('R1', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":20,"gia":10000}]');
SELECT pg_temp.tao_don('R2', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":20,"gia":10000}]');
SELECT pg_temp.tao_don('R3', '[{"p":"c0000000-0000-0000-0000-000000000001","u":"lon","sl":20,"gia":10000}]');

SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');
-- Ba HĐ ghi sổ + S3 bị huỷ; ba HĐ có hàng trả tự sinh (R1..R3) đã nhập kho bán.
DO $d$ DECLARE k text; v uuid; BEGIN
  PERFORM pg_temp.xuat('S1', jsonb_build_array(pg_temp.dl('S1', 1, 1)));
  PERFORM pg_temp.xuat('S2', jsonb_build_array(pg_temp.dl('S2', 1, 10)));
  PERFORM pg_temp.xuat('S3', jsonb_build_array(pg_temp.dl('S3', 1, 5)));
  INSERT INTO ctx VALUES ('S3.hd', pg_temp.hd('S3'));
  PERFORM cancel_invoice(pg_temp.hd('S3'), 'thử soạn');
  FOREACH k IN ARRAY ARRAY['R1', 'R2', 'R3'] LOOP
    PERFORM pg_temp.xuat(k, jsonb_build_array(pg_temp.dl(k, 1, 20)), jsonb_build_object('return_adds', jsonb_build_array(
      jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon', 'quantity', 4, 'unit_price', 5000, 'vat_rate', 0, 'is_exchange', false))));
    SELECT id INTO v FROM returns WHERE order_id = pg_temp.c(k);
    INSERT INTO ctx VALUES (k || '.ret', v);
    PERFORM complete_return(v, 'sale');
  END LOOP;
END $d$;
RESET ROLE;
CREATE TEMP TABLE moc ON COMMIT DROP AS
  SELECT id, updated_at, total FROM sales_invoices WHERE order_id IN (pg_temp.c('S1'), pg_temp.c('S2'), pg_temp.c('S3'));
GRANT ALL ON moc TO authenticated;
CREATE TEMP TABLE moc_kho ON COMMIT DROP AS SELECT (SELECT sum(qty_on_hand) FROM batches) AS ton, (SELECT sum(amount) FROM receivables) AS no;
GRANT ALL ON moc_kho TO authenticated;
SET LOCAL ROLE authenticated;

-- ═════════════════════ G. ĐÁNH DẤU ĐÃ SOẠN (mig 224) ═════════════════════
DO $t$ DECLARE n int; n2 int; e text; t0 timestamptz; v text; BEGIN
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT danh_dau_soan_hang(ARRAY[%L]::uuid[], true)', pg_temp.hd('S1')));
  PERFORM pg_temp.ghi('G1', 'NVBH không đánh dấu soạn được (KHONG_DU_QUYEN)', e LIKE 'KHONG_DU_QUYEN%', left(e, 50));
  PERFORM pg_temp.vai('warehouse');
  n := danh_dau_soan_hang(ARRAY[pg_temp.hd('S1'), pg_temp.hd('S2'), pg_temp.c('S3.hd'), gen_random_uuid()], true);
  PERFORM pg_temp.ghi('G1', 'thủ kho đánh dấu 2 HĐ ghi sổ (bỏ qua HĐ huỷ + id lạ) → 2, soan_boi = thủ kho',
    n = 2 AND pg_temp.hdc('S1', 'soan_boi') = 'e0000000-0000-0000-0000-000000000005' AND pg_temp.hdc('S2', 'soan_luc') IS NOT NULL
    AND pg_temp.chu(format('SELECT soan_luc::text FROM sales_invoices WHERE id = %L', pg_temp.c('S3.hd'))) IS NULL,
    'n=' || n);
  PERFORM pg_temp.ghi('G1', 'đánh dấu KHÔNG đổi giờ sửa cuối, tiền HĐ',
    pg_temp.so('SELECT count(*) FROM sales_invoices s JOIN moc m USING (id) WHERE s.updated_at IS DISTINCT FROM m.updated_at OR s.total <> m.total') = 0, '');
  t0 := pg_temp.hdc('S1', 'soan_luc')::timestamptz;
  PERFORM pg_temp.vai('manager');
  n2 := danh_dau_soan_hang(ARRAY[pg_temp.hd('S1')], true);
  PERFORM pg_temp.ghi('G2', 'đánh dấu lại (quản lý) → 0, không ghi đè người / giờ',
    n2 = 0 AND pg_temp.hdc('S1', 'soan_boi') = 'e0000000-0000-0000-0000-000000000005' AND pg_temp.hdc('S1', 'soan_luc')::timestamptz = t0, 'n=' || n2);
  PERFORM pg_temp.vai('accountant');
  n := danh_dau_soan_hang(ARRAY[pg_temp.hd('S2')], false);
  n2 := danh_dau_soan_hang(ARRAY[pg_temp.hd('S2')], false);
  PERFORM pg_temp.ghi('G3', 'kế toán bỏ đánh dấu → 1; bỏ lần nữa → 0; soan_luc/soan_boi về NULL',
    n = 1 AND n2 = 0 AND pg_temp.hdc('S2', 'soan_luc') IS NULL AND pg_temp.hdc('S2', 'soan_boi') IS NULL, format('%s/%s', n, n2));
  n := danh_dau_soan_hang(NULL, true);
  PERFORM pg_temp.ghi('G3', 'mảng NULL → 0, không lỗi', n = 0, 'n=' || n);
  PERFORM pg_temp.vai('owner');
  e := pg_temp.thu(format('UPDATE sales_invoices SET soan_luc = now() WHERE id = %L', pg_temp.hd('S2')));
  PERFORM pg_temp.ghi('G4', 'UPDATE thẳng soan_luc từ trình duyệt không ăn', pg_temp.hdc('S2', 'soan_luc') IS NULL, e);
  PERFORM pg_temp.vai('e9990000-0000-0000-0000-000000000001');
  n := danh_dau_soan_hang(ARRAY[pg_temp.hd('S2')], true);
  PERFORM pg_temp.ghi('G4', 'chủ NPP khác không đánh dấu được HĐ của NPP này (0 dòng)', n = 0 AND pg_temp.hdc('S2', 'soan_luc') IS NULL, 'n=' || n);
  PERFORM pg_temp.vai('owner');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('G', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ H. LƯỢT SOẠN (mig 225) ═════════════════════
DO $t$ DECLARE l1 uuid; l2 uuid; e text; v luot_soan; n int; dd text := to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM'); BEGIN
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT tao_luot_soan(ARRAY[%L]::uuid[])', pg_temp.hd('S2')));
  PERFORM pg_temp.ghi('H1', 'NVBH không tạo lượt soạn được', e LIKE 'KHONG_DU_QUYEN%', left(e, 40));
  PERFORM pg_temp.vai('warehouse');
  l1 := tao_luot_soan(ARRAY[pg_temp.hd('S2'), pg_temp.hd('S2'), pg_temp.hd('S1')]);
  SELECT * INTO v FROM luot_soan WHERE id = l1;
  PERFORM pg_temp.ghi('H1', 'tạo lượt: bỏ trùng, giữ thứ tự rổ [S2, S1], mã SH-' || dd || '-01, đang soạn',
    v.invoice_ids = ARRAY[pg_temp.hd('S2'), pg_temp.hd('S1')] AND v.ma = 'SH-' || dd || '-01' AND v.trang_thai = 'dang_soan'
    AND v.created_by = 'e0000000-0000-0000-0000-000000000005', v.ma || ' ' || array_length(v.invoice_ids, 1));
  l2 := tao_luot_soan(ARRAY[pg_temp.hd('S1')]);
  PERFORM pg_temp.ghi('H1', 'lượt thứ hai trong ngày → -02', (SELECT ma FROM luot_soan WHERE id = l2) = 'SH-' || dd || '-02', (SELECT ma FROM luot_soan WHERE id = l2));
  e := pg_temp.thu(format('SELECT tao_luot_soan(ARRAY[%L]::uuid[])', pg_temp.c('S3.hd')));
  PERFORM pg_temp.ghi('H2', 'HĐ đã huỷ → HOA_DON_KHONG_HOP_LE', e LIKE 'HOA_DON_KHONG_HOP_LE%', left(e, 40));
  e := pg_temp.thu('SELECT tao_luot_soan(ARRAY[]::uuid[])');
  PERFORM pg_temp.ghi('H2', 'không chọn HĐ → CHUA_CHON_HOA_DON', e LIKE 'CHUA_CHON_HOA_DON%', e);
  e := pg_temp.thu('SELECT tao_luot_soan(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 27)))');
  PERFORM pg_temp.ghi('H2', '27 HĐ (> rổ A–Z) → QUA_NHIEU_RO', e LIKE 'QUA_NHIEU_RO%', left(e, 40));
  -- Gộp tiến độ theo khoá
  PERFORM cap_nhat_luot_soan(l1, NULL, '{"p1": 24}'::jsonb, NULL);
  PERFORM cap_nhat_luot_soan(l1, NULL, '{"p2": 10}'::jsonb, jsonb_build_object('p2|' || pg_temp.hd('S2'), true));
  SELECT * INTO v FROM luot_soan WHERE id = l1;
  PERFORM pg_temp.ghi('H3', 'hai máy cập nhật hai mặt hàng khác nhau không đè: nhat {p1:24, p2:10}, chia 1 khoá',
    v.tien_do->'nhat' = '{"p1": 24, "p2": 10}'::jsonb AND (SELECT count(*) FROM jsonb_object_keys(v.tien_do->'chia')) = 1, v.tien_do::text);
  PERFORM cap_nhat_luot_soan(l1, NULL, '{"p1": null}'::jsonb, NULL);
  SELECT * INTO v FROM luot_soan WHERE id = l1;
  PERFORM pg_temp.ghi('H3', 'giá trị null = xoá khoá', v.tien_do->'nhat' = '{"p2": 10}'::jsonb, v.tien_do->>'nhat');
  e := pg_temp.thu(format('SELECT cap_nhat_luot_soan(%L, ARRAY[%L]::uuid[])', l1, pg_temp.c('S3.hd')));
  PERFORM pg_temp.ghi('H3', 'đổi danh sách sang HĐ huỷ → HOA_DON_KHONG_HOP_LE', e LIKE 'HOA_DON_KHONG_HOP_LE%', left(e, 40));
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('H4', 'NVBH không đọc được lượt soạn (RLS)', (SELECT count(*) FROM luot_soan WHERE id = l1) = 0, '');
  e := pg_temp.thu(format('SELECT hoan_tat_luot_soan(%L)', l1));
  PERFORM pg_temp.ghi('H4', 'NVBH không hoàn tất lượt được', e LIKE 'KHONG_DU_QUYEN%', left(e, 40));
  e := pg_temp.thu(format('UPDATE luot_soan SET trang_thai = %L WHERE id = %L', 'xong', l1));
  PERFORM pg_temp.ghi('H4', 'trình duyệt không UPDATE thẳng luot_soan', pg_temp.chu(format('SELECT trang_thai FROM luot_soan WHERE id = %L', l1)) = 'dang_soan', left(e, 50));
  PERFORM pg_temp.vai('warehouse');
  n := hoan_tat_luot_soan(l1);
  PERFORM pg_temp.ghi('H5', 'hoàn tất: lượt xong, đánh dấu S2 (S1 đã có dấu → không đếm) = 1',
    n = 1 AND (SELECT trang_thai FROM luot_soan WHERE id = l1) = 'xong' AND pg_temp.hdc('S2', 'soan_luc') IS NOT NULL
    AND (SELECT xong_boi FROM luot_soan WHERE id = l1) = 'e0000000-0000-0000-0000-000000000005', 'n=' || n);
  PERFORM pg_temp.ghi('H5', 'hoàn tất KHÔNG trừ kho lần nữa, không đổi công nợ, không đổi giờ sửa HĐ',
    pg_temp.so('SELECT sum(qty_on_hand) FROM batches') = pg_temp.so('SELECT ton FROM moc_kho')
    AND pg_temp.so('SELECT sum(amount) FROM receivables') = pg_temp.so('SELECT no FROM moc_kho')
    AND pg_temp.so('SELECT count(*) FROM sales_invoices s JOIN moc m USING (id) WHERE s.updated_at IS DISTINCT FROM m.updated_at') = 0, '');
  e := pg_temp.thu(format('SELECT hoan_tat_luot_soan(%L)', l1));
  PERFORM pg_temp.ghi('H6', 'hoàn tất lần hai → LUOT_DA_DONG', e LIKE 'LUOT_DA_DONG%', left(e, 40));
  e := pg_temp.thu(format('SELECT cap_nhat_luot_soan(%L, NULL, %L::jsonb)', l1, '{"p9": 1}'));
  PERFORM pg_temp.ghi('H6', 'cập nhật lượt đã xong → LUOT_DA_DONG', e LIKE 'LUOT_DA_DONG%', left(e, 40));
  PERFORM huy_luot_soan(l2);
  e := pg_temp.thu(format('SELECT huy_luot_soan(%L)', l2));
  PERFORM pg_temp.ghi('H7', 'huỷ lượt → huy; huỷ lần hai → KHONG_TIM_THAY_LUOT',
    (SELECT trang_thai FROM luot_soan WHERE id = l2) = 'huy' AND e LIKE 'KHONG_TIM_THAY_LUOT%', left(e, 40));
  PERFORM pg_temp.vai('owner');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('H', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ I. SỬA HĐ CÓ PHIẾU TỰ SINH ĐÃ NHẬP KHO (mig 210/216) ═════════════════════
DO $t$ DECLARE e text; c0 numeric; r record; BEGIN
  PERFORM pg_temp.ghi('I0', 'chuẩn bị: phiếu tự sinh đã nhập kho (completed), nợ HĐ = 200.000 − 20.000 = 180.000',
    pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('R1.ret'))) = 'completed' AND pg_temp.rc('R1', 'amount')::numeric = 180000,
    pg_temp.rc('R1', 'amount'));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', pg_temp.hd('R1'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('R1', 1, 15)))));
  PERFORM pg_temp.ghi('I1', 'chưa chọn Có/Không → REISSUE_RETURN_STOCKED', e LIKE 'REISSUE_RETURN_STOCKED%', left(e, 60));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', pg_temp.hd('R1'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('R1', 1, 15)), 'tra_da_nhap', 'bay_ba')));
  PERFORM pg_temp.ghi('I1', 'giá trị lạ → BAD_TRA_DA_NHAP', e LIKE 'BAD_TRA_DA_NHAP%', left(e, 60));
  -- Có = huỷ phiếu nhập, sửa, phiếu về Chờ xử lý (không tự nhập lại)
  c0 := pg_temp.lo('SH-C');
  PERFORM reissue_invoice(pg_temp.hd('R1'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('R1', 1, 15)), 'tra_da_nhap', 'lam_lai'));
  PERFORM pg_temp.ghi('I2', 'Có: phiếu về Chờ xử lý, bám tờ mới, kho P2 đảo −4; nợ = 150.000 − 20.000 = 130.000; đơn Hoàn thành',
    pg_temp.chu(format('SELECT status || %L || (invoice_id = %L) FROM returns WHERE id = %L', '/', pg_temp.hd('R1'), pg_temp.c('R1.ret'))) = 'submitted/true'
    AND pg_temp.lo('SH-C') = c0 - 4 AND pg_temp.rc('R1', 'amount')::numeric = 130000 AND pg_temp.don('R1') = 'completed',
    format('%s SH-C %s→%s nợ %s', pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('R1.ret'))), c0, pg_temp.lo('SH-C'), pg_temp.rc('R1', 'amount')));
  -- Không = giữ phiếu nhập, gắn sang tờ mới
  c0 := pg_temp.lo('SH-C');
  PERFORM reissue_invoice(pg_temp.hd('R2'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('R2', 1, 15)), 'tra_da_nhap', 'giu'));
  PERFORM pg_temp.ghi('I3', 'Không: phiếu giữ Hoàn thành + tự sinh, bám tờ mới, kho không đổi; nợ 130.000',
    pg_temp.chu(format('SELECT status || %L || credit_with_invoice || %L || (invoice_id = %L) FROM returns WHERE id = %L', '/', '/', pg_temp.hd('R2'), pg_temp.c('R2.ret'))) = 'completed/true/true'
    AND pg_temp.lo('SH-C') = c0 AND pg_temp.rc('R2', 'amount')::numeric = 130000,
    format('SH-C %s→%s nợ %s', c0, pg_temp.lo('SH-C'), pg_temp.rc('R2', 'amount')));
  -- Huỷ phiếu tự sinh ĐÃ nhập kho: đảo kho, về Chờ xử lý, nợ giữ nguyên
  c0 := pg_temp.lo('SH-C');
  PERFORM cancel_return(pg_temp.c('R3.ret'), 'nhập nhầm kho');
  PERFORM pg_temp.ghi('I4', 'huỷ phiếu tự sinh đã nhập: kho −4, phiếu về Chờ xử lý, nợ HĐ giữ 180.000',
    pg_temp.lo('SH-C') = c0 - 4 AND pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('R3.ret'))) = 'submitted'
    AND pg_temp.rc('R3', 'amount')::numeric = 180000,
    format('SH-C %s→%s nợ %s', c0, pg_temp.lo('SH-C'), pg_temp.rc('R3', 'amount')));
  -- Sau khi phiếu về Chờ xử lý → huỷ HĐ được, phiếu huỷ theo, đơn huỷ
  PERFORM cancel_invoice(pg_temp.hd('R3'), 'khách trả hết');
  PERFORM pg_temp.ghi('I5', 'huỷ HĐ R3: đơn Đã huỷ, phiếu Đã huỷ, nợ khách 0',
    pg_temp.don('R3') = 'cancelled' AND pg_temp.chu(format('SELECT status FROM returns WHERE id = %L', pg_temp.c('R3.ret'))) = 'cancelled'
    AND pg_temp.no_kh('R3') = 0, pg_temp.don('R3'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('I', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- J. Sửa HĐ khi HĐ điện tử đã phát hành → khoá, tờ giữ nguyên
RESET ROLE;
INSERT INTO invoices (org_id, customer_name, sales_invoice_id, status, misa_inv_no) SELECT org_id, 'Khách S2', id, 'draft', '0000123' FROM sales_invoices WHERE id = pg_temp.hd('S2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');
DO $t$ DECLARE e text; h uuid := pg_temp.hd('S2'); BEGIN
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', h, jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('S2', 1, 5)))));
  PERFORM pg_temp.ghi('J1', 'MISA đã cấp số → sửa HĐ bị LOCKED_EINVOICE, tờ vẫn ghi sổ', e LIKE 'LOCKED_EINVOICE%' AND pg_temp.hd('S2') = h, left(e, 50));
END $t$;

RESET ROLE;
SELECT stt, buoc AS "B", CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
