-- ====================================================================
-- QUYỀN XEM KHÁCH: BỎ PHẦN TÍNH TỪNG DÒNG / TỪNG CÂU KHÔNG CẦN — AI THẤY KHÁCH NÀO GIỮ NGUYÊN
--
-- VÌ SAO — chủ nhà 03/11/2026: em đề nghị "Danh sách khách của nhân viên bán hàng đang gọi một hàm kiểm quyền cho từng
--   dòng khách … đụng tới phân quyền nên em cần anh đồng ý trước"; chủ nhà: "làm cả 2".
--   Đo trên sổ thử cỡ sổ thật (598 khách, 619 phân công, ~2.000 đơn; lập kế hoạch + chạy, như PostgREST), chính sách
--   `customer_select` (mig 042 / 154, bọc lại ở mig 250) có ba chỗ tốn:
--     1. Vế "(EXISTS (… FROM information_schema.columns WHERE … 'created_by'…)) AND created_by = tôi" — dò xem CỘT
--        created_by có tồn tại không. Lập kế hoạch view information_schema ~1,5 ms + chạy 0,1–0,6 ms, ở MỌI câu đụng tới
--        bảng khách (kể cả mọi danh sách đơn / HĐ / phiếu thu có kèm tên khách), mọi vai. Vô nghĩa: chính sách nhắc thẳng
--        tới cột created_by — cột không có thì chính sách không tạo được, và không gỡ được cột khi chính sách còn.
--     2. `user_sells_to_customer(id)` (mig 154) gọi cho TỪNG khách NVBH không phụ trách — 555 lần mỗi câu đọc sổ khách.
--     3. Chính sách phân công "View assignments in org" xét `customer_org_id(customer_id)` (hàm, mỗi dòng) TRƯỚC vế rẻ
--        "phân công của chính tôi" — nên cả lúc chính sách khách hỏi phân công của chính NVBH cũng gọi hàm từng dòng.
--   Sau khi sửa (cùng sổ thử): sổ khách màn bán của NVBH 35,9 → 1,6 ms · danh sách khách NVBH 36,7 → 1,6 ms · của chủ NPP
--   8,6 → 2,4 ms · tra một khách 3,3–3,7 → 0,55–0,7 ms · 50 HĐ / đơn kèm tên khách 7–10 → 4–5,6 ms. Không câu nào chậm đi.
--
-- LÀM GÌ (vá trên BẢN ĐANG CHẠY — bài học mig 151 / 154: chép lại trọn chính sách từ tệp cũ là xoá mất miếng vá sau nó)
--   1. Hàm `khach_toi_da_ban()` — tập khách có đơn đứng tên tôi (đúng luật `user_sells_to_customer`: mọi trạng thái đơn,
--      bỏ qua RLS của sales_orders để không đệ quy — mig 005 / 037 / 154). Chính sách dùng `id IN (SELECT …)`: Postgres
--      tính tập MỘT lần mỗi câu rồi tra băm, thay cho một lần gọi hàm mỗi dòng.
--   2. `customer_select`: cắt đúng cặp ngoặc của vế EXISTS information_schema (giữ "created_by = tôi"), và thay
--      `user_sells_to_customer(id)` bằng tập ở (1). Mọi vế khác giữ nguyên từng chữ.
--   3. "View assignments in org": đảo hai vế OR (của chính tôi trước) — chỉ khi đúng bản mong đợi; khác thì để nguyên.
-- ⚠ AI THẤY GÌ GIỮ NGUYÊN: bộ thử scripts/sql/thu-260-rls-khach-tinh-mot-lan.sql dựng lại chính sách cũ, ghi tập khách +
--   phân công mà TỪNG người thấy (chủ, quản lý, kế toán, kho, NVBH được giao / tự tạo / có đơn / chỉ có đơn nháp / phân công
--   đã ngưng / có quyền xem hết / tài khoản bị khoá / NPP khác), chạy tệp này hai lần, so lại — 0 lệch. Trên sổ thử cỡ thật:
--   19 người, 0 lệch.
-- ⚠ `user_sells_to_customer` và `customer_org_id` GIỮ NGUYÊN (mig 244 và chính sách "Owner/Manager manage assignments"
--   còn dùng). Chạy lại tệp: không đổi gì thêm.
-- ====================================================================

-- 1. Tập khách có đơn đứng tên người đang đăng nhập.
CREATE OR REPLACE FUNCTION public.khach_toi_da_ban()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  SELECT DISTINCT so.customer_id
    FROM public.sales_orders so
   WHERE so.sales_user_id = auth.uid()
     AND so.customer_id IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.khach_toi_da_ban() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.khach_toi_da_ban() TO authenticated;
COMMENT ON FUNCTION public.khach_toi_da_ban() IS
  'Các khách có đơn đứng tên người đang đăng nhập (mọi trạng thái) — cùng luật user_sells_to_customer (mig 154), tính MỘT '
  'lần mỗi câu cho chính sách customer_select. SECURITY DEFINER để không bật ngược RLS (mig 005, 037, 154). Mig 260.';

-- 2. customer_select — vá bản đang chạy.
DO $vs$
DECLARE
  v      text;
  v_cu   text;
  i      int;
  k      int := 0;
  n      int;
  j      int;
  d      int := 0;
  ch     text;
  chuoi  boolean := false;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v
    FROM pg_policy p
   WHERE p.polname = 'customer_select' AND p.polrelid = 'public.customers'::regclass;
  IF v IS NULL THEN
    RAISE WARNING '--- 260 ⚠ không thấy chính sách customer_select — không đổi gì ---';
    RETURN;
  END IF;
  v_cu := v;

  -- (a) Vế dò cột created_by trong information_schema: cắt đúng cặp ngoặc "(EXISTS ( SELECT 1 FROM information_schema …))".
  i := position('information_schema.columns' IN v);
  IF i > 0 THEN
    LOOP  -- '(EXISTS' cuối cùng đứng trước i
      n := position('(EXISTS' IN substr(v, k + 1));
      EXIT WHEN n = 0 OR k + n >= i;
      k := k + n;
    END LOOP;
    IF k = 0 THEN
      RAISE WARNING '--- 260 ⚠ customer_select có information_schema nhưng không đúng dạng mong đợi — giữ nguyên vế ấy ---';
    ELSE
      j := k;
      LOOP
        ch := substr(v, j, 1);
        EXIT WHEN ch = '';
        IF ch = chr(39) THEN
          chuoi := NOT chuoi;
        ELSIF NOT chuoi AND ch = '(' THEN
          d := d + 1;
        ELSIF NOT chuoi AND ch = ')' THEN
          d := d - 1;
          EXIT WHEN d = 0;
        END IF;
        j := j + 1;
      END LOOP;
      IF d <> 0 OR position('information_schema.columns' IN substr(v, k, j - k + 1)) = 0 THEN
        RAISE WARNING '--- 260 ⚠ không cắt được vế information_schema của customer_select — giữ nguyên vế ấy ---';
      ELSIF substr(v, j + 1, 5) = ' AND ' THEN
        v := substr(v, 1, k - 1) || substr(v, j + 6);
      ELSE
        v := substr(v, 1, k - 1) || 'true' || substr(v, j + 1);
      END IF;
    END IF;
  END IF;

  -- (b) Đơn đứng tên tôi: tập tính một lần thay cho hàm gọi từng dòng.
  v := replace(v, 'user_sells_to_customer(id)', '(id IN ( SELECT khach_toi_da_ban() AS khach_toi_da_ban))');

  IF v IS DISTINCT FROM v_cu THEN
    EXECUTE format('ALTER POLICY customer_select ON public.customers USING (%s)', v);
  END IF;
END;
$vs$;

-- 3. "View assignments in org": vế rẻ (phân công của chính tôi) đứng trước — chỉ khi đúng bản mong đợi.
DO $pc$
DECLARE
  v      text;
  v_cu   constant text := '((customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)) OR (user_id = ( SELECT auth.uid() AS uid)))';
  v_moi  constant text := '((user_id = ( SELECT auth.uid() AS uid)) OR (customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)))';
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v
    FROM pg_policy p
   WHERE p.polname = 'View assignments in org' AND p.polrelid = 'public.customer_assignments'::regclass;
  IF regexp_replace(coalesce(v, ''), '\s+', '', 'g') = regexp_replace(v_cu, '\s+', '', 'g') THEN
    EXECUTE format('ALTER POLICY %I ON public.customer_assignments USING %s', 'View assignments in org', v_moi);
  ELSIF regexp_replace(coalesce(v, ''), '\s+', '', 'g') <> regexp_replace(v_moi, '\s+', '', 'g') THEN
    RAISE WARNING '--- 260 ⚠ "View assignments in org" khác bản mong đợi — giữ nguyên (chỉ là tối ưu, không sai quyền) ---';
  END IF;
END;
$pc$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Tóm tắt — chỉ đọc. Mong đợi: hai dòng 'ĐÃ VÁ'.
-- ---------------------------------------------------------------------
SELECT 'customer_select' AS chinh_sach,
       CASE WHEN q IS NULL THEN 'KHÔNG CÓ'
            WHEN position('information_schema' IN q) = 0 AND position('user_sells_to_customer' IN q) = 0
             AND position('khach_toi_da_ban()' IN q) > 0 AND position('customer_assignments' IN q) > 0
             AND position('created_by' IN q) > 0 AND position('user_has_permission' IN q) > 0
            THEN 'ĐÃ VÁ (bốn vế cũ còn nguyên)' ELSE 'CHƯA / LỆCH — báo lại' END AS trang_thai
  FROM (SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy
         WHERE polname = 'customer_select' AND polrelid = 'public.customers'::regclass) x
UNION ALL
SELECT 'View assignments in org',
       CASE WHEN q LIKE '((user_id = %' THEN 'ĐÃ VÁ (vế của chính tôi trước)' ELSE 'GIỮ NGUYÊN — báo lại' END
  FROM (SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy
         WHERE polname = 'View assignments in org' AND polrelid = 'public.customer_assignments'::regclass) x;
