-- ====================================================================
-- TẮT JIT Ở VAI ĐĂNG NHẬP CỦA API (authenticator) VÀ VAI anon — bổ sung cho mig 251
--
-- VÌ SAO — chủ nhà 24/10/2026 gửi bảng pg_stat_statements của sổ thật: MỌI dạng câu của danh sách Hoá đơn bán mất
--   ~3 giây một câu (10 dạng câu, ≈5.000 lượt, ≈4 giờ máy chủ), ba RPC trang tổng quan 0,5–0,85 giây. Tái hiện trên sổ
--   thử 40.000 hoá đơn / 3.000 khách với ĐÚNG câu PostgREST sinh ra (đếm exact, soát quyền đủ tầng):
--     · danh sách hoá đơn kỳ "Tất cả":  JIT bật 4.245 ms  —  JIT tắt 11 ms
--     · dashboard_summary / top_customers / channel_revenue khi tắt: 42 / 43 / 26 ms
--   Cùng một câu, chỉ khác JIT. Chính sách RLS của hoá đơn kéo theo hàng chục nhánh con nên plan rất to, JIT ngồi biên
--   dịch mấy giây cho mỗi câu — qua pooler nên câu nào cũng biên dịch lại từ đầu.
--
--   Mig 251 đặt `jit = off` ở vai `authenticated` — vai được GIẢ LẬP trong giao dịch: PostgREST phải tự đọc cài đặt của
--   vai ấy rồi SET LOCAL cho từng giao dịch (từ v11.1, sau `reload config`). Không chắc bản PostgREST của Supabase đang
--   áp → đặt THÊM ở vai ĐĂNG NHẬP `authenticator` (và `anon`): cài đặt của vai đăng nhập do chính Postgres áp lúc mở
--   kết nối, không phụ thuộc PostgREST hay pooler. Chỉ đổi CÁCH CHẠY, không đổi kết quả câu nào.
--   Supabase không cho đổi vai nào thì ghi chú rồi bỏ qua — không làm hỏng cả tệp.
-- ⚠ Muốn bật lại: ALTER ROLE authenticator RESET jit; ALTER ROLE anon RESET jit; NOTIFY pgrst, 'reload config';
-- ====================================================================

DO $jit$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['authenticator', 'anon'] LOOP
    BEGIN
      EXECUTE format('ALTER ROLE %I SET jit = off', v);
    EXCEPTION
      WHEN insufficient_privilege THEN RAISE NOTICE 'Không đổi được jit của vai %: %', v, SQLERRM;
      WHEN undefined_object THEN RAISE NOTICE 'Sổ không có vai % — bỏ qua', v;
    END;
  END LOOP;
END
$jit$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

SELECT r.rolname AS vai,
       coalesce((SELECT string_agg(c, ', ') FROM pg_db_role_setting s, unnest(s.setconfig) c
                  WHERE s.setrole = r.oid AND s.setdatabase = 0 AND c LIKE 'jit=%'), '(mặc định — chưa tắt)') AS jit
FROM pg_roles r
WHERE r.rolname IN ('authenticator', 'anon', 'authenticated')
ORDER BY 1;
