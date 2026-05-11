-- ====================================================================
-- Mức thưởng KPI: 1 ô doanh số chung A + bậc thưởng cộng dồn theo
-- % của A (per user feedback).
--
-- Trước: mỗi tier có min_revenue / min_percent riêng.
-- Sau: hr_salary_config.kpi_target_revenue = mức doanh số chung A.
--   target_tiers = [{min_percent, bonus, label}, ...] — bonus cộng
--   dồn. Đạt 70% A → +bonus(70). Đạt 80% A → +bonus(70)+bonus(80).
--   v.v.
-- ====================================================================

ALTER TABLE hr_salary_config
  ADD COLUMN IF NOT EXISTS kpi_target_revenue numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN hr_salary_config.kpi_target_revenue IS
  'Mức doanh số chung A để tính % KPI. Bậc trong target_tiers dùng min_percent so với A; bonus cộng dồn.';
