-- ====================================================================
-- fix: customers.channel CHECK chặn update.
--
-- Mig 001 đặt: channel text CHECK (channel IN ('GT','MT','HORECA')).
-- UI hiện tại đã chuyển channel sang lưu MÃ TUYẾN BÁN (sales_routes.
-- code, vd "R001") → mọi update mới đều vi phạm CHECK → form khách
-- hàng "không cập nhật được". Bỏ CHECK; cột vẫn text tự do.
-- ====================================================================

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_channel_check;

COMMENT ON COLUMN customers.channel IS
  'Mã tuyến bán của khách (sales_routes.code). Tên cột giữ legacy "channel".';
