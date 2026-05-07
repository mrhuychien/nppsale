-- ====================================================================
-- 026_salary_bypass_attendance
--
-- Update #2 v2 — Section 2.4. NV Bán hàng được đo bằng kết quả (đơn,
-- doanh số, KPI), không đo bằng có mặt. Khi tính lương, không nhân hệ
-- số ngày công cho các role được liệt kê trong cột mới.
-- ====================================================================

ALTER TABLE hr_salary_config
  ADD COLUMN IF NOT EXISTS bypass_attendance_roles jsonb
    NOT NULL DEFAULT '["sales"]'::jsonb;

COMMENT ON COLUMN hr_salary_config.bypass_attendance_roles IS
  'Mảng JSON role name (vd. ["sales","manager"]) sẽ bỏ qua chấm công khi tính lương — lương = base + thưởng, không nhân hệ số ngày công.';

-- Backfill: nếu org đã có config cũ với bypass_attendance_roles=null
-- thì gán sales (mặc định an toàn). NOT NULL DEFAULT phía trên đã
-- handle nhưng giữ thêm tầng dữ liệu cho rõ.
UPDATE hr_salary_config
SET bypass_attendance_roles = '["sales"]'::jsonb
WHERE bypass_attendance_roles IS NULL OR jsonb_array_length(bypass_attendance_roles) = 0;
