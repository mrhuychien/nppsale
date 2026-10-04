-- ĐỘI TEST CÔNG NỢ & THU TIỀN — bộ chống lỗi lâu dài cho: công nợ theo HĐ, nợ đầu kỳ, phiếu thu (lập / huỷ /
-- chống gửi trùng), phân bổ nhiều HĐ, dư có / trả dư / dòng âm, trigger trạng thái _cong_no_am_trang_thai,
-- tiền lẻ, khách khác / NPP khác, quyền từng vai (mig 215), khoá ghi thẳng từ trình duyệt (mig 214),
-- tuổi nợ receivables_summary, nhân viên nghỉ việc → nợ về NPP (mig 223), công nợ NCC + trả NCC (mig 167).
--
-- Luật đối chiếu: CLAUDE.md §1 "Công nợ tính theo HÓA ĐƠN", "Công nợ ÂM", "Phiếu trả TỰ SINH / TỰ LẬP", "Quyền".
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_cong_no -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/cong-no-phieu-thu.sql
-- Bọc BEGIN … ROLLBACK, không để lại dữ liệu. In bảng kq (ĐẠT / LỖI) + dòng tổng.
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
  $f$ INSERT INTO kq (buoc, ten, ok, ghi) VALUES (b, t, COALESCE(ok, false), COALESCE(g, '')) $f$;
-- Đọc như chủ máy (bỏ RLS).
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
-- Chạy câu ghi (UPDATE/DELETE) và trả số dòng bị đụng, hoặc thông báo lỗi.
CREATE FUNCTION pg_temp.ghi_thang(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n || ' dòng';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $f$;
CREATE FUNCTION pg_temp.vai(u text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claim.sub', CASE u WHEN 'owner' THEN 'e0000000-0000-0000-0000-000000000001'
       WHEN 'manager' THEN 'e0000000-0000-0000-0000-000000000002' WHEN 'accountant' THEN 'e0000000-0000-0000-0000-000000000003'
       WHEN 'sales' THEN 'e0000000-0000-0000-0000-000000000004' WHEN 'warehouse' THEN 'e0000000-0000-0000-0000-000000000005'
       WHEN 'khac' THEN 'e9990000-0000-0000-0000-0000000000c1' WHEN 'sales2' THEN 'e9990000-0000-0000-0000-0000000000c2'
       ELSE u END, true) $f$;
-- Nợ của khách đúng công thức loadCustomerDebt: Σ(amount − paid) trên phiếu status <> 'paid'.
CREATE FUNCTION pg_temp.no(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = pg_temp.c(k) AND status <> 'paid' $f$;
-- Một cột của phiếu công nợ theo khoá ctx (k = khoá HĐ → phiếu theo invoice_id; khoá khác → id phiếu).
CREATE FUNCTION pg_temp.rc(k text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE((SELECT id FROM receivables WHERE invoice_id = pg_temp.c(k)), (SELECT id FROM receivables WHERE id = pg_temp.c(k)),
                      (SELECT id FROM receivables WHERE return_id = pg_temp.c(k))) $f$;
CREATE FUNCTION pg_temp.r(k text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM receivables WHERE id = pg_temp.rc(k) $f$;
CREATE FUNCTION pg_temp.paid(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT paid FROM receivables WHERE id = pg_temp.rc(k) $f$;
CREATE FUNCTION pg_temp.amt(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT amount FROM receivables WHERE id = pg_temp.rc(k) $f$;
CREATE FUNCTION pg_temp.st(k text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT status FROM receivables WHERE id = pg_temp.rc(k) $f$;
CREATE FUNCTION pg_temp.ln(k text, a numeric) RETURNS jsonb LANGUAGE sql STABLE AS
  $f$ SELECT jsonb_build_object('receivable_id', pg_temp.rc(k), 'amount', a) $f$;
-- Lập phiếu thu cho khách k.
CREATE FUNCTION pg_temp.pt(k text, dongs jsonb, them jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql AS
  $f$ SELECT create_cash_receipt(jsonb_build_object('customer_id', pg_temp.c(k), 'lines', dongs) || them) $f$;
CREATE FUNCTION pg_temp.ptc(id uuid, cot text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER AS
  $f$ DECLARE r text; BEGIN EXECUTE format('SELECT %I::text FROM cash_receipts WHERE id = $1', cot) INTO r USING id; RETURN r; END $f$;
-- Tổng tiền payments đang trỏ vào phiếu công nợ (bất biến paid = Σ payments).
CREATE FUNCTION pg_temp.sp(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT COALESCE(sum(amount), 0) FROM payments WHERE receivable_id = pg_temp.rc(k) $f$;

-- Tạo khách k (siêu người dùng).
CREATE FUNCTION pg_temp.kh(k text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, credit_limit)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'Khách CN ' || k, 'Chị Thử', '09' || lpad((abs(hashtext('cn' || k)) % 100000000)::text, 8, '0'), 'Đường thử', 1000000)
  RETURNING id INTO v;
  INSERT INTO ctx VALUES (k, v);
  RETURN v;
END $f$;
-- Tạo đơn 1 dòng SP002 (lon) × sl × giá cho khách k (siêu người dùng).
CREATE FUNCTION pg_temp.don(k text, khach text, sl numeric, gia numeric, nv uuid DEFAULT 'e0000000-0000-0000-0000-000000000004') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_don uuid; v_dong uuid;
BEGIN
  INSERT INTO sales_orders (org_id, order_code, customer_id, sales_user_id, order_date, status, payment_terms, subtotal, discount, vat, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', 'DH-CN-' || k, pg_temp.c(khach), nv, pg_temp.hn() - 1, 'submitted', 'NET30', sl * gia, 0, 0, sl * gia)
  RETURNING id INTO v_don;
  INSERT INTO sales_order_lines (order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, conversion_factor)
  VALUES (v_don, 'c0000000-0000-0000-0000-000000000002', 'lon', sl, gia, 0, sl * gia, 1)
  RETURNING id INTO v_dong;
  INSERT INTO ctx VALUES (k || '.don', v_don), (k || '.dong', v_dong);
  RETURN v_don;
END $f$;
-- Xuất HĐ đủ đơn k dưới vai hiện tại; lưu id HĐ vào ctx[k].
CREATE FUNCTION pg_temp.xuat(k text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  SELECT invoice_id INTO v FROM post_invoice(jsonb_build_object('order_id', pg_temp.c(k || '.don'), 'invoice_date', pg_temp.hn(),
    'lines', (SELECT jsonb_build_array(jsonb_build_object('order_line_id', sol.id, 'product_id', sol.product_id, 'unit_name', sol.unit_name,
              'conversion_factor', 1, 'quantity', sol.quantity, 'unit_price', sol.unit_price, 'vat_rate', 0))
              FROM sales_order_lines sol WHERE sol.id = pg_temp.c(k || '.dong'))));
  INSERT INTO ctx VALUES (k, v);
  RETURN v;
END $f$;
-- Phiếu trả TỰ LẬP (vai hiện tại): 1 dòng SP002 lon × giá; p_hd khoá HĐ để gắn (NULL = độc lập → công nợ âm).
CREATE FUNCTION pg_temp.tra(k text, khach text, tien numeric, p_hd text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  v := create_return_with_lines(jsonb_build_object('customer_id', pg_temp.c(khach), 'reason', 'damaged', 'status', 'draft',
         'invoice_id', COALESCE(pg_temp.c(p_hd)::text, '')),
        jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon',
          'quantity', 1, 'unit_price', tien, 'line_total', tien)));
  PERFORM complete_return(v, 'sale');
  INSERT INTO ctx VALUES (k, v);
  RETURN v;
END $f$;
-- Nợ đầu kỳ (siêu người dùng — để dựng tình huống).
CREATE FUNCTION pg_temp.dk(k text, khach text, tien numeric, han date, da_thu numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  -- Mỗi khách chỉ MỘT dòng đầu kỳ (uq_receivables_opening) — khách chưa có thì tạo.
  IF pg_temp.c(khach) IS NULL THEN PERFORM pg_temp.kh(khach); END IF;
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, status, opening_balance, note)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c(khach), tien, da_thu, han, 'open', true, 'Đầu kỳ thử ' || k)
  RETURNING id INTO v;
  INSERT INTO ctx VALUES (k, v);
  RETURN v;
END $f$;

-- ───────────────────────── Dữ liệu ─────────────────────────
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
VALUES ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'CN-A', pg_temp.hn() + 300, 100000, 100000, 500, 'sale', now() - interval '3 days');

SELECT pg_temp.kh('K1'), pg_temp.kh('K2'), pg_temp.kh('K3'), pg_temp.kh('K4'), pg_temp.kh('K5'), pg_temp.kh('K6'),
       pg_temp.kh('K7'), pg_temp.kh('K8'), pg_temp.kh('K9'), pg_temp.kh('K10'), pg_temp.kh('K11');

-- NPP khác + chủ NPP khác; NVBH thứ hai (để cho nghỉ việc).
DO $d$ DECLARE v_org uuid; BEGIN
  INSERT INTO organizations (name, slug) VALUES ('NPP khác CN', 'npp-khac-cn') RETURNING id INTO v_org;
  INSERT INTO auth.users (id, email) VALUES ('e9990000-0000-0000-0000-0000000000c1', 'khac-cn@x.vn'),
                                            ('e9990000-0000-0000-0000-0000000000c2', 'nvbh2-cn@x.vn');
  INSERT INTO users (id, org_id, full_name, role) VALUES ('e9990000-0000-0000-0000-0000000000c1', v_org, 'Chủ khác', 'owner'),
    ('e9990000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001', 'NVBH Hai', 'sales');
  INSERT INTO ctx VALUES ('ORG2', v_org);
END $d$;

SELECT pg_temp.don('H1', 'K1', 1100, 1000), pg_temp.don('H2', 'K1', 500, 1000), pg_temp.don('H3', 'K1', 250, 1000),
       pg_temp.don('H4', 'K2', 1000, 1000), pg_temp.don('H5', 'K3', 300, 1000),
       pg_temp.don('H6', 'K4', 800, 1000, 'e9990000-0000-0000-0000-0000000000c2'),
       pg_temp.don('H6b', 'K4', 100, 1000, 'e9990000-0000-0000-0000-0000000000c2'),
       pg_temp.don('H7', 'K5', 600, 1000), pg_temp.don('H7b', 'K5', 300, 1000),
       pg_temp.don('H8', 'K6', 400, 1000), pg_temp.don('H9', 'K7', 1000, 1000), pg_temp.don('H10', 'K7', 1000, 1000);

SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');
SELECT pg_temp.xuat(k) FROM unnest(ARRAY['H1','H2','H3','H4','H5','H6','H6b','H7','H7b','H8','H9','H10']) k;

-- ═════════════════════ A. CÔNG NỢ THEO HÓA ĐƠN ═════════════════════
DO $t$ BEGIN
  PERFORM pg_temp.ghi('A1', 'HĐ ghi sổ → đúng MỘT phiếu công nợ theo invoice_id, 1.100.000, paid 0, open',
    pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L', pg_temp.c('H1'))) = 1
    AND pg_temp.amt('H1') = 1100000 AND pg_temp.paid('H1') = 0 AND pg_temp.st('H1') = 'open', pg_temp.r('H1'));
  PERFORM pg_temp.ghi('A1', 'hạn = ngày HĐ + 30 (NET30), người đứng tên = NV của HĐ, không phải đầu kỳ',
    pg_temp.chu(format('SELECT due_date::text FROM receivables WHERE id = %L', pg_temp.rc('H1'))) = (pg_temp.hn() + 30)::text
    AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H1'))) = 'e0000000-0000-0000-0000-000000000004'
    AND pg_temp.chu(format('SELECT opening_balance::text FROM receivables WHERE id = %L', pg_temp.rc('H1'))) = 'false',
    pg_temp.chu(format('SELECT due_date::text FROM receivables WHERE id = %L', pg_temp.rc('H1'))));
  PERFORM pg_temp.ghi('A2', 'nợ khách K1 = Σ 3 HĐ = 1.850.000 (không lấy tổng đơn)', pg_temp.no('K1') = 1850000, pg_temp.no('K1')::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('A', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ B. PHIẾU THU — đường xuôi + biên (kế toán) ═════════════════════
SELECT pg_temp.vai('accountant');
DO $t$ DECLARE p uuid; e text; n0 numeric; BEGIN
  p := pg_temp.pt('K1', jsonb_build_array(pg_temp.ln('H1', 1100000)));
  INSERT INTO ctx VALUES ('P_B1', p);
  PERFORM pg_temp.ghi('B1', 'thu đủ HĐ1 → paid 1.100.000, trạng thái paid, nợ K1 còn 750.000',
    pg_temp.paid('H1') = 1100000 AND pg_temp.st('H1') = 'paid' AND pg_temp.no('K1') = 750000, pg_temp.r('H1') || ' nợ ' || pg_temp.no('K1'));
  PERFORM pg_temp.ghi('B1', 'phiếu thu: received, tiền nộp = tiền phải nộp = 1.100.000, người thu = kế toán',
    pg_temp.ptc(p, 'status') = 'received' AND pg_temp.ptc(p, 'submitted_amount')::numeric = 1100000
    AND pg_temp.ptc(p, 'expected_amount')::numeric = 1100000 AND pg_temp.ptc(p, 'collected_by') = 'e0000000-0000-0000-0000-000000000003',
    format('%s %s %s', pg_temp.ptc(p, 'status'), pg_temp.ptc(p, 'submitted_amount'), pg_temp.ptc(p, 'collected_by')));
  PERFORM pg_temp.ghi('B1', 'mã phiếu PT-YYMMDD-NNNN theo ngày VN', pg_temp.ptc(p, 'receipt_code') ~ ('^PT-' || to_char(pg_temp.hn(), 'YYMMDD') || '-[0-9]{4}$'),
    pg_temp.ptc(p, 'receipt_code'));
  PERFORM pg_temp.ghi('B1', 'một dòng payment 1.100.000 gắn HĐ1 (invoice_id tự điền); payments cash = paid',
    pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L AND kind = %L AND amount = 1100000 AND invoice_id = %L', p, 'payment', pg_temp.c('H1'))) = 1
    AND pg_temp.sp('H1') = 1100000
    AND pg_temp.chu(format('SELECT method FROM payments WHERE receivable_id = %L', pg_temp.rc('H1'))) = 'cash', '');

  p := pg_temp.pt('K1', jsonb_build_array(pg_temp.ln('H2', 200000)), '{"method":"transfer","receipt_date":"2026-09-30","notes":"ck một phần"}');
  PERFORM pg_temp.ghi('B2', 'thu một phần 200.000/500.000 → partial, còn 300.000; nợ K1 550.000',
    pg_temp.paid('H2') = 200000 AND pg_temp.st('H2') = 'partial' AND pg_temp.no('K1') = 550000, pg_temp.r('H2'));
  PERFORM pg_temp.ghi('B2', 'giữ hình thức chuyển khoản, ngày chứng từ 30/09, ghi chú',
    pg_temp.chu(format('SELECT method FROM payments WHERE receivable_id = %L', pg_temp.rc('H2'))) = 'transfer'
    AND pg_temp.ptc(p, 'receipt_date') = '2026-09-30' AND pg_temp.ptc(p, 'notes') = 'ck một phần', pg_temp.ptc(p, 'receipt_date'));

  p := pg_temp.pt('K1', jsonb_build_array(pg_temp.ln('H2', 300000), pg_temp.ln('H3', 250000)));
  PERFORM pg_temp.ghi('B3', 'một phiếu thu 2 HĐ: 300.000 + 250.000 → cả hai paid, nợ K1 = 0, phiếu 550.000, 2 dòng',
    pg_temp.st('H2') = 'paid' AND pg_temp.st('H3') = 'paid' AND pg_temp.no('K1') = 0
    AND pg_temp.ptc(p, 'submitted_amount')::numeric = 550000
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L', p)) = 2,
    format('%s | %s | nợ %s', pg_temp.r('H2'), pg_temp.r('H3'), pg_temp.no('K1')));
  PERFORM pg_temp.ghi('B3', 'bất biến paid = Σ payments trên mọi phiếu của K1',
    pg_temp.sp('H1') = pg_temp.paid('H1') AND pg_temp.sp('H2') = pg_temp.paid('H2') AND pg_temp.sp('H3') = pg_temp.paid('H3'), '');

  -- Thu vượt / thu khoản đã xong
  n0 := pg_temp.so('SELECT count(*) FROM cash_receipts');
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 1000001))));
  PERFORM pg_temp.ghi('B4', 'thu vượt 1 đồng (1.000.001/1.000.000) → BAD_RECEIVABLE_LINE, không phiếu nào sinh',
    e LIKE 'BAD_RECEIVABLE_LINE%' AND pg_temp.paid('H4') = 0 AND pg_temp.so('SELECT count(*) FROM cash_receipts') = n0, left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K1', jsonb_build_array(pg_temp.ln('H1', 1000))));
  PERFORM pg_temp.ghi('B4', 'thu thêm vào HĐ đã thu đủ → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));

  -- Hai dòng cùng một khoản: cộng dồn
  p := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 100000), pg_temp.ln('H4', 150000)));
  INSERT INTO ctx VALUES ('P_B5', p);
  PERFORM pg_temp.ghi('B5', 'hai dòng cùng HĐ 100k + 150k → gộp 1 dòng 250.000, paid 250.000 partial',
    pg_temp.paid('H4') = 250000 AND pg_temp.st('H4') = 'partial'
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L', p)) = 1
    AND pg_temp.ptc(p, 'submitted_amount')::numeric = 250000, pg_temp.r('H4'));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 400000), pg_temp.ln('H4', 400000))));
  PERFORM pg_temp.ghi('B5', 'hai dòng cùng HĐ cộng vượt (800k > còn 750k) → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));

  -- Biên số tiền
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 0))));
  PERFORM pg_temp.ghi('B6', 'dòng 0đ → EMPTY_RECEIPT', e LIKE 'EMPTY_RECEIPT%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', '[]'));
  PERFORM pg_temp.ghi('B6', 'không dòng nào → EMPTY_RECEIPT', e LIKE 'EMPTY_RECEIPT%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', -50000))));
  PERFORM pg_temp.ghi('B6', 'dòng âm −50.000 → bị chặn (EMPTY_RECEIPT)', e LIKE 'EMPTY_RECEIPT%', left(e, 60));
  e := pg_temp.thu(format('SELECT create_cash_receipt(%L)', jsonb_build_object('customer_id', pg_temp.c('K7'), 'lines',
         jsonb_build_array(pg_temp.ln('H9', 300000), pg_temp.ln('H10', -100000)))));
  PERFORM pg_temp.ghi('B6', 'dòng âm lẫn dòng dương (300k + −100k) → BAD_RECEIVABLE_LINE, HĐ không đổi',
    e LIKE 'BAD_RECEIVABLE_LINE%' AND pg_temp.paid('H9') = 0 AND pg_temp.paid('H10') = 0, left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 1000.5))));
  PERFORM pg_temp.ghi('B7', 'tiền lẻ 1.000,5đ → BAD_RECEIVABLE_LINE (mig 212: đồng chẵn)', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 1000)), '{"use_credit":0.5}'));
  PERFORM pg_temp.ghi('B7', 'dư có dùng 0,5đ → BAD_AMOUNT', e LIKE 'BAD_AMOUNT%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H1', 1000))));
  PERFORM pg_temp.ghi('B8', 'phiếu khách K2 thu HĐ của K1 → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K2', jsonb_build_array(pg_temp.ln('H4', 1000), pg_temp.ln('H9', 1000))));
  PERFORM pg_temp.ghi('B8', 'phiếu K2 lẫn một dòng của K7 → BAD_RECEIVABLE_LINE cả phiếu, HĐ4 không đổi',
    e LIKE 'BAD_RECEIVABLE_LINE%' AND pg_temp.paid('H4') = 250000, left(e, 60));
  e := pg_temp.thu(format('SELECT create_cash_receipt(%L)', jsonb_build_object('customer_id', pg_temp.c('K2'), 'lines',
         jsonb_build_array(jsonb_build_object('receivable_id', gen_random_uuid(), 'amount', 1000)))));
  PERFORM pg_temp.ghi('B8', 'khoản nợ không tồn tại → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));
  e := pg_temp.thu($q$SELECT create_cash_receipt('{"lines":[]}')$q$);
  PERFORM pg_temp.ghi('B8', 'thiếu khách → CUSTOMER_REQUIRED', e LIKE 'CUSTOMER_REQUIRED%', left(e, 60));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('B', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ C. CHỐNG GỬI TRÙNG (mig 215) ═════════════════════
DO $t$ DECLARE p1 uuid; p2 uuid; p3 uuid; BEGIN
  p1 := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 50000)), '{"client_key":"cn-k-1"}');
  p2 := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 50000)), '{"client_key":"cn-k-1"}');
  PERFORM pg_temp.ghi('C1', 'bấm Lưu hai lần cùng khoá → cùng một phiếu, HĐ4 chỉ cộng 50.000 một lần (300.000)',
    p1 = p2 AND pg_temp.paid('H4') = 300000 AND pg_temp.sp('H4') = 300000
    AND pg_temp.so($q$SELECT count(*) FROM cash_receipts WHERE client_key = 'cn-k-1'$q$) = 1, pg_temp.r('H4'));
  p3 := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 50000)), '{"client_key":"cn-k-2"}');
  PERFORM pg_temp.ghi('C2', 'khoá khác → phiếu mới, HĐ4 350.000', p3 <> p1 AND pg_temp.paid('H4') = 350000, pg_temp.r('H4'));
  p2 := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 999999999)), '{"client_key":"cn-k-1"}');
  PERFORM pg_temp.ghi('C3', 'gửi lại khoá cũ với tải trọng khác → trả phiếu cũ, KHÔNG kiểm / ghi gì thêm',
    p2 = p1 AND pg_temp.paid('H4') = 350000, '');
  PERFORM void_cash_receipt(p1, 'thử khoá');
  PERFORM void_cash_receipt(p3, 'thử khoá');
  PERFORM pg_temp.ghi('C4', 'huỷ 2 phiếu khoá → HĐ4 về 250.000', pg_temp.paid('H4') = 250000 AND pg_temp.st('H4') = 'partial', pg_temp.r('H4'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('C', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ D. HUỶ PHIẾU THU ═════════════════════
DO $t$ DECLARE p uuid; p2 uuid; e text; BEGIN
  p := pg_temp.c('P_B5');
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', p, '   '));
  PERFORM pg_temp.ghi('D1', 'huỷ không lý do (chỉ khoảng trắng) → REASON_REQUIRED', e LIKE 'REASON_REQUIRED%', left(e, 60));
  PERFORM void_cash_receipt(p, 'thu nhầm');
  PERFORM pg_temp.ghi('D2', 'huỷ phiếu 250.000 → HĐ4 paid 0, open, payments xoá hết, nợ K2 = 1.000.000',
    pg_temp.paid('H4') = 0 AND pg_temp.st('H4') = 'open' AND pg_temp.sp('H4') = 0 AND pg_temp.no('K2') = 1000000, pg_temp.r('H4'));
  PERFORM pg_temp.ghi('D2', 'phiếu: voided, lý do, người huỷ = kế toán, dòng giữ lại (payment_id gỡ)',
    pg_temp.ptc(p, 'status') = 'voided' AND pg_temp.ptc(p, 'void_reason') = 'thu nhầm'
    AND pg_temp.ptc(p, 'voided_by') = 'e0000000-0000-0000-0000-000000000003'
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L AND payment_id IS NULL', p)) = 1,
    pg_temp.ptc(p, 'status'));
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', p, 'lần hai'));
  PERFORM pg_temp.ghi('D3', 'huỷ lần hai → RECEIPT_NOT_VOIDABLE, HĐ4 không âm', e LIKE 'RECEIPT_NOT_VOIDABLE%' AND pg_temp.paid('H4') = 0, left(e, 60));
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', gen_random_uuid(), 'x'));
  PERFORM pg_temp.ghi('D3', 'huỷ phiếu không tồn tại → RECEIPT_NOT_FOUND', e LIKE 'RECEIPT_NOT_FOUND%', left(e, 60));

  -- Hai phiếu cùng HĐ, huỷ phiếu đầu
  p := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 300000)));
  p2 := pg_temp.pt('K2', jsonb_build_array(pg_temp.ln('H4', 500000)));
  PERFORM void_cash_receipt(p, 'huỷ phiếu đầu');
  PERFORM pg_temp.ghi('D4', 'hai phiếu 300k + 500k, huỷ phiếu đầu → paid 500.000 partial, Σpayments 500.000',
    pg_temp.paid('H4') = 500000 AND pg_temp.st('H4') = 'partial' AND pg_temp.sp('H4') = 500000, pg_temp.r('H4'));
  -- Huỷ phiếu nhiều HĐ
  PERFORM void_cash_receipt((SELECT receipt_id FROM cash_receipt_lines WHERE invoice_id = pg_temp.c('H3') LIMIT 1), 'huỷ phiếu 2 HĐ');
  PERFORM pg_temp.ghi('D5', 'huỷ phiếu 2 HĐ (300k HĐ2 + 250k HĐ3) → HĐ2 paid 200k partial, HĐ3 0 open, nợ K1 550.000',
    pg_temp.paid('H2') = 200000 AND pg_temp.st('H2') = 'partial' AND pg_temp.paid('H3') = 0 AND pg_temp.st('H3') = 'open'
    AND pg_temp.no('K1') = 550000, format('%s | %s | nợ %s', pg_temp.r('H2'), pg_temp.r('H3'), pg_temp.no('K1')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- D6 Huỷ phiếu của khoản ĐÃ QUÁ HẠN → về 'overdue', vẫn tính vào nợ
RESET ROLE;
SELECT pg_temp.dk('DK_QH', 'K8', 400000, pg_temp.hn() - 10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('accountant');
DO $t$ DECLARE p uuid; BEGIN
  p := pg_temp.pt('K8', jsonb_build_array(pg_temp.ln('DK_QH', 400000)));
  PERFORM pg_temp.ghi('D6', 'thu đủ nợ đầu kỳ quá hạn → paid, nợ K8 = 0', pg_temp.st('DK_QH') = 'paid' AND pg_temp.no('K8') = 0, pg_temp.r('DK_QH'));
  PERFORM void_cash_receipt(p, 'thử quá hạn');
  PERFORM pg_temp.ghi('D6', 'huỷ → trạng thái overdue (hạn đã qua), nợ K8 lại 400.000',
    pg_temp.st('DK_QH') = 'overdue' AND pg_temp.paid('DK_QH') = 0 AND pg_temp.no('K8') = 400000, pg_temp.r('DK_QH'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('D6', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ E. DƯ CÓ / CÔNG NỢ ÂM / TRẢ DƯ ═════════════════════
SELECT pg_temp.vai('owner');
SELECT pg_temp.tra('R5', 'K3', 200000);
SELECT pg_temp.vai('accountant');
DO $t$ DECLARE p uuid; e text; BEGIN
  PERFORM pg_temp.ghi('E1', 'phiếu trả độc lập 200.000 → dòng công nợ âm −200.000, open; nợ K3 = 300k − 200k = 100.000',
    pg_temp.amt('R5') = -200000 AND pg_temp.st('R5') = 'open' AND pg_temp.no('K3') = 100000, pg_temp.r('R5') || ' nợ ' || pg_temp.no('K3'));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K3', jsonb_build_array(pg_temp.ln('R5', 100000))));
  PERFORM pg_temp.ghi('E2', 'thu tiền trên chính dòng âm → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L, %L)', 'K3', jsonb_build_array(pg_temp.ln('H5', 300000)), '{"use_credit":250000}'));
  PERFORM pg_temp.ghi('E3', 'dùng dư có 250k khi chỉ có 200k → CREDIT_BALANCE_TOO_LOW', e LIKE 'CREDIT_BALANCE_TOO_LOW%', left(e, 60));
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L, %L)', 'K3', jsonb_build_array(pg_temp.ln('H5', 100000)), '{"use_credit":150000}'));
  PERFORM pg_temp.ghi('E3', 'dùng dư có 150k > phần chọn thu 100k → CREDIT_EXCEEDS_SELECTED', e LIKE 'CREDIT_EXCEEDS_SELECTED%', left(e, 60));

  p := pg_temp.pt('K3', jsonb_build_array(pg_temp.ln('H5', 300000)), '{"use_credit":200000}');
  PERFORM pg_temp.ghi('E4', 'thu HĐ5 300k dùng hết dư có 200k → tiền thật 100.000; dòng âm paid −200k (paid); HĐ5 paid; nợ K3 = 0',
    pg_temp.ptc(p, 'submitted_amount')::numeric = 100000 AND pg_temp.paid('R5') = -200000 AND pg_temp.st('R5') = 'paid'
    AND pg_temp.paid('H5') = 300000 AND pg_temp.st('H5') = 'paid' AND pg_temp.no('K3') = 0,
    format('tiền %s | âm %s | HĐ5 %s | nợ %s', pg_temp.ptc(p, 'submitted_amount'), pg_temp.r('R5'), pg_temp.r('H5'), pg_temp.no('K3')));
  PERFORM pg_temp.ghi('E4', 'bút toán hai vế: credit_applied −200k ở dòng âm, +200k ở HĐ5, payment 100k',
    pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L AND kind = %L AND amount = -200000 AND receivable_id = %L', p, 'credit_applied', pg_temp.rc('R5'))) = 1
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L AND kind = %L AND amount = 200000 AND receivable_id = %L', p, 'credit_applied', pg_temp.rc('H5'))) = 1
    AND pg_temp.so(format('SELECT count(*) FROM cash_receipt_lines WHERE receipt_id = %L AND kind = %L AND amount = 100000', p, 'payment')) = 1
    AND pg_temp.sp('R5') = -200000 AND pg_temp.sp('H5') = 300000, '');
  PERFORM void_cash_receipt(p, 'thử dư có');
  PERFORM pg_temp.ghi('E5', 'huỷ phiếu dùng dư có → dòng âm paid 0 open, HĐ5 paid 0 open, nợ K3 lại 100.000',
    pg_temp.paid('R5') = 0 AND pg_temp.st('R5') = 'open' AND pg_temp.paid('H5') = 0 AND pg_temp.st('H5') = 'open' AND pg_temp.no('K3') = 100000,
    format('âm %s | HĐ5 %s', pg_temp.r('R5'), pg_temp.r('H5')));
  p := pg_temp.pt('K3', jsonb_build_array(pg_temp.ln('H5', 50000)), '{"use_credit":50000}');
  PERFORM pg_temp.ghi('E6', 'dùng một phần dư có 50k (tiền thật 0đ) → dòng âm còn −150k open; nợ K3 vẫn 100.000',
    pg_temp.ptc(p, 'submitted_amount')::numeric = 0 AND pg_temp.amt('R5') - pg_temp.paid('R5') = -150000 AND pg_temp.st('R5') = 'open'
    AND pg_temp.paid('H5') = 50000 AND pg_temp.no('K3') = 100000, format('âm %s | HĐ5 %s | nợ %s', pg_temp.r('R5'), pg_temp.r('H5'), pg_temp.no('K3')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E7..E9 Trả DƯ: thu đủ HĐ7 rồi phiếu trả tự lập GẮN HĐ7 → HĐ7 paid > amount = dư có
DO $t$ BEGIN
  PERFORM pg_temp.pt('K5', jsonb_build_array(pg_temp.ln('H7', 600000)));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E7', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
SELECT pg_temp.vai('owner');
SELECT pg_temp.tra('R7', 'K5', 100000, 'H7');
SELECT pg_temp.vai('accountant');
DO $t$ DECLARE p uuid; BEGIN
  PERFORM pg_temp.ghi('E7', 'trả hàng 100k gắn HĐ7 đã thu đủ → HĐ7 amount 500k, paid 600k, trạng thái OPEN (dư có, mig 212)',
    pg_temp.amt('H7') = 500000 AND pg_temp.paid('H7') = 600000 AND pg_temp.st('H7') = 'open', pg_temp.r('H7'));
  PERFORM pg_temp.ghi('E7', 'nợ K5 = −100.000 (dư 100k) + HĐ7b 300.000 = 200.000 — dư có KHÔNG bị kẹp 0',
    pg_temp.no('K5') = 200000, pg_temp.no('K5')::text);
  p := pg_temp.pt('K5', jsonb_build_array(pg_temp.ln('H7b', 100000)), '{"use_credit":100000}');
  PERFORM pg_temp.ghi('E8', 'rút dư 100k từ HĐ7 sang HĐ7b → HĐ7 paid 500k = amount → paid; HĐ7b 100k partial; tiền thật 0; nợ K5 200.000',
    pg_temp.paid('H7') = 500000 AND pg_temp.st('H7') = 'paid' AND pg_temp.paid('H7b') = 100000 AND pg_temp.st('H7b') = 'partial'
    AND pg_temp.ptc(p, 'submitted_amount')::numeric = 0 AND pg_temp.no('K5') = 200000,
    format('%s | %s | nợ %s', pg_temp.r('H7'), pg_temp.r('H7b'), pg_temp.no('K5')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E8', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
SELECT pg_temp.vai('owner');
DO $t$ BEGIN
  PERFORM cancel_return(pg_temp.c('R7'), 'huỷ sau khi dư đã dùng');
  PERFORM pg_temp.ghi('E9', 'huỷ phiếu trả tự lập khi dư có đã dùng → HĐ7 amount 600k, paid 500k partial; nợ K5 = 100k + 200k = 300.000',
    pg_temp.amt('H7') = 600000 AND pg_temp.paid('H7') = 500000 AND pg_temp.st('H7') = 'partial' AND pg_temp.no('K5') = 300000,
    format('%s | nợ %s', pg_temp.r('H7'), pg_temp.no('K5')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('E9', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- E10..E11 Dư có từ HAI phiếu trả độc lập; huỷ một phiếu trả đã bị rút; rồi huỷ phiếu thu
SELECT pg_temp.kh('K12');
SELECT pg_temp.tra('RA', 'K12', 120000), pg_temp.tra('RB', 'K12', 80000);
SELECT pg_temp.don('H11', 'K12', 300, 1000);
SELECT pg_temp.xuat('H11');
SELECT pg_temp.vai('accountant');
DO $t$ DECLARE p uuid; BEGIN
  PERFORM pg_temp.ghi('E10', 'hai phiếu trả độc lập 120k + 80k + HĐ 300k → nợ K12 = 100.000', pg_temp.no('K12') = 100000, pg_temp.no('K12')::text);
  p := pg_temp.pt('K12', jsonb_build_array(pg_temp.ln('H11', 150000)), '{"use_credit":150000}');
  INSERT INTO ctx VALUES ('P_E10', p);
  PERFORM pg_temp.ghi('E10', 'rút 150k dư có từ HAI nguồn (Σ dùng = 150k), HĐ 150k partial, tiền thật 0, nợ vẫn 100.000',
    (pg_temp.paid('RA') + pg_temp.paid('RB')) = -150000 AND pg_temp.paid('H11') = 150000 AND pg_temp.st('H11') = 'partial'
    AND pg_temp.ptc(p, 'submitted_amount')::numeric = 0 AND pg_temp.no('K12') = 100000,
    format('RA %s | RB %s | HĐ %s', pg_temp.r('RA'), pg_temp.r('RB'), pg_temp.r('H11')));
END $t$;
SELECT pg_temp.vai('owner');
DO $t$ DECLARE src text; BEGIN
  -- huỷ phiếu trả NÀO đã bị rút hết (paid = amount) — nguồn nào tuỳ thứ tự máy chủ chọn
  src := CASE WHEN pg_temp.st('RA') = 'paid' THEN 'RA' ELSE 'RB' END;
  PERFORM cancel_return(pg_temp.c(src), 'huỷ sau khi dư đã rút');
  PERFORM pg_temp.ghi('E11', format('huỷ phiếu trả %s đã bị rút hết → khách nợ lại phần đó: nợ = 300k − phiếu trả còn lại', src),
    pg_temp.no('K12') = 300000 - (CASE src WHEN 'RA' THEN 80000 ELSE 120000 END),
    format('RA %s | RB %s | nợ %s', pg_temp.r('RA'), pg_temp.r('RB'), pg_temp.no('K12')));
END $t$;
SELECT pg_temp.vai('accountant');
DO $t$ BEGIN
  PERFORM void_cash_receipt(pg_temp.c('P_E10'), 'huỷ sau khi huỷ phiếu trả');
  PERFORM pg_temp.ghi('E11', 'rồi huỷ phiếu thu → mọi paid về 0, HĐ open; nợ = HĐ − phiếu trả còn sống',
    pg_temp.paid('RA') = 0 AND pg_temp.paid('RB') = 0 AND pg_temp.paid('H11') = 0 AND pg_temp.st('H11') = 'open'
    AND pg_temp.no('K12') IN (180000, 220000)
    AND pg_temp.no('K12') = 300000 - pg_temp.so(format('SELECT COALESCE(sum(credit_note_amount),0) FROM returns WHERE customer_id = %L AND status = %L', pg_temp.c('K12'), 'completed')),
    format('RA %s | RB %s | nợ %s', pg_temp.r('RA'), pg_temp.r('RB'), pg_temp.no('K12')));
END $t$;

-- ═════════════════════ F. TRIGGER TRẠNG THÁI _cong_no_am_trang_thai (mig 212) ═════════════════════
RESET ROLE;
SELECT pg_temp.dk('DK_F', 'K9', 100000, pg_temp.hn() + 10);
SELECT pg_temp.dk('DK_FN', 'K9N', -50000, NULL);
DO $t$ BEGIN
  UPDATE receivables SET paid = 99999.995 WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F1', 'amount 100.000, paid 99.999,995 (lệch 0,005 < 0,01) → paid', pg_temp.st('DK_F') = 'paid', pg_temp.r('DK_F'));
  UPDATE receivables SET paid = 99999.99 WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F2', 'paid 99.999,99 (lệch đúng 0,01) → partial (ranh < 0,01 là chặt)', pg_temp.st('DK_F') = 'partial', pg_temp.r('DK_F'));
  UPDATE receivables SET paid = 100000.5 WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F3', 'paid 100.000,5 > amount → open (trả dư = dư có), nợ tính −0,5',
    pg_temp.st('DK_F') = 'open' AND pg_temp.no('K9') = -0.5, pg_temp.r('DK_F') || ' nợ ' || pg_temp.no('K9'));
  UPDATE receivables SET paid = 0, status = 'paid' WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F4', 'ghi status=paid khi paid 0 → trigger ép về open', pg_temp.st('DK_F') = 'open', pg_temp.r('DK_F'));
  UPDATE receivables SET status = 'overdue' WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F4', 'đánh dấu overdue khi còn nợ → giữ overdue', pg_temp.st('DK_F') = 'overdue', pg_temp.r('DK_F'));
  UPDATE receivables SET paid = 100000 WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F4', 'overdue rồi thu đủ → paid', pg_temp.st('DK_F') = 'paid', pg_temp.r('DK_F'));
  PERFORM pg_temp.ghi('F5', 'dòng âm −50.000 chưa dùng → open', pg_temp.st('DK_FN') = 'open', pg_temp.r('DK_FN'));
  UPDATE receivables SET paid = -20000 WHERE id = pg_temp.c('DK_FN');
  PERFORM pg_temp.ghi('F5', 'dòng âm dùng một phần (paid −20.000) → open, còn −30.000',
    pg_temp.st('DK_FN') = 'open' AND pg_temp.no('K9N') = -30000, pg_temp.r('DK_FN'));
  UPDATE receivables SET paid = -50000 WHERE id = pg_temp.c('DK_FN');
  PERFORM pg_temp.ghi('F5', 'dòng âm dùng hết (paid = amount) → paid', pg_temp.st('DK_FN') = 'paid', pg_temp.r('DK_FN'));
  UPDATE receivables SET paid = -60000 WHERE id = pg_temp.c('DK_FN');
  PERFORM pg_temp.ghi('F5', 'dòng âm dùng QUÁ (paid −60.000 < amount −50.000) → open, khách nợ lại 10.000',
    pg_temp.st('DK_FN') = 'open' AND pg_temp.no('K9N') = 10000, pg_temp.r('DK_FN') || ' nợ ' || pg_temp.no('K9N'));
  UPDATE receivables SET amount = 0, paid = 0 WHERE id = pg_temp.c('DK_F');
  PERFORM pg_temp.ghi('F6', 'khoản 0đ, chưa thu → paid (không còn gì để thu)', pg_temp.st('DK_F') = 'paid', pg_temp.r('DK_F'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('F', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ G. NỢ ĐẦU KỲ ghi từ trình duyệt (mig 214) ═════════════════════
SET LOCAL ROLE authenticated;
DO $t$ DECLARE e text; v uuid; BEGIN
  PERFORM pg_temp.vai('accountant');
  INSERT INTO receivables (org_id, customer_id, amount, paid, due_date, opening_balance, note)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('K10'), 500000, 0, pg_temp.hn() + 15, true, 'đầu kỳ kế toán') RETURNING id INTO v;
  INSERT INTO ctx VALUES ('DK_G', v);
  PERFORM pg_temp.ghi('G1', 'kế toán thêm nợ đầu kỳ chưa thu 500.000 → open, vào nợ K10',
    pg_temp.st('DK_G') = 'open' AND pg_temp.no('K10') = 500000, pg_temp.r('DK_G'));
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, true)$q$, pg_temp.c('K10')));
  PERFORM pg_temp.ghi('G1', 'dòng đầu kỳ thứ hai cho cùng khách → chặn (uq_receivables_opening)', e LIKE '%uq_receivables_opening%', left(e, 60));
  PERFORM pg_temp.vai('owner');
  INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('K11'), 1000, true);
  PERFORM pg_temp.ghi('G1', 'chủ NPP thêm nợ đầu kỳ được (K11: 1.000)', pg_temp.no('K11') = 1000, pg_temp.no('K11')::text);
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, true)$q$, pg_temp.c('K10')));
  PERFORM pg_temp.ghi('G2', 'NVBH thêm nợ đầu kỳ → bị RLS chặn', e LIKE '%row-level security%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, true)$q$, pg_temp.c('K10')));
  PERFORM pg_temp.ghi('G2', 'thủ kho thêm nợ đầu kỳ → bị RLS chặn', e LIKE '%row-level security%', left(e, 60));
  PERFORM pg_temp.vai('accountant');
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, paid, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, 1000, true)$q$, pg_temp.c('K10')));
  PERFORM pg_temp.ghi('G3', 'thêm đầu kỳ kèm "đã thu" → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, false)$q$, pg_temp.c('K10')));
  PERFORM pg_temp.ghi('G3', 'thêm công nợ thường (không đầu kỳ) → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance, invoice_id) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, true, %L)$q$, pg_temp.c('K10'), pg_temp.c('H8')));
  PERFORM pg_temp.ghi('G3', 'thêm đầu kỳ trỏ HĐ → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET amount = 700000 WHERE id = %L', v));
  PERFORM pg_temp.ghi('G4', 'sửa số đầu kỳ chưa thu 500k → 700k được; nợ K10 = 700.000',
    e = '1 dòng' AND pg_temp.amt('DK_G') = 700000 AND pg_temp.no('K10') = 700000, e || ' nợ ' || pg_temp.no('K10'));
  PERFORM pg_temp.pt('K10', jsonb_build_array(pg_temp.ln('DK_G', 200000)));
  e := pg_temp.ghi_thang(format('DELETE FROM receivables WHERE id = %L', v));
  PERFORM pg_temp.ghi('G5', 'xoá đầu kỳ ĐÃ thu 200k → CONG_NO_KHOA, còn nguyên', e LIKE 'CONG_NO_KHOA%' AND pg_temp.amt('DK_G') = 700000, left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET amount = 150000 WHERE id = %L', v));
  PERFORM pg_temp.ghi('G5', 'hạ số đầu kỳ xuống dưới số đã thu (150k < 200k) → được (Q11), thành dư có −50k, open',
    e = '1 dòng' AND pg_temp.st('DK_G') = 'open' AND pg_temp.amt('DK_G') - pg_temp.paid('DK_G') = -50000, pg_temp.r('DK_G'));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET paid = 0 WHERE id = %L', v));
  PERFORM pg_temp.ghi('G6', 'sửa thẳng paid → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%' AND pg_temp.paid('DK_G') = 200000, left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET customer_id = %L WHERE id = %L', pg_temp.c('K11'), v));
  PERFORM pg_temp.ghi('G6', 'chuyển khoản nợ sang khách khác → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET opening_balance = false WHERE id = %L', v));
  PERFORM pg_temp.ghi('G6', 'bỏ cờ đầu kỳ → CONG_NO_KHOA', e LIKE 'CONG_NO_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET amount = 1 WHERE id = %L', pg_temp.rc('H8')));
  PERFORM pg_temp.ghi('G7', 'sửa số nợ của HĐ → CONG_NO_KHOA, HĐ8 vẫn 400.000', e LIKE 'CONG_NO_KHOA%' AND pg_temp.amt('H8') = 400000, left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE receivables SET status = %L WHERE id = %L', 'paid', pg_temp.rc('H8')));
  PERFORM pg_temp.ghi('G7', 'đổi status=paid thẳng trên HĐ còn nợ → trigger giữ open (không giấu nợ)', pg_temp.st('H8') = 'open' AND pg_temp.no('K6') = 400000, e || ' ' || pg_temp.r('H8'));
  e := pg_temp.ghi_thang(format('DELETE FROM receivables WHERE id = %L', pg_temp.rc('H8')));
  PERFORM pg_temp.ghi('G7', 'xoá công nợ HĐ → bị chặn (RLS/CONG_NO_KHOA), HĐ8 còn', (e = '0 dòng' OR e LIKE 'CONG_NO_KHOA%') AND pg_temp.amt('H8') = 400000, e);
  PERFORM pg_temp.vai('accountant');
  e := pg_temp.ghi_thang(format('DELETE FROM receivables WHERE customer_id = %L AND opening_balance', pg_temp.c('K11')));
  PERFORM pg_temp.ghi('G8', 'kế toán xoá đầu kỳ chưa thu → được; nợ K11 = 0; K10 vẫn −50.000',
    e = '1 dòng' AND pg_temp.no('K11') = 0 AND pg_temp.no('K10') = -50000, e || ' nợ ' || pg_temp.no('K10'));
  PERFORM pg_temp.vai('manager');
  e := pg_temp.thu(format($q$INSERT INTO receivables (org_id, customer_id, amount, opening_balance) VALUES ('a0000000-0000-0000-0000-000000000001', %L, 1000, true)$q$, pg_temp.c('K11')));
  PERFORM pg_temp.ghi('G2', 'quản lý thêm nợ đầu kỳ → RLS chặn (chỉ chủ / kế toán)', e LIKE '%row-level security%', left(e, 60));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('G', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ H. GHI THẲNG TIỀN / PHIẾU THU TỪ TRÌNH DUYỆT (mig 214) ═════════════════════
RESET ROLE;
INSERT INTO cash_receipts (org_id, receipt_code, receipt_date, source_type, status, submitted_amount, expected_amount, collected_by, created_by)
VALUES ('a0000000-0000-0000-0000-000000000001', 'PT-CN-CHO', pg_temp.hn(), 'standalone', 'pending', 0, 0,
        'e0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004');
SET LOCAL ROLE authenticated;
DO $t$ DECLARE e text; p uuid; pay uuid; BEGIN
  PERFORM pg_temp.vai('accountant');
  p := pg_temp.pt('K6', jsonb_build_array(pg_temp.ln('H8', 100000)));
  INSERT INTO ctx VALUES ('P_H', p);
  pay := (SELECT payment_id FROM cash_receipt_lines WHERE receipt_id = p);
  e := pg_temp.ghi_thang(format('UPDATE payments SET amount = 1 WHERE id = %L', pay));
  PERFORM pg_temp.ghi('H1', 'kế toán sửa thẳng payments.amount → THU_TIEN_KHOA', e LIKE 'THU_TIEN_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format($q$INSERT INTO payments (receivable_id, collected_by, amount, method) VALUES (%L, 'e0000000-0000-0000-0000-000000000003', 500000, 'cash')$q$, pg_temp.rc('H8')));
  PERFORM pg_temp.ghi('H1', 'kế toán chèn thẳng payments → THU_TIEN_KHOA', e LIKE 'THU_TIEN_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE payments SET verified_by = %L, verified_at = now() WHERE id = %L', 'e0000000-0000-0000-0000-000000000003', pay));
  PERFORM pg_temp.ghi('H1', 'xác nhận (đối chiếu) payment → được', e = '1 dòng', e);
  e := pg_temp.ghi_thang(format('UPDATE cash_receipts SET submitted_amount = 9999999 WHERE id = %L', p));
  PERFORM pg_temp.ghi('H2', 'sửa thẳng số tiền phiếu thu → PHIEU_THU_KHOA', e LIKE 'PHIEU_THU_KHOA%', left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE cash_receipts SET status = %L WHERE id = %L', 'voided', p));
  PERFORM pg_temp.ghi('H2', 'đổi thẳng phiếu thu → voided (bỏ qua RPC huỷ) → PHIEU_THU_KHOA, HĐ8 vẫn paid 100k',
    e LIKE 'PHIEU_THU_KHOA%' AND pg_temp.paid('H8') = 100000, left(e, 60));
  e := pg_temp.ghi_thang(format('UPDATE cash_receipts SET notes = %L WHERE id = %L', 'ghi chú mới', p));
  PERFORM pg_temp.ghi('H2', 'sửa ghi chú phiếu thu → được', e = '1 dòng', e);
  e := pg_temp.ghi_thang($q$UPDATE cash_receipts SET status = 'received', received_by = 'e0000000-0000-0000-0000-000000000003', received_at = now() WHERE receipt_code = 'PT-CN-CHO'$q$);
  PERFORM pg_temp.ghi('H3', 'xác nhận phiếu thu chờ → đã nhận (ghi thẳng hợp lệ)', e = '1 dòng' AND pg_temp.chu($q$SELECT status FROM cash_receipts WHERE receipt_code = 'PT-CN-CHO'$q$) = 'received', e);
  e := pg_temp.ghi_thang($q$UPDATE cash_receipts SET status = 'pending' WHERE receipt_code = 'PT-CN-CHO'$q$);
  PERFORM pg_temp.ghi('H3', 'kéo phiếu đã nhận về chờ → PHIEU_THU_KHOA', e LIKE 'PHIEU_THU_KHOA%', left(e, 60));
  PERFORM pg_temp.vai('manager');
  e := pg_temp.ghi_thang(format('DELETE FROM cash_receipts WHERE id = %L', p));
  PERFORM pg_temp.ghi('H4', 'quản lý xoá thẳng phiếu thu → PHIEU_THU_KHOA', e LIKE 'PHIEU_THU_KHOA%', left(e, 60));
  PERFORM pg_temp.vai('owner');
  e := pg_temp.ghi_thang(format('DELETE FROM cash_receipt_lines WHERE receipt_id = %L', p));
  PERFORM pg_temp.ghi('H4', 'chủ xoá thẳng dòng phiếu thu → THU_TIEN_KHOA', e LIKE 'THU_TIEN_KHOA%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.ghi_thang($q$INSERT INTO cash_receipts (org_id, receipt_code, source_type, status, submitted_amount, expected_amount, collected_by)
       VALUES ('a0000000-0000-0000-0000-000000000001', 'PT-GIA-CN', 'manual', 'received', 9999999, 9999999, 'e0000000-0000-0000-0000-000000000005')$q$);
  PERFORM pg_temp.ghi('H5', 'thủ kho chèn thẳng phiếu thu 9.999.999đ → PHIEU_THU_KHOA', e LIKE 'PHIEU_THU_KHOA%', left(e, 60));
  PERFORM pg_temp.ghi('H6', 'sau mọi lần thử: HĐ8 paid 100k = Σpayments, phiếu 100k còn received',
    pg_temp.paid('H8') = 100000 AND pg_temp.sp('H8') = 100000 AND pg_temp.ptc(p, 'status') = 'received'
    AND pg_temp.ptc(p, 'submitted_amount')::numeric = 100000, pg_temp.r('H8'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('H', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ I. QUYỀN THEO VAI (mig 215) ═════════════════════
DO $t$ DECLARE e text; p uuid; BEGIN
  PERFORM pg_temp.vai('owner');
  p := pg_temp.pt('K7', jsonb_build_array(pg_temp.ln('H9', 1000)));
  PERFORM pg_temp.ghi('I1', 'chủ NPP lập phiếu thu được', p IS NOT NULL AND pg_temp.paid('H9') = 1000, pg_temp.r('H9'));
  PERFORM pg_temp.vai('manager');
  p := pg_temp.pt('K7', jsonb_build_array(pg_temp.ln('H9', 2000)));
  PERFORM pg_temp.ghi('I1', 'quản lý lập phiếu thu được (mig 215 mở)', p IS NOT NULL AND pg_temp.paid('H9') = 3000
    AND pg_temp.ptc(p, 'collected_by') = 'e0000000-0000-0000-0000-000000000002', pg_temp.r('H9'));
  INSERT INTO ctx VALUES ('P_I_QL', p);
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K7', jsonb_build_array(pg_temp.ln('H9', 1000))));
  PERFORM pg_temp.ghi('I2', 'NVBH lập phiếu thu → FORBIDDEN (mig 202 NVBH chỉ còn bán hàng)', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT pg_temp.pt(%L, %L)', 'K7', jsonb_build_array(pg_temp.ln('H9', 1000))));
  PERFORM pg_temp.ghi('I2', 'thủ kho lập phiếu thu → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', pg_temp.c('P_I_QL'), 'x'));
  PERFORM pg_temp.ghi('I3', 'NVBH huỷ phiếu thu → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', pg_temp.c('P_I_QL'), 'x'));
  PERFORM pg_temp.ghi('I3', 'thủ kho huỷ phiếu thu → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('manager');
  PERFORM void_cash_receipt(pg_temp.c('P_I_QL'), 'quản lý huỷ');
  PERFORM pg_temp.ghi('I3', 'quản lý huỷ phiếu thu được → HĐ9 về 1.000', pg_temp.paid('H9') = 1000, pg_temp.r('H9'));
  PERFORM pg_temp.vai('khac');
  e := pg_temp.thu(format('SELECT create_cash_receipt(%L)', jsonb_build_object('customer_id', pg_temp.c('K7'), 'lines', jsonb_build_array(pg_temp.ln('H9', 1000)))));
  PERFORM pg_temp.ghi('I4', 'chủ NPP khác thu HĐ của NPP này → BAD_RECEIVABLE_LINE', e LIKE 'BAD_RECEIVABLE_LINE%', left(e, 60));
  e := pg_temp.thu(format('SELECT void_cash_receipt(%L, %L)', pg_temp.c('P_H'), 'x'));
  PERFORM pg_temp.ghi('I4', 'chủ NPP khác huỷ phiếu thu NPP này → ORG_MISMATCH', e LIKE 'ORG_MISMATCH%', left(e, 60));
  PERFORM pg_temp.ghi('I4', 'chủ NPP khác không đọc được công nợ NPP này (RLS)',
    (SELECT count(*) FROM receivables WHERE customer_id = pg_temp.c('K7')) = 0, '');
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('I5', 'NVBH chỉ thấy công nợ mình đứng tên (K7: 2 HĐ của NVBH)',
    (SELECT count(*) FROM receivables WHERE customer_id = pg_temp.c('K7')) = 2
    AND (SELECT count(*) FROM receivables WHERE sales_user_id IS DISTINCT FROM 'e0000000-0000-0000-0000-000000000004') = 0, '');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('I', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
-- I6 Quyền riêng từng người: NVBH được cấp riêng receivables.create → lập được
RESET ROLE;
INSERT INTO user_permission_overrides (user_id, permission_key, granted, org_id)
VALUES ('e0000000-0000-0000-0000-000000000004', 'receivables.create', true, 'a0000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
DO $t$ DECLARE p uuid; BEGIN
  PERFORM pg_temp.vai('sales');
  p := pg_temp.pt('K7', jsonb_build_array(pg_temp.ln('H9', 4000)));
  PERFORM pg_temp.ghi('I6', 'NVBH được cấp quyền riêng receivables.create → lập phiếu được, HĐ9 5.000',
    p IS NOT NULL AND pg_temp.paid('H9') = 5000, pg_temp.r('H9'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('I6', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ J. TUỔI NỢ receivables_summary (ngưỡng theo ngày VN) ═════════════════════
RESET ROLE;
CREATE TEMP TABLE tn0 ON COMMIT DROP AS
  SELECT * FROM (SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true)) x, receivables_summary();
GRANT ALL ON tn0 TO authenticated;
SELECT pg_temp.dk('J1', 'KJ1', 100, pg_temp.hn() + 5), pg_temp.dk('J2', 'KJ2', 200, pg_temp.hn()),
       pg_temp.dk('J3', 'KJ3', 300, pg_temp.hn() - 1), pg_temp.dk('J4', 'KJ4', 400, pg_temp.hn() - 30),
       pg_temp.dk('J5', 'KJ5', 500, pg_temp.hn() - 31), pg_temp.dk('J6', 'KJ6', 600, pg_temp.hn() - 60),
       pg_temp.dk('J7', 'KJ7', 700, pg_temp.hn() - 61), pg_temp.dk('J8', 'KJ8', 800, NULL),
       pg_temp.dk('J9', 'KJ9', 900, pg_temp.hn() - 100, 900), pg_temp.dk('J10', 'KJ10', -1000, pg_temp.hn() - 90),
       pg_temp.dk('J11', 'KJ11', 1000, pg_temp.hn() - 45, 250);
SET LOCAL ROLE authenticated;
SELECT pg_temp.vai('owner');
DO $t$ DECLARE a record; b record; BEGIN
  SELECT * INTO a FROM tn0;
  SELECT * INTO b FROM receivables_summary();
  PERFORM pg_temp.ghi('J1', 'trong hạn: hạn +5, hạn HÔM NAY, không hạn → 100+200+800 = 1.100 (3 khoản)',
    b.current_amount - a.current_amount = 1100 AND b.current_count - a.current_count = 3,
    format('Δ %s / %s', b.current_amount - a.current_amount, b.current_count - a.current_count));
  PERFORM pg_temp.ghi('J2', 'cảnh báo (quá 1–30 ngày): 300 + 400 = 700 (2 khoản)',
    b.warning_amount - a.warning_amount = 700 AND b.warning_count - a.warning_count = 2,
    format('Δ %s / %s', b.warning_amount - a.warning_amount, b.warning_count - a.warning_count));
  PERFORM pg_temp.ghi('J3', 'quá hạn (31–60): 500 + 600 + (1.000 − 250 đã thu) = 1.850 (3 khoản)',
    b.overdue_amount - a.overdue_amount = 1850 AND b.overdue_count - a.overdue_count = 3,
    format('Δ %s / %s', b.overdue_amount - a.overdue_amount, b.overdue_count - a.overdue_count));
  PERFORM pg_temp.ghi('J4', 'khẩn cấp (>60): 700 + dòng âm −1.000 = −300 (2 khoản), khoản đã thu đủ không tính',
    b.critical_amount - a.critical_amount = -300 AND b.critical_count - a.critical_count = 2,
    format('Δ %s / %s', b.critical_amount - a.critical_amount, b.critical_count - a.critical_count));
  PERFORM pg_temp.ghi('J5', 'tổng còn nợ tăng đúng 1.100 + 700 + 1.850 − 300 = 3.350; = Σ bốn nhóm',
    b.total_outstanding - a.total_outstanding = 3350
    AND b.total_outstanding = b.current_amount + b.warning_amount + b.overdue_amount + b.critical_amount,
    format('Δ %s', b.total_outstanding - a.total_outstanding));
  PERFORM pg_temp.ghi('J5', 'Σ nợ 11 khách KJ* theo công thức loadCustomerDebt = 3.350',
    (SELECT sum(pg_temp.no(k)) FROM ctx WHERE k ~ '^KJ[0-9]+$') = 3350, (SELECT sum(pg_temp.no(k)) FROM ctx WHERE k ~ '^KJ[0-9]+$')::text);
  PERFORM pg_temp.vai('sales');
  SELECT * INTO b FROM receivables_summary();
  PERFORM pg_temp.ghi('J6', 'NVBH gọi receivables_summary chỉ thấy nợ mình đứng tên (đầu kỳ KJ* không có tên → không tính)',
    b.total_outstanding = (SELECT pg_temp.so($q$SELECT COALESCE(sum(amount - paid),0) FROM receivables WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004' AND status <> 'paid'$q$)),
    b.total_outstanding::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('J', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ K. NHÂN VIÊN NGHỈ VIỆC → CÔNG NỢ VỀ NPP (mig 223) ═════════════════════
DO $t$ DECLARE j jsonb; e text; BEGIN
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.pt('K4', jsonb_build_array(pg_temp.ln('H6b', 100000)));
  PERFORM pg_temp.pt('K4', jsonb_build_array(pg_temp.ln('H6', 300000)));
  PERFORM pg_temp.vai('manager');
  e := pg_temp.thu(format('SELECT cho_nhan_vien_nghi(%L)', 'e9990000-0000-0000-0000-0000000000c2'));
  PERFORM pg_temp.ghi('K1', 'quản lý cho NV nghỉ → KHONG_DU_QUYEN (chỉ chủ NPP)', e LIKE 'KHONG_DU_QUYEN%', left(e, 60));
  PERFORM pg_temp.vai('owner');
  j := cho_nhan_vien_nghi('e9990000-0000-0000-0000-0000000000c2');
  PERFORM pg_temp.ghi('K2', 'cho nghỉ: 1 khoản chưa thu xong (HĐ6 còn 500k) về NPP — RPC báo đúng số khoản / số tiền',
    (j->>'so_khoan_no')::int = 1 AND (j->>'tien_no')::numeric = 500000, j::text);
  PERFORM pg_temp.ghi('K2', 'HĐ6: không còn người đứng tên, có cờ ve_npp_luc; HĐ6b đã thu đủ giữ tên người cũ',
    pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) IS NULL
    AND pg_temp.chu(format('SELECT ve_npp_luc::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) IS NOT NULL
    AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6b'))) = 'e9990000-0000-0000-0000-0000000000c2', '');
  PERFORM pg_temp.ghi('K2', 'nợ khách K4 không đổi (500.000) — chỉ đổi người đứng tên', pg_temp.no('K4') = 500000, pg_temp.no('K4')::text);
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.pt('K4', jsonb_build_array(pg_temp.ln('H6', 100000)));
  PERFORM pg_temp.ghi('K3', 'thu tiền sau khi về NPP → paid 400k, vẫn không về người cũ',
    pg_temp.paid('H6') = 400000 AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) IS NULL, pg_temp.r('H6'));
  e := pg_temp.thu(format('SELECT giao_cong_no_npp(%L, %L)', pg_temp.c('K4'), 'e9990000-0000-0000-0000-0000000000c2'));
  PERFORM pg_temp.ghi('K4', 'giao nợ lại cho người ĐÃ nghỉ → NV_KHONG_HOP_LE', e LIKE 'NV_KHONG_HOP_LE%', left(e, 60));
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT giao_cong_no_npp(%L, %L)', pg_temp.c('K4'), 'e0000000-0000-0000-0000-000000000004'));
  PERFORM pg_temp.ghi('K4', 'NVBH tự nhận nợ về mình → KHONG_DU_QUYEN', e LIKE 'KHONG_DU_QUYEN%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT giao_cong_no_npp(%L, %L)', pg_temp.c('K4'), 'e0000000-0000-0000-0000-000000000004'));
  PERFORM pg_temp.ghi('K4', 'thủ kho giao nợ → KHONG_DU_QUYEN', e LIKE 'KHONG_DU_QUYEN%', left(e, 60));
  PERFORM pg_temp.vai('khac');
  j := giao_cong_no_npp(pg_temp.c('K4'), 'e9990000-0000-0000-0000-0000000000c1');
  PERFORM pg_temp.ghi('K4', 'NPP khác gọi giao nợ khách NPP này → 0 khoản, nợ vẫn của NPP',
    (j->>'so_khoan_no')::int = 0 AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) IS NULL, j::text);
  PERFORM pg_temp.vai('accountant');
  j := giao_cong_no_npp(pg_temp.c('K4'), 'e0000000-0000-0000-0000-000000000004');
  PERFORM pg_temp.ghi('K5', 'kế toán phân lại nợ K4 cho NVBH Dung → 1 khoản, 400.000; cờ về NPP xoá',
    (j->>'so_khoan_no')::int = 1 AND (j->>'tien_no')::numeric = 400000
    AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) = 'e0000000-0000-0000-0000-000000000004'
    AND pg_temp.chu(format('SELECT ve_npp_luc::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) IS NULL, j::text);
  PERFORM pg_temp.pt('K4', jsonb_build_array(pg_temp.ln('H6', 50000)));
  PERFORM pg_temp.ghi('K6', 'thu tiếp sau khi phân lại → vẫn Dung đứng tên (tính lại không kéo về người đã nghỉ)',
    pg_temp.paid('H6') = 450000
    AND pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) = 'e0000000-0000-0000-0000-000000000004', pg_temp.r('H6'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('K', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;
RESET ROLE;
DO $t$ BEGIN
  PERFORM _wf2b_recompute_receivable(pg_temp.c('H6'));
  PERFORM pg_temp.ghi('K6', '_wf2b_recompute_receivable (HĐ vẫn ghi người đã nghỉ) → giữ Dung, không về người nghỉ',
    pg_temp.chu(format('SELECT sales_user_id::text FROM receivables WHERE id = %L', pg_temp.rc('H6'))) = 'e0000000-0000-0000-0000-000000000004', '');
END $t$;

-- ═════════════════════ L. HUỶ HĐ KHI ĐÃ THU (công nợ theo HĐ) ═════════════════════
SET LOCAL ROLE authenticated;
DO $t$ DECLARE e text; BEGIN
  PERFORM pg_temp.vai('owner');
  e := pg_temp.thu(format('SELECT cancel_invoice(%L, %L)', pg_temp.c('H8'), 'thử'));
  PERFORM pg_temp.ghi('L1', 'huỷ HĐ8 đã thu 100k → bị khoá (LOCKED_HAS_PAYMENT), nợ giữ nguyên',
    e LIKE '%LOCKED_HAS_PAYMENT%' AND pg_temp.amt('H8') = 400000, left(e, 70));
  PERFORM pg_temp.vai('accountant');
  PERFORM void_cash_receipt(pg_temp.c('P_H'), 'để huỷ HĐ');
  PERFORM pg_temp.vai('owner');
  PERFORM cancel_invoice(pg_temp.c('H8'), 'khách không lấy');
  PERFORM pg_temp.ghi('L2', 'huỷ phiếu thu rồi huỷ HĐ → phiếu công nợ HĐ8 biến mất, nợ K6 = 0, đơn Đã huỷ',
    pg_temp.so(format('SELECT count(*) FROM receivables WHERE invoice_id = %L', pg_temp.c('H8'))) = 0 AND pg_temp.no('K6') = 0
    AND pg_temp.chu(format('SELECT status FROM sales_orders WHERE id = %L', pg_temp.c('H8.don'))) = 'cancelled',
    format('nợ %s, đơn %s', pg_temp.no('K6'), pg_temp.chu(format('SELECT status FROM sales_orders WHERE id = %L', pg_temp.c('H8.don')))));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('L', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ M. CÔNG NỢ NCC + TRẢ TIỀN NCC (mig 167) ═════════════════════
RESET ROLE;
DO $d$ DECLARE s uuid; p uuid; p2 uuid; BEGIN
  INSERT INTO suppliers (org_id, name, code) VALUES ('a0000000-0000-0000-0000-000000000001', 'NCC thử CN', 'NCC-CN') RETURNING id INTO s;
  INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, due_date, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', s, 'HD-NCC-1', 1000000, 0, pg_temp.hn() + 30, 'open') RETURNING id INTO p;
  INSERT INTO payables (org_id, supplier_id, invoice_number, amount, paid, due_date, status)
  VALUES ('a0000000-0000-0000-0000-000000000001', s, 'HD-NCC-2', 250000.5, 0, pg_temp.hn() + 30, 'open') RETURNING id INTO p2;
  INSERT INTO ctx VALUES ('NCC', s), ('PAY1', p), ('PAY2', p2);
END $d$;
CREATE FUNCTION pg_temp.pay(k text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
  $f$ SELECT format('amt=%s paid=%s st=%s', amount, paid, status) FROM payables WHERE id = pg_temp.c(k) $f$;
SET LOCAL ROLE authenticated;
DO $t$ DECLARE r record; e text; BEGIN
  PERFORM pg_temp.vai('accountant');
  SELECT * INTO r FROM record_payable_payment(pg_temp.c('PAY1'), 400000, 'transfer', 'đợt 1');
  PERFORM pg_temp.ghi('M1', 'kế toán trả NCC 400k/1tr → paid 400k partial, 1 phiếu chi',
    r.new_paid = 400000 AND r.new_status = 'partial' AND pg_temp.pay('PAY1') = 'amt=1000000 paid=400000 st=partial'
    AND pg_temp.so(format('SELECT count(*) FROM payable_payments WHERE payable_id = %L', pg_temp.c('PAY1'))) = 1, pg_temp.pay('PAY1'));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 600001, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M2', 'trả vượt 1 đồng → OVERPAY', e LIKE 'OVERPAY%', left(e, 60));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 0, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M2', 'trả 0đ → BAD_AMOUNT', e LIKE 'BAD_AMOUNT%', left(e, 60));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, -5000, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M2', 'trả âm → BAD_AMOUNT', e LIKE 'BAD_AMOUNT%', left(e, 60));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', gen_random_uuid(), 'cash'));
  PERFORM pg_temp.ghi('M2', 'khoản không tồn tại → PAYABLE_NOT_FOUND', e LIKE 'PAYABLE_NOT_FOUND%', left(e, 60));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', pg_temp.c('PAY1'), 'bitcoin'));
  PERFORM pg_temp.ghi('M2', 'hình thức lạ → bị chặn (check method), paid giữ 400k', e <> 'KHÔNG LỖI' AND pg_temp.pay('PAY1') LIKE '%paid=400000 %', left(e, 60));
  PERFORM pg_temp.vai('manager');
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M3', 'quản lý trả NCC → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M3', 'NVBH trả NCC → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M3', 'thủ kho trả NCC → FORBIDDEN', e LIKE 'FORBIDDEN%', left(e, 60));
  PERFORM pg_temp.vai('khac');
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1000, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M3', 'chủ NPP khác trả nợ NCC của NPP này → ORG_MISMATCH', e LIKE 'ORG_MISMATCH%', left(e, 60));
  PERFORM pg_temp.vai('owner');
  SELECT * INTO r FROM record_payable_payment(pg_temp.c('PAY1'), 600000, 'cash', NULL);
  PERFORM pg_temp.ghi('M4', 'chủ trả nốt 600k → paid 1tr, trạng thái paid, Σ phiếu chi = paid',
    r.new_status = 'paid' AND pg_temp.pay('PAY1') = 'amt=1000000 paid=1000000 st=paid'
    AND pg_temp.so(format('SELECT sum(amount) FROM payable_payments WHERE payable_id = %L', pg_temp.c('PAY1'))) = 1000000, pg_temp.pay('PAY1'));
  e := pg_temp.thu(format('SELECT record_payable_payment(%L, 1, %L, NULL)', pg_temp.c('PAY1'), 'cash'));
  PERFORM pg_temp.ghi('M4', 'trả thêm khi đã trả đủ → OVERPAY', e LIKE 'OVERPAY%', left(e, 60));
  SELECT * INTO r FROM record_payable_payment(pg_temp.c('PAY2'), 250000.5, 'cash', NULL);
  PERFORM pg_temp.ghi('M5', 'nợ NCC số lẻ 250.000,5 trả đúng số lẻ → paid', r.new_status = 'paid', pg_temp.pay('PAY2'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ghi('M', 'LỖI BẤT NGỜ', false, SQLERRM);
END $t$;

-- ═════════════════════ Z. BẤT BIẾN TOÀN SỔ (sau mọi bước) ═════════════════════
RESET ROLE;
DO $t$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM receivables r
  WHERE r.customer_id IN (SELECT v FROM ctx WHERE k ~ '^K[0-9]+$')
    AND abs(COALESCE(r.paid, 0) - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.receivable_id = r.id), 0)) > 0.001
    AND NOT r.opening_balance;
  PERFORM pg_temp.ghi('Z1', 'mọi phiếu công nợ HĐ / phiếu trả: paid = Σ payments', n = 0, n || ' phiếu lệch');
  SELECT count(*) INTO n FROM cash_receipts cr
  WHERE cr.status <> 'voided' AND cr.org_id = 'a0000000-0000-0000-0000-000000000001'
    AND EXISTS (SELECT 1 FROM cash_receipt_lines l WHERE l.receipt_id = cr.id)
    AND abs(cr.submitted_amount - COALESCE((SELECT sum(l.amount) FROM cash_receipt_lines l WHERE l.receipt_id = cr.id AND l.kind = 'payment'), 0)) > 0.001;
  PERFORM pg_temp.ghi('Z2', 'mọi phiếu thu còn hiệu lực: tiền nộp = Σ dòng payment', n = 0, n || ' phiếu lệch');
  SELECT count(*) INTO n FROM receivables r
  WHERE r.customer_id IN (SELECT v FROM ctx WHERE k ~ '^K[0-9]+$')
    AND ((abs(r.amount - COALESCE(r.paid, 0)) < 0.01) <> (r.status = 'paid'));
  PERFORM pg_temp.ghi('Z3', 'mọi phiếu: status = paid ⇔ |amount − paid| < 0,01', n = 0, n || ' phiếu sai trạng thái');
  SELECT count(*) INTO n FROM cash_receipt_lines l JOIN cash_receipts cr ON cr.id = l.receipt_id
  WHERE cr.status = 'voided' AND l.payment_id IS NOT NULL;
  PERFORM pg_temp.ghi('Z4', 'phiếu đã huỷ không còn dòng trỏ payment', n = 0, n || ' dòng');
END $t$;

SELECT stt, buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, left(ghi, 140) AS ghi FROM kq ORDER BY stt;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
