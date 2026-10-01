-- ====================================================================
-- 221 — NHẮC CẬP NHẬT TUYẾN CHO KHÁCH CHƯA GÁN TUYẾN
--
-- VÌ SAO — chủ nhà 01/10/2026 (màn Thêm khách hàng trên điện thoại): "Tuyến -> trường bắt buộc" ·
--   "Khách hàng nào chưa gán tuyến push noti yêu cầu cập nhật tuyến".
--   Khách tạo từ trước chưa có tuyến (customers.channel trống). Cron chung hằng ngày
--   (`/api/customers/route-reminders`) gửi thông báo vào chuông cho NVBH phụ trách chính — chưa ai
--   phụ trách thì chủ NPP / quản lý — mở thẳng danh sách "Chưa có tuyến" (`/customers?tuyen=chua`).
--
-- CÁCH LÀM
--   1. Loại thông báo `customer_route_missing` (giữ nguyên các loại của mig 124).
--   2. Cột `customers.route_reminder_sent_at` — hạ nhiệt từng khách, không nhắc lặp mỗi sáng.
--   Không ép NOT NULL ở DB: khách cũ chưa có tuyến vẫn phải ghi được (sửa tên, thu nợ…); bắt buộc tuyến
--   ở form tạo / sửa khách.
-- ====================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS route_reminder_sent_at timestamptz;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',
    'invoice_cancelled',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'customer_route_missing',
    'info'
  ));

NOTIFY pgrst, 'reload schema';

SELECT 'mig 221: nhắc khách chưa gán tuyến' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'customers'
                           AND column_name = 'route_reminder_sent_at')
             AND position('customer_route_missing' IN (
                   SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                   WHERE c.conname = 'notifications_type_check')) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM customers WHERE status = 'active' AND coalesce(trim(channel), '') = '') AS khach_chua_tuyen;
