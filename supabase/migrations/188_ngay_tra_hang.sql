-- ====================================================================
-- NGÀY CỦA PHIẾU TRẢ HÀNG (khách trả)
--
-- Chủ nhà 24/09/2026: "POS phiếu trả hàng cho phép chọn ngày".
--
-- Phiếu trả khách chưa có cột ngày chứng từ — chỉ có `created_at` (lúc lập) và
-- `credited_at` (lúc hoàn thành, trigger `sync_return_credited_at` tự đóng
-- `now()`). Báo cáo trả hàng và bảng lương gom theo `credited_at`, nên phiếu
-- nhập bù hôm nay cho hàng trả hôm qua rơi nhầm vào hôm nay.
--
-- CÁCH LÀM (như `supplier_returns.return_date` của phiếu trả NCC):
--   1. Cột `returns.return_date date` — ngày chứng từ người dùng chọn. Mặc định
--      hôm nay theo giờ VN; phiếu cũ lấy ngày của credited_at / created_at.
--   2. `sync_return_credited_at`: phiếu HOÀN THÀNH thì `credited_at` bám
--      `return_date` — hôm nay thì `now()` (giữ thứ tự trong ngày), ngày khác
--      thì 12:00 giờ VN của ngày đó (xa cả hai biên ngày). Đổi ngày của phiếu
--      đã hoàn thành thì mốc đi theo.
--
-- ⚠ NGÀY GHI KHO KHÔNG LÙI (giống phiếu trả NCC): phiếu nhập kho hàng trả vẫn
--   ghi lúc bấm Hoàn thành — thẻ kho là sổ theo thời gian thật.
-- ⚠ Hàm trigger KHÔNG phải SECURITY DEFINER (chạy theo quyền người ghi).
-- ====================================================================

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS return_date date;

-- Phiếu cũ: ngày của mốc đã dùng để gom kỳ, rồi mới tới ngày lập.
UPDATE public.returns
SET return_date = (COALESCE(credited_at, created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
WHERE return_date IS NULL;

ALTER TABLE public.returns
  ALTER COLUMN return_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);

COMMENT ON COLUMN public.returns.return_date IS
  'Ngày chứng từ của phiếu trả (người dùng chọn, mig 188). credited_at của phiếu hoàn thành bám ngày này.';

CREATE OR REPLACE FUNCTION public.sync_return_credited_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_hom_nay date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_moc     timestamptz;
BEGIN
  IF NEW.status = 'completed' THEN
    -- Mốc theo ngày chứng từ (mig 188): hôm nay → now(); ngày khác → 12:00 VN.
    v_moc := CASE
               WHEN NEW.return_date IS NULL OR NEW.return_date = v_hom_nay THEN now()
               ELSE (NEW.return_date + time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh'
             END;
    IF NEW.credited_at IS NULL THEN
      -- Đóng dấu lần đầu.
      NEW.credited_at := v_moc;
    ELSIF TG_OP = 'UPDATE' AND NEW.return_date IS DISTINCT FROM OLD.return_date THEN
      -- Đổi ngày chứng từ của phiếu đã hoàn thành → mốc đi theo. Sửa ghi chú
      -- thì KHÔNG đẩy khoản trừ sang kỳ khác.
      NEW.credited_at := v_moc;
    END IF;
  ELSE
    -- Quay về phiếu tạm hoặc bị huỷ thì phiếu không còn đáng tính.
    NEW.credited_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_return_credited_at() FROM PUBLIC;

-- ⚠ Trigger bản mig 097 chỉ nghe `UPDATE OF status` — đổi ngày của phiếu đã hoàn
--   thành sẽ không chạy hàm. Dựng lại, nghe cả `return_date`.
DROP TRIGGER IF EXISTS trg_returns_credited_at ON public.returns;
CREATE TRIGGER trg_returns_credited_at
  BEFORE INSERT OR UPDATE OF status, return_date ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.sync_return_credited_at();

NOTIFY pgrst, 'reload schema';

SELECT 'Ngày chứng từ phiếu trả hàng' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'returns' AND column_name = 'return_date')
                 AND position('return_date' IN pg_get_functiondef('public.sync_return_credited_at()'::regprocedure)) > 0
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM public.returns WHERE return_date IS NULL) AS phieu_chua_co_ngay;
