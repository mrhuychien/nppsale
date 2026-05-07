-- ====================================================================
-- 031_hr_bonus_extensions
--
-- Update #2 v2 §2.1 / §2.2 / §2.3 — Mở rộng cơ chế thưởng:
--   §2.1 Thưởng đầu thùng (per-unit bonus): X đồng / 1 thùng SP Y bán
--        ra trong kỳ. Lưu jsonb [{product_id, unit_name, bonus}, …].
--        product_id = null = áp dụng cho mọi SP.
--   §2.2 Thưởng đơn hàng (milestone): bậc thang theo số đơn DELIVERED
--        trong kỳ. [{min_orders, bonus, label}, …].
--   §2.3 Thưởng KPI tháng: 5 metrics (số khách mới, %visit-cover, AOV,
--        tỉ lệ trả, % đơn vượt list) — mỗi metric có bậc thang riêng.
--
-- Cùng nằm trên hr_monthly_bonus để 1 row = trọn bộ cấu hình thưởng
-- của 1 (org, period). Các trường default = '[]' nên có thể nâng cấp
-- không phá vỡ org cũ.
-- ====================================================================

ALTER TABLE hr_monthly_bonus
  ADD COLUMN IF NOT EXISTS per_unit_bonuses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_milestone_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS kpi_metrics jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hr_monthly_bonus.per_unit_bonuses IS
  '§2.1: [{product_id|null, unit_name, bonus}] — thưởng/đầu thùng SP bán ra.';
COMMENT ON COLUMN hr_monthly_bonus.order_milestone_tiers IS
  '§2.2: [{min_orders, bonus, label}] — bậc thang số đơn hoàn tất.';
COMMENT ON COLUMN hr_monthly_bonus.kpi_metrics IS
  '§2.3: [{key, label, tiers:[{min, bonus}]}] — bậc thang theo từng KPI.';
