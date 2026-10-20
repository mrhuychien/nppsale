-- KIỂM MIG 248 — "Bàn giao khách" trả về đúng mặc định (chủ nhà 20/10/2026: "Kiểm tra lại sao tk nhân viên bán hàng lại có
-- bàn giao khách nhỉ"). psql -f, BEGIN … ROLLBACK. Dựng đúng trạng thái sau một lần bấm "Lưu" ở màn Phân quyền theo lỗi cũ
-- (ô Bàn giao khách chép từ quyền Khách hàng), chạy CHÍNH tệp migration hai lần. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-248-ban-giao-khach-tra-quyen.sql
\set ON_ERROR_STOP on
-- ⚠ XẾP HÀNG: vitest chạy các bộ thử song song trên CÙNG một sổ thử — mig 250 giữ khoá mọi bảng ~13 giây, câu GRANT
--   chạy cùng lúc thì "tuple concurrently updated". Khoá tư vấn giữ tới hết phiên: bộ nào tới sau thì chờ.
\o /dev/null
SELECT pg_advisory_lock(hashtext('npp-thu-sql'));
\o
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
CREATE TEMP TABLE ctx (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

INSERT INTO ctx VALUES ('org', '00000000-0000-4000-8000-0000000248a1');
INSERT INTO organizations (id, name, slug) VALUES ((SELECT v FROM ctx WHERE k = 'org'), 'NPP thử mig 248', 'npp-thu-mig-248');

-- Sau một lần Lưu theo lỗi cũ: NVBH / kế toán / thủ kho có ô Bàn giao khách; quản lý có thật (mặc định);
-- NVBH có Khách hàng · Sửa (mô-đun cha — không được đụng); một dòng NVBH đã bị thu sẵn.
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT (SELECT v FROM ctx WHERE k = 'org'), r, m, a, ok
  FROM (VALUES ('sales', 'customers.handover', 'read', true),
               ('sales', 'customers.handover', 'update', true),
               ('sales', 'customers.handover', 'delete', false),
               ('accountant', 'customers.handover', 'read', true),
               ('warehouse', 'customers.handover', 'update', true),
               ('manager', 'customers.handover', 'update', true),
               ('owner', 'customers.handover', 'update', true),
               ('sales', 'customers', 'update', true)) v(r, m, a, ok);

CREATE FUNCTION pg_temp.co(p_role text, p_module text, p_action text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT allowed FROM role_permissions
   WHERE org_id = (SELECT v FROM ctx WHERE k = 'org') AND role = p_role AND module = p_module AND action = p_action
$f$;
-- Tạo NPP mới thì trigger gieo sẵn vài dòng quyền (trg_gieo_quyen_npp_moi) — đếm trước để so, không cố định số.
CREATE TEMP TABLE dem_truoc ON COMMIT DROP AS
  SELECT count(*) AS n FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org');

\o /dev/null
\ir ../../supabase/migrations/248_ban_giao_khach_tra_quyen.sql
\o

INSERT INTO kq SELECT 1, 'NVBH hết Bàn giao khách (xem + sửa)',
  pg_temp.co('sales', 'customers.handover', 'read') = false AND pg_temp.co('sales', 'customers.handover', 'update') = false,
  'read=' || pg_temp.co('sales', 'customers.handover', 'read') || ' update=' || pg_temp.co('sales', 'customers.handover', 'update');
INSERT INTO kq SELECT 2, 'kế toán / thủ kho cũng hết (không phải mặc định của họ)',
  pg_temp.co('accountant', 'customers.handover', 'read') = false AND pg_temp.co('warehouse', 'customers.handover', 'update') = false, '';
INSERT INTO kq SELECT 3, 'quản lý / chủ NPP giữ nguyên Bàn giao khách',
  pg_temp.co('manager', 'customers.handover', 'update') AND pg_temp.co('owner', 'customers.handover', 'update'), '';
INSERT INTO kq SELECT 4, 'NVBH giữ Khách hàng · Sửa — dòng mô-đun cha không đụng',
  pg_temp.co('sales', 'customers', 'update'), '';
INSERT INTO kq SELECT 5, 'dòng đã thu sẵn vẫn là thu, không thêm / bớt dòng nào',
  pg_temp.co('sales', 'customers.handover', 'delete') = false
  AND (SELECT count(*) FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org')) = (SELECT n FROM dem_truoc),
  (SELECT count(*) FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org')) || ' dòng, trước ' || (SELECT n FROM dem_truoc);
INSERT INTO kq SELECT 6, 'không còn vai ngoài chủ NPP / quản lý có Bàn giao khách (cả sổ)',
  NOT EXISTS (SELECT 1 FROM role_permissions
               WHERE module = 'customers.handover' AND role NOT IN ('owner', 'manager') AND allowed), '';

-- Chạy lại: vô hại, không đổi gì nữa.
CREATE TEMP TABLE truoc ON COMMIT DROP AS
  SELECT role, module, action, allowed FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org');
\o /dev/null
\ir ../../supabase/migrations/248_ban_giao_khach_tra_quyen.sql
\o
INSERT INTO kq SELECT 7, 'chạy lại migration: không đổi gì',
  NOT EXISTS (
    (SELECT role, module, action, allowed FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org')
     EXCEPT SELECT * FROM truoc)
    UNION ALL
    (SELECT * FROM truoc
     EXCEPT SELECT role, module, action, allowed FROM role_permissions WHERE org_id = (SELECT v FROM ctx WHERE k = 'org'))), '';

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 7 dòng kiểm', count(*) = 7, count(*) || ' dòng' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
