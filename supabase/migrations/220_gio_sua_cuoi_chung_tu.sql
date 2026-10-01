-- ====================================================================
-- 220 — GIỜ SỬA CUỐI CỦA ĐƠN HÀNG / HOÁ ĐƠN / PHIẾU TRẢ (cho mẫu in)
--
-- VÌ SAO — chủ nhà 01/10/2026: "Sửa mẫu in hoá đơn. Thời gian trên phiếu là ngày giờ tạo chứ ko phải
--   ngày giờ in" → "Giờ sửa cuối. Hiện tại đang giờ tạo lần đầu".
--   Ba bảng chỉ có `created_at` — sửa đơn (POS sửa tại chỗ, mã đơn lên `-1`, `-2`…) hay sửa phiếu trả
--   Nháp thì tờ in vẫn mang giờ lập lần đầu.
--
-- CÁCH LÀM
--   1. Cột `updated_at timestamptz` cho `sales_orders`, `sales_invoices`, `returns`; dữ liệu cũ = `created_at`
--      (không biết lần sửa trước — giữ đúng như tờ in hiện tại).
--   2. BEFORE UPDATE: đổi NỘI DUNG (khách, ngày, tiền, ghi chú…) → `updated_at = now()`. Đổi TRẠNG THÁI
--      (gửi, xuất, hoàn thành, huỷ), `invoiced_qty`, lô soạn hàng KHÔNG phải sửa — không động.
--      Đơn hàng dùng đúng bộ cột của `trg_sales_orders_bump_edit` (cái đếm "lần sửa" + mã đơn), thêm ngày đơn.
--      Tên `trg_zzz_*` → chạy SAU các trigger khoá ghi thẳng (chúng không thấy cột mới đổi).
--   3. Dòng hàng thêm / sửa nội dung / xoá → chạm `updated_at` của chứng từ (đổi một ghi chú dòng mà tổng
--      không đổi vẫn là sửa). Hàm SECURITY DEFINER — đi qua các khoá ghi thẳng của trình duyệt như mọi RPC.
--   Hoá đơn: "Sửa HĐ" là huỷ & lập tờ mới (mig 184) — tờ mới có `created_at` = lúc sửa, `updated_at` theo.
-- ⚠ Hàm nội bộ SECURITY DEFINER — REVOKE (luật mig 166).
-- ====================================================================

-- 1. Cột ---------------------------------------------------------------
ALTER TABLE sales_orders   ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE returns        ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE sales_orders   SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE sales_invoices SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE returns        SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE sales_orders   ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE sales_invoices ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE returns        ALTER COLUMN updated_at SET DEFAULT now();

-- 2. Sửa nội dung đầu chứng từ ------------------------------------------
CREATE OR REPLACE FUNCTION public._sua_luc_don()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.customer_id          IS DISTINCT FROM OLD.customer_id
     OR NEW.payment_terms     IS DISTINCT FROM OLD.payment_terms
     OR NEW.expected_delivery IS DISTINCT FROM OLD.expected_delivery
     OR NEW.order_date        IS DISTINCT FROM OLD.order_date
     OR NEW.subtotal          IS DISTINCT FROM OLD.subtotal
     OR NEW.vat               IS DISTINCT FROM OLD.vat
     OR NEW.total             IS DISTINCT FROM OLD.total
     OR NEW.discount          IS DISTINCT FROM OLD.discount
     OR NEW.notes             IS DISTINCT FROM OLD.notes
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._sua_luc_hoa_don()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.customer_id       IS DISTINCT FROM OLD.customer_id
     OR NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date
     OR NEW.payment_terms  IS DISTINCT FROM OLD.payment_terms
     OR NEW.subtotal       IS DISTINCT FROM OLD.subtotal
     OR NEW.vat            IS DISTINCT FROM OLD.vat
     OR NEW.total          IS DISTINCT FROM OLD.total
     OR NEW.notes          IS DISTINCT FROM OLD.notes
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._sua_luc_phieu_tra()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.customer_id      IS DISTINCT FROM OLD.customer_id
     OR NEW.order_id      IS DISTINCT FROM OLD.order_id
     OR NEW.invoice_id    IS DISTINCT FROM OLD.invoice_id
     OR NEW.reason        IS DISTINCT FROM OLD.reason
     OR NEW.notes         IS DISTINCT FROM OLD.notes
     OR NEW.return_date   IS DISTINCT FROM OLD.return_date
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON sales_orders;
CREATE TRIGGER trg_zzz_sua_luc BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_don();
DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON sales_invoices;
CREATE TRIGGER trg_zzz_sua_luc BEFORE UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_hoa_don();
DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON returns;
CREATE TRIGGER trg_zzz_sua_luc BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_phieu_tra();

-- 3. Dòng hàng đổi → chạm chứng từ ---------------------------------------
--   TG_ARGV[0] = bảng chứng từ, TG_ARGV[1] = cột khoá trên dòng.
CREATE OR REPLACE FUNCTION public._sua_luc_tu_dong()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  n jsonb;
  o jsonb;
  -- Cột KHÔNG phải sửa: số đã xuất HĐ, lô gán lúc soạn hàng, thứ tự hiển thị.
  v_bo text[] := ARRAY['invoiced_qty', 'batch_id', 'sort_order'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    n := to_jsonb(NEW) - v_bo;
    o := to_jsonb(OLD) - v_bo;
    IF n = o THEN
      RETURN NEW;
    END IF;
  END IF;
  v_id := ((CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END) ->> TG_ARGV[1])::uuid;
  IF v_id IS NOT NULL THEN
    EXECUTE format('UPDATE %I SET updated_at = now() WHERE id = $1 AND updated_at IS DISTINCT FROM now()', TG_ARGV[0])
      USING v_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._sua_luc_tu_dong() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON sales_order_lines;
CREATE TRIGGER trg_zzz_sua_luc AFTER INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_tu_dong('sales_orders', 'order_id');
DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON sales_invoice_lines;
CREATE TRIGGER trg_zzz_sua_luc AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_tu_dong('sales_invoices', 'invoice_id');
DROP TRIGGER IF EXISTS trg_zzz_sua_luc ON return_lines;
CREATE TRIGGER trg_zzz_sua_luc AFTER INSERT OR UPDATE OR DELETE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION public._sua_luc_tu_dong('returns', 'return_id');

NOTIFY pgrst, 'reload schema';

SELECT 'mig 220: giờ sửa cuối của đơn / hoá đơn / phiếu trả' AS buoc,
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema = 'public' AND column_name = 'updated_at'
                    AND table_name IN ('sales_orders', 'sales_invoices', 'returns')) = 3
             AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_zzz_sua_luc') = 6
            THEN 'OK' ELSE 'THIẾU' END AS ket_qua;
