-- =====================================================================
-- Migration 074: Drop org-level price-edit columns from pricing_rules
-- =====================================================================
-- Lý do: cấu hình "cho phép NV sửa giá + sàn/trần %/VND" giờ được
-- quản lý PER-NHÂN-VIÊN qua users.allow_price_edit +
-- users.price_edit_max_increase_pct (migration 027). UI /settings/pricing
-- đã gỡ; setup wizard step "pricing" rename thành "warehouse" và chỉ
-- cấu hình ngưỡng kho date.
--
-- Cột date_warehouse_threshold_days GIỮ NGUYÊN vì 2 SQL function
-- batches_auto_promote_zone_trigger + promote_batches_to_date_warehouse
-- (mig 028) vẫn đang dùng nó.
--
-- An toàn: chỉ DROP COLUMN, không DROP TABLE. RLS + index khác không
-- liên quan đến các cột này nên không cần đụng tới.

ALTER TABLE pricing_rules DROP COLUMN IF EXISTS allow_sales_override;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS sale_min_pct;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS sale_min_value;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS return_max_pct;
ALTER TABLE pricing_rules DROP COLUMN IF EXISTS return_max_value;
-- updated_by + updated_at giữ lại làm audit metadata cho ngưỡng kho date.

COMMENT ON TABLE pricing_rules IS
  'Cấu hình warehouse-date threshold per org. Cột giá đã chuyển sang per-user (users.allow_price_edit + users.price_edit_max_increase_pct) tại migration 074.';
