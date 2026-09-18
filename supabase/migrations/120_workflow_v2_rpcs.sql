-- ---------------------------------------------------------------------
-- 120 — Workflow v2: các RPC làm việc nặng
-- ---------------------------------------------------------------------
--
-- VÌ SAO PHẢI LÀ RPC
--   Xuất hàng = trừ kho FIFO + sinh công nợ + đổi trạng thái + mở phiếu
--   trả kèm đơn. Bốn việc, một ý nghĩa: hoặc xong cả bốn, hoặc không việc
--   nào. Làm bằng bốn lệnh rời từ trình duyệt thì mạng chập giữa chừng là
--   kho đã trừ mà công nợ chưa sinh, và không ai biết để sửa. Mỗi hàm ở
--   đây là MỘT giao dịch.
--
--   Migration 119 đã chặn đường tắt: đổi 'submitted' → 'completed' hoặc
--   'completed' → 'cancelled' bằng UPDATE thẳng sẽ RAISE 'USE_RPC'. Các
--   hàm dưới đây bật cờ `npp.via_rpc` trong giao dịch của mình rồi mới
--   đổi trạng thái.
--
-- ⚠ TRIGGER NHẬP KHO TỰ ĐỘNG CỦA ĐƠN TRẢ BỊ GỠ Ở ĐÂY
--   trg_auto_restock_return (mig 008) tự tạo phiếu nhập mỗi khi phiếu trả
--   sang 'completed'. Từ nay complete_return() làm việc đó. Để cả hai là
--   nhập kho HAI LẦN cho một lần trả hàng, tồn tăng gấp đôi và không có
--   gì báo. Chủ nhà đã chốt: "Hoàn thành đơn trả mới nhập kho."
--   Trigger cũ cũng không chọn được kho nhận (kho bán hay kho date) —
--   đúng thứ mục 3.4 cần.
--
-- ⚠ QUY ƯỚC BÁO LỖI
--   Mọi RAISE dùng ERRCODE 'P0001' và mở đầu bằng MÃ viết hoa
--   (LOCKED_HAS_PAYMENT: …) để giao diện tách mã ra rồi hiện đúng lý do,
--   thay vì ném nguyên câu tiếng Việt lên màn hình.
--
-- ⚠ QUYỀN
--   Kiểm bằng public.user_has_permission(auth.uid(), '<module>.<action>').
--   Hàm đó tách khoá tại DẤU CHẤM CUỐI rồi tra role_permissions(module,
--   action), nên khoá phải là cặp có thật trong ma trận: 'orders.approve',
--   'orders.update', 'returns.approve', 'receivables.create',
--   'receivables.update'. Chủ sở hữu luôn qua.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 0. Gỡ trigger nhập kho tự động của đơn trả
-- =====================================================================

DROP TRIGGER  IF EXISTS trg_auto_restock_return ON returns;
DROP FUNCTION IF EXISTS public.auto_restock_on_return();


-- =====================================================================
-- 0b. Lý do huỷ phiếu trả
-- =====================================================================
-- cancel_return nhận p_reason nhưng bảng chưa có chỗ chứa. Người dùng gõ
-- lý do, hệ thống báo thành công, mở lại không thấy gì — với phiếu đã
-- nhập kho rồi bị đảo thì đó là mất dấu vết của một lần đụng tồn kho.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS cancel_reason text;


-- =====================================================================
-- 0c. Mở đúng những ô quyền các RPC dưới đây cần
-- =====================================================================
-- ⚠ user_has_permission trả FALSE khi role_permissions chưa có dòng —
--   không có ma trận mặc định phía CSDL, bản mặc định chỉ nằm trong
--   TypeScript. Không seed thì sau khi chạy 120, mọi vai trò TRỪ chủ sở
--   hữu đều bị từ chối: quản lý bấm Xuất hàng ra 'FORBIDDEN', kế toán
--   không lập được phiếu thu, trong khi giao diện vẫn hiện nút.
--   Chỉ chèn đúng các ô theo DEFAULT_PERMISSION_MAP (src/lib/permissions.ts),
--   và ON CONFLICT DO NOTHING để không đè lên lựa chọn tổ chức đã cấu hình.
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, v.role, v.module, v.action, true
FROM organizations o
CROSS JOIN (VALUES
  ('manager',    'orders',      'approve'),
  ('manager',    'orders',      'update'),
  ('manager',    'returns',     'approve'),
  ('sales',      'orders',      'update'),
  ('accountant', 'receivables', 'create'),
  ('accountant', 'receivables', 'update'),
  ('sales',      'receivables', 'create')
) AS v(role, module, action)
ON CONFLICT (org_id, role, module, action) DO NOTHING;


-- =====================================================================
-- 1. Helper nội bộ (không cấp quyền gọi trực tiếp)
-- =====================================================================

-- 1.1 Thông báo cho một người. Bỏ qua khi không biết gửi cho ai.
CREATE OR REPLACE FUNCTION public._wf2_notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_link text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  SELECT org_id INTO v_org FROM users WHERE id = p_user_id;
  IF v_org IS NULL THEN RETURN; END IF;
  INSERT INTO notifications (org_id, user_id, type, title, body, link_url)
  VALUES (v_org, p_user_id, p_type, p_title, p_body, p_link);
END;
$$;

-- 1.2 Tính lại công nợ của một đơn.
--
-- Port từ recomputeReceivableForOrder (src/lib/returns.ts:192). Khác một
-- điểm: bản TS cộng credit của phiếu trả 'approved' lẫn 'completed'.
-- Workflow v2 không còn 'approved', và phiếu tạm thì chưa trừ nợ của ai —
-- chỉ 'completed' mới tính.
--
-- ⚠ KHÔNG đụng tới `paid`. Số đã thu là sự thật do phiếu thu ghi; tính
--   lại công nợ mà đè lên nó là xoá tiền khách đã trả.
CREATE OR REPLACE FUNCTION public._wf2_recompute_receivable(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o          record;
  v_credits  numeric;
  v_net      numeric;
  v_id       uuid;
  v_paid     numeric;
  v_days     int;
BEGIN
  SELECT id, org_id, customer_id, sales_user_id, total, payment_terms, order_date, status
    INTO o
  FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(COALESCE(credit_note_amount, 0)), 0) INTO v_credits
  FROM returns
  WHERE order_id = p_order_id AND status = 'completed';

  v_net := GREATEST(0, COALESCE(o.total, 0) - v_credits);

  SELECT id, COALESCE(paid, 0) INTO v_id, v_paid
  FROM receivables WHERE order_id = p_order_id LIMIT 1;

  -- ⚠ Chỉ ĐƠN ĐÃ XUẤT mới sinh công nợ. Hoàn thành một phiếu trả gắn vào
  --   đơn còn là phiếu tạm mà tạo công nợ ở đây thì khách bị ghi nợ một
  --   đơn chưa giao, và doanh thu vẫn bằng 0 — hai sổ nói hai đằng.
  IF v_id IS NULL AND o.status <> 'completed' THEN
    RETURN NULL;
  END IF;

  -- ⚠ Khách đã trả nhiều hơn số nợ mới (trả hàng sau khi đã thanh toán
  --   đủ). Hệ thống không có khái niệm số dư có, nên hạ amount xuống dưới
  --   paid là làm biến mất tiền đang giữ của khách. Dừng và bắt huỷ phiếu
  --   thu trước.
  IF v_id IS NOT NULL AND v_paid > v_net THEN
    RAISE EXCEPTION 'OVERPAID_AFTER_CREDIT: khách đã trả % nhưng nợ còn %, huỷ phiếu thu trước khi ghi có', v_paid, v_net
      USING ERRCODE = 'P0001';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE receivables
    SET amount = v_net,
        status = CASE
                   WHEN v_paid >= v_net THEN 'paid'
                   WHEN v_paid > 0      THEN 'partial'
                   ELSE 'open'
                 END
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- NETxx → số ngày; mọi thứ khác (COD, rỗng) = 0 ngày. Giống hệt
  -- paymentTermsToDays trong src/lib/returns.ts:273.
  v_days := COALESCE(
    (substring(upper(COALESCE(o.payment_terms, '')) FROM 'NET([0-9]+)'))::int, 0);

  INSERT INTO receivables (
    org_id, order_id, customer_id, sales_user_id, amount, paid, due_date, status
  ) VALUES (
    o.org_id, o.id, o.customer_id, o.sales_user_id, v_net, 0,
    COALESCE(o.order_date, current_date) + v_days, 'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 1.3 Dựng phiếu xuất rồi ghi sổ ngay.
--
-- p_lines: mảng jsonb, mỗi phần tử
--   { product_id, unit_name, quantity, conversion_factor, note? }
--
-- ⚠ RAISE của post_stock_export (INSUFFICIENT_STOCK khi tổ chức không cho
--   bán âm) làm rollback CẢ giao dịch — phiếu vừa dựng cũng biến mất. Đó
--   là điều mong muốn: không để lại phiếu rác khi xuất hàng thất bại.
CREATE OR REPLACE FUNCTION public._wf2_export_order(
  p_order_id uuid, p_lines jsonb, p_note text
) RETURNS TABLE (entry_id uuid, short_qty numeric, near_expiry_skipped int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   uuid;
  v_entry uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales_orders WHERE id = p_order_id;

  INSERT INTO stock_entries (
    org_id, entry_code, type, status, created_by, notes, ref_order_ids
  ) VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'draft', auth.uid(), p_note,
    jsonb_build_array(p_order_id::text)
  )
  RETURNING id INTO v_entry;

  -- `quantity` là cột integer từ mig 001, chỉ để hiển thị. Số thật nằm ở
  -- qty_in_transaction_uom / qty_in_base_uom (numeric) — FIFO đọc cột sau.
  INSERT INTO stock_entry_lines (
    entry_id, product_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, notes
  )
  SELECT
    v_entry,
    (l->>'product_id')::uuid,
    l->>'unit_name',
    round((l->>'quantity')::numeric)::int,
    (l->>'quantity')::numeric,
    (l->>'quantity')::numeric * COALESCE((l->>'conversion_factor')::numeric, 1),
    l->>'unit_name',
    COALESCE((l->>'conversion_factor')::numeric, 1),
    NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE COALESCE((l->>'quantity')::numeric, 0) > 0;

  RETURN QUERY
  SELECT v_entry, p.short_qty, p.near_expiry_skipped
  FROM post_stock_export(v_entry) p;
END;
$$;

-- 1.4 Hoàn hàng về ĐÚNG các lô đã lấy, thứ tự ngược (lô lấy sau trả trước).
--
-- ⚠ Dòng xuất cũ (trước mig 119) không có dấu vết FIFO. Khi đó hoàn về lô
--   ghi trên chính dòng đó; dòng không ghi lô nào thì về lô mới nhất cùng
--   sản phẩm ở kho bán. Không đoán thêm, và ghi rõ trong ghi chú dòng
--   nhập để người kiểm kê biết con số này kém chắc hơn.
CREATE OR REPLACE FUNCTION public._wf2_restock(
  p_source_line_id uuid, p_qty_base numeric, p_note text, p_entry_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_left    numeric := p_qty_base;
  v_give    numeric;
  c         record;
  v_product uuid;
  v_unit    text;
  v_conv    numeric;
  v_cost    numeric;
  v_batch   uuid;
  v_first   uuid;
  v_note    text := p_note;
BEGIN
  IF COALESCE(p_qty_base, 0) <= 0 THEN RETURN; END IF;

  SELECT product_id, unit_name, COALESCE(conversion_factor_snapshot, 1), COALESCE(unit_cost, 0), batch_id
    INTO v_product, v_unit, v_conv, v_cost, v_batch
  FROM stock_entry_lines WHERE id = p_source_line_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Hệ số quy đổi 0 hoặc âm thì phép chia ở cuối hàm trả NULL, và cột
  -- quantity là NOT NULL — lỗi 23502 ở một chỗ chẳng liên quan gì.
  IF COALESCE(v_conv, 0) <= 0 THEN v_conv := 1; END IF;

  -- ⚠ TRỪ DẦN dấu vết đã hoàn. Không trừ thì lần hoàn sau lại thấy đủ số
  --   cũ: sửa đơn giảm 4 rồi huỷ đơn sẽ hoàn thêm cả 10, kho dôi ra 4
  --   thùng không có thật.
  FOR c IN
    SELECT id, batch_id, qty_in_base_uom
    FROM stock_line_consumptions
    WHERE line_id = p_source_line_id AND qty_in_base_uom > 0
    ORDER BY created_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_give := LEAST(c.qty_in_base_uom, v_left);
    UPDATE batches SET qty_on_hand = qty_on_hand + v_give WHERE id = c.batch_id;
    UPDATE stock_line_consumptions
    SET qty_in_base_uom = qty_in_base_uom - v_give
    WHERE id = c.id;
    v_left := v_left - v_give;
    v_first := COALESCE(v_first, c.batch_id);
  END LOOP;

  IF v_left > 0 THEN
    IF v_batch IS NULL THEN
      SELECT id INTO v_batch
      FROM batches
      WHERE product_id = v_product AND warehouse_zone = 'sale'
      ORDER BY received_at DESC NULLS LAST, created_at DESC
      LIMIT 1;
    END IF;
    IF v_batch IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand + v_left WHERE id = v_batch;
      v_first := COALESCE(v_first, v_batch);
      v_note := v_note || ' • phần không có dấu vết lô, hoàn về lô gần nhất';
      v_left := 0;
    END IF;
  END IF;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'NO_BATCH_TO_RESTOCK: không tìm được lô để hoàn % đơn vị', v_left
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_entry_lines (
    entry_id, product_id, batch_id, unit_name, quantity,
    qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
    conversion_factor_snapshot, unit_cost, notes
  ) VALUES (
    p_entry_id, v_product, v_first, v_unit,
    round(p_qty_base / NULLIF(v_conv, 0))::int,
    p_qty_base / NULLIF(v_conv, 0), p_qty_base, v_unit,
    v_conv, v_cost, v_note
  );
END;
$$;


-- =====================================================================
-- 2. Xuất hàng
-- =====================================================================
-- Gọi lần hai trên đơn đã xuất KHÔNG xuất lại: RAISE ORDER_NOT_SUBMITTED
-- để màn hình biết mà tải lại, thay vì trừ kho thêm lần nữa.
CREATE OR REPLACE FUNCTION public.complete_order(p_order_id uuid)
RETURNS TABLE (
  entry_id uuid, receivable_id uuid, return_id uuid,
  short_qty numeric, near_expiry_skipped int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o        record;
  v_lines  jsonb;
  v_exp    record;
  v_rec    uuid;
  v_ret    uuid;
BEGIN
  SELECT id, org_id, order_code, status, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền xuất hàng' USING ERRCODE = 'P0001';
  END IF;
  IF o.status <> 'submitted' THEN
    RAISE EXCEPTION 'ORDER_NOT_SUBMITTED: đơn % không ở Phiếu tạm', o.order_code
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Hàng theo đơn, cộng hàng đem đổi của phiếu trả kèm đơn (còn nháp):
  -- khách đổi hàng thì hàng mới cũng rời kho trong chính chuyến này.
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object(
             'product_id', sol.product_id,
             'unit_name',  sol.unit_name,
             'quantity',   sol.quantity,
             'conversion_factor', COALESCE(sol.conversion_factor, 1),
             'note', sol.note) AS x
    FROM sales_order_lines sol WHERE sol.order_id = p_order_id
    UNION ALL
    SELECT jsonb_build_object(
             'product_id', rl.product_id,
             'unit_name',  rl.unit_name,
             'quantity',   rl.quantity,
             'conversion_factor', COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1),
             'note', '[Exchange]') AS x
    FROM return_lines rl
    JOIN returns r ON r.id = rl.return_id
    WHERE r.order_id = p_order_id AND r.status = 'draft' AND rl.is_exchange = true
  ) s;

  SELECT * INTO v_exp
  FROM public._wf2_export_order(p_order_id, v_lines, 'Xuất theo đơn ' || o.order_code);

  UPDATE sales_orders
  SET status = 'completed', completed_at = now(), completed_by = auth.uid()
  WHERE id = p_order_id;

  v_rec := public._wf2_recompute_receivable(p_order_id);

  -- Phiếu trả kèm đơn đang nháp: đơn đã xuất thì phiếu trả thành phiếu tạm
  -- để NPP xử lý tiếp.
  -- ⚠ KHÔNG dùng RETURNING … INTO ở đây: lệnh DML trả nhiều hơn một dòng
  --   là lỗi 21000, và một đơn có thể có vài phiếu trả nháp.
  UPDATE returns SET status = 'submitted'
  WHERE order_id = p_order_id AND status = 'draft';

  SELECT id INTO v_ret FROM returns
  WHERE order_id = p_order_id AND status = 'submitted'
  ORDER BY created_at LIMIT 1;

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_completed',
    'Đơn ' || o.order_code || ' đã xuất hàng', NULL,
    '/orders/' || p_order_id::text);

  RETURN QUERY SELECT v_exp.entry_id, v_rec, v_ret, v_exp.short_qty, v_exp.near_expiry_skipped;
END;
$$;


-- 1.5 Các khoá chung cho sửa và huỷ đơn ĐÃ XUẤT.
--
-- p_check_age: chỉ bật khi SỬA. Huỷ đơn đã xuất không bị chặn bởi hạn
-- sửa — hàng có thể quay về kho muộn hơn thế, và chặn ở đây thì đơn sai
-- nằm lại vĩnh viễn.
CREATE OR REPLACE FUNCTION public._wf2_assert_order_unlocked(
  p_order_id uuid, p_order_date date, p_check_age boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM receivables r WHERE r.order_id = p_order_id AND COALESCE(r.paid, 0) > 0
  ) OR EXISTS (
    SELECT 1 FROM cash_receipt_lines crl
    JOIN cash_receipts cr ON cr.id = crl.receipt_id
    WHERE crl.order_id = p_order_id AND cr.status <> 'voided'
  ) THEN
    RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: đơn đã có tiền thu, huỷ phiếu thu trước'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_check_age THEN
    SELECT COALESCE(completed_edit_days, 1) INTO v_days
    FROM organizations WHERE id = public.user_org_id();
    IF COALESCE(p_order_date, current_date) < current_date - v_days THEN
      RAISE EXCEPTION 'LOCKED_TOO_OLD: quá % ngày kể từ ngày đặt', v_days
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- "Đã phát hành" = hoá đơn nội bộ đã chốt, hoặc MISA đã cấp số / đã ký.
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.order_id = p_order_id
      AND (i.status = 'issued'
           OR i.misa_inv_no IS NOT NULL
           OR i.misa_status IN ('signed', 'replaced'))
  ) THEN
    RAISE EXCEPTION 'LOCKED_EINVOICE: đơn đã phát hành hoá đơn điện tử'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM returns r WHERE r.order_id = p_order_id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'LOCKED_RETURN_DONE: đơn đã có phiếu trả hoàn thành'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;


-- =====================================================================
-- 3. Sửa đơn đã hoàn thành
-- =====================================================================
-- p_lines là TOÀN BỘ dòng mong muốn sau khi sửa. Dòng không có `id` là
-- thêm mới; `id` cũ không còn trong mảng là xoá.
--
-- ⚠ BỐN KHOÁ. Sửa đơn đã xuất là đụng vào kho và công nợ đã chốt sổ. Khi
--   đã có tiền vào, đã quá hạn sửa, đã phát hành hoá đơn, hoặc đã có phiếu
--   trả hoàn thành gắn vào đơn — thì không sửa nữa, phải đi đường chứng
--   từ khác.
CREATE OR REPLACE FUNCTION public.edit_completed_order(
  p_order_id uuid, p_lines jsonb, p_subtotal numeric, p_vat numeric,
  p_total numeric, p_notes text
) RETURNS TABLE (export_entry_id uuid, import_entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o         record;
  v_sum     numeric;
  v_delta   jsonb;
  v_add     jsonb;
  v_exp     record;
  v_imp     uuid;
  d         record;
  s         record;
  v_need    numeric;
  v_take    numeric;
  v_old     numeric;
BEGIN
  SELECT id, org_id, order_code, status, order_date, total, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền sửa đơn' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ Hàm là SECURITY DEFINER nên bỏ qua RLS. Không kiểm chủ đơn ở đây thì
  --   NVBH sửa được đơn đã xuất của người khác, kéo theo kho, công nợ và
  --   doanh số của họ.
  IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ sửa được đơn của mình'
      USING ERRCODE = 'P0001';
  END IF;
  IF o.status <> 'completed' THEN
    RAISE EXCEPTION 'LOCKED_NOT_COMPLETED: đơn % chưa xuất hàng', o.order_code
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._wf2_assert_order_unlocked(p_order_id, o.order_date, true);

  SELECT COALESCE(sum((l->>'line_total')::numeric), 0) INTO v_sum
  FROM jsonb_array_elements(p_lines) AS l;
  IF abs(COALESCE(p_subtotal, 0) - v_sum) > 1 THEN
    RAISE EXCEPTION 'TOTAL_MISMATCH: tạm tính % không khớp tổng dòng %', p_subtotal, v_sum
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Chênh lệch theo (sản phẩm, đơn vị), quy về base UOM.
  --
  -- ⚠ Dùng biến jsonb chứ KHÔNG dùng bảng tạm: hai lần gọi hàm trong cùng
  --   một giao dịch sẽ đụng "bảng tạm đã tồn tại", và lỗi đó chỉ hiện ra
  --   khi có người sửa hai đơn liền tay.
  WITH new_l AS (
    SELECT (l->>'product_id')::uuid AS product_id,
           l->>'unit_name' AS unit_name,
           sum((l->>'quantity')::numeric * COALESCE((l->>'conversion_factor')::numeric, 1)) AS qty
    FROM jsonb_array_elements(p_lines) AS l
    GROUP BY 1, 2
  ), old_l AS (
    SELECT product_id, unit_name,
           sum(quantity * COALESCE(conversion_factor, 1)) AS qty
    FROM sales_order_lines WHERE order_id = p_order_id
    GROUP BY 1, 2
  ), d AS (
    SELECT COALESCE(n.product_id, o2.product_id) AS product_id,
           COALESCE(n.unit_name, o2.unit_name)   AS unit_name,
           COALESCE(n.qty, 0) - COALESCE(o2.qty, 0) AS delta
    FROM new_l n FULL OUTER JOIN old_l o2
      ON o2.product_id = n.product_id AND o2.unit_name = n.unit_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'unit_name', unit_name, 'delta', delta)), '[]'::jsonb)
    INTO v_delta
  FROM d WHERE delta <> 0;

  -- Phần TĂNG: xuất thêm.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', (x->>'product_id')::uuid,
           'unit_name',  x->>'unit_name',
           'quantity',   (x->>'delta')::numeric / NULLIF(COALESCE((
             SELECT pu.conversion FROM product_units pu
              WHERE pu.product_id = (x->>'product_id')::uuid
                AND pu.unit_name = x->>'unit_name'), 1), 0),
           'conversion_factor', COALESCE((
             SELECT pu.conversion FROM product_units pu
              WHERE pu.product_id = (x->>'product_id')::uuid
                AND pu.unit_name = x->>'unit_name'), 1))), '[]'::jsonb)
    INTO v_add
  FROM jsonb_array_elements(v_delta) AS x
  WHERE (x->>'delta')::numeric > 0;

  IF jsonb_array_length(v_add) > 0 THEN
    SELECT * INTO v_exp
    FROM public._wf2_export_order(p_order_id, v_add, 'Sửa đơn ' || o.order_code);
    export_entry_id := v_exp.entry_id;
  END IF;

  -- Phần GIẢM: hoàn về đúng lô đã lấy.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_delta) AS x WHERE (x->>'delta')::numeric < 0) THEN
    INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
    VALUES (o.org_id,
            'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
            'import', 'posted', now(), auth.uid(),
            'Hoàn kho do sửa đơn ' || o.order_code)
    RETURNING id INTO v_imp;
    import_entry_id := v_imp;

    FOR d IN
      SELECT (x->>'product_id')::uuid AS product_id,
             x->>'unit_name' AS unit_name,
             (x->>'delta')::numeric AS delta
      FROM jsonb_array_elements(v_delta) AS x
      WHERE (x->>'delta')::numeric < 0
    LOOP
      v_need := -d.delta;
      FOR s IN
        SELECT sel.id,
               COALESCE((SELECT sum(slc.qty_in_base_uom)
                           FROM stock_line_consumptions slc
                          WHERE slc.line_id = sel.id), sel.qty_in_base_uom) AS qty_in_base_uom
        FROM stock_entry_lines sel
        JOIN stock_entries se ON se.id = sel.entry_id
        WHERE se.type = 'export' AND se.status = 'posted'
          AND se.ref_order_ids @> jsonb_build_array(p_order_id::text)
          AND sel.product_id = d.product_id
          AND sel.unit_name = d.unit_name
        ORDER BY se.posted_at DESC, sel.id DESC
      LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(s.qty_in_base_uom, v_need);
        PERFORM public._wf2_restock(s.id, v_take, 'Hoàn kho do sửa đơn ' || o.order_code, v_imp);
        v_need := v_need - v_take;
      END LOOP;
      IF v_need > 0 THEN
        RAISE EXCEPTION 'NO_EXPORT_TO_REVERSE: không tìm được dòng xuất để hoàn % đơn vị', v_need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  -- Ghi lại dòng đơn. Trigger mig 052 tự ghi nhật ký từng dòng.
  DELETE FROM sales_order_lines
  WHERE order_id = p_order_id
    AND id NOT IN (
      SELECT NULLIF(l->>'id', '')::uuid FROM jsonb_array_elements(p_lines) AS l
      WHERE NULLIF(l->>'id', '') IS NOT NULL);

  UPDATE sales_order_lines sol
  SET product_id = (l->>'product_id')::uuid,
      unit_name  = l->>'unit_name',
      quantity   = (l->>'quantity')::numeric,
      unit_price = (l->>'unit_price')::numeric,
      line_discount = COALESCE((l->>'line_discount')::numeric, 0),
      line_total = (l->>'line_total')::numeric,
      conversion_factor = COALESCE((l->>'conversion_factor')::numeric, 1),
      note = NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE sol.id = NULLIF(l->>'id', '')::uuid AND sol.order_id = p_order_id;

  INSERT INTO sales_order_lines (
    order_id, product_id, unit_name, quantity, unit_price,
    line_discount, line_total, conversion_factor, note
  )
  SELECT p_order_id, (l->>'product_id')::uuid, l->>'unit_name',
         (l->>'quantity')::numeric, (l->>'unit_price')::numeric,
         COALESCE((l->>'line_discount')::numeric, 0), (l->>'line_total')::numeric,
         COALESCE((l->>'conversion_factor')::numeric, 1), NULLIF(l->>'note', '')
  FROM jsonb_array_elements(p_lines) AS l
  WHERE NULLIF(l->>'id', '') IS NULL;

  v_old := o.total;
  UPDATE sales_orders
  SET subtotal = p_subtotal, vat = p_vat, total = p_total, notes = p_notes
  WHERE id = p_order_id;

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'edit_after_complete', 'completed',
          jsonb_build_object('export_entry_id', export_entry_id,
                             'import_entry_id', import_entry_id,
                             'old_total', v_old,
                             'new_total', p_total),
          auth.uid());

  PERFORM public._wf2_recompute_receivable(p_order_id);
  PERFORM public._wf2_notify(
    (SELECT sales_user_id FROM sales_orders WHERE id = p_order_id),
    'order_edited', 'Đơn ' || o.order_code || ' vừa được sửa', NULL,
    '/orders/' || p_order_id::text);

  RETURN NEXT;
END;
$$;

-- =====================================================================
-- 4. Huỷ đơn
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o      record;
  v_imp  uuid;
  s      record;
  d      record;
  v_need numeric;
  v_take numeric;
BEGIN
  SELECT id, org_id, order_code, status, order_date, sales_user_id INTO o
  FROM sales_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'cancelled' THEN RETURN; END IF;

  IF o.status IN ('draft', 'submitted') THEN
    IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
      RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn' USING ERRCODE = 'P0001';
    END IF;
    IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ huỷ được đơn của mình'
        USING ERRCODE = 'P0001';
    END IF;

    -- draft/submitted → cancelled không cần cờ RPC: trigger 119 chỉ gác
    -- hai bước đụng kho và công nợ.
    UPDATE sales_orders
    SET status = 'cancelled', cancelled_at = now(),
        cancelled_by = auth.uid(), cancel_reason = p_reason
    WHERE id = p_order_id;

    UPDATE returns SET status = 'cancelled', cancelled_at = now()
    WHERE order_id = p_order_id AND status = 'draft';

    PERFORM public._wf2_notify(
      o.sales_user_id, 'order_cancelled',
      'Đơn ' || o.order_code || ' đã bị huỷ', p_reason,
      '/orders/' || p_order_id::text);
    RETURN;
  END IF;

  -- Huỷ đơn ĐÃ XUẤT: hoàn kho toàn bộ rồi xoá công nợ.
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn đã xuất'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ đơn đã xuất'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._wf2_assert_order_unlocked(p_order_id, o.order_date, false);
  PERFORM set_config('npp.via_rpc', 'on', true);

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (o.org_id,
          'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'import', 'posted', now(), auth.uid(),
          'Hoàn kho do huỷ đơn ' || o.order_code)
  RETURNING id INTO v_imp;

  -- ⚠ HAI CÁI BẪY Ở ĐÂY.
  --   1. Phiếu xuất có thể GỘP NHIỀU ĐƠN (màn xuất kho cũ gộp theo khách,
  --      ref_order_ids là mảng). Hoàn nguyên dòng của phiếu gộp là trả về
  --      kho cả hàng của đơn khác — tồn dôi ra mà không ai giải thích nổi.
  --      Vì thế chỉ hoàn ĐÚNG số của đơn đang huỷ, theo từng cặp sản phẩm
  --      và đơn vị.
  --   2. Đơn có thể đã được sửa giảm và hoàn một phần trước đó, nên lấy
  --      phần CÒN LẠI theo dấu vết FIFO chứ không lấy số xuất ban đầu.
  FOR d IN
    SELECT product_id, unit_name, sum(qty) AS qty FROM (
      SELECT sol.product_id, sol.unit_name,
             sol.quantity * COALESCE(sol.conversion_factor, 1) AS qty
      FROM sales_order_lines sol WHERE sol.order_id = p_order_id
      UNION ALL
      SELECT rl.product_id, rl.unit_name,
             rl.quantity * COALESCE((SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id AND pu.unit_name = rl.unit_name), 1)
      FROM return_lines rl
      JOIN returns r2 ON r2.id = rl.return_id
      WHERE r2.order_id = p_order_id AND rl.is_exchange = true
    ) t GROUP BY product_id, unit_name
  LOOP
    v_need := d.qty;
    FOR s IN
      SELECT sel.id,
             COALESCE((SELECT sum(slc.qty_in_base_uom)
                         FROM stock_line_consumptions slc
                        WHERE slc.line_id = sel.id), sel.qty_in_base_uom) AS qty_left
      FROM stock_entry_lines sel
      JOIN stock_entries se ON se.id = sel.entry_id
      WHERE se.type = 'export' AND se.status = 'posted'
        AND se.ref_order_ids @> jsonb_build_array(p_order_id::text)
        AND sel.product_id = d.product_id
        AND sel.unit_name = d.unit_name
      ORDER BY se.posted_at DESC, sel.id DESC
    LOOP
      EXIT WHEN v_need <= 0;
      CONTINUE WHEN COALESCE(s.qty_left, 0) <= 0;
      v_take := LEAST(s.qty_left, v_need);
      PERFORM public._wf2_restock(s.id, v_take,
        'Hoàn kho do huỷ đơn ' || o.order_code, v_imp);
      v_need := v_need - v_take;
    END LOOP;
  END LOOP;

  -- ⚠ Phiếu thu ĐÃ HUỶ vẫn để lại dòng trỏ vào công nợ (void chỉ đổi
  --   trạng thái phiếu). Không gỡ trước thì DELETE dưới đây nổ 23503 và
  --   phần hoàn kho vừa làm cũng rollback.
  UPDATE cash_receipt_lines crl
  SET receivable_id = NULL, payment_id = NULL
  FROM receivables r
  WHERE crl.receivable_id = r.id AND r.order_id = p_order_id;

  DELETE FROM receivables WHERE order_id = p_order_id;

  UPDATE returns SET status = 'cancelled', cancelled_at = now()
  WHERE order_id = p_order_id AND status IN ('draft', 'submitted');

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'cancel_after_complete', 'cancelled',
          jsonb_build_object('import_entry_id', v_imp, 'reason', p_reason), auth.uid());

  UPDATE sales_orders
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_order_id;

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã bị huỷ sau khi xuất', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 5. Đơn trả
-- =====================================================================
-- Nhập kho vào ĐÚNG kho người dùng chọn. Hàng cận date về kho date thì
-- lần bán sau nó ra trước — đó là lý do có tham số này.
CREATE OR REPLACE FUNCTION public.complete_return(p_return_id uuid, p_zone text)
RETURNS TABLE (entry_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          record;
  v_entry    uuid;
  v_code     text;
  l          record;
  v_conv     numeric;
  v_base     numeric;
  v_batch    uuid;
  v_cost     numeric;
  v_exp      date;
  cap        record;
  v_sold     numeric;
  v_returned numeric;
  v_pname    text;
BEGIN
  SELECT id, org_id, order_id, status, requested_by INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền hoàn thành đơn trả'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_zone NOT IN ('sale', 'date') THEN
    RAISE EXCEPTION 'BAD_ZONE: kho nhận phải là sale hoặc date' USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ Nhập lại hàng của một đơn CHƯA xuất là cộng khống tồn kho: số hàng
  --   đó chưa bao giờ rời kho. Backfill mig 119 có thể tạo ra đúng cảnh
  --   này với phiếu trả cũ ở trạng thái đã duyệt.
  IF r.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_orders o2 WHERE o2.id = r.order_id AND o2.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_COMPLETED: đơn gốc chưa xuất hàng, không nhập trả được'
      USING ERRCODE = 'P0001';
  END IF;

  -- ===================================================================
  -- Q8 — TRẦN SỐ LƯỢNG TRẢ, KIỂM LẠI Ở ĐÂY
  --
  -- ⚠ VÌ SAO PHẢI KIỂM HAI LẦN. Trigger `enforce_return_line_cap` (mig
  --   119) chạy lúc CHÈN DÒNG, và phần "đã trả rồi" của nó chỉ đếm phiếu
  --   ở trạng thái 'completed'. Nên hai phiếu trả của cùng một đơn, cùng
  --   nằm ở 'submitted', mỗi phiếu đều thấy "đã trả = 0" và đều LỌT:
  --     đơn bán 10 → phiếu A 10 lọt → phiếu B 10 cũng lọt
  --     → hoàn thành cả hai → nhập kho 20 và trừ công nợ gấp đôi.
  --
  -- ⚠ KIỂM Ở ĐÂY, KHÔNG SIẾT TRIGGER. Bắt trigger đếm cả phiếu
  --   'submitted' thì một phiếu lập nhầm rồi bỏ đó sẽ chiếm chỗ và chặn
  --   mất phiếu thật. Chặn đúng lúc hàng THẬT SỰ vào kho là chỗ duy nhất
  --   con số có ý nghĩa.
  --
  -- ⚠ Dòng ĐỔI không tính — hàng đổi không trừ công nợ và không bị chặn
  --   bởi số đã bán. Phiếu trả độc lập cũng không: không có đơn gốc để so.
  -- ===================================================================
  IF r.order_id IS NOT NULL THEN
    FOR cap IN
      SELECT rl.product_id,
             sum(rl.quantity * COALESCE((
               SELECT pu.conversion FROM product_units pu
                WHERE pu.product_id = rl.product_id
                  AND pu.unit_name = rl.unit_name), 1)) AS need
      FROM return_lines rl
      WHERE rl.return_id = p_return_id AND rl.is_exchange = false
      GROUP BY rl.product_id
    LOOP
      SELECT COALESCE(sum(sol.quantity * COALESCE(sol.conversion_factor, 1)), 0)
        INTO v_sold
      FROM sales_order_lines sol
      WHERE sol.order_id = r.order_id AND sol.product_id = cap.product_id;

      SELECT COALESCE(sum(rl2.quantity * COALESCE((
                SELECT pu.conversion FROM product_units pu
                 WHERE pu.product_id = rl2.product_id
                   AND pu.unit_name = rl2.unit_name), 1)), 0)
        INTO v_returned
      FROM return_lines rl2
      JOIN returns r2 ON r2.id = rl2.return_id
      WHERE r2.order_id = r.order_id
        AND r2.status = 'completed'
        AND rl2.is_exchange = false
        AND rl2.product_id = cap.product_id;

      IF cap.need + v_returned > v_sold THEN
        SELECT name INTO v_pname FROM products WHERE id = cap.product_id;
        RAISE EXCEPTION
          'RETURN_QTY_EXCEEDS: "%" — đã bán %, đã hoàn thành trả %, phiếu này thêm % là vượt',
          COALESCE(v_pname, cap.product_id::text), v_sold, v_returned, cap.need
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;

  v_code := 'NL-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id, v_code, 'import', 'posted', now(), auth.uid(),
          'Nhập lại từ phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  -- Hàng ĐỔI cũng vào kho như hàng trả; khác nhau ở chỗ nó không ghi có
  -- công nợ, và việc đó do credit_note_amount lo (mig 055).
  FOR l IN
    SELECT rl.id, rl.product_id, rl.unit_name, rl.quantity, rl.is_exchange
    FROM return_lines rl WHERE rl.return_id = p_return_id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) <= 0;

    v_conv := COALESCE((SELECT pu.conversion FROM product_units pu
                         WHERE pu.product_id = l.product_id
                           AND pu.unit_name = l.unit_name), 1);
    IF v_conv <= 0 THEN v_conv := 1; END IF;
    v_base := l.quantity * v_conv;

    -- ⚠ Giá vốn phải theo hàng THẬT. Để 0 thì lần bán sau FIFO ăn vào lô
    --   này với giá vốn 0, lãi gộp báo cao hơn thực đúng bằng giá vốn số
    --   hàng đã trả. Lấy theo thứ tự: lô đã bán ra của chính đơn gốc →
    --   lô cùng sản phẩm mới nhất → 0.
    v_cost := COALESCE(
      (SELECT slc.unit_cost
         FROM stock_line_consumptions slc
         JOIN stock_entry_lines sel ON sel.id = slc.line_id
         JOIN stock_entries se ON se.id = sel.entry_id
        WHERE sel.product_id = l.product_id
          AND r.order_id IS NOT NULL
          AND se.ref_order_ids @> jsonb_build_array(r.order_id::text)
        ORDER BY slc.created_at DESC LIMIT 1),
      (SELECT b3.unit_cost FROM batches b3
        WHERE b3.product_id = l.product_id AND COALESCE(b3.unit_cost, 0) > 0
        ORDER BY b3.received_at DESC NULLS LAST LIMIT 1),
      0);

    SELECT b.id INTO v_batch
    FROM batches b
    WHERE b.org_id = r.org_id
      AND b.product_id = l.product_id
      AND b.warehouse_zone = p_zone
      AND COALESCE(b.status, 'available') = 'available'
    ORDER BY b.received_at DESC NULLS LAST, b.created_at DESC
    LIMIT 1;

    IF v_batch IS NULL THEN
      -- Lô mới: hạn dùng lấy từ lô xa nhất cùng sản phẩm; không có thì
      -- suy từ hạn sử dụng của sản phẩm; không có nữa thì một năm. Ghi
      -- cách suy vào ghi chú để người kiểm kê biết con số này từ đâu.
      SELECT max(b2.expires_at) INTO v_exp FROM batches b2
       WHERE b2.org_id = r.org_id AND b2.product_id = l.product_id;
      IF v_exp IS NULL THEN
        SELECT current_date + COALESCE(p.shelf_life_days, 365) INTO v_exp
        FROM products p WHERE p.id = l.product_id;
      END IF;

      INSERT INTO batches (
        org_id, product_id, batch_code, expires_at, qty_initial, qty_on_hand,
        unit_cost, warehouse_zone, received_at
      ) VALUES (
        r.org_id, l.product_id, 'RESTOCK-' || v_code, COALESCE(v_exp, current_date + 365),
        v_base, 0, v_cost, p_zone, now()
      )
      RETURNING id INTO v_batch;

      -- ⚠ batches có trigger tự xếp kho: lô sắp hết hạn bị đẩy sang kho
      --   date dù người dùng chọn kho bán. Ép lại đúng ý người duyệt, nếu
      --   không thì returns.destination_zone và kho thật nói hai đằng.
      UPDATE batches SET warehouse_zone = p_zone WHERE id = v_batch;
    END IF;

    UPDATE batches SET qty_on_hand = qty_on_hand + v_base WHERE id = v_batch;

    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, v_batch, l.unit_name, round(l.quantity)::int,
      l.quantity, v_base, l.unit_name, v_conv, v_cost,
      CASE WHEN l.is_exchange THEN 'Hàng đổi thu về' ELSE 'Nhập lại từ đơn trả' END
    );
  END LOOP;

  UPDATE returns
  SET status = 'completed', completed_at = now(),
      completed_by = auth.uid(), destination_zone = p_zone
  WHERE id = p_return_id;

  IF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;

  PERFORM public._wf2_notify(
    r.requested_by, 'return_completed',
    'Phiếu trả đã hoàn thành', NULL, '/returns/' || p_return_id::text);

  RETURN QUERY SELECT v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_return(p_return_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  v_entry uuid;
  l       record;
  v_rows  int := 0;
BEGIN
  SELECT id, org_id, order_id, status, applied_receipt_id INTO r
  FROM returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'returns.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn trả' USING ERRCODE = 'P0001';
  END IF;

  IF r.status = 'submitted' THEN
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
    RETURN;
  END IF;

  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'RETURN_NOT_CANCELLABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Khoản có đã cấn vào phiếu thu thì không rút lại được ở đây.
  IF r.applied_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu'
      USING ERRCODE = 'P0001';
  END IF;
  IF r.order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM receivables rc WHERE rc.order_id = r.order_id AND COALESCE(rc.paid, 0) > 0
  ) THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: đơn gốc đã có tiền thu'
      USING ERRCODE = 'P0001';
  END IF;

  -- Đảo đúng những lô đã nhập của chính phiếu trả này.
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (r.org_id,
          'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'export', 'posted', now(), auth.uid(),
          'Đảo phiếu trả ' || p_return_id::text)
  RETURNING id INTO v_entry;

  FOR l IN
    SELECT sel.product_id, sel.batch_id, sel.unit_name, sel.quantity,
           sel.qty_in_base_uom, sel.conversion_factor_snapshot
    FROM stock_entry_lines sel
    JOIN stock_entries se ON se.id = sel.entry_id
    WHERE se.org_id = r.org_id
      AND se.type = 'import'
      AND se.notes = 'Nhập lại từ phiếu trả ' || p_return_id::text
  LOOP
    IF l.batch_id IS NOT NULL THEN
      UPDATE batches SET qty_on_hand = qty_on_hand - l.qty_in_base_uom WHERE id = l.batch_id;
    END IF;
    INSERT INTO stock_entry_lines (
      entry_id, product_id, batch_id, unit_name, quantity,
      qty_in_transaction_uom, qty_in_base_uom, transaction_uom,
      conversion_factor_snapshot, unit_cost, notes
    ) VALUES (
      v_entry, l.product_id, l.batch_id, l.unit_name, l.quantity,
      l.quantity, l.qty_in_base_uom, l.unit_name,
      COALESCE(l.conversion_factor_snapshot, 1), 0, 'Đảo do huỷ phiếu trả'
    );
    v_rows := v_rows + 1;
  END LOOP;

  -- ⚠ Phiếu trả hoàn thành TRƯỚC mig 120 do trigger cũ nhập kho, ghi chú
  --   khác hẳn nên không khớp được. Im lặng đi tiếp là ghi nợ lại cho
  --   khách trong khi hàng vẫn nằm trong kho. Nói ra và dừng.
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'NO_IMPORT_TO_REVERSE: không tìm được phiếu nhập của phiếu trả này, phải đảo kho bằng tay'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  WHERE id = p_return_id;

  IF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  END IF;
END;
$$;


-- =====================================================================
-- 6. Phiếu thu
-- =====================================================================
-- p = { customer_id, receipt_date, method, notes,
--       lines: [{receivable_id, amount}], credits: [{return_id}] }
--
-- ⚠ KHÔNG tạo số dư có. Cấn trừ vượt số nợ đã chọn thì RAISE, chứ không
--   để lại một khoản treo mà sau này không ai biết nó ở đâu ra.
CREATE OR REPLACE FUNCTION public.create_cash_receipt(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid := public.user_org_id();
  v_cust     uuid := (p->>'customer_id')::uuid;
  v_method   text := COALESCE(p->>'method', 'cash');
  v_sum_line numeric;
  v_sum_cred numeric;
  v_receipt  uuid;
  v_code     text;
  v_try      int := 0;
  v_alloc    jsonb;
  v_item     jsonb;
  v_left     numeric;
  v_apply    numeric;
  v_cred     numeric;
  v_pay      uuid;
  i          int;
  c          record;
  rl         record;
BEGIN
  IF NOT public.user_has_permission(auth.uid(), 'receivables.create') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền lập phiếu thu' USING ERRCODE = 'P0001';
  END IF;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED: chưa chọn khách hàng' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(sum(x.amount), 0) INTO v_sum_line FROM (
    SELECT sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY (l->>'receivable_id')
  ) x;

  -- ⚠ DISTINCT: payload gửi trùng một phiếu trả hai lần thì khách được
  --   cấn trừ gấp đôi mà không có lỗi nào.
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_sum_cred
  FROM (
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  ) k
  JOIN returns r ON r.id = k.id;

  IF v_sum_line <= 0 AND v_sum_cred <= 0 THEN
    RAISE EXCEPTION 'EMPTY_RECEIPT: chưa chọn khoản nào để thu' USING ERRCODE = 'P0001';
  END IF;
  IF v_sum_cred > v_sum_line THEN
    RAISE EXCEPTION 'CREDIT_EXCEEDS_SELECTED: cấn trừ vượt số nợ đã chọn'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ GỘP theo khoản nợ trước khi kiểm. Payload gửi cùng một khoản nợ
  --   thành hai dòng thì kiểm riêng lẻ đều lọt, nhưng cộng dồn vào `paid`
  --   là thu vượt số nợ.
  -- ⚠ Và phải KHOÁ HÀNG khi kiểm: hai kế toán bấm Lưu cùng lúc thì cả hai
  --   cùng đọc paid cũ, cả hai cùng qua, và khoản nợ bị thu hai lần.
  FOR rl IN
    SELECT (l->>'receivable_id')::uuid AS id, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY 1
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM receivables r
      WHERE r.id = rl.id AND r.org_id = v_org AND r.customer_id = v_cust
        AND rl.amount <= COALESCE(r.amount, 0) - COALESCE(r.paid, 0) + 0.01
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'BAD_RECEIVABLE_LINE: khoản nợ không hợp lệ hoặc thu vượt số còn nợ'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR c IN
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  LOOP
    -- ⚠ Q10 — PHẢI KHOÁ HÀNG. Không có FOR UPDATE thì hai kế toán cùng
    --   lập phiếu thu cấn trừ CÙNG một phiếu trả độc lập sẽ cùng đọc
    --   `applied_receipt_id IS NULL`, cùng qua, và khoản có bị cấn trừ
    --   hai lần — lệnh UPDATE ở cuối chỉ ghi đè chứ không chặn.
    --   Cách viết `NOT EXISTS (… FOR UPDATE)` này giống hệt vòng kiểm
    --   khoản nợ bên trên: ở READ COMMITTED, Postgres khoá dòng rồi đánh
    --   giá lại điều kiện sau khi chờ, nên người thứ hai nhận BAD_CREDIT.
    IF NOT EXISTS (
      SELECT 1 FROM returns r
      WHERE r.id = c.id AND r.org_id = v_org AND r.customer_id = v_cust
        AND r.status = 'completed' AND r.order_id IS NULL
        AND r.applied_receipt_id IS NULL
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'BAD_CREDIT: phiếu trả không đủ điều kiện cấn trừ'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  LOOP
    v_try := v_try + 1;
    v_code := 'PT-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD')
              || '-' || lpad(floor(1 + random() * 9999)::text, 4, '0');
    BEGIN
      INSERT INTO cash_receipts (
        org_id, receipt_code, receipt_date, source_type, status,
        submitted_amount, expected_amount,
        received_by, received_at, collected_by, created_by, notes
      ) VALUES (
        v_org, v_code, COALESCE((p->>'receipt_date')::date, current_date),
        'standalone', 'received',
        v_sum_line - v_sum_cred, v_sum_line - v_sum_cred,
        auth.uid(), now(), auth.uid(), auth.uid(), p->>'notes'
      )
      RETURNING id INTO v_receipt;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- Bảng phân bổ: mỗi khoản nợ đã chọn còn phải ghi bao nhiêu. Xếp hạn cũ
  -- nhất trước để khoản quá hạn được xoá sổ sớm nhất.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'receivable_id', x.id, 'order_id', x.order_id, 'left', x.amount)
           ORDER BY x.due_date NULLS LAST, x.id), '[]'::jsonb)
    INTO v_alloc
  FROM (
    SELECT r.id, r.order_id, r.due_date, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    JOIN receivables r ON r.id = (l->>'receivable_id')::uuid
    GROUP BY r.id, r.order_id, r.due_date
  ) x;

  -- Cấn trừ từng phiếu trả, ghi return_id lên đúng dòng: một phiếu thu
  -- cấn nhiều phiếu trả vẫn dựng lại được bút toán sau này.
  FOR c IN
    SELECT DISTINCT (c2->>'return_id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(p->'credits', '[]'::jsonb)) AS c2
  LOOP
    SELECT COALESCE(credit_note_amount, 0) INTO v_cred FROM returns WHERE id = c.id;
    i := 0;
    WHILE i < jsonb_array_length(v_alloc) AND v_cred > 0 LOOP
      v_item := v_alloc->i;
      v_left := (v_item->>'left')::numeric;
      IF v_left > 0 THEN
        v_apply := LEAST(v_left, v_cred);
        INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
        VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_apply, 'return_credit', now())
        RETURNING id INTO v_pay;
        INSERT INTO cash_receipt_lines (
          receipt_id, order_id, receivable_id, payment_id, amount, kind, return_id
        ) VALUES (
          v_receipt, NULLIF(v_item->>'order_id', '')::uuid,
          (v_item->>'receivable_id')::uuid, v_pay, v_apply, 'return_credit', c.id
        );
        v_alloc := jsonb_set(v_alloc, ARRAY[i::text, 'left'], to_jsonb(v_left - v_apply));
        v_cred := v_cred - v_apply;
      END IF;
      i := i + 1;
    END LOOP;

    UPDATE returns SET applied_receipt_id = v_receipt WHERE id = c.id;
  END LOOP;

  -- Phần còn lại là tiền khách trả thật.
  i := 0;
  WHILE i < jsonb_array_length(v_alloc) LOOP
    v_item := v_alloc->i;
    v_left := (v_item->>'left')::numeric;
    IF v_left > 0 THEN
      INSERT INTO payments (receivable_id, collected_by, amount, method, collected_at)
      VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_left, v_method, now())
      RETURNING id INTO v_pay;
      INSERT INTO cash_receipt_lines (
        receipt_id, order_id, receivable_id, payment_id, amount, kind
      ) VALUES (
        v_receipt, NULLIF(v_item->>'order_id', '')::uuid,
        (v_item->>'receivable_id')::uuid, v_pay, v_left, 'payment'
      );
    END IF;
    i := i + 1;
  END LOOP;

  -- Cộng đã thu theo đúng số người dùng chọn cho từng khoản.
  FOR rl IN
    SELECT (l->>'receivable_id')::uuid AS id, sum((l->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
    GROUP BY 1
  LOOP
    UPDATE receivables
    SET paid = COALESCE(paid, 0) + rl.amount,
        status = CASE WHEN COALESCE(paid, 0) + rl.amount >= COALESCE(amount, 0)
                      THEN 'paid' ELSE 'partial' END
    WHERE id = rl.id;
  END LOOP;

  RETURN v_receipt;
END;
$$;

-- Huỷ phiếu thu PHẢI trả công nợ về như cũ. Bản cũ ở giao diện chỉ đổi
-- trạng thái phiếu, để lại `paid` đã cộng — khách hiện ra đã trả tiền
-- trong khi phiếu thu đã huỷ.
CREATE OR REPLACE FUNCTION public.void_cash_receipt(p_receipt_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r   record;
  l   record;
BEGIN
  SELECT id, org_id, status INTO r
  FROM cash_receipts WHERE id = p_receipt_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF r.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'receivables.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ phiếu thu' USING ERRCODE = 'P0001';
  END IF;
  IF r.status NOT IN ('pending', 'received') THEN
    RAISE EXCEPTION 'RECEIPT_NOT_VOIDABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ phiếu thu' USING ERRCODE = 'P0001';
  END IF;

  FOR l IN
    SELECT id, receivable_id, payment_id, amount, kind, return_id
    FROM cash_receipt_lines WHERE receipt_id = p_receipt_id
  LOOP
    -- ⚠ Gỡ tham chiếu TRƯỚC khi xoá. cash_receipt_lines.payment_id là
    --   khoá ngoại NO ACTION, xoá payments trước là lỗi 23503 và cả lệnh
    --   huỷ phiếu thu rollback — công nợ không bao giờ được trả về.
    IF l.payment_id IS NOT NULL THEN
      UPDATE cash_receipt_lines SET payment_id = NULL WHERE id = l.id;
      DELETE FROM payments WHERE id = l.payment_id;
    END IF;
    IF l.receivable_id IS NOT NULL THEN
      UPDATE receivables
      SET paid = GREATEST(0, COALESCE(paid, 0) - l.amount),
          status = CASE
                     WHEN GREATEST(0, COALESCE(paid, 0) - l.amount) = 0
                       THEN CASE WHEN due_date IS NOT NULL AND due_date < current_date
                                 THEN 'overdue' ELSE 'open' END
                     ELSE 'partial'
                   END
      WHERE id = l.receivable_id;
    END IF;
  END LOOP;

  UPDATE returns SET applied_receipt_id = NULL WHERE applied_receipt_id = p_receipt_id;

  UPDATE cash_receipts
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_receipt_id;
END;
$$;


-- =====================================================================
-- 7. Quyền thực thi
-- =====================================================================
-- Helper là việc nội bộ của các RPC, không ai gọi thẳng.
REVOKE ALL ON FUNCTION public._wf2_notify(uuid, text, text, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_recompute_receivable(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_export_order(uuid, jsonb, text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_restock(uuid, numeric, text, uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public._wf2_assert_order_unlocked(uuid, date, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.complete_order(uuid)                                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_order(uuid, text)                                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_return(uuid, text)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_return(uuid, text)                                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_cash_receipt(jsonb)                               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_cash_receipt(uuid, text)                            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.complete_order(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_completed_order(uuid, jsonb, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_return(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_return(uuid, text)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_cash_receipt(jsonb)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_cash_receipt(uuid, text)                            TO authenticated;


NOTIFY pgrst, 'reload schema';


DO $$
BEGIN
  RAISE NOTICE '120: 5 helper + 7 RPC đã dựng; trigger nhập kho tự động của đơn trả đã gỡ.';
END $$;
