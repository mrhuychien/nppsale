-- ====================================================================
-- 240 — PHIẾU TRẢ HÀNG NCC ĐÁNH SỐ PTNCC-xxxx (ĐÁNH LẠI CẢ PHIẾU CŨ)
--
-- VÌ SAO — chủ nhà 08/10/2026: "Đổi đầu PTNCC", chọn "Đánh lại cả phiếu cũ" (mọi phiếu, cũ lẫn mới, thành
--   PTNCC-0001, 0002… theo thứ tự lập).
--   Phiếu trả NCC mang mã theo giờ TH-YYMMDD-HHMMSS (mig 068), chỉ cấp lúc hoàn thành — không có số chạy, và đầu TH-
--   dễ lẫn với phiếu trả khách (nay là PT-, mig 237).
--
-- CÁCH LÀM
--   1. `supplier_returns.return_seq` = số chạy trong một NPP (max + 1, khoá advisory); `return_code` =
--      'PTNCC-' || _so_chung_tu(seq) (mig 237: đủ 4 chữ số, không cắt khi qua 9999). Mã cũ giữ ở `return_code_cu`
--      để còn tra được số trên giấy đã đưa NCC.
--   2. Trigger BEFORE INSERT OR UPDATE OF return_code, return_seq: đánh số lúc LẬP phiếu (như phiếu trả khách) và luôn
--      ghi mã theo số — nhánh "chưa có mã thì sinh TH-…" của `complete_supplier_return` không bao giờ còn chạy tới.
--   3. Phiếu cũ: đánh lại theo thứ tự lập (created_at, id) trong từng NPP. Dòng công nợ NCC (`payables.invoice_number`,
--      ghi chú) và ghi chú phiếu kho đang mang mã cũ → đổi sang mã mới cho khớp. Trigger khoá ghi thẳng của hai bảng
--      tự bỏ qua khi chạy bằng SQL Editor (vai postgres).
-- ====================================================================

ALTER TABLE public.supplier_returns
  ADD COLUMN IF NOT EXISTS return_seq int,
  ADD COLUMN IF NOT EXISTS return_code_cu text;

CREATE OR REPLACE FUNCTION public._ma_tra_ncc(p_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT 'PTNCC-' || public._so_chung_tu(p_seq)
$fn$;

CREATE OR REPLACE FUNCTION public._danh_so_tra_ncc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
BEGIN
  IF NEW.return_seq IS NULL THEN
    -- ⚠ `max + 1`, không phải `count + 1`: phiếu nháp bị xoá thì đếm ra số trùng. Khoá theo NPP: hai người lập
    --   cùng lúc không ra trùng số.
    PERFORM pg_advisory_xact_lock(hashtext('supplier_returns:' || NEW.org_id::text));
    SELECT COALESCE(max(return_seq), 0) + 1 INTO NEW.return_seq
    FROM supplier_returns WHERE org_id = NEW.org_id;
  END IF;
  NEW.return_code := public._ma_tra_ncc(NEW.return_seq);
  RETURN NEW;
END;
$trg$;
REVOKE EXECUTE ON FUNCTION public._danh_so_tra_ncc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_danh_so_tra_ncc ON public.supplier_returns;
CREATE TRIGGER trg_danh_so_tra_ncc
  BEFORE INSERT OR UPDATE OF return_code, return_seq ON public.supplier_returns
  FOR EACH ROW EXECUTE FUNCTION public._danh_so_tra_ncc();

-- ── Phiếu cũ: đánh lại theo thứ tự lập, trong từng NPP; giữ mã cũ ─────────────────────────────────────
WITH g AS (
  SELECT s.id,
         COALESCE((SELECT max(x.return_seq) FROM supplier_returns x WHERE x.org_id = s.org_id), 0)
           + row_number() OVER (PARTITION BY s.org_id ORDER BY s.created_at, s.id) AS n
  FROM supplier_returns s
  WHERE s.return_seq IS NULL
)
UPDATE supplier_returns s
SET return_seq = g.n::int,
    return_code_cu = COALESCE(s.return_code_cu, s.return_code)
FROM g WHERE g.id = s.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_returns_org_seq ON public.supplier_returns(org_id, return_seq);

-- ── Chỗ đang chép mã cũ: số chứng từ / ghi chú dòng công nợ NCC, ghi chú phiếu kho ────────────────────
UPDATE payables p
SET invoice_number = CASE WHEN p.invoice_number = s.return_code_cu THEN s.return_code ELSE p.invoice_number END,
    notes = CASE WHEN position(s.return_code_cu IN COALESCE(p.notes, '')) > 0
                 THEN replace(p.notes, s.return_code_cu, s.return_code) ELSE p.notes END
FROM supplier_returns s
WHERE s.return_code_cu IS NOT NULL
  AND s.return_code_cu IS DISTINCT FROM s.return_code
  AND p.org_id = s.org_id AND p.supplier_id = s.supplier_id
  AND (p.invoice_number = s.return_code_cu OR position(s.return_code_cu IN COALESCE(p.notes, '')) > 0);

UPDATE stock_entries e
SET notes = replace(e.notes, s.return_code_cu, s.return_code)
FROM supplier_returns s
WHERE s.return_code_cu IS NOT NULL
  AND s.return_code_cu IS DISTINCT FROM s.return_code
  AND e.org_id = s.org_id
  AND position(s.return_code_cu IN COALESCE(e.notes, '')) > 0;

COMMENT ON COLUMN public.supplier_returns.return_code IS
  'Số phiếu trả NCC PTNCC-xxxx (mig 240), đánh bằng trigger lúc lập.';
COMMENT ON COLUMN public.supplier_returns.return_code_cu IS
  'Mã cũ trước mig 240 (TH-YYMMDD-HHMMSS) — để tra giấy đã đưa NCC.';

NOTIFY pgrst, 'reload schema';

SELECT 'mig 240: phiếu trả NCC đánh số PTNCC-xxxx' AS buoc,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_danh_so_tra_ncc')
             AND public._ma_tra_ncc(12) = 'PTNCC-0012'
             AND NOT EXISTS (SELECT 1 FROM public.supplier_returns WHERE return_code IS NULL OR return_code NOT LIKE 'PTNCC-%')
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM public.supplier_returns) AS so_phieu,
       (SELECT count(*) FROM public.supplier_returns WHERE return_code_cu IS NOT NULL) AS da_doi_ma_cu;
