-- ====================================================================
-- Self-deliver flow tạo 1 delivery row để T-07 handover dùng được
-- sau khi thu tiền (User feedback: "Bước Nhận bàn giao lại từ lái xe
-- chưa thấy" sau bước thu tiền + in phiếu thu trong flow tự giao).
--
-- Cột mới deliveries.source_stock_entry_id liên kết delivery với
-- stock_entry gốc (idempotent — re-self-deliver cùng entry không
-- duplicate). Nullable cho legacy deliveries.
-- ====================================================================

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS source_stock_entry_id uuid
    REFERENCES stock_entries(id) ON DELETE SET NULL;

-- 1 delivery per stock_entry; lookup nhanh khi self-deliver retry.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deliveries_source_stock_entry
  ON deliveries (source_stock_entry_id)
  WHERE source_stock_entry_id IS NOT NULL;

COMMENT ON COLUMN deliveries.source_stock_entry_id IS
  'Self-deliver flow (NPP/chủ xe tự giao) tạo delivery này từ 1 stock_entry. UNIQUE để re-trigger không duplicate. Legacy deliveries (lái xe) → null.';
