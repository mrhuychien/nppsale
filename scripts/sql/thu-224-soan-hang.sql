-- KIỂM MIG 224 (chủ nhà 02/10/2026: "thêm đánh dấu đơn nào đã soạn vào"). psql -f; in 'ĐẠT'/'LỖI'.
-- Thủ kho Em (…05) đánh dấu 2 HĐ đã soạn; NVBH Dung (…04) không đánh dấu được; bỏ đánh dấu; giờ sửa cuối
-- của hoá đơn không đổi.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE truoc ON COMMIT DROP AS SELECT id, updated_at FROM sales_invoices;
GRANT ALL ON truoc TO authenticated;
UPDATE sales_invoices SET soan_luc = NULL, soan_boi = NULL;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.danh_dau_soan_hang(ARRAY['6fb59f22-a8dd-4af7-b064-6b9acb46cb19']::uuid[], true); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'NVBH không đánh dấu được', v_loi LIKE 'KHONG_DU_QUYEN%', v_loi);
END $t$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_n int; v_n2 int; v_boi uuid; v_doi bigint; v_bo int; v_con bigint;
BEGIN
  v_n := public.danh_dau_soan_hang(ARRAY['6fb59f22-a8dd-4af7-b064-6b9acb46cb19', '1cab0591-77a9-41df-8eba-6a1342b76401']::uuid[], true);
  v_n2 := public.danh_dau_soan_hang(ARRAY['6fb59f22-a8dd-4af7-b064-6b9acb46cb19']::uuid[], true);
  SELECT soan_boi INTO v_boi FROM sales_invoices WHERE id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19';
  INSERT INTO kq VALUES (2, 'Thủ kho đánh dấu 2 HĐ; đánh dấu lại không ghi đè người / giờ',
    v_n = 2 AND v_n2 = 0 AND v_boi = 'e0000000-0000-0000-0000-000000000005', format('n=%s n2=%s boi=%s', v_n, v_n2, v_boi));
  SELECT count(*) INTO v_doi FROM sales_invoices s JOIN truoc t USING (id) WHERE s.updated_at IS DISTINCT FROM t.updated_at;
  INSERT INTO kq VALUES (3, 'Đánh dấu không đổi giờ sửa cuối của hoá đơn', v_doi = 0, 'đổi=' || v_doi);
  v_bo := public.danh_dau_soan_hang(ARRAY['1cab0591-77a9-41df-8eba-6a1342b76401']::uuid[], false);
  SELECT count(*) INTO v_con FROM sales_invoices WHERE soan_luc IS NOT NULL;
  INSERT INTO kq VALUES (4, 'Bỏ đánh dấu một HĐ → còn 1 HĐ đã soạn', v_bo = 1 AND v_con = 1, format('bo=%s con=%s', v_bo, v_con));
END $t$;
RESET ROLE;

-- 5. Trình duyệt không UPDATE thẳng được (chỉ có quyền đọc theo RLS).
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v_n int;
BEGIN
  UPDATE sales_invoices SET soan_luc = now() WHERE id = '39838b8e-4c06-4f02-83a7-e2fb4b529ebf';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO kq VALUES (5, 'UPDATE thẳng từ trình duyệt không ghi được', v_n = 0, 'n=' || v_n);
END $t$;
RESET ROLE;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
ROLLBACK;
