-- =====================================================================
-- Migration 016: Inventory cost tracking + expenses
-- =====================================================================
-- Enables:
--   1. Draft vs posted stock entries (needed to show "pending" stock)
--   2. Cost tracking on each stock line + weighted-avg cost per batch
--   3. General expenses (overhead) for the finance reports
--   4. Stocktake differences posted as an expense

-- ---------------------------------------------------------------------
-- 1. Stock entries status
-- ---------------------------------------------------------------------
-- 'draft'  : created but not yet affecting on-hand; visible as "pending"
-- 'posted' : committed, has already moved batches.qty_on_hand
-- Existing rows are treated as 'posted' (default).

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'cancelled'));

ALTER TABLE stock_entries
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

-- Backfill posted_at for historical rows so reports can order correctly.
UPDATE stock_entries
SET posted_at = COALESCE(posted_at, created_at)
WHERE status = 'posted' AND posted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_entries_status_type
  ON stock_entries(status, type, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Line-level cost tracking
-- ---------------------------------------------------------------------
-- For imports: unit_cost is the purchase cost we paid per base unit.
-- For exports: unit_cost mirrors the batch's weighted cost at export time
-- (captured so COGS is deterministic even if later imports change avg cost).

ALTER TABLE stock_entry_lines
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- Batch weighted-average cost (in the base unit). Computed from imports;
-- kept on the row so queries don't need a subquery every time.
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 3. Expenses (general operating overhead)
-- ---------------------------------------------------------------------
-- A simple expense ledger: rent, utilities, marketing, stocktake loss, etc.
-- Used by the P&L and cash flow reports.

CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  -- Accounting bucket for the report
  bucket text NOT NULL DEFAULT 'operating'
    CHECK (bucket IN ('cogs', 'operating', 'hr', 'financial', 'tax', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, code)
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid REFERENCES expense_categories(id),
  -- Event date this expense belongs to (for report periods)
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount >= 0),
  description text,
  -- Free-form reference (invoice number, receipt number, stocktake entry id...)
  reference_code text,
  -- For traceability when generated from other modules (e.g. stocktake loss)
  source_type text,
  source_id uuid,
  -- If the expense has been paid (affects cash flow statement)
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  payment_method text CHECK (payment_method IN ('cash', 'transfer', 'ewallet')),

  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_date
  ON expenses(org_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_source
  ON expenses(source_type, source_id);

-- Touch trigger for expenses.updated_at
CREATE OR REPLACE FUNCTION expenses_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_touch ON expenses;
CREATE TRIGGER trg_expenses_touch
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_touch();

-- RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expense_categories_all" ON expense_categories
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id())
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager', 'accountant')
  );

CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO authenticated;

-- Seed default expense categories for every org
INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'COGS_ADJ', 'Điều chỉnh kiểm kê (giá vốn)', 'cogs' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'RENT', 'Tiền thuê mặt bằng', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'UTIL', 'Điện nước', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'FUEL', 'Xăng xe / vận chuyển', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'MKT', 'Marketing / khuyến mãi', 'operating' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'SALARY', 'Lương', 'hr' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'TAX', 'Thuế', 'tax' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO expense_categories (org_id, code, name, bucket)
SELECT id, 'OTHER', 'Chi phí khác', 'other' FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;
