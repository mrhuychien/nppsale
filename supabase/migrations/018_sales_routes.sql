-- =====================================================================
-- Migration 018: Sales routes (tuyến bán hàng)
-- =====================================================================
-- Replaces the free-form customers.channel text with a proper lookup
-- table the distributor can CRUD. We keep customers.channel as a text
-- column that stores the route's `code` so existing rows still work
-- and reports that group by channel keep running.

CREATE TABLE IF NOT EXISTS sales_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Short code shown on cards (GT, MT, HORECA, TUYEN1, …)
  code text NOT NULL,
  -- Longer human label
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sales_routes_org ON sales_routes(org_id, is_active);

CREATE OR REPLACE FUNCTION sales_routes_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_routes_touch ON sales_routes;
CREATE TRIGGER trg_sales_routes_touch
  BEFORE UPDATE ON sales_routes
  FOR EACH ROW EXECUTE FUNCTION sales_routes_touch();

-- RLS
ALTER TABLE sales_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_routes_select" ON sales_routes
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

CREATE POLICY "sales_routes_insert" ON sales_routes
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "sales_routes_update" ON sales_routes
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "sales_routes_delete" ON sales_routes
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_routes TO authenticated;

-- Seed default routes for every existing org so the dropdown on /customers
-- and the filter on /inventory/pending are populated out of the box.
INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'GT', 'General Trade', 1 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'MT', 'Modern Trade', 2 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO sales_routes (org_id, code, name, sort_order)
SELECT id, 'HORECA', 'Khách sạn / Nhà hàng', 3 FROM organizations
ON CONFLICT (org_id, code) DO NOTHING;
