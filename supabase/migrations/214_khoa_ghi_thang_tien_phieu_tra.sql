-- ====================================================================
-- 214 — KHOÁ GHI THẲNG TỪ TRÌNH DUYỆT (quét luồng 28/09/2026, docs/quet-luong-2026-09-28.md)
--
-- VÌ SAO — chủ nhà 28/09/2026: "…rồi khoá ghi thẳng". Luật dự án: tiền, tồn kho,
-- trạng thái chứng từ chỉ đổi qua RPC. Quét luồng thấy vẫn lọt:
--   · kế toán / chủ sửa thẳng `receivables.amount`, `paid`; sửa / chèn `payments`;
--     đổi `cash_receipts.status` = voided (nợ không trả về); quản lý xoá phiếu thu
--     (dòng mất, `paid` ở lại); thủ kho chèn phiếu thu 9.999.999đ.
--   · sửa dòng của phiếu trả ĐÃ hoàn thành (credit 120k → 1,2tr, nợ / kho không tính
--     lại); đổi thẳng `returns.status` → completed (không nhập kho);
--     `create_return_with_lines` (SECURITY INVOKER) tin `status` và `line_total`.
--   · ghi thẳng `sales_order_lines.invoiced_qty` → đơn không còn gì để xuất.
--   · `post_invoice` không kiểm dòng hóa đơn có thuộc đơn / đúng sản phẩm không.
--
-- CÁCH LÀM: trigger chặn vai `authenticated` / `anon` (RPC SECURITY DEFINER chạy vai
-- chủ sở hữu nên không bị chặn — cùng lối `_trg_khoa_ghi_thang_phieu_kho`). Chừa đúng
-- những việc màn hình hợp lệ đang làm:
--   · Nợ đầu kỳ (màn Nợ đầu kỳ): thêm / sửa số / xoá dòng `opening_balance` chưa thu.
--   · Đánh dấu quá hạn (cột status — trigger trạng thái mig 212 tự tính lại).
--   · Xác nhận payment (`verified_by`, `verified_at`); xác nhận phiếu thu chờ →
--     đã nhận (`status`, `received_by`, `received_at`), ghi chú.
--   · Phiếu trả NHÁP: lập, sửa, xoá, sửa dòng (line_total máy chủ tự tính lại).
--     Phiếu đã qua nháp: chỉ ghi chú / lý do / ngày chứng từ / người đứng tên.
-- ⚠ Hàm trigger SECURITY DEFINER? KHÔNG — chạy theo vai người gọi để biết là ai.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._la_trinh_duyet()
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT current_user IN ('authenticated', 'anon')
$fn$;

-- 1. receivables ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_cong_no()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(NEW.opening_balance, false) OR NEW.invoice_id IS NOT NULL
       OR NEW.order_id IS NOT NULL OR NEW.return_id IS NOT NULL OR COALESCE(NEW.paid, 0) <> 0 THEN
      RAISE EXCEPTION 'CONG_NO_KHOA: công nợ chỉ sinh từ hóa đơn / phiếu trả — màn hình chỉ thêm được nợ đầu kỳ chưa thu'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT COALESCE(OLD.opening_balance, false) OR COALESCE(OLD.paid, 0) <> 0 THEN
      RAISE EXCEPTION 'CONG_NO_KHOA: chỉ xoá được nợ đầu kỳ chưa thu đồng nào'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.paid IS DISTINCT FROM OLD.paid
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.return_id IS DISTINCT FROM OLD.return_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
     OR (NEW.amount IS DISTINCT FROM OLD.amount AND NOT COALESCE(OLD.opening_balance, false)) THEN
    RAISE EXCEPTION 'CONG_NO_KHOA: số nợ / số đã thu chỉ đổi qua hóa đơn, phiếu trả, phiếu thu (RPC)'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_cong_no ON public.receivables;
CREATE TRIGGER trg_khoa_ghi_thang_cong_no
  BEFORE INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_cong_no();

-- 2. payments / cash_receipt_lines -------------------------------------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_thu_tien()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Chỉ được xác nhận (đối chiếu) một khoản thu.
  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - ARRAY['verified_by', 'verified_at']) = (to_jsonb(OLD) - ARRAY['verified_by', 'verified_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'THU_TIEN_KHOA: tiền thu chỉ ghi / huỷ qua phiếu thu (lập phiếu thu, huỷ phiếu thu)'
    USING ERRCODE = 'P0001';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_payments ON public.payments;
CREATE TRIGGER trg_khoa_ghi_thang_payments
  BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_thu_tien();
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_dong_phieu_thu ON public.cash_receipt_lines;
CREATE TRIGGER trg_khoa_ghi_thang_dong_phieu_thu
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_thu_tien();

-- 3. cash_receipts -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_phieu_thu()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_cho text[] := ARRAY['status', 'received_by', 'received_at', 'notes'];
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - v_cho) = (to_jsonb(OLD) - v_cho)
     AND (NEW.status IS NOT DISTINCT FROM OLD.status OR (OLD.status = 'pending' AND NEW.status = 'received')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PHIEU_THU_KHOA: phiếu thu chỉ lập / huỷ qua nút Lập phiếu thu, Huỷ phiếu thu'
    USING ERRCODE = 'P0001';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_phieu_thu ON public.cash_receipts;
CREATE TRIGGER trg_khoa_ghi_thang_phieu_thu
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_receipts
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_phieu_thu();

-- 4. returns -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_phieu_tra()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_cho text[] := ARRAY['notes', 'reason', 'return_date', 'sales_user_id', 'credited_at', 'revenue_date'];
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'PHIEU_TRA_KHOA: phiếu trả lập ra ở Nháp — hoàn thành đi qua nút Hoàn thành'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'PHIEU_TRA_KHOA: chỉ xoá được phiếu trả Nháp — phiếu đã xử lý thì huỷ'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: trạng thái phiếu trả chỉ đổi qua Hoàn thành / Huỷ (% → %)', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'draft'
     AND (to_jsonb(NEW) - v_cho) IS DISTINCT FROM (to_jsonb(OLD) - v_cho) THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: phiếu trả đã qua Nháp chỉ sửa được ghi chú / lý do / ngày / người đứng tên — sửa hàng, tiền đi qua màn sửa phiếu'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.applied_receipt_id IS DISTINCT FROM OLD.applied_receipt_id
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.credit_with_invoice IS DISTINCT FROM OLD.credit_with_invoice THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: cột này chỉ đổi qua RPC' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_phieu_tra ON public.returns;
CREATE TRIGGER trg_khoa_ghi_thang_phieu_tra
  BEFORE INSERT OR UPDATE OR DELETE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_phieu_tra();

-- 5. return_lines: chỉ khi phiếu còn Nháp; thành tiền máy chủ tự tính -------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_dong_tra()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_st text;
BEGIN
  IF NOT public._la_trinh_duyet() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT r.status INTO v_st FROM returns r WHERE r.id = COALESCE(NEW.return_id, OLD.return_id);
  IF v_st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: dòng hàng chỉ sửa được khi phiếu trả còn Nháp (đang %)', COALESCE(v_st, '?')
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.return_id IS DISTINCT FROM OLD.return_id THEN
    RAISE EXCEPTION 'PHIEU_TRA_KHOA: không chuyển dòng sang phiếu khác' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    -- ⚠ Cùng công thức `toReturnLine` / `_apply_return_edits`: SL × giá × (1 + thuế).
    NEW.line_total := round(COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 + COALESCE(NEW.vat_rate, 0)));
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_dong_tra ON public.return_lines;
CREATE TRIGGER trg_khoa_ghi_thang_dong_tra
  BEFORE INSERT OR UPDATE OR DELETE ON public.return_lines
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_dong_tra();

-- 6. sales_order_lines.invoiced_qty -----------------------------------------------
CREATE OR REPLACE FUNCTION public._khoa_ghi_thang_da_xuat()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF public._la_trinh_duyet()
     AND ((TG_OP = 'INSERT' AND COALESCE(NEW.invoiced_qty, 0) <> 0)
       OR (TG_OP = 'UPDATE' AND NEW.invoiced_qty IS DISTINCT FROM OLD.invoiced_qty)) THEN
    RAISE EXCEPTION 'DON_KHOA: số đã xuất chỉ đổi khi lập / huỷ hóa đơn' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_khoa_ghi_thang_da_xuat ON public.sales_order_lines;
CREATE TRIGGER trg_khoa_ghi_thang_da_xuat
  BEFORE INSERT OR UPDATE ON public.sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._khoa_ghi_thang_da_xuat();

-- 7. post_invoice: dòng hóa đơn phải thuộc đúng đơn, đúng sản phẩm -----------------
DO $p$
DECLARE
  v_src text := pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure);
  v_re  text := '(v_date\s*:=\s*COALESCE\(\(p->>''invoice_date''\)::date,\s*current_date\);)';
BEGIN
  IF position('(mig 214)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 214: post_invoice đã kiểm dòng thuộc đơn, bỏ qua ---';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_re, 'g')) <> 1 THEN
    RAISE EXCEPTION '214: không thấy đúng một chỗ đặt ngày trong post_invoice' USING ERRCODE = 'P0001';
  END IF;
  EXECUTE regexp_replace(v_src, v_re,
    '-- (mig 214) Dòng mang order_line_id phải là dòng của ĐƠN NÀY và cùng sản phẩm.' || chr(10)
    || '  IF EXISTS (' || chr(10)
    || '    SELECT 1 FROM jsonb_array_elements(v_lines) AS l214' || chr(10)
    || '    WHERE NULLIF(l214->>''order_line_id'', '''') IS NOT NULL' || chr(10)
    || '      AND NOT EXISTS (SELECT 1 FROM sales_order_lines sol214' || chr(10)
    || '                      WHERE sol214.id = (l214->>''order_line_id'')::uuid AND sol214.order_id = v_order' || chr(10)
    || '                        AND sol214.product_id = (l214->>''product_id'')::uuid)' || chr(10)
    || '  ) THEN' || chr(10)
    || '    RAISE EXCEPTION ''BAD_LINE: dòng hóa đơn không thuộc đơn này hoặc sai sản phẩm'' USING ERRCODE = ''P0001'';' || chr(10)
    || '  END IF;' || chr(10)
    || '  \1');
END;
$p$;

NOTIFY pgrst, 'reload schema';

SELECT 'mig 214: khoá ghi thẳng' AS buoc,
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname IN (
                   'trg_khoa_ghi_thang_cong_no', 'trg_khoa_ghi_thang_payments', 'trg_khoa_ghi_thang_dong_phieu_thu',
                   'trg_khoa_ghi_thang_phieu_thu', 'trg_khoa_ghi_thang_phieu_tra', 'trg_khoa_ghi_thang_dong_tra',
                   'trg_khoa_ghi_thang_da_xuat')) = 7
             AND position('(mig 214)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
