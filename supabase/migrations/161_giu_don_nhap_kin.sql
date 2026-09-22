-- ====================================================================
-- GIỮ NGUYÊN LUẬT "NHÁP LÀ SỔ TAY RIÊNG CỦA NVBH"
--
-- Chủ nhà chốt 22/09/2026, nguyên văn: "Tao vẫn muốn NPP ko thấy được
-- đơn nháp của nhân viên."
--
-- ⚠ TỆP NÀY LÀ MỘT LỜI RÚT LẠI, KHÔNG PHẢI MỘT LUẬT MỚI. Số 161 đã đi
--   qua hai bản trước đó và cả hai đều nới quyền đọc đơn nháp:
--     · bản 1 — thêm cột `created_by` + trigger, cho NGƯỜI ĐÃ GÕ thấy
--       nháp mình gõ;
--     · bản 2 — nới thẳng cho vai trò `owner` / `manager`.
--   Chủ nhà bác cả hai. Tệp này trả `sales_order_select` về ĐÚNG bản
--   mig 119, và dọn mọi thứ hai bản kia có thể đã dựng lên.
--
-- ⚠ VẪN GIỮ TỆP CHỨ KHÔNG XOÁ ĐI COI NHƯ CHƯA CÓ GÌ. Hai bản kia đã
--   nằm trong lịch sử kho mã; ai đã chạy một trong hai thì cơ sở dữ
--   liệu của họ đang mang một chính sách nới rộng mà không có gì gỡ ra.
--   Một tệp chạy lại được nhiều lần (idempotent) là cách duy nhất chắc
--   chắn mọi máy về cùng một chỗ.
--
-- ⚠ VẬY CÒN LỖI 42501 THÌ SAO? Nó có thật, và nó vẫn còn:
--       chủ NPP lập đơn đứng tên nhân viên rồi bấm "Lưu nháp"
--       → `INSERT … RETURNING` phải đọc lại hàng vừa ghi
--       → chính sách này giấu hàng ấy đi
--       → new row violates row-level security policy (42501)
--   Nay KHÔNG sửa ở cơ sở dữ liệu nữa mà sửa ở GIAO DIỆN: làm đơn hộ
--   nhân viên thì nút "Lưu nháp" mờ đi, chỉ gửi đơn được. Đó là điều
--   chủ nhà chốt trong cùng một câu, và nó đúng về nghiệp vụ: một tờ
--   nháp đứng tên người khác thì người gõ không quản được nó nữa, nên
--   đừng tạo ra nó.
--
-- ⚠ MỘT ĐƠN ĐÃ GỬI (`submitted`) THÌ KHÔNG DÍNH GÌ Ở ĐÂY. Vế nháp chỉ
--   chặn `status = 'draft'`; gửi đơn hộ nhân viên đọc lại được bình
--   thường, và đã đo trên Postgres 16 thật.
-- ====================================================================

-- Dọn bản 161 thứ nhất, nếu có ai đã chạy nó.
-- ⚠ GIỮ LẠI CỘT `created_by` nếu nó đã được thêm: bỏ cột là thao tác
--   không lùi được, mà một cột rỗng thì chiếm chỗ chứ không hại gì.
DROP TRIGGER IF EXISTS trg_orders_created_by ON sales_orders;
DROP FUNCTION IF EXISTS public.set_order_created_by();

-- ---------------------------------------------------------------------
-- ⚠ CHÉP LẠI NGUYÊN VĂN `sales_order_select` CỦA MIG 119. Chép thiếu
--   một nhánh ở đây là âm thầm cắt quyền đọc của một vai trò — và RLS
--   từ chối thì màn hình chỉ thấy danh sách ngắn đi, không thấy lỗi nào.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS sales_order_select ON sales_orders;
CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      -- ⚠ ĐÚNG HAI VẾ, Y NHƯ MIG 119. Nháp chỉ người đứng tên đơn thấy,
      --   áp cho MỌI vai trò — kể cả chủ nhà phân phối.
      status <> 'draft'
      OR sales_user_id = auth.uid()
    )
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      OR public.user_has_permission(auth.uid(), 'customer.view_all')
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.customer_id = sales_orders.customer_id
          AND ca.user_id = auth.uid()
          AND ca.status = 'active'
      )
      OR (
        public.user_role() = 'driver'
        AND id IN (
          SELECT dl.order_id FROM delivery_lines dl
          JOIN deliveries d ON d.id = dl.delivery_id
          WHERE d.driver_id = auth.uid()
        )
      )
    )
  );

COMMENT ON POLICY sales_order_select ON sales_orders IS
  'Nháp là sổ tay riêng của NVBH: chưa gửi thì chỉ người đứng tên đơn '
  'thấy, kể cả chủ nhà phân phối cũng không (mig 119, giữ nguyên ở mig '
  '161). Vì vậy giao diện KHÔNG cho lưu nháp một đơn đứng tên người '
  'khác — xem nút "Lưu nháp" ở màn /pos và /sell/cart.';

-- ⚠ KIỂM BẰNG NGUYÊN VĂN VẾ NHÁP ĐÃ CHUẨN HOÁ, không kiểm bằng
--   `NOT LIKE '%draft%owner%'`. Bản đầu của khối này dùng đúng kiểu ấy
--   và nó BÁO SAI: chuỗi `qual` có chữ "draft" ở vế nháp rồi mới tới
--   "owner" ở khối vai trò bên dưới, nên phép so luôn khớp dù vế nháp
--   sạch. Một phép kiểm báo sai thì lần sau người ta bỏ qua nó.
DO $$
DECLARE v_qual text; v_trg int;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
  WHERE tablename = 'sales_orders' AND policyname = 'sales_order_select';
  SELECT count(*) INTO v_trg FROM pg_trigger
  WHERE tgname = 'trg_orders_created_by' AND NOT tgisinternal;
  IF v_qual IS NULL THEN
    RAISE EXCEPTION '161: chính sách đọc đơn KHÔNG được dựng lại';
  ELSIF position('((status <> ''draft''::text) OR (sales_user_id = auth.uid()))' in v_qual) = 0 THEN
    RAISE EXCEPTION '161: vế nháp không phải đúng hai điều kiện của mig 119';
  ELSIF v_trg <> 0 THEN
    RAISE EXCEPTION '161: trigger thừa của bản 161 cũ vẫn còn';
  ELSE
    RAISE NOTICE '--- 161: nháp vẫn kín, kể cả với chủ nhà phân phối ---';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
