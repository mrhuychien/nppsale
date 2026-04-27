-- =====================================================================
-- Migration 019: Delivery settlement (quyết toán chuyến giao)
-- =====================================================================
-- Adds two columns to deliveries so the warehouse can record the cash
-- amount the driver returned and the timestamp of the settlement. The
-- settle screen (/deliveries/[id]/settle) writes these after the driver
-- finishes a route.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_amount numeric(15, 2);
