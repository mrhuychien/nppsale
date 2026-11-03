-- ====================================================================
-- KHÁM BỘ NHỚ MÁY SỔ — chủ nhà 03/11/2026 gửi Observability → Database: gói Free, RAM 409 MB, Swap ~800 MB cả ngày,
--   Memory commitment 1,94 GB (SEVERE); rồi: "đéo phải, mày chưa nghĩ hết cách". Câu này đếm những gì bên trong Postgres
--   đang giữ bộ nhớ / việc mà PHÍA MÌNH bớt được: kết nối theo từng dịch vụ, khe nhật ký + bảng theo dõi thay đổi + đăng ký
--   của Realtime (chuông thông báo, khoá sửa đơn dùng postgres_changes), lịch chạy nền pg_cron (+ sổ lịch sử chạy), tiện ích,
--   cài đặt bộ nhớ, câu được gọi nhiều nhất, bảng lớn nhất ở MỌI schema, tỉ lệ đọc trúng bộ đệm.
--
-- CÁCH DÙNG: chạy lúc ĐÔNG NGƯỜI (khoảng 9h hoặc 18h) — dán cả tệp vào Supabase → SQL Editor → Run. CHỈ ĐỌC.
--   ⚠ MỘT câu duy nhất (SQL Editor chỉ hiện kết quả câu cuối). Gửi lại cả bảng: nút "Export" → JSON hoặc CSV.
--   Không có khoá / mật khẩu nào trong kết quả.
--   Bảng của Realtime / pg_cron chỉ đọc khi có bảng VÀ có quyền đọc (query_to_xml sau phép kiểm) — thiếu thì dòng ấy ghi
--   "không có bảng" / "không có quyền đọc", cả câu không hỏng.
-- ====================================================================
WITH
bang AS (  -- bảng tuỳ chọn: tra qua catalog (không cần quyền), chỉ đọc khi có USAGE schema + SELECT bảng
  SELECT v.s || '.' || v.t AS k, c.oid AS oid,
         coalesce(c.oid IS NOT NULL AND has_schema_privilege(c.relnamespace, 'USAGE') AND has_table_privilege(c.oid, 'SELECT'),
                  false) AS doc_duoc
    FROM (VALUES ('realtime', 'subscription'), ('cron', 'job'), ('cron', 'job_run_details'),
                 ('extensions', 'pg_stat_statements_info')) v(s, t)
    LEFT JOIN pg_namespace n ON n.nspname = v.s
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = v.t
),
c1 AS (  -- 1. Kết nối đang mở: ai giữ, bao nhiêu, cũ nhất bao lâu
  SELECT '1. KẾT NỐI'::text AS phan,
         row_number() OVER (ORDER BY count(*) DESC) AS hang,
         coalesce(a.usename::text, '-') || ' · ' || coalesce(nullif(a.application_name, ''), '-') || ' · '
           || coalesce(a.backend_type, '-') || ' · ' || coalesce(a.state, '-') AS ten,
         count(*)::numeric AS so,
         'cũ nhất ' || round(max(extract(epoch FROM now() - a.backend_start)) / 60) || ' phút' AS ghi_chu
    FROM pg_stat_activity a
   GROUP BY a.usename, a.application_name, a.backend_type, a.state
),
c2 AS (  -- 2. Khe nhật ký thay đổi (Realtime dùng để báo thay đổi cho trình duyệt)
  SELECT '2. KHE NHẬT KÝ (Realtime)', row_number() OVER (ORDER BY s.slot_name), s.slot_name::text || ' · ' || coalesce(s.plugin, '-'),
         NULL::numeric,
         CASE WHEN s.active THEN 'ĐANG CHẠY' ELSE 'không chạy' END || ' · giữ nhật ký '
           || coalesce(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), s.restart_lsn)), '?')
    FROM pg_replication_slots s
),
c3 AS (  -- 3. Bảng đang được theo dõi thay đổi (mỗi lần ghi bảng này máy sổ phải giải nhật ký cho Realtime)
  SELECT '3. BẢNG THEO DÕI THAY ĐỔI', row_number() OVER (ORDER BY p.pubname, p.schemaname, p.tablename),
         p.pubname::text || ' → ' || p.schemaname || '.' || p.tablename, NULL::numeric, ''
    FROM pg_publication_tables p
),
c4 AS (  -- 4. Tiện ích đang bật
  SELECT '4. TIỆN ÍCH', row_number() OVER (ORDER BY e.extname), e.extname::text, NULL::numeric, 'bản ' || e.extversion
    FROM pg_extension e
),
c5 AS (  -- 5. Cài đặt bộ nhớ của Postgres
  SELECT '5. CÀI ĐẶT', row_number() OVER (ORDER BY s.name), s.name::text, NULL::numeric,
         s.setting || coalesce(' ' || s.unit, '') || ' (= ' || current_setting(s.name) || ')'
    FROM pg_settings s
   WHERE s.name IN ('shared_buffers', 'work_mem', 'maintenance_work_mem', 'logical_decoding_work_mem', 'max_connections',
                    'effective_cache_size', 'max_worker_processes', 'autovacuum_max_workers', 'autovacuum_work_mem',
                    'max_wal_senders', 'max_replication_slots', 'huge_pages', 'temp_buffers', 'wal_buffers',
                    'shared_preload_libraries', 'max_parallel_workers_per_gather', 'idle_session_timeout',
                    'cron.max_running_jobs', 'cron.use_background_workers', 'pg_net.batch_size')
),
c6 AS (  -- 6. Câu được gọi NHIỀU NHẤT (hỏi định kỳ, câu nhỏ lặp lại) — cộng dồn từ lần đặt lại thống kê gần nhất
  SELECT '6. GỌI NHIỀU NHẤT', row_number() OVER (ORDER BY s.calls DESC),
         left(regexp_replace(s.query, '\s+', ' ', 'g'), 200), s.calls::numeric,
         'TB ' || round(s.mean_exec_time::numeric, 1) || ' ms · tổng ' || round(s.total_exec_time::numeric / 1000) || ' s · '
           || coalesce((SELECT r.rolname::text FROM pg_roles r WHERE r.oid = s.userid), '?')
    FROM extensions.pg_stat_statements s
   ORDER BY s.calls DESC
   LIMIT 20
),
c7 AS (  -- 7. Bảng lớn nhất ở MỌI schema (cả cron / auth / realtime / net / storage)
  SELECT '7. BẢNG LỚN NHẤT', row_number() OVER (ORDER BY pg_total_relation_size(c.oid) DESC),
         n.nspname::text || '.' || c.relname, round(pg_total_relation_size(c.oid) / 1048576.0, 1),
         'MB · ' || coalesce(c.reltuples::bigint, 0) || ' dòng (ước)'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'm', 't') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
   ORDER BY pg_total_relation_size(c.oid) DESC
   LIMIT 15
),
c8 AS (  -- 8. Tổng quát: số tiến trình Postgres, cỡ sổ, đọc trúng bộ đệm, số hàm / bảng / chính sách PostgREST phải nạp
  SELECT '8. TỔNG QUÁT', 1::bigint, 'tiến trình Postgres đang có', (SELECT count(*) FROM pg_stat_activity)::numeric,
         'trong đó kết nối của app (authenticator): ' || (SELECT count(*) FROM pg_stat_activity WHERE usename = 'authenticator')
  UNION ALL SELECT '8. TỔNG QUÁT', 2, 'cỡ sổ', round(pg_database_size(current_database()) / 1048576.0, 1), 'MB'
  UNION ALL SELECT '8. TỔNG QUÁT', 3, 'đọc trúng bộ đệm (shared_buffers)',
         (SELECT round(100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0), 2) FROM pg_stat_database d
           WHERE d.datname = current_database())::numeric,
         '% · đọc đĩa ' || (SELECT d.blks_read FROM pg_stat_database d WHERE d.datname = current_database()) || ' khối từ '
           || coalesce((SELECT d.stats_reset::text FROM pg_stat_database d WHERE d.datname = current_database()), 'lúc khởi động')
  UNION ALL SELECT '8. TỔNG QUÁT', 4, 'hàm ở schema public (PostgREST nạp hết vào bộ nhớ)',
         (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)::numeric, ''
  UNION ALL SELECT '8. TỔNG QUÁT', 5, 'bảng + view ở schema public',
         (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v', 'm', 'p'))::numeric, ''
  UNION ALL SELECT '8. TỔNG QUÁT', 6, 'chính sách RLS', (SELECT count(*) FROM pg_policy)::numeric, ''
  UNION ALL SELECT '8. TỔNG QUÁT', 7, 'thống kê câu (phần 6) đặt lại lúc', NULL::numeric,
         CASE WHEN NOT (SELECT b.doc_duoc FROM bang b WHERE b.k = 'extensions.pg_stat_statements_info') THEN '?'
              ELSE coalesce((xpath('/row/t/text()', query_to_xml(
                     'SELECT stats_reset::text AS t FROM extensions.pg_stat_statements_info', false, true, '')))[1]::text, '?') END
),
c9 AS (  -- 9. Đăng ký Realtime đang giữ trên máy sổ (mỗi tab mở chuông / màn sửa đơn = một đăng ký postgres_changes)
  SELECT '9. ĐĂNG KÝ REALTIME'::text, 0::bigint, 'tổng số đăng ký'::text,
         CASE WHEN b.doc_duoc
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM realtime.subscription', false, true, '')))[1]::text::numeric
         END,
         CASE WHEN b.oid IS NULL THEN 'không có bảng'
              WHEN NOT b.doc_duoc THEN 'không có quyền đọc · cỡ bảng ' || pg_size_pretty(pg_total_relation_size(b.oid))
              ELSE 'cỡ bảng ' || pg_size_pretty(pg_total_relation_size(b.oid)) END
    FROM bang b WHERE b.k = 'realtime.subscription'
  UNION ALL
  SELECT '9. ĐĂNG KÝ REALTIME', row_number() OVER (),
         (xpath('/row/t/text()', r))[1]::text, (xpath('/row/n/text()', r))[1]::text::numeric,
         'cũ nhất ' || coalesce((xpath('/row/p/text()', r))[1]::text, '?') || ' phút'
    FROM unnest(CASE WHEN (SELECT b.doc_duoc FROM bang b WHERE b.k = 'realtime.subscription')
                     THEN xpath('/table/row', query_to_xml(
                       'SELECT entity::text AS t, count(*) AS n, round(extract(epoch FROM now() - min(created_at)) / 60) AS p '
                       || 'FROM realtime.subscription GROUP BY 1 ORDER BY 2 DESC', false, false, ''))
                     ELSE ARRAY[]::xml[] END) r
),
c10 AS (  -- 10. Lịch chạy nền pg_cron + sổ lịch sử chạy (mỗi lượt chạy = một kết nối mới + hai lần ghi)
  SELECT '10. LỊCH CHẠY NỀN'::text, row_number() OVER (),
         coalesce((xpath('/row/t/text()', r))[1]::text, '-') || ' · ' || coalesce((xpath('/row/s/text()', r))[1]::text, '-'),
         NULL::numeric,
         coalesce((xpath('/row/a/text()', r))[1]::text, '?') || ' · ' || coalesce((xpath('/row/l/text()', r))[1]::text, '')
    FROM unnest(CASE WHEN (SELECT b.doc_duoc FROM bang b WHERE b.k = 'cron.job')
                     THEN xpath('/table/row', query_to_xml(
                       'SELECT jobname AS t, schedule AS s, CASE WHEN active THEN ''đang bật'' ELSE ''đã tắt'' END AS a, '
                       || 'left(regexp_replace(command, ''\s+'', '' '', ''g''), 120) AS l FROM cron.job ORDER BY jobid', false, false, ''))
                     ELSE ARRAY[]::xml[] END) r
  UNION ALL
  SELECT '10. LỊCH CHẠY NỀN', 100, 'sổ lịch sử chạy (cron.job_run_details)',
         CASE WHEN b.doc_duoc
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM cron.job_run_details', false, true, '')))[1]::text::numeric
         END,
         CASE WHEN b.oid IS NULL THEN 'không có pg_cron'
              WHEN NOT b.doc_duoc THEN 'không có quyền đọc · cỡ bảng ' || pg_size_pretty(pg_total_relation_size(b.oid))
              ELSE 'dòng · ' || pg_size_pretty(pg_total_relation_size(b.oid)) || ' · từ '
                   || coalesce((xpath('/row/t/text()', query_to_xml(
                        'SELECT min(start_time)::date::text AS t FROM cron.job_run_details', false, true, '')))[1]::text, '?') END
    FROM bang b WHERE b.k = 'cron.job_run_details'
)
SELECT * FROM (
  SELECT * FROM c1 UNION ALL SELECT * FROM c2 UNION ALL SELECT * FROM c3 UNION ALL SELECT * FROM c4
  UNION ALL SELECT * FROM c5 UNION ALL SELECT * FROM c6 UNION ALL SELECT * FROM c7 UNION ALL SELECT * FROM c8
  UNION ALL SELECT * FROM c9 UNION ALL SELECT * FROM c10
) k
ORDER BY split_part(phan, '.', 1)::int, hang;
