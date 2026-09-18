-- ====================================================================
-- 130 — Số đơn hàng bỏ ngày tháng: DH-0001, sửa lần n thì thêm -n
-- ====================================================================
--
-- VÌ SAO
--   Mã cũ `SO-YYYYMMDD-RAND` do TRÌNH DUYỆT sinh ra, với bốn chữ số
--   NGẪU NHIÊN (`generateOrderCode` trong src/lib/utils.ts). Hai chuyện
--   hỏng:
--     · Số không nói được "đây là đơn thứ mấy". Chủ NPP chốt: `DH-xxxx`
--       chạy liên tục, và sửa lần n thì thêm `-n` vào chính số đó.
--     · `order_code` là UNIQUE TOÀN BẢNG. Bốn chữ số ngẫu nhiên trong
--       một ngày là xác suất đụng nhau có thật — và lúc đụng thì người
--       bán hàng nhận một lỗi unique giữa lúc đang đứng ở cửa hàng.
--
--   Cấp số chuyển hẳn xuống cơ sở dữ liệu: một chỗ cấp, có khoá, có
--   chỉ mục duy nhất đỡ phía sau.
--
-- ⚠ MÃ ĐỔI TẠI CHỖ MỖI LẦN SỬA — chủ nhà chọn, và đây là chỗ nó KHÁC
--   hóa đơn. Hóa đơn lập lại sinh MỘT DÒNG MỚI nên tra sổ vẫn thấy cả
--   hai tờ; đơn thì sửa đè lên chính nó, nên `DH-0042` biến mất khỏi mọi
--   chứng từ đã in trước đó và chỉ còn `DH-0042-1`. Chủ nhà đã được báo
--   và vẫn chọn phương án này.
--
-- ⚠ ĐÁNH SỐ LẠI TOÀN BỘ ĐƠN CŨ, thứ tự theo NGÀY ĐẶT. Xếp theo
--   `created_at` thì đơn nhập bù ngày cũ chen vào giữa sổ.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Hai cột đếm
-- --------------------------------------------------------------------
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_seq int,
  ADD COLUMN IF NOT EXISTS edit_no   int NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_orders.order_seq IS
  'Số chạy của đơn trong phạm vi tổ chức. Không đổi khi sửa đơn.';
COMMENT ON COLUMN sales_orders.edit_no IS
  '0 = bản đầu. n = đã sửa n lần, mã có đuôi -n.';


-- --------------------------------------------------------------------
-- 2. Hàm dựng mã
-- --------------------------------------------------------------------
-- ⚠ MỘT CHỖ DỰNG MÃ, y như `_inv_code` của mig 128.
CREATE OR REPLACE FUNCTION public._order_code(p_seq int, p_edit int)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'DH-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')
         || CASE WHEN COALESCE(p_edit, 0) > 0
                 THEN '-' || p_edit::text ELSE '' END;
$$;


-- --------------------------------------------------------------------
-- 3. Đánh số lại toàn bộ đơn cũ
-- --------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  -- ⚠ ÉP KIỂU `::int`. `row_number()` trả BIGINT, và Postgres KHÔNG tự
  --   ép bigint sang int khi chọn hàm — `_order_code(bigint, integer)
  --   does not exist`. Migration chết ngay câu đầu tiên.
  WITH g AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY org_id
             ORDER BY order_date, created_at, id
           )::int AS n
    FROM sales_orders
  )
  UPDATE sales_orders so
  SET order_seq = g.n, edit_no = 0, order_code = public._order_code(g.n, 0)
  FROM g WHERE g.id = so.id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '--- 130: % đơn được đánh số lại ---', v_n;

  SELECT count(*) INTO v_n FROM sales_orders WHERE order_seq IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ORDER_CODE_ORPHAN: còn % đơn chưa có số chạy', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE sales_orders ALTER COLUMN order_seq SET NOT NULL;

-- ⚠ CHẶN TRÙNG Ở TẦNG CƠ SỞ DỮ LIỆU. `order_code` vốn đã UNIQUE; thêm
--   chỉ mục trên (tổ chức, số chạy) để hai đơn không bao giờ mang cùng
--   một số ngay cả khi ai đó ghi tay `order_code`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_seq
  ON sales_orders(org_id, order_seq);


-- --------------------------------------------------------------------
-- 4. Cấp số cho đơn mới
-- --------------------------------------------------------------------
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM, và `max + 1` chứ không `count + 1`: đếm thì một
--   đơn bị xoá là số tiếp theo trùng với một đơn đang sống.
CREATE OR REPLACE FUNCTION public._next_order_seq(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('order_seq:' || p_org::text));
  SELECT COALESCE(max(order_seq), 0) + 1 INTO v_n
  FROM sales_orders WHERE org_id = p_org;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._next_order_seq(uuid) FROM PUBLIC;


-- --------------------------------------------------------------------
-- 5. Đơn mới: cơ sở dữ liệu cấp số, KHÔNG phải trình duyệt
-- --------------------------------------------------------------------
-- ⚠ GHI ĐÈ MÃ TRÌNH DUYỆT GỬI LÊN. Màn bán hàng vẫn gửi một
--   `order_code` (nó cần một mã để xếp hàng ngoại tuyến), nhưng mã ấy
--   không còn là mã thật. Trình duyệt phải ĐỌC LẠI mã sau khi ghi —
--   `createOrderFromPayload` đã sửa để `.select("id, order_code")`.
--
-- ⚠ ĐỌC `org_id` TỪ CHÍNH DÒNG ĐANG CHÈN. Gọi `user_org_id()` ở đây là
--   sai với mọi đường ghi không đi qua phiên người dùng (nhập liệu, đồng
--   bộ, migration) — và sai lặng lẽ, vì nó trả NULL chứ không ném lỗi.
CREATE OR REPLACE FUNCTION public.trg_sales_orders_assign_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.order_seq  := public._next_order_seq(NEW.org_id);
  NEW.edit_no    := 0;
  NEW.order_code := public._order_code(NEW.order_seq, 0);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_assign_code() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_assign_code ON sales_orders;
CREATE TRIGGER trg_sales_orders_assign_code
  BEFORE INSERT ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_assign_code();


-- --------------------------------------------------------------------
-- 6. Sửa đơn: tăng đuôi
-- --------------------------------------------------------------------
-- ⚠ BÁM VÀO LẦN GHI ĐẦU ĐƠN, KHÔNG BÁM VÀO TỪNG DÒNG HÀNG. Một lần sửa
--   thường xoá hết dòng cũ rồi chèn dòng mới — bám vào `sales_order_lines`
--   thì một lần sửa đếm thành nhiều lần, và `DH-0042` nhảy thẳng lên
--   `DH-0042-7`. Màn sửa đơn ghi đầu đơn đúng MỘT lệnh (order-edit.ts),
--   nên đó mới là chỗ đếm.
--
-- ⚠ CHỈ ĐẾM KHI NỘI DUNG THẬT SỰ ĐỔI. Duyệt đơn, huỷ đơn, xuất hàng đều
--   ghi vào `sales_orders` nhưng chỉ đụng `status` / `approval_reason` —
--   kể chúng là mỗi lần bấm Xuất hàng lại đổi số đơn, và tài xế cầm
--   phiếu in ra không tra được đơn nào cả.
--
-- ⚠ `IS DISTINCT FROM`, KHÔNG PHẢI `<>`. Một cột từ NULL thành có giá
--   trị là một thay đổi thật, mà `NULL <> 'x'` ra NULL nên không khớp.
CREATE OR REPLACE FUNCTION public.trg_sales_orders_bump_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id        IS DISTINCT FROM OLD.customer_id
     OR NEW.payment_terms   IS DISTINCT FROM OLD.payment_terms
     OR NEW.expected_delivery IS DISTINCT FROM OLD.expected_delivery
     OR NEW.subtotal        IS DISTINCT FROM OLD.subtotal
     OR NEW.vat             IS DISTINCT FROM OLD.vat
     OR NEW.total           IS DISTINCT FROM OLD.total
     OR NEW.discount        IS DISTINCT FROM OLD.discount
     OR NEW.notes           IS DISTINCT FROM OLD.notes
  THEN
    NEW.edit_no    := COALESCE(OLD.edit_no, 0) + 1;
    NEW.order_code := public._order_code(OLD.order_seq, NEW.edit_no);
  ELSE
    -- ⚠ GIỮ NGUYÊN, đừng để ai ghi đè mã bằng tay qua PostgREST.
    NEW.edit_no    := OLD.edit_no;
    NEW.order_code := OLD.order_code;
  END IF;
  NEW.order_seq := OLD.order_seq;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sales_orders_bump_edit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sales_orders_bump_edit ON sales_orders;
CREATE TRIGGER trg_sales_orders_bump_edit
  BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_bump_edit();


NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_bad int;
  v_max int;
BEGIN
  SELECT count(*) INTO v_bad FROM sales_orders
  WHERE order_code !~ '^DH-[0-9]{4,}(-[0-9]+)?$';
  SELECT COALESCE(max(order_seq), 0) INTO v_max FROM sales_orders;
  RAISE NOTICE '--- 130: % mã chưa đúng mẫu · số chạy đang ở % ---', v_bad, v_max;
END $$;
