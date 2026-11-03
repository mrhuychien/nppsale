-- Bộ thử câu khám bộ nhớ (supabase/diagnostics/kham_bo_nho.sql) — chạy trong MỘT giao dịch rồi ROLLBACK, không để lại gì.
--   Dựng bảng giả của Realtime (realtime.subscription) + pg_cron (cron.job, cron.job_run_details) như trên Supabase rồi chạy
--   câu khám hai lượt: (1) vai đủ quyền — phải đọc ra số đăng ký / lịch chạy / số dòng lịch sử; (2) vai THƯỜNG không có
--   USAGE schema cron, không có SELECT realtime.subscription — câu không được hỏng, dòng ấy ghi "không có quyền đọc".
--   Chạy: psql -q -At -F ' | ' -f scripts/sql/thu-kham-bo-nho.sql (trên sổ CHƯA có schema realtime / cron — sổ thử).
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA realtime;
CREATE SCHEMA cron;
CREATE TABLE realtime.subscription (
  id bigserial PRIMARY KEY, subscription_id uuid, entity regclass, filters text, claims jsonb,
  created_at timestamp DEFAULT timezone('utc', now())
);
INSERT INTO realtime.subscription (subscription_id, entity, created_at) VALUES
  (gen_random_uuid(), 'public.notifications', timezone('utc', now()) - interval '95 minutes'),
  (gen_random_uuid(), 'public.notifications', timezone('utc', now()) - interval '5 minutes'),
  (gen_random_uuid(), 'public.entity_locks', timezone('utc', now()) - interval '2 minutes');
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, active boolean DEFAULT true, jobname text);
INSERT INTO cron.job (schedule, command, jobname) VALUES
  ('* * * * *', ' SELECT public.release_stale_entity_locks(); ', 'release-stale-entity-locks');
CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, start_time timestamptz, end_time timestamptz, status text);
INSERT INTO cron.job_run_details (jobid, start_time)
  SELECT 1, now() - make_interval(mins => g) FROM generate_series(1, 1440) g;
CREATE ROLE kham_bo_nho_thuong;
-- realtime: có USAGE schema, KHÔNG có SELECT bảng → phép kiểm quyền bảng phải chặn.
-- cron: có SELECT bảng, KHÔNG có USAGE schema → phép kiểm quyền schema phải chặn (đọc thẳng là "permission denied for schema").
GRANT USAGE ON SCHEMA extensions, realtime TO kham_bo_nho_thuong;
GRANT SELECT ON ALL TABLES IN SCHEMA cron TO kham_bo_nho_thuong;

\echo === DU_QUYEN
\ir ../../supabase/diagnostics/kham_bo_nho.sql
SET LOCAL ROLE kham_bo_nho_thuong;
\echo === VAI_THUONG
\ir ../../supabase/diagnostics/kham_bo_nho.sql
RESET ROLE;
ROLLBACK;
\echo === XONG
