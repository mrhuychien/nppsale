-- KIỂM MIG 241 — khôi phục phiếu nhập hàng / phiếu trả NCC đã huỷ (chủ nhà 09/10/2026: "Phiếu nhập hàng, phiếu trả NCC
-- hủy xong phải có đường khôi phục").
-- psql -f, BEGIN … ROLLBACK. Chạy dưới safeupdate (như API thật):
--   PGOPTIONS="-c session_preload_libraries=safeupdate" psql -h /tmp/pgtest -p 55432 -U postgres -d npp_tong \
--     -f scripts/sql/thu-241-khoi-phuc-phieu-ncc.sql
--   P: A 2 thùng × 240.000 (48 hộp), đã xuất 30 hộp rồi huỷ (cho phép tồn âm) → lô −30.   Q: phiếu tạm B 10 gói.
--   R: B 5 gói — luồng sửa CŨ (huỷ → về tạm, sửa thành 7 gói) rồi huỷ phiếu tạm.   T: phiếu kho lệch (còn ghi sổ).
--   K: B 20 gói vào kho bán — nguồn hàng cho phiếu trả NCC S1 (6 gói), S2 (10 gói), S3 (nháp).
-- ⚠ RPC gọi dưới vai THỦ KHO (người khôi phục thật); phần KIỂM chạy dưới vai postgres — thủ kho không đọc được
--   `payables` (RLS "Financial roles view payables"), kiểm dưới vai ấy là bước nào đụng công nợ cũng ra SAI giả.
\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO authenticated;
BEGIN;
CREATE TEMP TABLE kq (buoc int, ten text, ok boolean, ghi text) ON COMMIT DROP;
-- Kết quả / lỗi của từng lượt gọi RPC (ghi dưới vai thủ kho, kiểm dưới vai postgres).
CREATE TEMP TABLE rpc (buoc text PRIMARY KEY, v jsonb, loi text) ON COMMIT DROP;
CREATE TEMP TABLE ghi_nho (k text PRIMARY KEY, gt text) ON COMMIT DROP;
GRANT ALL ON kq, rpc, ghi_nho TO authenticated;

INSERT INTO suppliers (id, org_id, name, code) VALUES
  ('5f000000-0000-0000-0000-0000000241a1', 'a0000000-0000-0000-0000-000000000001', 'NCC thử 241', 'T241');
INSERT INTO products (id, org_id, sku, name, base_unit, status) VALUES
  ('c2410000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'T241A', 'Hàng A thử 241', 'hộp', 'active'),
  ('c2410000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-000000000001', 'T241B', 'Hàng B thử 241', 'gói', 'active');
INSERT INTO product_units (product_id, unit_name, conversion) VALUES ('c2410000-0000-0000-0000-0000000000a1', 'thùng', 24);
INSERT INTO purchase_invoices (id, org_id, supplier_id, status, invoice_date, warehouse_zone, invoice_number) VALUES
  ('d2410000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', '2026-10-01', 'sale', 'HD-P241'),
  ('d2410000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', '2026-10-01', 'sale', NULL),
  ('d2410000-0000-0000-0000-0000000000f3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', '2026-10-01', 'sale', NULL),
  ('d2410000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', '2026-10-01', 'sale', NULL),
  ('d2410000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', '2026-10-01', 'sale', NULL);
INSERT INTO purchase_invoice_lines (invoice_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2410000-0000-0000-0000-0000000000f1', 'c2410000-0000-0000-0000-0000000000a1', 'thùng', 2, 240000, 24, 480000, 1),
  ('d2410000-0000-0000-0000-0000000000f2', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 10, 5000, 1, 50000, 1),
  ('d2410000-0000-0000-0000-0000000000f3', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 5, 5000, 1, 25000, 1),
  ('d2410000-0000-0000-0000-0000000000f4', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 3, 5000, 1, 15000, 1),
  ('d2410000-0000-0000-0000-0000000000f5', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 20, 5000, 1, 100000, 1);

-- Hoàn thành P, R, T, K (thủ kho, RPC thật). Q để phiếu tạm.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_purchase_invoice('d2410000-0000-0000-0000-0000000000f1') IS NOT NULL AS p,
       public.complete_purchase_invoice('d2410000-0000-0000-0000-0000000000f3') IS NOT NULL AS r,
       public.complete_purchase_invoice('d2410000-0000-0000-0000-0000000000f4') IS NOT NULL AS t,
       public.complete_purchase_invoice('d2410000-0000-0000-0000-0000000000f5') IS NOT NULL AS k;
RESET ROLE;

CREATE TEMP TABLE lo AS
  SELECT pi.id AS phieu, b.id, b.product_id FROM batches b
  JOIN stock_entry_lines sel ON sel.batch_id = b.id
  JOIN purchase_invoices pi ON pi.stock_entry_id = sel.entry_id
  WHERE pi.id IN ('d2410000-0000-0000-0000-0000000000f1', 'd2410000-0000-0000-0000-0000000000f3',
                  'd2410000-0000-0000-0000-0000000000f4', 'd2410000-0000-0000-0000-0000000000f5');
CREATE TEMP VIEW loP AS SELECT b.* FROM batches b WHERE b.id = (SELECT id FROM lo WHERE phieu = 'd2410000-0000-0000-0000-0000000000f1');
CREATE TEMP VIEW loR AS SELECT b.* FROM batches b WHERE b.id = (SELECT id FROM lo WHERE phieu = 'd2410000-0000-0000-0000-0000000000f3');
CREATE TEMP VIEW loT AS SELECT b.* FROM batches b WHERE b.id = (SELECT id FROM lo WHERE phieu = 'd2410000-0000-0000-0000-0000000000f4');
CREATE TEMP VIEW loK AS SELECT b.* FROM batches b WHERE b.id = (SELECT id FROM lo WHERE phieu = 'd2410000-0000-0000-0000-0000000000f5');
CREATE TEMP VIEW pP AS SELECT * FROM purchase_invoices WHERE id = 'd2410000-0000-0000-0000-0000000000f1';
CREATE TEMP VIEW s1 AS SELECT * FROM supplier_returns WHERE id = 'd2410000-0000-0000-0000-0000000000a1';
CREATE TEMP VIEW s2 AS SELECT * FROM supplier_returns WHERE id = 'd2410000-0000-0000-0000-0000000000a2';
-- Thẻ kho (phiếu đã ghi sổ) và tồn lô từng mặt hàng ở kho bán — phải luôn bằng nhau.
CREATE TEMP VIEW the_kho AS
  SELECT p.id AS product_id,
         COALESCE((SELECT sum(m.signed_qty_in_base_uom) FROM v_stock_movements m
                   WHERE m.org_id = 'a0000000-0000-0000-0000-000000000001' AND m.product_id = p.id
                     AND m.warehouse_zone = 'sale' AND m.entry_status = 'posted'), 0) AS the_kho,
         COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
                   WHERE b.org_id = 'a0000000-0000-0000-0000-000000000001' AND b.product_id = p.id
                     AND b.warehouse_zone = 'sale'), 0) AS ton_lo
  FROM products p WHERE p.id IN ('c2410000-0000-0000-0000-0000000000a1', 'c2410000-0000-0000-0000-0000000000b1');
-- P hoàn thành từ hôm trước — cả bộ thử chạy trong MỘT giao dịch nên now() trùng lúc hoàn thành, không lùi ngày thì
-- không phân biệt được "ngày ghi nợ = lúc hoàn thành gốc" với "= hôm nay".
UPDATE purchase_invoices SET completed_at = '2026-10-01 09:00:00+07' WHERE id = 'd2410000-0000-0000-0000-0000000000f1';
INSERT INTO ghi_nho SELECT 'p_xong', completed_at::text FROM pP;
INSERT INTO ghi_nho SELECT 'p_kho', stock_entry_id::text FROM pP;

-- Xuất 30 hộp từ lô của P (dòng xuất + dấu vết lấy lô, như `post_stock_issue`).
INSERT INTO stock_entries (id, org_id, entry_code, type, status, posted_at, warehouse_zone) VALUES
  ('e2410000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'XK-T241', 'export', 'posted', now(), 'sale');
INSERT INTO stock_entry_lines (id, entry_id, product_id, batch_id, unit_name, quantity, unit_cost, qty_in_base_uom)
SELECT 'f2410000-0000-0000-0000-0000000000e1', 'e2410000-0000-0000-0000-0000000000e1', lo.product_id, lo.id, 'hộp', 30, 10000, 30
FROM lo WHERE lo.phieu = 'd2410000-0000-0000-0000-0000000000f1';
INSERT INTO stock_line_consumptions (line_id, batch_id, qty_in_base_uom, unit_cost)
SELECT 'f2410000-0000-0000-0000-0000000000e1', lo.id, 30, 10000 FROM lo WHERE lo.phieu = 'd2410000-0000-0000-0000-0000000000f1';
UPDATE batches SET qty_on_hand = qty_on_hand - 30 WHERE id IN (SELECT id FROM lo WHERE phieu = 'd2410000-0000-0000-0000-0000000000f1');

-- Huỷ P (cho phép tồn âm — mig 238) → lô −30.
UPDATE organizations SET allow_oversell = true WHERE id = 'a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f1', 'huỷ nhầm') IS NOT NULL AS huy_p;
RESET ROLE;
INSERT INTO kq SELECT 0, 'Chuẩn bị: P huỷ (đã xuất 30/48) → lô −30, đóng; công nợ xoá', qty_on_hand = -30 AND status = 'cancelled'
  AND (SELECT payable_id FROM pP) IS NULL, qty_on_hand::text FROM loP;

-- 1. Khôi phục P (thủ kho) → Hoàn thành; lô 18 (= 48 − 30) mở lại; phiếu kho cũ ghi sổ lại; công nợ NCC 480.000 chưa
--    trả, ngày ghi nợ = lúc hoàn thành gốc; dấu huỷ xoá.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('1', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f1'));
RESET ROLE;
INSERT INTO kq SELECT 1, 'Khôi phục P: Hoàn thành, lô cũ 18 mở lại, phiếu kho cũ ghi sổ lại, công nợ 480.000 chưa trả',
    r.v->>'trang_thai' = 'completed' AND (r.v->>'da_khoi_phuc')::boolean AND (r.v->>'so_lo')::int = 1
    AND p.status = 'completed' AND p.cancelled_at IS NULL AND p.cancelled_by IS NULL AND p.cancel_reason IS NULL
    AND (SELECT qty_on_hand FROM loP) = 18 AND (SELECT status FROM loP) = 'available'
    AND p.stock_entry_id::text = (SELECT gt FROM ghi_nho WHERE k = 'p_kho')
    AND (SELECT se.status FROM stock_entries se WHERE se.id = p.stock_entry_id) = 'posted'
    AND EXISTS (SELECT 1 FROM payables y WHERE y.id = p.payable_id
                AND y.amount = 480000 AND y.paid = 0 AND y.status = 'open' AND y.invoice_number = 'HD-P241'
                AND y.supplier_id = '5f000000-0000-0000-0000-0000000241a1' AND y.stock_entry_id = p.stock_entry_id
                AND y.created_at::text = (SELECT gt FROM ghi_nho WHERE k = 'p_xong')),
    r.v::text || ' · lô ' || (SELECT qty_on_hand FROM loP)::text
FROM rpc r, pP p WHERE r.buoc = '1';
INSERT INTO kq SELECT 2, 'Thẻ kho A = tồn lô A = 18 sau khôi phục; dấu vết lấy lô của hàng đã bán vẫn trỏ lô cũ',
  the_kho = ton_lo AND ton_lo = 18
  AND (SELECT batch_id FROM stock_line_consumptions WHERE line_id = 'f2410000-0000-0000-0000-0000000000e1') = (SELECT id FROM loP),
  the_kho::text || ' / ' || ton_lo::text FROM the_kho WHERE product_id = 'c2410000-0000-0000-0000-0000000000a1';

-- 3. Bấm lần hai: đứng yên — không cộng kho, không thêm công nợ.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('3', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f1'));
RESET ROLE;
INSERT INTO kq SELECT 3, 'Khôi phục P lần hai: đứng yên (lô vẫn 18, một khoản nợ)',
  NOT (r.v->>'da_khoi_phuc')::boolean AND r.v->>'trang_thai' = 'completed' AND (SELECT qty_on_hand FROM loP) = 18
  AND (SELECT count(*) FROM payables WHERE stock_entry_id = (SELECT stock_entry_id FROM pP)) = 1, r.v::text
FROM rpc r WHERE r.buoc = '3';

-- 4. Huỷ lại rồi khôi phục lại (vòng hai): lô −30 → 18, vẫn một khoản nợ.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f1', 'huỷ lần hai') IS NOT NULL AS huy_p2;
RESET ROLE;
INSERT INTO ghi_nho SELECT 'p_am', qty_on_hand::text FROM loP;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('4', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f1'));
RESET ROLE;
INSERT INTO kq SELECT 4, 'Huỷ lại → khôi phục lại: lô −30 → 18, Hoàn thành, một khoản nợ',
  (SELECT gt FROM ghi_nho WHERE k = 'p_am')::numeric = -30 AND r.v->>'trang_thai' = 'completed'
  AND (SELECT qty_on_hand FROM loP) = 18
  AND (SELECT count(*) FROM payables WHERE stock_entry_id = (SELECT stock_entry_id FROM pP)) = 1,
  'lô sau huỷ ' || (SELECT gt FROM ghi_nho WHERE k = 'p_am') || ' · ' || r.v::text
FROM rpc r WHERE r.buoc = '4';

-- 5. Q: huỷ lúc còn Phiếu tạm → khôi phục về Phiếu tạm, không phiếu kho, không công nợ.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f2', 'thử') IS NOT NULL AS huy_q;
INSERT INTO rpc (buoc, v) VALUES ('5', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f2'));
RESET ROLE;
INSERT INTO kq SELECT 5, 'Phiếu tạm bị huỷ → khôi phục về Phiếu tạm, không đụng kho / công nợ',
  r.v->>'trang_thai' = 'draft' AND (r.v->>'da_khoi_phuc')::boolean
  AND q.status = 'draft' AND q.stock_entry_id IS NULL AND q.payable_id IS NULL AND q.cancelled_at IS NULL, r.v::text
FROM rpc r, purchase_invoices q WHERE r.buoc = '5' AND q.id = 'd2410000-0000-0000-0000-0000000000f2';

-- 6. R: luồng sửa CŨ (trước mig 235) — huỷ, về tạm còn trỏ phiếu kho đã huỷ, sửa 5 → 7 gói, rồi huỷ phiếu tạm.
--    Khôi phục → Phiếu tạm; lô / phiếu kho cũ đứng yên (không nhập lại 5 gói của lần trước), không công nợ.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f3', 'Sửa phiếu — lập lại') IS NOT NULL AS huy_r;
RESET ROLE;
UPDATE purchase_invoices SET status = 'draft', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
WHERE id = 'd2410000-0000-0000-0000-0000000000f3';
UPDATE purchase_invoice_lines SET quantity = 7, line_total = 35000 WHERE invoice_id = 'd2410000-0000-0000-0000-0000000000f3';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f3', 'thử') IS NOT NULL AS huy_r_tam;
INSERT INTO rpc (buoc, v) VALUES ('6', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f3'));
RESET ROLE;
INSERT INTO kq SELECT 6, 'Luồng sửa cũ (phiếu tạm còn trỏ phiếu kho đã huỷ, dòng đã đổi) → về Phiếu tạm, kho / nợ đứng yên',
  r.v->>'trang_thai' = 'draft' AND x.status = 'draft'
  AND (SELECT qty_on_hand FROM loR) = 0 AND (SELECT status FROM loR) = 'cancelled'
  AND (SELECT se.status FROM stock_entries se WHERE se.id = x.stock_entry_id) = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM payables y WHERE y.stock_entry_id = x.stock_entry_id),
  r.v::text || ' · lô R ' || (SELECT qty_on_hand FROM loR)::text
FROM rpc r, purchase_invoices x WHERE r.buoc = '6' AND x.id = 'd2410000-0000-0000-0000-0000000000f3';

-- 7. T: phiếu đã huỷ mà phiếu kho còn ghi sổ (dữ liệu lệch) → PHIEU_KHO_LECH, không nhập kho lần hai.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_purchase_invoice('d2410000-0000-0000-0000-0000000000f4', 'thử') IS NOT NULL AS huy_t;
RESET ROLE;
UPDATE stock_entries SET status = 'posted'
WHERE id = (SELECT stock_entry_id FROM purchase_invoices WHERE id = 'd2410000-0000-0000-0000-0000000000f4');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('7', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f4'));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('7', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 7, 'Phiếu kho còn ghi sổ → PHIEU_KHO_LECH, lô đứng yên, phiếu vẫn Đã huỷ',
  r.loi LIKE 'PHIEU_KHO_LECH:%' AND (SELECT qty_on_hand FROM loT) = 0
  AND (SELECT status FROM purchase_invoices WHERE id = 'd2410000-0000-0000-0000-0000000000f4') = 'cancelled', COALESCE(r.loi, r.v::text)
FROM rpc r WHERE r.buoc = '7';
UPDATE stock_entries SET status = 'cancelled'
WHERE id = (SELECT stock_entry_id FROM purchase_invoices WHERE id = 'd2410000-0000-0000-0000-0000000000f4');

-- 8. NV bán hàng → FORBIDDEN.  9. Chủ của NPP khác → SAI_DON_VI.
INSERT INTO organizations (id, name, slug) VALUES ('a0000000-0000-0000-0000-0000000241f2', 'NPP thứ hai (thử 241)', 'npp-thu-241')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id) VALUES ('e2410000-0000-0000-0000-0000000000f2');
INSERT INTO users (id, org_id, full_name, role) VALUES ('e2410000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000241f2', 'Chủ NPP khác', 'owner');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('8', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f4'));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('8', SQLERRM); END;
END $t$;
SELECT set_config('request.jwt.claim.sub', 'e2410000-0000-0000-0000-0000000000f2', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('9', public.khoi_phuc_phieu_nhap('d2410000-0000-0000-0000-0000000000f4'));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('9', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 8, 'NV bán hàng khôi phục phiếu nhập → FORBIDDEN, lô đứng yên',
  r.loi LIKE 'FORBIDDEN:%' AND (SELECT qty_on_hand FROM loT) = 0, COALESCE(r.loi, r.v::text) FROM rpc r WHERE r.buoc = '8';
INSERT INTO kq SELECT 9, 'Chủ NPP khác khôi phục phiếu nhập → SAI_DON_VI',
  r.loi LIKE 'SAI_DON_VI:%', COALESCE(r.loi, r.v::text) FROM rpc r WHERE r.buoc = '9';

-- ── Phiếu trả NCC ──────────────────────────────────────────────────────────────────────────────────
UPDATE organizations SET allow_oversell = false WHERE id = 'a0000000-0000-0000-0000-000000000001';
INSERT INTO supplier_returns (id, org_id, supplier_id, status, warehouse_zone, return_date) VALUES
  ('d2410000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', 'sale', '2026-10-02'),
  ('d2410000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', 'sale', '2026-10-02'),
  ('d2410000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-0000000241a1', 'draft', 'sale', '2026-10-02');
INSERT INTO supplier_return_lines (return_id, product_id, unit_name, quantity, unit_price, conversion_factor, line_total, sort_order) VALUES
  ('d2410000-0000-0000-0000-0000000000a1', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 6, 5000, 1, 30000, 1),
  ('d2410000-0000-0000-0000-0000000000a2', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 10, 5000, 1, 50000, 1),
  ('d2410000-0000-0000-0000-0000000000a3', 'c2410000-0000-0000-0000-0000000000b1', 'gói', 2, 5000, 1, 10000, 1);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_supplier_return('d2410000-0000-0000-0000-0000000000a1') IS NOT NULL AS gui_s1;
RESET ROLE;
INSERT INTO ghi_nho SELECT 's1_kho', stock_entry_id::text FROM s1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_supplier_return('d2410000-0000-0000-0000-0000000000a1', 'huỷ nhầm') IS NOT NULL AS huy_s1;
RESET ROLE;
INSERT INTO kq SELECT 10, 'Chuẩn bị: S1 gửi (6 gói) rồi huỷ → lô K về 20, khoản giảm nợ xoá',
  (SELECT qty_on_hand FROM loK) = 20 AND status = 'cancelled' AND payable_credit_id IS NULL, (SELECT qty_on_hand FROM loK)::text FROM s1;

-- 11. Khôi phục S1 → gửi lại: phiếu kho MỚI ghi sổ, lô K 14, giảm nợ NCC −30.000, Đã gửi.  12. Bấm lần hai: đứng yên.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('11', public.khoi_phuc_phieu_tra_ncc('d2410000-0000-0000-0000-0000000000a1'));
RESET ROLE;
INSERT INTO ghi_nho SELECT 's1_lo', qty_on_hand::text FROM loK;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('12', public.khoi_phuc_phieu_tra_ncc('d2410000-0000-0000-0000-0000000000a1'));
RESET ROLE;
INSERT INTO kq SELECT 11, 'Khôi phục S1: gửi lại — phiếu xuất mới, lô K 14, giảm nợ NCC −30.000, Đã gửi',
  r.v->>'trang_thai' = 'completed' AND r.v->>'ly_do' IS NULL
  AND s.status = 'completed' AND s.cancel_reason IS NULL
  AND s.stock_entry_id::text <> (SELECT gt FROM ghi_nho WHERE k = 's1_kho')
  AND (SELECT se.status FROM stock_entries se WHERE se.id = s.stock_entry_id) = 'posted'
  AND (SELECT gt FROM ghi_nho WHERE k = 's1_lo')::numeric = 14
  AND EXISTS (SELECT 1 FROM payables y WHERE y.id = s.payable_credit_id AND y.amount = -30000 AND y.paid = 0 AND y.status = 'open'),
  r.v::text || ' · lô K ' || (SELECT gt FROM ghi_nho WHERE k = 's1_lo')
FROM rpc r, s1 s WHERE r.buoc = '11';
INSERT INTO kq SELECT 12, 'Khôi phục S1 lần hai: đứng yên (lô K vẫn 14, một khoản giảm nợ)',
  NOT (r.v->>'da_khoi_phuc')::boolean AND (SELECT qty_on_hand FROM loK) = 14
  AND (SELECT count(*) FROM payables WHERE notes = 'Hoàn trả NCC — phiếu ' || (SELECT return_code FROM s1)) = 1, r.v::text
FROM rpc r WHERE r.buoc = '12';
INSERT INTO kq SELECT 13, 'Thẻ kho B = tồn lô B sau khi khôi phục S1 (14)', the_kho = ton_lo AND ton_lo = 14,
  the_kho::text || ' / ' || ton_lo::text FROM the_kho WHERE product_id = 'c2410000-0000-0000-0000-0000000000b1';

-- 14. S2: gửi 10 gói (lô K 4), huỷ (14), bán mất 10 (4) — NPP không cho tồn âm → khôi phục DỪNG Ở NHÁP, trả lý do kho
--     không đủ; lô không đổi, không có khoản giảm nợ.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.complete_supplier_return('d2410000-0000-0000-0000-0000000000a2') IS NOT NULL AS gui_s2,
       public.cancel_supplier_return('d2410000-0000-0000-0000-0000000000a2', 'thử') IS NOT NULL AS huy_s2;
RESET ROLE;
UPDATE batches SET qty_on_hand = qty_on_hand - 10 WHERE id = (SELECT id FROM loK);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
INSERT INTO rpc (buoc, v) VALUES ('14', public.khoi_phuc_phieu_tra_ncc('d2410000-0000-0000-0000-0000000000a2'));
RESET ROLE;
INSERT INTO kq SELECT 14, 'Kho không đủ để gửi lại S2 → về Nháp kèm lý do INSUFFICIENT_STOCK, lô / nợ đứng yên',
  r.v->>'trang_thai' = 'draft' AND (r.v->>'da_khoi_phuc')::boolean AND r.v->>'ly_do' LIKE 'INSUFFICIENT_STOCK%'
  AND s.status = 'draft' AND s.payable_credit_id IS NULL AND (SELECT qty_on_hand FROM loK) = 4
  AND (SELECT se.status FROM stock_entries se WHERE se.id = s.stock_entry_id) = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM payables y WHERE y.notes = 'Hoàn trả NCC — phiếu ' || s.return_code),
  r.v::text
FROM rpc r, s2 s WHERE r.buoc = '14';

-- 15. S3: huỷ lúc Nháp → về Nháp, không phiếu kho.  16. NV bán hàng → FORBIDDEN.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_supplier_return('d2410000-0000-0000-0000-0000000000a3', 'thử') IS NOT NULL AS huy_s3;
INSERT INTO rpc (buoc, v) VALUES ('15', public.khoi_phuc_phieu_tra_ncc('d2410000-0000-0000-0000-0000000000a3'));
RESET ROLE;
INSERT INTO kq SELECT 15, 'Phiếu trả Nháp bị huỷ → khôi phục về Nháp, không phiếu kho',
  r.v->>'trang_thai' = 'draft' AND x.status = 'draft' AND x.stock_entry_id IS NULL AND x.cancel_reason IS NULL, r.v::text
FROM rpc r, supplier_returns x WHERE r.buoc = '15' AND x.id = 'd2410000-0000-0000-0000-0000000000a3';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true);
SELECT public.cancel_supplier_return('d2410000-0000-0000-0000-0000000000a3', 'thử lại') IS NOT NULL AS huy_s3_lai;
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true);
DO $t$
BEGIN
  BEGIN
    INSERT INTO rpc (buoc, v) VALUES ('16', public.khoi_phuc_phieu_tra_ncc('d2410000-0000-0000-0000-0000000000a3'));
  EXCEPTION WHEN OTHERS THEN INSERT INTO rpc (buoc, loi) VALUES ('16', SQLERRM); END;
END $t$;
RESET ROLE;
INSERT INTO kq SELECT 16, 'NV bán hàng khôi phục phiếu trả NCC → FORBIDDEN, phiếu vẫn Đã huỷ',
  r.loi LIKE 'FORBIDDEN:%' AND (SELECT status FROM supplier_returns WHERE id = 'd2410000-0000-0000-0000-0000000000a3') = 'cancelled',
  COALESCE(r.loi, r.v::text) FROM rpc r WHERE r.buoc = '16';

-- 17. Quyền gọi: authenticated được, anon không.
INSERT INTO kq SELECT 17, 'anon không gọi được hai RPC khôi phục; authenticated gọi được',
  NOT has_function_privilege('anon', 'public.khoi_phuc_phieu_nhap(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.khoi_phuc_phieu_tra_ncc(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.khoi_phuc_phieu_nhap(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.khoi_phuc_phieu_tra_ncc(uuid)', 'EXECUTE'), NULL;

\echo
SELECT buoc, CASE WHEN ok THEN 'ĐẠT' ELSE 'SAI' END AS kq, ten, ghi FROM kq ORDER BY buoc;
SELECT count(*) AS tong, count(*) FILTER (WHERE ok) AS dat, count(*) FILTER (WHERE NOT ok) AS loi FROM kq;
ROLLBACK;
