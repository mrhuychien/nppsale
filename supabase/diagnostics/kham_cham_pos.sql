-- ====================================================================
-- KHÁM CHẬM KHI NẠP ĐƠN VÀO POS — chủ nhà 03/11/2026: "phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo lỗi quá 10s".
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run. CHỈ ĐỌC (thống kê có sẵn của Postgres), không đụng dữ liệu.
-- Gửi lại kết quả CẢ BA PHẦN (chụp màn hoặc copy) — không có khoá / mật khẩu nào trong đó.
--
-- ĐỌC KẾT QUẢ:
--   Phần 1 — các câu POS dùng khi nạp đơn: `trung_binh_ms` / `lau_nhat_ms` cao (hàng trăm → nghìn ms) là máy chủ chậm thật.
--   Phần 2 — 15 câu tốn máy chủ nhất cả hệ thống: câu nặng chạy cùng lúc làm MỌI câu khác phải chờ (kể cả POS).
--   Phần 3 — kết nối đang mở: nhiều `active` / `idle in transaction` lâu là hàng đợi đầy, câu mới phải chờ chỗ.
-- (Số liệu phần 1–2 cộng dồn từ lần thống kê được đặt lại gần nhất.)
-- ====================================================================

-- PHẦN 1: các câu của đường nạp đơn vào POS
SELECT '1. CÂU CỦA POS' AS phan,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 160) AS cau,
       s.calls AS so_lan,
       round(s.mean_exec_time::numeric, 1) AS trung_binh_ms,
       round(s.max_exec_time::numeric, 1) AS lau_nhat_ms,
       round(s.total_exec_time::numeric / 1000, 1) AS tong_giay
FROM extensions.pg_stat_statements s
WHERE s.query ~* '(get_invoiceable_lines|ton_ban_theo_hang|danh_muc_ban_phien|from "public"\."(sales_orders|sales_invoices|returns|products|customers)")'
ORDER BY s.max_exec_time DESC
LIMIT 20;

-- PHẦN 2: 15 câu tốn máy chủ nhất (tổng thời gian)
SELECT '2. TỐN MÁY NHẤT' AS phan,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 160) AS cau,
       s.calls AS so_lan,
       round(s.mean_exec_time::numeric, 1) AS trung_binh_ms,
       round(s.max_exec_time::numeric, 1) AS lau_nhat_ms,
       round(s.total_exec_time::numeric / 1000, 1) AS tong_giay
FROM extensions.pg_stat_statements s
ORDER BY s.total_exec_time DESC
LIMIT 15;

-- PHẦN 3: kết nối đang mở ngay lúc chạy (theo vai + trạng thái)
SELECT '3. KẾT NỐI' AS phan,
       a.usename AS vai,
       coalesce(a.state, '?') AS trang_thai,
       count(*) AS so_ket_noi,
       round(max(extract(epoch FROM now() - coalesce(a.xact_start, a.state_change)))::numeric, 1) AS lau_nhat_giay
FROM pg_stat_activity a
WHERE a.backend_type = 'client backend'
GROUP BY a.usename, a.state
ORDER BY so_ket_noi DESC;
