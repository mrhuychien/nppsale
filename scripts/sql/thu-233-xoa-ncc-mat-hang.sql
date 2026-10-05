-- KIỂM MIG 233 — XOÁ NCC QUA RPC (chủ nhà 05/10/2026: "Hỏi lại có muốn xoá mặt hàng kèm ncc không? Nếu có xoá luôn
-- cả mặt hàng. Nếu mặt hàng có trong các phiếu -> đổi về ngừng bán." · "Chỉ NPP được xoá"). psql -f, BEGIN … ROLLBACK.
--   NCC H (chỉ có hàng): X chưa dùng (có đơn vị + bảng giá), Y nằm trong phiếu nhập của NCC khác, Z còn lô tồn 5.
--   NCC K (chỉ có hàng): W chưa dùng.   NCC P: có phiếu nhập nháp + mặt hàng V.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000233a1', 'a0000000-0000-0000-0000-000000000001', 'NCC H thử 233', 'T233H'),
  ('5f000000-0000-0000-0000-0000000233b1', 'a0000000-0000-0000-0000-000000000001', 'NCC K thử 233', 'T233K'),
  ('5f000000-0000-0000-0000-0000000233c1', 'a0000000-0000-0000-0000-000000000001', 'NCC P thử 233', 'T233P'),
  ('5f000000-0000-0000-0000-0000000233d1', 'a0000000-0000-0000-0000-000000000001', 'NCC khác thử 233', 'T233O');
INSERT INTO products (id, org_id, sku, name, base_unit, status, primary_supplier_id) VALUES
  ('c2330000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T233X', 'Hàng X chưa dùng', 'hộp', 'active', '5f000000-0000-0000-0000-0000000233a1'),
  ('c2330000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'T233Y', 'Hàng Y trong phiếu', 'hộp', 'active', '5f000000-0000-0000-0000-0000000233a1'),
  ('c2330000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'T233Z', 'Hàng Z còn tồn', 'hộp', 'active', '5f000000-0000-0000-0000-0000000233a1'),
  ('c2330000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'T233W', 'Hàng W', 'hộp', 'active', '5f000000-0000-0000-0000-0000000233b1'),
  ('c2330000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'T233V', 'Hàng V', 'hộp', 'active', '5f000000-0000-0000-0000-0000000233c1');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('c2330000-0000-0000-0000-0000000000a1', 'thùng', 24);
INSERT INTO price_lists (product_id, unit_name, price) VALUES ('c2330000-0000-0000-0000-0000000000a1', 'hộp', 10000);
INSERT INTO batches (org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'c2330000-0000-0000-0000-0000000000a3', 'L233', '2027-12-31', 5, 5);
INSERT INTO purchase_invoices (id, org_id, supplier_id, status) VALUES
  ('d2330000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000233d1', 'draft'),
  ('d2330000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000233c1', 'draft');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price) VALUES
  ('d2330000-0000-0000-0000-0000000000b1', 'c2330000-0000-0000-0000-0000000000a2', 'hộp', 1, 1000);

SET LOCAL ROLE authenticated;

-- 1–3. Quản lý / thủ kho / kế toán không xoá được (kể cả qua RPC); thủ kho xoá thẳng cũng không được.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233b1', false); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'Quản lý gọi RPC xoá NCC → KHONG_DU_QUYEN_XOA_NCC', v_loi LIKE 'KHONG_DU_QUYEN_XOA_NCC%', v_loi);
END $t$;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text; v_n bigint;
BEGIN
  BEGIN PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233b1', false); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (2, 'Thủ kho gọi RPC xoá NCC → KHONG_DU_QUYEN_XOA_NCC', v_loi LIKE 'KHONG_DU_QUYEN_XOA_NCC%', v_loi);
  -- NCC trống (chưa có gì) — RLS cho thủ kho xoá, trigger chặn đường thẳng từ trình duyệt.
  INSERT INTO suppliers (id, org_id, name) VALUES ('5f000000-0000-0000-0000-0000000233e1', 'a0000000-0000-0000-0000-000000000001', 'NCC trống 233');
  BEGIN DELETE FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233e1'; v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  SELECT count(*) INTO v_n FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233e1';
  INSERT INTO kq VALUES (3, 'Trình duyệt xoá thẳng NCC trống → NCC_XOA_QUA_RPC, NCC còn nguyên', v_loi LIKE 'NCC_XOA_QUA_RPC%' AND v_n = 1, v_loi);
END $t$;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233b1', false); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (4, 'Kế toán gọi RPC xoá NCC → KHONG_DU_QUYEN_XOA_NCC', v_loi LIKE 'KHONG_DU_QUYEN_XOA_NCC%', v_loi);
END $t$;

-- 5–11. Chủ NPP.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
DO $t$
DECLARE j jsonb; v_loi text; v_n bigint; v_st text; v_ncc uuid;
BEGIN
  -- 5. NCC P có phiếu nhập → từ chối, mặt hàng V không bị đụng.
  BEGIN PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233c1', true); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  SELECT status, primary_supplier_id INTO v_st, v_ncc FROM products WHERE id = 'c2330000-0000-0000-0000-0000000000a5';
  INSERT INTO kq VALUES (5, 'NCC có phiếu nhập → NCC_CO_CHUNG_TU (kể phiếu nhập, không kể mặt hàng); hàng V giữ nguyên',
    v_loi LIKE 'NCC_CO_CHUNG_TU:%1 phiếu nhập%' AND v_loi NOT LIKE '%mặt hàng%'
      AND v_st = 'active' AND v_ncc = '5f000000-0000-0000-0000-0000000233c1'
      AND EXISTS (SELECT 1 FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233c1'),
    v_loi);

  -- 6. NCC NPP khác / không có → KHONG_TIM_THAY_NCC.
  BEGIN PERFORM public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233ff', true); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (6, 'NCC không có → KHONG_TIM_THAY_NCC', v_loi LIKE 'KHONG_TIM_THAY_NCC%', v_loi);

  -- 7–10. Xoá NCC H kèm mặt hàng.
  j := public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233a1', true);
  INSERT INTO kq VALUES (7, 'Kết quả: xoá 1 (X), ngừng bán 2 (Y trong phiếu, Z còn tồn), gỡ 0',
    (j->>'mat_hang_da_xoa')::int = 1 AND (j->>'mat_hang_ngung_ban')::int = 2 AND (j->>'mat_hang_go')::int = 0 AND j->>'ten' = 'NCC H thử 233',
    j::text);
  SELECT (SELECT count(*) FROM products WHERE id = 'c2330000-0000-0000-0000-0000000000a1')
       + (SELECT count(*) FROM product_units WHERE product_id = 'c2330000-0000-0000-0000-0000000000a1')
       + (SELECT count(*) FROM price_lists WHERE product_id = 'c2330000-0000-0000-0000-0000000000a1') INTO v_n;
  INSERT INTO kq VALUES (8, 'Hàng X chưa dùng: xoá hẳn (đơn vị + bảng giá đi theo)', v_n = 0, 'còn ' || v_n);
  SELECT count(*) INTO v_n FROM products
   WHERE id IN ('c2330000-0000-0000-0000-0000000000a2', 'c2330000-0000-0000-0000-0000000000a3')
     AND status = 'inactive' AND primary_supplier_id IS NULL;
  INSERT INTO kq VALUES (9, 'Hàng Y (trong phiếu nhập) và Z (lô còn tồn): Ngừng bán + gỡ NCC; dòng phiếu / lô còn nguyên',
    v_n = 2
      AND EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE product_id = 'c2330000-0000-0000-0000-0000000000a2')
      AND EXISTS (SELECT 1 FROM batches WHERE product_id = 'c2330000-0000-0000-0000-0000000000a3' AND qty_on_hand = 5),
    'n=' || v_n);
  INSERT INTO kq VALUES (10, 'NCC H đã xoá', NOT EXISTS (SELECT 1 FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233a1'), '');

  -- 11. Xoá NCC K, giữ mặt hàng.
  j := public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233b1', false);
  SELECT status, primary_supplier_id INTO v_st, v_ncc FROM products WHERE id = 'c2330000-0000-0000-0000-0000000000a4';
  INSERT INTO kq VALUES (11, 'Không xoá hàng: W còn, vẫn Đang bán, gỡ khỏi NCC; NCC K đã xoá',
    (j->>'mat_hang_go')::int = 1 AND (j->>'mat_hang_da_xoa')::int = 0 AND v_st = 'active' AND v_ncc IS NULL
      AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233b1'),
    j::text);

  -- 12. NCC trống: chủ xoá qua RPC được.
  j := public.xoa_nha_cung_cap('5f000000-0000-0000-0000-0000000233e1', false);
  INSERT INTO kq VALUES (12, 'NCC trống: Chủ NPP xoá qua RPC được',
    NOT EXISTS (SELECT 1 FROM suppliers WHERE id = '5f000000-0000-0000-0000-0000000233e1'), j::text);

  -- 13. Gộp NCC (definer) vẫn xoá được NCC bị gộp — trigger chỉ chặn đường thẳng từ trình duyệt.
  INSERT INTO suppliers (id, org_id, name) VALUES ('5f000000-0000-0000-0000-0000000233f1', 'a0000000-0000-0000-0000-000000000001', 'NCC gộp 233');
  j := public.gop_nha_cung_cap('5f000000-0000-0000-0000-0000000233f1', '5f000000-0000-0000-0000-0000000233d1');
  INSERT INTO kq VALUES (13, 'Gộp NCC vẫn xoá được NCC bị gộp', (j->>'da_xoa')::boolean, j::text);
END $t$;
RESET ROLE;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
