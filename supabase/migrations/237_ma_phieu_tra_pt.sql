-- ====================================================================
-- 237 — PHIẾU TRẢ HÀNG ĐÁNH SỐ PT-xxxx · MÃ CHỨNG TỪ KHÔNG BỊ CẮT KHI QUA SỐ 9999
--
-- VÌ SAO — chủ nhà 08/10/2026: "Phiếu trả hàng : đánh số bình thường. dùng PT".
--   Phiếu trả hàng của khách đang mang số TH-xxxx (mig 193). Đổi đầu số thành PT-, số chạy giữ nguyên — cùng kiểu
--   hoá đơn HD-0001, đơn hàng DH-0001, phiếu nhập PN-0001.
--
--   ⚠ Vá luôn một lỗi ngầm của cả họ mã chứng từ: `lpad(số, 4, '0')` CẮT chuỗi dài hơn 4 ký tự —
--   lpad('10000', 4, '0') = '1000'. Hoá đơn / đơn hàng / phiếu nhập thứ 10.000 của một NPP sẽ mang đúng mã của
--   chứng từ số 1.000 → chỉ mục duy nhất (org_id, mã) từ chối → từ đó KHÔNG lập được chứng từ nào nữa; phiếu trả
--   thì ra hai phiếu cùng số.
--
-- CÁCH LÀM
--   1. `_so_chung_tu(n)`: đủ 4 chữ số, dài hơn thì giữ nguyên (7 → '0007', 10000 → '10000').
--   2. `_ma_phieu_tra` → 'PT-' || _so_chung_tu(seq). `_inv_code`, `_order_code`, `next_purchase_receipt_code` dùng
--      `_so_chung_tu` — mã dưới 10.000 y nguyên như cũ (giữ nguyên thuộc tính, search_path, quyền của bản đang chạy).
--   3. Phiếu trả cũ: TH-xxxx → PT-xxxx, giữ nguyên số. ⚠ Tắt riêng trigger ngày trừ doanh số trong lúc đổi
--      (`_ngay_tru_doanh_so` tính lại `revenue_date` với MỌI câu UPDATE) — đổi mã không được dời doanh số của phiếu
--      cũ. Các trigger khoá ghi thẳng tự bỏ qua khi chạy bằng SQL Editor (vai postgres).
--   Phiếu trả NCC (`supplier_returns.return_code`, TH-YYMMDD-HHMMSS) không đổi.
-- ====================================================================

-- ── 1. Số chứng từ: đủ 4 chữ số, không cắt ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._so_chung_tu(p_n integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT lpad(COALESCE(p_n, 0)::text, GREATEST(4, length(COALESCE(p_n, 0)::text)), '0')
$fn$;

-- ── 2. Các hàm sinh mã ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ma_phieu_tra(p_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT 'PT-' || public._so_chung_tu(p_seq)
$fn$;

CREATE OR REPLACE FUNCTION public._inv_code(p_seq integer, p_reissue integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT 'HD-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_reissue, 0) > 0
                 THEN '-' || p_reissue::text ELSE '' END;
$fn$;

CREATE OR REPLACE FUNCTION public._order_code(p_seq integer, p_edit integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $fn$
  SELECT 'DH-' || public._so_chung_tu(p_seq)
         || CASE WHEN COALESCE(p_edit, 0) > 0
                 THEN '-' || p_edit::text ELSE '' END;
$fn$;

CREATE OR REPLACE FUNCTION public.next_purchase_receipt_code(p_org uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- ⚠ KHOÁ THEO ORG TRONG SUỐT GIAO DỊCH. Hai người bấm "Hoàn thành"
  --   cùng lúc mà không khoá là hai phiếu mang cùng một mã, và chỉ chỉ
  --   mục duy nhất mới kêu — sau khi kho đã cộng.
  PERFORM pg_advisory_xact_lock(hashtext('purchase_receipt_code:' || p_org::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(receipt_code, '^PN-', ''), '')::integer), 0) + 1
    INTO v_n
  FROM purchase_invoices
  WHERE org_id = p_org AND receipt_code ~ '^PN-[0-9]+$';
  -- (mig 237) Không cắt số khi qua 9999: phiếu thứ 10.000 là PN-10000, không phải PN-1000 (trùng mã → không lập được).
  RETURN 'PN-' || public._so_chung_tu(v_n);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.next_purchase_receipt_code(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Phiếu trả cũ: TH-xxxx → PT-xxxx, giữ nguyên số ──────────────────────────────────────────
ALTER TABLE public.returns DISABLE TRIGGER trg_zz_returns_revenue_date;
UPDATE public.returns
SET return_code = public._ma_phieu_tra(return_seq)
WHERE return_seq IS NOT NULL
  AND return_code IS DISTINCT FROM public._ma_phieu_tra(return_seq);
ALTER TABLE public.returns ENABLE TRIGGER trg_zz_returns_revenue_date;

COMMENT ON COLUMN public.returns.return_code IS
  'Số phiếu trả khách PT-xxxx (mig 237; trước đó TH-xxxx, mig 193), đánh bằng trigger lúc lập.';

NOTIFY pgrst, 'reload schema';

SELECT 'mig 237: phiếu trả PT-xxxx · mã chứng từ không cắt khi qua 9999' AS buoc,
       CASE WHEN public._ma_phieu_tra(7) = 'PT-0007'
             AND public._ma_phieu_tra(12345) = 'PT-12345'
             AND public._inv_code(10000, 0) = 'HD-10000'
             AND public._inv_code(12, 1) = 'HD-0012-1'
             AND public._order_code(10000, 2) = 'DH-10000-2'
             AND NOT EXISTS (SELECT 1 FROM public.returns WHERE return_code LIKE 'TH-%')
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM public.returns) AS so_phieu_tra,
       (SELECT return_code FROM public.returns ORDER BY return_seq DESC NULLS LAST LIMIT 1) AS phieu_moi_nhat;
