-- ====================================================================
-- KHÁM CHẬM PHÍA MÁY CHỦ (POS, xuất hàng, danh sách) — chủ nhà 03/11/2026:
--   · "phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo lỗi quá 10s"
--   · khách NPP 18:07–18:25: "Loát chậm quá" · "Mất 3 phút" · bấm Xuất hàng lúc chậm, vào lại thì đơn đã Hoàn thành.
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run. CHỈ ĐỌC (thống kê có sẵn của Postgres), không đụng dữ liệu.
-- Gửi lại kết quả CẢ SÁU PHẦN (chụp màn hoặc copy) — không có khoá / mật khẩu nào trong đó.
-- Phần 5 chỉ có ý nghĩa khi chạy ĐÚNG LÚC đang chậm (nó chụp tình trạng ngay lúc chạy).
--
-- ĐỌC KẾT QUẢ:
--   Phần 1 — các câu POS dùng khi nạp đơn / danh sách: `trung_binh_ms` / `lau_nhat_ms` cao (hàng trăm → nghìn ms) là máy chủ
--            chậm thật.
--   Phần 2 — 15 câu tốn máy chủ nhất cả hệ thống: câu nặng chạy cùng lúc làm MỌI câu khác phải chờ (kể cả POS).
--   Phần 3 — kết nối đang mở: nhiều `active` / `idle in transaction` lâu là hàng đợi đầy, câu mới phải chờ chỗ.
--   Phần 4 — XUẤT HÀNG / SỬA HĐ / LƯU ĐƠN: `lau_nhat_ms` > 10.000 là đúng ca khách gặp (màn cũ bỏ chờ ở giây 10, máy chủ vẫn
--            ghi xong). `doc_dia` lớn = phải đọc đĩa nhiều (hết bộ nhớ đệm / hết hạn mức IO của gói Supabase).
--   Phần 5 — ĐANG CHỜ KHOÁ ngay lúc chạy: dòng nào ở đây là câu bị câu khác giữ khoá (`bi_chan_boi` = pid đang giữ).
--   Phần 6 — tỉ lệ đọc từ bộ nhớ đệm của cả sổ: dưới ~99% là đọc đĩa nhiều — xem thêm Supabase → Reports → Database
--            (CPU, Memory, Disk IO budget) đúng khung giờ chậm.
-- (Số liệu phần 1, 2, 4, 6 cộng dồn từ lần thống kê được đặt lại gần nhất.)
-- ====================================================================

-- PHẦN 1: các câu của đường nạp đơn vào POS + danh sách đơn / hoá đơn
SELECT '1. CÂU CỦA POS / DANH SÁCH' AS phan,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 160) AS cau,
       s.calls AS so_lan,
       round(s.mean_exec_time::numeric, 1) AS trung_binh_ms,
       round(s.max_exec_time::numeric, 1) AS lau_nhat_ms,
       round(s.total_exec_time::numeric / 1000, 1) AS tong_giay
FROM extensions.pg_stat_statements s
WHERE s.query ~* '(get_invoiceable_lines|ton_ban_theo_hang|danh_muc_ban_phien|v_hoa_don_con_lai|from "public"\."(sales_orders|sales_invoices|returns|products|customers)")'
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

-- PHẦN 4: các lệnh GHI của bán hàng — xuất hàng, sửa / huỷ hoá đơn, lưu đơn, phiếu thu
SELECT '4. XUẤT HÀNG / LƯU' AS phan,
       substring(s.query FROM '(post_invoice|reissue_invoice|cancel_invoice|create_order_with_lines|update_order_with_lines|create_cash_receipt[a-z_]*|post_cash_receipt[a-z_]*)') AS ham,
       s.calls AS so_lan,
       round(s.mean_exec_time::numeric, 1) AS trung_binh_ms,
       round(s.max_exec_time::numeric, 1) AS lau_nhat_ms,
       round(s.total_exec_time::numeric / 1000, 1) AS tong_giay,
       s.shared_blks_read AS doc_dia,
       s.shared_blks_hit AS doc_dem
FROM extensions.pg_stat_statements s
WHERE s.query ~* '(post_invoice|reissue_invoice|cancel_invoice|create_order_with_lines|update_order_with_lines|create_cash_receipt|post_cash_receipt)'
ORDER BY s.max_exec_time DESC
LIMIT 20;

-- PHẦN 5: câu ĐANG CHỜ khoá ngay lúc chạy — và câu nào đang giữ khoá chặn nó
SELECT '5. ĐANG CHỜ KHOÁ' AS phan,
       a.pid,
       pg_blocking_pids(a.pid) AS bi_chan_boi,
       a.wait_event_type AS loai_cho,
       a.wait_event AS cho_gi,
       round(extract(epoch FROM now() - a.query_start)::numeric, 1) AS da_chay_giay,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 160) AS cau
FROM pg_stat_activity a
WHERE a.backend_type = 'client backend'
  AND a.state = 'active'
  AND (cardinality(pg_blocking_pids(a.pid)) > 0 OR a.wait_event_type IN ('Lock', 'IO', 'LWLock'))
ORDER BY da_chay_giay DESC
LIMIT 30;

-- PHẦN 6: tỉ lệ đọc từ bộ nhớ đệm (cache) của sổ — thấp là đọc đĩa nhiều
SELECT '6. BỘ NHỚ ĐỆM' AS phan,
       d.datname AS so,
       round(100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0), 2) AS ti_le_dem_phan_tram,
       d.blks_read AS khoi_doc_dia,
       d.deadlocks AS ket_khoa,
       d.temp_files AS tep_tam,
       pg_size_pretty(d.temp_bytes) AS dung_luong_tep_tam,
       pg_size_pretty(pg_database_size(d.datname)) AS dung_luong_so,
       d.stats_reset AS thong_ke_tu
FROM pg_stat_database d
WHERE d.datname = current_database();
