-- ====================================================================
-- SOÁT QUYỀN (RLS) TÍNH MỘT LẦN MỖI CÂU — KHÔNG GỌI LẠI HÀM QUYỀN CHO TỪNG DÒNG
--
-- VÌ SAO — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác" (sau mig 249 — "sao tìm kiếm
--   số hóa đơn trong danh sách hóa đơn chậm thế ?").
--
--   Mig 249 bỏ cái chậm của KHOÁ TÌM (tính lại cho từng dòng). Đo tiếp các danh sách khác (khách, hàng, NCC,
--   công nợ, hoá đơn, đơn) đúng câu trình duyệt gửi (vai `authenticated`, `auth.uid()` đúng bản Supabase):
--   khoá tìm của chúng đã lưu sẵn (mig 177 / 249); phần còn lại là SOÁT QUYỀN TỪNG DÒNG. 151 / 179 chính
--   sách gọi `user_org_id()`, `user_role()`, `auth.uid()`, `user_has_permission(auth.uid(), …)` thẳng trong
--   biểu thức — Postgres gọi lại chúng cho MỖI dòng: `user_org_id()` / `user_role()` mỗi lần là một câu hỏi
--   bảng users, `auth.uid()` đọc lại cả JSON phiên đăng nhập, `user_has_permission` ba câu.
--   Đo (sổ giả 10.000 khách / 40.000 đơn / 40.000 HĐ / 40.000 dòng nợ), trước → sau:
--     · NVBH: đếm công nợ 1,42 giây → 8 ms; đếm đơn 1,74 giây → 69 ms; tìm hàng 110 → 5 ms;
--       tìm khách 650 → 260 ms; tra khách cho ô tìm công nợ 213 → 46 ms.
--     · Chủ NPP: đếm công nợ 1,44 giây → 9 ms; đếm đơn 497 → 56 ms; tìm khách 213 → 99 ms.
--
-- LÀM GÌ
--   Mọi chính sách của schema public: bọc các lời gọi KHÔNG phụ thuộc dòng trong `(SELECT …)` — Postgres
--   tính MỘT lần mỗi câu (initplan) rồi dùng cho mọi dòng. Đúng cảnh báo "auth_rls_initplan" của Supabase.
--   · KẾT QUẢ Y HỆT: các hàm đều STABLE (một câu, một ảnh sổ → một giá trị); chỉ đổi số lần gọi. Bộ thử so
--     từng vai (chủ NPP, quản lý, kế toán, thủ kho, NVBH) thấy đúng y những dòng như trước ở MỌI bảng.
--   · Không chép tay chính sách nào: đọc biểu thức đang chạy (`pg_get_expr` — cái pg_dump dùng), bọc, ghi
--     lại bằng ALTER POLICY. Chỉ chạm chính sách có đổi.
--   · Chạy lại vô hại: gỡ lớp bọc sẵn có trước rồi mới bọc — lần hai không đổi gì.
--   · Hàm phụ thuộc dòng (`customer_org_id(customer_id)`, `user_sells_to_customer(id)`) giữ nguyên.
-- ⚠ ALTER POLICY khoá bảng của nó tới hết tệp — cả tệp chạy ~0,15 giây trên sổ thử; câu nào đang chạy dở trên
--   bảng ấy thì nó chờ, nên vẫn chọn lúc vắng.
-- ⚠ Chính sách mới về sau: viết sẵn `(SELECT user_org_id())`… hoặc cuối migration gọi
--   `SELECT public._rls_tinh_mot_lan_ap();` — luật ở CLAUDE.md §3; khám sổ dòng 89 đếm chính sách còn gọi thẳng.
-- ====================================================================

-- Một biểu thức chính sách → bản đã bọc. Gỡ lớp bọc cũ trước rồi bọc lại — bọc hai lần vẫn ra đúng một lớp.
-- ⚠ BỌC ĐÚNG DẠNG pg_get_expr IN RA ("( SELECT auth.uid() AS uid)"): bọc kiểu khác ("(SELECT auth.uid())") thì
--   sau ALTER POLICY Postgres in lại khác chữ → lần chạy sau tưởng còn phải bọc, ghi lại cả 173 chính sách.
CREATE OR REPLACE FUNCTION public._rls_tinh_mot_lan(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  s text := p;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;
  -- Gỡ
  s := regexp_replace(s, '\( SELECT ((public\.)?user_has_permission\(\( SELECT auth\.uid\(\) AS uid\), ''[^'']*''::text\)) AS user_has_permission\)', '\1', 'g');
  s := regexp_replace(s, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g');
  s := regexp_replace(s, '\( SELECT ((public\.)?user_org_id\(\)) AS user_org_id\)', '\1', 'g');
  s := regexp_replace(s, '\( SELECT ((public\.)?user_role\(\)) AS user_role\)', '\1', 'g');
  -- Bọc
  s := regexp_replace(s, '\mauth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g');
  s := regexp_replace(s, '(public\.)?\muser_org_id\(\)', '( SELECT \1user_org_id() AS user_org_id)', 'g');
  s := regexp_replace(s, '(public\.)?\muser_role\(\)', '( SELECT \1user_role() AS user_role)', 'g');
  s := regexp_replace(s, '((public\.)?\muser_has_permission\(\( SELECT auth\.uid\(\) AS uid\), ''[^'']*''::text\))',
                      '( SELECT \1 AS user_has_permission)', 'g');
  RETURN s;
END;
$fn$;

-- Bọc mọi chính sách của schema public; trả số chính sách đã đổi (chạy lại → 0).
CREATE OR REPLACE FUNCTION public._rls_tinh_mot_lan_ap()
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  r record;
  v_q text;
  v_c text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.polname, c.relname, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS c
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
     ORDER BY c.relname, p.polname
  LOOP
    v_q := public._rls_tinh_mot_lan(r.q);
    v_c := public._rls_tinh_mot_lan(r.c);
    IF v_q IS DISTINCT FROM r.q OR v_c IS DISTINCT FROM r.c THEN
      EXECUTE format('ALTER POLICY %I ON public.%I', r.polname, r.relname)
           || CASE WHEN v_q IS NOT NULL THEN format(' USING (%s)', v_q) ELSE '' END
           || CASE WHEN v_c IS NOT NULL THEN format(' WITH CHECK (%s)', v_c) ELSE '' END;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION public._rls_tinh_mot_lan(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rls_tinh_mot_lan_ap() FROM PUBLIC, anon, authenticated;

SELECT public._rls_tinh_mot_lan_ap() AS so_chinh_sach_da_boc;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: 0 chính sách còn gọi thẳng hàm quyền cho từng dòng.
-- ---------------------------------------------------------------------
SELECT 'Chính sách còn gọi thẳng hàm quyền (tính lại từng dòng)' AS hang_muc, count(*)::text AS gia_tri
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relnamespace = 'public'::regnamespace
   AND (public._rls_tinh_mot_lan(pg_get_expr(p.polqual, p.polrelid)) IS DISTINCT FROM pg_get_expr(p.polqual, p.polrelid)
        OR public._rls_tinh_mot_lan(pg_get_expr(p.polwithcheck, p.polrelid)) IS DISTINCT FROM pg_get_expr(p.polwithcheck, p.polrelid))
UNION ALL
SELECT 'Chính sách của schema public', count(*)::text
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relnamespace = 'public'::regnamespace;
