-- ĐỘI TEST "Danh mục, Quyền & Tạo nhanh" — PHÂN QUYỀN RLS từng vai + CHÉO NPP (org_id khác).
--
-- Luật (CLAUDE.md §Quyền + lời chủ nhà trong mã):
--   · NVBH chỉ thấy khách / đơn / HĐ / nợ / phiếu thu CỦA MÌNH (chủ nhà 26/09/2026, mig 202: "Xem được công nợ
--     của mình"); chủ / quản lý / kế toán thấy cả NPP.
--   · Ghi danh mục: khách (owner/manager/sales), tuyến (owner/manager), NCC (owner/manager/warehouse),
--     sản phẩm + đơn vị + bảng giá (owner/manager), người dùng (owner), ma trận quyền (owner).
--   · Mọi bảng cô lập theo NPP: người NPP A không đọc / ghi được dòng của NPP B.
--
-- Chạy: psql -h /tmp/pgtest -p 55432 -U postgres -d npp_danh_muc -v ON_ERROR_STOP=1 -f scripts/sql/doi-test/danh-muc-quyen-rls.sql
-- Bọc BEGIN … ROLLBACK — không để lại gì. In bảng kq: 'ĐẠT' / 'LỖI'.
\set ON_ERROR_STOP on
BEGIN;
-- Supabase cấp sẵn quyền bảng cho authenticated (RLS là chốt chặn) — DB thử thì không, cấp trong giao dịch.
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

CREATE TEMP TABLE kq (buoc text, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

-- Chạy một câu với vai `authenticated` + uid, trả về số (count). Lỗi → ném lên.
CREATE FUNCTION pg_temp.dem(p_uid uuid, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql INTO n;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $f$;

-- Chạy một câu, trả 'OK' hoặc thông điệp lỗi (để kiểm bị CHẶN).
CREATE FUNCTION pg_temp.thu(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN 'OK';
END $f$;

CREATE FUNCTION pg_temp.k(p_buoc text, p_ten text, p_ok boolean, p_ghi text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO kq VALUES (p_buoc, p_ten, COALESCE(p_ok, false), p_ghi);
$f$;

-- ───────────── DỰNG DỮ LIỆU (quyền chủ DB) ─────────────
-- NPP A = a0…01 (seed): owner …01, manager …02, accountant …03, sales Dung …04, warehouse …05.
-- Thêm NVBH Hải …06 cùng NPP A. NPP B = b0…01: owner f…01, sales f…02.
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'hai@test.local'),
  ('f0000000-0000-0000-0000-000000000001', 'ownerb@test.local'),
  ('f0000000-0000-0000-0000-000000000002', 'salesb@test.local');
INSERT INTO organizations (id, name, slug) VALUES ('b0000000-0000-0000-0000-000000000001', 'NPP Khac', 'npp-khac-test');
INSERT INTO users (id, org_id, full_name, role, phone, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Vu Van Hai', 'sales', '0977000006', true),
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Chu NPP B', 'owner', '0977000101', true),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'NVBH NPP B', 'sales', '0977000102', true);

-- Khách: d…01..05 của Dung (seed), cc…01 của Hải, d…20 chưa ai phụ trách; cb…01 thuộc NPP B.
INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, channel) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Tạp hoá Hải Đăng', 'Hải', '0988000001', 'Lê Lợi', 'GT'),
  ('cb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Khach NPP B', 'B', '0988000002', 'Q1', 'GT');
INSERT INTO customer_assignments (customer_id, user_id, role) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'primary'),
  ('cb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'primary');

-- Đơn + HĐ đã ghi sổ + dòng HĐ + công nợ + phiếu thu cho Dung, Hải, NPP B.
INSERT INTO sales_orders (id, org_id, order_code, customer_id, sales_user_id, status, total) VALUES
  ('5d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'DM-T-01', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'completed', 100000),
  ('5d000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'DM-T-02', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'completed', 200000);
-- ⚠ Mã đơn UNIQUE toàn bảng nhưng số chạy theo NPP → NPP B tạo đơn đầu tiên đụng DH-0001 của NPP A
--   (lỗi riêng, xem danh-muc-loi.sql). Ở đây tắt trigger cấp mã để dựng được dữ liệu NPP B.
ALTER TABLE sales_orders DISABLE TRIGGER trg_sales_orders_assign_code;
INSERT INTO sales_orders (id, org_id, order_code, order_seq, customer_id, sales_user_id, status, total) VALUES
  ('5d000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'DM-B-0001', 1, 'cb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'completed', 300000);
ALTER TABLE sales_orders ENABLE TRIGGER trg_sales_orders_assign_code;
INSERT INTO sales_invoices (id, org_id, invoice_code, order_id, customer_id, sales_user_id, status, total, invoice_seq) VALUES
  ('51000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'HD-DM-01', '5d000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'posted', 100000, 990001),
  ('51000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'HD-DM-02', '5d000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'posted', 200000, 990002),
  ('51000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'HD-DM-03', '5d000000-0000-0000-0000-000000000003', 'cb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'posted', 300000, 990003);
INSERT INTO sales_invoice_lines (invoice_id, product_id, unit_name, quantity)
SELECT i.id, (SELECT id FROM products ORDER BY sku LIMIT 1), 'Thùng', 1
FROM sales_invoices i WHERE i.id IN ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000003');
INSERT INTO receivables (id, org_id, customer_id, sales_user_id, amount, paid, status, invoice_id, order_id) VALUES
  ('7c000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 100000, 0, 'open', '51000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-000000000001'),
  ('7c000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 200000, 0, 'open', '51000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000002'),
  ('7c000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 300000, 0, 'open', '51000000-0000-0000-0000-000000000003', '5d000000-0000-0000-0000-000000000003');
INSERT INTO receivables (id, org_id, customer_id, sales_user_id, amount, paid, status, opening_balance) VALUES
  ('7c000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000020', NULL, 50000, 0, 'open', true);
INSERT INTO cash_receipts (id, org_id, receipt_code, collected_by, submitted_amount, expected_amount) VALUES
  ('c7000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'PT-DM-01', 'e0000000-0000-0000-0000-000000000004', 10000, 10000),
  ('c7000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'PT-DM-02', 'e0000000-0000-0000-0000-000000000006', 20000, 20000),
  ('c7000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'PT-DM-03', 'f0000000-0000-0000-0000-000000000002', 30000, 30000);

-- ───────────── 1. ĐỌC theo vai (NPP A) ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; mgr uuid := 'e0000000-0000-0000-0000-000000000002';
  acc uuid := 'e0000000-0000-0000-0000-000000000003'; dung uuid := 'e0000000-0000-0000-0000-000000000004';
  kho uuid := 'e0000000-0000-0000-0000-000000000005'; hai uuid := 'e0000000-0000-0000-0000-000000000006';
  n bigint; ds text;
BEGIN
  -- Khách: NPP A có 21 khách (20 seed + cc…01).
  PERFORM pg_temp.k('1.01', 'Chủ NPP thấy đủ 21 khách NPP A, không thấy khách NPP B',
    pg_temp.dem(owner, 'select count(*) from customers') = 21, pg_temp.dem(owner, 'select count(*) from customers')::text);
  PERFORM pg_temp.k('1.02', 'Quản lý thấy 21 khách', pg_temp.dem(mgr, 'select count(*) from customers') = 21, '');
  PERFORM pg_temp.k('1.03', 'Kế toán thấy 21 khách', pg_temp.dem(acc, 'select count(*) from customers') = 21, '');
  n := pg_temp.dem(dung, 'select count(*) from customers');
  PERFORM pg_temp.k('1.04', 'NVBH Dung chỉ thấy 5 khách được phân công', n = 5, n::text);
  n := pg_temp.dem(hai, 'select count(*) from customers');
  PERFORM pg_temp.k('1.05', 'NVBH Hải chỉ thấy 1 khách (cc…01)', n = 1, n::text);
  n := pg_temp.dem(dung, $q$select count(*) from customers where id in ('cc000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000020')$q$);
  PERFORM pg_temp.k('1.06', 'Dung không thấy khách của Hải / khách chưa phân công', n = 0, n::text);

  -- Đơn / HĐ / dòng HĐ / nợ / phiếu thu của NVBH.
  PERFORM pg_temp.k('1.07', 'Dung thấy 1 đơn (của mình)', pg_temp.dem(dung, 'select count(*) from sales_orders') = 1,
    pg_temp.dem(dung, 'select count(*) from sales_orders')::text);
  PERFORM pg_temp.k('1.08', 'Dung thấy 1 HĐ (HD-DM-01)',
    pg_temp.dem(dung, $q$select count(*) from sales_invoices where invoice_code = 'HD-DM-01'$q$) = 1
    AND pg_temp.dem(dung, 'select count(*) from sales_invoices') = 1, '');
  n := pg_temp.dem(dung, 'select count(*) from sales_invoice_lines');
  PERFORM pg_temp.k('1.09', 'Dung chỉ thấy dòng HĐ của HĐ mình (1 dòng) — dòng HĐ của Hải bị giấu', n = 1, n::text);
  n := pg_temp.dem(dung, 'select coalesce(sum(amount - paid),0) from receivables');
  PERFORM pg_temp.k('1.10', 'Dung thấy nợ của mình = 100.000 (không có 200.000 của Hải, 50.000 đầu kỳ chưa ai đứng tên)', n = 100000, n::text);
  n := pg_temp.dem(hai, 'select coalesce(sum(amount - paid),0) from receivables');
  PERFORM pg_temp.k('1.11', 'Hải thấy nợ của mình = 200.000', n = 200000, n::text);
  n := pg_temp.dem(dung, 'select coalesce(sum(submitted_amount),0) from cash_receipts');
  PERFORM pg_temp.k('1.12', 'Dung chỉ thấy phiếu thu mình nộp = 10.000', n = 10000, n::text);

  -- Vai quản trị trong NPP A.
  n := pg_temp.dem(owner, 'select coalesce(sum(amount - paid),0) from receivables');
  PERFORM pg_temp.k('1.13', 'Chủ NPP thấy tổng nợ NPP A = 350.000 (không lẫn 300.000 NPP B)', n = 350000, n::text);
  n := pg_temp.dem(acc, 'select coalesce(sum(amount - paid),0) from receivables');
  PERFORM pg_temp.k('1.14', 'Kế toán thấy tổng nợ 350.000', n = 350000, n::text);
  n := pg_temp.dem(mgr, 'select coalesce(sum(amount - paid),0) from receivables');
  PERFORM pg_temp.k('1.15', 'Quản lý thấy tổng nợ 350.000', n = 350000, n::text);
  n := pg_temp.dem(kho, 'select count(*) from receivables');
  PERFORM pg_temp.k('1.16', 'Thủ kho không thấy công nợ (0 dòng)', n = 0, n::text);
  n := pg_temp.dem(kho, 'select count(*) from sales_invoices');
  PERFORM pg_temp.k('1.17', 'Thủ kho thấy 2 HĐ NPP A (soạn / xuất hàng)', n = 2, n::text);
  n := pg_temp.dem(acc, 'select coalesce(sum(submitted_amount),0) from cash_receipts');
  PERFORM pg_temp.k('1.18', 'Kế toán thấy phiếu thu NPP A = 30.000', n = 30000, n::text);
  n := pg_temp.dem(kho, 'select count(*) from cash_receipts');
  PERFORM pg_temp.k('1.19', 'Thủ kho chỉ thấy phiếu thu chính mình nộp (0)', n = 0, n::text);
  n := pg_temp.dem(owner, 'select count(*) from users');
  PERFORM pg_temp.k('1.20', 'Chủ NPP A thấy 6 người NPP A, không thấy người NPP B', n = 6, n::text);
  n := pg_temp.dem(dung, 'select count(*) from sales_routes');
  PERFORM pg_temp.k('1.21', 'NVBH đọc được 3 tuyến (ô chọn tuyến khi tạo khách)', n = 3, n::text);
  n := pg_temp.dem(dung, 'select count(*) from products');
  PERFORM pg_temp.k('1.22', 'NVBH (không gắn NCC) đọc được 50 sản phẩm (bán hàng ở /sell)', n = 50, n::text);
END $t$;

-- ───────────── 2. CHÉO NPP ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; ownb uuid := 'f0000000-0000-0000-0000-000000000001';
  salesb uuid := 'f0000000-0000-0000-0000-000000000002'; dung uuid := 'e0000000-0000-0000-0000-000000000004';
  n bigint; e text;
BEGIN
  n := pg_temp.dem(owner, $q$select count(*) from customers where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from sales_invoices where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from receivables where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from cash_receipts where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from sales_orders where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from users where org_id = 'b0000000-0000-0000-0000-000000000001'$q$)
     + pg_temp.dem(owner, $q$select count(*) from sales_invoice_lines where invoice_id = '51000000-0000-0000-0000-000000000003'$q$)
     + pg_temp.dem(owner, $q$select count(*) from customer_assignments where customer_id = 'cb000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('2.01', 'Chủ NPP A đọc 0 dòng NPP B ở 8 bảng (khách, HĐ, nợ, phiếu thu, đơn, người, dòng HĐ, phân công)', n = 0, n::text);
  n := pg_temp.dem(ownb, 'select count(*) from customers');
  PERFORM pg_temp.k('2.02', 'Chủ NPP B chỉ thấy 1 khách của mình', n = 1, n::text);
  n := pg_temp.dem(ownb, 'select coalesce(sum(amount),0) from receivables');
  PERFORM pg_temp.k('2.03', 'Chủ NPP B thấy nợ 300.000 của mình', n = 300000, n::text);

  n := pg_temp.dem(owner, $q$with x as (update customers set credit_limit = 999 where id = 'cb000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('2.04', 'Chủ NPP A sửa khách NPP B → 0 dòng', n = 0, n::text);
  n := pg_temp.dem(owner, $q$with x as (delete from customers where id = 'cb000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('2.05', 'Chủ NPP A xoá khách NPP B → 0 dòng', n = 0, n::text);
  e := pg_temp.thu(owner, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('b0000000-0000-0000-0000-000000000001','X','X','0911222333','X')$q$);
  PERFORM pg_temp.k('2.06', 'Chủ NPP A tạo khách gắn org NPP B → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into customer_assignments (customer_id, user_id) values ('cb000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('2.07', 'Chủ NPP A phân công khách NPP B → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into sales_routes (org_id, code, name) values ('b0000000-0000-0000-0000-000000000001','XB','Tuyen B')$q$);
  PERFORM pg_temp.k('2.08', 'Chủ NPP A tạo tuyến cho NPP B → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into products (org_id, sku, name, base_unit) values ('b0000000-0000-0000-0000-000000000001','XB-1','SP B','Cái')$q$);
  PERFORM pg_temp.k('2.09', 'Chủ NPP A tạo sản phẩm cho NPP B → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into suppliers (org_id, name, code) values ('b0000000-0000-0000-0000-000000000001','NCC B','NCCB')$q$);
  PERFORM pg_temp.k('2.10', 'Chủ NPP A tạo NCC cho NPP B → bị chặn', e ~* 'row-level security', e);
  n := pg_temp.dem(owner, $q$with x as (update users set role = 'sales' where id = 'f0000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('2.11', 'Chủ NPP A đổi vai người NPP B → 0 dòng', n = 0, n::text);
  e := pg_temp.thu(owner, $q$insert into role_permissions (org_id, role, module, action, allowed) values ('b0000000-0000-0000-0000-000000000001','sales','settings','update',true)$q$);
  PERFORM pg_temp.k('2.12', 'Chủ NPP A ghi ma trận quyền của NPP B → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into user_permission_overrides (org_id, user_id, permission_key, granted) values ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','customer.view_all',true)$q$);
  PERFORM pg_temp.k('2.13', 'Chủ NPP A ghi quyền riêng cho người NPP B (đội lốt org A) → bị chặn', e ~* 'row-level security', e);
  n := pg_temp.dem(salesb, 'select count(*) from customers');
  PERFORM pg_temp.k('2.14', 'NVBH NPP B chỉ thấy 1 khách được phân công (không thấy 21 khách NPP A)', n = 1, n::text);
  -- Đổi org của khách mình sang NPP khác (đẩy dữ liệu sang NPP B) → chặn.
  e := pg_temp.thu(owner, $q$update customers set org_id = 'b0000000-0000-0000-0000-000000000001' where id = 'd0000000-0000-0000-0000-000000000006'$q$);
  PERFORM pg_temp.k('2.15', 'Chủ NPP A chuyển khách của mình sang org NPP B → bị chặn', e ~* 'row-level security', e);
  -- Nợ: HĐ NPP B không đổi được từ NPP A.
  n := pg_temp.dem(owner, $q$with x as (update receivables set note = 'x' where id = '7c000000-0000-0000-0000-000000000003' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('2.16', 'Chủ NPP A sửa ghi chú nợ NPP B → 0 dòng', n = 0, n::text);
END $t$;

-- ───────────── 3. GHI DANH MỤC theo vai ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; mgr uuid := 'e0000000-0000-0000-0000-000000000002';
  acc uuid := 'e0000000-0000-0000-0000-000000000003'; dung uuid := 'e0000000-0000-0000-0000-000000000004';
  kho uuid := 'e0000000-0000-0000-0000-000000000005';
  n bigint; e text; sp uuid;
BEGIN
  SELECT id INTO sp FROM products ORDER BY sku LIMIT 1;
  -- Khách: owner/manager/sales tạo được; kế toán / thủ kho không.
  e := pg_temp.thu(dung, $q$insert into customers (org_id, store_name, owner_name, phone, address, channel, created_by) values ('a0000000-0000-0000-0000-000000000001','KH Dung tao','A','0912000001','X','GT','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('3.01', 'NVBH tạo khách (có created_by = mình) → được', e = 'OK', e);
  n := pg_temp.dem(dung, $q$select count(*) from customers where phone = '0912000001'$q$);
  PERFORM pg_temp.k('3.02', 'NVBH đọc lại ngay khách vừa tạo (nhờ created_by) dù chưa phân công', n = 1, n::text);
  e := pg_temp.thu(acc, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('a0000000-0000-0000-0000-000000000001','KH KT','A','0912000002','X')$q$);
  PERFORM pg_temp.k('3.03', 'Kế toán tạo khách → bị chặn (customers.create không có)', e ~* 'row-level security', e);
  e := pg_temp.thu(kho, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('a0000000-0000-0000-0000-000000000001','KH Kho','A','0912000003','X')$q$);
  PERFORM pg_temp.k('3.04', 'Thủ kho tạo khách → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('a0000000-0000-0000-0000-000000000001','KH QL','A','0912000004','X')$q$);
  PERFORM pg_temp.k('3.05', 'Quản lý tạo khách → được', e = 'OK', e);
  e := pg_temp.thu(mgr, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('a0000000-0000-0000-0000-000000000001','KH QL 2','A','0912000004','X')$q$);
  PERFORM pg_temp.k('3.06', 'Tạo khách TRÙNG số trong cùng NPP → lỗi 23505 (taoKhach bắt thành KhachDaCo)', e ~* 'duplicate key|customers_org_id_phone', e);
  e := pg_temp.thu(owner, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('b0000000-0000-0000-0000-000000000001','X','X','0988000002','X')$q$);
  PERFORM pg_temp.k('3.07', 'Cùng số với khách NPP B nhưng chèn vào org B → vẫn bị RLS chặn (không lộ qua lỗi trùng)', e ~* 'row-level security', e);
  -- Số trùng giữa hai NPP khác nhau là hợp lệ (UNIQUE theo org).
  e := pg_temp.thu(owner, $q$insert into customers (org_id, store_name, owner_name, phone, address) values ('a0000000-0000-0000-0000-000000000001','KH trung so NPP B','X','0988000002','X')$q$);
  PERFORM pg_temp.k('3.08', 'NPP A dùng số đã có ở NPP B → được (trùng chỉ tính trong một NPP)', e = 'OK', e);

  -- Sửa khách: NVBH không sửa được khách không phụ trách.
  n := pg_temp.dem(dung, $q$with x as (update customers set credit_limit = 1 where id = 'cc000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.09', 'NVBH Dung sửa khách của Hải → 0 dòng', n = 0, n::text);
  n := pg_temp.dem(dung, $q$with x as (update customers set address = 'Mới' where id = 'd0000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.10', 'NVBH Dung sửa khách mình phụ trách → 1 dòng', n = 1, n::text);
  n := pg_temp.dem(dung, $q$with x as (delete from customers where id = 'd0000000-0000-0000-0000-000000000001' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.11', 'NVBH xoá khách → 0 dòng (chỉ chủ NPP xoá)', n = 0, n::text);
  n := pg_temp.dem(mgr, $q$with x as (delete from customers where id = 'd0000000-0000-0000-0000-000000000019' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.12', 'Quản lý xoá khách → 0 dòng (chỉ chủ NPP)', n = 0, n::text);

  -- Phân công: chỉ owner/manager ghi thẳng; NVBH đi qua claim_customer_for_me.
  e := pg_temp.thu(dung, $q$insert into customer_assignments (customer_id, user_id) values ('d0000000-0000-0000-0000-000000000020','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('3.13', 'NVBH tự chèn phân công → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into customer_assignments (customer_id, user_id) values ('d0000000-0000-0000-0000-000000000020','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('3.14', 'Quản lý phân công khách cho Dung → được', e = 'OK', e);
  n := pg_temp.dem(dung, 'select count(*) from customers');
  PERFORM pg_temp.k('3.15', 'Sau phân công Dung thấy 5 + 1 (d…20) + 1 (tự tạo) = 7 khách', n = 7, n::text);
  e := pg_temp.thu(mgr, $q$insert into customer_assignments (customer_id, user_id) values ('d0000000-0000-0000-0000-000000000020','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('3.16', 'Phân công trùng (cùng khách + NV) → lỗi trùng', e ~* 'duplicate key', e);
  e := pg_temp.thu(acc, $q$insert into customer_assignments (customer_id, user_id) values ('d0000000-0000-0000-0000-000000000019','e0000000-0000-0000-0000-000000000004')$q$);
  PERFORM pg_temp.k('3.17', 'Kế toán phân công → bị chặn', e ~* 'row-level security', e);

  -- Tuyến: owner/manager.
  e := pg_temp.thu(dung, $q$insert into sales_routes (org_id, code, name) values ('a0000000-0000-0000-0000-000000000001','T5','Thu Nam')$q$);
  PERFORM pg_temp.k('3.18', 'NVBH tạo tuyến → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(acc, $q$insert into sales_routes (org_id, code, name) values ('a0000000-0000-0000-0000-000000000001','T5','Thu Nam')$q$);
  PERFORM pg_temp.k('3.19', 'Kế toán tạo tuyến → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into sales_routes (org_id, code, name) values ('a0000000-0000-0000-0000-000000000001','T5','Thu Nam')$q$);
  PERFORM pg_temp.k('3.20', 'Quản lý tạo tuyến T5 → được', e = 'OK', e);
  e := pg_temp.thu(owner, $q$insert into sales_routes (org_id, code, name) values ('a0000000-0000-0000-0000-000000000001','T5','Trung ma')$q$);
  PERFORM pg_temp.k('3.21', 'Tạo tuyến trùng mã T5 → lỗi trùng', e ~* 'duplicate key', e);
  n := pg_temp.dem(dung, $q$with x as (update sales_routes set name = 'x' where code = 'T5' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.22', 'NVBH sửa tuyến → 0 dòng', n = 0, n::text);
  n := pg_temp.dem(dung, $q$with x as (delete from sales_routes where code = 'T5' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.23', 'NVBH xoá tuyến → 0 dòng', n = 0, n::text);

  -- NCC: owner/manager/warehouse.
  e := pg_temp.thu(kho, $q$insert into suppliers (org_id, name, code) values ('a0000000-0000-0000-0000-000000000001','NCC Kho','NCC-K')$q$);
  PERFORM pg_temp.k('3.24', 'Thủ kho tạo NCC → được (gác theo Kho)', e = 'OK', e);
  e := pg_temp.thu(acc, $q$insert into suppliers (org_id, name, code) values ('a0000000-0000-0000-0000-000000000001','NCC KT','NCC-KT')$q$);
  PERFORM pg_temp.k('3.25', 'Kế toán tạo NCC → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(dung, $q$insert into suppliers (org_id, name, code) values ('a0000000-0000-0000-0000-000000000001','NCC NV','NCC-NV')$q$);
  PERFORM pg_temp.k('3.26', 'NVBH tạo NCC → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into suppliers (org_id, name, code) values ('a0000000-0000-0000-0000-000000000001','NCC trùng','NCC-K')$q$);
  PERFORM pg_temp.k('3.27', 'NCC trùng mã trong NPP → lỗi trùng', e ~* 'duplicate key', e);

  -- Sản phẩm / đơn vị / bảng giá: owner/manager.
  e := pg_temp.thu(mgr, $q$insert into products (org_id, sku, name, base_unit) values ('a0000000-0000-0000-0000-000000000001','DM-SP-1','Nuoc test','Lon')$q$);
  PERFORM pg_temp.k('3.28', 'Quản lý tạo sản phẩm → được', e = 'OK', e);
  e := pg_temp.thu(kho, $q$insert into products (org_id, sku, name, base_unit) values ('a0000000-0000-0000-0000-000000000001','DM-SP-2','X','Lon')$q$);
  PERFORM pg_temp.k('3.29', 'Thủ kho tạo sản phẩm → bị chặn (products chỉ Xem)', e ~* 'row-level security', e);
  e := pg_temp.thu(dung, $q$insert into products (org_id, sku, name, base_unit) values ('a0000000-0000-0000-0000-000000000001','DM-SP-3','X','Lon')$q$);
  PERFORM pg_temp.k('3.30', 'NVBH tạo sản phẩm → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(owner, $q$insert into products (org_id, sku, name, base_unit) values ('a0000000-0000-0000-0000-000000000001','DM-SP-4','X','  ')$q$);
  PERFORM pg_temp.k('3.31', 'Sản phẩm đơn vị cơ sở rỗng → bị chặn (products_base_unit_khong_rong)', e ~* 'base_unit_khong_rong', e);
  e := pg_temp.thu(mgr, $q$insert into product_units (product_id, unit_name, conversion) select id, 'Thùng', 24 from products where sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('3.32', 'Quản lý thêm đơn vị Thùng = 24 Lon → được', e = 'OK', e);
  e := pg_temp.thu(mgr, $q$insert into product_units (product_id, unit_name, conversion) select id, 'Thùng', 12 from products where sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('3.33', 'Đơn vị trùng tên trên cùng SP → lỗi trùng', e ~* 'duplicate key', e);
  e := pg_temp.thu(acc, $q$insert into product_units (product_id, unit_name, conversion) select id, 'Lốc', 6 from products where sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('3.34', 'Kế toán thêm đơn vị → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(kho, $q$insert into price_lists (product_id, unit_name, price) select id, 'Thùng', 240000 from products where sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('3.35', 'Thủ kho ghi bảng giá → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into price_lists (product_id, unit_name, price) select id, 'Thùng', 240000 from products where sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('3.36', 'Quản lý ghi giá Thùng 240.000 → được', e = 'OK', e);
  n := pg_temp.dem(dung, $q$select coalesce(sum(pl.price),0) from price_lists pl join products p on p.id = pl.product_id where p.sku = 'DM-SP-1' and pl.unit_name = 'Thùng'$q$);
  PERFORM pg_temp.k('3.37', 'NVBH đọc được giá Thùng = 240.000 (để bán)', n = 240000, n::text);
  e := pg_temp.thu(owner, $q$insert into price_lists (product_id, unit_name, price) values ('$q$ || (SELECT id FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001' LIMIT 1) || $q$', 'Lon', 1000)$q$);
  PERFORM pg_temp.k('3.38', 'Chủ NPP ghi giá SP của mình → được', e = 'OK', e);

  -- Người dùng / ma trận quyền.
  n := pg_temp.dem(dung, $q$with x as (update users set allow_discount = true, discount_max_type = 'pct', discount_max_value = 100 where id = 'e0000000-0000-0000-0000-000000000004' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.39', 'NVBH tự mở quyền giảm giá cho mình → 0 dòng', n = 0, n::text);
  n := pg_temp.dem(dung, $q$with x as (update users set role = 'owner' where id = 'e0000000-0000-0000-0000-000000000004' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.40', 'NVBH tự nâng vai thành owner → 0 dòng', n = 0, n::text);
  n := pg_temp.dem(mgr, $q$with x as (update users set role = 'owner' where id = 'e0000000-0000-0000-0000-000000000002' returning 1) select count(*) from x$q$);
  PERFORM pg_temp.k('3.41', 'Quản lý tự nâng vai → 0 dòng', n = 0, n::text);
  e := pg_temp.thu(mgr, $q$insert into role_permissions (org_id, role, module, action, allowed) values ('a0000000-0000-0000-0000-000000000001','manager','settings','update',true)$q$);
  PERFORM pg_temp.k('3.42', 'Quản lý sửa ma trận quyền vai → bị chặn (chỉ chủ NPP)', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into user_permission_overrides (org_id, user_id, permission_key, granted) values ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','customers.read',false)$q$);
  PERFORM pg_temp.k('3.43', 'Quản lý ghi quyền riêng cho chủ NPP (khoá chủ) → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(dung, $q$insert into user_permission_overrides (org_id, user_id, permission_key, granted) values ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','customer.view_all',true)$q$);
  PERFORM pg_temp.k('3.44', 'NVBH tự cấp customer.view_all → bị chặn', e ~* 'row-level security', e);
  e := pg_temp.thu(mgr, $q$insert into user_permission_overrides (org_id, user_id, permission_key, granted) values ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','customer.view_all',true)$q$);
  PERFORM pg_temp.k('3.45', 'Quản lý cấp customer.view_all cho NVBH → được', e = 'OK', e);
  n := pg_temp.dem(dung, 'select count(*) from customers');
  PERFORM pg_temp.k('3.46', 'Có customer.view_all → NVBH thấy cả 24 khách NPP A (21 + 3 vừa tạo), vẫn không thấy NPP B', n = 24, n::text);
  n := pg_temp.dem(dung, 'select count(*) from receivables');
  PERFORM pg_temp.k('3.47', 'customer.view_all KHÔNG mở công nợ người khác — Dung vẫn 1 khoản', n = 1, n::text);
END $t$;

-- ───────────── 4. Tiền / tồn kho / trạng thái không ghi thẳng được từ trình duyệt ─────────────
DO $t$
DECLARE
  owner uuid := 'e0000000-0000-0000-0000-000000000001'; acc uuid := 'e0000000-0000-0000-0000-000000000003';
  dung uuid := 'e0000000-0000-0000-0000-000000000004'; kho uuid := 'e0000000-0000-0000-0000-000000000005';
  e text; n bigint;
BEGIN
  e := pg_temp.thu(acc, $q$update receivables set paid = 100000 where id = '7c000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('4.01', 'Kế toán sửa thẳng paid của nợ theo HĐ → CONG_NO_KHOA', e ~ 'CONG_NO_KHOA', e);
  e := pg_temp.thu(owner, $q$update receivables set amount = 1 where id = '7c000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('4.02', 'Chủ NPP sửa thẳng amount nợ theo HĐ → CONG_NO_KHOA', e ~ 'CONG_NO_KHOA', e);
  e := pg_temp.thu(dung, $q$update receivables set paid = 100000 where id = '7c000000-0000-0000-0000-000000000001'$q$);
  n := (SELECT paid FROM receivables WHERE id = '7c000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.k('4.03', 'NVBH sửa nợ của mình → không đổi (paid vẫn 0)', n = 0, e || ' paid=' || n);
  e := pg_temp.thu(dung, $q$update sales_invoices set total = 1 where id = '51000000-0000-0000-0000-000000000001'$q$);
  n := (SELECT total FROM sales_invoices WHERE id = '51000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.k('4.04', 'Không ai sửa thẳng tiền HĐ (không có policy UPDATE) → total vẫn 100.000', n = 100000, e);
  e := pg_temp.thu(owner, $q$update sales_invoices set status = 'cancelled' where id = '51000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('4.05', 'Chủ NPP đổi thẳng trạng thái HĐ → không đổi (chỉ qua cancel_invoice)',
    (SELECT status FROM sales_invoices WHERE id = '51000000-0000-0000-0000-000000000001') = 'posted', e);
  INSERT INTO batches (id, org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand)
  SELECT 'ba000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', id, 'LO-DM-1', current_date + 365, 10, 10
  FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY sku LIMIT 1;
  e := pg_temp.thu(kho, $q$update batches set qty_on_hand = qty_on_hand + 100 where id = 'ba000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('4.06', 'Thủ kho sửa thẳng tồn lô → SO_KHO_KHOA, tồn vẫn 10',
    e ~ 'SO_KHO_KHOA' AND (SELECT qty_on_hand FROM batches WHERE id = 'ba000000-0000-0000-0000-000000000001') = 10, e);
  e := pg_temp.thu(kho, $q$insert into batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand) select org_id, product_id, 'LO-DM-2', expires_at, 5, 5 from batches where id = 'ba000000-0000-0000-0000-000000000001'$q$);
  PERFORM pg_temp.k('4.06b', 'Thủ kho tạo thẳng lô có tồn 5 → SO_KHO_KHOA', e ~ 'SO_KHO_KHOA', e);
  e := pg_temp.thu(acc, $q$insert into receivables (org_id, customer_id, amount, opening_balance) values ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002', 75000, true)$q$);
  PERFORM pg_temp.k('4.07', 'Kế toán thêm nợ đầu kỳ chưa thu → được', e = 'OK', e);
  e := pg_temp.thu(acc, $q$insert into receivables (org_id, customer_id, amount, opening_balance, paid) values ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002', 75000, true, 1000)$q$);
  PERFORM pg_temp.k('4.08', 'Nợ đầu kỳ kèm paid ≠ 0 → CONG_NO_KHOA', e ~ 'CONG_NO_KHOA', e);
  e := pg_temp.thu(dung, $q$insert into receivables (org_id, customer_id, amount, opening_balance) values ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002', 75000, true)$q$);
  PERFORM pg_temp.k('4.09', 'NVBH thêm nợ đầu kỳ → bị chặn', e ~* 'row-level security', e);
END $t$;


-- ───────────── 5. NVBH gắn NCC (user_suppliers): chỉ thấy hàng của NCC mình + hàng không NCC ─────────────
DO $t$
DECLARE
  dung uuid := 'e0000000-0000-0000-0000-000000000004'; kho uuid := 'e0000000-0000-0000-0000-000000000005';
  n bigint; tong bigint;
BEGIN
  INSERT INTO suppliers (id, org_id, name, code) VALUES
    ('5c000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NCC Một', 'DM-N1'),
    ('5c000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'NCC Hai', 'DM-N2');
  -- 10 SP đầu → NCC Một, 10 SP kế → NCC Hai, còn lại (30 + SP vừa tạo ở §3) không NCC.
  UPDATE products SET primary_supplier_id = '5c000000-0000-0000-0000-000000000001'
   WHERE id IN (SELECT id FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001' ORDER BY sku LIMIT 10);
  UPDATE products SET primary_supplier_id = '5c000000-0000-0000-0000-000000000002'
   WHERE id IN (SELECT id FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001' AND primary_supplier_id IS NULL ORDER BY sku LIMIT 10);
  INSERT INTO user_suppliers (org_id, user_id, supplier_id) VALUES ('a0000000-0000-0000-0000-000000000001', dung, '5c000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO tong FROM products WHERE org_id = 'a0000000-0000-0000-0000-000000000001';
  n := pg_temp.dem(dung, 'select count(*) from products');
  PERFORM pg_temp.k('5.01', 'NVBH gắn NCC Một thấy SP NCC Một + SP không NCC (tổng − 10 SP NCC Hai)', n = tong - 10, n || ' / ' || tong);
  n := pg_temp.dem(dung, $q$select count(*) from products where primary_supplier_id = '5c000000-0000-0000-0000-000000000002'$q$);
  PERFORM pg_temp.k('5.02', 'NVBH không thấy SP của NCC Hai', n = 0, n::text);
  n := pg_temp.dem(dung, $q$select count(*) from price_lists pl join products p on p.id = pl.product_id where p.primary_supplier_id = '5c000000-0000-0000-0000-000000000002'$q$)
     + pg_temp.dem(dung, $q$select count(*) from price_lists where product_id in (select id from products where primary_supplier_id = '5c000000-0000-0000-0000-000000000002')$q$);
  PERFORM pg_temp.k('5.03', 'Bảng giá của SP NCC Hai cũng bị giấu với NVBH đó', n = 0, n::text);
  n := pg_temp.dem(kho, 'select count(*) from products');
  PERFORM pg_temp.k('5.04', 'Thủ kho (không phải NVBH) thấy đủ SP', n = tong, n || ' / ' || tong);
  -- Đơn vị phụ: NVBH đọc đơn vị quy đổi của SP mình thấy (để bán thùng).
  n := pg_temp.dem(dung, $q$select coalesce(sum(conversion),0) from product_units pu join products p on p.id = pu.product_id where p.sku = 'DM-SP-1'$q$);
  PERFORM pg_temp.k('5.05', 'NVBH đọc hệ số Thùng = 24 của SP không NCC', n = 24, n::text);
END $t$;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
