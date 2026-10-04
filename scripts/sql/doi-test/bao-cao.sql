-- ====================================================================
-- ĐỘI TEST "BÁO CÁO" — bộ chống lỗi lâu dài cho số liệu doanh thu / doanh số thuần / công nợ ở
-- MÁY CHỦ: dashboard_summary, dashboard_top_customers, dashboard_channel_revenue (mig 126/192),
-- finance_pnl (doanh thu thuần + giá vốn hàng trả), bao_cao_so_ban / bao_cao_cong_no /
-- bao_cao_ton_kho (mig 204/218), đối soát doanh số ↔ công nợ theo NV, quyền theo vai.
--
-- Luật (CLAUDE.md §1):
--   · Doanh thu = Σ sales_invoices.total của HĐ 'posted' theo invoice_date (DATE, giờ VN).
--   · Doanh số THUẦN = đi − trả; trả theo returns.revenue_date (tự sinh = ngày HĐ kể cả Chờ xử lý;
--     tự lập = ngày hoàn thành), tiền credit_note_amount (hàng đổi không tính).
--   · Huỷ HĐ = không còn doanh thu; Sửa HĐ = chỉ tờ mới tính.
--   · Công nợ = Σ(amount − paid) phiếu chưa 'paid', KHÔNG kẹp 0 (dư có âm).
--   · Báo cáo theo NV khớp công nợ NV (scripts/sql/doi-soat-doanh-so-cong-no-nv.sql).
--
-- Chạy (DB thử của đội, KHÔNG chạy trên Supabase):
--   psql -h /tmp/pgtest -p 55432 -U postgres -d npp_bao_cao -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/bao-cao.sql
-- Bọc BEGIN … ROLLBACK; in bảng kq (ok = true là ĐẠT) + dòng tổng.
-- ====================================================================
\set ON_ERROR_STOP on
\pset pager off
SET client_min_messages = warning;
-- Supabase chạy giờ UTC — ép cho giống.
SET TIME ZONE 'UTC';

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
CREATE TEMP TABLE kq (stt serial, buoc text, ten text, ok boolean, ghi text);
GRANT ALL ON kq TO authenticated;
GRANT ALL ON SEQUENCE kq_stt_seq TO authenticated;

\ir bao-cao-du-lieu.sql

CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), g) $f$;

-- Chạy câu q dưới vai user n (1 owner, 2 manager, 3 accountant, 4 sales A, 5 warehouse, 6 sales B,
-- 9 chủ NPP khác) với role authenticated; trả kết quả jsonb (một ô) hoặc {"loi": "..."}.
CREATE FUNCTION pg_temp.vai_j(n int, q text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', CASE WHEN n = 9 THEN 'e9990000-0000-0000-0000-0000000000b1' ELSE pg_temp.u(n)::text END, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE q INTO v;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.chu();
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.chu();
  RETURN jsonb_build_object('loi', SQLERRM);
END $f$;
CREATE FUNCTION pg_temp.anon_j(q text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('role', 'anon', true);
  EXECUTE q INTO v;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.chu();
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.chu();
  RETURN jsonb_build_object('loi', SQLERRM);
END $f$;
-- Chạy câu (chủ NPP); trả lỗi hoặc NULL.
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.chu();
  EXECUTE q;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN split_part(SQLERRM, ':', 1);
END $f$;

-- Đọc nhanh kết quả bao_cao_so_ban (vai đang đóng).
CREATE FUNCTION pg_temp.sb(a date, b date) RETURNS jsonb LANGUAGE sql AS $f$ SELECT bao_cao_so_ban(a, b) $f$;
CREATE FUNCTION pg_temp.n(j jsonb, key text) RETURNS int LANGUAGE sql IMMUTABLE AS
  $f$ SELECT COALESCE(jsonb_array_length(j->key), 0) $f$;
CREATE FUNCTION pg_temp.tong(j jsonb, key text, cot text) RETURNS numeric LANGUAGE sql IMMUTABLE AS
  $f$ SELECT COALESCE(sum((x->>cot)::numeric), 0) FROM jsonb_array_elements(COALESCE(j->key, '[]')) x $f$;
CREATE FUNCTION pg_temp.co_id(j jsonb, key text, id uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS
  $f$ SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(j->key, '[]')) x WHERE x->>'id' = id::text) $f$;
CREATE FUNCTION pg_temp.ds() RETURNS jsonb LANGUAGE sql AS
  $f$ SELECT to_jsonb(d) FROM dashboard_summary(pg_temp.hn() - 5) d $f$;
CREATE FUNCTION pg_temp.no_mo() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE status <> 'paid' $f$;

-- Chủ NPP của tổ chức khác (để thử cô lập tổ chức).
DO $d$ DECLARE v_org uuid; BEGIN
  INSERT INTO organizations (name, slug) VALUES ('NPP khác đội báo cáo', 'npp-khac-bao-cao') RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email) VALUES ('e9990000-0000-0000-0000-0000000000b1', 'khac-bc@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e9990000-0000-0000-0000-0000000000b1', v_org, 'Chủ khác', 'owner');
END $d$;

-- ====================================================================
-- A. DOANH THU THEO HOÁ ĐƠN ĐÃ GHI SỔ (bao_cao_so_ban)
-- ====================================================================
DO $t$ DECLARE j jsonb; T date := pg_temp.hn(); BEGIN
  j := pg_temp.sb(T - 5, T);
  PERFORM pg_temp.ghi('A1', 'kỳ K: 4 HĐ đã ghi sổ (H2, H3, H5 tờ mới, H6), Σ total = 445.000 + 500.000 + 80.000 + 14.000 = 1.039.000',
    pg_temp.n(j, 'hd') = 4 AND pg_temp.tong(j, 'hd', 'total') = 1039000,
    format('%s HĐ, Σ %s', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total')));
  PERFORM pg_temp.ghi('A2', 'HĐ huỷ (H4) và tờ cũ của HĐ đã sửa (H5 100.000) không vào doanh thu; tờ mới H5 = 80.000 có',
    NOT pg_temp.co_id(j, 'hd', pg_temp.c('H4.hd')) AND NOT pg_temp.co_id(j, 'hd', pg_temp.c('H5.hd0')) AND pg_temp.co_id(j, 'hd', pg_temp.c('H5.hd'))
      AND (SELECT (x->>'total')::numeric FROM jsonb_array_elements(j->'hd') x WHERE x->>'id' = pg_temp.c('H5.hd')::text) = 80000,
    format('H4 %s, H5 cũ %s, H5 mới %s', pg_temp.co_id(j, 'hd', pg_temp.c('H4.hd')), pg_temp.co_id(j, 'hd', pg_temp.c('H5.hd0')), pg_temp.co_id(j, 'hd', pg_temp.c('H5.hd'))));
  PERFORM pg_temp.ghi('A3', 'mốc kỳ: H6 (ngày T-5, đúng mốc đầu) vào, H7 (T-6) không vào',
    pg_temp.co_id(j, 'hd', pg_temp.c('H6.hd')) AND NOT pg_temp.co_id(j, 'hd', pg_temp.c('H7.hd')),
    format('H6 %s, H7 %s', pg_temp.co_id(j, 'hd', pg_temp.c('H6.hd')), pg_temp.co_id(j, 'hd', pg_temp.c('H7.hd'))));
  j := pg_temp.sb(T - 6, T - 6);
  PERFORM pg_temp.ghi('A3', 'kỳ một ngày T-6: chỉ H7 14.000', pg_temp.n(j, 'hd') = 1 AND pg_temp.co_id(j, 'hd', pg_temp.c('H7.hd')) AND pg_temp.tong(j, 'hd', 'total') = 14000,
    format('%s HĐ, Σ %s', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total')));
  j := pg_temp.sb(T - 40, T - 30);
  PERFORM pg_temp.ghi('A4', 'kỳ trước P: chỉ H1 585.000; R1 (trả hàng của H1 nhưng hoàn thành hôm nay) KHÔNG trừ vào kỳ P',
    pg_temp.n(j, 'hd') = 1 AND pg_temp.tong(j, 'hd', 'total') = 585000 AND pg_temp.n(j, 'tra') = 0,
    format('%s HĐ Σ %s, %s phiếu trả', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total'), pg_temp.n(j, 'tra')));
  PERFORM pg_temp.ghi('A5', 'dòng H1: 2 dòng, dòng thùng giữ hệ số chụp 24, SL 2, đơn giá 240.000, line_total 480.000 (trước thuế)',
    pg_temp.n(j, 'dong_hd') = 2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'dong_hd') x
       WHERE x->>'unit_name' = 'Thung 24' AND (x->>'conversion_factor')::numeric = 24 AND (x->>'quantity')::numeric = 2
         AND (x->>'unit_price')::numeric = 240000 AND (x->>'line_total')::numeric = 480000),
    (j->'dong_hd')::text);
  j := pg_temp.sb(T - 3, T - 3);
  PERFORM pg_temp.ghi('A6', 'H2 (VAT 10%, giảm cả đơn 50.000): total 445.000 = subtotal 400.000 + vat 45.000; Σ line_total − subtotal = giảm 50.000',
    pg_temp.tong(j, 'hd', 'total') = 445000 AND pg_temp.tong(j, 'hd', 'subtotal') = 400000 AND pg_temp.tong(j, 'hd', 'vat') = 45000
      AND pg_temp.tong(j, 'dong_hd', 'line_total') - pg_temp.tong(j, 'hd', 'subtotal') = 50000,
    format('total %s subtotal %s vat %s Σdòng %s', pg_temp.tong(j, 'hd', 'total'), pg_temp.tong(j, 'hd', 'subtotal'), pg_temp.tong(j, 'hd', 'vat'), pg_temp.tong(j, 'dong_hd', 'line_total')));
  j := pg_temp.sb(T + 1, T + 30);
  PERFORM pg_temp.ghi('A7', 'kỳ tương lai: không HĐ, không phiếu trả, không giá vốn', pg_temp.n(j, 'hd') + pg_temp.n(j, 'tra') + pg_temp.n(j, 'gv') = 0, j::text);
  j := pg_temp.sb(T, T - 5);
  PERFORM pg_temp.ghi('A7', 'kỳ đảo ngược (từ > đến): rỗng, không nổ', pg_temp.n(j, 'hd') = 0, format('%s HĐ', pg_temp.n(j, 'hd')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- B. HÀNG TRẢ theo revenue_date
-- ====================================================================
DO $t$ DECLARE j jsonb; T date := pg_temp.hn(); BEGIN
  j := pg_temp.sb(T - 5, T);
  PERFORM pg_temp.ghi('B1', 'kỳ K: 3 phiếu trừ doanh số (tự sinh H3, R1, R4), Σ credit = 100.000 + 264.000 + 70.000 = 434.000',
    pg_temp.n(j, 'tra') = 3 AND pg_temp.tong(j, 'tra', 'credit_note_amount') = 434000
      AND pg_temp.co_id(j, 'tra', pg_temp.c('H3.tra')) AND pg_temp.co_id(j, 'tra', pg_temp.c('R1')) AND pg_temp.co_id(j, 'tra', pg_temp.c('R4')),
    format('%s phiếu, Σ %s', pg_temp.n(j, 'tra'), pg_temp.tong(j, 'tra', 'credit_note_amount')));
  PERFORM pg_temp.ghi('B2', 'phiếu tự sinh H3 còn Chờ xử lý vẫn trừ vào NGÀY HĐ (T-2)',
    (SELECT status FROM returns WHERE id = pg_temp.c('H3.tra')) = 'submitted' AND (SELECT revenue_date FROM returns WHERE id = pg_temp.c('H3.tra')) = T - 2,
    format('%s / %s', (SELECT status FROM returns WHERE id = pg_temp.c('H3.tra')), (SELECT revenue_date FROM returns WHERE id = pg_temp.c('H3.tra'))));
  PERFORM pg_temp.ghi('B3', 'R1 tự lập gắn HĐ kỳ trước: trừ vào ngày HOÀN THÀNH (T), credit 264.000 = 240.000 + VAT 10%, hàng đổi 0đ',
    (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R1')) = T AND (SELECT credit_note_amount FROM returns WHERE id = pg_temp.c('R1')) = 264000,
    format('%s / %s', (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R1')), (SELECT credit_note_amount FROM returns WHERE id = pg_temp.c('R1'))));
  PERFORM pg_temp.ghi('B4', 'R2 Nháp và R3 Đã huỷ: revenue_date NULL, không có trong số trả',
    (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R2')) IS NULL AND (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R3')) IS NULL
      AND NOT pg_temp.co_id(j, 'tra', pg_temp.c('R2')) AND NOT pg_temp.co_id(j, 'tra', pg_temp.c('R3')),
    format('R2 %s, R3 %s', (SELECT status FROM returns WHERE id = pg_temp.c('R2')), (SELECT status FROM returns WHERE id = pg_temp.c('R3'))));
  PERFORM pg_temp.ghi('B5', 'dòng trả: 3 dòng (bỏ dòng hàng ĐỔI của R1), dòng R1 có đơn giá trước thuế 240.000 và line_total 264.000',
    pg_temp.n(j, 'dong_tra') = 3
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'dong_tra') x WHERE x->>'return_id' = pg_temp.c('R1')::text AND x->>'unit_name' = 'lon')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'dong_tra') x WHERE x->>'return_id' = pg_temp.c('R1')::text
                    AND (x->>'unit_price')::numeric = 240000 AND (x->>'line_total')::numeric = 264000),
    (j->'dong_tra')::text);
  PERFORM pg_temp.ghi('B6', 'giá vốn hàng trả ĐÃ NHẬP KHO: R4 = 5 × 9.000 = 45.000; H3 tự sinh chưa nhập kho → không có giá vốn trả',
    (SELECT sum((x->>'tien')::numeric) FROM jsonb_array_elements(j->'gv_tra') x WHERE x->>'return_id' = pg_temp.c('R4')::text) = 45000
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'gv_tra') x WHERE x->>'return_id' = pg_temp.c('H3.tra')::text),
    (j->'gv_tra')::text);
  PERFORM pg_temp.ghi('B7', 'giá vốn bình quân cơ sở P1 trong kỳ = 7.000/lon (tiền / SL cơ sở)',
    (SELECT (x->>'tien')::numeric / NULLIF((x->>'sl')::numeric, 0) FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P1')::text) = 7000,
    (j->'gv')::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- C. dashboard_summary — doanh thu THUẦN, số đơn đã xuất HĐ, công nợ đang mở
-- ====================================================================
DO $t$ DECLARE d jsonb; T date := pg_temp.hn(); BEGIN
  d := pg_temp.ds();
  PERFORM pg_temp.ghi('C1', 'từ T-5: doanh thu thuần = 1.039.000 − 434.000 = 605.000; 4 đơn đã xuất HĐ',
    (d->>'period_revenue')::numeric = 605000 AND (d->>'period_orders')::int = 4, d::text);
  d := (SELECT to_jsonb(x) FROM dashboard_summary(T - 40) x);
  PERFORM pg_temp.ghi('C2', 'từ T-40: 1.039.000 + 585.000 + 14.000 − 434.000 = 1.204.000; 6 đơn (H4 huỷ không đếm, H5 đếm 1 lần)',
    (d->>'period_revenue')::numeric = 1204000 AND (d->>'period_orders')::int = 6, d::text);
  PERFORM pg_temp.ghi('C3', 'công nợ mở = Σ(amount − paid) KHÔNG kẹp 0: 321.000 + 445.000 + 400.000 + 80.000 + 14.000 + 14.000 − 70.000 = 1.204.000',
    (d->>'open_receivables')::numeric = 1204000 AND pg_temp.no_mo() = 1204000, format('%s / sổ %s', d->>'open_receivables', pg_temp.no_mo()));
  d := (SELECT to_jsonb(x) FROM dashboard_summary(T + 1) x);
  PERFORM pg_temp.ghi('C4', 'từ ngày mai: doanh thu 0, 0 đơn; công nợ mở vẫn 1.204.000 (không theo kỳ)',
    (d->>'period_revenue')::numeric = 0 AND (d->>'period_orders')::int = 0 AND (d->>'open_receivables')::numeric = 1204000, d::text);
  -- Thu đủ H2 445.000, thu một phần H3 100.000
  PERFORM pg_temp.chu();
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c('KH2'), 'method', 'cash',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = pg_temp.c('H2.hd')), 'amount', 445000))));
  PERFORM create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c('KH3'), 'method', 'cash',
    'lines', jsonb_build_array(jsonb_build_object('receivable_id', (SELECT id FROM receivables WHERE invoice_id = pg_temp.c('H3.hd')), 'amount', 100000))));
  d := pg_temp.ds();
  PERFORM pg_temp.ghi('C5', 'thu 445.000 (H2 đủ) + 100.000 (H3 một phần): công nợ mở 1.204.000 − 545.000 = 659.000; doanh thu VẪN 605.000',
    (d->>'open_receivables')::numeric = 659000 AND (d->>'period_revenue')::numeric = 605000
      AND (SELECT status FROM receivables WHERE invoice_id = pg_temp.c('H2.hd')) = 'paid',
    d::text || ' H2 ' || (SELECT status FROM receivables WHERE invoice_id = pg_temp.c('H2.hd')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- D. finance_pnl — doanh thu thuần / gộp / hàng trả
-- ====================================================================
DO $t$ DECLARE p record; T date := pg_temp.hn(); BEGIN
  SELECT * INTO p FROM finance_pnl(T - 5, T);
  PERFORM pg_temp.ghi('D1', 'P&L kỳ K: revenue (thuần) 605.000 = gộp 1.039.000 − trả 434.000; 4 đơn',
    p.revenue = 605000 AND p.revenue_gross = 1039000 AND p.returns_value = 434000 AND p.order_count = 4,
    format('rev %s gross %s ret %s n %s', p.revenue, p.revenue_gross, p.returns_value, p.order_count));
  PERFORM pg_temp.ghi('D2', 'P&L = dashboard_summary cùng kỳ (không có chứng từ sau T): 605.000',
    p.revenue = (pg_temp.ds()->>'period_revenue')::numeric, format('%s vs %s', p.revenue, pg_temp.ds()->>'period_revenue'));
  PERFORM pg_temp.ghi('D3', 'giá vốn hàng trả đã nhập kho hôm nay: R1 (24 lon + 2 lon đổi) 182.000 + R4 45.000 = 227.000; R3 đã đảo không tính',
    p.returns_cogs = 227000, format('%s', p.returns_cogs));
  SELECT * INTO p FROM finance_pnl(T - 40, T - 30);
  PERFORM pg_temp.ghi('D4', 'P&L kỳ P: thuần 585.000, trả 0 (R1 trừ vào kỳ hoàn thành)', p.revenue = 585000 AND p.returns_value = 0,
    format('rev %s ret %s', p.revenue, p.returns_value));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- E. Top khách / kênh (thuần)
-- ====================================================================
DO $t$ DECLARE T date := pg_temp.hn(); v_top text; v_ch numeric; BEGIN
  SELECT string_agg(store_name || '=' || total::bigint, ', ' ORDER BY total DESC) INTO v_top FROM dashboard_top_customers(T - 5, 10);
  PERFORM pg_temp.ghi('E1', 'top khách thuần: KH3 500.000 − 100.000 = 400.000 > KH2 459.000 − 70.000 = 389.000 > KH1 80.000 − 264.000 = −184.000',
    v_top = 'KH3 đội báo cáo=400000, KH2 đội báo cáo=389000, KH1 đội báo cáo=-184000', v_top);
  PERFORM pg_temp.ghi('E2', 'top khách: H2 + H6 của KH2 = 2 đơn; H5 sửa vẫn 1 đơn của KH1',
    (SELECT order_count FROM dashboard_top_customers(T - 5, 10) WHERE customer_id = pg_temp.c('KH2')) = 2
      AND (SELECT order_count FROM dashboard_top_customers(T - 5, 10) WHERE customer_id = pg_temp.c('KH1')) = 1,
    format('KH2 %s, KH1 %s', (SELECT order_count FROM dashboard_top_customers(T - 5, 10) WHERE customer_id = pg_temp.c('KH2')),
      (SELECT order_count FROM dashboard_top_customers(T - 5, 10) WHERE customer_id = pg_temp.c('KH1'))));
  PERFORM pg_temp.ghi('E3', 'top khách p_limit 1 → đúng 1 dòng (KH3)',
    (SELECT count(*) FROM dashboard_top_customers(T - 5, 1)) = 1 AND (SELECT customer_id FROM dashboard_top_customers(T - 5, 1)) = pg_temp.c('KH3'),
    format('%s dòng', (SELECT count(*) FROM dashboard_top_customers(T - 5, 1))));
  SELECT string_agg(channel || '=' || total::bigint, ', ' ORDER BY channel) INTO v_top FROM dashboard_channel_revenue(T - 5);
  SELECT sum(total) INTO v_ch FROM dashboard_channel_revenue(T - 5);
  PERFORM pg_temp.ghi('E4', 'kênh thuần: Khác 400.000 · Siêu thị 389.000 · Tạp hoá −184.000; Σ kênh = doanh thu thuần 605.000',
    v_top = 'Khác=400000, Siêu thị=389000, Tạp hoá=-184000' AND v_ch = 605000, v_top || format(' Σ %s', v_ch));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- F. Doanh số NV khớp công nợ NV (toàn thời gian, trước thu tiền)
-- ====================================================================
DO $t$ DECLARE T date := pg_temp.hn(); r record; v_lech int := 0; v_ghi text := ''; BEGIN
  FOR r IN
    WITH inv AS (SELECT sales_user_id uid, sum(total) ban FROM sales_invoices WHERE status = 'posted' GROUP BY 1),
         tra AS (SELECT sales_user_id uid, sum(credit_note_amount) tra FROM returns WHERE revenue_date IS NOT NULL GROUP BY 1),
         rc  AS (SELECT sales_user_id uid, sum(amount) FILTER (WHERE invoice_id IS NOT NULL OR return_id IS NOT NULL) no FROM receivables GROUP BY 1),
         k AS (SELECT uid FROM inv UNION SELECT uid FROM tra UNION SELECT uid FROM rc)
    SELECT k.uid, COALESCE(inv.ban, 0) - COALESCE(tra.tra, 0) AS thuan, COALESCE(rc.no, 0) AS no
    FROM k LEFT JOIN inv USING (uid) LEFT JOIN tra USING (uid) LEFT JOIN rc USING (uid)
  LOOP
    v_ghi := v_ghi || format('[%s thuần %s nợ %s] ', right(COALESCE(r.uid::text, '-'), 2), r.thuan, r.no);
    IF r.thuan <> r.no THEN v_lech := v_lech + 1; END IF;
  END LOOP;
  PERFORM pg_temp.ghi('F1', 'mỗi NV: doanh số thuần toàn thời gian = Σ phát sinh công nợ (HĐ + phiếu trả); A 804.000, B 400.000',
    v_lech = 0 AND v_ghi LIKE '%[04 thuần 804000 nợ 804000]%' AND v_ghi LIKE '%[06 thuần 400000 nợ 400000]%', v_ghi);
  PERFORM pg_temp.ghi('F2', 'doanh số thuần NV kỳ K: A = 445.000 + 80.000 + 14.000 − 264.000 − 70.000 = 205.000; B = 400.000; Σ = 605.000',
    (SELECT sum(total) FROM sales_invoices WHERE status = 'posted' AND invoice_date BETWEEN T - 5 AND T AND sales_user_id = pg_temp.c('NVA'))
      - (SELECT sum(credit_note_amount) FROM returns WHERE revenue_date BETWEEN T - 5 AND T AND sales_user_id = pg_temp.c('NVA')) = 205000
    AND (SELECT sum(total) FROM sales_invoices WHERE status = 'posted' AND invoice_date BETWEEN T - 5 AND T AND sales_user_id = pg_temp.c('NVB'))
      - (SELECT sum(credit_note_amount) FROM returns WHERE revenue_date BETWEEN T - 5 AND T AND sales_user_id = pg_temp.c('NVB')) = 400000,
    'xem số A/B');
  PERFORM pg_temp.ghi('F3', 'phiếu trả R1 gắn HĐ của NV A → phiếu trả mang NV A; phiếu tự sinh H3 mang NV B',
    (SELECT sales_user_id FROM returns WHERE id = pg_temp.c('R1')) = pg_temp.c('NVA') AND (SELECT sales_user_id FROM returns WHERE id = pg_temp.c('H3.tra')) = pg_temp.c('NVB'),
    format('R1 %s, H3 %s', (SELECT sales_user_id FROM returns WHERE id = pg_temp.c('R1')), (SELECT sales_user_id FROM returns WHERE id = pg_temp.c('H3.tra'))));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('F', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- G. QUYỀN — hàm SECURITY INVOKER, RLS như đọc bảng
-- ====================================================================
DO $t$ DECLARE j jsonb; T date := pg_temp.hn(); q text := format('SELECT bao_cao_so_ban(%L, %L)', T - 5, T); BEGIN
  PERFORM pg_temp.ghi('G0', 'bao_cao_so_ban / bao_cao_cong_no / bao_cao_ton_kho là SECURITY INVOKER (không vượt RLS)',
    NOT (SELECT bool_or(prosecdef) FROM pg_proc WHERE proname IN ('bao_cao_so_ban', 'bao_cao_cong_no', 'bao_cao_ton_kho')),
    'prosecdef');
  FOR i IN 1..3 LOOP
    j := pg_temp.vai_j(i, q);
    PERFORM pg_temp.ghi('G1', format('vai %s (owner/manager/accountant): thấy đủ 4 HĐ Σ 1.039.000 và 3 phiếu trả', (ARRAY['owner','manager','accountant'])[i]),
      pg_temp.n(j, 'hd') = 4 AND pg_temp.tong(j, 'hd', 'total') = 1039000 AND pg_temp.n(j, 'tra') = 3,
      format('%s HĐ Σ %s, %s trả %s', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total'), pg_temp.n(j, 'tra'), j->>'loi'));
  END LOOP;
  j := pg_temp.vai_j(4, q);
  PERFORM pg_temp.ghi('G2', 'NV A (sales): chỉ HĐ của mình H2+H5+H6 = 539.000, phiếu trả của mình R1+R4; không thấy H3 / phiếu H3 của NV B',
    pg_temp.n(j, 'hd') = 3 AND pg_temp.tong(j, 'hd', 'total') = 539000 AND pg_temp.n(j, 'tra') = 2
      AND NOT pg_temp.co_id(j, 'hd', pg_temp.c('H3.hd')) AND NOT pg_temp.co_id(j, 'tra', pg_temp.c('H3.tra')),
    format('%s HĐ Σ %s, %s trả %s', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total'), pg_temp.n(j, 'tra'), j->>'loi'));
  j := pg_temp.vai_j(6, q);
  PERFORM pg_temp.ghi('G3', 'NV B (sales): chỉ H3 500.000 và phiếu tự sinh của H3',
    pg_temp.n(j, 'hd') = 1 AND pg_temp.tong(j, 'hd', 'total') = 500000 AND pg_temp.n(j, 'tra') = 1 AND pg_temp.co_id(j, 'tra', pg_temp.c('H3.tra')),
    format('%s HĐ Σ %s, %s trả %s', pg_temp.n(j, 'hd'), pg_temp.tong(j, 'hd', 'total'), pg_temp.n(j, 'tra'), j->>'loi'));
  j := pg_temp.vai_j(4, 'SELECT to_jsonb(d) FROM dashboard_summary((now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date - 5) d');
  PERFORM pg_temp.ghi('G4', 'NV A xem dashboard: doanh thu thuần của mình 205.000; công nợ mở của mình 804.000 − 445.000 (đã thu H2) = 359.000',
    (j->>'period_revenue')::numeric = 205000 AND (j->>'open_receivables')::numeric = 359000, j::text);
  j := pg_temp.vai_j(9, q);
  PERFORM pg_temp.ghi('G5', 'chủ NPP KHÁC: không thấy HĐ / phiếu trả / giá vốn nào của NPP này',
    pg_temp.n(j, 'hd') + pg_temp.n(j, 'tra') + pg_temp.n(j, 'gv') + pg_temp.n(j, 'dong_hd') = 0 AND j->>'loi' IS NULL, j::text);
  j := pg_temp.vai_j(9, 'SELECT to_jsonb(d) FROM dashboard_summary(''2000-01-01'') d');
  PERFORM pg_temp.ghi('G5', 'chủ NPP KHÁC: dashboard_summary toàn 0',
    (j->>'period_revenue')::numeric = 0 AND (j->>'open_receivables')::numeric = 0 AND (j->>'period_orders')::int = 0, j::text);
  j := pg_temp.vai_j(9, format('SELECT bao_cao_cong_no(%L, %L)', T - 30, T - 90));
  PERFORM pg_temp.ghi('G5', 'chủ NPP KHÁC: bao_cao_cong_no rỗng', pg_temp.n(j, 'mo') + pg_temp.n(j, 'gan90') + pg_temp.n(j, 'thu') = 0, j::text);
  j := pg_temp.anon_j(q);
  PERFORM pg_temp.ghi('G6', 'anon gọi bao_cao_so_ban → permission denied', j->>'loi' ILIKE '%permission denied%', j::text);
  j := pg_temp.anon_j(format('SELECT bao_cao_cong_no(%L, %L)', T, T));
  PERFORM pg_temp.ghi('G6', 'anon gọi bao_cao_cong_no → permission denied', j->>'loi' ILIKE '%permission denied%', j::text);
  j := pg_temp.anon_j(format('SELECT bao_cao_ton_kho(%L, %L)', T, T));
  PERFORM pg_temp.ghi('G6', 'anon gọi bao_cao_ton_kho → permission denied', j->>'loi' ILIKE '%permission denied%', j::text);
  j := pg_temp.vai_j(4, format('SELECT bao_cao_cong_no(%L, %L)', T - 30, T - 90));
  PERFORM pg_temp.ghi('G7', 'NV A: bao_cao_cong_no chỉ phiếu nợ của mình (mở: H1 321.000, H5 80.000, H6, H7, R4 −70.000 = 359.000)',
    (SELECT COALESCE(sum((x->>'amount')::numeric - COALESCE((x->>'paid')::numeric, 0)), 0) FROM jsonb_array_elements(j->'mo') x) = 359000
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'mo') x WHERE x->>'sales_user_id' <> pg_temp.c('NVA')::text),
    format('%s phiếu mở', pg_temp.n(j, 'mo')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('G', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- H. bao_cao_cong_no / bao_cao_ton_kho (chủ NPP)
-- ====================================================================
DO $t$ DECLARE j jsonb; T date := pg_temp.hn(); BEGIN
  j := bao_cao_cong_no(T - 30, T - 90);
  PERFORM pg_temp.ghi('H1', 'bao_cao_cong_no.mo: Σ(amount − paid) = công nợ mở dashboard 659.000 (có dòng âm −70.000)',
    (SELECT sum((x->>'amount')::numeric - COALESCE((x->>'paid')::numeric, 0)) FROM jsonb_array_elements(j->'mo') x) = 659000
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'mo') x WHERE (x->>'amount')::numeric = -70000),
    format('%s phiếu', pg_temp.n(j, 'mo')));
  PERFORM pg_temp.ghi('H2', 'bao_cao_cong_no.thu: 2 khoản thu hôm nay Σ 545.000, mỗi khoản kèm phiếu nợ + mã HĐ',
    pg_temp.n(j, 'thu') = 2 AND pg_temp.tong(j, 'thu', 'amount') = 545000
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'thu') x WHERE x->'receivable'->'invoice'->>'invoice_code' IS NULL),
    format('%s khoản Σ %s', pg_temp.n(j, 'thu'), pg_temp.tong(j, 'thu', 'amount')));
  j := bao_cao_cong_no(T + 1, T + 1);
  PERFORM pg_temp.ghi('H3', 'bao_cao_cong_no mốc ngày mai: không khoản thu, không phiếu "gần 90 ngày"; phần "mở" không theo mốc',
    pg_temp.n(j, 'thu') = 0 AND pg_temp.n(j, 'gan90') = 0 AND pg_temp.n(j, 'mo') > 0, format('thu %s gan90 %s mo %s', pg_temp.n(j, 'thu'), pg_temp.n(j, 'gan90'), pg_temp.n(j, 'mo')));
  j := bao_cao_ton_kho(T - 40, T);
  PERFORM pg_temp.ghi('H4', 'tồn P1 = 5.000 − 58 (H1) − 10 + 10 (H5 sửa) − 8 + 26 (R1 nhập lại gồm 2 lon đổi) = 4.960',
    (SELECT sum((x->>'qty_on_hand')::numeric) FROM jsonb_array_elements(j->'lo') x WHERE x->>'product_id' = pg_temp.c('P1')::text) = 4960,
    format('%s', (SELECT sum((x->>'qty_on_hand')::numeric) FROM jsonb_array_elements(j->'lo') x WHERE x->>'product_id' = pg_temp.c('P1')::text)));
  PERFORM pg_temp.ghi('H5', 'tồn P5 = 1.000 − 30 − 1 − 1 (H4 huỷ đã hoàn) + 5 (R4); R3 nhập rồi đảo = 0 → 973',
    (SELECT sum((x->>'qty_on_hand')::numeric) FROM jsonb_array_elements(j->'lo') x WHERE x->>'product_id' = pg_temp.c('P5')::text) = 973,
    format('%s', (SELECT sum((x->>'qty_on_hand')::numeric) FROM jsonb_array_elements(j->'lo') x WHERE x->>'product_id' = pg_temp.c('P5')::text)));
  PERFORM pg_temp.ghi('H6', 'dòng bán 40 ngày: chỉ HĐ đã ghi sổ — P5 có 3 dòng (H2 30, H6 1, H7 1), không có dòng H4 đã huỷ',
    (SELECT count(*) FROM jsonb_array_elements(j->'dong') x WHERE x->>'product_id' = pg_temp.c('P5')::text) = 3
      AND (SELECT sum((x->>'quantity')::numeric) FROM jsonb_array_elements(j->'dong') x WHERE x->>'product_id' = pg_temp.c('P5')::text) = 32
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'dong') x WHERE x->>'invoice_id' IN (pg_temp.c('H4.hd')::text, pg_temp.c('H5.hd0')::text)),
    format('%s dòng P5', (SELECT count(*) FROM jsonb_array_elements(j->'dong') x WHERE x->>'product_id' = pg_temp.c('P5')::text)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('H', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- I. GỬI HAI LẦN / LÀM LẠI — số báo cáo không nhân đôi
-- ====================================================================
DO $t$ DECLARE e text; d0 jsonb; d1 jsonb; T date := pg_temp.hn(); BEGIN
  d0 := pg_temp.ds();
  e := pg_temp.thu(format('SELECT complete_return(%L, %L)', pg_temp.c('R4'), 'sale'));
  PERFORM pg_temp.ghi('I1', 'hoàn thành R4 lần 2 bị chặn; credit vẫn 70.000', e IS NOT NULL AND (SELECT credit_note_amount FROM returns WHERE id = pg_temp.c('R4')) = 70000,
    COALESCE(e, 'KHÔNG CHẶN'));
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('H2'), 'invoice_date', T - 3, 'lines', jsonb_build_array(pg_temp.dl('H2', 1, 30, 0.1)))));
  PERFORM pg_temp.ghi('I2', 'xuất HĐ lần 2 cho đơn H2 bị chặn (một đơn một HĐ)', e IS NOT NULL, COALESCE(e, 'KHÔNG CHẶN'));
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.c('H4.hd'), 'lần 2'));
  PERFORM pg_temp.ghi('I3', 'huỷ H4 lần 2 bị chặn', e IS NOT NULL, COALESCE(e, 'KHÔNG CHẶN'));
  e := pg_temp.thu(format('SELECT reissue_invoice(%L, %L::jsonb)', pg_temp.c('H5.hd0'), jsonb_build_object('lines', jsonb_build_array(pg_temp.dl('H5', 1, 5)))));
  PERFORM pg_temp.ghi('I4', 'sửa lại TỜ CŨ (đã thay) của H5 bị chặn', e IS NOT NULL, COALESCE(e, 'KHÔNG CHẶN'));
  d1 := pg_temp.ds();
  PERFORM pg_temp.ghi('I5', 'sau 4 thao tác bị chặn: dashboard không đổi (605.000 / 4 đơn / 659.000)', d0 = d1 AND (d1->>'period_revenue')::numeric = 605000,
    d1::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('I', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- J. ĐỔI NGÀY HĐ / NỬA ĐÊM VN
-- ====================================================================
DO $t$ DECLARE T date := pg_temp.hn(); j jsonb; BEGIN
  -- HĐ đổi ngày → phiếu tự sinh đổi ngày trừ theo (trigger mig 192). Ghi thẳng như siêu người dùng.
  UPDATE sales_invoices SET invoice_date = T - 1 WHERE id = pg_temp.c('H3.hd');
  PERFORM pg_temp.ghi('J1', 'HĐ H3 dời sang T-1 → phiếu tự sinh của nó trừ vào T-1',
    (SELECT revenue_date FROM returns WHERE id = pg_temp.c('H3.tra')) = T - 1, format('%s', (SELECT revenue_date FROM returns WHERE id = pg_temp.c('H3.tra'))));
  j := pg_temp.sb(T - 2, T - 2);
  PERFORM pg_temp.ghi('J1', 'kỳ T-2 không còn H3 và phiếu của nó', NOT pg_temp.co_id(j, 'hd', pg_temp.c('H3.hd')) AND NOT pg_temp.co_id(j, 'tra', pg_temp.c('H3.tra')),
    format('%s HĐ %s trả', pg_temp.n(j, 'hd'), pg_temp.n(j, 'tra')));
  UPDATE sales_invoices SET invoice_date = T - 2 WHERE id = pg_temp.c('H3.hd');
  -- Phiếu tự lập hoàn thành lúc 00:30 giờ VN (17:30 UTC hôm trước) → trừ vào ngày VN.
  UPDATE returns SET credited_at = ((T + time '00:30') AT TIME ZONE 'Asia/Ho_Chi_Minh') WHERE id = pg_temp.c('R4');
  PERFORM pg_temp.ghi('J2', 'R4 hoàn thành 00:30 giờ VN ngày T (= 17:30 UTC ngày T-1) → revenue_date = T (ngày VN)',
    (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R4')) = T, format('credited_at %s → %s', (SELECT credited_at FROM returns WHERE id = pg_temp.c('R4')), (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R4'))));
  UPDATE returns SET credited_at = ((T - 1 + time '23:59:59') AT TIME ZONE 'Asia/Ho_Chi_Minh') WHERE id = pg_temp.c('R4');
  PERFORM pg_temp.ghi('J3', 'R4 hoàn thành 23:59:59 giờ VN ngày T-1 → revenue_date = T-1',
    (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R4')) = T - 1, format('%s', (SELECT revenue_date FROM returns WHERE id = pg_temp.c('R4'))));
  UPDATE returns SET credited_at = now() WHERE id = pg_temp.c('R4');
  -- Phiếu xuất ghi sổ 00:30 giờ VN ngày T-1: bao_cao_so_ban xếp vào ngày VN T-1.
  UPDATE stock_entries SET posted_at = ((T - 1 + time '00:30') AT TIME ZONE 'Asia/Ho_Chi_Minh')
   WHERE id = (SELECT stock_entry_id FROM sales_invoices WHERE id = pg_temp.c('H6.hd'));
  j := pg_temp.sb(T - 1, T - 1);
  PERFORM pg_temp.ghi('J4', 'phiếu xuất H6 lúc 00:30 VN ngày T-1 → giá vốn kỳ [T-1] của P5: 1 lon × 9.000',
    (SELECT (x->>'sl')::numeric FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P5')::text) = 1
      AND (SELECT (x->>'tien')::numeric FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P5')::text) = 9000,
    (j->'gv')::text);
  j := pg_temp.sb(T - 2, T - 2);
  PERFORM pg_temp.ghi('J4', 'cùng phiếu đó KHÔNG rơi sang ngày T-2 (dù giờ UTC là T-2 17:30)',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'gv') x WHERE x->>'product_id' = pg_temp.c('P5')::text), (j->'gv')::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('J', 'NỔ', false, SQLERRM);
END $t$;

-- ====================================================================
-- K. HUỶ HĐ có phiếu tự sinh Chờ xử lý (đường ngược cuối cùng)
-- ====================================================================
DO $t$ DECLARE d jsonb; T date := pg_temp.hn(); e text; v_ret uuid; BEGIN
  -- H3 đã thu 100.000 → huỷ bị chặn, số giữ nguyên.
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.c('H3.hd'), 'khách huỷ'));
  d := pg_temp.ds();
  PERFORM pg_temp.ghi('K1', 'huỷ H3 (đã thu 100.000) bị chặn → doanh thu kỳ K giữ 605.000, phiếu tự sinh vẫn Chờ xử lý',
    e IS NOT NULL AND (d->>'period_revenue')::numeric = 605000 AND (SELECT status FROM returns WHERE id = pg_temp.c('H3.tra')) = 'submitted',
    COALESCE(e, 'KHÔNG CHẶN') || ' / ' || d::text);
  -- H8: KH3/NV B ngày T-1, 2 Thung P3 × 100.000 + trả kèm 1 Thung → thuần +100.000; rồi HUỶ HĐ.
  PERFORM pg_temp.tao_don('H8', pg_temp.c('KH3'), pg_temp.c('NVB'), jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('P3'), 'u', 'Thung 24', 'sl', 2, 'gia', 100000, 'hs', 24)));
  PERFORM pg_temp.xuat('H8', T - 1, jsonb_build_array(pg_temp.dl('H8', 1, 2)),
    jsonb_build_object('return_adds', jsonb_build_array(jsonb_build_object(
      'product_id', pg_temp.c('P3'), 'unit_name', 'Thung 24', 'quantity', 1, 'unit_price', 100000, 'vat_rate', 0))));
  SELECT id INTO v_ret FROM returns WHERE invoice_id = pg_temp.c('H8.hd');
  d := pg_temp.ds();
  PERFORM pg_temp.ghi('K2', 'thêm H8 (200.000 − trả kèm 100.000): doanh thu thuần kỳ K 605.000 + 100.000 = 705.000, 5 đơn',
    (d->>'period_revenue')::numeric = 705000 AND (d->>'period_orders')::int = 5, d::text);
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.c('H8.hd'), 'khách huỷ'));
  d := pg_temp.ds();
  PERFORM pg_temp.ghi('K3', 'huỷ H8: doanh thu thuần về 605.000, 4 đơn; phiếu tự sinh Đã huỷ, revenue_date NULL; đơn Đã huỷ',
    e IS NULL AND (d->>'period_revenue')::numeric = 605000 AND (d->>'period_orders')::int = 4
      AND (SELECT status FROM returns WHERE id = v_ret) = 'cancelled' AND (SELECT revenue_date FROM returns WHERE id = v_ret) IS NULL
      AND (SELECT status FROM sales_orders WHERE id = pg_temp.c('H8')) = 'cancelled',
    COALESCE(e, '') || ' ' || d::text);
  PERFORM pg_temp.ghi('K4', 'sau huỷ H8: công nợ mở vẫn 659.000 (phiếu nợ H8 không còn mở)', (d->>'open_receivables')::numeric = 659000, d::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('K', 'NỔ', false, SQLERRM);
END $t$;

SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, CASE WHEN ok THEN '' ELSE ghi END AS ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
