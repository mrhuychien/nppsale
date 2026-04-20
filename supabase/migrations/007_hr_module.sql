-- Module HR: Chấm công, Tính lương, Cơ chế thưởng
-- Tables for attendance, payroll, salary structure, bonus tiers

-- ==========================================
-- 1. Cấu hình lương cơ bản (salary structure)
-- ==========================================
CREATE TABLE hr_salary_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Cấu hình mặc định',
  base_salary numeric NOT NULL DEFAULT 3700000,
  gas_allowance numeric NOT NULL DEFAULT 1000000,
  phone_allowance numeric NOT NULL DEFAULT 300000,
  working_days_per_month integer NOT NULL DEFAULT 26,
  -- Tiered target bonuses (% of target reached → bonus amount)
  target_tiers jsonb NOT NULL DEFAULT '[
    {"min_percent": 70, "bonus": 1000000, "label": "Đạt 70%"},
    {"min_percent": 80, "bonus": 1000000, "label": "Đạt 80%"},
    {"min_percent": 90, "bonus": 1000000, "label": "Đạt 90%"},
    {"min_percent": 100, "bonus": 1000000, "label": "Đạt 100%"}
  ]',
  -- Over 100% bonus
  over_target_percent numeric NOT NULL DEFAULT 5,
  -- Under-performance rules
  under_70_rule text DEFAULT 'base_only',
  under_60_percent numeric DEFAULT 6,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_hr_salary_config_org ON hr_salary_config(org_id);

-- ==========================================
-- 2. Thưởng doanh số theo tháng (monthly bonus tiers)
-- ==========================================
CREATE TABLE hr_monthly_bonus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period text NOT NULL,
  tiers jsonb NOT NULL DEFAULT '[
    {"min_revenue": 150000000, "bonus": 1000000},
    {"min_revenue": 200000000, "bonus": 1500000},
    {"min_revenue": 250000000, "bonus": 2000000},
    {"min_revenue": 300000000, "bonus": 2500000},
    {"min_revenue": 350000000, "bonus": 3000000}
  ]',
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, period)
);
CREATE INDEX idx_hr_monthly_bonus_org ON hr_monthly_bonus(org_id);

-- ==========================================
-- 3. Chấm công (attendance)
-- ==========================================
CREATE TABLE hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday')),
  check_in time,
  check_out time,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, work_date)
);
CREATE INDEX idx_hr_attendance_org ON hr_attendance(org_id);
CREATE INDEX idx_hr_attendance_user ON hr_attendance(user_id, work_date);

-- ==========================================
-- 4. Bảng lương (payroll)
-- ==========================================
CREATE TABLE hr_payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL,
  -- Attendance
  working_days integer DEFAULT 0,
  absent_days integer DEFAULT 0,
  -- Revenue
  total_revenue numeric DEFAULT 0,
  target_amount numeric DEFAULT 0,
  target_percent numeric DEFAULT 0,
  -- Salary breakdown
  base_salary numeric DEFAULT 0,
  gas_allowance numeric DEFAULT 0,
  phone_allowance numeric DEFAULT 0,
  target_bonus numeric DEFAULT 0,
  over_target_bonus numeric DEFAULT 0,
  monthly_revenue_bonus numeric DEFAULT 0,
  deductions numeric DEFAULT 0,
  total_salary numeric DEFAULT 0,
  -- Breakdown JSON for audit
  breakdown jsonb DEFAULT '{}',
  -- Status
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid')),
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, period)
);
CREATE INDEX idx_hr_payroll_org ON hr_payroll(org_id);
CREATE INDEX idx_hr_payroll_user ON hr_payroll(user_id);

-- ==========================================
-- RLS
-- ==========================================
ALTER TABLE hr_salary_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_monthly_bonus ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll ENABLE ROW LEVEL SECURITY;

-- Config: owner can manage, all authenticated can view
CREATE POLICY "View salary config" ON hr_salary_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage salary config" ON hr_salary_config FOR ALL TO authenticated USING (public.user_role() = 'owner');

-- Monthly bonus: same as config
CREATE POLICY "View monthly bonus" ON hr_monthly_bonus FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage monthly bonus" ON hr_monthly_bonus FOR ALL TO authenticated USING (public.user_role() = 'owner');

-- Attendance: all can view (for the grid), owner/manager can manage
CREATE POLICY "View attendance" ON hr_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage attendance" ON hr_attendance FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager'));

-- Payroll: owner/accountant can manage, employees see own
CREATE POLICY "View own payroll" ON hr_payroll FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.user_role() IN ('owner', 'accountant', 'manager'));
CREATE POLICY "Manage payroll" ON hr_payroll FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'accountant'));

-- Grants
GRANT SELECT ON hr_salary_config TO authenticated;
GRANT SELECT ON hr_monthly_bonus TO authenticated;
GRANT SELECT ON hr_attendance TO authenticated;
GRANT SELECT ON hr_payroll TO authenticated;

-- ==========================================
-- Seed default salary config
-- ==========================================
INSERT INTO hr_salary_config (org_id, name, base_salary, gas_allowance, phone_allowance, target_tiers)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Cấu hình lương NVBH',
  3700000, 1000000, 300000,
  '[
    {"min_percent": 70, "bonus": 1000000, "label": "Đạt 70%"},
    {"min_percent": 80, "bonus": 1000000, "label": "Đạt 80%"},
    {"min_percent": 90, "bonus": 1000000, "label": "Đạt 90%"},
    {"min_percent": 100, "bonus": 1000000, "label": "Đạt 100%"}
  ]'
);

-- Seed April 2026 bonus tiers
INSERT INTO hr_monthly_bonus (org_id, period, tiers, notes)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '2026-04',
  '[
    {"min_revenue": 150000000, "bonus": 1000000},
    {"min_revenue": 200000000, "bonus": 1500000},
    {"min_revenue": 250000000, "bonus": 2000000},
    {"min_revenue": 300000000, "bonus": 2500000},
    {"min_revenue": 350000000, "bonus": 3000000}
  ]',
  'Thưởng doanh số tháng 4/2026'
);
