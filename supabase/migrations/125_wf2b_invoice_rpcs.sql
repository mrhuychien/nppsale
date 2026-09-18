-- ---------------------------------------------------------------------
-- 125 — Workflow v2b: các RPC của hóa đơn bán
--
-- Phần CẤU TRÚC nằm ở migration 124. File này dựng bộ thay thế cho
-- `complete_order` / `edit_completed_order` / `cancel_order` mà 124 đã gỡ.
-- ---------------------------------------------------------------------
--
-- ⚠ 124 VÀ 125 PHẢI CHẠY CÙNG NHAU. Giữa hai file, ứng dụng không có
--   đường nào để xuất hàng và `complete_return` / `cancel_return` sẽ lỗi
--   vì hàm chúng gọi đã bị gỡ. Đừng dừng lại ở 124.
--
-- ---------------------------------------------------------------------
-- BẢY VIỆC, MỖI VIỆC MỘT HÀM
-- ---------------------------------------------------------------------
--
--   get_invoiceable_lines(order)        — còn gì chưa xuất, và kho còn bao nhiêu
--   post_invoice(jsonb)                 — lập + ghi sổ hóa đơn: trừ kho, sinh nợ
--   cancel_invoice(invoice, reason)     — huỷ: hoàn kho về đúng lô, xoá nợ
--   reissue_invoice(invoice, jsonb)     — sửa = huỷ + lập lại, một giao dịch
--   close_order(order, reason)          — thôi không giao phần còn lại
--   cancel_order(order, reason)         — viết lại: chỉ còn đơn CHƯA xuất
--   _wf2b_recompute_receivable(invoice) — công nợ bám hóa đơn, không bám đơn
--
-- ---------------------------------------------------------------------
-- ⚠ VÌ SAO KHÔNG CÒN "SỬA": mọi thay đổi trên hàng đã rời kho đi qua
--   HUỶ rồi LẬP LẠI. `cancel_invoice` hoàn hàng về ĐÚNG các lô đã lấy
--   (dấu vết `stock_line_consumptions`, lô lấy sau trả trước), nên sau
--   một vòng huỷ-lập-lại tồn kho theo lô về đúng chỗ cũ. Cách tính delta
--   của v2 không làm được điều đó: nó chỉ biết chênh lệch tổng số.
-- ---------------------------------------------------------------------


-- =====================================================================
-- 0. Mở đúng những ô quyền các RPC dưới đây cần
-- =====================================================================
-- Y hệt lý do ở mig 120 mục 0c: `user_has_permission` trả FALSE khi
-- `role_permissions` chưa có dòng, không có ma trận mặc định phía CSDL.
-- Không seed thì sau khi chạy 125 mọi vai trò TRỪ chủ sở hữu đều bị từ
-- chối, trong khi giao diện vẫn hiện nút.
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, v.role, v.module, v.action, true
FROM organizations o
CROSS JOIN (VALUES
  ('manager', 'orders', 'approve'),
  ('manager', 'orders', 'update'),
  ('sales',   'orders', 'update')
) AS v(role, module, action)
ON CONFLICT (org_id, role, module, action) DO NOTHING;


-- =====================================================================
-- 1. Helper nội bộ
-- =====================================================================

-- 1.1 NETxx → số ngày. Mọi thứ khác (COD, rỗng, null) = 0 ngày.
--
-- ⚠ BẢN SAO CỦA `paymentTermsToDays` (src/lib/returns.ts). Hai nguồn sự
--   thật cho cùng một phép tính là chỗ lệch kinh điển, nên
--   `tests/wf2b-rpcs.test.ts` có một chốt so hai bản trên cùng bộ số.
--   Sửa một bên thì sửa cả hai.
CREATE OR REPLACE FUNCTION public._wf2b_payment_terms_days(p_terms text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)'))::int, 0);
$$;

COMMENT ON FUNCTION public._wf2b_payment_terms_days(text) IS
  'NETxx → số ngày nợ. Bản SQL của paymentTermsToDays trong '
  'src/lib/returns.ts — sửa một bên phải sửa cả hai.';


-- 1.2 Công nợ của MỘT HÓA ĐƠN.
--
-- ⚠ ĐỔI MỐC TỪ ĐƠN SANG HÓA ĐƠN. Bản v2 (`_wf2_recompute_receivable`)
--   gắn công nợ vào `sales_orders`. Một đơn xuất làm hai đợt thì bản đó
--   chỉ có một dòng nợ cho cả hai — khách nhận hàng đợt một đã nợ tiền
--   của cả đợt hai chưa giao. Nay mỗi hóa đơn một dòng nợ, và index
--   `idx_receivables_invoice_unique` (mig 124) giữ cho đúng một.
--
-- ⚠ KHÔNG đụng tới `paid`. Số đã thu là sự thật do phiếu thu ghi; tính
--   lại công nợ mà đè lên nó là xoá tiền khách đã trả.
--
-- ⚠ Q11 — `paid > amount` LÀ HỢP LỆ (chủ nhà chọn phương án (a) ở v2).
--   Khách trả hàng sau khi đã thanh toán đủ thì phần dư là SỐ DƯ CÓ, và
--   nhánh `v_paid >= v_net` đặt status 'paid' = "không còn gì để đòi".
--   Không thêm giá trị mới vào `receivables.status`: ràng buộc CHECK của
--   nó là ẩn danh từ mig 001 và mọi bộ lọc đều dùng `status <> 'paid'`.
CREATE OR REPLACE FUNCTION public._wf2b_recompute_receivable(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         record;
  v_credits numeric;
  v_net     numeric;
  v_id      uuid;
  v_paid    numeric;
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.customer_id, si.sales_user_id,
         si.total, si.payment_terms, si.invoice_date, si.status
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_credits
  FROM returns r
  WHERE r.invoice_id = p_invoice_id AND r.status = 'completed';

  v_net := GREATEST(0, COALESCE(v.total, 0) - v_credits);

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

  -- ⚠ Chỉ hóa đơn ĐÃ GHI SỔ mới sinh công nợ mới. Hóa đơn đã huỷ thì
  --   dòng nợ của nó đã bị `cancel_invoice` xoá; dựng lại ở đây là đòi
  --   tiền một chứng từ không còn hiệu lực.
  IF v_id IS NULL AND v.status <> 'posted' THEN
    RETURN NULL;
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

  -- ⚠ GHI CẢ `order_id` LẪN `invoice_id`. Dữ liệu cũ chỉ có `order_id`
  --   và mọi báo cáo lịch sử đọc theo cột đó; bỏ nó là đứt một nửa sổ.
  INSERT INTO receivables (
    org_id, order_id, invoice_id, customer_id, sales_user_id,
    amount, paid, due_date, status
  ) VALUES (
    v.org_id, v.order_id, v.id, v.customer_id, v.sales_user_id,
    v_net, 0,
    COALESCE(v.invoice_date, current_date)
      + public._wf2b_payment_terms_days(v.payment_terms),
    'open'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- 1.3 CẦU TẠM cho `complete_return` / `cancel_return`.
--
-- ⚠ VÌ SAO CÓ HÀM NÀY. Hai RPC đơn trả ở mig 120 gọi
--   `_wf2_recompute_receivable(r.order_id)` — chúng còn nói bằng ngôn ngữ
--   của ĐƠN. 124 đã gỡ hàm đó, nên không dựng lại là hai RPC kia lỗi
--   ngay. Dựng lại nguyên bản cũ thì công nợ lại bám đơn, phá đúng thứ
--   v2b vừa tách ra. Nên bản này là CẦU: nhận `order_id`, tính lại công
--   nợ cho từng hóa đơn đã ghi sổ của đơn đó. P6 nối thẳng hai RPC đơn
--   trả vào `_wf2b_recompute_receivable` rồi mới gỡ cầu.
--
-- ⚠ PHIẾU TRẢ CHƯA GẮN HÓA ĐƠN THÌ NHẬN NUÔI, KHÔNG BỎ QUA. Tiền giảm
--   trừ của một phiếu trả `invoice_id` rỗng không thuộc về hóa đơn nào,
--   nên `_wf2b_recompute_receivable` không thấy nó: khách trả hàng mà nợ
--   không giảm, và không dòng nào báo. Đơn có ĐÚNG MỘT hóa đơn đã ghi sổ
--   thì gắn vào đó — không phải đoán. Có từ hai trở lên thì DỪNG và bảo
--   người dùng chọn: đoán ở đây là ghi giảm nợ nhầm hóa đơn.
CREATE OR REPLACE FUNCTION public._wf2_recompute_receivable(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv    uuid;
  v_n      int;
  v_first  uuid;
  v_rec    uuid;
  v_orphan int;
BEGIN
  SELECT count(*) INTO v_n
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  SELECT count(*) INTO v_orphan
  FROM returns
  WHERE order_id = p_order_id AND invoice_id IS NULL AND status <> 'draft';

  IF v_orphan > 0 THEN
    IF v_n = 1 THEN
      SELECT id INTO v_inv
      FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';
      UPDATE returns SET invoice_id = v_inv
      WHERE order_id = p_order_id AND invoice_id IS NULL AND status <> 'draft';
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION
        'RETURN_NEEDS_INVOICE: đơn có % hóa đơn đã xuất — phiếu trả phải chỉ rõ trả theo hóa đơn nào',
        v_n USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_inv IN
    SELECT id FROM sales_invoices
    WHERE order_id = p_order_id AND status = 'posted'
    ORDER BY invoice_date, created_at
  LOOP
    v_rec := public._wf2b_recompute_receivable(v_inv);
    v_first := COALESCE(v_first, v_rec);
  END LOOP;

  RETURN v_first;
END;
$$;

COMMENT ON FUNCTION public._wf2_recompute_receivable(uuid) IS
  'CẦU TẠM: complete_return/cancel_return còn gọi theo order_id. Gỡ ở P6 '
  'khi hai RPC đó nối thẳng vào _wf2b_recompute_receivable.';


-- 1.4 Trạng thái đơn suy ra từ các hóa đơn con của nó.
--
-- ⚠ KHÔNG AI ĐẶT TRẠNG THÁI ĐƠN BẰNG TAY NỮA. Đơn kể lại câu chuyện của
--   các hóa đơn: chưa hóa đơn nào → 'submitted'; xuất đủ mọi dòng →
--   'completed'; giữa hai thứ đó → 'partially_invoiced'. Đặt tay là mở
--   đường cho một đơn hiện Hoàn thành mà chưa hóa đơn nào trừ kho.
--
-- ⚠ ĐƠN ĐANG 'closed' THÌ GIỮ NGUYÊN, trừ khi hóa đơn cuối bị huỷ. NPP
--   đã chốt thôi không giao phần còn lại; tự kéo nó về
--   'partially_invoiced' là xoá một quyết định của con người.
--
-- ⚠ SO SÁNH `>=`, KHÔNG PHẢI `=`. PATCH 1 cho NPP xuất nhiều hơn số đặt.
--   Dùng `=` thì đơn xuất dư mãi mãi kẹt ở 'partially_invoiced', và
--   không nút nào đưa nó ra được.
CREATE OR REPLACE FUNCTION public._wf2b_sync_order_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur  text;
  v_inv  int;
  v_open int;
  v_new  text;
BEGIN
  SELECT status INTO v_cur FROM sales_orders WHERE id = p_order_id;
  IF v_cur IS NULL OR v_cur IN ('draft', 'cancelled') THEN
    RETURN v_cur;
  END IF;

  SELECT count(*) INTO v_inv
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  SELECT count(*) INTO v_open
  FROM sales_order_lines
  WHERE order_id = p_order_id AND COALESCE(invoiced_qty, 0) < quantity;

  IF v_inv = 0 THEN
    v_new := 'submitted';
  ELSIF v_open = 0 THEN
    v_new := 'completed';
  ELSIF v_cur = 'closed' THEN
    v_new := 'closed';
  ELSE
    v_new := 'partially_invoiced';
  END IF;

  -- ⚠ RỜI KHỎI 'closed' THÌ XOÁ DẤU ĐÓNG ĐƠN. Đơn đã đóng mà hóa đơn bị
  --   huỷ thì nó quay về đang-chạy; để `closed_at` lại là đơn hiện đang
  --   mở nhưng mang ngày đóng, và mọi báo cáo đếm theo cột đó đều sai.
  --   (Nhánh này không bao giờ ĐẶT 'closed': hàm chỉ suy ra trạng thái
  --   từ hóa đơn, còn đóng đơn là quyết định của con người — close_order.)
  IF v_new IS DISTINCT FROM v_cur THEN
    PERFORM set_config('npp.via_rpc', 'on', true);
    UPDATE sales_orders
    SET status = v_new,
        completed_at = CASE WHEN v_new = 'completed' THEN now() ELSE NULL END,
        completed_by = CASE WHEN v_new = 'completed' THEN auth.uid() ELSE NULL END,
        closed_at    = NULL,
        closed_by    = NULL
    WHERE id = p_order_id;
  END IF;

  RETURN v_new;
END;
$$;


-- 1.5 Mã hóa đơn: HD-YYMMDD-NNNN, đếm trong phạm vi tổ chức + ngày.
--
-- ⚠ KHOÁ TRƯỚC KHI ĐẾM. Hai người bấm Xuất hàng cùng lúc thì cả hai đọc
--   ra cùng một số, một giao dịch vỡ vì unique index — không sai sổ,
--   nhưng người dùng thứ hai thấy lỗi lạ hoắc. Khoá theo (tổ chức, ngày)
--   cho họ xếp hàng, và khoá tự nhả khi giao dịch kết thúc.
CREATE OR REPLACE FUNCTION public._wf2b_next_invoice_code(p_org uuid, p_date date)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text || p_date::text));
  SELECT count(*) + 1 INTO v_n
  FROM sales_invoices
  WHERE org_id = p_org AND invoice_date = p_date;
  RETURN 'HD-' || to_char(p_date, 'YYMMDD') || '-' || lpad(v_n::text, 4, '0');
END;
$$;


-- =====================================================================
-- 2. get_invoiceable_lines — còn gì chưa xuất
-- =====================================================================
--
-- Nguồn của dialog Xuất hàng (P4). Trả về phần CÒN LẠI của từng dòng đơn,
-- cộng hàng đem đổi của phiếu trả kèm đơn.
--
-- ⚠ `available_base` LÀ THÔNG TIN, KHÔNG PHẢI VẤN ĐỀ. Nó để màn hình
--   nhuộm vàng dòng thiếu hàng, không để chặn: tổ chức cho bán âm thì
--   `post_stock_export` vẫn xuất và báo `short_qty`. Chặn ở đây là đặt
--   ra một luật thứ hai mâu thuẫn với cấu hình tổ chức.
--
-- ⚠ DÒNG ĐÃ XUẤT ĐỦ KHÔNG BỊ LOẠI KHỎI KẾT QUẢ, chỉ mang
--   `remaining_qty = 0`. Loại đi thì màn Xuất hàng đợt hai trông như đơn
--   bị mất dòng, và không cách nào biết dòng đó đã xuất rồi hay chưa
--   từng có.
DROP FUNCTION IF EXISTS public.get_invoiceable_lines(uuid);
CREATE FUNCTION public.get_invoiceable_lines(p_order_id uuid)
RETURNS TABLE (
  order_line_id     uuid,
  return_line_id    uuid,
  product_id        uuid,
  product_name      text,
  sku               text,
  unit_name         text,
  conversion_factor numeric,
  ordered_qty       numeric,
  invoiced_qty      numeric,
  remaining_qty     numeric,
  unit_price        numeric,
  list_price        numeric,
  line_discount     numeric,
  vat_rate          numeric,
  available_base    numeric,
  is_exchange       boolean,
  note              text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales_orders WHERE id = p_order_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    sol.id, NULL::uuid, sol.product_id, p.name, p.sku, sol.unit_name,
    COALESCE(sol.conversion_factor, 1),
    sol.quantity, COALESCE(sol.invoiced_qty, 0),
    GREATEST(0, sol.quantity - COALESCE(sol.invoiced_qty, 0)),
    sol.unit_price, COALESCE(p.sell_price, 0), COALESCE(sol.line_discount, 0),
    COALESCE(p.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = sol.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    false, sol.note
  FROM sales_order_lines sol
  LEFT JOIN products p ON p.id = sol.product_id
  WHERE sol.order_id = p_order_id

  UNION ALL

  -- Hàng đem đổi của phiếu trả kèm đơn: nó cũng rời kho trong chuyến này,
  -- nhưng không thuộc dòng đơn nào nên `order_line_id` để rỗng.
  SELECT
    NULL::uuid, rl.id, rl.product_id, p2.name, p2.sku, rl.unit_name,
    COALESCE((SELECT pu.conversion FROM product_units pu
               WHERE pu.product_id = rl.product_id
                 AND pu.unit_name = rl.unit_name), 1),
    rl.quantity, 0::numeric, rl.quantity,
    0::numeric, COALESCE(p2.sell_price, 0), 0::numeric,
    COALESCE(p2.vat_rate, 0),
    COALESCE((SELECT sum(b.qty_on_hand) FROM batches b
               WHERE b.product_id = rl.product_id
                 AND b.org_id = v_org
                 AND b.warehouse_zone = 'sale'), 0)::numeric,
    true, '[Exchange]'::text
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products p2 ON p2.id = rl.product_id
  WHERE r.order_id = p_order_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = true;
END;
$$;


-- =====================================================================
-- 3. post_invoice — lập và ghi sổ hóa đơn
-- =====================================================================
--
-- p: { order_id, invoice_date?, payment_terms?, notes?,
--      lines: [ { order_line_id?, return_line_id?, product_id, unit_name,
--                 conversion_factor, quantity, unit_price,
--                 line_discount?, is_exchange?, note? } ] }
--
-- ⚠ MỘT GIAO DỊCH: phiếu xuất + trừ kho FIFO + hóa đơn + dòng hóa đơn +
--   công nợ + trạng thái đơn. Hỏng bất cứ đâu thì không còn dấu vết nào.
--
-- ⚠ LÀM TRÒN Ở TỔNG, KHÔNG Ở DÒNG. `cartTotals` (src/lib/sell/cart.ts)
--   cộng hết rồi mới `Math.round`, và `grandTotal` làm tròn tổng
--   `subtotal + vat` CHƯA làm tròn — không phải `round(subtotal) +
--   round(vat)`. Port sai chỗ làm tròn là lệch vài đồng mỗi hóa đơn, và
--   lệch theo kiểu không ai lần ra được.
--
-- ⚠ VAT TÍNH TRÊN GIÁ ĐANG ÁP, không trên giá bảng — tính trên giá bảng
--   là bắt khách trả thuế cho phần đã được giảm.
--
-- ⚠ THUẾ SUẤT SNAPSHOT TẠI ĐÂY (`products.vat_rate` lúc ghi sổ).
--   `sales_order_lines` không có cột thuế suất. Hệ quả: đổi thuế suất
--   sản phẩm rồi xuất đợt hai của cùng một đơn thì hai hóa đơn mang thuế
--   suất khác nhau — đúng về kế toán, nhưng cần biết trước.
--
-- ⚠ KHÔNG CHẶN SỐ LƯỢNG VƯỢT SỐ ĐẶT (PATCH 1: NPP toàn quyền ở màn Xuất
--   hàng). Đơn đặt 10 mà xuất 12 là hợp lệ, và `_wf2b_sync_order_status`
--   so `>=` nên đơn vẫn về được 'completed'.
--
-- ⚠ `line_total` = số lượng × ĐƠN GIÁ, KHÔNG trừ `line_discount` lần nữa.
--   Đây là chỗ hai quy ước trong kho mã đang ĐÁ NHAU, đã báo chủ nhà:
--     · `src/lib/sell/create-order.ts:52-53` — nơi GHI dữ liệu:
--       `unit_price` = giá đang áp, `line_discount` = qty × (giá bảng −
--       giá đang áp) và chỉ để ghi nhớ; `line_total = round(qty × giá)`.
--     · `src/app/(dashboard)/orders/[id]/page.tsx:620,700` — nơi ĐỌC:
--       `max(0, qty × unit_price − line_discount)`, tức trừ chiết khấu
--       thêm một lần nữa.
--   Với dòng bán đúng giá bảng (`line_discount = 0`) hai bên bằng nhau,
--   nên không ai phát hiện; dòng có giảm giá thì lệch đúng bằng phần
--   giảm. Bản ghi thắng: hàm này theo quy ước của `create-order.ts` và
--   của `cartTotals`. P4 phải gửi `line_discount` theo nghĩa GHI NHỚ.
CREATE OR REPLACE FUNCTION public.post_invoice(p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o           record;
  v_order     uuid;
  v_date      date;
  v_terms     text;
  v_lines     jsonb;
  v_n         int;
  v_sub_raw   numeric := 0;
  v_vat_raw   numeric := 0;
  v_inv       uuid;
  v_code      text;
  v_exp       record;
  v_rec       uuid;
  v_status    text;
BEGIN
  v_order := (p->>'order_id')::uuid;
  v_lines := COALESCE(p->'lines', '[]'::jsonb);

  SELECT so.id, so.org_id, so.order_code, so.status, so.customer_id,
         so.sales_user_id, so.payment_terms, so.order_date
    INTO o
  FROM sales_orders so WHERE so.id = v_order FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền xuất hàng' USING ERRCODE = 'P0001';
  END IF;
  IF o.status NOT IN ('submitted', 'partially_invoiced') THEN
    RAISE EXCEPTION
      'ORDER_NOT_INVOICEABLE: đơn % đang ở trạng thái %, không xuất hàng được',
      o.order_code, o.status USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ HÓA ĐƠN RỖNG LÀ MỘT CHỨNG TỪ KHÔNG CÓ THẬT. Không chặn thì nó vẫn
  --   sinh số, vẫn đẩy đơn sang 'completed' (không dòng nào còn thiếu vì
  --   không có dòng nào), và vẫn in ra được.
  SELECT count(*) INTO v_n
  FROM jsonb_array_elements(v_lines) AS l
  WHERE COALESCE((l->>'quantity')::numeric, 0) > 0;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0'
      USING ERRCODE = 'P0001';
  END IF;

  v_date  := COALESCE((p->>'invoice_date')::date, current_date);
  v_terms := COALESCE(NULLIF(p->>'payment_terms', ''), o.payment_terms);

  PERFORM set_config('npp.via_rpc', 'on', true);

  -- Phiếu xuất + trừ kho FIFO. RAISE của `post_stock_export`
  -- (INSUFFICIENT_STOCK khi tổ chức không cho bán âm) rollback cả giao
  -- dịch — hóa đơn chưa kịp sinh ra, đúng như mong muốn.
  SELECT * INTO v_exp
  FROM public._wf2_export_order(v_order, v_lines, 'Xuất theo đơn ' || o.order_code);

  v_code := public._wf2b_next_invoice_code(o.org_id, v_date);

  INSERT INTO sales_invoices (
    org_id, invoice_code, order_id, customer_id, sales_user_id,
    invoice_date, status, subtotal, vat, total, payment_terms, due_date,
    stock_entry_id, notes, posted_at, posted_by
  ) VALUES (
    o.org_id, v_code, v_order, o.customer_id, o.sales_user_id,
    v_date, 'posted', 0, 0, 0, v_terms,
    v_date + public._wf2b_payment_terms_days(v_terms),
    v_exp.entry_id, NULLIF(p->>'notes', ''), now(), auth.uid()
  )
  RETURNING id INTO v_inv;

  INSERT INTO sales_invoice_lines (
    invoice_id, order_line_id, product_id, unit_name, conversion_factor,
    quantity, unit_price, line_discount, line_total, vat_rate,
    is_exchange, sort_order, note
  )
  SELECT
    v_inv,
    NULLIF(l->>'order_line_id', '')::uuid,
    (l->>'product_id')::uuid,
    l->>'unit_name',
    COALESCE((l->>'conversion_factor')::numeric, 1),
    (l->>'quantity')::numeric,
    COALESCE((l->>'unit_price')::numeric, 0),
    COALESCE((l->>'line_discount')::numeric, 0),
    (l->>'quantity')::numeric * COALESCE((l->>'unit_price')::numeric, 0),
    COALESCE(pr.vat_rate, 0),
    COALESCE((l->>'is_exchange')::boolean, false),
    (ord.i)::int,
    NULLIF(l->>'note', '')
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS ord(l, i)
  LEFT JOIN products pr ON pr.id = (ord.l->>'product_id')::uuid
  WHERE COALESCE((ord.l->>'quantity')::numeric, 0) > 0;

  -- ⚠ CỘNG TRÊN CỘT numeric CỦA BẢNG, không cộng lại từ jsonb: thuế suất
  --   đã snapshot ở trên, và đọc lại `products` lần nữa là mở đường cho
  --   hai con số khác nhau trong cùng một giao dịch.
  SELECT
    COALESCE(sum(sil.line_total), 0),
    COALESCE(sum(sil.line_total * COALESCE(sil.vat_rate, 0)), 0)
  INTO v_sub_raw, v_vat_raw
  FROM sales_invoice_lines sil
  WHERE sil.invoice_id = v_inv;

  UPDATE sales_invoices
  SET subtotal = round(v_sub_raw),
      vat      = round(v_vat_raw),
      total    = GREATEST(0, round(v_sub_raw + v_vat_raw))
  WHERE id = v_inv;

  v_rec := public._wf2b_recompute_receivable(v_inv);

  -- Phiếu trả kèm đơn đang nháp: hàng đã xuất thì phiếu trả thành phiếu
  -- tạm để NPP xử lý tiếp, và từ nay nó trả theo HÓA ĐƠN này.
  -- ⚠ KHÔNG dùng RETURNING … INTO: một đơn có thể có vài phiếu trả nháp,
  --   và DML trả nhiều hơn một dòng là lỗi 21000.
  UPDATE returns SET status = 'submitted', invoice_id = v_inv
  WHERE order_id = v_order AND status = 'draft';

  v_status := public._wf2b_sync_order_status(v_order);

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, v_order, 'invoice_posted', v_status,
          jsonb_build_object('invoice_id', v_inv, 'invoice_code', v_code,
                             'entry_id', v_exp.entry_id), auth.uid());

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_completed',
    'Đơn ' || o.order_code || ' đã xuất hóa đơn ' || v_code, NULL,
    '/sales-invoices/' || v_inv::text);

  RETURN QUERY SELECT v_inv, v_code, v_exp.entry_id, v_rec,
                      v_exp.short_qty, v_exp.near_expiry_skipped, v_status;
END;
$$;


-- =====================================================================
-- 4. cancel_invoice — huỷ hóa đơn, hoàn kho về đúng lô
-- =====================================================================
--
-- ⚠ HOÀN VỀ ĐÚNG LÔ ĐÃ LẤY, THỨ TỰ NGƯỢC. `_wf2_restock` (mig 120) đi
--   theo dấu vết `stock_line_consumptions` và trừ dần dấu vết đó, nên
--   huỷ hai lần không hoàn hai lần. Hoàn "về lô mới nhất" cho nhanh thì
--   hạn dùng trong kho sai ngay từ lần huỷ đầu tiên.
--
-- ⚠ BỐN KHOÁ, ba trong số đó bê nguyên từ `_wf2_assert_order_unlocked`
--   của v2 nhưng đổi mốc từ ĐƠN sang HÓA ĐƠN: có tiền thu, đã phát hành
--   hóa đơn điện tử, có phiếu trả đã hoàn thành. Khoá thứ tư là trạng
--   thái: chỉ hóa đơn 'posted' mới huỷ được.
CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id uuid, p_reason text)
RETURNS TABLE (import_entry_id uuid, order_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v        record;
  o        record;
  v_imp    uuid;
  d        record;
  s        record;
  v_need   numeric;
  v_take   numeric;
  v_status text;
BEGIN
  SELECT si.id, si.org_id, si.invoice_code, si.status, si.order_id,
         si.stock_entry_id, si.sales_user_id
    INTO v
  FROM sales_invoices si WHERE si.id = p_invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ hóa đơn' USING ERRCODE = 'P0001';
  END IF;
  IF v.status <> 'posted' THEN
    RAISE EXCEPTION 'INVOICE_NOT_POSTED: hóa đơn % đang ở trạng thái %',
      v.invoice_code, v.status USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: phải ghi lý do huỷ hóa đơn'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT so.id, so.org_id, so.order_code, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = v.order_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM receivables r
    WHERE r.invoice_id = p_invoice_id AND COALESCE(r.paid, 0) > 0
  ) OR EXISTS (
    -- ⚠ NHÁNH THỨ HAI LÀ CHO PHIẾU THU CŨ. `create_cash_receipt` (mig
    --   120) còn ghi `order_id`, chưa ghi `invoice_id` — P6 mới đổi. Chỉ
    --   so theo `invoice_id` thì một hóa đơn đã thu tiền bằng phiếu cũ
    --   vẫn huỷ được, và tiền khách đã trả treo vào một chứng từ không
    --   còn. Thà chặn rộng: dòng phiếu thu chưa gắn hóa đơn mà trỏ đúng
    --   đơn này thì coi như đã thu.
    SELECT 1 FROM cash_receipt_lines crl
    JOIN cash_receipts cr ON cr.id = crl.receipt_id
    WHERE cr.status <> 'voided'
      AND (crl.invoice_id = p_invoice_id
           OR (crl.invoice_id IS NULL AND crl.order_id = v.order_id))
  ) THEN
    RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu, huỷ phiếu thu trước'
      USING ERRCODE = 'P0001';
  END IF;

  -- "Đã phát hành" = hóa đơn nội bộ đã chốt, hoặc MISA đã cấp số / đã ký.
  -- Điều kiện y nguyên mig 120, chỉ đổi cột nối.
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.sales_invoice_id = p_invoice_id
      AND (i.status = 'issued'
           OR i.misa_inv_no IS NOT NULL
           OR i.misa_status IN ('signed', 'replaced'))
  ) THEN
    RAISE EXCEPTION 'LOCKED_EINVOICE: hóa đơn đã phát hành hóa đơn điện tử'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM returns r
    WHERE r.invoice_id = p_invoice_id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'LOCKED_RETURN_DONE: hóa đơn đã có phiếu trả hoàn thành'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, notes)
  VALUES (v.org_id,
          'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
          'import', 'posted', now(), auth.uid(),
          'Hoàn kho do huỷ hóa đơn ' || v.invoice_code)
  RETURNING id INTO v_imp;

  -- ⚠ HOÀN THEO DÒNG HÓA ĐƠN NÀY, KHÔNG THEO DÒNG ĐƠN. Một đơn nay có
  --   thể có nhiều hóa đơn; hoàn theo dòng đơn là trả về kho cả hàng của
  --   hóa đơn khác vẫn đang có hiệu lực.
  --
  -- ⚠ ƯU TIÊN PHIẾU XUẤT CỦA CHÍNH HÓA ĐƠN NÀY (`stock_entry_id`). Hóa
  --   đơn backfill không có phiếu xuất thì rơi về phiếu xuất của đơn —
  --   và hóa đơn backfill mà `stock_entry_id` rỗng nghĩa là tồn kho chưa
  --   từng bị trừ, nên không có gì để hoàn, vòng lặp chạy rỗng.
  FOR d IN
    SELECT sil.product_id, sil.unit_name,
           sum(sil.quantity * COALESCE(sil.conversion_factor, 1)) AS qty
    FROM sales_invoice_lines sil
    WHERE sil.invoice_id = p_invoice_id
    GROUP BY sil.product_id, sil.unit_name
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
        AND (se.id = v.stock_entry_id
             OR (v.stock_entry_id IS NULL
                 AND se.ref_order_ids @> jsonb_build_array(v.order_id::text)))
        AND sel.product_id = d.product_id
        AND sel.unit_name = d.unit_name
      ORDER BY se.posted_at DESC, sel.id DESC
    LOOP
      EXIT WHEN v_need <= 0;
      CONTINUE WHEN COALESCE(s.qty_left, 0) <= 0;
      v_take := LEAST(s.qty_left, v_need);
      PERFORM public._wf2_restock(s.id, v_take,
        'Hoàn kho do huỷ hóa đơn ' || v.invoice_code, v_imp);
      v_need := v_need - v_take;
    END LOOP;
  END LOOP;

  -- ⚠ Phiếu thu ĐÃ HUỶ vẫn để lại dòng trỏ vào công nợ (void chỉ đổi
  --   trạng thái phiếu). Không gỡ trước thì DELETE dưới đây nổ 23503 và
  --   phần hoàn kho vừa làm cũng rollback.
  UPDATE cash_receipt_lines crl
  SET receivable_id = NULL, payment_id = NULL
  FROM receivables r
  WHERE crl.receivable_id = r.id AND r.invoice_id = p_invoice_id;

  DELETE FROM receivables WHERE invoice_id = p_invoice_id;

  -- Phiếu trả đang chờ xử lý của hóa đơn này mất chỗ bám. Huỷ luôn và
  -- ghi lý do — để lại là một phiếu trả trỏ vào chứng từ đã huỷ.
  UPDATE returns
  SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Hóa đơn ' || v.invoice_code || ' bị huỷ'
  WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE sales_invoices
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_invoice_id;

  v_status := public._wf2b_sync_order_status(v.order_id);

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (v.org_id, v.order_id, 'invoice_cancelled', v_status,
          jsonb_build_object('invoice_id', p_invoice_id,
                             'invoice_code', v.invoice_code,
                             'import_entry_id', v_imp,
                             'reason', p_reason), auth.uid());

  PERFORM public._wf2_notify(
    COALESCE(v.sales_user_id, o.sales_user_id), 'invoice_cancelled',
    'Hóa đơn ' || v.invoice_code || ' đã bị huỷ', p_reason,
    '/orders/' || v.order_id::text);

  RETURN QUERY SELECT v_imp, v_status;
END;
$$;


-- =====================================================================
-- 5. reissue_invoice — sửa hóa đơn (kỹ thuật: huỷ + lập lại)
-- =====================================================================
--
-- ⚠ VỀ MẶT NGHIỆP VỤ ĐÂY LÀ "SỬA" (PATCH 1: NPP sửa hóa đơn thoải mái).
--   Về mặt kỹ thuật không có sửa: huỷ bản cũ, lập bản mới, trong MỘT
--   giao dịch. Kho quay về đúng lô cũ rồi mới trừ lại theo số mới, nên
--   không có phép trừ delta nào để sai.
--
-- ⚠ `replaced_from` / `replaced_by` NỐI HAI BẢN. Không nối thì bản cũ
--   nằm đó như một hóa đơn bị huỷ không rõ vì sao, và người tra sổ sáu
--   tháng sau không có đường nào đi từ nó sang bản đang có hiệu lực.
--
-- ⚠ Q4 — CHẶN SỚM Ở CHỖ NGƯỜI DÙNG ĐANG ĐỨNG. Phiếu trả đang chờ xử lý
--   của hóa đơn cũ được chuyển sang hóa đơn mới. Nhưng hóa đơn mới có
--   thể đã bỏ mất chính món đang được trả — khi đó phiếu trả trỏ vào một
--   hóa đơn không hề bán món đó, và người dùng vấp lỗi ở màn Đơn trả,
--   một chỗ chẳng liên quan gì tới việc họ vừa làm. Nên kiểm ngay tại
--   đây và nêu tên hàng.
CREATE OR REPLACE FUNCTION public.reissue_invoice(p_invoice_id uuid, p jsonb)
RETURNS TABLE (
  invoice_id uuid, invoice_code text, entry_id uuid, receivable_id uuid,
  short_qty numeric, near_expiry_skipped int, order_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     record;
  v_new     record;
  v_missing text;
  v_payload jsonb;
  v_rets    uuid[];
BEGIN
  SELECT si.id, si.org_id, si.order_id, si.invoice_code, si.status INTO v_old
  FROM sales_invoices si WHERE si.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Kiểm TRƯỚC KHI huỷ. Kiểm sau thì giao dịch có rollback thật,
  --   nhưng người dùng đã thấy "đang huỷ hóa đơn…" rồi mới nhận lỗi —
  --   và không cách nào biết hóa đơn cũ còn hay mất.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_missing
  FROM return_lines rl
  JOIN returns r ON r.id = rl.return_id
  LEFT JOIN products pr ON pr.id = rl.product_id
  WHERE r.invoice_id = p_invoice_id
    AND r.status IN ('draft', 'submitted')
    AND rl.is_exchange = false
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p->'lines', '[]'::jsonb)) AS l
      WHERE (l->>'product_id')::uuid = rl.product_id
        AND COALESCE((l->>'quantity')::numeric, 0) > 0
        AND COALESCE((l->>'is_exchange')::boolean, false) = false
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán "%" mà phiếu trả đang chờ xử lý đòi trả. Huỷ phiếu trả trước, rồi sửa lại hóa đơn.',
      v_missing USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ Phiếu trả đang chờ được gỡ khỏi hóa đơn cũ TRƯỚC khi huỷ, nếu
  --   không `cancel_invoice` sẽ huỷ luôn chúng (PATCH 1 nói rõ: chuyển
  --   sang hóa đơn mới, KHÔNG huỷ). Tạm để `invoice_id` rỗng trong vài
  --   dòng lệnh, rồi nối lại ngay dưới.
  --
  -- ⚠ GHI NHỚ ĐÍCH DANH TỪNG PHIẾU. Nối lại bằng điều kiện
  --   "cùng đơn và `invoice_id` rỗng" sẽ vơ luôn những phiếu trả vốn dĩ
  --   đã rỗng từ trước — phiếu trả độc lập của đơn này bỗng dưng bị gắn
  --   vào một hóa đơn nó không liên quan.
  SELECT COALESCE(array_agg(id), '{}') INTO v_rets
  FROM returns
  WHERE invoice_id = p_invoice_id AND status IN ('draft', 'submitted');

  UPDATE returns SET invoice_id = NULL WHERE id = ANY(v_rets);

  PERFORM public.cancel_invoice(
    p_invoice_id, 'Lập lại hóa đơn ' || v_old.invoice_code);

  v_payload := jsonb_set(COALESCE(p, '{}'::jsonb), '{order_id}',
                         to_jsonb(v_old.order_id::text));

  SELECT * INTO v_new FROM public.post_invoice(v_payload);

  UPDATE sales_invoices SET replaced_by   = v_new.invoice_id WHERE id = p_invoice_id;
  UPDATE sales_invoices SET replaced_from = p_invoice_id     WHERE id = v_new.invoice_id;

  UPDATE returns SET invoice_id = v_new.invoice_id WHERE id = ANY(v_rets);

  RETURN QUERY SELECT v_new.invoice_id, v_new.invoice_code, v_new.entry_id,
                      v_new.receivable_id, v_new.short_qty,
                      v_new.near_expiry_skipped, v_new.order_status;
END;
$$;


-- =====================================================================
-- 6. close_order — thôi không giao phần còn lại
-- =====================================================================
--
-- ⚠ KHÁC 'completed'. `completed` = đã xuất ĐỦ mọi dòng; `closed` = NPP
--   chốt không giao nốt. Gộp hai thứ vào một trạng thái là mất luôn câu
--   trả lời cho "đơn này có giao thiếu không" — thứ duy nhất cho biết
--   nên gọi lại khách hay không.
--
-- ⚠ CHỈ ĐÓNG ĐƯỢC ĐƠN ĐÃ XUẤT MỘT PHẦN. Đơn chưa xuất gì mà đóng thì
--   đúng ra là HUỶ, và huỷ có đường riêng. Ràng buộc chuyển trạng thái
--   ở mig 124 cũng chỉ cho `partially_invoiced → closed`.
CREATE OR REPLACE FUNCTION public.close_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT so.id, so.org_id, so.order_code, so.status, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.user_has_permission(auth.uid(), 'orders.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền đóng đơn' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'closed' THEN RETURN; END IF;
  IF o.status <> 'partially_invoiced' THEN
    RAISE EXCEPTION
      'ORDER_NOT_PARTIAL: chỉ đóng được đơn đã xuất một phần (đơn % đang %)',
      o.order_code, o.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('npp.via_rpc', 'on', true);

  UPDATE sales_orders
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
      notes = COALESCE(notes || E'\n', '') || 'Đóng đơn: ' || COALESCE(p_reason, '')
  WHERE id = p_order_id;

  -- Phiếu trả kèm đơn còn nháp không còn chuyến nào để đi cùng.
  UPDATE returns SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Đơn ' || o.order_code || ' đã đóng'
  WHERE order_id = p_order_id AND status = 'draft';

  INSERT INTO order_activity_log (org_id, order_id, action, workflow_stage, changes, actor_id)
  VALUES (o.org_id, p_order_id, 'order_closed', 'closed',
          jsonb_build_object('reason', p_reason), auth.uid());

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã đóng, không giao phần còn lại', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 7. cancel_order — viết lại: chỉ còn đơn CHƯA xuất
-- =====================================================================
--
-- ⚠ NỬA SAU CỦA HÀM CŨ BIẾN MẤT, CÓ CHỦ Ý. Bản v2 huỷ được cả đơn đã
--   xuất: nó tự hoàn kho, tự xoá công nợ. Nay hàng đã rời kho thuộc về
--   một HÓA ĐƠN, và chỉ `cancel_invoice` mới biết hoàn về đúng lô nào.
--   Để `cancel_order` tự hoàn là có hai đường cùng đụng tồn kho cho cùng
--   một lô hàng — hai đường thì sớm muộn chúng lệch nhau.
--
-- ⚠ VÌ THẾ ĐÂY LÀ MỘT LỜI CHỈ ĐƯỜNG, KHÔNG PHẢI MỘT LỜI TỪ CHỐI. Thông
--   báo nêu rõ còn mấy hóa đơn phải huỷ trước.
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o     record;
  v_inv int;
BEGIN
  SELECT so.id, so.org_id, so.order_code, so.status, so.sales_user_id INTO o
  FROM sales_orders so WHERE so.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF o.org_id <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF o.status = 'cancelled' THEN RETURN; END IF;

  SELECT count(*) INTO v_inv
  FROM sales_invoices WHERE order_id = p_order_id AND status = 'posted';

  IF v_inv > 0 OR o.status IN ('partially_invoiced', 'completed', 'closed') THEN
    RAISE EXCEPTION
      'HAS_INVOICE: đơn % đã xuất % hóa đơn. Huỷ hết hóa đơn trước, rồi mới huỷ đơn.',
      o.order_code, v_inv USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), 'orders.update') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền huỷ đơn' USING ERRCODE = 'P0001';
  END IF;
  IF public.user_role() = 'sales' AND o.sales_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER: chỉ huỷ được đơn của mình'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE sales_orders
  SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  WHERE id = p_order_id;

  UPDATE returns SET status = 'cancelled', cancelled_at = now(),
      cancel_reason = 'Đơn ' || o.order_code || ' đã huỷ'
  WHERE order_id = p_order_id AND status = 'draft';

  PERFORM public._wf2_notify(
    o.sales_user_id, 'order_cancelled',
    'Đơn ' || o.order_code || ' đã bị huỷ', p_reason,
    '/orders/' || p_order_id::text);
END;
$$;


-- =====================================================================
-- 8. Quyền thực thi
-- =====================================================================
--
-- ⚠ HELPER KHÔNG CẤP QUYỀN GỌI. `_wf2b_recompute_receivable` viết thẳng
--   vào công nợ mà không kiểm quyền — nó tin hàm gọi nó đã kiểm. Cấp
--   `authenticated` là cho bất cứ ai gọi thẳng qua PostgREST và đặt lại
--   số nợ của khách.
REVOKE EXECUTE ON FUNCTION public._wf2b_recompute_receivable(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2_recompute_receivable(uuid)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2b_sync_order_status(uuid)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._wf2b_next_invoice_code(uuid, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._wf2b_payment_terms_days(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invoiceable_lines(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_invoice(jsonb)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_order(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text)        TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_fn int; v_rec int; v_orphan int;
BEGIN
  SELECT count(*) INTO v_fn
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.proname IN ('get_invoiceable_lines', 'post_invoice', 'cancel_invoice',
                       'reissue_invoice', 'close_order', 'cancel_order',
                       '_wf2b_recompute_receivable');

  SELECT count(*) INTO v_rec FROM receivables WHERE invoice_id IS NOT NULL;
  SELECT count(*) INTO v_orphan
  FROM returns WHERE invoice_id IS NULL AND status NOT IN ('draft', 'cancelled');

  RAISE NOTICE '--- 125: %/7 RPC đã dựng · % dòng công nợ gắn hóa đơn ---', v_fn, v_rec;
  IF v_orphan > 0 THEN
    RAISE NOTICE '--- 125 ⚠ % phiếu trả chưa gắn hóa đơn nào. Chúng sẽ được nhận nuôi khi tính lại công nợ, hoặc dừng lại nếu đơn có nhiều hóa đơn. ---', v_orphan;
  END IF;
END $$;
