-- ====================================================================
-- 028_warehouse_zones
--
-- Update #2 v2 §7 — Tách 2 kho hàng:
--   • "sale" — Kho hàng bán (hàng tươi, còn xa hạn)
--   • "date" — Kho hàng date (gần hạn, NV gom lại để bán xả)
--
-- Mỗi batch thuộc đúng 1 zone tại 1 thời điểm. Mặc định batch mới =
-- 'sale'; trigger tự động chuyển sang 'date' khi expires_at - now() ≤
-- threshold (mặc định 30 ngày, lưu trên pricing_rules để admin chỉnh).
--
-- Có thể chuyển zone thủ công khi cần (VD: sale rep gom hàng date sớm
-- để bán xả) — trigger không revert lại.
-- ====================================================================

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS warehouse_zone text NOT NULL DEFAULT 'sale'
    CHECK (warehouse_zone IN ('sale', 'date')),
  ADD COLUMN IF NOT EXISTS zone_moved_at timestamptz,
  ADD COLUMN IF NOT EXISTS zone_moved_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_batches_zone
  ON batches(org_id, warehouse_zone, expires_at);

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS date_warehouse_threshold_days integer NOT NULL DEFAULT 30
    CHECK (date_warehouse_threshold_days >= 0 AND date_warehouse_threshold_days <= 365);

COMMENT ON COLUMN pricing_rules.date_warehouse_threshold_days IS
  'Ngưỡng số ngày trước hạn để batch tự chuyển sang kho hàng date.';

COMMENT ON COLUMN batches.warehouse_zone IS
  'Zone của batch: sale (hàng bán bình thường) hoặc date (hàng gần hạn).';

-- ----- Auto-classify trigger ------------------------------------------
-- Dùng pricing_rules.date_warehouse_threshold_days nếu có, fallback 30.
-- Chỉ auto-set khi INSERT (zone chưa được đặt thủ công); trên UPDATE
-- nếu expires_at thay đổi và zone vẫn là 'sale' thì re-evaluate.

CREATE OR REPLACE FUNCTION batches_auto_zone()
RETURNS TRIGGER AS $$
DECLARE
  threshold integer;
BEGIN
  SELECT date_warehouse_threshold_days INTO threshold
  FROM pricing_rules
  WHERE org_id = NEW.org_id;

  IF threshold IS NULL THEN
    threshold := 30;
  END IF;

  -- Nếu trigger không có expires_at thì để default 'sale'
  IF NEW.expires_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Chỉ auto-promote sang 'date'; không bao giờ tự động revert.
  IF NEW.warehouse_zone = 'sale'
     AND NEW.expires_at <= CURRENT_DATE + (threshold || ' days')::interval
  THEN
    NEW.warehouse_zone := 'date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_batches_auto_zone_ins ON batches;
CREATE TRIGGER trg_batches_auto_zone_ins
  BEFORE INSERT ON batches
  FOR EACH ROW EXECUTE FUNCTION batches_auto_zone();

DROP TRIGGER IF EXISTS trg_batches_auto_zone_upd ON batches;
CREATE TRIGGER trg_batches_auto_zone_upd
  BEFORE UPDATE OF expires_at ON batches
  FOR EACH ROW EXECUTE FUNCTION batches_auto_zone();

-- ----- Bulk re-evaluation function ------------------------------------
-- Owner/manager có thể chạy lại để gom các batch đã quá ngưỡng vào
-- kho date (vd. khi đổi threshold). Trả về số batch chuyển zone.

CREATE OR REPLACE FUNCTION refresh_warehouse_zones(p_org_id uuid)
RETURNS integer AS $$
DECLARE
  threshold integer;
  moved integer;
BEGIN
  SELECT date_warehouse_threshold_days INTO threshold
  FROM pricing_rules
  WHERE org_id = p_org_id;

  IF threshold IS NULL THEN
    threshold := 30;
  END IF;

  WITH updated AS (
    UPDATE batches
    SET warehouse_zone = 'date',
        zone_moved_at = now()
    WHERE org_id = p_org_id
      AND warehouse_zone = 'sale'
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_DATE + (threshold || ' days')::interval
      AND qty_on_hand > 0
    RETURNING 1
  )
  SELECT COUNT(*) INTO moved FROM updated;

  RETURN COALESCE(moved, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION refresh_warehouse_zones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_warehouse_zones(uuid) TO authenticated;

-- ----- Backfill: classify existing batches ----------------------------
SELECT refresh_warehouse_zones(id) FROM organizations;
