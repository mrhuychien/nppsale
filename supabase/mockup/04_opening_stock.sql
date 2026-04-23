-- =====================================================================
-- Mockup Part 4: Nhập kho mở kỳ — 1 phiếu import cho 10 SP
-- =====================================================================
-- Tạo 1 phiếu nhập kho (posted), mỗi SP 1 batch với tồn ban đầu lớn để
-- đủ cho các đơn hàng mẫu tiếp theo. unit_cost = giá bán × 0.7 để có
-- biên lãi gộp hợp lý cho P&L.

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  owner_user uuid;
  warehouse_user uuid;
  entry_id uuid;
  entry_code_val text := 'DEMO-NK-OPENING';
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO warehouse_user FROM users WHERE org_id = target_org_id AND role = 'warehouse' LIMIT 1;
  SELECT id INTO owner_user FROM users WHERE org_id = target_org_id AND role = 'owner' LIMIT 1;
  IF warehouse_user IS NULL THEN warehouse_user := owner_user; END IF;

  -- Xóa phiếu mock cũ (cascade cả lines + batches)
  DELETE FROM stock_entries WHERE org_id = target_org_id AND entry_code = entry_code_val;
  DELETE FROM batches WHERE org_id = target_org_id AND batch_code LIKE 'DEMO-LOT-%';

  -- 1. Tạo phiếu nhập posted
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (target_org_id, entry_code_val, 'import', 'posted', NOW() - INTERVAL '7 days', warehouse_user,
          'Phiếu nhập mở kỳ (demo)')
  RETURNING id INTO entry_id;

  -- 2. Tạo 10 batches + lines với unit_cost = 70% giá bán
  WITH prod AS (
    SELECT
      p.id AS product_id,
      p.sku,
      p.base_unit,
      COALESCE(
        (SELECT price FROM price_lists WHERE product_id = p.id AND group_id IS NULL ORDER BY effective_from DESC LIMIT 1),
        0
      ) AS sell_price
    FROM products p
    WHERE p.org_id = target_org_id AND p.sku LIKE 'DEMO-%'
  ), ins_batches AS (
    INSERT INTO batches (org_id, product_id, batch_code, manufactured_at, expires_at, location, qty_initial, qty_on_hand, unit_cost)
    SELECT
      target_org_id,
      prod.product_id,
      'DEMO-LOT-' || prod.sku,
      CURRENT_DATE - INTERVAL '30 days',
      CURRENT_DATE + INTERVAL '180 days',
      'Kho Tân Bình - Kệ A1',
      500,
      500,
      ROUND(prod.sell_price * 0.7)
    FROM prod
    RETURNING id, product_id, unit_cost
  )
  INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost, notes)
  SELECT
    entry_id,
    ib.product_id,
    ib.id,
    p.base_unit,
    500,
    ib.unit_cost,
    'Nhập mở kỳ'
  FROM ins_batches ib
  JOIN products p ON p.id = ib.product_id;

  RAISE NOTICE 'Part 4 OK: 1 phiếu nhập (id %) + 10 batches × 500 qty', entry_id;
END $$;

COMMIT;

SELECT 'batches' AS t, count(*), sum(qty_on_hand) AS qty, sum(qty_on_hand * unit_cost) AS value
  FROM batches WHERE batch_code LIKE 'DEMO-LOT-%';
