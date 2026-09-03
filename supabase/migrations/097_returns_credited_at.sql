-- ====================================================================
-- 097 — Phiếu trả lập cuối tháng, duyệt sang tháng sau thì tiền BIẾN MẤT
--
-- LỖ THỦNG (095/096 chưa xử, tìm ra khi rà lại và đã dựng lại được)
--
-- payroll_returns_for gom phiếu trả theo `created_at`. Nhưng phiếu trả từ
-- màn soạn đơn được tạo ở trạng thái 'pending' (order-form.tsx:816) và chỉ
-- thành 'completed' khi thủ kho bấm nhập lại hàng ở màn hình khác
-- (inventory/pending/page.tsx:373) — bước đó KHÔNG ghi lại thời điểm, và
-- bảng returns không hề có cột nào kiểu approved_at.
--
-- Nên phiếu lập cuối tháng, duyệt đầu tháng sau, rơi vào khoảng trống:
--
--   28/09  bán 30tr, khách trả 25tr → phiếu 'pending'
--   01/10  chốt lương T9  → phiếu còn 'pending', trừ 0
--   03/10  thủ kho nhập lại hàng → phiếu 'completed'
--   05/10  khoá kỳ T9
--   01/11  chốt lương T10 → không thấy, vì created_at nằm ở tháng 9
--
-- Đã chạy đúng kịch bản này trên Postgres 16:
--   T9  → gộp 30.000.000, trừ 0
--   T10 → gộp 0,          trừ 0
--   tính lại T9 → ERROR: PAYROLL_RUN_LOCKED
-- 25.000.000 đ không được trừ vào đâu cả, và không có cảnh báo nào.
--
-- Cuối tháng là lúc trả hàng nhiều nhất, nên đây không phải ca hiếm.
--
-- CÁCH SỬA
-- Ghi lại THỜI ĐIỂM PHIẾU TRỞ NÊN ĐÁNG TÍNH, rồi gom theo mốc đó thay vì
-- theo ngày lập. Phiếu duyệt tháng 10 thì trừ vào lương tháng 10 — đúng cả
-- về nghiệp vụ (lúc đó mới chắc chắn mất tiền) lẫn về kỹ thuật (không phải
-- mở lại kỳ đã khoá).
--
-- Không đổi cách gom của phiếu tạo tay ở /returns/new: chúng vào thẳng
-- 'completed' ngay khi INSERT nên credited_at = created_at, y như cũ.
-- ====================================================================


-- --------------------------------------------------------------------
-- 1. Cột mốc.
-- --------------------------------------------------------------------
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

COMMENT ON COLUMN returns.credited_at IS
  'Thời điểm phiếu trả trở nên đáng tính tiền (status vào approved/completed). '
  'Dùng để gom phiếu vào đúng kỳ lương / kỳ báo cáo. NULL nghĩa là phiếu chưa '
  'được duyệt, chưa trừ vào đâu cả. Do trigger trg_returns_credited_at giữ, '
  'đừng ghi tay.';

CREATE INDEX IF NOT EXISTS idx_returns_credited_at
  ON returns (org_id, credited_at)
  WHERE credited_at IS NOT NULL;


-- --------------------------------------------------------------------
-- 2. Trigger giữ cột đó.
--
-- Đặt ở tầng database chứ không ở tầng ứng dụng vì có ÍT NHẤT NĂM chỗ
-- ghi vào returns.status (order-form.tsx:810, handover/page.tsx:678,
-- inventory/pending/page.tsx:373, returns/new/page.tsx:50,
-- returns/[id]/page.tsx:88, lib/returns.ts:178). Nhớ sửa đủ năm chỗ là
-- điều sẽ không xảy ra.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_return_credited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('approved', 'completed') THEN
    -- Đóng dấu lần đầu phiếu được duyệt. Đã có dấu thì giữ nguyên — duyệt
    -- rồi sửa ghi chú không được đẩy khoản trừ sang kỳ khác.
    IF NEW.credited_at IS NULL THEN
      NEW.credited_at := now();
    END IF;
  ELSE
    -- Quay về 'pending' hoặc bị 'rejected' thì phiếu không còn đáng tính.
    -- Xoá dấu để nếu sau này được duyệt lại thì tính vào kỳ duyệt lại,
    -- không phải kỳ duyệt lần đầu.
    NEW.credited_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_returns_credited_at ON returns;
CREATE TRIGGER trg_returns_credited_at
  BEFORE INSERT OR UPDATE OF status ON returns
  FOR EACH ROW EXECUTE FUNCTION public.sync_return_credited_at();


-- --------------------------------------------------------------------
-- 3. Bù dữ liệu cũ.
--
-- Phiếu đã duyệt từ trước không có mốc thật để lấy. `created_at` là ước
-- lượng tốt nhất còn lại, và cũng đúng bằng cách 095/096 đang gom, nên bù
-- như vậy KHÔNG làm đổi số của bất kỳ kỳ lương nào đã tính.
-- --------------------------------------------------------------------
UPDATE returns
   SET credited_at = created_at
 WHERE credited_at IS NULL
   AND status IN ('approved', 'completed');


-- --------------------------------------------------------------------
-- 4. payroll_returns_for gom theo mốc mới.
--
-- COALESCE(credited_at, created_at) chứ không phải credited_at trần: nếu
-- migration này chạy trên database mà bước bù ở trên vì lý do nào đó chưa
-- xong, phiếu cũ vẫn được tính như trước thay vì im lặng biến mất — đúng
-- cái lỗi mà migration này đang đi sửa.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_returns_for(
  p_user  uuid,
  p_org   uuid,
  p_start date,
  p_end   date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(r.credit_note_amount, 0)), 0)
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  WHERE r.org_id = p_org
    AND r.status IN ('approved', 'completed')
    -- Giờ Việt Nam, không phải UTC: database chạy UTC nên ::date trần đẩy
    -- phiếu lập 0h–7h ngày mùng 1 sang kỳ trước (mig 095, mục 4).
    AND ((COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        BETWEEN p_start AND p_end
    -- Phiếu gắn vào đơn NHÁP / ĐÃ HUỶ thì không trừ: đơn đó chưa từng được
    -- cộng vào doanh số gộp nên trừ credit của nó là phạt hai lần (mig 096).
    AND (r.order_id IS NULL OR public.is_revenue_status(o.status))
    AND COALESCE(
          o.sales_user_id,
          (SELECT o2.sales_user_id
             FROM sales_orders o2
            WHERE o2.customer_id = r.customer_id
              AND o2.org_id = r.org_id
              AND public.is_revenue_status(o2.status)
              AND o2.order_date <= ((COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            ORDER BY o2.order_date DESC, o2.created_at DESC
            LIMIT 1)
        ) = p_user;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_returns_for(uuid, uuid, date, date) TO authenticated;


-- --------------------------------------------------------------------
-- 5. Phiếu trả đã duyệt mà chưa trừ vào kỳ nào — để giao diện cảnh báo
--    trước khi khoá kỳ.
--
-- Sửa cách gom chỉ chặn lỗ thủng cho phiếu duyệt TỪ NAY. Phiếu đã kẹt sẵn
-- trong dữ liệu cũ thì phải nhìn thấy mới xử được, nên có hàm này.
-- SECURITY INVOKER (mặc định) để RLS vẫn áp dụng.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.payroll_unbilled_returns(date);
CREATE FUNCTION public.payroll_unbilled_returns(p_month date)
RETURNS TABLE (
  return_id      uuid,
  order_code     text,
  store_name     text,
  credit_amount  numeric,
  created_day    date,
  credited_day   date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    r.id,
    o.order_code,
    c.store_name,
    COALESCE(r.credit_note_amount, 0),
    (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    (COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  FROM returns r
  LEFT JOIN sales_orders o ON o.id = r.order_id
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.org_id = public.user_org_id()
    AND r.status IN ('approved', 'completed')
    AND COALESCE(r.credit_note_amount, 0) > 0
    -- Phiếu LẬP trong kỳ này nhưng mốc tính đã rơi sang kỳ SAU: khoá kỳ bây
    -- giờ thì khoản trừ sẽ vào lương kỳ sau, không mất — nhưng người duyệt
    -- nên biết trước thay vì phát hiện lúc nhân viên thắc mắc.
    AND (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        BETWEEN p_month AND (p_month + interval '1 month - 1 day')::date
    AND (COALESCE(r.credited_at, r.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        > (p_month + interval '1 month - 1 day')::date
  ORDER BY 5;
$$;

COMMENT ON FUNCTION public.payroll_unbilled_returns(date) IS
  'Phiếu trả LẬP trong kỳ nhưng được duyệt SAU kỳ, nên khoản trừ rơi vào kỳ '
  'sau. Dùng để cảnh báo trước khi khoá bảng lương.';

GRANT EXECUTE ON FUNCTION public.payroll_unbilled_returns(date) TO authenticated;
