-- ====================================================================
-- 114 — Xoá đơn hàng nổ vì trigger ghi nhật ký
-- ====================================================================
--
-- TRIỆU CHỨNG (xuất hiện ngay sau khi mig 113 cho phép xoá thật):
--   null value in column "org_id" of relation "order_activity_log"
--   violates not-null constraint
--
-- CƠ CHẾ
--   Xoá một dòng `sales_orders` → `sales_order_lines` bị cascade xoá theo
--   → trigger `log_sales_order_line_change()` chạy cho từng dòng hàng.
--   Nhánh DELETE của nó làm:
--
--       SELECT org_id, current_workflow_stage INTO v_org, v_stage
--       FROM sales_orders WHERE id = OLD.order_id;
--
--   Nhưng đơn CHA đã bị xoá trong CÙNG câu lệnh đó. Truy vấn không tìm
--   thấy gì, `v_org` là NULL, và lệnh INSERT ngay sau đổ vì `org_id`
--   NOT NULL.
--
--   Trước mig 113 không ai gặp: RLS chặn từ vòng ngoài nên lệnh xoá chưa
--   bao giờ chạm tới trigger. Sửa được lỗi thứ nhất thì lỗi thứ hai lộ
--   ra — nó vẫn ở đó suốt.
--
-- CÁCH SỬA
--   Đơn cha không còn thì THÔI GHI, trả về OLD.
--
--   Không phải vá cho qua chuyện: `order_activity_log.order_id` có khoá
--   ngoại ON DELETE CASCADE, nên dòng nhật ký vừa ghi cũng bị xoá ngay
--   trong cùng câu lệnh. Ghi để rồi xoá là việc vô nghĩa — mà lại đang
--   làm hỏng cả thao tác xoá.
--
--   Nhật ký này sinh ra để ghi lại việc SỬA DÒNG HÀNG trong đời một đơn,
--   không phải để ghi lại cái chết của chính đơn đó.
--
-- SỬA THÊM MỘT CHỖ, NÓI RÕ RA ĐÂY
--   Nhánh UPDATE của hàm gốc KIỂM `line_discount` để quyết định có ghi
--   nhật ký không, nhưng phần mô tả thay đổi lại KHÔNG chứa cột đó. Hậu
--   quả: sửa mỗi chiết khấu dòng thì nhật ký có ghi, mà nội dung ghi là
--   một khối rỗng — biết "có người sửa gì đó" mà không biết sửa gì.
--
--   Đã thêm `line_discount` vào phần mô tả. Ghi rõ ở đây vì đó là thay
--   đổi HÀNH VI, không phải một phần của bản vá lỗi xoá đơn; đối chiếu
--   với mig 052 thì đây là khác biệt cố ý duy nhất ngoài hai chốt chặn
--   NULL ở trên.
--
-- Phần còn lại của hàm giữ NGUYÊN VĂN mig 052.
-- ====================================================================

CREATE OR REPLACE FUNCTION log_sales_order_line_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_stage  text;
  v_diff   jsonb := '{}'::jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT org_id, current_workflow_stage
      INTO v_org, v_stage
    FROM sales_orders WHERE id = OLD.order_id;

    -- [114] Đơn cha đã biến mất → đang xoá CẢ ĐƠN, không phải xoá một
    -- dòng hàng. Thôi ghi.
    IF v_org IS NULL THEN
      RETURN OLD;
    END IF;

    v_diff := jsonb_build_object(
      'product_id', OLD.product_id,
      'unit_name', OLD.unit_name,
      'quantity', OLD.quantity,
      'unit_price', OLD.unit_price,
      'line_total', OLD.line_total
    );
    INSERT INTO order_activity_log (
      org_id, order_id, order_line_id, action, workflow_stage,
      changes, actor_id
    ) VALUES (
      v_org, OLD.order_id, OLD.id, 'remove_line', v_stage,
      v_diff, auth.uid()
    );
    RETURN OLD;
  END IF;

  SELECT org_id, current_workflow_stage
    INTO v_org, v_stage
  FROM sales_orders WHERE id = NEW.order_id;

  -- Cùng lý do: đơn cha không còn thì không có gì để gắn dòng nhật ký
  -- vào. Chặn ở đây để hàm không bao giờ chèn `org_id` rỗng.
  IF v_org IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_diff := jsonb_build_object(
      'product_id', NEW.product_id,
      'unit_name', NEW.unit_name,
      'quantity', NEW.quantity,
      'unit_price', NEW.unit_price,
      'line_total', NEW.line_total
    );
    v_action := 'add_line';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log when something actually changed.
    IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id
       AND NEW.unit_name IS NOT DISTINCT FROM OLD.unit_name
       AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
       AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
       AND NEW.line_discount IS NOT DISTINCT FROM OLD.line_discount
       AND NEW.line_total IS NOT DISTINCT FROM OLD.line_total THEN
      RETURN NEW;
    END IF;
    v_diff := jsonb_strip_nulls(jsonb_build_object(
      'product_id', CASE WHEN NEW.product_id IS DISTINCT FROM OLD.product_id
        THEN jsonb_build_object('from', OLD.product_id, 'to', NEW.product_id) END,
      'unit_name', CASE WHEN NEW.unit_name IS DISTINCT FROM OLD.unit_name
        THEN jsonb_build_object('from', OLD.unit_name, 'to', NEW.unit_name) END,
      'quantity', CASE WHEN NEW.quantity IS DISTINCT FROM OLD.quantity
        THEN jsonb_build_object('from', OLD.quantity, 'to', NEW.quantity) END,
      'unit_price', CASE WHEN NEW.unit_price IS DISTINCT FROM OLD.unit_price
        THEN jsonb_build_object('from', OLD.unit_price, 'to', NEW.unit_price) END,
      'line_discount', CASE WHEN NEW.line_discount IS DISTINCT FROM OLD.line_discount
        THEN jsonb_build_object('from', OLD.line_discount, 'to', NEW.line_discount) END,
      'line_total', CASE WHEN NEW.line_total IS DISTINCT FROM OLD.line_total
        THEN jsonb_build_object('from', OLD.line_total, 'to', NEW.line_total) END
    ));
    v_action := 'edit_line';
  END IF;

  INSERT INTO order_activity_log (
    org_id, order_id, order_line_id, action, workflow_stage,
    changes, actor_id
  ) VALUES (
    v_org, NEW.order_id, NEW.id, v_action, v_stage,
    v_diff, auth.uid()
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION log_sales_order_line_change() IS
  'Ghi nhật ký sửa dòng hàng trong đời một đơn. Bỏ qua khi đơn cha đã bị '
  'xoá (mig 114) — lúc đó dòng nhật ký cũng sẽ cascade mất ngay, mà lại '
  'làm đổ cả lệnh xoá.';
