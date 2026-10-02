-- KIỂM MIG 223 (chủ nhà 02/10/2026: "khi nghỉ bàn giao khách hàng và công nợ về npp. Npp sẽ phân phối lại sau").
-- NVBH Dung (…04) có 3 HĐ đã ghi sổ, nợ mở. Cho nghỉ → nợ về NPP, khách / lịch tuyến gỡ, tính lại công nợ
-- không kéo về người cũ, doanh số (HĐ) vẫn của Dung; NPP phân lại cho kế toán thử (…03 không phải sales vẫn
-- nhận được — chỉ để thử). psql -f; in 'ĐẠT'/'LỖI'.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;
-- Làm sạch phân công cũ của Dung trong dữ liệu thử để đếm chắc.
DELETE FROM customer_assignments WHERE user_id = 'e0000000-0000-0000-0000-000000000004';
DELETE FROM pjp_routes WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004';

-- Dựng: Dung phụ trách 1 khách + 1 lịch tuyến (quyền chủ DB).
INSERT INTO customer_assignments (customer_id, user_id, role)
SELECT si.customer_id, 'e0000000-0000-0000-0000-000000000004', 'primary'
FROM sales_invoices si WHERE si.id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19';
INSERT INTO pjp_routes (org_id, sales_user_id, day_of_week, customer_id)
SELECT si.org_id, 'e0000000-0000-0000-0000-000000000004', 1, si.customer_id
FROM sales_invoices si WHERE si.id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19';

SET LOCAL ROLE authenticated;
-- 1. NVBH không gọi được.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000005'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'NVBH không cho người khác nghỉ được', v_loi LIKE 'KHONG_DU_QUYEN%', v_loi);
END $t$;

SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$
DECLARE j jsonb; v_loi text; v_n bigint; v_hd bigint; v_ca bigint; v_pjp bigint; v_act boolean;
BEGIN
  j := public.so_chung_tu_nhan_vien('e0000000-0000-0000-0000-000000000004');
  INSERT INTO kq VALUES (2, 'Đếm: Dung có chứng từ (chặn xoá), 1 khách, 1 lịch tuyến, 3 khoản nợ',
    (j->>'tong')::bigint > 0 AND (j->>'khach')::int = 1 AND (j->>'lich_tuyen')::int = 1 AND (j->>'so_khoan_no')::int = 3,
    j::text);

  BEGIN PERFORM public.cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000001'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (3, 'Không tự cho mình nghỉ', v_loi LIKE 'TU_NGHI%', v_loi);

  j := public.cho_nhan_vien_nghi('e0000000-0000-0000-0000-000000000004');
  SELECT count(*) INTO v_n FROM receivables WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004' AND status <> 'paid';
  SELECT count(*) INTO v_hd FROM sales_invoices WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004';
  SELECT count(*) INTO v_ca FROM customer_assignments WHERE user_id = 'e0000000-0000-0000-0000-000000000004';
  SELECT count(*) INTO v_pjp FROM pjp_routes WHERE sales_user_id = 'e0000000-0000-0000-0000-000000000004';
  SELECT is_active INTO v_act FROM users WHERE id = 'e0000000-0000-0000-0000-000000000004';
  INSERT INTO kq VALUES (4, 'Nghỉ: nợ mở về NPP (0 còn tên Dung), HĐ vẫn của Dung, khách + tuyến gỡ, khoá đăng nhập',
    v_n = 0 AND v_hd = 3 AND v_ca = 0 AND v_pjp = 0 AND v_act = false AND (j->>'so_khoan_no')::int = 3 AND (j->>'khach')::int = 1,
    format('nợ còn=%s hd=%s ca=%s pjp=%s active=%s %s', v_n, v_hd, v_ca, v_pjp, v_act, j));
END $t$;
RESET ROLE;

-- 5. Tính lại công nợ (luồng HĐ — mig 194 cho nợ đi theo HĐ) không kéo nợ về người đã nghỉ.
DO $t$
DECLARE v_nv uuid; v_co timestamptz;
BEGIN
  PERFORM public._wf2b_recompute_receivable('6fb59f22-a8dd-4af7-b064-6b9acb46cb19');
  SELECT sales_user_id, ve_npp_luc INTO v_nv, v_co FROM receivables WHERE invoice_id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19';
  INSERT INTO kq VALUES (5, 'Tính lại nợ HĐ của người đã nghỉ → vẫn NPP giữ', v_nv IS NULL AND v_co IS NOT NULL,
    format('nv=%s cờ=%s', v_nv, v_co));
END $t$;

-- 5b. Đổi người trên HĐ (người còn làm) cũng không tự kéo nợ đã về NPP — chỉ RPC phân lại mới đổi.
DO $t$
DECLARE v_nv uuid;
BEGIN
  UPDATE sales_invoices SET sales_user_id = 'e0000000-0000-0000-0000-000000000002' WHERE id = '1cab0591-77a9-41df-8eba-6a1342b76401';
  SELECT sales_user_id INTO v_nv FROM receivables WHERE invoice_id = '1cab0591-77a9-41df-8eba-6a1342b76401';
  INSERT INTO kq VALUES (55, 'Nợ đã về NPP: đổi người trên HĐ không kéo nợ đi', v_nv IS NULL, format('nv=%s', v_nv));
END $t$;

-- 6. NPP phân lại nợ của khách cho kế toán Cường (…03); tính lại sau đó giữ Cường, không về Dung.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$
DECLARE j jsonb; v_loi text;
BEGIN
  BEGIN PERFORM public.giao_cong_no_npp((SELECT customer_id FROM sales_invoices WHERE id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19'),
                                        'e0000000-0000-0000-0000-000000000004'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (6, 'Không giao nợ lại cho người đã nghỉ', v_loi LIKE 'NV_KHONG_HOP_LE%', v_loi);
  j := public.giao_cong_no_npp((SELECT customer_id FROM sales_invoices WHERE id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19'),
                               'e0000000-0000-0000-0000-000000000003');
  INSERT INTO kq VALUES (7, 'NPP phân lại nợ của khách cho NV mới', (j->>'so_khoan_no')::int >= 1, j::text);
END $t$;
RESET ROLE;
DO $t$
DECLARE v_nv uuid; v_co timestamptz;
BEGIN
  PERFORM public._wf2b_recompute_receivable('6fb59f22-a8dd-4af7-b064-6b9acb46cb19');
  SELECT sales_user_id, ve_npp_luc INTO v_nv, v_co FROM receivables WHERE invoice_id = '6fb59f22-a8dd-4af7-b064-6b9acb46cb19';
  INSERT INTO kq VALUES (8, 'Sau khi phân lại: tính lại nợ theo HĐ (HĐ vẫn tên Dung) → giữ NV được giao, không về NPP / Dung',
    v_nv = 'e0000000-0000-0000-0000-000000000003' AND v_co IS NULL, format('nv=%s cờ=%s', v_nv, v_co));
END $t$;

SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
ROLLBACK;
