-- ====================================================================
-- NPP LẬP ĐƠN GIÚP NHÂN VIÊN THÌ PHẢI THẤY ĐƠN MÌNH VỪA LẬP
--
-- Chủ nhà báo 22/09/2026: gán đơn cho nhân viên thì màn hình ném
--   "new row violates row-level security policy for table
--    sales_orders (mã 42501)"
--
-- ĐÃ DỰNG LẠI ĐƯỢC TRÊN POSTGRES 16 THẬT, và hoá ra là HAI lỗi khác
-- nhau đứng cạnh nhau, không phải một.
--
-- ⚠ LỖI 1 — 42501, VÀ NÓ KHÔNG PHẢI LỖI CỦA CƠ SỞ DỮ LIỆU.
--
--   Chính sách `"Sales can update own open orders"` (mig 119) có
--   `WITH CHECK (… AND sales_user_id = auth.uid() …)`. Một NVBH mở đơn
--   CỦA CHÍNH MÌNH rồi gán sang tên đồng nghiệp thì hàng cũ lọt `USING`
--   còn hàng mới trượt `WITH CHECK` — và Postgres ném đúng câu trên.
--
--   Đó là ĐÚNG LUẬT: mig 153 đã chốt "chỉ chủ nhà hoặc quản lý mới lập
--   đơn đứng tên nhân viên khác". Lỗi nằm ở GIAO DIỆN: màn `/pos` vẽ ô
--   "Gán đơn cho NVBH" cho MỌI vai trò, trong khi màn `/sell/cart` đã
--   che ô ấy khỏi NVBH từ mig 153. Mời người ta bấm một cái nút mà máy
--   chủ chắc chắn từ chối thì lỗi là của cái nút. Đã che ô ở màn `/pos`
--   trong cùng đợt này — migration không sửa gì cho lỗi 1.
--
-- ⚠ LỖI 2 — CÁI NÀY MỚI CẦN MIGRATION, VÀ NÓ CÒN IM HƠN.
--
--   Chính sách `sales_order_select` (mig 119) có:
--       AND (status <> 'draft' OR sales_user_id = auth.uid())
--   với lý do ghi rõ: "Nháp là sổ tay riêng của NVBH: chưa gửi thì NPP
--   không nhìn thấy". Luật ấy ĐÚNG và giữ nguyên.
--
--   Nhưng mig 153 mở cho NPP lập đơn giúp nhân viên, và không ai soi
--   lại luật trên. Hậu quả: NPP bấm "Lưu nháp" cho một đơn đứng tên
--   nhân viên thì đơn ghi xuống được, nhưng chính NPP KHÔNG ĐỌC LẠI
--   ĐƯỢC. `createOrderRecords` chèn xong đọc lại bằng
--   `.select("id, order_code").single()` → 0 dòng → màn hình báo một
--   lỗi chẳng liên quan gì tới việc người ta vừa làm. Tệ hơn: đơn ấy có
--   thật trong sổ, nằm ngoài tầm nhìn của người vừa tạo ra nó.
--
--   Đây là chỗ hai migration mâu thuẫn nhau chứ không phải một lỗi gõ
--   nhầm, nên phải sửa bằng một luật mới, không phải bằng một cái vá.
--
-- CÁCH SỬA
--
--   Thêm `created_by` — NGƯỜI GÕ đơn, khác `sales_user_id` là người đơn
--   TÍNH CHO. Đúng cặp cột mà `returns` đã có (`requested_by` /
--   `sales_user_id`, mig 160), và đúng một lý do: hai câu hỏi khác
--   nhau, gộp làm một là mất dấu vết người thao tác.
--
--   Rồi nới đúng MỘT vế của luật nháp: nháp còn hiện cho NGƯỜI ĐÃ GÕ
--   NÓ. Nháp của NVBH vẫn kín với NPP — NPP không gõ, không đứng tên,
--   nên hai vế đều sai và đơn vẫn khuất.
--
-- ⚠ KHÔNG NỚI CHO CẢ VAI TRÒ `owner`/`manager`. Nới kiểu ấy là xoá
--   thẳng luật của mig 119: mọi nháp dở dang của mọi NVBH lại hiện ra
--   hết. Chủ nhà chưa bảo bỏ luật ấy, và nó có lý do riêng.
--
-- ⚠ KHÔNG BACKFILL `created_by`. Đơn cũ để rỗng thì vế mới luôn sai,
--   tức hành xử y hệt hôm nay. Đoán ngược "đơn này chắc do ai gõ" là
--   ghi một phỏng đoán vào sổ rồi quên mất rằng nó là phỏng đoán.
--
-- ⚠ ĐIỀN BẰNG TRIGGER, KHÔNG ĐỢI CLIENT GỬI. Đơn sinh ra ở nhiều
--   đường (màn `/sell`, màn `/pos`, hàng đợi ngoại tuyến, RPC). Bắt
--   từng đường nhớ gửi thêm một cột là chắc chắn sót một đường, và
--   đường sót ấy lại rơi đúng vào cái hố vừa lấp.
--
-- ⚠ ĐÁNH SỐ 161. `newdesign` giữ 156, 157, 159; `main` giữ 158, 160.
-- ====================================================================

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);

COMMENT ON COLUMN sales_orders.created_by IS
  'Người GÕ đơn. Rỗng = đơn có trước mig 161. KHÁC sales_user_id (đơn '
  'tính doanh số cho ai). Dùng để người lập còn thấy được đơn nháp mình '
  'vừa lập hộ nhân viên.';

CREATE INDEX IF NOT EXISTS idx_orders_created_by ON sales_orders(created_by);

-- ---------------------------------------------------------------------
-- Điền người gõ
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_created_by()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ⚠ CHỈ ĐIỀN KHI CÒN RỖNG. Ghi đè là xoá mất dấu vết người gõ thật
  --   ở những đường có truyền sẵn (ví dụ đồng bộ hàng đợi ngoại tuyến
  --   gõ từ hôm trước, người đăng nhập hôm nay là người khác).
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_created_by ON sales_orders;
CREATE TRIGGER trg_orders_created_by
  BEFORE INSERT ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_created_by();

COMMENT ON FUNCTION public.set_order_created_by() IS
  'Ghi người gõ đơn vào sales_orders.created_by. Chạy ở trigger vì đơn '
  'sinh ra ở nhiều đường; bắt từng đường nhớ gửi là chắc chắn sót một.';

-- ---------------------------------------------------------------------
-- Nháp còn hiện cho người đã gõ nó
-- ---------------------------------------------------------------------
-- ⚠ CHÉP LẠI NGUYÊN VĂN `sales_order_select` CỦA MIG 119, đổi đúng MỘT
--   vế. Chép thiếu một nhánh ở đây là âm thầm cắt mất quyền đọc của
--   một vai trò nào đó — và RLS từ chối thì màn hình chỉ thấy danh sách
--   ngắn đi, không thấy lỗi nào.
DROP POLICY IF EXISTS sales_order_select ON sales_orders;
CREATE POLICY sales_order_select ON sales_orders
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      status <> 'draft'
      OR sales_user_id = auth.uid()
      -- ⚠ VẾ MỚI, VÀ LÀ VẾ DUY NHẤT ĐỔI: người gõ còn thấy nháp mình gõ.
      OR created_by = auth.uid()
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
  'Nháp là sổ tay riêng: chỉ người đứng tên đơn và người đã gõ đơn mới '
  'thấy (mig 119 + 161). Đơn đã gửi thì theo bộ quyền bên dưới.';

DO $$
DECLARE v_cot int; v_trg int; v_pol int; v_cu int;
BEGIN
  SELECT count(*) INTO v_cot FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'created_by';
  SELECT count(*) INTO v_trg FROM pg_trigger
  WHERE tgname = 'trg_orders_created_by' AND NOT tgisinternal;
  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE tablename = 'sales_orders' AND policyname = 'sales_order_select'
    AND qual LIKE '%created_by%';
  SELECT count(*) INTO v_cu FROM sales_orders WHERE status = 'draft' AND created_by IS NULL;
  IF v_cot = 1 AND v_trg = 1 AND v_pol = 1 THEN
    RAISE NOTICE '--- 161: NPP thấy được đơn nháp mình lập hộ · % đơn nháp cũ chưa có người gõ ---', v_cu;
  ELSE
    RAISE EXCEPTION '161: chưa đủ (cột %, trigger %, chính sách %)', v_cot, v_trg, v_pol;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
