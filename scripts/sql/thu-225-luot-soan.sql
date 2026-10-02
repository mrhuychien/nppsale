-- KIỂM MIG 225 (chủ nhà 02/10/2026: màn soạn hàng theo mẫu — lượt soạn lưu máy chủ, hoàn tất = đánh dấu đã
-- soạn, thiếu hàng chỉ ghi). Thủ kho Em (…05) tạo lượt 2 HĐ, hai "máy" ghi tiến độ khác khoá không đè nhau,
-- bỏ nhặt (null) xoá khoá, hoàn tất đánh dấu HĐ đã soạn, không trừ kho; NVBH không đụng được. psql -f.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON luot_soan FROM authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
CREATE TEMP TABLE ton_truoc ON COMMIT DROP AS SELECT id, qty_on_hand FROM batches;
GRANT ALL ON ton_truoc TO authenticated;
UPDATE sales_invoices SET soan_luc = NULL, soan_boi = NULL;
CREATE TEMP TABLE luot (id uuid) ON COMMIT DROP;
GRANT ALL ON luot TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.tao_luot_soan(ARRAY['6fb59f22-a8dd-4af7-b064-6b9acb46cb19']::uuid[]); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'NVBH không tạo lượt soạn', v_loi LIKE 'KHONG_DU_QUYEN%', v_loi);
END $t$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_id uuid; v luot_soan; v_loi text; v_n int;
BEGIN
  v_id := public.tao_luot_soan(ARRAY['1cab0591-77a9-41df-8eba-6a1342b76401', '6fb59f22-a8dd-4af7-b064-6b9acb46cb19', '1cab0591-77a9-41df-8eba-6a1342b76401']::uuid[]);
  INSERT INTO luot VALUES (v_id);
  SELECT * INTO v FROM luot_soan WHERE id = v_id;
  INSERT INTO kq VALUES (2, 'Tạo lượt: mã SH-dd/mm-01, giữ thứ tự rổ, bỏ trùng',
    v.ma ~ '^SH-\d\d/\d\d-01$' AND v.invoice_ids = ARRAY['1cab0591-77a9-41df-8eba-6a1342b76401', '6fb59f22-a8dd-4af7-b064-6b9acb46cb19']::uuid[],
    format('ma=%s ids=%s', v.ma, v.invoice_ids));

  -- Máy 1 nhặt SP a; máy 2 nhặt SP b + chia một ô → không đè nhau.
  PERFORM public.cap_nhat_luot_soan(v_id, NULL, '{"a": 10}'::jsonb, NULL);
  PERFORM public.cap_nhat_luot_soan(v_id, NULL, '{"b": 4}'::jsonb, '{"b|x": true}'::jsonb);
  SELECT * INTO v FROM luot_soan WHERE id = v_id;
  INSERT INTO kq VALUES (3, 'Hai máy ghi hai mặt hàng khác nhau — gộp, không đè',
    v.tien_do = '{"nhat": {"a": 10, "b": 4}, "chia": {"b|x": true}}'::jsonb, v.tien_do::text);

  v := public.cap_nhat_luot_soan(v_id, NULL, '{"a": null}'::jsonb, '{"b|x": null}'::jsonb);
  INSERT INTO kq VALUES (4, 'Bỏ nhặt / bỏ chia (null) xoá khoá', v.tien_do = '{"nhat": {"b": 4}, "chia": {}}'::jsonb, v.tien_do::text);

  BEGIN PERFORM public.cap_nhat_luot_soan(v_id, ARRAY['00000000-0000-0000-0000-0000000000ff']::uuid[]); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (5, 'Không thêm hoá đơn lạ / chưa ghi sổ vào lượt', v_loi LIKE 'HOA_DON_KHONG_HOP_LE%', v_loi);

  v_n := public.hoan_tat_luot_soan(v_id);
  SELECT * INTO v FROM luot_soan WHERE id = v_id;
  INSERT INTO kq VALUES (6, 'Hoàn tất: lượt xong, 2 HĐ đánh dấu đã soạn',
    v.trang_thai = 'xong' AND v_n = 2 AND (SELECT count(*) FROM sales_invoices WHERE soan_luc IS NOT NULL) = 2,
    format('tt=%s n=%s', v.trang_thai, v_n));

  BEGIN PERFORM public.cap_nhat_luot_soan(v_id, NULL, '{"c": 1}'::jsonb); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (7, 'Lượt đã xong không ghi tiến độ được nữa', v_loi LIKE 'LUOT_DA_DONG%', v_loi);
END $t$;

-- 8. Không trừ kho. 9. Trình duyệt không ghi thẳng bảng lượt.
DO $t$
DECLARE v_doi bigint; v_n int; v_loi text;
BEGIN
  SELECT count(*) INTO v_doi FROM batches b JOIN ton_truoc t USING (id) WHERE b.qty_on_hand IS DISTINCT FROM t.qty_on_hand;
  INSERT INTO kq VALUES (8, 'Hoàn tất soạn KHÔNG trừ kho', v_doi = 0, 'lô đổi=' || v_doi);
  BEGIN UPDATE luot_soan SET trang_thai = 'dang_soan'; GET DIAGNOSTICS v_n = ROW_COUNT; v_loi := 'n=' || v_n;
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (9, 'Trình duyệt không UPDATE thẳng lượt soạn', v_loi LIKE '%permission denied%', v_loi);
END $t$;
RESET ROLE;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
ROLLBACK;
