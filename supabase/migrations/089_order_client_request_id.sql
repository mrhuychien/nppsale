-- ====================================================================
-- 089_order_client_request_id
--
-- Hỗ trợ tạo đơn OFFLINE: máy lưu đơn cục bộ khi mất mạng rồi đẩy lên
-- khi có mạng. Mỗi đơn offline mang 1 client_request_id (UUID sinh ở
-- máy). Khi đồng bộ có thể thử lại nhiều lần (mạng chập chờn) → cần
-- chống tạo trùng: unique index trên client_request_id đảm bảo cùng 1
-- đơn chỉ vào DB đúng 1 lần.
-- ====================================================================

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_client_request_id
  ON sales_orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN sales_orders.client_request_id IS
  'UUID sinh tại thiết bị cho đơn tạo offline. Unique để đồng bộ idempotent (thử lại không tạo trùng). NULL cho đơn tạo online thông thường.';
