-- ====================================================================
-- 154_sales_sees_customer_of_own_order
--
-- NHÂN VIÊN MỞ ĐƠN NPP GIAO CHO MÌNH → KHÔNG CÓ TÊN KHÁCH HÀNG.
--
-- ⚠ CHỦ NHÀ BÁO 21/09/2026: "Tạo đơn hàng hộ nhân viên — Nhân viên vào
--   xem ko có tên khách hàng".
--
-- NGUYÊN NHÂN. Hai chính sách RLS dùng HAI LUẬT KHÁC NHAU cho cùng một
-- việc:
--
--   `sales_order_select` (mig 119) cho NVBH thấy đơn khi
--      `sales_user_id = auth.uid()`  — tức là "đơn đứng tên tôi".
--
--   `customer_select` (mig 042) KHÔNG có vế ấy. NVBH chỉ thấy khách khi
--      có dòng `customer_assignments` đang hoạt động, hoặc chính mình
--      tạo ra khách đó.
--
-- Nên khi NPP lập đơn hộ nhân viên cho một khách CHƯA giao cho người ấy:
-- nhân viên thấy ĐƠN, nhưng dòng khách bị RLS chặn. Màn đơn đọc khách
-- bằng embed `customer:customers(...)` — PostgREST trả `null` cho phần
-- bị chặn, KHÔNG báo lỗi. Người dùng thấy một đơn không tên khách, và
-- không có gì nói cho họ biết vì sao.
--
-- ⚠ CHỮA Ở customers, KHÔNG PHẢI Ở customer_assignments. Cách kia là
--   NPP giao đơn thì tự thêm một dòng phân công — nhưng phân công là
--   một quyết định KHÁC và nặng hơn nhiều: nó mở cho nhân viên toàn bộ
--   lịch sử, công nợ, và mọi đơn khác của khách ấy, vĩnh viễn. Ở đây
--   chỉ cần đúng một điều: đơn đứng tên ai thì người đó đọc được khách
--   CỦA ĐƠN ẤY. Đó chính là luật mà `sales_order_select` đang dùng.
--
-- ⚠ PHẢI ĐI QUA HÀM `SECURITY DEFINER`, KHÔNG ĐƯỢC TRUY VẤN THẲNG.
--   `customers` hỏi `sales_orders`, mà chính sách của `sales_orders` lại
--   hỏi `customer_assignments`, và chính sách của bảng ấy hỏi ngược
--   `customers` → đệ quy vô tận, PostgREST trả 500. Kho mã này đã dính
--   đúng lỗi đó hai lần (mig 005, mig 037) và đã có sẵn lối ra: nhấc
--   phép tra cứu vào một hàm `SECURITY DEFINER` chạy bằng quyền chủ
--   bảng, bỏ qua RLS, nên không bật ngược lại được.
-- ====================================================================

-- --------------------------------------------------------------------
-- Khách này có đơn nào đang đứng tên tôi không?
--
-- ⚠ KHÔNG LỌC TRẠNG THÁI ĐƠN. Đơn đã huỷ, đã xong, hay còn nháp đều là
--   đơn nhân viên ấy phải mở ra xem lại được — và mở ra mà không có tên
--   khách thì đúng bằng không mở được.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_sells_to_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_orders so
    WHERE so.customer_id = p_customer_id
      AND so.sales_user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_sells_to_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_sells_to_customer(uuid) TO authenticated;

COMMENT ON FUNCTION public.user_sells_to_customer(uuid) IS
  'Khách này có đơn nào đứng tên người đang đăng nhập không. SECURITY '
  'DEFINER để chính sách của customers hỏi sales_orders mà không bật '
  'ngược về customers qua customer_assignments (xem mig 005, 037).';

-- --------------------------------------------------------------------
-- Dựng lại `customer_select` — giữ NGUYÊN bản mig 042, thêm MỘT vế.
--
-- ⚠ CHÉP TỪ BẢN ĐANG CHẠY, KHÔNG CHÉP TỪ TỆP CŨ NHẤT TÌM THẤY. Bài học
--   của mig 151: viết lại trọn một thứ bằng bản cũ là ÂM THẦM xoá mọi
--   miếng vá sau nó. Ở đây mig 042 là migration cuối cùng đụng tới
--   `customers`, và khối tự kiểm ở cuối tệp đối chiếu lại bản thật.
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS customer_select ON customers;

CREATE POLICY customer_select ON customers
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR (
        EXISTS (
          SELECT 1 FROM customer_assignments ca
          WHERE ca.customer_id = customers.id
            AND ca.user_id = auth.uid()
            AND ca.status = 'active'
        )
      )
      OR (
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'customers' AND column_name = 'created_by'
        ) AND created_by = auth.uid()
      )
      -- ⚠ VẾ MỚI CỦA MIG 154. Đơn đứng tên tôi thì tôi đọc được khách
      --   của đơn ấy — đúng luật mà `sales_order_select` đang dùng để
      --   cho tôi thấy chính cái đơn đó.
      OR public.user_sells_to_customer(customers.id)
    )
  );

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Kiểm BẢN ĐANG CHẠY, không kiểm tệp.
-- --------------------------------------------------------------------
DO $$
DECLARE v_src text; v_thieu text := '';
BEGIN
  SELECT qual INTO v_src FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'customers'
    AND policyname = 'customer_select';

  IF v_src IS NULL THEN
    RAISE WARNING '--- 154 ⚠ không thấy chính sách customer_select ---';
    RETURN;
  END IF;

  IF position('user_sells_to_customer' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [thiếu vế đơn-đứng-tên-tôi của mig 154]';
  END IF;
  IF position('customer_assignments' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [MẤT vế phân công khách — NVBH sẽ không thấy khách được giao]';
  END IF;
  IF position('created_by' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [MẤT vế khách do chính mình tạo]';
  END IF;
  IF position('user_has_permission' IN v_src) = 0 THEN
    v_thieu := v_thieu || ' [MẤT vế quyền customer.view_all]';
  END IF;

  IF v_thieu = '' THEN
    RAISE NOTICE '--- 154: nhân viên đọc được khách của đơn đứng tên mình, bốn vế cũ còn nguyên ---';
  ELSE
    RAISE WARNING '--- 154 ⚠ customer_select THIẾU:% ---', v_thieu;
  END IF;
END $$;
