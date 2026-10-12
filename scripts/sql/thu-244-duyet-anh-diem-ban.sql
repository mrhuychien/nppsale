-- KIỂM MIG 244 — duyệt ảnh + vị trí điểm bán (chủ nhà 12/10/2026: "Khi nhân viên cập nhật ảnh điểm bán và định vị.
-- Chủ NPP đã phê duyệt thì khi thay đổi hoặc xoá ảnh+vị trí cần nhà phân phối phê duyệt."). psql -f, BEGIN … ROLLBACK.
-- Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-244-duyet-anh-diem-ban.sql
-- Người: chủ NPP e..01 (duyệt được) · quản lý e..02 (chưa có quyền duyệt, bước 18 mới cấp riêng) · NVBH e..04
-- (phụ trách K1, K3; không phụ trách K2) · thủ kho e..05. Lệnh của người dùng chạy dưới vai `authenticated`
-- (RLS + trigger như thật) qua pg_temp.chay / pg_temp.goi; dựng sổ dưới vai postgres.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
CREATE TEMP TABLE yc (ten text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON kq, yc TO authenticated;

-- Một câu dưới tên một người → 'OK' hoặc MÃ LỖI (phần trước dấu ':'). Cờ phiên của RPC duyệt sống tới hết giao dịch;
-- thật thì mỗi lượt gọi API là một giao dịch → ở đây xoá cờ trước mỗi lượt.
CREATE FUNCTION pg_temp.chay(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $t$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('npp.duyet_anh_diem_ban', '', true);
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN split_part(SQLERRM, ':', 1);
END $t$;
CREATE FUNCTION pg_temp.goi(p_uid text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $t$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  PERFORM set_config('npp.duyet_anh_diem_ban', '', true);
  EXECUTE p_sql INTO v;
  RETURN v;
END $t$;

\set ORG '''a0000000-0000-0000-0000-000000000001'''
\set CHU '''e0000000-0000-0000-0000-000000000001'''
\set QL '''e0000000-0000-0000-0000-000000000002'''
\set NV '''e0000000-0000-0000-0000-000000000004'''
\set KHO '''e0000000-0000-0000-0000-000000000005'''
\set K1 '''c2440000-0000-0000-0000-000000000001'''
\set K2 '''c2440000-0000-0000-0000-000000000002'''
\set K3 '''c2440000-0000-0000-0000-000000000003'''
\set K4 '''c2440000-0000-0000-0000-000000000004'''
\set URL '''https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/'''

INSERT INTO customers (id, org_id, store_name, owner_name, phone, address, created_by, gps_lat, gps_lng) VALUES
  (:K1, :ORG, 'Điểm thử 244 K1', 'Chủ K1', '0912440001', '1 Thử', :CHU, 20.8, 106.6),
  (:K2, :ORG, 'Điểm thử 244 K2', 'Chủ K2', '0912440002', '2 Thử', :CHU, NULL, NULL),
  (:K3, :ORG, 'Điểm thử 244 K3', 'Chủ K3', '0912440003', '3 Thử', :CHU, NULL, NULL),
  (:K4, :ORG, 'Điểm thử 244 K4', 'Chủ K4', '0912440004', '4 Thử', :CHU, 20.7, 106.5);
INSERT INTO customer_assignments (customer_id, user_id, role, status) VALUES
  (:K1, :NV, 'primary', 'active'), (:K3, :NV, 'primary', 'active'), (:K4, :NV, 'primary', 'active');
INSERT INTO customer_photos (id, org_id, customer_id, slot, photo_url, taken_at, gps_lat, gps_lng, uploaded_by) VALUES
  ('f2440000-0000-0000-0000-000000000001', :ORG, :K1, 1, :URL || 'c2440000-0000-0000-0000-000000000001/1-1.jpg', now(), 20.8, 106.6, :NV),
  ('f2440000-0000-0000-0000-000000000002', :ORG, :K1, 2, :URL || 'c2440000-0000-0000-0000-000000000001/2-2.jpg', now(), 20.81, 106.6, :NV),
  ('f2440000-0000-0000-0000-000000000003', :ORG, :K1, 3, :URL || 'c2440000-0000-0000-0000-000000000001/3-3.jpg', now(), 20.82, 106.6, :NV);
DELETE FROM notifications WHERE user_id IN (:CHU, :QL, :NV) AND type = 'customer_photo_review';

SET LOCAL ROLE authenticated;

-- 1. Chưa duyệt: NVBH sửa thẳng ảnh / vị trí như cũ.
INSERT INTO kq SELECT 1, 'Chưa duyệt: NVBH sửa thẳng ảnh và dời vị trí được (như trước mig 244)',
  pg_temp.chay(:NV, 'UPDATE customer_photos SET gps_accuracy = 9 WHERE id = ''f2440000-0000-0000-0000-000000000001''') = 'OK'
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lat = 20.8005 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK'
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lat = 20.8 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK', '';
RESET ROLE;
INSERT INTO kq SELECT 101, '… và ghi thật (RLS không lọc mất)', p.gps_accuracy = 9 AND c.gps_lat = 20.8, p.gps_accuracy || ' · ' || c.gps_lat
  FROM customer_photos p, customers c WHERE p.id = 'f2440000-0000-0000-0000-000000000001' AND c.id = :K1;
SET LOCAL ROLE authenticated;

-- 2–4. Cột duyệt chỉ đổi qua nút; chỉ người có customers.approve bấm được.
INSERT INTO kq SELECT 2, 'NVBH tự ghi cột duyệt (lúc duyệt / người duyệt / tạo khách mới đã duyệt sẵn) → DUYET_QUA_NUT',
  pg_temp.chay(:NV, 'UPDATE customers SET photo_approved_at = now() WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'DUYET_QUA_NUT'
  AND pg_temp.chay(:NV, 'UPDATE customers SET photo_approved_by = ''e0000000-0000-0000-0000-000000000004'' WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'DUYET_QUA_NUT'
  AND pg_temp.chay(:NV, 'INSERT INTO customers (org_id, store_name, owner_name, phone, address, photo_approved_at) VALUES (''a0000000-0000-0000-0000-000000000001'', ''Tự duyệt'', ''x'', ''0912440009'', ''x'', now())') = 'DUYET_QUA_NUT', '';
INSERT INTO kq SELECT 3, 'NVBH / quản lý (chưa cấp quyền) / thủ kho bấm Duyệt → FORBIDDEN',
  pg_temp.chay(:NV, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'')') = 'FORBIDDEN'
  AND pg_temp.chay(:QL, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'')') = 'FORBIDDEN'
  AND pg_temp.chay(:KHO, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'')') = 'FORBIDDEN', '';
INSERT INTO kq SELECT 4, 'Chủ NPP duyệt ảnh + vị trí K1',
  (pg_temp.goi(:CHU, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'')') ->> 'duyet') = 'true', '';
RESET ROLE;
INSERT INTO kq SELECT 104, '… ghi đúng người / lúc duyệt', photo_approved_at IS NOT NULL AND photo_approved_by = :CHU, ''
  FROM customers WHERE id = :K1;
SET LOCAL ROLE authenticated;

-- 5. Đã duyệt: NVBH ghi thẳng bị chặn; cột khác vẫn sửa được; form gửi lại toạ độ cũ không bị chặn.
INSERT INTO kq SELECT 5, 'Đã duyệt: NVBH thay / xoá / thêm ảnh, dời / xoá vị trí thẳng tay → bị chặn',
  pg_temp.chay(:NV, 'UPDATE customer_photos SET photo_url = photo_url || ''x'' WHERE id = ''f2440000-0000-0000-0000-000000000001''') = 'ANH_DA_DUYET'
  AND pg_temp.chay(:NV, 'DELETE FROM customer_photos WHERE id = ''f2440000-0000-0000-0000-000000000002''') = 'ANH_DA_DUYET'
  AND pg_temp.chay(:NV, 'INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at) VALUES (''a0000000-0000-0000-0000-000000000001'', ''c2440000-0000-0000-0000-000000000001'', 2, ''u'', now())') = 'ANH_DA_DUYET'
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lat = 21 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'VI_TRI_DA_DUYET'
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lng = 107 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'VI_TRI_DA_DUYET'
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lat = NULL, gps_lng = NULL WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'VI_TRI_DA_DUYET', '';
INSERT INTO kq SELECT 6, 'Đã duyệt: NVBH vẫn sửa SĐT; gửi lại đúng toạ độ cũ (form Lưu) không bị chặn',
  pg_temp.chay(:NV, 'UPDATE customers SET phone = ''0912449999'', gps_lat = 20.8, gps_lng = 106.6 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK', '';
INSERT INTO kq SELECT 7, 'Người duyệt (chủ NPP) sửa thẳng được cả khi đã duyệt',
  pg_temp.chay(:CHU, 'UPDATE customer_photos SET gps_accuracy = 7 WHERE id = ''f2440000-0000-0000-0000-000000000003''') = 'OK'
  AND pg_temp.chay(:CHU, 'UPDATE customers SET gps_lng = 106.6001 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK'
  AND pg_temp.chay(:CHU, 'UPDATE customers SET gps_lng = 106.6 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK', '';
RESET ROLE;
INSERT INTO kq SELECT 107, '… các lệnh được phép đã ghi thật; các lệnh bị chặn không đổi gì',
  c.phone = '0912449999' AND c.gps_lat = 20.8 AND c.gps_lng = 106.6
  AND (SELECT count(*) FROM customer_photos WHERE customer_id = :K1) = 3
  AND (SELECT photo_url FROM customer_photos WHERE id = 'f2440000-0000-0000-0000-000000000001') LIKE '%/1-1.jpg'
  AND (SELECT gps_accuracy FROM customer_photos WHERE id = 'f2440000-0000-0000-0000-000000000003') = 7, c.phone
  FROM customers c WHERE c.id = :K1;
SET LOCAL ROLE authenticated;

-- 8. NVBH gửi yêu cầu: thay ảnh 1 (vị trí đi theo) — chưa đổi gì; người duyệt được báo, người không có quyền thì không.
INSERT INTO yc SELECT 'thay1', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''replace'', %L, NULL, %L, now(), 20.85, 106.68, 8, ''set'', 20.85, 106.68)',
  'c2440000-0000-0000-0000-000000000001', 'f2440000-0000-0000-0000-000000000001',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/1-100.jpg'));
RESET ROLE;
INSERT INTO kq SELECT 8, 'Yêu cầu thay ảnh 1 + dời vị trí: 2 yêu cầu chờ, ảnh / vị trí CHƯA đổi',
  jsonb_array_length(v -> 'ids') = 2
  AND (SELECT count(*) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending') = 2
  AND (SELECT photo_url FROM customer_photos WHERE id = 'f2440000-0000-0000-0000-000000000001') LIKE '%/1-1.jpg'
  AND (SELECT gps_lat FROM customers WHERE id = :K1) = 20.8, v::text
  FROM yc WHERE ten = 'thay1';
INSERT INTO kq SELECT 9, 'Chủ NPP nhận 1 thông báo "Thay ảnh 1 · Dời vị trí"; quản lý (chưa có quyền duyệt) không nhận',
  (SELECT count(*) FROM notifications WHERE user_id = :CHU AND type = 'customer_photo_review'
     AND title = 'Yêu cầu duyệt ảnh điểm bán: Điểm thử 244 K1' AND body LIKE '%xin: Thay ảnh 1 · Dời vị trí') = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = :QL AND type = 'customer_photo_review') = 0, '';
SET LOCAL ROLE authenticated;

-- 10. Gửi lại cùng ô → yêu cầu cũ bị thay, file ảnh cũ trả về để dọn; yêu cầu vị trí giữ nguyên.
INSERT INTO yc SELECT 'thay1b', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''replace'', %L, NULL, %L, now(), 20.85, 106.68, 6)',
  'c2440000-0000-0000-0000-000000000001', 'f2440000-0000-0000-0000-000000000001',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/1-200.jpg'));
RESET ROLE;
INSERT INTO kq SELECT 10, 'Chụp lại lần nữa: yêu cầu cũ ô 1 bị thay (file 1-100 trả về để dọn), yêu cầu vị trí còn',
  (v -> 'file_bo') = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/1-100.jpg')
  AND (SELECT count(*) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending' AND slot = 1) = 1
  AND (SELECT photo_url FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending' AND slot = 1) LIKE '%/1-200.jpg'
  AND (SELECT decision_note FROM customer_photo_requests WHERE photo_url LIKE '%/1-100.jpg') = 'Thay bằng yêu cầu mới'
  AND (SELECT count(*) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending' AND kind = 'pin_set') = 1, v::text
  FROM yc WHERE ten = 'thay1b';
SET LOCAL ROLE authenticated;

-- 11. Yêu cầu sai bị chặn.
INSERT INTO kq SELECT 11, 'Yêu cầu sai: file ngoài thư mục điểm bán / điểm bán chưa duyệt / không phụ trách / thủ kho / ô đã có ảnh / rỗng',
  pg_temp.chay(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'', ''replace'', ''f2440000-0000-0000-0000-000000000002'', NULL, ''https://evil.example/a.jpg'', now())') = 'FILE_SAI'
  AND pg_temp.chay(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000003'', ''none'', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ''set'', 20.9, 106.7)') = 'CHUA_DUYET'
  AND pg_temp.chay(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000002'', ''none'', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ''clear'')') = 'KHONG_PHU_TRACH'
  AND pg_temp.chay(:KHO, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'', ''none'', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ''clear'')') = 'FORBIDDEN'
  AND pg_temp.chay(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''add'', NULL, 2, %L, now())', 'c2440000-0000-0000-0000-000000000001',
        'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/2-9.jpg')) = 'O_DA_CO_ANH'
  AND pg_temp.chay(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'')') = 'YEU_CAU_RONG', '';

-- 12. Bảng yêu cầu: không ai ghi thẳng được — mig 244 thu quyền ghi, và bảng KHÔNG có policy ghi nào nên dù quyền có bị
--     cấp lại thì chèn vẫn bị RLS từ chối, sửa / xoá không trúng dòng nào. ⚠ Phải đúng cả hai trường hợp: các bộ thử khác
--     (thu-224, 225, 238–240…) `GRANT … ON ALL TABLES` NGOÀI giao dịch, nên sổ thử có thể đang có quyền ghi.
--     NVBH / quản lý thấy yêu cầu của điểm bán mình thấy, thủ kho không.
INSERT INTO yc SELECT 'ghi_thang', jsonb_build_array(
  pg_temp.chay(:NV, 'UPDATE customer_photo_requests SET status = ''approved'' WHERE customer_id = ''c2440000-0000-0000-0000-000000000001'''),
  pg_temp.chay(:NV, 'DELETE FROM customer_photo_requests WHERE customer_id = ''c2440000-0000-0000-0000-000000000001'''),
  pg_temp.chay(:CHU, 'INSERT INTO customer_photo_requests (org_id, customer_id, kind) VALUES (''a0000000-0000-0000-0000-000000000001'', ''c2440000-0000-0000-0000-000000000001'', ''pin_clear'')'));
INSERT INTO kq SELECT 12, 'Không ghi thẳng bảng yêu cầu (chỉ RPC): chèn tay bị từ chối; NVBH và quản lý thấy 2 yêu cầu chờ của K1, thủ kho không thấy',
  (SELECT v ->> 2 FROM yc WHERE ten = 'ghi_thang') <> 'OK'
  AND (SELECT pg_temp.goi(:NV, 'SELECT to_jsonb(count(*)) FROM customer_photo_requests WHERE customer_id = ''c2440000-0000-0000-0000-000000000001'' AND status = ''pending''')) = '2'::jsonb
  AND (SELECT pg_temp.goi(:QL, 'SELECT to_jsonb(count(*)) FROM customer_photo_requests WHERE customer_id = ''c2440000-0000-0000-0000-000000000001'' AND status = ''pending''')) = '2'::jsonb
  AND (SELECT pg_temp.goi(:KHO, 'SELECT to_jsonb(count(*)) FROM customer_photo_requests WHERE customer_id = ''c2440000-0000-0000-0000-000000000001''')) = '0'::jsonb,
  (SELECT v::text FROM yc WHERE ten = 'ghi_thang');
RESET ROLE;
INSERT INTO kq SELECT 112, '… sửa / xoá tay không đổi gì: K1 vẫn 3 yêu cầu (2 đang chờ: thay ảnh 1 + dời vị trí), không dòng chèn tay',
  (SELECT count(*) FROM customer_photo_requests WHERE customer_id = :K1) = 3
  AND (SELECT string_agg(kind, ',' ORDER BY kind) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending') = 'photo_replace,pin_set',
  (SELECT string_agg(kind || ':' || status, ',' ORDER BY kind, status) FROM customer_photo_requests WHERE customer_id = :K1);
SET LOCAL ROLE authenticated;

-- 13. Quản lý chưa có quyền không duyệt được; chủ NPP đồng ý thay ảnh 1, từ chối dời vị trí.
RESET ROLE;
INSERT INTO yc SELECT 'id_anh', to_jsonb(id) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending' AND kind = 'photo_replace';
INSERT INTO yc SELECT 'id_vt', to_jsonb(id) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending' AND kind = 'pin_set';
SET LOCAL ROLE authenticated;
INSERT INTO kq SELECT 13, 'Quản lý (chưa cấp quyền duyệt) bấm duyệt → FORBIDDEN',
  pg_temp.chay(:QL, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v #>> '{}' FROM yc WHERE ten = 'id_anh'))) = 'FORBIDDEN', '';
INSERT INTO yc SELECT 'duyet_anh', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v #>> '{}' FROM yc WHERE ten = 'id_anh')));
INSERT INTO yc SELECT 'tu_choi_vt', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], false, ''Sai chỗ'')', (SELECT v #>> '{}' FROM yc WHERE ten = 'id_vt')));
RESET ROLE;
INSERT INTO kq SELECT 14, 'Đồng ý thay ảnh 1: ảnh mới vào ô 1 (người chụp = NVBH), file cũ 1-1 trả về để dọn',
  (v ->> 'xong')::int = 1 AND (v -> 'file_bo') = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/1-1.jpg')
  AND p.photo_url LIKE '%/1-200.jpg' AND p.gps_lat = 20.85 AND p.gps_accuracy = 6 AND p.uploaded_by = :NV AND p.slot = 1, v::text
  FROM yc, customer_photos p WHERE yc.ten = 'duyet_anh' AND p.id = 'f2440000-0000-0000-0000-000000000001';
INSERT INTO kq SELECT 15, 'Từ chối dời vị trí (lý do "Sai chỗ"): toạ độ giữ nguyên, yêu cầu Bị từ chối',
  c.gps_lat = 20.8 AND c.gps_lng = 106.6
  AND (SELECT status || '|' || decision_note FROM customer_photo_requests WHERE id = ((SELECT v #>> '{}' FROM yc WHERE ten = 'id_vt'))::uuid) = 'rejected|Sai chỗ', ''
  FROM customers c WHERE c.id = :K1;
INSERT INTO kq SELECT 16, 'NVBH nhận 2 thông báo kết quả: "Đã duyệt … Thay ảnh 1" và "Từ chối … Dời vị trí — Sai chỗ"',
  (SELECT count(*) FROM notifications WHERE user_id = :NV AND type = 'customer_photo_review'
     AND title = 'Đã duyệt ảnh điểm bán: Điểm thử 244 K1' AND body = 'Thay ảnh 1') = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = :NV AND type = 'customer_photo_review'
     AND title = 'Từ chối ảnh điểm bán: Điểm thử 244 K1' AND body = 'Dời vị trí — Sai chỗ') = 1, '';
SET LOCAL ROLE authenticated;
INSERT INTO kq SELECT 17, 'Đã xử lý thì không duyệt lại được → DA_XU_LY',
  pg_temp.chay(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v #>> '{}' FROM yc WHERE ten = 'id_anh'))) = 'DA_XU_LY', '';

-- 18. Xoá ảnh 2 + xoá vị trí (một lượt gửi, hai yêu cầu) → duyệt cả hai một lượt.
INSERT INTO yc SELECT 'xoa2', pg_temp.goi(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'', ''delete'', ''f2440000-0000-0000-0000-000000000002'', NULL, NULL, NULL, NULL, NULL, NULL, ''clear'')');
INSERT INTO yc SELECT 'duyet_xoa2', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(%L::uuid[], true)',
  (SELECT '{' || string_agg(x, ',') || '}' FROM jsonb_array_elements_text((SELECT v -> 'ids' FROM yc WHERE ten = 'xoa2')) x)));
RESET ROLE;
INSERT INTO kq SELECT 18, 'Duyệt một lượt "Xoá ảnh 2 · Xoá vị trí": ảnh 2 mất, toạ độ trống, file 2-2 trả về để dọn',
  (v ->> 'xong')::int = 2 AND (v -> 'file_bo') = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/2-2.jpg')
  AND NOT EXISTS (SELECT 1 FROM customer_photos WHERE id = 'f2440000-0000-0000-0000-000000000002')
  AND (SELECT gps_lat IS NULL AND gps_lng IS NULL FROM customers WHERE id = :K1), v::text
  FROM yc WHERE ten = 'duyet_xoa2';
SET LOCAL ROLE authenticated;

-- 19. Yêu cầu lỗi thời: NV xin thay ảnh 3, người duyệt xoá thẳng ảnh 3, rồi duyệt → tự huỷ, file mới trả về để dọn.
INSERT INTO yc SELECT 'thay3', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''replace'', %L, NULL, %L, now())',
  'c2440000-0000-0000-0000-000000000001', 'f2440000-0000-0000-0000-000000000003',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/3-300.jpg'));
INSERT INTO kq SELECT 1900, 'Người duyệt xoá thẳng ảnh 3', pg_temp.chay(:CHU, 'DELETE FROM customer_photos WHERE id = ''f2440000-0000-0000-0000-000000000003''') = 'OK', '';
INSERT INTO yc SELECT 'duyet3', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'thay3')));
RESET ROLE;
INSERT INTO kq SELECT 19, 'Ảnh gốc đã mất → yêu cầu tự huỷ (bo_qua 1), file 3-300 trả về để dọn, không đẻ lại ảnh 3',
  (v ->> 'xong')::int = 0 AND (v ->> 'bo_qua')::int = 1
  AND (v -> 'file_bo') = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/3-300.jpg')
  AND NOT EXISTS (SELECT 1 FROM customer_photos WHERE customer_id = :K1 AND slot = 3)
  AND (SELECT status FROM customer_photo_requests WHERE photo_url LIKE '%/3-300.jpg') = 'cancelled', v::text
  FROM yc WHERE ten = 'duyet3';
SET LOCAL ROLE authenticated;

-- 191. Thêm ảnh lỗi thời: NV xin thêm ảnh 3, người duyệt chụp thẳng ảnh 3 trước, rồi duyệt → tự huỷ, không đè ảnh.
INSERT INTO yc SELECT 'them3', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''add'', NULL, 3, %L, now())',
  'c2440000-0000-0000-0000-000000000001',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/3-700.jpg'));
INSERT INTO kq SELECT 1910, 'Người duyệt chụp thẳng ảnh 3',
  pg_temp.chay(:CHU, 'INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at, uploaded_by) VALUES (''a0000000-0000-0000-0000-000000000001'', ''c2440000-0000-0000-0000-000000000001'', 3, ''u-chu'', now(), ''e0000000-0000-0000-0000-000000000001'')') = 'OK', '';
INSERT INTO yc SELECT 'duyet_them3', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'them3')));
RESET ROLE;
INSERT INTO kq SELECT 191, 'Ô ảnh 3 đã có ảnh trước khi duyệt → yêu cầu thêm tự huỷ, file 3-700 trả về, ảnh của người duyệt giữ nguyên',
  (v ->> 'xong')::int = 0 AND (v ->> 'bo_qua')::int = 1
  AND (v -> 'file_bo') = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/3-700.jpg')
  AND (SELECT photo_url FROM customer_photos WHERE customer_id = :K1 AND slot = 3) = 'u-chu', v::text
  FROM yc WHERE ten = 'duyet_them3';
SET LOCAL ROLE authenticated;

-- 20. Rút yêu cầu: người khác (không gửi, không có quyền duyệt) → FORBIDDEN; người gửi rút được, file trả về.
INSERT INTO yc SELECT 'them2', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''add'', NULL, 2, %L, now(), 20.8, 106.6, 5)',
  'c2440000-0000-0000-0000-000000000001',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/2-500.jpg'));
INSERT INTO kq SELECT 20, 'Rút yêu cầu: quản lý (không gửi, chưa có quyền duyệt) → FORBIDDEN; NVBH rút → file 2-500 trả về',
  pg_temp.chay(:QL, format('SELECT public.huy_yeu_cau_anh_diem_ban(%L)', (SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'them2'))) = 'FORBIDDEN'
  AND (pg_temp.goi(:NV, format('SELECT public.huy_yeu_cau_anh_diem_ban(%L)', (SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'them2'))) -> 'file_bo')
      = jsonb_build_array(:URL || 'c2440000-0000-0000-0000-000000000001/2-500.jpg'), '';

-- 21. Chủ NPP cấp quyền duyệt riêng cho quản lý → quản lý duyệt được (thêm ảnh 2, người chụp vẫn là NVBH).
RESET ROLE;
INSERT INTO user_permission_overrides (org_id, user_id, permission_key, granted, created_at, updated_at)
VALUES (:ORG, :QL, 'customers.approve', true, now(), now())
ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
INSERT INTO yc SELECT 'them2b', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''add'', NULL, 2, %L, now())',
  'c2440000-0000-0000-0000-000000000001',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000001/2-600.jpg'));
INSERT INTO yc SELECT 'ql_duyet', pg_temp.goi(:QL, format('SELECT public.duyet_yeu_cau_anh_diem_ban(ARRAY[%L]::uuid[], true)', (SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'them2b')));
RESET ROLE;
INSERT INTO kq SELECT 21, 'Quản lý được cấp quyền duyệt: thêm ảnh 2 vào sổ (người chụp NVBH), mốc duyệt ghi tên quản lý',
  (v ->> 'xong')::int = 1
  AND (SELECT uploaded_by = :NV AND photo_url LIKE '%/2-600.jpg' FROM customer_photos WHERE customer_id = :K1 AND slot = 2)
  AND (SELECT photo_approved_by = :QL FROM customers WHERE id = :K1), v::text
  FROM yc WHERE ten = 'ql_duyet';
SET LOCAL ROLE authenticated;

-- 22. Bỏ duyệt: yêu cầu đang chờ bị huỷ (file trả về), NVBH sửa thẳng lại được.
INSERT INTO yc SELECT 'vt_cho', pg_temp.goi(:NV, 'SELECT public.xin_doi_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'', ''none'', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ''set'', 20.9, 106.7)');
INSERT INTO yc SELECT 'bo_duyet', pg_temp.goi(:CHU, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000001'', false)');
INSERT INTO kq SELECT 22, 'Bỏ duyệt: yêu cầu chờ bị huỷ; NVBH lại dời vị trí thẳng được',
  (SELECT (v ->> 'duyet') = 'false' FROM yc WHERE ten = 'bo_duyet')
  AND pg_temp.chay(:NV, 'UPDATE customers SET gps_lat = 20.9, gps_lng = 106.7 WHERE id = ''c2440000-0000-0000-0000-000000000001''') = 'OK', '';
RESET ROLE;
INSERT INTO kq SELECT 122, '… không còn yêu cầu chờ, cột duyệt trống, toạ độ đã ghi',
  (SELECT count(*) FROM customer_photo_requests WHERE customer_id = :K1 AND status = 'pending') = 0
  AND c.photo_approved_at IS NULL AND c.photo_approved_by IS NULL AND c.gps_lat = 20.9
  AND (SELECT decision_note FROM customer_photo_requests WHERE id = ((SELECT v -> 'ids' ->> 0 FROM yc WHERE ten = 'vt_cho'))::uuid)
      = 'Bỏ duyệt — nhân viên sửa thẳng được', ''
  FROM customers c WHERE c.id = :K1;
SET LOCAL ROLE authenticated;

-- 23. Ảnh ĐẦU TIÊN của điểm bán chưa duyệt → người duyệt được báo một lần; ảnh thứ hai không báo nữa.
INSERT INTO kq SELECT 2300, 'NVBH chụp ảnh 1 và 2 cho K3 (chưa duyệt)',
  pg_temp.chay(:NV, 'INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at, uploaded_by) VALUES (''a0000000-0000-0000-0000-000000000001'', ''c2440000-0000-0000-0000-000000000003'', 1, ''u1'', now(), ''e0000000-0000-0000-0000-000000000004'')') = 'OK'
  AND pg_temp.chay(:NV, 'INSERT INTO customer_photos (org_id, customer_id, slot, photo_url, taken_at, uploaded_by) VALUES (''a0000000-0000-0000-0000-000000000001'', ''c2440000-0000-0000-0000-000000000003'', 2, ''u2'', now(), ''e0000000-0000-0000-0000-000000000004'')') = 'OK', '';
RESET ROLE;
INSERT INTO kq SELECT 23, 'Chủ NPP và quản lý (đã được cấp quyền) mỗi người đúng 1 thông báo "Ảnh điểm bán chờ duyệt: … K3"; NVBH không',
  (SELECT count(*) FROM notifications WHERE user_id = :CHU AND title = 'Ảnh điểm bán chờ duyệt: Điểm thử 244 K3') = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = :QL AND title = 'Ảnh điểm bán chờ duyệt: Điểm thử 244 K3') = 1
  AND (SELECT count(*) FROM notifications WHERE user_id = :NV AND title = 'Ảnh điểm bán chờ duyệt: Điểm thử 244 K3') = 0, '';
SET LOCAL ROLE authenticated;

-- 24. Điểm bán trống không duyệt được; quyền hàm.
INSERT INTO kq SELECT 24, 'Duyệt điểm bán chưa có ảnh / vị trí → CHUA_CO_GI_DE_DUYET',
  pg_temp.chay(:CHU, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000002'')') = 'CHUA_CO_GI_DE_DUYET', '';
RESET ROLE;
INSERT INTO kq SELECT 25, 'Quyền hàm: anon không gọi RPC; authenticated gọi được RPC, KHÔNG gọi được hàm nội bộ',
  NOT has_function_privilege('anon', 'public.xin_doi_anh_diem_ban(uuid,text,uuid,integer,text,timestamptz,numeric,numeric,numeric,text,numeric,numeric)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.duyet_yeu_cau_anh_diem_ban(uuid[],boolean,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.duyet_yeu_cau_anh_diem_ban(uuid[],boolean,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.huy_yeu_cau_anh_diem_ban(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.duyet_anh_diem_ban(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._nguoi_duyet_anh_diem_ban(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._bao_tin_anh_diem_ban(uuid,uuid[],text,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._anh_diem_ban_bi_khoa(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._trg_khoa_anh_diem_ban()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._trg_khoa_vi_tri_diem_ban()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._trg_bao_anh_dau_cho_duyet()', 'EXECUTE'), '';

-- 26–27. K4 đã duyệt (chỉ có toạ độ): NV xin thêm ảnh 1 + dời vị trí một lượt → duyệt cả hai.
SET LOCAL ROLE authenticated;
INSERT INTO kq SELECT 2600, 'Chủ NPP duyệt K4 (mới có toạ độ, chưa có ảnh)',
  (pg_temp.goi(:CHU, 'SELECT public.duyet_anh_diem_ban(''c2440000-0000-0000-0000-000000000004'')') ->> 'duyet') = 'true', '';
INSERT INTO yc SELECT 'k4', pg_temp.goi(:NV, format('SELECT public.xin_doi_anh_diem_ban(%L, ''add'', NULL, 1, %L, now(), 20.95, 106.75, 4, ''set'', 20.95, 106.75)',
  'c2440000-0000-0000-0000-000000000004',
  'https://x.supabase.co/storage/v1/object/public/customer-photos/a0000000-0000-0000-0000-000000000001/c2440000-0000-0000-0000-000000000004/1-800.jpg'));
INSERT INTO yc SELECT 'duyet_k4', pg_temp.goi(:CHU, format('SELECT public.duyet_yeu_cau_anh_diem_ban(%L::uuid[], true)',
  (SELECT '{' || string_agg(x, ',') || '}' FROM jsonb_array_elements_text((SELECT v -> 'ids' FROM yc WHERE ten = 'k4')) x)));
RESET ROLE;
INSERT INTO kq SELECT 26, 'Duyệt "Thêm ảnh 1 · Dời vị trí" của K4: ảnh 1 vào sổ, toạ độ thành 20.95, 106.75',
  (v ->> 'xong')::int = 2
  AND (SELECT photo_url LIKE '%/1-800.jpg' AND gps_lat = 20.95 FROM customer_photos WHERE customer_id = :K4 AND slot = 1)
  AND (SELECT gps_lat = 20.95 AND gps_lng = 106.75 FROM customers WHERE id = :K4), v::text
  FROM yc WHERE ten = 'duyet_k4';
INSERT INTO kq SELECT 27, 'Điểm bán ĐÃ duyệt nhận ảnh đầu tiên (qua duyệt) → KHÔNG báo "chờ duyệt"',
  (SELECT count(*) FROM notifications WHERE title = 'Ảnh điểm bán chờ duyệt: Điểm thử 244 K4') = 0, '';

-- 28. Lượt KHÔNG đăng nhập (SQL tay, khoá máy chủ) không bị khoá — kể cả với điểm bán đã duyệt.
INSERT INTO kq SELECT 28, 'Không đăng nhập (SQL tay / khoá máy chủ): sửa ảnh, toạ độ của điểm bán đã duyệt vẫn được',
  pg_temp.chay('', 'UPDATE customer_photos SET gps_accuracy = 3 WHERE customer_id = ''c2440000-0000-0000-0000-000000000004''') = 'OK'
  AND pg_temp.chay('', 'UPDATE customers SET gps_lat = 20.96 WHERE id = ''c2440000-0000-0000-0000-000000000004''') = 'OK', '';
INSERT INTO kq SELECT 128, '… và ghi thật', gps_lat = 20.96, gps_lat::text FROM customers WHERE id = :K4;

-- Bước nào không ra dòng là im lặng mất — đếm cho đủ.
INSERT INTO kq SELECT 99, 'Đủ 39 bước kiểm', count(*) = 39, count(*) || ' bước' FROM kq;
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS loi FROM kq;
ROLLBACK;
