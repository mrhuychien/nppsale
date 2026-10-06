-- KIỂM MIG 234 — BẢNG GIÁ NHẬP (chủ nhà 06/10/2026: "lưu giá nhập load lại khi làm đơn, nếu giá có thay đổi thì tự
-- cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)"). psql -f, BEGIN … ROLLBACK.
--   Mặt hàng A (hộp, thùng ×24). Phiếu P1 ngày 01/10: A hộp 10.000, A thùng 230.000, A hộp tặng 0đ.
--   Phiếu P2 ngày 05/10: A hộp 11.000. Phiếu P0 ngày 20/09 (cũ hơn): A hộp 9.000.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000234a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 234', 'T234');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2340000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T234A', 'Hàng A thử 234', 'hộp', 'active');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('c2340000-0000-0000-0000-0000000000a1', 'thùng', 24);
-- NPP khác + mặt hàng của nó (kiểm không ghi chéo NPP).
INSERT INTO organizations (id, name, slug) VALUES ('a2340000-0000-0000-0000-0000000000f1', 'NPP khác thử 234', 'npp-khac-thu-234');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2340000-0000-0000-0000-0000000000f1', 'a2340000-0000-0000-0000-0000000000f1', 'T234F', 'Hàng NPP khác', 'hộp', 'active');
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date) VALUES
  ('d2340000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000234a1', 'draft', '2026-10-01'),
  ('d2340000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000234a1', 'draft', '2026-10-05'),
  ('d2340000-0000-0000-0000-0000000000b0', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000234a1', 'draft', '2026-09-20');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, sort_order) VALUES
  ('d2340000-0000-0000-0000-0000000000b1', 'c2340000-0000-0000-0000-0000000000a1', 'hộp', 10, 10000, 0),
  ('d2340000-0000-0000-0000-0000000000b1', 'c2340000-0000-0000-0000-0000000000a1', 'thùng', 2, 230000, 1),
  ('d2340000-0000-0000-0000-0000000000b1', 'c2340000-0000-0000-0000-0000000000a1', 'hộp', 1, 0, 2),
  ('d2340000-0000-0000-0000-0000000000b2', 'c2340000-0000-0000-0000-0000000000a1', 'hộp', 5, 11000, 0),
  ('d2340000-0000-0000-0000-0000000000b0', 'c2340000-0000-0000-0000-0000000000a1', 'hộp', 5, 9000, 0);

CREATE TEMP VIEW gia AS
  SELECT unit_name, price, effective_date, source_invoice_id FROM purchase_price_lists
  WHERE product_id = 'c2340000-0000-0000-0000-0000000000a1';
GRANT SELECT ON gia TO authenticated;

-- 1. Phiếu nháp chưa ghi giá.
INSERT INTO kq SELECT 1, 'Phiếu nháp: chưa có giá nhập', NOT EXISTS (SELECT 1 FROM gia), NULL;

-- 2. P1 hoàn thành → hộp 10.000 (dòng tặng 0đ không đè), thùng 230.000 (giá thùng riêng).
UPDATE purchase_invoices SET status = 'completed' WHERE id = 'd2340000-0000-0000-0000-0000000000b1';
INSERT INTO kq SELECT 2, 'P1 hoàn thành: hộp 10.000 (bỏ dòng tặng 0đ), thùng 230.000, ngày 01/10, nguồn P1',
  (SELECT price FROM gia WHERE unit_name = 'hộp') = 10000
  AND (SELECT price FROM gia WHERE unit_name = 'thùng') = 230000
  AND (SELECT effective_date FROM gia WHERE unit_name = 'hộp') = '2026-10-01'
  AND (SELECT source_invoice_id FROM gia WHERE unit_name = 'hộp') = 'd2340000-0000-0000-0000-0000000000b1',
  (SELECT string_agg(unit_name || '=' || price, ', ') FROM gia);

-- 3. P2 (mới hơn) giá đổi → tự cập nhật hộp 11.000; thùng giữ.
UPDATE purchase_invoices SET status = 'completed' WHERE id = 'd2340000-0000-0000-0000-0000000000b2';
INSERT INTO kq SELECT 3, 'P2 ngày 05/10 giá đổi → hộp tự lên 11.000, thùng giữ 230.000',
  (SELECT price FROM gia WHERE unit_name = 'hộp') = 11000 AND (SELECT price FROM gia WHERE unit_name = 'thùng') = 230000,
  (SELECT string_agg(unit_name || '=' || price, ', ') FROM gia);

-- 4. P0 (ngày cũ hơn) hoàn thành sau → KHÔNG kéo giá về 9.000.
UPDATE purchase_invoices SET status = 'completed' WHERE id = 'd2340000-0000-0000-0000-0000000000b0';
INSERT INTO kq SELECT 4, 'Phiếu ngày cũ hơn hoàn thành sau: không đè giá mới',
  (SELECT price FROM gia WHERE unit_name = 'hộp') = 11000, (SELECT price::text FROM gia WHERE unit_name = 'hộp');

-- 5. Sửa phiếu P2 (huỷ → sửa giá → hoàn thành lại) → giá theo phiếu sửa.
UPDATE purchase_invoices SET status = 'cancelled' WHERE id = 'd2340000-0000-0000-0000-0000000000b2';
UPDATE purchase_invoice_lines SET unit_price = 11500 WHERE invoice_id = 'd2340000-0000-0000-0000-0000000000b2';
UPDATE purchase_invoices SET status = 'completed' WHERE id = 'd2340000-0000-0000-0000-0000000000b2';
INSERT INTO kq SELECT 5, 'Sửa phiếu (huỷ → hoàn thành lại giá 11.500) → bảng giá 11.500',
  (SELECT price FROM gia WHERE unit_name = 'hộp') = 11500, (SELECT price::text FROM gia WHERE unit_name = 'hộp');

-- 6. Đổi thứ không phải trạng thái trên phiếu đã hoàn thành → không ghi lại.
UPDATE purchase_price_lists SET price = 1 WHERE product_id = 'c2340000-0000-0000-0000-0000000000a1' AND unit_name = 'thùng';
UPDATE purchase_invoices SET notes = 'ghi chú' WHERE id = 'd2340000-0000-0000-0000-0000000000b1';
INSERT INTO kq SELECT 6, 'Sửa ghi chú phiếu đã hoàn thành không ghi lại giá', (SELECT price FROM gia WHERE unit_name = 'thùng') = 1, NULL;
UPDATE purchase_price_lists SET price = 230000 WHERE product_id = 'c2340000-0000-0000-0000-0000000000a1' AND unit_name = 'thùng';

SET LOCAL ROLE authenticated;

-- 7. Nhân viên bán hàng: không đọc được giá nhập (giá vốn), không gọi được RPC.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM purchase_price_lists WHERE product_id = 'c2340000-0000-0000-0000-0000000000a1';
  BEGIN PERFORM public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"hộp","price":1}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (7, 'NV bán hàng: không thấy giá nhập, RPC → KHONG_DU_QUYEN_GIA_NHAP',
    v_n = 0 AND v_loi LIKE 'KHONG_DU_QUYEN_GIA_NHAP%', v_n || ' dòng · ' || v_loi);
END $t$;

-- 8. Thủ kho: đọc được; ghi thẳng bị chặn (không có chính sách ghi).
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text; v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM purchase_price_lists WHERE product_id = 'c2340000-0000-0000-0000-0000000000a1';
  BEGIN
    INSERT INTO purchase_price_lists (org_id, product_id, unit_name, price)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'c2340000-0000-0000-0000-0000000000a1', 'lốc', 1);
    v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (8, 'Thủ kho đọc được 2 giá; ghi thẳng bảng bị chặn', v_n = 2 AND v_loi <> 'không chặn', v_n || ' · ' || v_loi);
END $t$;

-- 9–12. Kế toán sửa tay qua RPC.
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
DO $t$
DECLARE v_loi text; j jsonb;
BEGIN
  j := public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"thùng","price":240000}]');
  INSERT INTO kq VALUES (9, 'Kế toán sửa tay thùng 240.000: lưu, ngày áp dụng = hôm nay, bỏ nguồn phiếu',
    (SELECT price FROM gia WHERE unit_name = 'thùng') = 240000
    AND (SELECT effective_date FROM gia WHERE unit_name = 'thùng') = public._hom_nay_vn()
    AND (SELECT source_invoice_id FROM gia WHERE unit_name = 'thùng') IS NULL, j::text);

  BEGIN PERFORM public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"lốc","price":1}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (10, 'Đơn vị chưa khai cho mặt hàng → GIA_NHAP_SAI', v_loi LIKE 'GIA_NHAP_SAI%', v_loi);

  BEGIN PERFORM public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"hộp","price":-5}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (11, 'Giá âm → GIA_NHAP_AM', v_loi LIKE 'GIA_NHAP_AM%', v_loi);

  j := public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"thùng","price":null}]');
  INSERT INTO kq VALUES (12, 'Giá rỗng = bỏ giá của đơn vị đó', NOT EXISTS (SELECT 1 FROM gia WHERE unit_name = 'thùng'), j::text);
END $t$;

-- 13. Mặt hàng của NPP khác → GIA_NHAP_SAI (không ghi chéo NPP).
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000f1","unit_name":"hộp","price":1}]'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (13, 'Mặt hàng NPP khác → GIA_NHAP_SAI', v_loi LIKE 'GIA_NHAP_SAI%', v_loi);
END $t$;
RESET ROLE;

-- 14. Phiếu nhập ngày trước hôm nay hoàn thành sau khi sửa tay → không đè giá sửa tay.
DO $t$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
  UPDATE purchase_invoices SET status = 'cancelled' WHERE id = 'd2340000-0000-0000-0000-0000000000b2';
  SET LOCAL ROLE authenticated;
  PERFORM public.luu_gia_nhap('[{"product_id":"c2340000-0000-0000-0000-0000000000a1","unit_name":"hộp","price":12000}]');
  RESET ROLE;
  UPDATE purchase_invoices SET status = 'completed' WHERE id = 'd2340000-0000-0000-0000-0000000000b2';
  INSERT INTO kq VALUES (14, 'Sửa tay hôm nay 12.000, phiếu 05/10 hoàn thành lại sau → giữ 12.000',
    (SELECT price FROM gia WHERE unit_name = 'hộp') = 12000, (SELECT price::text FROM gia WHERE unit_name = 'hộp'));
END $t$;

-- 16. Đường thật: Thủ kho bấm Hoàn thành (`complete_purchase_invoice`) → giá vào bảng.
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone) VALUES
  ('d2340000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000234a1', 'draft', public._hom_nay_vn(), 'sale');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2340000-0000-0000-0000-0000000000b9', 'c2340000-0000-0000-0000-0000000000a1', 'thùng', 1, 250000, 24, 250000, 0);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2340000-0000-0000-0000-0000000000b9') IS NOT NULL AS da_hoan_thanh;
RESET ROLE;
INSERT INTO kq SELECT 16, 'Hoàn thành qua RPC thật (Thủ kho) → thùng 250.000 theo phiếu',
  (SELECT price FROM gia WHERE unit_name = 'thùng') = 250000
  AND (SELECT source_invoice_id FROM gia WHERE unit_name = 'thùng') = 'd2340000-0000-0000-0000-0000000000b9',
  (SELECT string_agg(unit_name || '=' || price, ', ') FROM gia);

-- 15. Xoá mặt hàng → giá nhập đi theo (CASCADE) — `_mat_hang_co_chung_tu` (mig 233) coi là dữ liệu của mặt hàng.
INSERT INTO kq SELECT 15, 'Khoá ngoại bảng giá nhập là CASCADE (không chặn xoá mặt hàng chưa dùng)',
  EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.purchase_price_lists'::regclass
          AND k.confrelid = 'public.products'::regclass AND k.confdeltype = 'c'), NULL;

SELECT buoc, ten, CASE WHEN ok THEN 'ĐẠT' ELSE 'LỖI' END AS kq, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
