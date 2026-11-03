-- ====================================================================
-- KHÁM CHẬM PHÍA MÁY CHỦ (POS, xuất hàng, danh sách, báo cáo) — chủ nhà 03/11/2026:
--   · "phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo lỗi quá 10s"
--   · khách NPP 18:07–18:25: "Loát chậm quá" · "Mất 3 phút" · bấm Xuất hàng lúc chậm, vào lại thì đơn đã Hoàn thành.
--   · Log Supabase cùng ngày: 101 câu bị Postgres huỷ vì quá hạn 8 giây (dồn vào 8h / 10h / 18h), kể cả `post_invoice`;
--     và sổ 58 MB mà từ 30/03 đã ghi 340.260 tệp tạm / 1.044 GB — có câu sắp xếp / gộp tràn bộ nhớ, ghi ra đĩa.
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run. CHỈ ĐỌC (thống kê có sẵn của Postgres), không đụng dữ liệu.
--   ⚠ Đây là MỘT câu duy nhất — SQL Editor chỉ hiện kết quả của câu CUỐI (bản nhiều câu trước đây chỉ hiện phần 6).
--   Gửi lại cả bảng kết quả: nút "Export" → JSON (hoặc CSV). Không có khoá / mật khẩu nào trong đó.
--
-- ĐỌC KẾT QUẢ (cột `phan`):
--   1. GHI TỆP TẠM NHIỀU NHẤT — thủ phạm của 1.044 GB: `tam_moi_lan_kb` lớn + `so_lan` lớn là câu cần sửa trước.
--   2. TỐN MÁY NHẤT — tổng thời gian: câu nặng chạy cùng lúc làm MỌI câu khác phải chờ.
--   3. CHẬM NHẤT (TRUNG BÌNH) — câu nào trung bình đã gần ngưỡng 8 giây.
--   4. PHIẾU TRẢ / XUẤT HÀNG / BÁO CÁO — các câu bị huỷ trong log 18h (phiếu trả theo đơn, post_invoice, bao_cao_*).
--   5. CÀI ĐẶT — work_mem (nhỏ là dễ tràn ra tệp tạm), statement_timeout của từng vai.
--   6. BẢNG ĐỌC TUẦN TỰ NHIỀU — bảng bị quét cả bảng nhiều lần (thiếu chỉ mục / RLS tính từng dòng).
--   7. CẢ SỔ — bộ nhớ đệm, tệp tạm, kết khoá, dung lượng.
--   8. KẾT NỐI / 9. ĐANG CHỜ — chỉ có ý nghĩa khi chạy ĐÚNG LÚC đang chậm.
-- (Phần 1–4, 6–7 cộng dồn từ lần thống kê được đặt lại gần nhất. Câu bị huỷ vì quá hạn KHÔNG được đếm ở phần 1–4.)
-- ====================================================================
WITH
ss AS (
  SELECT s.*, left(regexp_replace(s.query, '\s+', ' ', 'g'), 220) AS cau_gon
  FROM extensions.pg_stat_statements s
),
p1 AS (
  SELECT '1. GHI TỆP TẠM NHIỀU NHẤT'::text AS phan, row_number() OVER (ORDER BY temp_blks_written DESC) AS hang,
         cau_gon AS cau, calls AS so_lan,
         round(mean_exec_time::numeric, 1) AS tb_ms, round(max_exec_time::numeric, 1) AS max_ms,
         round(total_exec_time::numeric / 1000, 1) AS tong_giay,
         round(temp_blks_written * 8 / 1024.0, 1) AS tam_ghi_mb,
         round(temp_blks_written * 8.0 / nullif(calls, 0), 1) AS tam_moi_lan_kb,
         NULL::text AS ghi_chu
  FROM ss WHERE temp_blks_written > 0
  ORDER BY temp_blks_written DESC LIMIT 20
),
p2 AS (
  SELECT '2. TỐN MÁY NHẤT', row_number() OVER (ORDER BY total_exec_time DESC),
         cau_gon, calls, round(mean_exec_time::numeric, 1), round(max_exec_time::numeric, 1),
         round(total_exec_time::numeric / 1000, 1), round(temp_blks_written * 8 / 1024.0, 1),
         round(temp_blks_written * 8.0 / nullif(calls, 0), 1), NULL::text
  FROM ss ORDER BY total_exec_time DESC LIMIT 15
),
p3 AS (
  SELECT '3. CHẬM NHẤT (TRUNG BÌNH)', row_number() OVER (ORDER BY mean_exec_time DESC),
         cau_gon, calls, round(mean_exec_time::numeric, 1), round(max_exec_time::numeric, 1),
         round(total_exec_time::numeric / 1000, 1), round(temp_blks_written * 8 / 1024.0, 1),
         round(temp_blks_written * 8.0 / nullif(calls, 0), 1), NULL::text
  FROM ss WHERE calls >= 3 ORDER BY mean_exec_time DESC LIMIT 15
),
p4 AS (
  SELECT '4. PHIẾU TRẢ / XUẤT HÀNG / BÁO CÁO', row_number() OVER (ORDER BY max_exec_time DESC),
         cau_gon, calls, round(mean_exec_time::numeric, 1), round(max_exec_time::numeric, 1),
         round(total_exec_time::numeric / 1000, 1), round(temp_blks_written * 8 / 1024.0, 1),
         round(temp_blks_written * 8.0 / nullif(calls, 0), 1), NULL::text
  FROM ss
  WHERE query ~* '("returns"|"return_lines"|post_invoice|reissue_invoice|get_invoiceable_lines|bao_cao_|v_hoa_don_con_lai)'
  ORDER BY max_exec_time DESC LIMIT 20
),
p5 AS (
  SELECT '5. CÀI ĐẶT', row_number() OVER (ORDER BY ten), ten, NULL::bigint, NULL::numeric, NULL::numeric,
         NULL::numeric, NULL::numeric, NULL::numeric, gia_tri
  FROM (
    SELECT 'work_mem' AS ten, current_setting('work_mem') AS gia_tri
    UNION ALL SELECT 'shared_buffers', current_setting('shared_buffers')
    UNION ALL SELECT 'max_connections', current_setting('max_connections')
    UNION ALL SELECT 'temp_file_limit', current_setting('temp_file_limit')
    UNION ALL SELECT 'log_temp_files', current_setting('log_temp_files')
    UNION ALL SELECT 'server_version', current_setting('server_version')
    UNION ALL
    SELECT 'vai ' || r.rolname, array_to_string(s.setconfig, ', ')
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
    WHERE r.rolname IN ('authenticated', 'anon', 'authenticator', 'service_role', 'postgres')
  ) c
),
p6 AS (
  SELECT '6. BẢNG ĐỌC TUẦN TỰ NHIỀU', row_number() OVER (ORDER BY t.seq_tup_read DESC),
         t.relname::text, t.seq_scan, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
         format('đọc tuần tự %s dòng · dùng chỉ mục %s lần · %s dòng sống · %s',
                t.seq_tup_read, coalesce(t.idx_scan, 0), t.n_live_tup, pg_size_pretty(pg_total_relation_size(t.relid)))
  FROM pg_stat_user_tables t
  ORDER BY t.seq_tup_read DESC LIMIT 15
),
p7 AS (
  SELECT '7. CẢ SỔ', 1::bigint, d.datname::text, d.temp_files, NULL::numeric, NULL::numeric, NULL::numeric,
         round(d.temp_bytes / 1048576.0, 1), NULL::numeric,
         format('bộ nhớ đệm %s%% · đọc đĩa %s khối · kết khoá %s · sổ %s · thống kê từ %s',
                round(100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0), 2), d.blks_read, d.deadlocks,
                pg_size_pretty(pg_database_size(d.datname)), d.stats_reset)
  FROM pg_stat_database d WHERE d.datname = current_database()
),
p8 AS (
  SELECT '8. KẾT NỐI', row_number() OVER (ORDER BY count(*) DESC), a.usename::text || ' · ' || coalesce(a.state, '?'),
         count(*), NULL::numeric,
         round(max(extract(epoch FROM now() - coalesce(a.xact_start, a.state_change)))::numeric * 1000, 0),
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::text
  FROM pg_stat_activity a WHERE a.backend_type = 'client backend'
  GROUP BY a.usename, a.state
),
p9 AS (
  SELECT '9. ĐANG CHỜ', row_number() OVER (ORDER BY a.query_start), left(regexp_replace(a.query, '\s+', ' ', 'g'), 220),
         a.pid::bigint, NULL::numeric, round(extract(epoch FROM now() - a.query_start)::numeric * 1000, 0),
         NULL::numeric, NULL::numeric, NULL::numeric,
         format('chờ %s / %s · bị chặn bởi %s', coalesce(a.wait_event_type, '-'), coalesce(a.wait_event, '-'), pg_blocking_pids(a.pid))
  FROM pg_stat_activity a
  WHERE a.backend_type = 'client backend' AND a.state = 'active' AND a.pid <> pg_backend_pid()
    AND (cardinality(pg_blocking_pids(a.pid)) > 0 OR a.wait_event_type IN ('Lock', 'IO', 'LWLock')
         OR now() - a.query_start > interval '2 seconds')
)
SELECT * FROM (
  SELECT * FROM p1 UNION ALL SELECT * FROM p2 UNION ALL SELECT * FROM p3 UNION ALL SELECT * FROM p4
  UNION ALL SELECT * FROM p5 UNION ALL SELECT * FROM p6 UNION ALL SELECT * FROM p7 UNION ALL SELECT * FROM p8
  UNION ALL SELECT * FROM p9
) k
ORDER BY phan, hang;
