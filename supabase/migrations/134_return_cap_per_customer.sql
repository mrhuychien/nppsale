-- =====================================================================
-- 134 — PHIẾU TRẢ KÈM ĐƠN: TRẦN TÍNH THEO KHÁCH, KHÔNG THEO MỘT HÓA ĐƠN
-- =====================================================================
--
-- VÌ SAO
--   Chủ nhà báo: phiếu trả không hoàn thành được.
--
--       RETURN_QTY_EXCEEDS: "Xúc xích xiên que koko …" — đã xuất 0,
--       đã hoàn thành trả 0, phiếu này thêm 3 là vượt
--
--   "Đã xuất 0" là đúng: món xúc xích ấy KHÔNG nằm trên đơn vừa giao.
--   Đơn đó bán kẹo dẻo. Món xúc xích là hàng hỏng của LẦN GIAO TRƯỚC, và
--   NVBH thu hồi nó khi mang đơn mới tới.
--
-- ⚠ ĐÂY LÀ MỘT GIẢ ĐỊNH SAI TRONG CODE, KHÔNG PHẢI LỖI NHẬP LIỆU.
--   `complete_return` (mig 127, dòng 194) tính trần theo ĐÚNG MỘT hóa
--   đơn:
--
--       FROM sales_invoice_lines sil WHERE sil.invoice_id = r.invoice_id
--
--   Giả định ngầm: khách chỉ trả được thứ vừa mua trên chính chuyến này.
--   Với phiếu trả LẬP TỪ MỘT HÓA ĐƠN ("giao rồi khách không nhận hết")
--   thì đúng. Với phiếu trả SINH RA TỪ ĐƠN thì sai hẳn — hàng trả trong
--   thực tế gần như luôn là hàng của lần giao trước.
--
-- CÁCH SỬA
--   Phiếu có dấu `credit_with_invoice` (mig 133 — phiếu sinh ra từ đơn)
--   tính trần theo KHÁCH:
--
--       đã giao cho khách này (mọi hóa đơn đã ghi sổ)
--         − đã hoàn thành trả của khách này
--         ≥ số đang trả
--
--   Vẫn là một cái trần thật: nó chặn việc nhập vào kho món khách chưa
--   từng mua, và chặn trả đi trả lại cùng một lô. Chỉ bỏ đúng cái giả
--   định "phải cùng một tờ hóa đơn".
--
-- ⚠ PHIẾU LẬP TỪ HÓA ĐƠN GIỮ NGUYÊN TRẦN CŨ. Người lập nó đã nói rõ "trả
--   theo hóa đơn này"; nới ra là bỏ mất phép kiểm ở đúng chỗ nó có nghĩa.
--
-- ⚠ ĐẾM HAI VẾ CÙNG MỘT KIỂU (`is_exchange = false`), y như nhánh cũ.
--   Lệch kiểu đếm giữa vế "đã giao" và vế "đã trả" là cái trần tự nó
--   trôi. Hệ quả đã biết: món khách nhận dưới dạng hàng ĐỔI rồi sau đó
--   trả lại vẫn bị chặn — hiếm, và khi gặp thì thông báo nêu đúng tên
--   hàng nên nhận ra ngay.
--
-- ⚠ CẦN MIG 133 CHẠY TRƯỚC (cột `credit_with_invoice`). Chưa có thì DỪNG.

DO $patch$
DECLARE
  v_oid    oid;
  v_src    text;
  v_new    text;
  v_anchor text :=
    '      IF r.invoice_id IS NOT NULL THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)';
  v_head_old text :=
    'SELECT id, org_id, order_id, invoice_id, status, requested_by INTO r';
  v_head_new text :=
    'SELECT id, org_id, order_id, invoice_id, status, requested_by, customer_id, credit_with_invoice INTO r';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_return';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'COMPLETE_RETURN_MISSING: chưa có complete_return — chạy migration 127 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'returns'
      AND column_name = 'credit_with_invoice'
  ) THEN
    RAISE EXCEPTION
      'NEEDS_133: chưa có cột returns.credit_with_invoice. Chạy migration 133 trước rồi chạy lại 134.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('r.credit_with_invoice THEN' in v_src) > 0 THEN
    RAISE NOTICE '134: complete_return đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  -- ⚠ HAI NEO, KIỂM TỪNG CÁI VÀ NÓI RÕ CÁI NÀO HỎNG. Báo chung "không
  --   khớp hình dạng" thì người chạy migration phải tự đi dò cả thân hàm.
  IF position(v_head_old in v_src) = 0 THEN
    RAISE EXCEPTION
      'COMPLETE_RETURN_SHAPE: không tìm thấy câu đọc phiếu trả vào biến r. Thân hàm hiện tại:%',
      E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;
  IF position(v_anchor in v_src) = 0 THEN
    RAISE EXCEPTION
      'COMPLETE_RETURN_SHAPE: không tìm thấy nhánh tính trần theo hóa đơn. Thân hàm hiện tại:%',
      E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  -- 1. Đọc thêm `customer_id` và dấu `credit_with_invoice`.
  v_src := replace(v_src, v_head_old, v_head_new);

  -- 2. Thêm nhánh trần-theo-khách TRƯỚC nhánh trần-theo-hóa-đơn.
  v_new :=
    '      -- ⚠ PHIẾU SINH RA TỪ ĐƠN: TRẦN THEO KHÁCH (mig 134).' || E'\n'
    || '      --   Hàng trả kèm đơn gần như luôn là hàng của LẦN GIAO TRƯỚC;' || E'\n'
    || '      --   so với dòng của chính tờ hóa đơn vừa xuất thì "đã xuất 0"' || E'\n'
    || '      --   và phiếu không bao giờ hoàn thành được.' || E'\n'
    || '      IF r.credit_with_invoice THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)' || E'\n'
    || '          INTO v_sold' || E'\n'
    || '        FROM sales_invoice_lines sil' || E'\n'
    || '        JOIN sales_invoices si2 ON si2.id = sil.invoice_id' || E'\n'
    || '        WHERE si2.customer_id = r.customer_id' || E'\n'
    || '          AND si2.status = ''posted''' || E'\n'
    || '          AND sil.is_exchange = false' || E'\n'
    || '          AND sil.product_id = cap.product_id;' || E'\n'
    || E'\n'
    || '        SELECT COALESCE(sum(rl2.quantity * COALESCE((' || E'\n'
    || '                  SELECT pu.conversion FROM product_units pu' || E'\n'
    || '                   WHERE pu.product_id = rl2.product_id' || E'\n'
    || '                     AND pu.unit_name = rl2.unit_name), 1)), 0)' || E'\n'
    || '          INTO v_returned' || E'\n'
    || '        FROM return_lines rl2' || E'\n'
    || '        JOIN returns r2 ON r2.id = rl2.return_id' || E'\n'
    || '        WHERE r2.customer_id = r.customer_id' || E'\n'
    || '          AND r2.status = ''completed''' || E'\n'
    || '          AND rl2.is_exchange = false' || E'\n'
    || '          AND rl2.product_id = cap.product_id;' || E'\n'
    || E'\n'
    || '      ELSIF r.invoice_id IS NOT NULL THEN' || E'\n'
    || '        SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)';

  v_src := replace(v_src, v_anchor, v_new);

  EXECUTE v_src;
  RAISE NOTICE '134: đã vá complete_return — phiếu trả kèm đơn tính trần theo khách.';
END;
$patch$;

-- ---------------------------------------------------------------------
-- Trigger chặn lúc CHÈN DÒNG cũng mang đúng giả định ấy
-- ---------------------------------------------------------------------
--
-- ⚠ HAI CHỖ CHẶN, PHẢI SỬA CẢ HAI. `enforce_return_line_cap` (mig 124)
--   chạy lúc chèn dòng phiếu trả và so với ĐÚNG MỘT hóa đơn. Sửa mỗi
--   `complete_return` thì phiếu đi qua được lúc hoàn thành nhưng không
--   thêm nổi dòng — người dùng vấp đúng thông báo cũ ở một chỗ khác.
--
-- ⚠ GIỮ NGUYÊN NHÁNH "CHƯA GẮN HÓA ĐƠN THÌ BỎ QUA". Phiếu trả sinh ra
--   lúc lên đơn chưa có `invoice_id`, và hiện KHÔNG bị chặn gì. Đem trần
--   theo khách vào đó là thêm một phép chặn MỚI ở màn bán hàng — đúng
--   hơn về lý thuyết, nhưng nó chặn cả hàng khách mua từ trước khi dùng
--   phần mềm, và chặn ngay lúc NVBH đang đứng trước cửa hàng. Việc cần
--   làm hôm nay là NỚI chỗ chặn nhầm, không phải siết thêm chỗ mới.
CREATE OR REPLACE FUNCTION public.enforce_return_line_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice  uuid;
  v_cust     uuid;
  v_ride     boolean;
  v_conv     numeric;
  v_qty_base numeric;
  v_sold     numeric;
  v_returned numeric;
  v_name     text;
BEGIN
  IF NEW.is_exchange THEN
    RETURN NEW;
  END IF;

  SELECT r.invoice_id, r.customer_id, COALESCE(r.credit_with_invoice, false)
    INTO v_invoice, v_cust, v_ride
  FROM returns r WHERE r.id = NEW.return_id;

  -- Chưa gắn hóa đơn thì không có mốc để so — y như trước.
  IF v_invoice IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠ `return_lines` không có cột hệ số; phải tra `product_units`, và
  --   cột ở bảng đó tên `conversion`, KHÔNG phải `conversion_factor`.
  v_conv := COALESCE((
    SELECT pu.conversion FROM product_units pu
     WHERE pu.product_id = NEW.product_id AND pu.unit_name = NEW.unit_name), 1);
  v_qty_base := COALESCE(NEW.quantity, 0) * v_conv;

  IF v_ride THEN
    -- Phiếu sinh ra từ đơn: hàng trả là hàng của LẦN GIAO TRƯỚC, nên mốc
    -- là mọi thứ đã giao cho KHÁCH NÀY (mig 134).
    SELECT COALESCE(sum(sil.quantity * COALESCE(sil.conversion_factor, 1)), 0)
      INTO v_sold
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE si.customer_id = v_cust
      AND si.status = 'posted'
      AND sil.is_exchange = false
      AND sil.product_id = NEW.product_id;

    SELECT COALESCE(sum(rl.quantity * COALESCE((
              SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)), 0)
      INTO v_returned
    FROM return_lines rl
    JOIN returns r2 ON r2.id = rl.return_id
    WHERE r2.customer_id = v_cust
      AND r2.status = 'completed'
      AND rl.is_exchange = false
      AND rl.product_id = NEW.product_id
      AND rl.id <> NEW.id;
  ELSE
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
  END IF;

  IF v_qty_base + v_returned > v_sold THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS: "%" — đã giao %, đã trả %, dòng này thêm % là vượt',
      COALESCE(v_name, NEW.product_id::text), v_sold, v_returned, v_qty_base
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- Đối chiếu: còn phiếu nào đang kẹt vì trần cũ không
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ ĐẾM VÀ NÊU TÊN. Không tự hoàn thành phiếu nào — hoàn thành là
--   đụng vào tồn kho, và đó phải là một cú bấm có người chịu trách nhiệm.
DO $report$
DECLARE
  r     record;
  v_n   int := 0;
BEGIN
  FOR r IN
    SELECT ret.id, so.order_code, c.store_name
    FROM returns ret
    LEFT JOIN sales_orders so ON so.id = ret.order_id
    LEFT JOIN customers    c  ON c.id  = ret.customer_id
    WHERE ret.status = 'submitted'
      AND ret.credit_with_invoice
      AND EXISTS (
        SELECT 1 FROM return_lines rl
        WHERE rl.return_id = ret.id
          AND rl.is_exchange = false
          AND NOT EXISTS (
            SELECT 1 FROM sales_invoice_lines sil
            WHERE sil.invoice_id = ret.invoice_id
              AND sil.product_id = rl.product_id
          )
      )
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE '134: phiếu trả của đơn % (%) có hàng ngoài hóa đơn — trước đây không hoàn thành được, nay được.',
      COALESCE(r.order_code, '—'), COALESCE(r.store_name, '—');
  END LOOP;
  RAISE NOTICE '--- 134: % phiếu trả đang chờ được gỡ kẹt ---', v_n;
END;
$report$;

NOTIFY pgrst, 'reload schema';
