-- ====================================================================
-- 140 — TUỔI NỢ TÍNH THEO NGÀY VIỆT NAM, KHÔNG THEO NGÀY UTC
-- ====================================================================
--
-- VÌ SAO
--   Trình duyệt tính tuổi nợ bằng ngày giờ Việt Nam (`daysOverdueOf`
--   trong `src/lib/utils.ts` — có chú thích dài giải thích vì sao). Máy
--   chủ Supabase chạy giờ UTC, nên `CURRENT_DATE` trong SQL là ngày UTC.
--
--   Việt Nam đi trước UTC 7 tiếng. Từ 00:00 tới 07:00 giờ Việt Nam mỗi
--   ngày, `CURRENT_DATE` vẫn còn là NGÀY HÔM QUA. Trong bảy tiếng đó:
--
--     · Ô tổng đầu trang Công nợ (`receivables_summary`) xếp một khoản
--       đến hạn HÔM NAY vào nhóm "chưa tới hạn", trong khi bảng ngay
--       bên dưới — do trình duyệt tính — đã xếp nó sang "quá hạn".
--       Cùng một màn hình, hai câu trả lời khác nhau về cùng một phiếu.
--     · Số ngày quá hạn trung bình (DSO) của từng nhân viên
--       (`receivables_by_rep`) thấp hơn đúng một ngày.
--
--   Bảy tiếng đó không phải giờ chết: kho bắt đầu soạn hàng từ 5-6 giờ
--   sáng, và đó chính là lúc người ta mở màn Công nợ để quyết định có
--   cho khách nợ thêm hay không.
--
-- ⚠ VÌ SAO LÀ MỘT HÀM CHỨ KHÔNG PHẢI SỬA TẠI CHỖ. `CURRENT_DATE` xuất
--   hiện ở nhiều hàm, và mỗi lần viết lại `(now() AT TIME ZONE ...)` là
--   một cơ hội gõ sai tên múi giờ mà không ai phát hiện — Postgres chỉ
--   ném lỗi lúc CHẠY, tức là lúc người dùng bấm. Một hàm `vn_today()`
--   thì sai một lần là sai ngay khi chạy migration.
--
-- ⚠ KHÔNG ĐỔI `timezone` CỦA CẢ CƠ SỞ DỮ LIỆU. Làm vậy là đổi nghĩa của
--   MỌI `CURRENT_DATE`, `now()::date` và mọi giá trị mặc định
--   `DEFAULT CURRENT_DATE` trong toàn bộ kho — kể cả những chỗ đang
--   đúng và những chỗ chưa ai đọc lại. Sửa đúng hai hàm đang sai thì
--   biết chắc mình vừa đổi cái gì.
--
-- ⚠ CHƯA ĐỤNG TỚI `028_warehouse_zones.sql` (`expires_at <=
--   CURRENT_DATE + threshold`). Cùng một lệch bảy tiếng, nhưng trên một
--   ngưỡng 30-60 ngày thì nó chỉ làm một lô vào kho cận date muộn hơn
--   bảy tiếng — và đó là một trigger đụng vào việc chia kho, không phải
--   một ô số liệu. Ghi ra đây để lần sau không phải đi tìm lại.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. vn_today() — hôm nay theo lịch Việt Nam.
-- --------------------------------------------------------------------
-- ⚠ `STABLE` chứ không `IMMUTABLE`: giá trị đổi theo thời điểm gọi.
--   Khai `IMMUTABLE` là cho phép Postgres nhớ kết quả vào chỉ mục và
--   trả về một ngày đã cũ.
CREATE OR REPLACE FUNCTION public.vn_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
$$;

COMMENT ON FUNCTION public.vn_today() IS
  'Hôm nay theo lịch Việt Nam. Dùng thay CURRENT_DATE (ngày UTC) ở mọi '
  'phép tính tuổi nợ, để khớp với daysOverdueOf() ở trình duyệt.';

GRANT EXECUTE ON FUNCTION public.vn_today() TO authenticated;

-- --------------------------------------------------------------------
-- 2. receivables_summary — ô tổng đầu trang Công nợ.
-- --------------------------------------------------------------------
-- Ngưỡng chia nhóm PHẢI khớp với `getAgingStatus()` trong
-- src/lib/utils.ts. Có chốt khoá hai bên: tests/aging-thresholds.test.ts.
DROP FUNCTION IF EXISTS public.receivables_summary();
CREATE FUNCTION public.receivables_summary()
RETURNS TABLE (
  total_outstanding  numeric,
  current_amount     numeric,
  current_count      bigint,
  warning_amount     numeric,
  warning_count      bigint,
  overdue_amount     numeric,
  overdue_count      bigint,
  critical_amount    numeric,
  critical_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      GREATEST(0, COALESCE(amount, 0) - COALESCE(paid, 0)) AS remaining,
      CASE
        WHEN due_date IS NULL THEN 'current'
        WHEN (public.vn_today() - due_date) <= 0  THEN 'current'
        WHEN (public.vn_today() - due_date) <= 30 THEN 'warning'
        WHEN (public.vn_today() - due_date) <= 60 THEN 'overdue'
        ELSE 'critical'
      END AS bucket
    FROM receivables
    WHERE org_id = public.user_org_id()
      AND status <> 'paid'
  )
  SELECT
    COALESCE(SUM(remaining), 0),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'current'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'current'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'warning'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'warning'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'overdue'),  0),
    COUNT(*)                FILTER (WHERE bucket = 'overdue'),
    COALESCE(SUM(remaining) FILTER (WHERE bucket = 'critical'), 0),
    COUNT(*)                FILTER (WHERE bucket = 'critical')
  FROM r;
$$;

-- --------------------------------------------------------------------
-- 3. receivables_by_rep — công nợ gộp theo nhân viên bán hàng.
-- --------------------------------------------------------------------
-- ⚠ BẢN ĐANG CHẠY LÀ BẢN CỦA MIGRATION 121, KHÔNG PHẢI 093. Chép lại
--   nguyên văn thân hàm của 121 và chỉ đổi đúng phép tính ngày; lấy
--   nhầm thân hàm của 093 là bỏ mất phép kẹp về 0 mà 121 thêm vào
--   (xem chú thích "Q11" bên dưới).
DROP FUNCTION IF EXISTS public.receivables_by_rep();
CREATE FUNCTION public.receivables_by_rep()
RETURNS TABLE (
  user_id             uuid,
  full_name           text,
  customer_count      bigint,
  customers_with_debt bigint,
  total_debt          numeric,
  total_paid          numeric,
  total_amount        numeric,
  overdue_amount      numeric,
  collection_rate     integer,
  dso                 integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      rc.sales_user_id,
      rc.customer_id,
      COALESCE(rc.amount, 0) AS amount,
      COALESCE(rc.paid, 0)   AS paid,
      -- ⚠ Q11 — KẸP VỀ 0. Hàm này không lọc `status <> 'paid'` nên dòng
      --   trả dư lọt vào; không kẹp thì số dư có bị TRỪ THẲNG vào công
      --   nợ của nhân viên.
      GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0)) AS remaining,
      rc.status,
      rc.status <> 'paid' AS has_debt,
      GREATEST(0, public.vn_today() - COALESCE(rc.due_date, public.vn_today())) AS aging_days
    FROM receivables rc
    WHERE rc.org_id = public.user_org_id()
      AND rc.sales_user_id IS NOT NULL
  )
  SELECT
    r.sales_user_id,
    COALESCE(u.full_name, '-'),
    COUNT(DISTINCT r.customer_id),
    COUNT(DISTINCT r.customer_id) FILTER (WHERE r.has_debt),
    COALESCE(SUM(r.remaining), 0),
    COALESCE(SUM(r.paid), 0),
    COALESCE(SUM(r.amount), 0),
    COALESCE(SUM(r.remaining) FILTER (WHERE r.status = 'overdue'), 0),
    -- ⚠ Q11 — KẸP TRẦN 100%. Dòng dư có `paid > amount` nên tỉ lệ thu
    --   được vượt 100 và người đọc tưởng số liệu hỏng.
    CASE WHEN COALESCE(SUM(r.amount), 0) > 0
         THEN LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer)
         ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE r.has_debt) > 0
         THEN ROUND(
                AVG(r.aging_days) FILTER (WHERE r.has_debt)
              )::integer
         ELSE 0 END
  FROM r
  LEFT JOIN users u ON u.id = r.sales_user_id
  GROUP BY r.sales_user_id, u.full_name
  ORDER BY COALESCE(SUM(r.remaining), 0) DESC;
$$;

-- `DROP FUNCTION` xoá luôn GRANT cũ, phải cấp lại.
GRANT EXECUTE ON FUNCTION public.receivables_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_by_rep()  TO authenticated;

-- --------------------------------------------------------------------
-- 4. Báo cáo ảnh hưởng.
-- --------------------------------------------------------------------
-- Không có backfill nào ở đây — hai hàm chỉ ĐỌC. Nhưng phải nói ra
-- migration này vừa đổi câu trả lời cho bao nhiêu dòng, nếu không thì
-- không có cách nào biết nó đã chạy thật hay chưa.
DO $$
DECLARE
  v_utc   date    := CURRENT_DATE;
  v_vn    date    := public.vn_today();
  v_moved bigint  := 0;
BEGIN
  IF v_vn <> v_utc THEN
    SELECT COUNT(*) INTO v_moved
    FROM receivables
    WHERE status <> 'paid'
      AND due_date IS NOT NULL
      AND (
        ((v_utc - due_date) <= 0)  <> ((v_vn - due_date) <= 0)  OR
        ((v_utc - due_date) <= 30) <> ((v_vn - due_date) <= 30) OR
        ((v_utc - due_date) <= 60) <> ((v_vn - due_date) <= 60)
      );
    RAISE NOTICE 'vn_today() = %, CURRENT_DATE (UTC) = % — lệch NGÀY ngay lúc này. % dòng công nợ đổi nhóm tuổi nợ.', v_vn, v_utc, v_moved;
  ELSE
    RAISE NOTICE 'vn_today() = % trùng CURRENT_DATE — lúc này hai cách tính cho cùng kết quả (0 dòng đổi nhóm). Chênh lệch chỉ hiện từ 00:00 tới 07:00 giờ Việt Nam.', v_vn;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
