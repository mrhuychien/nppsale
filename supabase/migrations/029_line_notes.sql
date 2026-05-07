-- ====================================================================
-- 029_line_notes
--
-- Update #2 v2 §4.1 — Ghi chú per-dòng-SP.
--
-- Mỗi dòng đơn bán / đơn trả có 1 trường note để NV ghi yêu cầu cụ
-- thể (vd. "Khách yêu cầu hàng SX sau 03/2025", "Đóng riêng thùng",
-- "Lấy đúng lô A123"...). Hiển thị trên phiếu giao và phiếu xuất kho.
-- ====================================================================

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN sales_order_lines.note IS
  'Ghi chú riêng cho dòng SP (in trên phiếu giao, phiếu xuất).';
COMMENT ON COLUMN return_lines.note IS
  'Ghi chú riêng cho dòng SP trả (lý do trả, tình trạng...).';
