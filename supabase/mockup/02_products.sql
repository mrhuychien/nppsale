-- =====================================================================
-- Mockup Part 2: 10 sản phẩm FMCG + product_units + price_lists
-- =====================================================================
-- 10 SKU phổ biến ở NPP Việt Nam: dầu ăn, bánh, mì, nước ngọt, sữa, bia...
-- Mỗi SP có 2-3 đơn vị (thùng/lốc/gói) và 2 bậc giá (Thường vs VIP).

BEGIN;

DO $$
DECLARE
  target_org_id uuid;
  grp_vip uuid;
  grp_thuong uuid;
BEGIN
  SELECT id INTO target_org_id FROM organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO grp_vip FROM customer_groups WHERE org_id = target_org_id AND name = 'VIP' LIMIT 1;
  SELECT id INTO grp_thuong FROM customer_groups WHERE org_id = target_org_id AND name = 'Thường' LIMIT 1;

  -- Xóa mock cũ nếu re-run (chỉ xoá SKU có tiền tố DEMO- để giữ SP thật)
  DELETE FROM products WHERE org_id = target_org_id AND sku LIKE 'DEMO-%';

  -- Insert products
  INSERT INTO products (org_id, sku, name, category, brand, base_unit, vat_rate, shelf_life_days) VALUES
    (target_org_id, 'DEMO-OIL-01', 'Dầu ăn Neptune Gold 1L', 'Dầu ăn', 'Neptune', 'chai', 0.08, 365),
    (target_org_id, 'DEMO-BIS-01', 'Bánh Cosy Marie 576g', 'Bánh kẹo', 'Cosy', 'hộp', 0.08, 270),
    (target_org_id, 'DEMO-BIS-02', 'Bánh Chocopie 12 cái', 'Bánh kẹo', 'Orion', 'hộp', 0.08, 180),
    (target_org_id, 'DEMO-NOODLE-01', 'Mì Hảo Hảo tôm chua cay', 'Mì ăn liền', 'Acecook', 'gói', 0.08, 150),
    (target_org_id, 'DEMO-DRINK-01', 'Nước ngọt Coca-Cola 330ml', 'Nước giải khát', 'Coca', 'lon', 0.10, 180),
    (target_org_id, 'DEMO-DRINK-02', 'Trà xanh C2 Chanh 500ml', 'Nước giải khát', 'C2', 'chai', 0.10, 240),
    (target_org_id, 'DEMO-MILK-01', 'Sữa tươi Vinamilk 180ml', 'Sữa', 'Vinamilk', 'hộp', 0.08, 90),
    (target_org_id, 'DEMO-BEER-01', 'Bia Tiger lon 330ml', 'Bia rượu', 'Tiger', 'lon', 0.10, 365),
    (target_org_id, 'DEMO-SNACK-01', 'Snack Oishi 50g', 'Bánh kẹo', 'Oishi', 'gói', 0.08, 180),
    (target_org_id, 'DEMO-SAUCE-01', 'Nước mắm Nam Ngư 500ml', 'Gia vị', 'Nam Ngư', 'chai', 0.08, 540);

  -- Product units (conversion)
  INSERT INTO product_units (product_id, unit_name, conversion)
  SELECT id, 'thùng', 12 FROM products WHERE org_id = target_org_id AND sku IN ('DEMO-OIL-01','DEMO-DRINK-01','DEMO-DRINK-02','DEMO-MILK-01','DEMO-BEER-01','DEMO-SAUCE-01')
  UNION ALL
  SELECT id, 'lốc', 6 FROM products WHERE org_id = target_org_id AND sku IN ('DEMO-DRINK-01','DEMO-DRINK-02','DEMO-BEER-01','DEMO-MILK-01')
  UNION ALL
  SELECT id, 'thùng', 30 FROM products WHERE org_id = target_org_id AND sku = 'DEMO-NOODLE-01'
  UNION ALL
  SELECT id, 'thùng', 24 FROM products WHERE org_id = target_org_id AND sku IN ('DEMO-BIS-01','DEMO-BIS-02','DEMO-SNACK-01')
  ON CONFLICT DO NOTHING;

  -- Giá mặc định (group_id = null) — áp cho tất cả
  INSERT INTO price_lists (product_id, group_id, unit_name, price, effective_from)
  SELECT id, NULL, base_unit,
    CASE sku
      WHEN 'DEMO-OIL-01' THEN 45000
      WHEN 'DEMO-BIS-01' THEN 50000
      WHEN 'DEMO-BIS-02' THEN 62000
      WHEN 'DEMO-NOODLE-01' THEN 4500
      WHEN 'DEMO-DRINK-01' THEN 9000
      WHEN 'DEMO-DRINK-02' THEN 12000
      WHEN 'DEMO-MILK-01' THEN 7500
      WHEN 'DEMO-BEER-01' THEN 20000
      WHEN 'DEMO-SNACK-01' THEN 7000
      WHEN 'DEMO-SAUCE-01' THEN 28000
    END,
    CURRENT_DATE - 90
  FROM products WHERE org_id = target_org_id AND sku LIKE 'DEMO-%';

  -- Giá VIP (group_id = VIP) — giảm 5% so với giá thường
  IF grp_vip IS NOT NULL THEN
    INSERT INTO price_lists (product_id, group_id, unit_name, price, effective_from)
    SELECT p.id, grp_vip, p.base_unit,
      ROUND(
        CASE p.sku
          WHEN 'DEMO-OIL-01' THEN 45000 * 0.95
          WHEN 'DEMO-BIS-01' THEN 50000 * 0.95
          WHEN 'DEMO-BIS-02' THEN 62000 * 0.95
          WHEN 'DEMO-NOODLE-01' THEN 4500 * 0.95
          WHEN 'DEMO-DRINK-01' THEN 9000 * 0.95
          WHEN 'DEMO-DRINK-02' THEN 12000 * 0.95
          WHEN 'DEMO-MILK-01' THEN 7500 * 0.95
          WHEN 'DEMO-BEER-01' THEN 20000 * 0.95
          WHEN 'DEMO-SNACK-01' THEN 7000 * 0.95
          WHEN 'DEMO-SAUCE-01' THEN 28000 * 0.95
        END
      ),
      CURRENT_DATE - 90
    FROM products p
    WHERE p.org_id = target_org_id AND p.sku LIKE 'DEMO-%';
  END IF;

  RAISE NOTICE 'Part 2 OK: đã tạo 10 SP + units + price_lists';
END $$;

COMMIT;

SELECT 'products' AS t, count(*) FROM products WHERE sku LIKE 'DEMO-%'
UNION ALL SELECT 'product_units', count(*) FROM product_units WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%')
UNION ALL SELECT 'price_lists', count(*) FROM price_lists WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'DEMO-%');
