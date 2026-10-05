-- KIỂM MIG 232 — NCC: người tạo, đếm chứng từ, CHẶN XOÁ, GỘP (chủ nhà 05/10/2026: "Xem lại phần xóa NCC?" ·
-- "Thêm chức năng gộp NCC"). psql -f, BEGIN … ROLLBACK; in 'ĐẠT'/'LỖI'.
--   NCC A: phiếu nhập nháp, đơn đặt, phiếu trả nháp, phiếu kho nháp, 1 mặt hàng, nợ 300.000 (đã trả 100.000) + nợ
--          đầu kỳ 50.000 → còn nợ 250.000; NV …04 và …05 phụ trách.
--   NCC B: nợ 1.000.000 + nợ đầu kỳ 20.000; NV …04 phụ trách; chưa có SĐT.
--   Gộp A vào B → B còn nợ 1.270.000, A biến mất, không còn gì trỏ vào A.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code, phone, tax_code, notes) VALUES
  ('5f000000-0000-0000-0000-0000000232a1', 'a0000000-0000-0000-0000-000000000001', 'NCC A thử 232', 'T232A', '0909232232', '0312345678', 'Giao thứ 3'),
  ('5f000000-0000-0000-0000-0000000232b1', 'a0000000-0000-0000-0000-000000000001', 'NCC B thử 232', 'T232B', NULL, NULL, NULL),
  ('5f000000-0000-0000-0000-0000000232c1', 'a0000000-0000-0000-0000-000000000001', 'NCC C trống 232', 'T232C', NULL, NULL, NULL),
  ('5f000000-0000-0000-0000-0000000232d1', 'a0000000-0000-0000-0000-000000000001', 'NCC D chỉ có hàng', 'T232D', NULL, NULL, NULL);
INSERT INTO purchase_invoices (org_id, supplier_id, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232a1', 'draft');
INSERT INTO purchase_orders (org_id, po_code, supplier_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'PO-T232', '5f000000-0000-0000-0000-0000000232a1');
INSERT INTO supplier_returns (org_id, supplier_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232a1');
INSERT INTO stock_entries (org_id, entry_code, type, status, supplier_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'PK-T232', 'import', 'draft', '5f000000-0000-0000-0000-0000000232a1');
UPDATE products SET primary_supplier_id = '5f000000-0000-0000-0000-0000000232a1' WHERE id = 'c0000000-0000-0000-0000-000000000001';
UPDATE products SET primary_supplier_id = '5f000000-0000-0000-0000-0000000232d1' WHERE id = 'c0000000-0000-0000-0000-000000000002';
INSERT INTO payables (org_id, supplier_id, amount, paid, status, opening_balance) VALUES
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232a1', 300000, 100000, 'partial', false),
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232a1', 50000, 0, 'open', true),
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232b1', 1000000, 0, 'open', false),
  ('a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000232b1', 20000, 0, 'open', true);
INSERT INTO user_suppliers (user_id, supplier_id, org_id) VALUES
  ('e0000000-0000-0000-0000-000000000004', '5f000000-0000-0000-0000-0000000232a1', 'a0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000005', '5f000000-0000-0000-0000-0000000232a1', 'a0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000004', '5f000000-0000-0000-0000-0000000232b1', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
-- NPP thứ hai + một NCC của nó (thử gộp chéo NPP và xoá cả NPP).
INSERT INTO organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-0000000002b2', 'NPP khác 232', 'npp-khac-232');
INSERT INTO suppliers (id, org_id, name) VALUES ('5f000000-0000-0000-0000-0000000232e1', 'a0000000-0000-0000-0000-0000000002b2', 'NCC NPP khác');
INSERT INTO payables (org_id, supplier_id, amount) VALUES ('a0000000-0000-0000-0000-0000000002b2', '5f000000-0000-0000-0000-0000000232e1', 70000);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$
DECLARE j jsonb; v_loi text; v_nguoi uuid; v_n bigint;
BEGIN
  -- 1. Người tạo do máy chủ ghi; trình duyệt khai người khác / sửa về sau đều không ăn.
  INSERT INTO suppliers (id, org_id, name, created_by)
  VALUES ('5f000000-0000-0000-0000-0000000232f1', 'a0000000-0000-0000-0000-000000000001', 'NCC tạo từ màn', 'e0000000-0000-0000-0000-000000000002');
  UPDATE suppliers SET created_by = 'e0000000-0000-0000-0000-000000000003' WHERE id = '5f000000-0000-0000-0000-0000000232f1';
  SELECT created_by INTO v_nguoi FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232f1';
  INSERT INTO kq VALUES (1, 'Người tạo = người đăng nhập, không khai / sửa được', v_nguoi = 'e0000000-0000-0000-0000-000000000001', coalesce(v_nguoi::text, 'null'));

  -- 2. Đếm chứng từ NCC A.
  j := public.so_chung_tu_ncc('5f000000-0000-0000-0000-0000000232a1');
  INSERT INTO kq VALUES (2, 'Đếm A: 7 (1 phiếu nhập, 1 đơn đặt, 1 phiếu trả, 1 phiếu kho, 1 mặt hàng, 2 dòng nợ), còn nợ 250.000, 2 NV',
    (j->>'tong')::bigint = 7 AND (j->>'con_no')::numeric = 250000 AND (j->>'nhan_vien')::int = 2 AND jsonb_array_length(j->'chi_tiet') = 6
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'chi_tiet') e WHERE e->>'bang' = 'payables' AND (e->>'so')::int = 2 AND e->>'nhan' = 'dòng công nợ NCC'),
    j::text);

  -- 3. Xoá A (có chứng từ) từ trình duyệt → chặn, lỗi tiếng Việt có mã.
  BEGIN DELETE FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232a1'; v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (3, 'Xoá NCC có chứng từ → NCC_CO_CHUNG_TU (kể đủ số phiếu)',
    v_loi LIKE 'NCC_CO_CHUNG_TU:%' AND v_loi LIKE '%1 phiếu nhập%' AND v_loi LIKE '%2 dòng công nợ NCC%', v_loi);

  -- 4. NCC D chỉ gắn mặt hàng (khoá SET NULL) → vẫn chặn, không lặng lẽ gỡ NCC khỏi mặt hàng.
  BEGIN DELETE FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232d1'; v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (4, 'Xoá NCC chỉ gắn mặt hàng → chặn (không SET NULL lặng lẽ)', v_loi LIKE 'NCC_CO_CHUNG_TU:%1 mặt hàng%', v_loi);

  -- 5. NCC C không có gì → xoá được (từ mig 233 trình duyệt không xoá thẳng — đi RPC `xoa_nha_cung_cap`).
  IF to_regprocedure('public.xoa_nha_cung_cap(uuid,boolean)') IS NOT NULL THEN
    PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000232c1', false);
  ELSE
    DELETE FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232c1';
  END IF;
  SELECT count(*) INTO v_n FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232c1';
  INSERT INTO kq VALUES (5, 'NCC chưa có chứng từ → xoá được', v_n = 0, 'còn ' || v_n);

  -- 6. Gộp với chính nó / sang NCC NPP khác → chặn.
  BEGIN PERFORM public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232a1', '5f000000-0000-0000-0000-0000000232a1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (6, 'Gộp NCC vào chính nó → GOP_NCC_TRUNG', v_loi LIKE 'GOP_NCC_TRUNG%', v_loi);
  BEGIN PERFORM public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232a1', '5f000000-0000-0000-0000-0000000232e1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (7, 'Gộp sang NCC của NPP khác → KHONG_TIM_THAY_NCC', v_loi LIKE 'KHONG_TIM_THAY_NCC%', v_loi);
  BEGIN PERFORM public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232e1', '5f000000-0000-0000-0000-0000000232b1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (8, 'Gộp NCC của NPP khác vào NCC mình → KHONG_TIM_THAY_NCC', v_loi LIKE 'KHONG_TIM_THAY_NCC%', v_loi);
  BEGIN PERFORM public.so_chung_tu_ncc('5f000000-0000-0000-0000-0000000232e1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (9, 'Đếm chứng từ NCC của NPP khác → KHONG_TIM_THAY_NCC', v_loi LIKE 'KHONG_TIM_THAY_NCC%', v_loi);
END $t$;

-- 10–11. NVBH / thủ kho không gộp được.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232a1', '5f000000-0000-0000-0000-0000000232b1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (10, 'NVBH không gộp được', v_loi LIKE 'KHONG_DU_QUYEN%', v_loi);
END $t$;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232a1', '5f000000-0000-0000-0000-0000000232b1'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (11, 'Thủ kho không gộp được', v_loi LIKE 'KHONG_DU_QUYEN%', v_loi);
END $t$;

-- 12–17. Kế toán gộp A vào B.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
DO $t$
DECLARE j jsonb; v_con bigint; v_no numeric; v_dk bigint; v_nv bigint; s record; v_tong bigint; v_bys numeric;
BEGIN
  j := public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000232a1', '5f000000-0000-0000-0000-0000000232b1');
  SELECT (SELECT count(*) FROM purchase_invoices WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM purchase_orders WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM supplier_returns WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM stock_entries WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM products WHERE primary_supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM payables WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM user_suppliers WHERE supplier_id = '5f000000-0000-0000-0000-0000000232a1')
       + (SELECT count(*) FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232a1')
    INTO v_con;
  INSERT INTO kq VALUES (12, 'Gộp: không còn gì trỏ vào A, A đã xoá', v_con = 0 AND (j->>'da_xoa')::boolean, j::text);

  SELECT COALESCE(sum(amount - paid), 0) INTO v_no FROM payables
   WHERE supplier_id = '5f000000-0000-0000-0000-0000000232b1' AND status <> 'paid';
  SELECT count(*) INTO v_dk FROM payables WHERE supplier_id = '5f000000-0000-0000-0000-0000000232b1' AND opening_balance;
  INSERT INTO kq VALUES (13, 'Nợ B = 1.000.000 + 20.000 + 200.000 + 50.000 = 1.270.000; còn MỘT dòng đầu kỳ',
    v_no = 1270000 AND v_dk = 1, format('no=%s dau_ky=%s', v_no, v_dk));

  SELECT count(*) INTO v_nv FROM user_suppliers WHERE supplier_id = '5f000000-0000-0000-0000-0000000232b1';
  INSERT INTO kq VALUES (14, 'Phân công NV: B có …04 (không trùng) + …05', v_nv = 2, 'nv=' || v_nv);

  SELECT * INTO s FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232b1';
  INSERT INTO kq VALUES (15, 'Hồ sơ B lấy SĐT / MST còn trống từ A, ghi chú việc gộp + ghi chú cũ',
    s.phone = '0909232232' AND s.tax_code = '0312345678' AND s.notes LIKE '%Gộp từ NCC NCC A thử 232 (T232A)%' AND s.notes LIKE '%Ghi chú NCC cũ: Giao thứ 3%',
    format('phone=%s mst=%s notes=%s', s.phone, s.tax_code, s.notes));

  v_tong := (public.so_chung_tu_ncc('5f000000-0000-0000-0000-0000000232b1')->>'tong')::bigint;
  INSERT INTO kq VALUES (16, 'Chứng từ của B = 2 nợ cũ + 7 của A = 9', v_tong = 9, 'tong=' || v_tong);

  SELECT remaining INTO v_bys FROM public.payables_by_supplier() WHERE supplier_id = '5f000000-0000-0000-0000-0000000232b1';
  INSERT INTO kq VALUES (17, 'Công nợ theo NCC (payables_by_supplier) của B = 1.270.000', v_bys = 1270000, 'remaining=' || v_bys);
END $t$;
RESET ROLE;

-- 18. Xoá cả NPP (organizations CASCADE) không bị trigger chặn xoá NCC cản.
DO $t$
DECLARE v_loi text := 'ok';
BEGIN
  BEGIN DELETE FROM organizations WHERE id = 'a0000000-0000-0000-0000-0000000002b2';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (18, 'Xoá cả NPP (CASCADE) vẫn chạy', v_loi = 'ok' AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000232e1'), v_loi);
END $t$;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
