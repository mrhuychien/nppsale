-- ====================================================================
-- 038_delivery_goods_handover
--
-- Khi tài xế giao về kho, ngoài "Bàn giao tiền" cần thêm "Bàn giao
-- hàng" — thủ kho xác nhận đã nhận lại các SP khách trả / đổi.
-- Mig này thêm cột tracking cho deliveries.
-- ====================================================================

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS goods_handover_at timestamptz,
  ADD COLUMN IF NOT EXISTS goods_handover_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS goods_handover_notes text;

COMMENT ON COLUMN deliveries.goods_handover_at IS
  'Thời điểm thủ kho xác nhận nhận lại hàng trả / đổi từ tài xế.';
COMMENT ON COLUMN deliveries.goods_handover_by IS
  'Thủ kho / người nhận hàng về.';
