-- ====================================================================
-- NGƯỜI TẠO / NGƯỜI ĐƯỢC GÁN TRÊN ĐƠN HÀNG, HÓA ĐƠN, PHIẾU TRẢ
--
-- Chủ nhà yêu cầu 23/09/2026: "Đơn hàng, Bán hàng, Trả lại: các phiếu có
-- Người tạo, Người được gán (chỉ NPP có quyền gán)".
--
-- ⚠ HAI CỘT, HAI NGHĨA — ĐỪNG GỘP:
--   · NGƯỜI TẠO là ai bấm lập phiếu. Không đổi được, do máy chủ ghi.
--       đơn hàng  → `sales_orders.created_by`   (MỚI — trước nay không có)
--       hóa đơn   → `sales_invoices.posted_by`  (sẵn có, `post_invoice` ghi)
--       phiếu trả → `returns.requested_by`      (sẵn có)
--   · NGƯỜI ĐƯỢC GÁN là ai đứng tên doanh số / hoa hồng: `sales_user_id`
--     trên cả ba bảng. NPP lập đơn hộ nhân viên thì hai người khác nhau —
--     đúng lý do phải hiện cả hai.
--
-- ⚠ ĐƠN HÀNG CHƯA CÓ CỘT NGƯỜI TẠO. `sales_user_id` là người ĐƯỢC GÁN
--   (mig 153 cho NPP gán đơn cho nhân viên), nên đọc nó làm người tạo là
--   sai đúng ở những đơn NPP lập hộ. Cột mới do trigger ghi `auth.uid()`
--   lúc chèn và KHOÁ khi sửa — trình duyệt gửi gì cũng không đổi được.
--   Đơn cũ lấy từ nhật ký dòng đơn (`order_activity_log`, người thêm dòng
--   đầu tiên); không có nhật ký thì để trống — màn ghi "chưa rõ", không đoán.
--
-- ⚠ GÁN LẠI HÓA ĐƠN / PHIẾU TRẢ QUA RPC `assign_doc_seller`. Đơn hàng đã có
--   đường gán lúc lưu đơn (trigger mig 153). Hóa đơn thì không: nó do RPC
--   ghi, và đổi người đứng tên phải đổi CẢ công nợ của nó (`receivables.
--   sales_user_id` — thứ báo cáo thu tiền theo nhân viên đọc). Luật quyền
--   giữ đúng mig 153: chỉ owner / manager; người được gán cùng đơn vị, vai
--   trò sales / manager / owner, còn hoạt động.
-- ====================================================================

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);

CREATE OR REPLACE FUNCTION public._trg_don_nguoi_tao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Có phiên đăng nhập thì người tạo là CHÍNH phiên ấy — bỏ qua giá trị gửi lên.
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._trg_don_nguoi_tao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_don_nguoi_tao ON public.sales_orders;
CREATE TRIGGER trg_don_nguoi_tao
  BEFORE INSERT OR UPDATE OF created_by ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_don_nguoi_tao();

-- Đơn cũ: người thêm dòng đầu tiên theo nhật ký. Trigger trên chỉ khoá
-- khi sửa — tắt nó trong khối này để điền được một lần.
DO $dien$
DECLARE v_n int;
BEGIN
  ALTER TABLE public.sales_orders DISABLE TRIGGER trg_don_nguoi_tao;
  UPDATE public.sales_orders so
     SET created_by = x.actor_id
    FROM (
      SELECT DISTINCT ON (l.order_id) l.order_id, l.actor_id
      FROM public.order_activity_log l
      WHERE l.actor_id IS NOT NULL
      ORDER BY l.order_id, l.created_at
    ) x
   WHERE so.id = x.order_id
     AND so.created_by IS NULL
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = x.actor_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ALTER TABLE public.sales_orders ENABLE TRIGGER trg_don_nguoi_tao;
  RAISE NOTICE '--- 178: điền người tạo cho % đơn cũ từ nhật ký ---', v_n;
END;
$dien$;

-- ---------------------------------------------------------------------
-- Gán lại người đứng tên hóa đơn / phiếu trả
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_doc_seller(p_kind text, p_id uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org uuid := public.user_org_id();
BEGIN
  IF public.user_role() NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'ASSIGN_FORBIDDEN: chỉ NPP (chủ / quản lý) được gán người phụ trách'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_user AND u.org_id = v_org
      AND u.role IN ('sales', 'manager', 'owner')
      AND COALESCE(u.is_active, true)
  ) THEN
    RAISE EXCEPTION 'ASSIGN_BAD_USER: người được gán phải là nhân viên bán hàng / quản lý / chủ đang hoạt động của đơn vị'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  IF p_kind = 'invoice' THEN
    UPDATE sales_invoices SET sales_user_id = p_user WHERE id = p_id AND org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND: không tìm thấy hóa đơn' USING ERRCODE = 'P0001';
    END IF;
    -- Công nợ của tờ ấy đi theo người đứng tên — báo cáo thu tiền đọc cột này.
    UPDATE receivables SET sales_user_id = p_user WHERE invoice_id = p_id;
  ELSIF p_kind = 'return' THEN
    UPDATE returns SET sales_user_id = p_user WHERE id = p_id AND org_id = v_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND: không tìm thấy phiếu trả' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'ASSIGN_BAD_KIND: %', p_kind USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', '', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.assign_doc_seller(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_doc_seller(text, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Bảng tóm tắt — chỉ đọc
-- ---------------------------------------------------------------------
SELECT 'Đơn hàng đã có người tạo' AS hang_muc, count(*)::text AS so_luong
FROM sales_orders WHERE created_by IS NOT NULL
UNION ALL
SELECT 'Đơn hàng chưa rõ người tạo (không có nhật ký)', count(*)::text
FROM sales_orders WHERE created_by IS NULL
UNION ALL
SELECT 'Hàm gán người phụ trách assign_doc_seller',
       CASE WHEN to_regprocedure('public.assign_doc_seller(text, uuid, uuid)') IS NOT NULL THEN 'có' ELSE 'CHƯA' END;
