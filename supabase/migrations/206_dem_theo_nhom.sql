-- ====================================================================
-- BẬT ĐẾM THEO NHÓM CỦA POSTGREST (`select=status,count()`)
--
-- VÌ SAO — chủ nhà 27/09/2026: "Làm sao để giảm cái này xuống bên supabase" (Log Ingestion
--   1,45 / 1 GB gói miễn phí) → "danh sách đơn gửi 7 lượt chỉ để đếm số đơn theo từng trạng
--   thái, hoá đơn 6 lượt. Gộp lại thành một lượt".
--   Mỗi lượt gọi API là một dòng log. Chip trạng thái của danh sách đơn đang đếm bằng 8 lượt
--   HEAD (tổng + 7 trạng thái), hoá đơn 3 lượt — mỗi lần mở / đổi lọc. PostgREST gom nhóm được
--   trong MỘT lượt với đúng bộ lọc của câu hỏi, nhưng Supabase tắt sẵn tính năng này.
--
-- ⚠ Chỉ bật tính năng của PostgREST — KHÔNG đổi dữ liệu, KHÔNG đổi quyền. RLS vẫn áp y như cũ
--   (đếm chỉ ra số dòng người gọi được thấy). Câu gom nhóm nặng vẫn bị `statement_timeout` chặn.
-- ⚠ Chưa chạy migration này thì app tự đếm kiểu cũ (từng trạng thái một) — không hỏng màn.
-- ⚠ Muốn tắt lại: ALTER ROLE authenticator RESET pgrst.db_aggregates_enabled;
--                 NOTIFY pgrst, 'reload config';
-- ====================================================================

ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

SELECT 'Đếm theo nhóm (PostgREST aggregates)' AS hang_muc,
       EXISTS (
         SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
          WHERE r.rolname = 'authenticator'
            AND 'pgrst.db_aggregates_enabled=true' = ANY (s.setconfig)
       ) AS da_bat;
