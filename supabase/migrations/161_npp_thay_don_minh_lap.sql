-- ====================================================================
-- CHỦ NPP / QUẢN LÝ NHÌN THẤY CẢ ĐƠN NHÁP
--
-- Chủ nhà chốt 22/09/2026, nguyên văn: "chỉ chủ NPP mới được làm đơn
-- gán cho nhân viên bán hàng, chủ NPP đương nhiên nhìn thấy mọi đơn
-- rồi cần gì làm phức tạp vậy?"
--
-- ⚠ CÂU "ĐƯƠNG NHIÊN NHÌN THẤY MỌI ĐƠN" HÔM NAY LÀ SAI, và đó chính là
--   lỗi chủ nhà đang báo. `sales_order_select` (mig 119) có vế
--       AND (status <> 'draft' OR sales_user_id = auth.uid())
--   nằm NGOÀI khối OR vai trò, tức nó áp cho MỌI vai trò — kể cả chủ
--   NPP. Chủ NPP không thấy một đơn nháp nào không đứng tên mình.
--
-- ⚠ VÀ NÓ NỔ RA ĐÚNG LÚC LẬP ĐƠN HỘ. Đo trên Postgres 16 thật, chủ NPP
--   lập đơn đứng tên nhân viên:
--     · "Gửi đơn"  (status submitted) → ghi được, đọc lại được. CHẠY.
--     · "Lưu nháp" (status draft)     → `INSERT … RETURNING` ném đúng
--       câu chủ nhà gặp:
--         new row violates row-level security policy for table
--         "sales_orders"  (42501)
--   Vì `RETURNING` phải đọc lại hàng vừa ghi, mà chính sách SELECT giấu
--   nó đi. Và `createOrderRecords` đọc lại bằng
--   `.select("id, order_code").single()` — đúng đường ấy.
--
--   Sổ vẫn có đơn. Người vừa lập ra nó thì không. Đó là kiểu hỏng tệ
--   nhất: không mất dữ liệu, chỉ mất tầm nhìn.
--
-- CÁCH SỬA — MỘT VẾ, KHÔNG THÊM CỘT
--
--   ⚠ BẢN ĐẦU CỦA TÔI THÊM HẲN MỘT CỘT `created_by` để "chỉ người đã gõ
--     mới thấy nháp mình gõ". Chủ nhà bác, và bác đúng: ở đây người gõ
--     đơn hộ LUÔN LÀ chủ NPP hoặc quản lý, nên một cột mới, một trigger
--     và một phép đối chiếu chỉ để nói lại đúng câu "chủ NPP thì thấy".
--     Giữ cột ấy là bắt mọi đường ghi đơn về sau phải nhớ tới nó.
--
--   Nên: nới vế nháp cho đúng hai vai trò ấy. Một dòng.
--
-- ⚠ LUẬT MIG 119 BỊ ĐẢO Ở ĐÂY, VÀ NÓI RA CHO RÕ. Mig 119 ghi "Nháp là
--   sổ tay riêng của NVBH: chưa gửi thì NPP không nhìn thấy", và có cả
--   một chốt canh "áp cho MỌI vai trò". Từ nay KHÔNG còn đúng: chủ NPP
--   và quản lý thấy cả nháp dở dang của nhân viên. Đó là điều chủ nhà
--   vừa chốt, không phải điều tôi tiện tay đổi.
--
-- ⚠ KHÔNG NỚI CHO `accountant` VÀ `warehouse`, dù hai vai trò ấy có mặt
--   trong khối OR bên dưới. Chủ nhà nói "chủ NPP"; kế toán và thủ kho
--   không lập đơn hộ ai, nên một đơn chưa gửi không phải việc của họ.
--
-- ⚠ DỌN LẠI BẢN ĐẦU CHO SẠCH. Nếu ai đã chạy bản 161 trước (có cột
--   `created_by` và trigger điền nó) thì gỡ trigger đi — để lại là một
--   cỗ máy chạy hoài cho một cột không ai đọc. Cột thì GIỮ: bỏ cột là
--   thao tác không lùi được, mà nó chỉ chiếm chỗ chứ không hại gì.
--
-- ⚠ ĐÁNH SỐ 161. `newdesign` giữ 156, 157, 159; `main` giữ 158, 160.
-- ====================================================================

-- Dọn bản 161 đầu tiên, nếu có ai đã chạy nó.
DROP TRIGGER IF EXISTS trg_orders_created_by ON sales_orders;
DROP FUNCTION IF EXISTS public.set_order_created_by();

-- ---------------------------------------------------------------------
-- ⚠ CHÉP LẠI NGUYÊN VĂN `sales_order_select` CỦA MIG 119, đổi đúng MỘT
--   vế. Chép thiếu một nhánh ở đây là âm thầm cắt quyền đọc của một vai
--   trò — và RLS từ chối thì màn hình chỉ thấy danh sách ngắn đi, không
--   thấy lỗi nào.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS sales_order_select ON sales_orders;
CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      status <> 'draft'
      OR sales_user_id = auth.uid()
      -- ⚠ VẾ MỚI, VÀ LÀ VẾ DUY NHẤT ĐỔI.
      OR public.user_role() IN ('owner', 'manager')
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
  'Đơn nháp: chủ NPP, quản lý, và người đứng tên đơn thấy được (mig 119 '
  '+ 161 — mig 119 giấu nháp khỏi cả chủ NPP, và đó là lý do lập đơn hộ '
  'nhân viên rồi lưu nháp bị 42501). Đơn đã gửi theo bộ quyền bên dưới.';

DO $$
DECLARE v_pol int; v_nhap int;
BEGIN
  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE tablename = 'sales_orders' AND policyname = 'sales_order_select'
    AND qual LIKE '%status <> ''draft''%';
  SELECT count(*) INTO v_nhap FROM sales_orders WHERE status = 'draft';
  IF v_pol = 1 THEN
    RAISE NOTICE '--- 161: chủ NPP / quản lý thấy được đơn nháp · % đơn nháp trong sổ ---', v_nhap;
  ELSE
    RAISE EXCEPTION '161: chính sách đọc đơn KHÔNG được dựng lại';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
