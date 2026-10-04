-- ====================================================================
-- ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — kịch bản SQL thật (xanh).
--
-- Phủ: tạo đơn nguyên tử (create_order_with_lines, mig 169) · gửi hai lần
-- (client_request_id) · đơn ma · đơn vị rỗng / quy đổi (mig 175, 174) ·
-- phiếu trả kèm đơn · VAT dòng (mig 183) · người đứng tên đơn (mig 153/155) ·
-- quyền từng vai (owner/manager/accountant/warehouse/sales) · nháp kín (mig 161)
-- · NVBH chỉ thấy đơn của mình (RLS) · sửa đơn · chuyển trạng thái ·
-- huỷ đơn (cancel_order) · xuất hàng theo hệ số quy đổi (post_invoice) →
-- đơn Hoàn thành, kho trừ theo đơn vị cơ sở, công nợ theo HÓA ĐƠN ·
-- khoá dòng đơn đã xuất · huỷ HĐ = huỷ đơn (mig 217).
--
-- Chạy:  psql -h /tmp/pgtest -p 55432 -U postgres -d npp_ban_hang -v ON_ERROR_STOP=1 \
--          -f scripts/sql/doi-test/ban-hang.sql
-- Mọi thứ bọc BEGIN … ROLLBACK; cuối in bảng kq (buoc, ten, ok, ghi).
-- ====================================================================
\set ON_ERROR_STOP on
-- Supabase cấp sẵn các quyền này cho `authenticated`; Postgres ở máy thì không.
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;

BEGIN;
-- Mig 229 chặn giá trần ở máy chủ: dữ liệu thử đặt giá tuỳ ý (vd 10.000 khi giá bảng 9.500) — cho NVBH thử được nâng giá
-- để kịch bản vẫn kiểm đúng thứ nó định kiểm. Luật giá trần có kịch bản riêng: scripts/sql/thu-229-gia-tran.sql.
UPDATE users SET allow_price_edit = true, price_edit_max_increase_pct = 100 WHERE role = 'sales';
CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

-- ---------------------------------------------------------------- dữ liệu
-- Vai có sẵn trong 003_seed: e…01 owner · e…02 manager · e…03 accountant ·
-- e…04 sales · e…05 warehouse. Thêm NVBH thứ hai e…a6 (S2).
-- Coca c…01: đơn vị cơ sở 'lon', 'Loc 6' = 6, 'Thung 24' = 24.
INSERT INTO auth.users (id) VALUES ('e0000000-0000-0000-0000-0000000000a6');
INSERT INTO users (id, org_id, full_name, role)
VALUES ('e0000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'NVBH Thứ Hai', 'sales');

DO $d$
DECLARE v_org uuid := 'a0000000-0000-0000-0000-000000000001'; v_kh uuid; v_kh2 uuid;
BEGIN
  INSERT INTO customers (org_id, store_name, owner_name, phone, address, credit_limit)
  VALUES (v_org, 'Khách Đội Bán Hàng', 'Anh Ba', '0900111222', '1 Đường Thử', 1000000) RETURNING id INTO v_kh;
  INSERT INTO customers (org_id, store_name, owner_name, phone, address)
  VALUES (v_org, 'Khách Đội Bán Hàng 2', 'Chị Tư', '0900111333', '2 Đường Thử') RETURNING id INTO v_kh2;
  INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand, unit_cost, warehouse_zone, received_at)
  VALUES (v_org, 'c0000000-0000-0000-0000-000000000001', 'LO-BH-1', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 300, 1000, 1000, 6000, 'sale', now());
  INSERT INTO ctx VALUES ('kh', v_kh), ('kh2', v_kh2);
END $d$;

-- ---------------------------------------------------------------- tiện ích
CREATE FUNCTION pg_temp.ghi(b text, t text, ok boolean, g text) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO kq VALUES (b, t, COALESCE(ok, false), g) $f$;
CREATE FUNCTION pg_temp.c(k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM ctx WHERE ctx.k = $1 $f$;
CREATE FUNCTION pg_temp.vai(u text) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claim.sub',
    CASE u WHEN 'owner' THEN 'e0000000-0000-0000-0000-000000000001'
           WHEN 'manager' THEN 'e0000000-0000-0000-0000-000000000002'
           WHEN 'accountant' THEN 'e0000000-0000-0000-0000-000000000003'
           WHEN 'sales' THEN 'e0000000-0000-0000-0000-000000000004'
           WHEN 'warehouse' THEN 'e0000000-0000-0000-0000-000000000005'
           WHEN 'sales2' THEN 'e0000000-0000-0000-0000-0000000000a6' END, true); $f$;
-- Chạy một câu lệnh, trả 'OK' hoặc câu lỗi (giao dịch con tự lùi khi lỗi).
CREATE FUNCTION pg_temp.thu(q text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE q; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $f$;
-- Dòng đơn dạng tải trọng của màn /sell.
CREATE FUNCTION pg_temp.dong(sp text, dv text, sl numeric, gia numeric, hs numeric DEFAULT 1, giam numeric DEFAULT 0, vat numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object('product_id', sp, 'unit_name', dv, 'quantity', sl, 'unit_price', gia,
         'line_discount', giam, 'line_total', sl * gia - giam, 'conversion_factor', hs, 'vat_rate', vat)) $f$;
CREATE FUNCTION pg_temp.tai(crid uuid, kh uuid, lines jsonb, don jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('client_request_id', crid,
    'order', jsonb_build_object('order_code', 'TAM-1', 'customer_id', kh, 'payment_terms', 'NET30',
                                'subtotal', 0, 'vat', 0, 'total', 0, 'status', 'submitted') || don,
    'lines', lines) $f$;
CREATE FUNCTION pg_temp.ton() RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(qty_on_hand), 0) FROM batches WHERE product_id = 'c0000000-0000-0000-0000-000000000001' $f$;
CREATE FUNCTION pg_temp.no_khach(kh uuid) RETURNS numeric LANGUAGE sql AS
  $f$ SELECT COALESCE(sum(amount - COALESCE(paid, 0)), 0) FROM receivables WHERE customer_id = kh AND status <> 'paid' $f$;
CREATE FUNCTION pg_temp.so_don(crid uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $f$ SELECT count(*) FROM sales_orders WHERE client_request_id = crid $f$;
CREATE FUNCTION pg_temp.don_cua(crid uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $f$ SELECT id FROM sales_orders WHERE client_request_id = crid $f$;
CREATE FUNCTION pg_temp.st(id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $f$ SELECT status FROM sales_orders WHERE sales_orders.id = $1 $f$;
CREATE FUNCTION pg_temp.so_dong(id uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $f$ SELECT count(*) FROM sales_order_lines WHERE order_id = $1 $f$;

SET LOCAL ROLE authenticated;

-- =============================================================== A. TẠO ĐƠN
-- A1 NVBH tạo đơn 2 dòng: 10 lon × 10.000 + 1 Thung 24 × 240.000 (hệ số 24)
DO $t$
DECLARE r record; crid uuid := '11111111-0000-0000-0000-000000000001'; o record;
BEGIN
  PERFORM pg_temp.vai('sales');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 10, 10000),
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'Thung 24', 1, 240000, 24)),
    jsonb_build_object('subtotal', 340000, 'total', 340000)));
  INSERT INTO ctx VALUES ('d1', r.order_id);
  SELECT * INTO o FROM sales_orders WHERE id = r.order_id;
  PERFORM pg_temp.ghi('A1', 'NVBH tạo đơn: trạng thái, người đứng tên, người tạo',
    o.status = 'submitted' AND o.sales_user_id = 'e0000000-0000-0000-0000-000000000004'
      AND o.created_by = 'e0000000-0000-0000-0000-000000000004'
      AND NOT r.already_existed AND o.total = 340000 AND o.payment_terms = 'NET30',
    format('status=%s nv=%s tạo=%s total=%s existed=%s', o.status, o.sales_user_id, o.created_by, o.total, r.already_existed));
  PERFORM pg_temp.ghi('A2', 'mã đơn do máy chủ cấp DH-xxxx, không lấy mã tạm',
    r.order_code ~ '^DH-[0-9]{4,}$' AND r.order_code = o.order_code AND o.order_code <> 'TAM-1', r.order_code);
  PERFORM pg_temp.ghi('A3', 'dòng giữ hệ số quy đổi (lon=1, Thung 24=24) và tiền dòng',
    (SELECT count(*) FROM sales_order_lines WHERE order_id = r.order_id) = 2
      AND (SELECT conversion_factor FROM sales_order_lines WHERE order_id = r.order_id AND unit_name = 'Thung 24') = 24
      AND (SELECT conversion_factor FROM sales_order_lines WHERE order_id = r.order_id AND unit_name = 'lon') = 1
      AND (SELECT sum(line_total) FROM sales_order_lines WHERE order_id = r.order_id) = 340000,
    (SELECT string_agg(unit_name || ':' || conversion_factor || ':' || line_total, ', ') FROM sales_order_lines WHERE order_id = r.order_id));
END $t$;

-- A4 Gửi lần hai CÙNG client_request_id → không đơn thứ hai, không nhân đôi dòng
DO $t$
DECLARE r record; crid uuid := '11111111-0000-0000-0000-000000000001';
BEGIN
  PERFORM pg_temp.vai('sales');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 99, 10000))));
  PERFORM pg_temp.ghi('A4', 'gửi hai lần cùng mã yêu cầu: một đơn, 2 dòng, already_existed',
    r.already_existed AND r.order_id = pg_temp.c('d1') AND pg_temp.so_don(crid) = 1 AND pg_temp.so_dong(r.order_id) = 2
      AND (SELECT sum(quantity) FROM sales_order_lines WHERE order_id = r.order_id) = 11,
    format('existed=%s cùng id=%s số đơn=%s số dòng=%s', r.already_existed, r.order_id = pg_temp.c('d1'), pg_temp.so_don(crid), pg_temp.so_dong(r.order_id)));
END $t$;

-- A5/A6 Tải trọng hỏng
DO $t$
DECLARE e text;
BEGIN
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)',
        pg_temp.tai(NULL, pg_temp.c('kh'), jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 1)))));
  PERFORM pg_temp.ghi('A5', 'thiếu client_request_id → BAD_PAYLOAD', e LIKE 'BAD_PAYLOAD%', e);
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)',
        pg_temp.tai('11111111-0000-0000-0000-000000000005', pg_temp.c('kh'), '[]'::jsonb)));
  PERFORM pg_temp.ghi('A6', 'đơn 0 dòng → BAD_PAYLOAD, không để lại đầu đơn',
    e LIKE 'BAD_PAYLOAD%' AND pg_temp.so_don('11111111-0000-0000-0000-000000000005') = 0, e);
END $t$;

-- A7 Nguyên tử: dòng thứ hai mang mã sản phẩm không có → lùi CẢ đầu đơn
DO $t$
DECLARE e text; crid uuid := '11111111-0000-0000-0000-000000000007';
BEGIN
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(
        pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000),
        pg_temp.dong('c0000000-0000-0000-0000-0000000fffff', 'lon', 1, 10000)))));
  PERFORM pg_temp.ghi('A7', 'dòng hỏng → không còn đơn ma', e <> 'OK' AND pg_temp.so_don(crid) = 0, left(e, 80));
END $t$;

-- A8 Đơn ma có sẵn (đầu đơn, 0 dòng) → gọi lại cùng mã thì vá dòng
DO $t$
DECLARE r record; crid uuid := '11111111-0000-0000-0000-000000000008'; v uuid;
BEGIN
  PERFORM pg_temp.vai('sales');
  INSERT INTO sales_orders (org_id, customer_id, sales_user_id, client_request_id, order_code, status, total)
  VALUES ('a0000000-0000-0000-0000-000000000001', pg_temp.c('kh'), 'e0000000-0000-0000-0000-000000000004', crid, 'X', 'submitted', 50000)
  RETURNING id INTO v;
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 5, 10000))));
  PERFORM pg_temp.ghi('A8', 'đơn ma 0 dòng được vá dòng khi gọi lại',
    r.already_existed AND r.order_id = v AND pg_temp.so_dong(v) = 1 AND pg_temp.so_don(crid) = 1,
    format('existed=%s dòng=%s', r.already_existed, pg_temp.so_dong(v)));
END $t$;

-- A9/A10 Đơn vị rỗng (mig 175): hệ số 1 → về đơn vị cơ sở; hệ số 24 → chặn, lùi cả đơn
DO $t$
DECLARE r record; e text; crid uuid := '11111111-0000-0000-0000-000000000009';
BEGIN
  PERFORM pg_temp.vai('sales');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', '', 2, 10000))));
  PERFORM pg_temp.ghi('A9', 'đơn vị rỗng hệ số 1 → lấy đơn vị cơ sở "lon"',
    (SELECT unit_name FROM sales_order_lines WHERE order_id = r.order_id) = 'lon',
    (SELECT unit_name FROM sales_order_lines WHERE order_id = r.order_id));
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai('11111111-0000-0000-0000-000000000010', pg_temp.c('kh'),
        jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', '', 1, 240000, 24)))));
  PERFORM pg_temp.ghi('A10', 'đơn vị rỗng hệ số 24 → UNIT_MISSING, không ghi đơn',
    e LIKE 'UNIT_MISSING%' AND pg_temp.so_don('11111111-0000-0000-0000-000000000010') = 0, left(e, 80));
END $t$;

-- A11 VAT dòng (mig 183): 0.08 giữ; 0.07 (ngoài bậc nhưng hợp lệ) giữ; 1.5 / chữ → NULL
DO $t$
DECLARE r record;
BEGIN
  PERFORM pg_temp.vai('sales');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai('11111111-0000-0000-0000-000000000011', pg_temp.c('kh'), jsonb_build_array(
    pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000, 1, 0, 0.08),
    pg_temp.dong('c0000000-0000-0000-0000-000000000002', 'lon', 1, 10000, 1, 0, 1.5),
    pg_temp.dong('c0000000-0000-0000-0000-000000000003', 'chai', 1, 10000) || '{"vat_rate":"abc"}')));
  PERFORM pg_temp.ghi('A11', 'thuế dòng hợp lệ giữ, thuế hỏng → NULL (không nổ)',
    (SELECT vat_rate FROM sales_order_lines WHERE order_id = r.order_id AND product_id = 'c0000000-0000-0000-0000-000000000001') = 0.08
      AND (SELECT vat_rate FROM sales_order_lines WHERE order_id = r.order_id AND product_id = 'c0000000-0000-0000-0000-000000000002') IS NULL
      AND (SELECT vat_rate FROM sales_order_lines WHERE order_id = r.order_id AND product_id = 'c0000000-0000-0000-0000-000000000003') IS NULL,
    (SELECT string_agg(coalesce(vat_rate::text, 'NULL'), ',' ORDER BY product_id) FROM sales_order_lines WHERE order_id = r.order_id));
END $t$;

-- A12 Phiếu trả kèm đơn → returns Nháp gắn đơn; gọi lại không sinh phiếu thứ hai
DO $t$
DECLARE r record; p jsonb; crid uuid := '11111111-0000-0000-0000-000000000012';
BEGIN
  PERFORM pg_temp.vai('sales');
  p := pg_temp.tai(crid, pg_temp.c('kh'), jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 20, 10000)))
       || jsonb_build_object('returns', jsonb_build_object('reason', 'damaged', 'notes', 'móp'),
          'return_lines', jsonb_build_array(jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000002', 'unit_name', 'lon',
             'quantity', 3, 'unit_price', 5000, 'vat_rate', 0, 'line_total', 15000, 'is_exchange', false)));
  SELECT * INTO r FROM create_order_with_lines(p);
  PERFORM create_order_with_lines(p);
  INSERT INTO ctx VALUES ('d_tra', r.order_id);
  PERFORM pg_temp.ghi('A12', 'phiếu trả kèm đơn: 1 phiếu Nháp, 1 dòng 3 lon, gắn đơn, người lập = NVBH',
    (SELECT count(*) FROM returns WHERE order_id = r.order_id) = 1
      AND (SELECT status FROM returns WHERE order_id = r.order_id) = 'draft'
      AND (SELECT requested_by FROM returns WHERE order_id = r.order_id) = 'e0000000-0000-0000-0000-000000000004'
      AND (SELECT sum(quantity) FROM return_lines rl JOIN returns rt ON rt.id = rl.return_id WHERE rt.order_id = r.order_id) = 3,
    format('số phiếu=%s', (SELECT count(*) FROM returns WHERE order_id = r.order_id)));
END $t$;

-- A13 Mặc định: không gửi trạng thái → Nháp; điều khoản rỗng → COD
DO $t$
DECLARE r record;
BEGIN
  PERFORM pg_temp.vai('sales');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai('11111111-0000-0000-0000-000000000013', pg_temp.c('kh'),
     jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)),
     jsonb_build_object('status', '', 'payment_terms', '')));
  INSERT INTO ctx VALUES ('nhap', r.order_id);
  PERFORM pg_temp.ghi('A13', 'mặc định trạng thái Nháp, điều khoản COD',
    (SELECT status = 'draft' AND payment_terms = 'COD' AND submitted_at IS NULL FROM sales_orders WHERE id = r.order_id),
    (SELECT status || '/' || payment_terms FROM sales_orders WHERE id = r.order_id));
END $t$;

-- =============================================================== B. QUYỀN TẠO ĐƠN
DO $t$
DECLARE e text; v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['accountant', 'warehouse'] LOOP
    PERFORM pg_temp.vai(v);
    e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai(gen_random_uuid(), pg_temp.c('kh'),
          jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)))));
    PERFORM pg_temp.ghi('B1-' || v, v || ' không tạo được đơn (RLS)', e LIKE '%row-level security%', left(e, 80));
  END LOOP;
END $t$;

DO $t$
DECLARE e text; r record;
BEGIN
  -- NVBH lập đơn đứng tên NVBH khác → chặn
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai(gen_random_uuid(), pg_temp.c('kh'),
        jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)),
        jsonb_build_object('sales_user_id', 'e0000000-0000-0000-0000-0000000000a6'))));
  PERFORM pg_temp.ghi('B2', 'NVBH không lập đơn hộ người khác', e LIKE 'DON_HO_KHONG_DUOC_PHEP%', left(e, 80));

  -- Quản lý lập đơn hộ NVBH → được; người đứng tên = NVBH, người tạo = quản lý
  PERFORM pg_temp.vai('manager');
  SELECT * INTO r FROM create_order_with_lines(pg_temp.tai('11111111-0000-0000-0000-0000000000b3', pg_temp.c('kh'),
        jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)),
        jsonb_build_object('sales_user_id', 'e0000000-0000-0000-0000-000000000004')));
  PERFORM pg_temp.ghi('B3', 'quản lý lập đơn hộ NVBH: đứng tên NVBH, người tạo quản lý',
    (SELECT sales_user_id = 'e0000000-0000-0000-0000-000000000004' AND created_by = 'e0000000-0000-0000-0000-000000000002'
       FROM sales_orders WHERE id = pg_temp.don_cua('11111111-0000-0000-0000-0000000000b3')), r.order_code);

  -- Chủ NPP gán đơn cho thủ kho → chặn (không phải vai bán hàng)
  PERFORM pg_temp.vai('owner');
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai(gen_random_uuid(), pg_temp.c('kh'),
        jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)),
        jsonb_build_object('sales_user_id', 'e0000000-0000-0000-0000-000000000005'))));
  PERFORM pg_temp.ghi('B4', 'không gán đơn cho thủ kho', e LIKE 'NHAN_VIEN_KHONG_BAN_HANG%', left(e, 80));

  -- Chủ NPP gán cho uuid lạ → chặn
  e := pg_temp.thu(format('SELECT create_order_with_lines(%L::jsonb)', pg_temp.tai(gen_random_uuid(), pg_temp.c('kh'),
        jsonb_build_array(pg_temp.dong('c0000000-0000-0000-0000-000000000001', 'lon', 1, 10000)),
        jsonb_build_object('sales_user_id', '99999999-9999-9999-9999-999999999999'))));
  PERFORM pg_temp.ghi('B5', 'không gán đơn cho người không thuộc NPP', e LIKE 'NHAN_VIEN_KHONG_HOP_LE%', left(e, 80));
END $t$;

-- =============================================================== C. AI THẤY ĐƠN NÀO
DO $t$
DECLARE n bigint;
BEGIN
  -- Nháp của NVBH: chỉ chính NVBH thấy (mig 161 — chủ nhà: "NPP ko thấy được đơn nháp của nhân viên")
  PERFORM pg_temp.vai('sales');
  PERFORM pg_temp.ghi('C1', 'NVBH thấy nháp của mình', EXISTS (SELECT 1 FROM sales_orders WHERE id = pg_temp.c('nhap')), '');
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('C2', 'chủ NPP KHÔNG thấy nháp của NVBH (mig 161)', NOT EXISTS (SELECT 1 FROM sales_orders WHERE id = pg_temp.c('nhap')), '');
  PERFORM pg_temp.vai('sales2');
  PERFORM pg_temp.ghi('C3', 'NVBH khác không thấy nháp', NOT EXISTS (SELECT 1 FROM sales_orders WHERE id = pg_temp.c('nhap')), '');
  -- Đơn đã gửi của NVBH 1: NVBH 2 không thấy đầu đơn lẫn dòng
  PERFORM pg_temp.ghi('C4', 'NVBH khác không thấy đơn đã gửi + dòng của người khác',
    NOT EXISTS (SELECT 1 FROM sales_orders WHERE id = pg_temp.c('d1'))
      AND NOT EXISTS (SELECT 1 FROM sales_order_lines WHERE order_id = pg_temp.c('d1')), '');
  SELECT count(*) INTO n FROM sales_orders WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004';
  PERFORM pg_temp.ghi('C5', 'NVBH khác đếm đơn của NVBH 1 = 0', n = 0, n::text);
  -- Chủ NPP / kế toán / kho thấy đơn đã gửi
  PERFORM pg_temp.vai('accountant');
  PERFORM pg_temp.ghi('C6', 'kế toán thấy đơn đã gửi', EXISTS (SELECT 1 FROM sales_orders WHERE id = pg_temp.c('d1')), '');
  PERFORM pg_temp.vai('warehouse');
  PERFORM pg_temp.ghi('C7', 'thủ kho thấy đơn đã gửi + 2 dòng',
    (SELECT count(*) FROM sales_order_lines WHERE order_id = pg_temp.c('d1')) = 2, '');
END $t$;

-- =============================================================== D. SỬA ĐƠN
DO $t$
DECLARE n int; e text;
BEGIN
  -- NVBH 2 sửa đơn của NVBH 1 → 0 dòng bị đổi
  PERFORM pg_temp.vai('sales2');
  UPDATE sales_orders SET notes = 'phá' WHERE id = pg_temp.c('d1');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE sales_order_lines SET quantity = 1 WHERE order_id = pg_temp.c('d1');
  PERFORM pg_temp.ghi('D1', 'NVBH khác không sửa được đơn / dòng của người khác',
    n = 0 AND (SELECT sum(quantity) FROM sales_order_lines WHERE order_id = pg_temp.c('d1')) IS NULL, n::text);

  -- NVBH 1 sửa SL dòng đơn đã gửi của mình → được; mã đơn tăng hậu tố khi đổi tổng
  PERFORM pg_temp.vai('sales');
  UPDATE sales_order_lines SET quantity = 12, line_total = 120000 WHERE order_id = pg_temp.c('d1') AND unit_name = 'lon';
  UPDATE sales_orders SET subtotal = 360000, total = 360000 WHERE id = pg_temp.c('d1');
  PERFORM pg_temp.ghi('D2', 'NVBH sửa đơn đã gửi: SL 12, tổng 360.000, mã DH-xxxx-1',
    (SELECT quantity FROM sales_order_lines WHERE order_id = pg_temp.c('d1') AND unit_name = 'lon') = 12
      AND (SELECT total FROM sales_orders WHERE id = pg_temp.c('d1')) = 360000
      AND (SELECT order_code FROM sales_orders WHERE id = pg_temp.c('d1')) ~ '^DH-[0-9]+-1$',
    (SELECT order_code FROM sales_orders WHERE id = pg_temp.c('d1')));

  -- NVBH đổi người đứng tên sang người khác → chặn
  e := pg_temp.thu(format('UPDATE sales_orders SET sales_user_id = %L WHERE id = %L', 'e0000000-0000-0000-0000-0000000000a6', pg_temp.c('d1')));
  PERFORM pg_temp.ghi('D3', 'NVBH không chuyển đơn sang tên người khác',
    e <> 'OK' AND (SELECT sales_user_id FROM sales_orders WHERE id = pg_temp.c('d1')) = 'e0000000-0000-0000-0000-000000000004', left(e, 80));

  -- NVBH tự đặt Hoàn thành → chặn (chỉ qua RPC xuất hàng)
  e := pg_temp.thu(format('UPDATE sales_orders SET status = %L WHERE id = %L', 'completed', pg_temp.c('d1')));
  PERFORM pg_temp.ghi('D4', 'ghi thẳng completed bị chặn', e <> 'OK' AND pg_temp.st(pg_temp.c('d1')) = 'submitted', left(e, 80));

  -- Kế toán ghi thẳng trạng thái → không có quyền UPDATE (0 dòng)
  PERFORM pg_temp.vai('accountant');
  UPDATE sales_orders SET notes = 'kt' WHERE id = pg_temp.c('d1');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.ghi('D5', 'kế toán không sửa được đầu đơn', n = 0, n::text);

  -- Đơn Nháp → Gửi: được; Gửi → Nháp (rút về): được; Nháp → Hoàn thành: chặn
  PERFORM pg_temp.vai('sales');
  UPDATE sales_orders SET status = 'submitted' WHERE id = pg_temp.c('nhap');
  PERFORM pg_temp.ghi('D6', 'nháp → gửi: có submitted_at', pg_temp.st(pg_temp.c('nhap')) = 'submitted'
    AND (SELECT submitted_at IS NOT NULL FROM sales_orders WHERE id = pg_temp.c('nhap')), pg_temp.st(pg_temp.c('nhap')));
  UPDATE sales_orders SET status = 'draft' WHERE id = pg_temp.c('nhap');
  e := pg_temp.thu(format('UPDATE sales_orders SET status = %L WHERE id = %L', 'completed', pg_temp.c('nhap')));
  PERFORM pg_temp.ghi('D7', 'gửi → nháp được; nháp → hoàn thành bị chặn',
    pg_temp.st(pg_temp.c('nhap')) = 'draft' AND e LIKE 'Không thể chuyển đơn từ draft sang completed%', left(e, 80));
END $t$;

-- =============================================================== E. HUỶ ĐƠN
DO $t$
DECLARE e text;
BEGIN
  PERFORM pg_temp.vai('sales2');
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', pg_temp.c('d_tra'), 'phá'));
  PERFORM pg_temp.ghi('E1', 'NVBH khác không huỷ được đơn người khác', e LIKE 'FORBIDDEN_NOT_OWNER%' AND pg_temp.st(pg_temp.c('d_tra')) = 'submitted', left(e, 70));
  PERFORM pg_temp.vai('accountant');
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', pg_temp.c('d_tra'), 'kt'));
  PERFORM pg_temp.ghi('E2', 'kế toán không huỷ được đơn (không có orders.update)', e LIKE 'FORBIDDEN%' AND pg_temp.st(pg_temp.c('d_tra')) = 'submitted', left(e, 70));
  PERFORM pg_temp.vai('warehouse');
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', pg_temp.c('d_tra'), 'kho'));
  PERFORM pg_temp.ghi('E3', 'thủ kho không huỷ được đơn', e LIKE 'FORBIDDEN%' AND pg_temp.st(pg_temp.c('d_tra')) = 'submitted', left(e, 70));

  -- NVBH huỷ đơn của mình: đơn Đã huỷ + phiếu trả Nháp kèm đơn Đã huỷ
  PERFORM pg_temp.vai('sales');
  PERFORM cancel_order(pg_temp.c('d_tra'), 'khách đổi ý');
  PERFORM pg_temp.ghi('E4', 'NVBH huỷ đơn mình: Đã huỷ, lý do, người huỷ, phiếu trả kèm Đã huỷ',
    (SELECT status = 'cancelled' AND cancel_reason = 'khách đổi ý' AND cancelled_by = 'e0000000-0000-0000-0000-000000000004'
            AND cancelled_at IS NOT NULL FROM sales_orders WHERE id = pg_temp.c('d_tra'))
      AND (SELECT status FROM returns WHERE order_id = pg_temp.c('d_tra')) = 'cancelled',
    (SELECT status FROM returns WHERE order_id = pg_temp.c('d_tra')));
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', pg_temp.c('d_tra'), 'lần 2'));
  PERFORM pg_temp.ghi('E5', 'huỷ lần hai: êm, giữ lý do cũ', e = 'OK'
    AND (SELECT cancel_reason FROM sales_orders WHERE id = pg_temp.c('d_tra')) = 'khách đổi ý', e);
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 1 WHERE order_id = %L', pg_temp.c('d_tra')));
  PERFORM pg_temp.ghi('E6', 'đơn đã huỷ: không sửa dòng', e <> 'OK' OR
    (SELECT quantity FROM sales_order_lines WHERE order_id = pg_temp.c('d_tra')) = 20, left(e, 80));
  e := pg_temp.thu(format('UPDATE sales_orders SET status = %L WHERE id = %L', 'submitted', pg_temp.c('d_tra')));
  PERFORM pg_temp.ghi('E7', 'đơn đã huỷ không mở lại được', pg_temp.st(pg_temp.c('d_tra')) = 'cancelled', left(e, 80));
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', gen_random_uuid(), 'x'));
  PERFORM pg_temp.ghi('E8', 'huỷ đơn không tồn tại → ORDER_NOT_FOUND', e LIKE 'ORDER_NOT_FOUND%', e);
END $t$;

-- =============================================================== F. XUẤT HÀNG & QUY ĐỔI
CREATE TEMP TABLE moc AS SELECT pg_temp.ton() AS ton0;
GRANT ALL ON moc TO authenticated;

DO $t$
DECLARE e text; inv record; lon uuid; thung uuid; t0 numeric := (SELECT ton0 FROM moc);
BEGIN
  SELECT id INTO lon FROM sales_order_lines WHERE order_id = pg_temp.c('d1') AND unit_name = 'lon';
  SELECT id INTO thung FROM sales_order_lines WHERE order_id = pg_temp.c('d1') AND unit_name = 'Thung 24';
  -- NVBH / kế toán không có quyền xuất hàng
  FOREACH e IN ARRAY ARRAY['sales', 'accountant'] LOOP
    PERFORM pg_temp.vai(e);
    PERFORM pg_temp.ghi('F1-' || e, e || ' không xuất hàng được',
      pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('d1'), 'lines', jsonb_build_array(
        jsonb_build_object('order_line_id', lon, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000)))))
      LIKE 'FORBIDDEN%', '');
  END LOOP;

  -- Chủ NPP xuất: 12 lon + 1 thùng — tải trọng CỐ Ý ghi sai hệ số thùng = 1; máy chủ tự tra 24 (mig 174)
  PERFORM pg_temp.vai('owner');
  SELECT * INTO inv FROM post_invoice(jsonb_build_object('order_id', pg_temp.c('d1'), 'lines', jsonb_build_array(
    jsonb_build_object('order_line_id', lon, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 12, 'unit_price', 10000, 'vat_rate', 0),
    jsonb_build_object('order_line_id', thung, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'Thung 24', 'conversion_factor', 1, 'quantity', 1, 'unit_price', 240000, 'vat_rate', 0))));
  INSERT INTO ctx VALUES ('hd1', inv.invoice_id);
  -- ⚠ set_config(…, true) của RPC sống tới hết GIAO DỊCH; ở PostgREST mỗi yêu cầu là một
  --   giao dịch riêng, nên tắt cờ đi để các bước sau giống một yêu cầu mới từ trình duyệt.
  PERFORM set_config('npp.via_rpc', '', true);
  PERFORM pg_temp.ghi('F2', 'xuất 12 lon + 1 thùng: kho trừ 36 đơn vị cơ sở (hệ số máy chủ)',
    t0 - pg_temp.ton() = 36, format('trừ %s (36)', t0 - pg_temp.ton()));
  PERFORM pg_temp.ghi('F3', 'đơn → Hoàn thành; HĐ 360.000; công nợ khách 360.000 theo HĐ',
    pg_temp.st(pg_temp.c('d1')) = 'completed' AND inv.order_status = 'completed'
      AND (SELECT total FROM sales_invoices WHERE id = inv.invoice_id) = 360000
      AND (SELECT amount FROM receivables WHERE invoice_id = inv.invoice_id) = 360000
      AND (SELECT order_id FROM receivables WHERE invoice_id = inv.invoice_id) = pg_temp.c('d1')
      AND pg_temp.no_khach(pg_temp.c('kh')) = 360000,
    format('đơn=%s HĐ=%s nợ=%s', pg_temp.st(pg_temp.c('d1')), (SELECT total FROM sales_invoices WHERE id = inv.invoice_id), pg_temp.no_khach(pg_temp.c('kh'))));
  PERFORM pg_temp.ghi('F4', 'dòng HĐ chụp hệ số 24 cho thùng; dòng đơn ghi số đã xuất',
    (SELECT conversion_factor FROM sales_invoice_lines WHERE invoice_id = inv.invoice_id AND unit_name = 'Thung 24') = 24
      AND (SELECT invoiced_qty FROM sales_order_lines WHERE id = thung) = 1
      AND (SELECT invoiced_qty FROM sales_order_lines WHERE id = lon) = 12,
    (SELECT string_agg(unit_name || ':' || conversion_factor, ',') FROM sales_invoice_lines WHERE invoice_id = inv.invoice_id));

  -- Đơn đã xuất: NVBH không sửa dòng / không huỷ đơn; chủ NPP không huỷ đơn khi còn HĐ
  PERFORM pg_temp.vai('sales');
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 1 WHERE id = %L', lon));
  PERFORM pg_temp.ghi('F5', 'đơn đã xuất: NVBH không sửa dòng', (SELECT quantity FROM sales_order_lines WHERE id = lon) = 12, left(e, 70));
  PERFORM pg_temp.vai('owner');
  e := pg_temp.thu(format('UPDATE sales_order_lines SET quantity = 1 WHERE id = %L', lon));
  PERFORM pg_temp.ghi('F6', 'đơn đã xuất: chủ NPP ghi thẳng dòng cũng bị chặn',
    (SELECT quantity FROM sales_order_lines WHERE id = lon) = 12, left(e, 70));
  e := pg_temp.thu(format('SELECT cancel_order(%L, %L)', pg_temp.c('d1'), 'x'));
  PERFORM pg_temp.ghi('F7', 'huỷ đơn còn HĐ → HAS_INVOICE', e LIKE 'HAS_INVOICE%' AND pg_temp.st(pg_temp.c('d1')) = 'completed', left(e, 70));
  -- Xuất HĐ thứ hai → chặn (một đơn một HĐ)
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('d1'), 'lines', jsonb_build_array(
        jsonb_build_object('order_line_id', lon, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000)))));
  PERFORM pg_temp.ghi('F8', 'một đơn một HĐ', e LIKE 'ORDER_NOT_INVOICEABLE%', left(e, 70));
  -- Dòng HĐ trỏ sang dòng của đơn KHÁC → BAD_LINE
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.don_cua('11111111-0000-0000-0000-000000000009'), 'lines', jsonb_build_array(
        jsonb_build_object('order_line_id', lon, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000)))));
  PERFORM pg_temp.ghi('F9', 'dòng HĐ của đơn khác → BAD_LINE', e LIKE 'BAD_LINE%', left(e, 70));
  -- HĐ 0 dòng số lượng dương → NO_LINES
  e := pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.don_cua('11111111-0000-0000-0000-000000000009'), 'lines', jsonb_build_array(
        jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 0, 'unit_price', 10000)))));
  PERFORM pg_temp.ghi('F10', 'HĐ toàn số lượng 0 → NO_LINES', e LIKE 'NO_LINES%', left(e, 70));
  -- Đơn Nháp không xuất được
  PERFORM pg_temp.ghi('F11', 'đơn nháp không xuất được',
    pg_temp.thu(format('SELECT post_invoice(%L::jsonb)', jsonb_build_object('order_id', pg_temp.c('nhap'), 'lines', jsonb_build_array(
        jsonb_build_object('product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 1, 'unit_price', 10000)))))
    LIKE 'ORDER_NOT_INVOICEABLE%', '');
END $t$;

-- F12 Giảm giá đơn đi sang HĐ: 'discount' 50.000 → subtotal/total/nợ trừ đúng; giảm quá tiền hàng kẹp 0
DO $t$
DECLARE inv record; d uuid := pg_temp.don_cua('11111111-0000-0000-0000-000000000009'); l uuid;
BEGIN
  PERFORM pg_temp.vai('owner');
  SELECT id INTO l FROM sales_order_lines WHERE order_id = d;
  SELECT * INTO inv FROM post_invoice(jsonb_build_object('order_id', d, 'discount', 5000, 'lines', jsonb_build_array(
    jsonb_build_object('order_line_id', l, 'product_id', 'c0000000-0000-0000-0000-000000000001', 'unit_name', 'lon', 'quantity', 2, 'unit_price', 10000, 'vat_rate', 0.1))));
  -- 2 × 10.000 = 20.000; giảm đơn 5.000 → 15.000; thuế trên giá dòng 2.000 → 17.000
  PERFORM pg_temp.ghi('F12', 'giảm giá đơn 5.000 + VAT 10% dòng: subtotal 15.000, VAT 2.000, total 17.000, nợ 17.000',
    (SELECT subtotal = 15000 AND vat = 2000 AND total = 17000 FROM sales_invoices WHERE id = inv.invoice_id)
      AND (SELECT amount FROM receivables WHERE invoice_id = inv.invoice_id) = 17000,
    (SELECT subtotal || '/' || vat || '/' || total FROM sales_invoices WHERE id = inv.invoice_id));
  INSERT INTO ctx VALUES ('hd9', inv.invoice_id), ('d9', d);
  PERFORM set_config('npp.via_rpc', '', true);
END $t$;

-- F13 Huỷ HĐ = huỷ đơn (mig 217): kho về đủ, hết nợ HĐ, đơn Đã huỷ
DO $t$
DECLARE t0 numeric := pg_temp.ton(); n0 numeric := pg_temp.no_khach(pg_temp.c('kh'));
BEGIN
  PERFORM pg_temp.vai('owner');
  PERFORM cancel_invoice(pg_temp.c('hd9'), 'thử huỷ');
  PERFORM pg_temp.ghi('F13', 'huỷ HĐ → đơn Đã huỷ, kho +2 lon, nợ khách −17.000',
    pg_temp.st(pg_temp.c('d9')) = 'cancelled' AND pg_temp.ton() - t0 = 2 AND n0 - pg_temp.no_khach(pg_temp.c('kh')) = 17000,
    format('đơn=%s kho+%s nợ−%s', pg_temp.st(pg_temp.c('d9')), pg_temp.ton() - t0, n0 - pg_temp.no_khach(pg_temp.c('kh'))));
  PERFORM set_config('npp.via_rpc', '', true);
END $t$;

-- =============================================================== G. XOÁ ĐƠN
DO $t$
DECLARE n int;
BEGIN
  -- NVBH 2 không xoá được nháp của NVBH 1; NVBH 1 xoá được nháp của mình
  PERFORM pg_temp.vai('sales2');
  DELETE FROM sales_orders WHERE id = pg_temp.c('nhap');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.ghi('G1', 'NVBH khác không xoá nháp người khác', n = 0 AND pg_temp.st(pg_temp.c('nhap')) = 'draft', n::text);
  PERFORM pg_temp.vai('sales');
  DELETE FROM sales_orders WHERE id = pg_temp.c('d1');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.ghi('G2', 'NVBH không xoá được đơn đã Hoàn thành', n = 0 AND pg_temp.st(pg_temp.c('d1')) = 'completed', n::text);
  DELETE FROM sales_orders WHERE id = pg_temp.c('nhap');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.ghi('G3', 'NVBH xoá nháp của mình (kèm dòng)', n = 1 AND pg_temp.so_dong(pg_temp.c('nhap')) = 0, n::text);
  -- Chủ NPP xoá đơn huỷ-theo-HĐ (đã từng hoàn thành) → không được (completed_at)
  PERFORM pg_temp.vai('owner');
  PERFORM pg_temp.ghi('G4', 'không xoá được đơn đã huỷ theo HĐ (HĐ huỷ còn trỏ vào)',
    pg_temp.thu(format('DELETE FROM sales_orders WHERE id = %L', pg_temp.c('d9'))) IS NOT NULL AND pg_temp.st(pg_temp.c('d9')) = 'cancelled',
    left(pg_temp.thu(format('DELETE FROM sales_orders WHERE id = %L', pg_temp.c('d9'))), 80));
END $t$;

RESET ROLE;
SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY
  regexp_replace(buoc, '[0-9-].*$', ''), (regexp_replace(buoc, '^[A-Z]+([0-9]+).*$', '\1'))::int, buoc;
SELECT count(*) FILTER (WHERE ok) AS dat, count(*) AS tong FROM kq;
ROLLBACK;
