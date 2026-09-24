-- ====================================================================
-- HÓA ĐƠN VÀ PHIẾU TRẢ BÊ ĐỦ CÁC TRƯỜNG TỪ ĐƠN — KHÔNG ĐỂ SÓT
--
-- Chủ nhà báo 24/09/2026: "Khi Xuất hàng từ Đơn hàng / Sửa hóa đơn -> Mất
-- ghi chú cho từng dòng · Bê nguyên các trường từ Đơn hàng sang Hóa đơn, ko
-- được để sót · Tương tự với phần Trả hàng: các trường từ đơn hàng cũng phải
-- đủ ko được bớt đi".
--
-- Rà từng cột thì có BỐN chỗ rơi, ngoài ghi chú dòng (phần ấy là giao diện):
--
--   1. THUẾ THEO DÒNG CỦA ĐƠN KHÔNG ĐƯỢC LƯU. Màn đơn POS có chip VAT từng
--      dòng, nhưng `sales_order_lines` không có cột `vat_rate` — chỉ tổng
--      thuế vào `sales_orders.vat`. Mở lại đơn hay xuất hóa đơn là thuế của
--      danh mục mặt hàng, không phải thuế đã chọn. → thêm cột, ghi ở
--      `create_order_with_lines`, đọc ở `get_invoiceable_lines`.
--
--   2. `post_invoice` BỎ QUA THUẾ MÀN GỬI LÊN — lấy `products.vat_rate`. Ô
--      "Thuế GTGT" của màn xuất hàng là một lời hứa suông. → nhận thuế của
--      tải trọng nếu là tỉ lệ hợp lệ (0 ≤ x ≤ 1), không thì như cũ.
--
--   3. GIẢM GIÁ CẢ ĐƠN KHÔNG SANG HÓA ĐƠN. Đơn ghi `subtotal` SAU giảm giá
--      đơn; hóa đơn cộng lại từ dòng nên khách bị ghi nợ cao hơn đơn đúng
--      bằng khoản giảm. → `post_invoice` nhận `discount` (số tiền), kẹp
--      trong [0, tiền hàng], và ghi `subtotal` SAU giảm — CÙNG nghĩa cột với
--      `sales_orders.subtotal` (sau chiết khấu, trước thuế). Giảm = Σ dòng −
--      subtotal, đọc lại được mà không cần thêm cột. Thuế tính trên giá dòng
--      trước giảm đơn — y như đơn (xem order-screen, "VAT TÍNH TRÊN GIÁ DÒNG").
--
--   4. LÝ DO TỪNG DÒNG TRẢ (`return_lines.reason`, mig 159) rơi khi thêm hàng
--      trả ở màn hóa đơn (`_apply_return_adds` không chèn cột ấy), và ghi
--      chú / lý do dòng trả không sửa được ở màn hóa đơn. → nhận cả hai.
--
-- ⚠ ĐƠN CŨ: `vat_rate` để NULL = "chưa biết" → rơi về thuế của mặt hàng,
--   đúng như hành vi trước nay. Không điền ngược: tổng thuế đã lưu của đơn
--   cũ không chia ngược về dòng được một cách chắc chắn.
--
-- ⚠ VÁ CHUỖI BẢN ĐANG CHẠY cho `create_order_with_lines`, `post_invoice`,
--   `_apply_return_edits` (thân nằm ở nhiều migration) — khớp bằng biểu thức
--   dung sai khoảng trắng, bài học mig 182. `get_invoiceable_lines` và
--   `_apply_return_adds` chỉ có thân ở MỘT migration (125, 152) → dựng lại.
-- ====================================================================

-- 1. Cột thuế theo dòng của đơn.
ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS vat_rate numeric;
ALTER TABLE public.sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_vat_rate_check;
ALTER TABLE public.sales_order_lines
  ADD CONSTRAINT sales_order_lines_vat_rate_check CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 1));
COMMENT ON COLUMN public.sales_order_lines.vat_rate IS
  'Thuế suất của dòng (tỉ lệ 0..1) người bán đã chọn. NULL = đơn cũ, dùng thuế của mặt hàng. Mig 183.';

-- Tỉ lệ thuế hợp lệ từ jsonb, không thì NULL — một chỗ, dùng chung.
CREATE OR REPLACE FUNCTION public._thue_hop_le(v text)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN v ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND v::numeric BETWEEN 0 AND 1
              THEN round(v::numeric, 4) END
$fn$;

-- Giảm giá cả đơn của một lần xuất: số tiền, kẹp trong [0, tiền hàng].
CREATE OR REPLACE FUNCTION public._giam_gia_don(p jsonb, p_tien_hang numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT LEAST(
    GREATEST(COALESCE(CASE WHEN (p->>'discount') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                           THEN (p->>'discount')::numeric END, 0), 0),
    GREATEST(COALESCE(p_tien_hang, 0), 0)
  )
$fn$;

-- 2. create_order_with_lines ghi thuế theo dòng.
DO $p1$
DECLARE
  v_src text;
  v_n   int;
  v_cot text := '(line_discount,[ \t\r\n]*line_total,[ \t\r\n]*conversion_factor,[ \t\r\n]*note)([ \t\r\n]*\))';
  v_gt  text := '(NULLIF\(l->>''note'',[ \t]*''''\))([ \t\r\n]*FROM[ \t\r\n]+jsonb_array_elements\(p->''lines''\))';
BEGIN
  v_src := pg_get_functiondef('public.create_order_with_lines(jsonb)'::regprocedure);
  IF position('(mig 183)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 183: create_order_with_lines đã ghi thuế dòng, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_cot, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % danh sách cột dòng đơn trong create_order_with_lines, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_gt, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % chỗ đọc ghi chú dòng đơn trong create_order_with_lines, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_cot, '\1, vat_rate /* (mig 183) */\2');
  v_src := regexp_replace(v_src, v_gt, '\1,
         public._thue_hop_le(l->>''vat_rate'')\2');
  EXECUTE v_src;
END;
$p1$;

-- 3. get_invoiceable_lines: thuế của DÒNG ĐƠN trước, thuế mặt hàng sau.
--    (Thân chỉ có ở mig 125 — dựng lại nguyên văn, đổi đúng một biểu thức.)
CREATE OR REPLACE FUNCTION public.get_invoiceable_lines(p_order_id uuid)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
    -- (mig 183) Thuế người bán đã chọn trên dòng đơn; đơn cũ → thuế mặt hàng.
    COALESCE(sol.vat_rate, p.vat_rate, 0),
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
$fn$;
GRANT EXECUTE ON FUNCTION public.get_invoiceable_lines(uuid) TO authenticated;

-- 4. post_invoice: thuế của tải trọng + giảm giá cả đơn.
DO $p2$
DECLARE
  v_src text;
  v_n   int;
  v_thue text := '(\r?\n[ \t]*)COALESCE\(pr\.vat_rate,[ \t]*0\),';
  v_sub  text := 'SET[ \t]+subtotal[ \t]*=[ \t]*round\(v_sub_raw\),';
  v_tong text := 'total[ \t]*=[ \t]*GREATEST\(0,[ \t]*round\(v_sub_raw[ \t]*\+[ \t]*v_vat_raw\)\)';
BEGIN
  v_src := pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure);
  IF position('(mig 183)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 183: post_invoice đã nhận thuế + giảm giá đơn, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_thue, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % chỗ lấy thuế mặt hàng trong post_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_sub, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % chỗ ghi subtotal trong post_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_tong, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % chỗ ghi total trong post_invoice, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_thue,
    '\1-- (mig 183) Thuế màn gửi lên (tỉ lệ hợp lệ), không thì thuế mặt hàng.\1COALESCE(public._thue_hop_le(l->>''vat_rate''), pr.vat_rate, 0),');
  v_src := regexp_replace(v_src, v_sub,
    'SET subtotal = round(v_sub_raw - public._giam_gia_don(p, v_sub_raw)),');
  v_src := regexp_replace(v_src, v_tong,
    'total    = GREATEST(0, round(v_sub_raw - public._giam_gia_don(p, v_sub_raw) + v_vat_raw))');
  EXECUTE v_src;
END;
$p2$;

-- 5. _apply_return_adds: chèn cả lý do từng dòng (mig 159).
--    (Thân chỉ có ở mig 152 — dựng lại, thêm đúng cột `reason`.)
CREATE OR REPLACE FUNCTION public._apply_return_adds(
  p_order_id   uuid,
  p_invoice_id uuid,
  p_adds       jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  a       jsonb;
  v_ret   uuid;
  v_qty   numeric;
  v_price numeric;
  v_vat   numeric;
  v_count int := 0;
BEGIN
  IF p_adds IS NULL OR jsonb_typeof(p_adds) <> 'array'
     OR jsonb_array_length(p_adds) = 0 THEN
    RETURN 0;
  END IF;

  v_ret := public._pending_return_for(p_order_id, p_invoice_id);

  FOR a IN SELECT * FROM jsonb_array_elements(p_adds)
  LOOP
    v_qty   := COALESCE((a->>'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_price := COALESCE((a->>'unit_price')::numeric, 0);
    v_vat   := COALESCE((a->>'vat_rate')::numeric, 0);

    INSERT INTO return_lines (
      return_id, product_id, unit_name, quantity, unit_price, vat_rate,
      line_total, is_exchange, note, reason
    ) VALUES (
      v_ret,
      (a->>'product_id')::uuid,
      COALESCE(a->>'unit_name', ''),
      v_qty,
      v_price,
      v_vat,
      -- ⚠ CÙNG CÔNG THỨC VỚI `toReturnLine` VÀ `_apply_return_edits`.
      round(v_qty * v_price * (1 + v_vat)),
      COALESCE((a->>'is_exchange')::boolean, false),
      NULLIF(a->>'note', ''),
      -- (mig 183) Lý do từng dòng. Giá trị lạ thì CHECK của mig 159 từ chối.
      NULLIF(a->>'reason', '')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public._apply_return_adds(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 6. _apply_return_edits: sửa được cả ghi chú và lý do dòng trả.
--    Khoá có mặt trong phần sửa mới đổi — vắng thì giữ nguyên (tải trọng cũ).
DO $p3$
DECLARE
  v_src text;
  v_n   int;
  v_mau text := '(line_total[ \t]*=[ \t]*round\(v_qty[ \t]*\*[ \t]*v_gia[ \t]*\*[ \t]*\(1[ \t]*\+[ \t]*COALESCE\(vat_rate,[ \t]*0\)\)\))';
BEGIN
  v_src := pg_get_functiondef('public._apply_return_edits(uuid, jsonb)'::regprocedure);
  IF position('(mig 183)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 183: _apply_return_edits đã sửa được ghi chú / lý do, bỏ qua ---';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '183: thấy % câu ghi line_total trong _apply_return_edits, cần đúng 1', v_n USING ERRCODE = 'P0001';
  END IF;
  v_src := regexp_replace(v_src, v_mau, '\1,
        -- (mig 183) Ghi chú / lý do từng dòng: có khoá thì đổi, vắng thì giữ.
        note   = CASE WHEN e ? ''note''   THEN NULLIF(e->>''note'', '''')   ELSE note   END,
        reason = CASE WHEN e ? ''reason'' THEN NULLIF(e->>''reason'', '''') ELSE reason END');
  EXECUTE v_src;
END;
$p3$;
REVOKE ALL ON FUNCTION public._apply_return_edits(uuid, jsonb) FROM PUBLIC, anon, authenticated;

DO $kiem$
BEGIN
  IF position('(mig 183)' IN pg_get_functiondef('public.create_order_with_lines(jsonb)'::regprocedure)) = 0
     OR position('(mig 183)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0
     OR position('(mig 183)' IN pg_get_functiondef('public.get_invoiceable_lines(uuid)'::regprocedure)) = 0
     OR position('(mig 183)' IN pg_get_functiondef('public._apply_return_adds(uuid, uuid, jsonb)'::regprocedure)) = 0
     OR position('(mig 183)' IN pg_get_functiondef('public._apply_return_edits(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '183: chưa vá đủ năm hàm' USING ERRCODE = 'P0001';
  END IF;
  -- Các miếng vá cũ của post_invoice phải còn nguyên (mig 152 / 174 / 180).
  IF position('_chuan_he_so_dong_hoa_don' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0
     OR position('(mig 180)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '183: post_invoice mất miếng vá cũ' USING ERRCODE = 'P0001';
  END IF;
  IF position('RETURN_UNIT_UNKNOWN' IN pg_get_functiondef('public._apply_return_edits(uuid, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '183: _apply_return_edits mất miếng vá mig 181' USING ERRCODE = 'P0001';
  END IF;
END;
$kiem$;

NOTIFY pgrst, 'reload schema';

SELECT 'Cột sales_order_lines.vat_rate' AS hang_muc,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'sales_order_lines' AND column_name = 'vat_rate')
            THEN 'có' ELSE 'CHƯA' END AS trang_thai
UNION ALL
SELECT 'post_invoice nhận thuế dòng + giảm giá đơn',
       CASE WHEN position('(mig 183)' IN pg_get_functiondef('public.post_invoice(jsonb)'::regprocedure)) > 0 THEN 'có' ELSE 'CHƯA' END
UNION ALL
SELECT 'Hàng trả thêm ở hóa đơn giữ lý do dòng',
       CASE WHEN position('(mig 183)' IN pg_get_functiondef('public._apply_return_adds(uuid, uuid, jsonb)'::regprocedure)) > 0 THEN 'có' ELSE 'CHƯA' END;
