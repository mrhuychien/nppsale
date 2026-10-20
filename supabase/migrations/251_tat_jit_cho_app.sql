-- ====================================================================
-- TẮT JIT CHO CÂU HỎI CỦA APP (vai authenticated)
--
-- VÌ SAO — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác" (sau "sao tìm kiếm số hóa đơn trong
--   danh sách hóa đơn chậm thế ?").
--
--   Sau mig 249 + 250, đo lại trên sổ giả (40.000 HĐ / 40.000 đơn / 10.000 khách): phần chậm còn lại là JIT —
--   Postgres tự biên dịch câu ra mã máy khi ƯỚC LƯỢNG câu đắt. Câu danh sách có soát quyền nhiều tầng nên ước lượng
--   rất đắt dù chạy thật chỉ vài chục ms → mất ~0,9 giây biên dịch cho MỖI câu. Bật → tắt:
--     · đếm hoá đơn có tìm: 950 ms → 43 ms;  đếm đơn: 54–78 → 9–22 ms;  tìm khách: 80–180 → 23–79 ms
--     · trang chủ (`dashboard_summary`): 4,9 giây → 25 ms
--     · báo cáo bán hàng / công nợ / tổng nợ: như cũ (đo 4 lần mỗi kiểu, chênh trong sai số).
--   JIT chỉ lợi cho câu phân tích chạy hàng chục giây trên hàng triệu dòng — sổ NPP không có câu nào như thế. Chính
--   PostgreSQL bản mới cũng đã đổi mặc định JIT sang tắt.
--
-- LÀM GÌ
--   `ALTER ROLE authenticated SET jit = off` — PostgREST áp cài đặt của vai người dùng cho từng giao dịch (từ v11.1),
--   `NOTIFY pgrst, 'reload config'` để nó đọc lại ngay. Chỉ đổi CÁCH CHẠY, không đổi kết quả câu nào.
--   Supabase không cho đổi thì ghi chú rồi bỏ qua — không làm hỏng cả tệp.
-- ⚠ Muốn bật lại: ALTER ROLE authenticated RESET jit; NOTIFY pgrst, 'reload config';
-- ====================================================================

DO $jit$
BEGIN
  EXECUTE 'ALTER ROLE authenticated SET jit = off';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Không đổi được jit của vai authenticated: %', SQLERRM;
END
$jit$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

SELECT 'JIT của vai authenticated (câu hỏi của app)' AS hang_muc,
       coalesce((SELECT string_agg(c, ', ') FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) c
                  WHERE r.rolname = 'authenticated' AND c LIKE 'jit=%'), '(mặc định — chưa tắt)') AS gia_tri;
