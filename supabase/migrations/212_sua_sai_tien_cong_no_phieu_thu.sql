-- ====================================================================
-- 212 — SỬA NHÓM SAI TIỀN (quét luồng 28/09/2026, docs/quet-luong-2026-09-28.md)
--
-- VÌ SAO — chủ nhà 28/09/2026: "lần lượt xử lý đến khi hoàn thành nhóm sai tiền 1–7
-- trước". Migration này sửa 1, 2, 3, 6, 7 (+ tiền lẻ); 4–5 ở mig 213.
--
--   1. KHÁCH TRẢ DƯ TRÊN MỘT KHOẢN BỊ GIẤU KHỎI TỔNG NỢ. Dòng công nợ dương mà
--      `paid > amount` (sửa HĐ giảm sau khi thu đủ, trả hàng sau khi thu đủ, sửa nợ
--      đầu kỳ) bị đặt 'paid' → loadCustomerDebt (lọc status <> 'paid') bỏ qua →
--      nợ hiện cao hơn thật đúng bằng phần dư. Luật công nợ âm (mig 186/191) đã giữ
--      dòng ÂM ở 'open'; nay áp cho MỌI dòng: trigger `_cong_no_am_trang_thai` là
--      NƠI DUY NHẤT quyết trạng thái — 'paid' chỉ khi |amount − paid| < 0,01; dư
--      (paid > amount) → 'open'; còn nợ → 'partial' / 'open' (giữ 'overdue').
--   2. HUỶ PHIẾU THU MẤT TIỀN khi phần dư của khoản đã bị rút sang khoản khác:
--      `void_cash_receipt` kẹp `GREATEST(0, paid − x)` cho dòng dương → bỏ kẹp.
--   3. `create_cash_receipt` nhận dòng âm / 0đ / tiền lẻ → chặn: mỗi dòng > 0, số
--      đồng chẵn; số dư có dùng cũng phải chẵn.
--   6. PHIẾU TRẢ GẮN ĐƯỢC VÀO HÓA ĐƠN CỦA KHÁCH KHÁC → trigger chặn mọi đường
--      (save_pos_return, create_return_with_lines, ghi thẳng).
--   7. HÀNG ĐỔI XUẤT HAI LẦN khi đơn xuất hai đợt: `get_invoiceable_lines` chỉ mời
--      hàng đổi của phiếu CHƯA bám hóa đơn nào.
-- ====================================================================

-- 1. Trạng thái công nợ — một nơi quyết ---------------------------------
CREATE OR REPLACE FUNCTION public._cong_no_am_trang_thai()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_p numeric := COALESCE(NEW.paid, 0);
BEGIN
  IF NEW.amount < 0 THEN
    -- Dùng vừa hết dư có → 'paid'. Còn dư / dùng quá → 'open' (mig 186/191).
    NEW.status := CASE WHEN abs(v_p - NEW.amount) < 0.01 THEN 'paid' ELSE 'open' END;
  ELSIF abs(v_p - COALESCE(NEW.amount, 0)) < 0.01 THEN
    NEW.status := 'paid';
  ELSIF v_p > NEW.amount THEN
    -- (mig 212) Khách trả DƯ trên khoản này: là dư có, phải được cộng (âm) vào nợ.
    NEW.status := 'open';
  ELSIF NEW.status = 'overdue' THEN
    NULL;
  ELSIF v_p > 0 THEN
    NEW.status := 'partial';
  ELSE
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Chữa sổ: dòng đang 'paid' mà thật ra còn dư / còn nợ.
UPDATE public.receivables SET status = status
WHERE status = 'paid' AND abs(COALESCE(paid, 0) - COALESCE(amount, 0)) >= 0.01;

-- 2. void_cash_receipt: bỏ kẹp 0 -------------------------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.void_cash_receipt(uuid, text)'::regprocedure);
  v_re  text := 'CASE\s+WHEN\s+COALESCE\(rc\.amount,\s*0\)\s*<\s*0\s+OR\s+rc\.return_id\s+IS\s+NOT\s+NULL\s+THEN\s+COALESCE\(rc\.paid,\s*0\)\s*-\s*l\.amount\s+ELSE\s+GREATEST\(0,\s*COALESCE\(rc\.paid,\s*0\)\s*-\s*l\.amount\)\s+END';
  v_n   int;
BEGIN
  IF position('(mig 212)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 212: void_cash_receipt đã bỏ kẹp, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '212: thấy % chỗ kẹp paid trong void_cash_receipt, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re,
    'COALESCE(rc.paid, 0) - l.amount /* (mig 212) không kẹp 0 — dư đã rút sang khoản khác là khách nợ lại */');
  EXECUTE v_src;
END;
$p$;

-- 3. create_cash_receipt: dòng > 0, số đồng chẵn ---------------------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure);
  v_re1 text := '(AND\s+)(rl\.amount\s*<=\s*COALESCE\(r\.amount,\s*0\)\s*-\s*COALESCE\(r\.paid,\s*0\)\s*\+\s*0\.01)';
  v_re2 text := '(''CUSTOMER_REQUIRED:[^'']*''\s+USING\s+ERRCODE\s*=\s*''P0001'';\s*END\s+IF;)';
  v_n   int;
BEGIN
  IF position('(mig 212)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 212: create_cash_receipt đã chặn dòng âm, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re1, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '212: thấy % chỗ kiểm dòng trong create_cash_receipt, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re2, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '212: thấy % chỗ CUSTOMER_REQUIRED trong create_cash_receipt, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re1,
    '\1rl.amount > 0 AND rl.amount = round(rl.amount) /* (mig 212) */ AND \2');
  v_src := regexp_replace(v_src, v_re2,
    '\1' || chr(10)
    || '  -- (mig 212) Tiền là số đồng chẵn — tiền lẻ làm payment và dòng phiếu thu lệch nhau.' || chr(10)
    || '  IF v_use <> round(v_use) THEN' || chr(10)
    || '    RAISE EXCEPTION ''BAD_AMOUNT: số dư có dùng phải là số đồng chẵn'' USING ERRCODE = ''P0001'';' || chr(10)
    || '  END IF;');
  EXECUTE v_src;
END;
$p$;

-- 6. Phiếu trả phải cùng khách với hóa đơn gốc ------------------------------
CREATE OR REPLACE FUNCTION public._phieu_tra_dung_khach_hoa_don()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_kh uuid;
BEGIN
  IF NEW.invoice_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  SELECT si.customer_id INTO v_kh FROM sales_invoices si WHERE si.id = NEW.invoice_id;
  IF v_kh IS NOT NULL AND NEW.customer_id IS DISTINCT FROM v_kh THEN
    RAISE EXCEPTION 'INVOICE_CUSTOMER_MISMATCH: hóa đơn gốc là của khách khác — phiếu trả phải cùng khách với hóa đơn'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public._phieu_tra_dung_khach_hoa_don() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_phieu_tra_dung_khach_hoa_don ON public.returns;
CREATE TRIGGER trg_phieu_tra_dung_khach_hoa_don
  BEFORE INSERT OR UPDATE OF invoice_id, customer_id ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._phieu_tra_dung_khach_hoa_don();

-- 7. get_invoiceable_lines: hàng đổi chỉ của phiếu chưa bám hóa đơn ----------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure);
  v_re  text := '(AND\s+r\.status\s+IN\s+\(''draft'',\s*''submitted''\)\s+)(AND\s+rl\.is_exchange\s*=\s*true)';
  v_n   int;
BEGIN
  IF position('(mig 212)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 212: get_invoiceable_lines đã lọc hàng đổi, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '212: thấy % chỗ lọc hàng đổi trong get_invoiceable_lines, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_re,
    '\1AND r.invoice_id IS NULL /* (mig 212) đã bám HĐ = đã xuất theo tờ ấy */ \2');
  EXECUTE v_src;
END;
$p$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 212: sửa nhóm sai tiền' AS buoc,
       CASE WHEN position('(mig 212)' IN pg_get_functiondef('public.void_cash_receipt(uuid, text)'::regprocedure)) > 0
             AND position('(mig 212)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) > 0
             AND position('(mig 212)' IN pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure)) > 0
             AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_phieu_tra_dung_khach_hoa_don')
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua,
       (SELECT count(*) FROM public.receivables
         WHERE status <> 'paid' AND COALESCE(amount, 0) >= 0 AND COALESCE(paid, 0) > COALESCE(amount, 0) + 0.01) AS dong_du_co_duoc_mo;
