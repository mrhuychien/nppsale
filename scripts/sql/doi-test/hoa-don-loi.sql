-- ĐỘI TEST HOÁ ĐƠN — LỖI ĐÃ XÁC MINH (để ĐỎ tới khi sửa xong; sửa xong chạy lại phải xanh).
--
-- LỖI 1: post_invoice không có invoice_date thì lấy `current_date` theo MÚI GIỜ PHIÊN Postgres (Supabase = UTC),
--   không theo giờ VN. Màn Xuất hàng ở đơn (src/components/orders/invoice-editor.tsx:523) và Xuất hàng loạt
--   ở danh sách đơn (src/app/(dashboard)/orders/page.tsx:1008) KHÔNG gửi invoice_date → HĐ xuất từ 00:00 tới
--   06:59 giờ VN mang ngày HÔM TRƯỚC (doanh thu, hạn nợ, ngày trừ hàng trả tự sinh lệch một ngày).
--   Luật: CLAUDE.md §1 "Doanh thu tính theo HÓA ĐƠN … theo invoice_date … invoice_date là DATE: so bằng ngày theo
--   giờ VN (vnDateKey)". Các chỗ khác trong DB đã theo giờ VN (returns.return_date mặc định
--   (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date; mã phiếu kho; mã lượt soạn).
--   Chỗ mã: post_invoice `v_date := COALESCE((p->>'invoice_date')::date, current_date);` (mig 125 dòng 493, chép lại
--   ở các bản thay sau) và _wf2b_recompute_receivable `COALESCE(v.invoice_date, current_date)`.
--   Cách thử tất định: hai múi giờ cách nhau 25 tiếng (UTC+14 và UTC−11) — ngày VN luôn khác ít nhất một trong
--   hai, nên ít nhất một phép kiểm ĐỎ bất kể chạy lúc nào. Trên Supabase thật (UTC) lỗi lộ ra mỗi sáng 0h–7h VN.
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_hoa_don -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/hoa-don-loi.sql
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

INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'LOI-C', pg_temp.hn() + 300, 1000, 1000, 3000, 'sale', now());
SELECT pg_temp.tao_don('L1', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]') IS NOT NULL AS tao_l1;
SELECT pg_temp.tao_don('L2', '[{"p":"c0000000-0000-0000-0000-000000000002","u":"lon","sl":10,"gia":10000}]') IS NOT NULL AS tao_l2;
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner') IS NULL AS vai;

-- Xuất như màn invoice-editor: KHÔNG gửi invoice_date.
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
SELECT count(*) AS xuat_l1 FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('L1'), 'lines', jsonb_build_array(pg_temp.dl('L1', 1, 10))));
SET LOCAL TIME ZONE 'Pacific/Pago_Pago';
SELECT count(*) AS xuat_l2 FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('L2'), 'lines', jsonb_build_array(pg_temp.dl('L2', 1, 10))));
SET LOCAL TIME ZONE 'UTC';

DO $t$ BEGIN
  PERFORM pg_temp.ghi('LOI1', 'HĐ xuất không kèm ngày (phiên UTC+14) mang NGÀY VN', pg_temp.hdc('L1', 'invoice_date')::date = pg_temp.hn(),
    format('invoice_date %s, ngày VN %s', pg_temp.hdc('L1', 'invoice_date'), pg_temp.hn()));
  PERFORM pg_temp.ghi('LOI1', 'HĐ xuất không kèm ngày (phiên UTC−11) mang NGÀY VN', pg_temp.hdc('L2', 'invoice_date')::date = pg_temp.hn(),
    format('invoice_date %s, ngày VN %s', pg_temp.hdc('L2', 'invoice_date'), pg_temp.hn()));
  PERFORM pg_temp.ghi('LOI1', 'hạn công nợ = ngày VN + 30 cho cả hai', pg_temp.rc('L1', 'due_date')::date = pg_temp.hn() + 30
      AND pg_temp.rc('L2', 'due_date')::date = pg_temp.hn() + 30,
    format('hạn L1 %s, L2 %s', pg_temp.rc('L1', 'due_date'), pg_temp.rc('L2', 'due_date')));
END $t$;

RESET ROLE;
SELECT stt, buoc AS "B", CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY stt;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
