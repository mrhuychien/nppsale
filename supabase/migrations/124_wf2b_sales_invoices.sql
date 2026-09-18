-- ---------------------------------------------------------------------
-- 124 — Workflow v2b: tách Đơn đặt hàng (SO) khỏi Hóa đơn bán (INV)
--
-- Phần CẤU TRÚC. Các RPC nằm ở migration 125.
-- ---------------------------------------------------------------------
--
-- ⚠ 124 VÀ 125 PHẢI CHẠY CÙNG NHAU. File này DROP `complete_order`,
--   `edit_completed_order`, `cancel_order` và `_wf2_recompute_receivable`
--   ở cuối; 125 mới dựng lại bộ thay thế. Chạy 124 một mình là ứng dụng
--   không còn đường nào để xuất hàng.
--
-- ---------------------------------------------------------------------
-- HAI CHỨNG TỪ, HAI VIỆC KHÁC NHAU
-- ---------------------------------------------------------------------
--
-- `sales_orders` (SO) — CAM KẾT CỦA KHÁCH. NVBH tạo. Không đụng kho,
-- không đụng công nợ. Sửa được chừng nào chưa xuất.
--
-- `sales_invoices` (INV) — THỰC XUẤT. Trừ kho FIFO, sinh công nợ, in
-- phiếu giao, là nguồn của hoá đơn điện tử và của doanh thu. Một SO đẻ
-- ra 0..n INV.
--
-- ⚠ VÌ SAO PHẢI TÁCH, nói bằng chuyện đã xảy ra: workflow v2 gộp hai thứ
--   này vào một dòng `sales_orders`. Hệ quả là "sửa đơn đã xuất" phải
--   tính DELTA kho (`edit_completed_order`), và để delta không phá sổ thì
--   phải dựng bốn khoá chặn (`_wf2_assert_order_unlocked`). Càng chặt
--   càng nhiều thứ không sửa được; càng lỏng càng dễ lệch kho. Tách ra
--   thì không còn delta: sai thì HUỶ hoá đơn rồi lập lại, kho hoàn về
--   đúng lô đã lấy.
--
-- ---------------------------------------------------------------------
-- ⚠ CHỐT CHẶN ĐẦU FILE — ĐỌC TRƯỚC KHI CHẠY
-- ---------------------------------------------------------------------
--
-- Backfill ở mục 9 đọc `sales_orders WHERE status = 'completed'`. Giá trị
-- đó do migration 119 sinh ra. Nếu 119 chưa chạy, bảng còn mang sáu giá
-- trị của luồng cũ (`confirmed`, `picking`, `delivering`, `delivered`…)
-- và backfill khớp 0 dòng — nó chạy ÊM RU rồi tạo ra 0 hoá đơn, không
-- lỗi nào bắn ra. Đó đúng là kiểu hỏng im lặng cả hai pack đang chống,
-- nên khối dưới đây DỪNG HẲN thay vì để nó trôi qua.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_legacy int; v_list text;
BEGIN
  SELECT count(*), string_agg(DISTINCT status, ', ')
    INTO v_legacy, v_list
  FROM sales_orders
  WHERE status NOT IN ('draft', 'submitted', 'completed', 'cancelled');

  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_V2: còn % đơn mang trạng thái của luồng cũ (%). Chạy migration 118 → 119 → 120 → 121 → 122 → 123 TRƯỚC, rồi chạy lại file này.',
      v_legacy, v_list
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.stock_line_consumptions') IS NULL THEN
    RAISE EXCEPTION
      'WF2B_NEEDS_V2: chưa có bảng stock_line_consumptions (migration 119). Hoàn kho khi huỷ hoá đơn dựa hẳn vào nó.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;


-- =====================================================================
-- 1. sales_invoices — hóa đơn bán
-- =====================================================================
--
-- ⚠ KHÔNG CÓ TRẠNG THÁI NHÁP. Hoá đơn sinh ra và ghi sổ trong CÙNG một
--   RPC; màn "chỉnh số lượng trước khi xuất" là trạng thái trên trình
--   duyệt, chưa chạm cơ sở dữ liệu. Có `draft` trong bảng là mở đường
--   cho một hoá đơn nằm lơ lửng: kho chưa trừ nhưng giấy đã in.
--
-- ⚠ `replaced_from` / `replaced_by` phục vụ việc SỬA hoá đơn. Về mặt kỹ
--   thuật không có sửa: `reissue_invoice` huỷ bản cũ rồi lập bản mới
--   trong một giao dịch. Hai cột này là sợi dây nối hai bản lại, để tra
--   cứu về sau còn biết bản đang xem thay cho cái gì.
CREATE TABLE IF NOT EXISTS sales_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_code   text NOT NULL,
  order_id       uuid NOT NULL REFERENCES sales_orders(id),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  sales_user_id  uuid REFERENCES users(id),
  invoice_date   date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL DEFAULT 'posted'
                 CHECK (status IN ('posted', 'cancelled')),
  subtotal       numeric NOT NULL DEFAULT 0,
  vat            numeric NOT NULL DEFAULT 0,
  total          numeric NOT NULL DEFAULT 0,
  payment_terms  text,
  due_date       date,
  stock_entry_id uuid REFERENCES stock_entries(id),
  notes          text,
  replaced_from  uuid REFERENCES sales_invoices(id),
  replaced_by    uuid REFERENCES sales_invoices(id),
  posted_at      timestamptz DEFAULT now(),
  posted_by      uuid REFERENCES users(id),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text,
  created_at     timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_code
  ON sales_invoices(org_id, invoice_code);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_status
  ON sales_invoices(org_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_order   ON sales_invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_id);

COMMENT ON TABLE sales_invoices IS
  'Hóa đơn bán — chứng từ THỰC XUẤT: trừ kho, sinh công nợ, nguồn doanh '
  'thu và hoá đơn điện tử. 1 đơn đặt hàng → 0..n hóa đơn. Không sửa tại '
  'chỗ: sai thì huỷ rồi lập lại (reissue_invoice), replaced_from/_by nối '
  'hai bản.';

-- =====================================================================
-- 2. sales_invoice_lines
-- =====================================================================
--
-- ⚠ `order_line_id` CHO PHÉP NULL, hai trường hợp:
--   · dòng hàng ĐỔI (`is_exchange`) — nó đến từ phiếu trả, không từ đơn;
--   · dòng NPP thêm ngoài đơn lúc xuất (PATCH 1 cho phép).
--   Trigger đồng bộ ở mục 3 bỏ qua các dòng này, nên chúng không ảnh
--   hưởng việc tính "đơn đã xuất đủ chưa".
--
-- ⚠ `vat_rate` SNAPSHOT TẠI THỜI ĐIỂM XUẤT. `sales_order_lines` KHÔNG có
--   cột thuế suất (chỉ `return_lines` mới có, mig 069) — v2 đọc thẳng
--   `products.vat_rate` lúc tính tiền. Hệ quả cần biết: đổi thuế suất
--   sản phẩm rồi xuất tiếp đợt hai của cùng một đơn thì hai hoá đơn mang
--   thuế suất KHÁC NHAU. Đúng về kế toán (thuế theo ngày xuất), nhưng dễ
--   bị tưởng là lỗi nếu không biết trước.
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  order_line_id     uuid REFERENCES sales_order_lines(id),
  product_id        uuid NOT NULL REFERENCES products(id),
  unit_name         text NOT NULL,
  conversion_factor numeric(18, 6) NOT NULL DEFAULT 1,
  quantity          numeric NOT NULL,
  unit_price        numeric NOT NULL DEFAULT 0,
  line_discount     numeric NOT NULL DEFAULT 0,
  line_total        numeric NOT NULL DEFAULT 0,
  vat_rate          numeric NOT NULL DEFAULT 0,
  is_exchange       boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  note              text
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_orderline ON sales_invoice_lines(order_line_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_product ON sales_invoice_lines(product_id);


-- =====================================================================
-- 3. sales_order_lines.invoiced_qty — đã xuất bao nhiêu
-- =====================================================================
--
-- ⚠ CÙNG ĐƠN VỊ VỚI `quantity` CỦA DÒNG ĐƠN, không quy về đơn vị cơ sở.
--   Quy đổi hai chiều là chỗ sinh lệch: dòng đặt "2 thùng" mà đã xuất
--   ghi "20 hộp" thì phép so "đã xuất đủ chưa" phải nhân chia mỗi lần
--   đọc, và chỉ cần một chỗ quên là đơn hiện Hoàn thành khi mới giao nửa.
--
-- ⚠ TÍNH LẠI TỪ ĐẦU, KHÔNG CỘNG DỒN. Trigger `+= NEW.quantity` sẽ sai
--   ngay lần đầu có ai UPDATE hoặc DELETE một dòng hoá đơn, và sai theo
--   kiểu không bao giờ tự sửa được.
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS invoiced_qty numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_order_lines.invoiced_qty IS
  'Tổng số lượng ĐÃ XUẤT của dòng này, cùng đơn vị với quantity. Do '
  'trigger trg_sync_invoiced_qty tính lại từ sales_invoice_lines của các '
  'hoá đơn posted — không cộng dồn.';

CREATE OR REPLACE FUNCTION public.sync_invoiced_qty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line uuid;
BEGIN
  -- Dòng ngoài đơn (`order_line_id` NULL) không ảnh hưởng ai.
  FOR v_line IN
    SELECT x FROM (VALUES (OLD.order_line_id), (NEW.order_line_id)) AS t(x)
    WHERE x IS NOT NULL
  LOOP
    UPDATE sales_order_lines sol
    SET invoiced_qty = COALESCE((
      SELECT sum(sil.quantity)
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON si.id = sil.invoice_id
      WHERE sil.order_line_id = v_line AND si.status = 'posted'
    ), 0)
    WHERE sol.id = v_line;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoiced_qty ON sales_invoice_lines;
CREATE TRIGGER trg_sync_invoiced_qty
  AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoiced_qty();

-- ⚠ HUỶ HOÁ ĐƠN KHÔNG XOÁ DÒNG NÀO — nó chỉ đổi `sales_invoices.status`.
--   Trigger trên gắn vào `sales_invoice_lines` nên sẽ KHÔNG chạy, và
--   `invoiced_qty` đứng yên ở số cũ: đơn mãi mãi hiện "đã xuất đủ" dù
--   hoá đơn đã huỷ. Cần trigger thứ hai gắn vào chính bảng hoá đơn.
CREATE OR REPLACE FUNCTION public.sync_invoiced_qty_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  UPDATE sales_order_lines sol
  SET invoiced_qty = COALESCE((
    SELECT sum(sil.quantity)
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE sil.order_line_id = sol.id AND si.status = 'posted'
  ), 0)
  WHERE sol.id IN (
    SELECT order_line_id FROM sales_invoice_lines
    WHERE invoice_id = NEW.id AND order_line_id IS NOT NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoiced_qty_status ON sales_invoices;
CREATE TRIGGER trg_sync_invoiced_qty_status
  AFTER UPDATE OF status ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoiced_qty_on_status();


-- =====================================================================
-- 4. sales_orders — hai trạng thái mới
-- =====================================================================
--
-- `partially_invoiced` Xuất một phần · `closed` Đóng (NPP chốt không
-- giao phần còn lại).
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS chk_sales_orders_status_v2;
ALTER TABLE sales_orders
  ADD CONSTRAINT chk_sales_orders_status_v2
  CHECK (status IN (
    'draft', 'submitted', 'partially_invoiced', 'completed', 'closed', 'cancelled'
  ));

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id);

COMMENT ON COLUMN sales_orders.closed_at IS
  'Mốc NPP chốt không giao phần còn lại. Khác completed_at: completed = '
  'đã xuất ĐỦ, closed = thôi không xuất nữa.';

-- ⚠ GIỮ CỘT `completed_by` VÀ `organizations.completed_edit_days`.
--   `completed_by` nay mang nghĩa "người ghi sổ hoá đơn cuối cùng".
--   `completed_edit_days` KHÔNG còn ai đọc (cơ chế sửa-sau-hoàn-thành đã
--   bỏ) nhưng giữ cột để không mất cấu hình tổ chức đã đặt.
COMMENT ON COLUMN organizations.completed_edit_days IS
  'NGƯNG DÙNG từ workflow v2b — cơ chế sửa đơn đã hoàn thành đã bỏ, thay '
  'bằng huỷ/lập lại hoá đơn. Giữ cột để không mất cấu hình cũ.';


-- =====================================================================
-- 5. Khoá ngoại sang hóa đơn
-- =====================================================================
--
-- ⚠ GIỮ NGUYÊN `order_id` Ở CẢ BỐN BẢNG, và RPC luôn ghi CẢ HAI. Dữ liệu
--   cũ chỉ có `order_id`; bỏ nó đi là mọi báo cáo lịch sử đứt. Đọc thì
--   ưu tiên `invoice_id`, rơi về `order_id` khi null.
ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE cash_receipt_lines
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS sales_invoice_id uuid REFERENCES sales_invoices(id);

CREATE INDEX IF NOT EXISTS idx_receivables_invoice        ON receivables(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cash_receipt_lines_invoice ON cash_receipt_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_invoice            ON returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_invoice     ON invoices(sales_invoice_id);

-- ⚠ MỘT HOÁ ĐƠN CHỈ CÓ MỘT DÒNG CÔNG NỢ. Hai dòng cho cùng một hoá đơn
--   là khách bị đòi hai lần, và không phép cộng nào phát hiện ra.
--   Partial index vì công nợ đầu kỳ không gắn hoá đơn nào.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_invoice_unique
  ON receivables(invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN invoices.sales_invoice_id IS
  'Hóa đơn bán (sales_invoices) mà hoá đơn điện tử này phát hành cho. '
  'Bảng `invoices` là HĐĐT MISA — tên cũ, giữ nguyên.';


-- =====================================================================
-- 6. Trigger chuyển trạng thái đơn — viết lại cho sáu trạng thái
-- =====================================================================
--
-- ⚠ BỐN TRẠNG THÁI DO HOÁ ĐƠN ĐIỀU KHIỂN, KHÔNG PHẢI NGƯỜI DÙNG.
--   `partially_invoiced`, `completed`, `closed` chỉ vào/ra được khi có
--   cờ `npp.via_rpc` — tức là chỉ qua RPC của migration 125. Để client
--   tự đặt là mở đường cho một đơn hiện Hoàn thành mà chưa hoá đơn nào
--   trừ kho.
--
-- ⚠ ĐI LÙI LÀ HỢP LỆ, và chỉ có một đường: huỷ hoá đơn. `completed` hay
--   `closed` quay về `partially_invoiced` (còn hoá đơn khác) hoặc
--   `submitted` (hết hoá đơn). Không có đường nào khác — đó là thứ giữ
--   cho trạng thái đơn luôn kể đúng câu chuyện của các hoá đơn con.
CREATE OR REPLACE FUNCTION public.check_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_ok := CASE OLD.status
    WHEN 'draft'     THEN NEW.status IN ('submitted', 'cancelled')
    WHEN 'submitted' THEN NEW.status IN ('partially_invoiced', 'completed', 'cancelled', 'draft')
    WHEN 'partially_invoiced'
                     THEN NEW.status IN ('completed', 'closed', 'submitted')
    WHEN 'completed' THEN NEW.status IN ('partially_invoiced', 'submitted')
    WHEN 'closed'    THEN NEW.status IN ('partially_invoiced', 'submitted')
    ELSE false   -- 'cancelled' là điểm cuối
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Không thể chuyển đơn từ % sang %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.status IN ('partially_invoiced', 'completed', 'closed')
      OR NEW.status IN ('partially_invoiced', 'completed', 'closed'))
     AND COALESCE(current_setting('npp.via_rpc', true), '') <> 'on' THEN
    RAISE EXCEPTION 'USE_RPC: dùng nút Xuất hàng / Huỷ hóa đơn / Đóng đơn'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := now();
  END IF;
  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_order_status ON sales_orders;
CREATE TRIGGER trg_check_order_status
  BEFORE UPDATE OF status ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_order_status_transition();


-- =====================================================================
-- 7. Phân quyền hàng
-- =====================================================================
--
-- ⚠ HAI BẢNG HOÁ ĐƠN KHÔNG CÓ POLICY GHI NÀO CHO CLIENT. Mọi thay đổi
--   đi qua RPC `SECURITY DEFINER` của mig 125. Mở một policy INSERT ở
--   đây là mở luôn đường lập hoá đơn mà không trừ kho.
ALTER TABLE sales_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_invoices_select ON sales_invoices;
CREATE POLICY sales_invoices_select ON sales_invoices
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    AND (
      public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse')
      -- NVBH chỉ thấy hoá đơn của đơn mình phụ trách.
      OR sales_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM sales_orders so
        WHERE so.id = sales_invoices.order_id AND so.sales_user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS sales_invoice_lines_select ON sales_invoice_lines;
CREATE POLICY sales_invoice_lines_select ON sales_invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM sales_invoices si
    WHERE si.id = sales_invoice_lines.invoice_id
      AND si.org_id = public.user_org_id()
  ));

-- ⚠ DÒNG ĐƠN KHOÁ LẠI KHI ĐƠN ĐÃ CÓ HOÁ ĐƠN. Sửa dòng của một đơn đã
--   xuất là làm lệch `invoiced_qty` so với thứ đã thật sự rời kho — và
--   lệch im lặng, vì không lệnh nào báo. Muốn đổi thì huỷ hoá đơn trước.
CREATE OR REPLACE FUNCTION public.guard_order_lines_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text; v_order uuid;
BEGIN
  IF COALESCE(current_setting('npp.via_rpc', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_order := COALESCE(NEW.order_id, OLD.order_id);
  SELECT status INTO v_status FROM sales_orders WHERE id = v_order;
  IF v_status IN ('partially_invoiced', 'completed', 'closed') THEN
    RAISE EXCEPTION
      'ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được. Huỷ hóa đơn trước, hoặc lập đơn trả.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ⚠ TRIGGER DỰNG Ở CUỐI FILE, KHÔNG PHẢI Ở ĐÂY. Backfill ở mục 11 chèn
--   dòng hóa đơn, việc đó làm `trg_sync_invoiced_qty` chạy `UPDATE
--   sales_order_lines` — và chốt này chặn đúng lệnh ấy, vì lúc đó đơn đã
--   mang trạng thái 'completed'. Migration tự vấp chốt chặn của chính
--   mình:
--
--     ERROR: ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được.
--
--   Dựng chốt sau khi dữ liệu đã vào chỗ. Xem mục 13.


-- =====================================================================
-- 8. Trần số lượng trả — đổi mốc so từ ĐƠN sang HOÁ ĐƠN
-- =====================================================================
--
-- ⚠ TRẢ THEO THỨ ĐÃ XUẤT, KHÔNG THEO THỨ ĐÃ ĐẶT. Đơn đặt 100 mà mới
--   xuất 40 thì trần trả là 40. So với dòng đơn như bản v2 là cho phép
--   khách trả 100 — nhập kho 60 món chưa từng rời kho.
--
-- ⚠ Phiếu trả không gắn hoá đơn (trả độc lập, hoặc gắn đơn kiểu cũ) thì
--   BỎ QUA như trước: không có mốc để so.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice  uuid;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.invoice_id INTO v_invoice FROM returns r WHERE r.id = NEW.return_id;
  IF v_invoice IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠ `return_lines` không có cột hệ số; phải tra `product_units`, và
  --   cột ở bảng đó tên `conversion`, KHÔNG phải `conversion_factor`.
  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
    INTO v_sold
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id
  WHERE si.id = v_invoice
    AND si.status = 'posted'
    AND sil.is_exchange = false
    AND sil.product_id = NEW.product_id;

  SELECT COALESCE(sum(rl.quantity * COALESCE((
            SELECT pu.conversion FROM product_units pu
             WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
    INTO v_returned
  FROM return_lines rl
  JOIN returns r2 ON r2.id = rl.return_id
  WHERE r2.invoice_id = v_invoice
    AND r2.status = 'completed'
    AND rl.is_exchange = false
    AND rl.product_id = NEW.product_id
    AND rl.id <> NEW.id;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — hóa đơn xuất %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- =====================================================================
-- 9. Doanh thu bám hóa đơn
-- =====================================================================
--
-- ⚠ `is_revenue_status` GIỮ NGUYÊN, không xoá: nhiều hàm lương/báo cáo
--   còn gọi nó, và P3 mới chuyển từng cái sang bản hoá đơn. Xoá ở đây là
--   hàng loạt hàm vỡ giữa hai migration.
CREATE OR REPLACE FUNCTION public.is_revenue_invoice_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT p_status = 'posted' $$;

COMMENT ON FUNCTION public.is_revenue_invoice_status(text) IS
  'Doanh thu v2b đếm hóa đơn bán đã ghi sổ. Đơn đặt hàng KHÔNG còn là '
  'nguồn doanh thu — xem is_revenue_status (ngưng dùng dần ở P3).';


-- =====================================================================
-- 10. Nhật ký và thông báo
-- =====================================================================
--
-- ⚠ GIỮ `edit_after_complete` / `cancel_after_complete` TRONG CHECK dù
--   không ai ghi nữa: dữ liệu cũ đã có hai giá trị đó, siết ràng buộc là
--   ALTER TABLE hỏng ngay trên dữ liệu đang có.
ALTER TABLE order_activity_log DROP CONSTRAINT IF EXISTS chk_order_activity_log_action;
ALTER TABLE order_activity_log
  ADD CONSTRAINT chk_order_activity_log_action
  CHECK (action IN (
    'add_line', 'edit_line', 'remove_line',
    'edit_after_complete', 'cancel_after_complete',   -- lịch sử, không ai ghi nữa
    'invoice_posted', 'invoice_cancelled', 'order_closed'
  ));

-- ⚠ GIỮ `order_edited` TRONG CHECK vì lý do y hệt: thông báo cũ đã gửi
--   rồi, siết ràng buộc là hỏng trên dữ liệu đang có. Chỉ không ai gửi
--   loại đó nữa.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order_pending_approval',
    'order_approved',
    'order_cancelled',
    'order_completed',
    'order_edited',           -- lịch sử, không ai gửi nữa
    'invoice_cancelled',
    'return_completed',
    'payment_received',
    'receivable_overdue',
    'visit_logged',
    'customer_photo_missing',
    'info'
  ));


-- =====================================================================
-- 11. Backfill — mỗi đơn đã hoàn thành thành một hóa đơn
-- =====================================================================
--
-- ⚠ KHÔNG ĐOÁN. Đơn `completed` mà KHÔNG có phiếu xuất nào đã ghi sổ thì
--   vẫn tạo hoá đơn (để công nợ và hoá đơn điện tử có chỗ bám) nhưng
--   `stock_entry_id` để TRỐNG và liệt kê ra `RAISE NOTICE`. Đó là những
--   đơn có từ trước mig 107 — tồn kho chưa bao giờ bị trừ cho chúng, và
--   gán bừa một phiếu xuất vào là dựng một chứng từ không có thật.
DO $$
DECLARE
  o          record;
  v_inv      uuid;
  v_entry    uuid;
  v_n_entry  int;
  v_code     text;
  v_seq      int := 0;
  v_inv_cnt  int := 0;
  v_no_entry int := 0;
  v_rec      int := 0;
  v_crl      int := 0;
  v_ret      int := 0;
  v_eiv      int := 0;
BEGIN
  FOR o IN
    SELECT so.*, row_number() OVER (PARTITION BY so.org_id ORDER BY so.order_date, so.id) AS rn
    FROM sales_orders so
    WHERE so.status = 'completed'
       OR (so.status = 'cancelled' AND so.completed_at IS NOT NULL)
    ORDER BY so.org_id, so.order_date, so.id
  LOOP
    -- ⚠ HAI CÂU, KHÔNG GỘP BẰNG `min(se.id)`. Postgres KHÔNG có `min`
    --   cho kiểu uuid — gộp là lỗi 42883 ngay câu lệnh đầu tiên của vòng
    --   lặp, và cả migration rollback. Kể cả nếu có thì nó cũng sai
    --   nghĩa: thứ tự uuid không phải thứ tự thời gian, nên "phiếu đầu
    --   tiên" hoá ra là phiếu có uuid nhỏ nhất — một phiếu bất kỳ.
    --
    -- ⚠ "ĐẦU TIÊN" = SỚM NHẤT THEO `posted_at`. Đơn được sửa ở v2 có thể
    --   có vài phiếu xuất; phiếu gắn vào hóa đơn phải là phiếu mở đầu,
    --   không phải phiếu vá về sau. `se.id` chỉ để phá thế hoà khi hai
    --   phiếu cùng một mốc.
    SELECT count(*) INTO v_n_entry
    FROM stock_entries se
    WHERE se.type = 'export' AND se.status = 'posted'
      AND se.ref_order_ids @> jsonb_build_array(o.id::text);

    SELECT se.id INTO v_entry
    FROM stock_entries se
    WHERE se.type = 'export' AND se.status = 'posted'
      AND se.ref_order_ids @> jsonb_build_array(o.id::text)
    ORDER BY se.posted_at NULLS LAST, se.id
    LIMIT 1;

    v_seq := v_seq + 1;
    v_code := 'HD-' || to_char(COALESCE(o.order_date, CURRENT_DATE), 'YYMMDD')
              || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO sales_invoices (
      org_id, invoice_code, order_id, customer_id, sales_user_id,
      invoice_date, status, subtotal, vat, total, payment_terms, due_date,
      stock_entry_id, notes, posted_at, posted_by, cancelled_at, cancel_reason
    ) VALUES (
      o.org_id, v_code, o.id, o.customer_id, o.sales_user_id,
      COALESCE(o.order_date, CURRENT_DATE),
      CASE WHEN o.status = 'cancelled' THEN 'cancelled' ELSE 'posted' END,
      COALESCE(o.subtotal, 0), COALESCE(o.vat, 0), COALESCE(o.total, 0),
      o.payment_terms, NULL,
      v_entry,
      CASE
        WHEN v_n_entry = 0 THEN 'Backfill v2b: đơn không có phiếu xuất đã ghi sổ — tồn kho chưa từng bị trừ.'
        WHEN v_n_entry > 1 THEN 'Backfill v2b: đơn có ' || v_n_entry || ' phiếu xuất (do sửa ở v2); stock_entry_id lấy phiếu đầu.'
        ELSE 'Backfill v2b từ workflow v2.'
      END,
      COALESCE(o.completed_at, now()), o.completed_by,
      CASE WHEN o.status = 'cancelled' THEN o.cancelled_at ELSE NULL END,
      CASE WHEN o.status = 'cancelled' THEN 'Backfill v2b: đơn đã huỷ sau khi xuất' ELSE NULL END
    )
    RETURNING id INTO v_inv;
    v_inv_cnt := v_inv_cnt + 1;

    IF v_n_entry = 0 THEN
      v_no_entry := v_no_entry + 1;
      RAISE NOTICE '124 ⚠ đơn % (%) KHÔNG có phiếu xuất đã ghi sổ — hóa đơn % tạo ra không có stock_entry_id', o.order_code, o.order_date, v_code;
    END IF;

    INSERT INTO sales_invoice_lines (
      invoice_id, order_line_id, product_id, unit_name, conversion_factor,
      quantity, unit_price, line_discount, line_total, vat_rate, sort_order, note
    )
    SELECT v_inv, sol.id, sol.product_id, sol.unit_name,
           COALESCE(sol.conversion_factor, 1),
           sol.quantity, sol.unit_price, COALESCE(sol.line_discount, 0),
           sol.line_total, COALESCE(p.vat_rate, 0),
           row_number() OVER (ORDER BY sol.id), sol.note
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.order_id = o.id;

    -- Gắn các chứng từ con của đơn sang hóa đơn vừa tạo.
    UPDATE receivables SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_rec := v_rec + v_n_entry;

    UPDATE cash_receipt_lines SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_crl := v_crl + v_n_entry;

    UPDATE returns SET invoice_id = v_inv
    WHERE order_id = o.id AND invoice_id IS NULL AND status <> 'draft';
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_ret := v_ret + v_n_entry;

    UPDATE invoices SET sales_invoice_id = v_inv
    WHERE order_id = o.id AND sales_invoice_id IS NULL;
    GET DIAGNOSTICS v_n_entry = ROW_COUNT; v_eiv := v_eiv + v_n_entry;
  END LOOP;

  RAISE NOTICE '--- 124 backfill: % hóa đơn bán được tạo (% không có phiếu xuất) ---', v_inv_cnt, v_no_entry;
  RAISE NOTICE '--- 124 backfill: gắn % công nợ · % dòng phiếu thu · % phiếu trả · % hoá đơn điện tử ---', v_rec, v_crl, v_ret, v_eiv;
END $$;

-- `invoiced_qty` của đơn đã backfill: trigger mục 3 đã chạy theo từng
-- dòng chèn ở trên, nhưng tính lại một lượt cho chắc — dòng đơn không có
-- hoá đơn nào phải về 0, không để rác từ lần chạy trước.
UPDATE sales_order_lines sol
SET invoiced_qty = COALESCE((
  SELECT sum(sil.quantity)
  FROM sales_invoice_lines sil
  JOIN sales_invoices si ON si.id = sil.invoice_id
  WHERE sil.order_line_id = sol.id AND si.status = 'posted'
), 0);


-- =====================================================================
-- 12. Gỡ cơ chế "sửa đơn đã hoàn thành"
-- =====================================================================
--
-- ⚠ `_wf2_assert_order_unlocked` PACK KHÔNG NHẮC, NHƯNG PHẢI ĐI CÙNG.
--   Nó chỉ phục vụ bốn khoá của `edit_completed_order`, và là chỗ DUY
--   NHẤT còn đọc `organizations.completed_edit_days`. Để lại là mã chết
--   đọc một cột đã ngưng dùng — lần sau có người đọc nó rồi tưởng cơ chế
--   còn sống.
--
-- ⚠ `_wf2_recompute_receivable(uuid)` bị thay bằng bản theo hóa đơn ở
--   mig 125. `complete_return` / `cancel_return` còn gọi tên cũ — PL/pgSQL
--   chỉ tra tên lúc CHẠY nên DDL này không vỡ, nhưng hai RPC đó sẽ lỗi
--   cho tới khi 125 chạy xong. Đó là lý do hai file phải đi cùng nhau.
DROP FUNCTION IF EXISTS public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.complete_order(uuid);
DROP FUNCTION IF EXISTS public.cancel_order(uuid, text);
DROP FUNCTION IF EXISTS public._wf2_assert_order_unlocked(uuid, date, boolean);
DROP FUNCTION IF EXISTS public._wf2_recompute_receivable(uuid);

-- =====================================================================
-- 13. Khoá dòng đơn — DỰNG SAU CÙNG
-- =====================================================================
--
-- ⚠ ĐÂY LÀ NHỊP CUỐI, VÀ THỨ TỰ LÀ CẢ VẤN ĐỀ. Hàm đã định nghĩa ở mục 7;
--   chỉ còn gắn trigger. Gắn sớm hơn thì backfill ở mục 11 không chạy
--   nổi: nó chèn dòng hóa đơn → `trg_sync_invoiced_qty` chạy `UPDATE
--   sales_order_lines` → chốt này chặn, vì đơn lúc đó đã 'completed'.
--
--   Cùng một bài học với mục 4 của migration 119: chốt chặn dựng SAU khi
--   ghi xong dữ liệu, không phải trước.
DROP TRIGGER IF EXISTS trg_guard_order_lines_locked ON sales_order_lines;
CREATE TRIGGER trg_guard_order_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_lines_locked();


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_so int; v_inv int; v_part int;
BEGIN
  SELECT count(*) INTO v_so  FROM sales_orders WHERE status = 'completed';
  SELECT count(*) INTO v_inv FROM sales_invoices WHERE status = 'posted';
  SELECT count(*) INTO v_part FROM sales_orders WHERE status = 'partially_invoiced';
  RAISE NOTICE '--- 124: % đơn Hoàn thành · % hóa đơn đã xuất · % đơn xuất một phần ---', v_so, v_inv, v_part;
  IF v_so <> v_inv THEN
    RAISE NOTICE '--- 124 ⚠ hai con số trên LỆCH NHAU. Đúng ra mỗi đơn hoàn thành có đúng một hóa đơn; kiểm lại trước khi chạy 125. ---';
  END IF;
END $$;
