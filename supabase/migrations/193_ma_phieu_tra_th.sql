-- ====================================================================
-- PHIẾU TRẢ HÀNG CÓ SỐ TH-xxxx (như HD- / DH-)
--
-- VÌ SAO — chủ nhà 25/09/2026: "tao muốn cách xử lý phiếu trả giống cách xử lý đơn
--   hàng/hoá đơn * Phiếu trả có đánh số TH- * Bấm vào số thì vào xem chi tiết, bấm vào
--   dòng thì ra xem nhanh …"
--   Bảng `returns` chưa từng có mã (chỉ `supplier_returns` có `return_code` dạng
--   TH-YYMMDD-HHMMSS) — màn nào cũng phải gọi "Phiếu trả · ngày".
--
-- CÁCH LÀM (cùng khuôn `invoice_seq`, mig 128):
--   · `return_seq` = số chạy trong một tổ chức (max + 1, khoá advisory — hai người bấm
--     cùng lúc không ra trùng số); `return_code` = 'TH-' || lpad(seq, 4, '0').
--   · Trigger BEFORE INSERT đánh số — mọi đường lập phiếu (POS, web, tự sinh lúc xuất
--     hóa đơn) đều có số, không phải vá từng RPC.
--   · Phiếu cũ đánh số theo thứ tự lập (`created_at`).
-- ====================================================================

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS return_seq  int,
  ADD COLUMN IF NOT EXISTS return_code text;

CREATE OR REPLACE FUNCTION public._ma_phieu_tra(p_seq int)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'TH-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')
$fn$;

CREATE OR REPLACE FUNCTION public._danh_so_phieu_tra()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $trg$
BEGIN
  IF NEW.return_seq IS NULL THEN
    -- ⚠ `max + 1`, không phải `count + 1`: phiếu nháp bị xoá thì đếm ra số trùng.
    PERFORM pg_advisory_xact_lock(hashtext('returns:' || NEW.org_id::text));
    SELECT COALESCE(max(return_seq), 0) + 1 INTO NEW.return_seq
    FROM returns WHERE org_id = NEW.org_id;
  END IF;
  NEW.return_code := public._ma_phieu_tra(NEW.return_seq);
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._danh_so_phieu_tra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_danh_so_phieu_tra ON public.returns;
CREATE TRIGGER trg_danh_so_phieu_tra
  BEFORE INSERT ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._danh_so_phieu_tra();

-- Phiếu cũ: đánh số theo thứ tự lập, trong từng tổ chức.
WITH g AS (
  SELECT r.id,
         COALESCE((SELECT max(x.return_seq) FROM returns x WHERE x.org_id = r.org_id), 0)
           + row_number() OVER (PARTITION BY r.org_id ORDER BY r.created_at, r.id) AS n
  FROM returns r
  WHERE r.return_seq IS NULL
)
UPDATE returns r
SET return_seq = g.n::int, return_code = public._ma_phieu_tra(g.n::int)
FROM g WHERE g.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_org_seq ON public.returns(org_id, return_seq);
CREATE INDEX IF NOT EXISTS idx_returns_code ON public.returns(return_code);

COMMENT ON COLUMN public.returns.return_code IS 'Số phiếu trả khách TH-xxxx (mig 193), đánh bằng trigger lúc lập.';

NOTIFY pgrst, 'reload schema';

SELECT 'Số phiếu trả TH-' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_danh_so_phieu_tra')
                 AND NOT EXISTS (SELECT 1 FROM returns WHERE return_code IS NULL)
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM returns) AS so_phieu,
       (SELECT max(return_code) FROM returns) AS so_lon_nhat;
