-- =====================================================================
-- 133 — HÀNG TRẢ KÈM ĐƠN: HÓA ĐƠN GÁNH KHOẢN TRỪ, PHIẾU TRẢ LO NHẬP KHO
-- =====================================================================
--
-- LUẬT CHỦ NHÀ CHỐT
--   · Đơn hàng có hàng đổi / trả → lúc xuất hàng, lập hóa đơn:
--       – HÓA ĐƠN mang phần trừ tiền hàng trả, và TRỪ LUÔN VÀO CÔNG NỢ;
--       – PHIẾU TRẢ tự sinh từ đơn chỉ còn một việc: NHẬP HÀNG VỀ KHO.
--   · Phiếu trả ĐỘC LẬP (lập từ danh sách Phiếu trả, hoặc lập từ một hóa
--     đơn bán — ví dụ giao rồi khách không nhận hết) thì như cũ: VỪA trừ
--     công nợ VỪA nhập kho, và trừ lúc phiếu HOÀN THÀNH.
--
-- ĐANG SAI CHỖ NÀO
--   `_wf2b_recompute_receivable` (mig 125, dòng 106) trừ công nợ theo
--   MỘT luật duy nhất:
--
--       WHERE r.invoice_id = p_invoice_id AND r.status = 'completed'
--
--   Nghĩa là hàng khách trả tại chỗ cho NVBH chỉ giảm nợ khi THỦ KHO
--   hoàn thành phiếu trả. Từ lúc giao hàng tới lúc đó, sổ ghi khách nợ
--   đủ cả lô — trong khi khách đã đưa tiền phần chênh và cầm về tờ hóa
--   đơn có dòng trừ. Kế toán đi đối chiếu sẽ thấy hai con số khác nhau,
--   và con số sai là con số trong sổ.
--
-- CÁCH SỬA
--   Thêm một cột đánh dấu XUẤT XỨ của phiếu trả — `credit_with_invoice`:
--   "khoản trừ của phiếu này đi cùng hóa đơn". Công nợ trừ theo:
--
--       đi cùng hóa đơn  → trừ từ khi phiếu ở 'submitted' (lúc xuất hàng)
--       không đi cùng    → trừ khi phiếu 'completed'      (lúc nhập kho)
--
-- ⚠ KHÔNG SỬA `sales_invoices.total`. Tờ hóa đơn chứng nhận GIÁ TRỊ LÔ
--   HÀNG ĐÃ GIAO; khoản trừ là việc xảy ra cùng lúc nhưng là một dòng
--   khác. `total` còn là nền của doanh số gộp (mig 126) và của hóa đơn
--   điện tử — đổi nghĩa của nó là doanh thu và thuế lệch theo mà không
--   ai thấy. Bản in đã hiện "Tổng cộng / Trừ hàng trả / Còn phải thu"
--   đúng như chủ nhà chốt.
--
-- ⚠ KHÔNG LƯU KHOẢN TRỪ THÀNH MỘT CỘT SNAPSHOT trên `sales_invoices`.
--   Tính sống từ `returns` mỗi lần là phiếu trả bị huỷ / bị sửa dòng thì
--   công nợ tự đúng theo. Một cột chụp lại là từ nay có hai con số cho
--   cùng một khoản, và chúng chỉ lệch nhau vào đúng lúc không ai nhìn.
--
-- ⚠ ĐẢO NGƯỢC PHẢI KÉO THEO. `cancel_invoice` (đã vá ở mig 131) gỡ phiếu
--   trả kèm đơn ra khỏi hóa đơn; 133 gỡ luôn dấu `credit_with_invoice`.
--   Không gỡ thì phiếu ấy vẫn trừ nợ của một tờ hóa đơn đã huỷ, và lần
--   xuất lại nó trừ thêm lần nữa.
--
-- ⚠ CẦN MIG 131 CHẠY TRƯỚC. 133 vá tiếp lên đúng hai câu mà 131 vừa viết
--   lại. Chưa có 131 thì DỪNG và nói ra, chứ không vá mò.

-- ---------------------------------------------------------------------
-- 1. Cột đánh dấu
-- ---------------------------------------------------------------------
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS credit_with_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN returns.credit_with_invoice IS
  'Khoản trừ của phiếu này ĐI CÙNG HÓA ĐƠN: trừ vào công nợ ngay khi '
  'hóa đơn được ghi sổ (phiếu ở ''submitted''), và phiếu chỉ còn việc '
  'nhập hàng về kho. Phiếu trả độc lập để false — nó trừ khi HOÀN THÀNH.';

CREATE INDEX IF NOT EXISTS idx_returns_credit_with_invoice
  ON returns(invoice_id, credit_with_invoice) WHERE invoice_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. Luật trừ công nợ mới
-- ---------------------------------------------------------------------
--
-- ⚠ HÀM NÀY VIẾT LẠI NGUYÊN VĂN, KHÔNG VÁ THEO CHUỖI. Nó ngắn, và phép
--   tính công nợ là thứ phải đọc được hết trong một lần — không phải
--   ghép từ ba migration mới ra nghĩa.
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

  -- ⚠ HAI LUẬT, MỘT PHÉP CỘNG. Phiếu đi cùng hóa đơn trừ ngay từ
  --   'submitted' (hàng đã đổi tay lúc giao); phiếu độc lập trừ khi
  --   'completed' (hàng đã về kho). Gộp thành một điều kiện `OR` chứ
  --   không hai câu cộng lại — hai câu là sớm muộn có người sửa một câu.
  SELECT COALESCE(sum(COALESCE(r.credit_note_amount, 0)), 0) INTO v_credits
  FROM returns r
  WHERE r.invoice_id = p_invoice_id
    AND (
      (r.credit_with_invoice AND r.status IN ('submitted', 'completed'))
      OR
      (NOT r.credit_with_invoice AND r.status = 'completed')
    );

  v_net := GREATEST(0, COALESCE(v.total, 0) - v_credits);

  SELECT rc.id, COALESCE(rc.paid, 0) INTO v_id, v_paid
  FROM receivables rc WHERE rc.invoice_id = p_invoice_id LIMIT 1;

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


-- ---------------------------------------------------------------------
-- 3. `post_invoice` — đánh dấu phiếu trả, RỒI mới tính lại công nợ
-- ---------------------------------------------------------------------
--
-- ⚠ THỨ TỰ LÀ CẢ VẤN ĐỀ. Bản mig 125 tính công nợ TRƯỚC rồi mới gắn
--   phiếu trả:
--
--       v_rec := public._wf2b_recompute_receivable(v_inv);
--       UPDATE returns SET status = 'submitted', invoice_id = v_inv ...
--
--   Với luật cũ điều đó vô hại (phiếu vừa gắn còn 'submitted', chưa trừ
--   gì). Với luật mới thì nó trừ hụt: công nợ ghi đủ cả lô, và chỉ đúng
--   lại vào lần nào đó có ai gọi tính lại. Nên câu gắn phải chạy TRƯỚC,
--   và tính lại NGAY SAU nó.
DO $patch$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  -- Bắt cả hai hình dạng: bản mig 125 (chưa có bí danh) và bản mig 131.
  v_re   text := 'UPDATE returns[^;]*SET status = ''submitted'', invoice_id = v_inv[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'post_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST_INVOICE_MISSING: chưa có post_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('AND ret.invoice_id IS NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: post_invoice chưa được migration 131 vá (câu gắn phiếu trả còn hình dạng cũ). Chạy 131 trước rồi chạy lại 133.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('credit_with_invoice = true' in v_src) > 0 THEN
    RAISE NOTICE '133: post_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'POST_INVOICE_SHAPE: tìm thấy % câu gắn phiếu trả trong post_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    'UPDATE returns ret' || E'\n'
    || '  SET status = ''submitted'', invoice_id = v_inv,' || E'\n'
    -- ⚠ PHIẾU SINH RA TỪ ĐƠN MỚI ĐƯỢC ĐÁNH DẤU. Phiếu độc lập đã gắn
    --   hóa đơn này từ trước thì `ret.invoice_id IS NULL` loại nó ra rồi.
    || '      credit_with_invoice = true' || E'\n'
    || '  WHERE ret.order_id = v_order' || E'\n'
    || '    AND ret.invoice_id IS NULL' || E'\n'
    || '    AND ret.status IN (''draft'', ''submitted'');' || E'\n'
    || E'\n'
    || '  -- ⚠ TÍNH LẠI SAU KHI ĐÃ GẮN (mig 133). Lần tính ở trên chạy' || E'\n'
    || '  --   trước câu gắn nên chưa thấy khoản trừ nào; không tính lại' || E'\n'
    || '  --   ở đây thì công nợ ghi đủ cả lô trong khi khách đã trừ.' || E'\n'
    || '  v_rec := public._wf2b_recompute_receivable(v_inv);';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '133: đã vá post_invoice — hóa đơn gánh khoản trừ hàng trả kèm đơn.';
END;
$patch$;


-- ---------------------------------------------------------------------
-- 4. `cancel_invoice` — gỡ dấu khi gỡ liên kết
-- ---------------------------------------------------------------------
--
-- ⚠ ĐẢO NGƯỢC PHẢI ĐẢO ĐỦ. Mig 131 gỡ `invoice_id`; nếu để lại dấu
--   `credit_with_invoice` thì lần xuất hóa đơn sau `post_invoice` gắn
--   lại và đặt dấu lần nữa — không sai, nhưng phiếu nằm giữa hai lần ấy
--   mang một dấu vô nghĩa. Tệ hơn: phiếu bị gỡ rồi lại được HOÀN THÀNH
--   như một phiếu độc lập thì luật cũ và luật mới cùng nhìn vào nó.
DO $patch2$
DECLARE
  v_oid  oid;
  v_src  text;
  v_stmt text;
  v_new  text;
  v_n    int;
  v_re   text := 'UPDATE returns[^;]*SET invoice_id = NULL[^;]+;';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'cancel_invoice';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CANCEL_INVOICE_MISSING: chưa có cancel_invoice — chạy migration 125 trước.'
      USING ERRCODE = 'P0001';
  END IF;

  v_src := pg_get_functiondef(v_oid);

  IF position('SET invoice_id = NULL' in v_src) = 0 THEN
    RAISE EXCEPTION
      'NEEDS_131: cancel_invoice chưa được migration 131 vá (còn huỷ thẳng phiếu trả). Chạy 131 trước rồi chạy lại 133.'
      USING ERRCODE = 'P0001';
  END IF;

  IF position('credit_with_invoice = false' in v_src) > 0 THEN
    RAISE NOTICE '133: cancel_invoice đã vá từ trước — không đổi gì.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'CANCEL_INVOICE_SHAPE: tìm thấy % câu gỡ phiếu trả trong cancel_invoice (cần đúng 1). Thân hàm hiện tại:%',
      v_n, E'\n' || v_src USING ERRCODE = 'P0001';
  END IF;

  v_stmt := substring(v_src from v_re);

  v_new :=
    'UPDATE returns' || E'\n'
    || '  SET invoice_id = NULL, credit_with_invoice = false' || E'\n'
    || '  WHERE invoice_id = p_invoice_id' || E'\n'
    || '    AND status IN (''draft'', ''submitted'')' || E'\n'
    || '    AND order_id IS NOT NULL;';

  EXECUTE replace(v_src, v_stmt, v_new);
  RAISE NOTICE '133: đã vá cancel_invoice — gỡ dấu đi cùng hóa đơn.';
END;
$patch2$;


-- ---------------------------------------------------------------------
-- 5. Đánh dấu dữ liệu cũ
-- ---------------------------------------------------------------------
--
-- ⚠ CHỈ PHIẾU SINH RA TỪ ĐƠN. Dấu hiệu: có `order_id`, VÀ ra đời TRƯỚC
--   khi hóa đơn của nó được ghi sổ. Phiếu lập TỪ một hóa đơn (giao rồi
--   khách không nhận hết) ra đời SAU, và theo luật chủ nhà nó vẫn trừ
--   lúc nhập kho — không được đánh dấu.
--
-- ⚠ ĐÁNH DẤU MỘT PHIẾU ĐANG 'submitted' LÀ LÀM CÔNG NỢ GIẢM NGAY. Đó
--   chính là ý chủ nhà, nhưng nó đụng vào sổ đang chạy — nên in ra từng
--   dòng, kèm số tiền, trước khi đụng.
DO $mark$
DECLARE
  r      record;
  v_n    int := 0;
  v_move int := 0;
  v_amt  numeric := 0;
BEGIN
  FOR r IN
    SELECT ret.id, ret.status, COALESCE(ret.credit_note_amount, 0) AS credit,
           si.invoice_code, so.order_code
    FROM returns ret
    LEFT JOIN sales_invoices si ON si.id = ret.invoice_id
    LEFT JOIN sales_orders   so ON so.id = ret.order_id
    WHERE ret.order_id IS NOT NULL
      AND NOT ret.credit_with_invoice
      AND ret.status IN ('draft', 'submitted', 'completed')
      AND (
        ret.invoice_id IS NULL
        OR ret.created_at < COALESCE(si.posted_at, si.created_at)
      )
  LOOP
    UPDATE returns SET credit_with_invoice = true WHERE id = r.id;
    v_n := v_n + 1;
    -- Chỉ phiếu 'submitted' mới làm công nợ đổi: 'completed' vốn đã trừ,
    -- 'draft' thì chưa gắn hóa đơn nào nên không có gì để đổi.
    IF r.status = 'submitted' AND r.invoice_code IS NOT NULL AND r.credit > 0 THEN
      v_move := v_move + 1;
      v_amt := v_amt + r.credit;
      RAISE NOTICE '133 CÔNG NỢ ĐỔI: hóa đơn % (đơn %) giảm % — phiếu trả đã gửi, nay trừ ngay.',
        r.invoice_code, COALESCE(r.order_code, '—'), r.credit;
    END IF;
  END LOOP;

  RAISE NOTICE '--- 133: đánh dấu % phiếu trả đi cùng hóa đơn · % hóa đơn đổi công nợ, tổng giảm % ---',
    v_n, v_move, v_amt;
END;
$mark$;


-- ---------------------------------------------------------------------
-- 6. Tính lại công nợ cho những hóa đơn vừa bị ảnh hưởng
-- ---------------------------------------------------------------------
DO $recalc$
DECLARE
  r   record;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ret.invoice_id AS id
    FROM returns ret
    WHERE ret.invoice_id IS NOT NULL
      AND ret.credit_with_invoice
      AND ret.status IN ('submitted', 'completed')
  LOOP
    PERFORM public._wf2b_recompute_receivable(r.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '--- 133: tính lại công nợ cho % hóa đơn ---', v_n;
END;
$recalc$;

NOTIFY pgrst, 'reload schema';
