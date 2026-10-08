-- KIỂM MIG 238 — huỷ phiếu nhập đã xuất bớt khi NPP cho phép tồn kho âm (chủ nhà 08/10/2026: "Hiện tại ko huỷ được
-- phiếu nhập khi đã xuất kho 1 lượng. Trường hợp cho phép tồn kho âm, hành động huỷ phiếu nhập được cho phép").
-- psql -f, BEGIN … ROLLBACK. Nên chạy cả dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-238-huy-phieu-nhap-ton-am.sql
--   Phiếu nhập P: A 2 thùng × 240.000 (48 hộp). Đã xuất 30 hộp (phiếu xuất X). Phiếu Q: B 10 gói, chưa xuất gì.
--   Phiếu R: B 5 gói, đã trả NCC 10.000.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
GRANT ALL ON kq TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000238a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 238', 'T238');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2380000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T238A', 'Hàng A thử 238', 'hộp', 'active'),
  ('c2380000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'T238B', 'Hàng B thử 238', 'gói', 'active');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('c2380000-0000-0000-0000-0000000000a1', 'thùng', 24);
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone) VALUES
  ('d2380000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000238a1', 'draft', '2026-10-01', 'sale'),
  ('d2380000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000238a1', 'draft', '2026-10-01', 'sale'),
  ('d2380000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000238a1', 'draft', '2026-10-01', 'sale');
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2380000-0000-0000-0000-0000000000f1', 'c2380000-0000-0000-0000-0000000000a1', 'thùng', 2, 240000, 24, 480000, 1),
  ('d2380000-0000-0000-0000-0000000000f2', 'c2380000-0000-0000-0000-0000000000b1', 'gói', 10, 5000, 1, 50000, 1),
  ('d2380000-0000-0000-0000-0000000000f3', 'c2380000-0000-0000-0000-0000000000b1', 'gói', 5, 5000, 1, 25000, 1);

-- Hoàn thành ba phiếu (thủ kho, RPC thật).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2380000-0000-0000-0000-0000000000f1') IS NOT NULL AS p,
       public.complete_purchase_invoice('d2380000-0000-0000-0000-0000000000f2') IS NOT NULL AS q,
       public.complete_purchase_invoice('d2380000-0000-0000-0000-0000000000f3') IS NOT NULL AS r;
RESET ROLE;

CREATE TEMP TABLE lo AS
  SELECT pi.id AS phieu, b.id, b.product_id, b.warehouse_zone FROM batches b
  JOIN stock_entry_lines sel ON sel.batch_id = b.id
  JOIN purchase_invoices pi ON pi.stock_entry_id = sel.entry_id
  WHERE pi.id IN ('d2380000-0000-0000-0000-0000000000f1', 'd2380000-0000-0000-0000-0000000000f2', 'd2380000-0000-0000-0000-0000000000f3');
GRANT SELECT ON lo TO authenticated;

-- Xuất 30 hộp từ lô của P (dòng xuất + dấu vết lấy lô, như `post_stock_issue`).
INSERT INTO stock_entries (id, org_id, entry_code, type, status, posted_at, warehouse_zone) VALUES
  ('e2380000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'XK-T238', 'export', 'posted', now(), 'sale');
INSERT INTO stock_entry_lines (id, entry_id, product_id, batch_id, unit_name, quantity, unit_cost, qty_in_base_uom)
SELECT 'f2380000-0000-0000-0000-0000000000e1', 'e2380000-0000-0000-0000-0000000000e1', lo.product_id, lo.id, 'hộp', 30, 10000, 30
FROM lo WHERE lo.phieu = 'd2380000-0000-0000-0000-0000000000f1';
INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
SELECT 'f2380000-0000-0000-0000-0000000000e1', lo.id, 30, 10000 FROM lo WHERE lo.phieu = 'd2380000-0000-0000-0000-0000000000f1';
UPDATE batches SET qty_on_hand = qty_on_hand - 30 WHERE id IN (SELECT id FROM lo WHERE phieu = 'd2380000-0000-0000-0000-0000000000f1');
-- R: đã trả NCC 10.000.
UPDATE payables SET paid = 10000, status = 'partial'
WHERE id = (SELECT payable_id FROM purchase_invoices WHERE id = 'd2380000-0000-0000-0000-0000000000f3');

CREATE TEMP VIEW loP AS SELECT b.* FROM batches b WHERE b.id IN (SELECT id FROM lo WHERE phieu = 'd2380000-0000-0000-0000-0000000000f1');
GRANT SELECT ON loP TO authenticated;
-- Thẻ kho (phiếu đã ghi sổ) và tồn lô của hàng A ở kho bán — phải luôn bằng nhau.
CREATE TEMP VIEW the_kho_a AS
  SELECT COALESCE((SELECT sum(m.signed_qty_in_base_uom) FROM v_stock_movements m
                   WHERE m.org_id = 'a0000000-0000-0000-0000-000000000001' AND m.product_id = 'c2380000-0000-0000-0000-0000000000a1'
                     AND m.warehouse_zone = 'sale' AND m.entry_status = 'posted'), 0) AS the_kho,
         COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
                   WHERE b.org_id = 'a0000000-0000-0000-0000-000000000001' AND b.product_id = 'c2380000-0000-0000-0000-0000000000a1'
                     AND b.warehouse_zone = 'sale'), 0) AS ton_lo;
GRANT SELECT ON the_kho_a TO authenticated;

-- 1. Chưa cho phép tồn âm: vẫn chặn HANG_DA_XUAT, câu báo chỉ đường gỡ.
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.cancel_purchase_invoice('d2380000-0000-0000-0000-0000000000f1', 'thử'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (1, 'Chưa cho phép tồn âm: huỷ phiếu đã xuất bớt vẫn bị chặn, câu báo chỉ cách bật tồn âm',
    v_loi LIKE 'HANG_DA_XUAT:%' AND v_loi LIKE '%Cho phép bán vượt tồn kho%'
    AND (SELECT status FROM purchase_invoices WHERE id = 'd2380000-0000-0000-0000-0000000000f1') = 'completed', v_loi);
END $t$;
RESET ROLE;

-- 2. Cho phép tồn âm: huỷ được — phiếu Đã huỷ, lô −30 (đã đóng), công nợ xoá, phiếu kho huỷ.
UPDATE organizations SET allow_oversell = true WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.cancel_purchase_invoice('d2380000-0000-0000-0000-0000000000f1', 'thử'); v_loi := 'được';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (2, 'Cho phép tồn âm: huỷ được phiếu đã xuất 30/48 — lô về −30 và đóng, công nợ xoá, phiếu kho huỷ',
    v_loi = 'được'
    AND (SELECT status FROM purchase_invoices WHERE id = 'd2380000-0000-0000-0000-0000000000f1') = 'cancelled'
    AND (SELECT payable_id FROM purchase_invoices WHERE id = 'd2380000-0000-0000-0000-0000000000f1') IS NULL
    AND (SELECT qty_on_hand FROM loP) = -30 AND (SELECT status FROM loP) = 'cancelled'
    AND (SELECT se.status FROM stock_entries se JOIN purchase_invoices pi ON pi.stock_entry_id = se.id
         WHERE pi.id = 'd2380000-0000-0000-0000-0000000000f1') = 'cancelled',
    v_loi || ' · lô ' || (SELECT qty_on_hand FROM loP)::text);
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 3, 'Thẻ kho = tồn lô sau khi huỷ (−30 = −30)', the_kho = ton_lo AND ton_lo = -30,
  the_kho::text || ' / ' || ton_lo::text FROM the_kho_a;
INSERT INTO kq SELECT 4, 'Giá vốn hàng đã bán giữ nguyên (dấu vết lấy lô 10.000)',
  (SELECT unit_cost FROM stock_line_consumptions WHERE line_id = 'f2380000-0000-0000-0000-0000000000e1') = 10000, NULL;
INSERT INTO kq SELECT 5, 'Màn tồn kho không hiện lô âm (chỉ cộng lô dương)',
  NOT EXISTS (SELECT 1 FROM v_stock_balance_by_zone WHERE product_id = 'c2380000-0000-0000-0000-0000000000a1'), NULL;

-- 6. Huỷ phiếu xuất về sau: hàng cộng trả vào lô → lô về 0, thẻ kho vẫn khớp.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_stock_entry('e2380000-0000-0000-0000-0000000000e1', 'thử 238') IS NOT NULL AS huy_xuat;
RESET ROLE;
INSERT INTO kq SELECT 6, 'Huỷ phiếu xuất sau đó: lô về 0, thẻ kho = tồn lô = 0',
  (SELECT qty_on_hand FROM loP) = 0 AND the_kho = ton_lo AND ton_lo = 0,
  'lô ' || (SELECT qty_on_hand FROM loP)::text || ' · ' || the_kho::text || ' / ' || ton_lo::text FROM the_kho_a;

-- 7. Phiếu chưa xuất gì: huỷ như cũ, lô về 0.  8. Đã trả tiền NCC: vẫn chặn DA_TRA_TIEN dù cho phép tồn âm.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
DECLARE v_loi text;
BEGIN
  PERFORM public.cancel_purchase_invoice('d2380000-0000-0000-0000-0000000000f2', 'thử');
  INSERT INTO kq VALUES (7, 'Phiếu chưa xuất gì: huỷ như cũ — lô về 0, đóng',
    (SELECT b.qty_on_hand FROM batches b JOIN lo ON lo.id = b.id WHERE lo.phieu = 'd2380000-0000-0000-0000-0000000000f2') = 0
    AND (SELECT b.status FROM batches b JOIN lo ON lo.id = b.id WHERE lo.phieu = 'd2380000-0000-0000-0000-0000000000f2') = 'cancelled', NULL);
  BEGIN PERFORM public.cancel_purchase_invoice('d2380000-0000-0000-0000-0000000000f3', 'thử'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (8, 'Đã trả tiền NCC: vẫn chặn DA_TRA_TIEN dù cho phép tồn âm', v_loi LIKE 'DA_TRA_TIEN:%', v_loi);
END $t$;
-- 9. NV bán hàng không huỷ được (cổng vai mig 166 giữ nguyên).
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
DECLARE v_loi text;
BEGIN
  BEGIN PERFORM public.cancel_purchase_invoice('d2380000-0000-0000-0000-0000000000f3', 'thử'); v_loi := 'không chặn';
  EXCEPTION WHEN OTHERS THEN v_loi := SQLERRM; END;
  INSERT INTO kq VALUES (9, 'NV bán hàng huỷ phiếu nhập → FORBIDDEN', v_loi LIKE 'FORBIDDEN:%', v_loi);
END $t$;
RESET ROLE;

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
