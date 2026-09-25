-- ====================================================================
-- PHIẾU TRẢ TỰ SINH (THEO HÓA ĐƠN) VÀ PHIẾU TRẢ NGƯỜI DÙNG TỰ LẬP
--
-- VÌ SAO — chủ nhà 25/09/2026:
--   "Đơn hàng có hàng đổi trả, công nợ sẽ được trừ ngay khi Hoá đơn đã xuất.
--    CHỉ treo nhập kho bên Trả hàng bằng phiếu tự sinh (ở trạng thái Chờ xử lý).
--    Với đơn Trả hàng bình thường thì khi phiếu hoàn thành -> đồng thời nhập kho
--    và trừ công nợ."
--   "Phiếu trả sinh ra tự động thì chỉ huỷ phiếu ko sửa được (muốn sửa thì sửa
--    từ hoá đơn), khi huỷ phiếu -> quay lại trạng thái chờ xử lý.
--    Phiếu trả do người dùng tạo -> sửa/huỷ được -> mọi thứ cập nhật theo."
--   Chốt thêm (cùng ngày): phiếu tự sinh đang Chờ xử lý thì CHẶN huỷ (sửa từ
--   hóa đơn); phiếu tự lập đã dùng tiền trả thì VẪN cho sửa / huỷ, nợ tự tăng lại;
--   phiếu tự lập đã hoàn thành từ trước thì GHI BÙ công nợ âm ngay.
--   "Lưu ý trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh" — phiếu tự lập đi
--   Nháp → Hoàn thành (nhập kho + trừ nợ) → Đã huỷ, không qua Chờ xử lý.
--
-- "TỰ SINH" = `returns.credit_with_invoice` (post_invoice gắn cờ này cho phiếu trả
--   kèm đơn lúc xuất hóa đơn, mig 131/133). Công nợ của nó đã trừ vào hóa đơn từ
--   lúc 'submitted' (Chờ xử lý) — xem `_wf2b_recompute_receivable` (mig 186).
--
-- CÁCH LÀM:
--   1. `receivables.return_id` + `_cong_no_phieu_tra(return_id)`: phiếu tự lập
--      KHÔNG gắn hóa đơn / đơn nào, khi hoàn thành ghi ngay một dòng công nợ ÂM
--      (dư có của khách, luật mig 186); huỷ / sửa thì dòng ấy đổi theo. Trước nay
--      loại phiếu này KHÔNG trừ nợ lúc hoàn thành — chỉ chờ ai đó chọn nó ở phiếu
--      thu ("cấn trừ phiếu trả").
--   2. Trigger trạng thái dòng âm: dư có đã dùng QUÁ số còn lại (sửa phiếu giảm
--      sau khi đã rút) là khách NỢ LẠI → 'open', không phải 'paid'.
--   3. `cancel_return`:
--      · Tự sinh + Chờ xử lý → CHẶN (RETURN_FOLLOWS_INVOICE).
--      · Tự sinh + Đã nhập kho → đảo kho, phiếu VỀ 'submitted'; công nợ giữ nguyên
--        (hóa đơn vẫn trừ).
--      · Tự lập → đảo kho (nếu đã nhập), 'cancelled', tính lại công nợ. BỎ khoá
--        "hóa đơn gốc đã có tiền thu": nợ tự tăng lại (chủ nhà chốt "luôn cho").
--      · Đánh dấu phiếu nhập đã đảo NGAY Ở ĐÂY — tự sinh có thể nhập kho lại rồi
--        huỷ lần nữa; không đánh dấu thì lần sau đảo cả phiếu nhập cũ.
--   4. `complete_return`: phiếu tự lập độc lập → `_cong_no_phieu_tra`.
--   5. `save_pos_return`: chặn sửa phiếu tự sinh.
--   6. Trigger khoá ghi thẳng từ trình duyệt (vai `authenticated`) vào phiếu tự sinh
--      và dòng của nó. RPC (SECURITY DEFINER) vẫn ghi được — sửa từ hóa đơn đi qua đó.
--   7. `create_cash_receipt`: thôi nhận "cấn trừ phiếu trả" cho phiếu đã nằm trong
--      công nợ (dư có dùng ở ô "Dùng số dư có") và cho phiếu gắn hóa đơn (đã trừ
--      vào hóa đơn lúc hoàn thành — cấn nữa là trừ HAI LẦN).
--   8. `void_cash_receipt`: dòng âm được trả `paid` về đúng (bản cũ kẹp `GREATEST(0,…)`
--      nên huỷ một trong hai phiếu thu cùng rút dư có là trả lại cả hai); phiếu trả
--      từng cấn theo cách cũ được ghi lại thành công nợ âm.
--   9. Ghi bù: phiếu tự lập độc lập đã hoàn thành, chưa cấn ở phiếu thu nào.
--  10. "Chờ xử lý" chỉ còn ở phiếu tự sinh: `complete_return` nhận thẳng phiếu tự
--      lập ở Nháp, `cancel_return` huỷ được Nháp tự lập, phiếu tự lập đang
--      'submitted' chuyển về 'draft'.
-- ====================================================================

-- 1. Cột + chỉ mục -----------------------------------------------------
ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.returns(id) ON DELETE SET NULL;

-- ⚠ MỘT PHIẾU TRẢ MỘT DÒNG CÔNG NỢ — hai dòng là trừ nợ hai lần.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_return
  ON public.receivables(return_id) WHERE return_id IS NOT NULL;

COMMENT ON COLUMN public.receivables.return_id IS
  'Phiếu trả tự lập không gắn hóa đơn: dòng công nợ ÂM (dư có) ghi lúc hoàn thành (mig 191).';

-- 1b. Công nợ của một phiếu trả độc lập -------------------------------
CREATE OR REPLACE FUNCTION public._cong_no_phieu_tra(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r      record;
  v_amt  numeric;
  v_id   uuid;
  v_paid numeric;
  v_cust uuid;
BEGIN
  SELECT ret.id, ret.org_id, ret.customer_id, ret.sales_user_id, ret.status,
         ret.invoice_id, ret.order_id, ret.applied_receipt_id,
         COALESCE(ret.credit_note_amount, 0) AS credit,
         COALESCE(ret.return_date, (ret.completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                  (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS ngay
    INTO r
  FROM returns ret WHERE ret.id = p_return_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- ⚠ Đã cấn trừ ở phiếu thu theo CÁCH CŨ ('return_credit'): khoản có đã dùng ở
  --   đó rồi. Ghi thêm dòng âm là trừ nợ lần hai.
  IF r.applied_receipt_id IS NOT NULL THEN RETURN NULL; END IF;

  -- Chỉ phiếu ĐỘC LẬP đã hoàn thành mới là dư có. Phiếu gắn hóa đơn / đơn thì
  -- khoản trừ nằm ở công nợ của chính hóa đơn / đơn đó.
  v_amt := CASE WHEN r.status = 'completed' AND r.invoice_id IS NULL AND r.order_id IS NULL
                THEN -r.credit ELSE 0 END;

  SELECT rc.id, COALESCE(rc.paid, 0), rc.customer_id INTO v_id, v_paid, v_cust
  FROM receivables rc WHERE rc.return_id = p_return_id FOR UPDATE;

  IF v_id IS NULL THEN
    IF v_amt = 0 THEN RETURN NULL; END IF;
    INSERT INTO receivables (org_id, customer_id, sales_user_id, amount, paid, due_date,
                             status, return_id, note)
    VALUES (r.org_id, r.customer_id, r.sales_user_id, v_amt, 0, r.ngay,
            'open', r.id, 'Dư có từ phiếu trả hàng')
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF v_cust IS DISTINCT FROM r.customer_id AND v_paid <> 0 THEN
    RAISE EXCEPTION 'RETURN_CREDIT_USED: dư có của phiếu trả đã dùng ở phiếu thu của khách cũ — không đổi khách được'
      USING ERRCODE = 'P0001';
  END IF;

  -- Dòng âm: trạng thái do trigger `_cong_no_am_trang_thai` quyết.
  UPDATE receivables
  SET amount = v_amt, customer_id = r.customer_id, sales_user_id = r.sales_user_id,
      due_date = r.ngay,
      status = CASE WHEN v_amt - v_paid <= 0 THEN 'paid'
                    WHEN v_paid > 0         THEN 'partial'
                    ELSE 'open' END
  WHERE id = v_id;
  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public._cong_no_phieu_tra(uuid) IS
  'Phiếu trả tự lập độc lập: hoàn thành → công nợ âm = −credit_note_amount; huỷ / về nháp → 0 (mig 191).';

REVOKE EXECUTE ON FUNCTION public._cong_no_phieu_tra(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Trạng thái dòng âm ------------------------------------------------
CREATE OR REPLACE FUNCTION public._cong_no_am_trang_thai()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $trg$
BEGIN
  IF NEW.amount < 0 THEN
    -- Dùng vừa hết dư có → 'paid'. Còn dư (paid > amount) → 'open'.
    -- ⚠ (mig 191) Dùng QUÁ (paid < amount, phiếu trả bị sửa giảm / huỷ sau khi đã
    --   rút) là khách nợ lại phần chênh → cũng 'open', để nó được cộng vào nợ.
    NEW.status := CASE WHEN abs(COALESCE(NEW.paid, 0) - NEW.amount) < 0.01 THEN 'paid' ELSE 'open' END;
  END IF;
  RETURN NEW;
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._cong_no_am_trang_thai() FROM PUBLIC, anon, authenticated;

-- 3. cancel_return — viết lại cả hàm (bản đang chạy = 127 + vá chuỗi 190) ------
CREATE OR REPLACE FUNCTION public.cancel_return(p_return_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  v_entry uuid;
  l       record;
  v_rows  int := 0;
BEGIN
  SELECT id, org_id, order_id, invoice_id, status, applied_receipt_id,
         COALESCE(credit_with_invoice, false) AS tu_sinh INTO r
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

  IF r.status IN ('draft', 'submitted') THEN
    -- ⚠ (mig 191) Phiếu TỰ SINH ăn theo hóa đơn: hóa đơn vẫn in và vẫn trừ nợ phần
    --   hàng trả này. Huỷ ở đây là hai chứng từ lệch nhau — sửa từ hóa đơn.
    IF r.tu_sinh THEN
      RAISE EXCEPTION 'RETURN_FOLLOWS_INVOICE: phiếu trả tự sinh theo hóa đơn — muốn bỏ hàng trả thì sửa hóa đơn'
        USING ERRCODE = 'P0001';
    END IF;
    -- Nháp đi theo ĐƠN chưa xuất hóa đơn cũng là phiếu tự sinh sắp thành — sửa ở đơn.
    IF r.status = 'draft' AND r.order_id IS NOT NULL AND r.invoice_id IS NULL THEN
      RAISE EXCEPTION 'RETURN_FOLLOWS_ORDER: hàng trả đi theo đơn hàng — muốn bỏ thì sửa đơn'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
    -- (mig 190) Phiếu đi cùng hóa đơn đã trừ công nợ từ lúc chờ — huỷ thì trả lại.
    IF r.invoice_id IS NOT NULL THEN
      PERFORM public._wf2b_recompute_receivable(r.invoice_id);
    END IF;
    RETURN;
  END IF;

  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'RETURN_NOT_CANCELLABLE: phiếu ở trạng thái % không huỷ được', r.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Khoản có đã cấn vào phiếu thu theo CÁCH CŨ ('return_credit') thì phải huỷ phiếu
  -- thu ấy trước — tiền của nó đã đắp vào khoản nợ khác.
  IF r.applied_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED_CREDIT_APPLIED: khoản có đã cấn trừ vào phiếu thu — huỷ phiếu thu đó trước'
      USING ERRCODE = 'P0001';
  END IF;
  -- ⚠ (mig 191) BỎ khoá "hóa đơn / đơn gốc đã có tiền thu": chủ nhà chốt 25/09/2026
  --   phiếu tự lập "sửa/huỷ được -> mọi thứ cập nhật theo" — nợ tự tăng lại.

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

  -- ⚠ (mig 191) Đánh dấu phiếu nhập đã đảo. Phiếu tự sinh huỷ xong về Chờ xử lý,
  --   có thể nhập kho lại rồi huỷ lần nữa — phiếu nhập cũ không được đảo hai lần.
  UPDATE stock_entries
  SET notes = notes || ' (đã đảo)'
  WHERE org_id = r.org_id AND type = 'import'
    AND notes = 'Nhập lại từ phiếu trả ' || p_return_id::text;

  IF r.tu_sinh THEN
    -- Tự sinh: chỉ bỏ phần nhập kho, phiếu về Chờ xử lý. Công nợ vẫn trừ theo hóa đơn.
    UPDATE returns
    SET status = 'submitted', completed_at = NULL, completed_by = NULL
    WHERE id = p_return_id;
  ELSE
    UPDATE returns
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
    WHERE id = p_return_id;
  END IF;

  IF r.invoice_id IS NOT NULL THEN
    PERFORM public._wf2b_recompute_receivable(r.invoice_id);
  ELSIF r.order_id IS NOT NULL THEN
    PERFORM public._wf2_recompute_receivable(r.order_id);
  ELSE
    PERFORM public._cong_no_phieu_tra(p_return_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_return(uuid, text) TO authenticated;

-- 4. complete_return — phiếu độc lập ghi công nợ âm (vá chuỗi bản đang chạy) ------
DO $p$
DECLARE
  v_src  text;
  v_from text := E'    PERFORM public._wf2_recompute_receivable(r.order_id);\n  END IF;\n\n  PERFORM public._wf2_notify(';
  v_n    int;
BEGIN
  v_src := pg_get_functiondef('public.complete_return(uuid, text)'::regprocedure);
  IF position('_cong_no_phieu_tra' IN v_src) > 0 THEN
    RAISE NOTICE '--- 191: complete_return đã ghi công nợ phiếu độc lập, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_from, ''))) / length(v_from);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '191: thấy % chỗ tính lại công nợ trong complete_return, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from,
    E'    PERFORM public._wf2_recompute_receivable(r.order_id);\n'
    || E'  ELSE\n'
    || E'    -- (mig 191) Phiếu độc lập: hoàn thành là trừ nợ ngay — công nợ âm của khách.\n'
    || E'    PERFORM public._cong_no_phieu_tra(p_return_id);\n'
    || E'  END IF;\n\n  PERFORM public._wf2_notify(');
  EXECUTE v_src;
END;
$p$;

-- 4b. complete_return — phiếu tự lập hoàn thành thẳng từ Nháp -------------------
DO $p$
DECLARE
  v_src  text;
  v_from text := E'  IF r.status <> ''submitted'' THEN\n    RAISE EXCEPTION ''RETURN_NOT_SUBMITTED';
  v_n    int;
BEGIN
  v_src := pg_get_functiondef('public.complete_return(uuid, text)'::regprocedure);
  IF position('(mig 191) Phiếu tự lập không có Chờ xử lý' IN v_src) > 0 THEN
    RAISE NOTICE '--- 191: complete_return đã nhận phiếu nháp tự lập, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_from, ''))) / length(v_from);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '191: thấy % chỗ kiểm trạng thái trong complete_return, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from,
    E'  -- (mig 191) Phiếu tự lập không có Chờ xử lý: hoàn thành thẳng từ Nháp. Nháp\n'
    || E'  --   đi theo đơn chưa xuất hóa đơn thì không — nó chờ hóa đơn.\n'
    || E'  IF r.status = ''draft'' AND NOT COALESCE(r.credit_with_invoice, false)\n'
    || E'     AND NOT (r.order_id IS NOT NULL AND r.invoice_id IS NULL) THEN\n'
    || E'    r.status := ''submitted'';\n'
    || E'  END IF;\n'
    || v_from);
  EXECUTE v_src;
END;
$p$;

-- 5. save_pos_return — chặn sửa phiếu tự sinh (viết lại cả hàm, bản đang chạy = 190) --
CREATE OR REPLACE FUNCTION public.save_pos_return(p jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org      uuid := public.user_org_id();
  v_role     text := public.user_role();
  v_id       uuid := NULLIF(p->>'return_id', '')::uuid;
  v_cust     uuid := NULLIF(p->>'customer_id', '')::uuid;
  v_inv      uuid := NULLIF(p->>'invoice_id', '')::uuid;
  v_lines    jsonb := p->'lines';
  v_complete boolean := COALESCE((p->>'complete')::boolean, false);
  v_zone     text := COALESCE(NULLIF(p->>'zone', ''), 'sale');
  v_date     date := COALESCE(NULLIF(p->>'return_date', '')::date,
                              (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  r          record;
  v_n        int;
BEGIN
  IF v_org IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: chưa đăng nhập' USING ERRCODE = 'P0001';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
    RAISE EXCEPTION 'FORBIDDEN: vai trò của bạn không lập được phiếu trả' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu trả cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = v_cust AND c.org_id = v_org) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: không tìm thấy khách hàng' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_invoices si WHERE si.id = v_inv AND si.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: không tìm thấy hóa đơn gốc' USING ERRCODE = 'P0001';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO returns (org_id, customer_id, invoice_id, requested_by, reason, notes, status, return_date)
    VALUES (v_org, v_cust, v_inv, auth.uid(), NULLIF(p->>'reason', ''), NULLIF(p->>'notes', ''),
            'draft', v_date)
    RETURNING id INTO v_id;
  ELSE
    SELECT ret.id, ret.org_id, ret.status, ret.sales_user_id,
           COALESCE(ret.credit_with_invoice, false) AS tu_sinh INTO r
    FROM returns ret WHERE ret.id = v_id FOR UPDATE;
    IF NOT FOUND OR r.org_id <> v_org THEN
      RAISE EXCEPTION 'RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF r.status = 'cancelled' THEN
      RAISE EXCEPTION 'RETURN_LOCKED: phiếu trả đã huỷ — không sửa được' USING ERRCODE = 'P0001';
    END IF;
    -- ⚠ (mig 191) Chủ nhà 25/09/2026: phiếu tự sinh "ko sửa được (muốn sửa thì sửa
    --   từ hoá đơn)".
    IF r.tu_sinh THEN
      RAISE EXCEPTION 'RETURN_FOLLOWS_INVOICE: phiếu trả tự sinh theo hóa đơn — muốn sửa thì sửa hóa đơn'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_role = 'sales' AND (r.status <> 'draft' OR r.sales_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'FORBIDDEN: nhân viên bán hàng chỉ sửa được phiếu nháp của mình' USING ERRCODE = 'P0001';
    END IF;

    IF r.status = 'completed' THEN
      IF NOT v_complete THEN
        RAISE EXCEPTION 'RETURN_COMPLETED: phiếu đã nhập kho — sửa xong phải bấm Ghi nhận để kho và công nợ đổi theo'
          USING ERRCODE = 'P0001';
      END IF;
      -- Đảo bút toán cũ bằng đúng đường huỷ; `cancel_return` tự đánh dấu phiếu nhập
      -- cũ đã đảo (mig 191).
      PERFORM public.cancel_return(v_id, 'Sửa phiếu trả trên POS — ghi nhận lại');
      UPDATE returns
      SET status = 'draft', cancelled_at = NULL, cancel_reason = NULL
      WHERE id = v_id;
    END IF;

    UPDATE returns
    SET customer_id = v_cust, invoice_id = v_inv,
        reason = NULLIF(p->>'reason', ''), notes = NULLIF(p->>'notes', ''),
        return_date = v_date
    WHERE id = v_id;
    DELETE FROM return_lines WHERE return_id = v_id;
  END IF;

  INSERT INTO return_lines (return_id, product_id, unit_name, quantity, unit_price, vat_rate,
                            line_total, is_exchange, note, reason)
  SELECT v_id,
         (l->>'product_id')::uuid,
         COALESCE(l->>'unit_name', ''),
         (l->>'quantity')::numeric,
         COALESCE((l->>'unit_price')::numeric, 0),
         COALESCE((l->>'vat_rate')::numeric, 0),
         -- ⚠ CÙNG CÔNG THỨC VỚI `_apply_return_adds` và `dongTraGhiSo`.
         round((l->>'quantity')::numeric * COALESCE((l->>'unit_price')::numeric, 0)
               * (1 + COALESCE((l->>'vat_rate')::numeric, 0))),
         COALESCE((l->>'is_exchange')::boolean, false),
         NULLIF(l->>'note', ''),
         CASE WHEN COALESCE((l->>'is_exchange')::boolean, false) THEN NULL ELSE NULLIF(l->>'reason', '') END
  FROM jsonb_array_elements(v_lines) AS l
  WHERE NULLIF(l->>'product_id', '') IS NOT NULL
    AND COALESCE((l->>'quantity')::numeric, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'BAD_PAYLOAD: phiếu trả cần ít nhất một dòng hàng.' USING ERRCODE = 'P0001';
  END IF;

  IF v_complete THEN
    -- ⚠ `complete_return` chỉ nhận 'submitted' (mig 158).
    UPDATE returns SET status = 'submitted' WHERE id = v_id AND status = 'draft';
    PERFORM public.complete_return(v_id, v_zone);
  END IF;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.save_pos_return(jsonb) IS
  'POS: lập / sửa / ghi nhận phiếu trả TỰ LẬP trong một giao dịch; phiếu tự sinh theo hóa đơn không sửa ở đây (mig 190, 191).';

REVOKE ALL ON FUNCTION public.save_pos_return(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pos_return(jsonb) TO authenticated;

-- 6. Khoá ghi thẳng vào phiếu tự sinh ----------------------------------
-- ⚠ Chỉ chặn vai của trình duyệt (`authenticated` / `anon`). Trong RPC SECURITY
--   DEFINER `current_user` là chủ hàm, nên sửa từ hóa đơn (`_apply_return_edits`,
--   `post_invoice`, `cancel_invoice`) vẫn đi qua.
CREATE OR REPLACE FUNCTION public._khoa_phieu_tra_tu_sinh()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $trg$
DECLARE
  v_tu_sinh boolean := false;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'returns' THEN
    IF TG_OP = 'DELETE' THEN
      v_tu_sinh := COALESCE(OLD.credit_with_invoice, false);
    ELSIF TG_OP = 'UPDATE' THEN
      -- Ghi chú / người đứng tên vẫn sửa được; tiền, trạng thái, khách, chứng từ gốc thì không.
      v_tu_sinh := COALESCE(OLD.credit_with_invoice, false)
        AND (NEW.status, NEW.customer_id, NEW.invoice_id, NEW.order_id,
             NEW.credit_with_invoice, NEW.credit_note_amount)
            IS DISTINCT FROM
            (OLD.status, OLD.customer_id, OLD.invoice_id, OLD.order_id,
             OLD.credit_with_invoice, OLD.credit_note_amount);
    END IF;
  ELSE
    SELECT COALESCE(ret.credit_with_invoice, false) INTO v_tu_sinh
    FROM returns ret
    WHERE ret.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.return_id ELSE NEW.return_id END;
  END IF;
  IF COALESCE(v_tu_sinh, false) THEN
    RAISE EXCEPTION 'RETURN_FOLLOWS_INVOICE: phiếu trả tự sinh theo hóa đơn — muốn sửa thì sửa hóa đơn'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$trg$;

REVOKE EXECUTE ON FUNCTION public._khoa_phieu_tra_tu_sinh() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_khoa_phieu_tra_tu_sinh ON public.returns;
CREATE TRIGGER trg_khoa_phieu_tra_tu_sinh
  BEFORE UPDATE OR DELETE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public._khoa_phieu_tra_tu_sinh();

DROP TRIGGER IF EXISTS trg_khoa_dong_tra_tu_sinh ON public.return_lines;
CREATE TRIGGER trg_khoa_dong_tra_tu_sinh
  BEFORE INSERT OR UPDATE OR DELETE ON public.return_lines
  FOR EACH ROW EXECUTE FUNCTION public._khoa_phieu_tra_tu_sinh();

-- 7. create_cash_receipt — thôi cấn trừ phiếu trả đã nằm trong công nợ --------
DO $p$
DECLARE
  v_src  text;
  v_from text := E'        AND r.status = ''completed'' AND r.order_id IS NULL\n        AND r.applied_receipt_id IS NULL\n';
  v_n    int;
BEGIN
  v_src := pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure);
  IF position('(mig 191)' IN v_src) > 0 THEN
    RAISE NOTICE '--- 191: create_cash_receipt đã vá, bỏ qua ---';
    RETURN;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, v_from, ''))) / length(v_from);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '191: thấy % điều kiện cấn trừ phiếu trả trong create_cash_receipt, cần đúng 1', v_n
      USING ERRCODE = 'P0001';
  END IF;
  v_src := replace(v_src, v_from,
    v_from
    || E'        -- (mig 191) Phiếu gắn hóa đơn đã trừ vào hóa đơn; phiếu độc lập đã là công nợ âm.\n'
    || E'        AND r.invoice_id IS NULL\n'
    || E'        AND NOT EXISTS (SELECT 1 FROM receivables rc2 WHERE rc2.return_id = r.id)\n');
  EXECUTE v_src;
END;
$p$;

-- 8. void_cash_receipt — trả `paid` đúng cho dòng âm; phiếu trả cấn cũ thành công nợ âm --
CREATE OR REPLACE FUNCTION public.void_cash_receipt(p_receipt_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      record;
  l      record;
  v_new  numeric;
  v_amt  numeric;
  v_due  date;
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
      -- ⚠ (mig 191) DÒNG ÂM KHÔNG KẸP `paid` VỀ 0. Dư có đã rút ghi `paid` âm
      --   (−50.000 rồi −30.000); kẹp `GREATEST(0, …)` thì huỷ phiếu thu thứ nhất
      --   trả lại cả phần của phiếu thứ hai.
      SELECT CASE WHEN COALESCE(rc.amount, 0) < 0 OR rc.return_id IS NOT NULL
                  THEN COALESCE(rc.paid, 0) - l.amount
                  ELSE GREATEST(0, COALESCE(rc.paid, 0) - l.amount) END,
             COALESCE(rc.amount, 0), rc.due_date
        INTO v_new, v_amt, v_due
      FROM receivables rc WHERE rc.id = l.receivable_id FOR UPDATE;

      -- ⚠ Q11 — NHÁNH 'paid' PHẢI ĐỨNG TRƯỚC: dòng dư (`paid >= amount`) không được
      --   rơi vào 'partial' và bị hút vào các phép cộng công nợ. Dòng âm do trigger
      --   `_cong_no_am_trang_thai` quyết.
      UPDATE receivables
      SET paid = v_new,
          status = CASE
                     WHEN v_amt - v_new <= 0 THEN 'paid'
                     WHEN v_new > 0          THEN 'partial'
                     WHEN v_due IS NOT NULL AND v_due < current_date THEN 'overdue'
                     ELSE 'open'
                   END
      WHERE id = l.receivable_id;
    END IF;
  END LOOP;

  UPDATE returns SET applied_receipt_id = NULL WHERE applied_receipt_id = p_receipt_id;
  -- (mig 191) Phiếu trả độc lập từng cấn ở phiếu thu này: khoản có quay về thành
  -- công nợ âm của khách, không nằm treo chờ ai chọn lại.
  PERFORM public._cong_no_phieu_tra(x.return_id)
  FROM (SELECT DISTINCT cl.return_id FROM cash_receipt_lines cl
        WHERE cl.receipt_id = p_receipt_id AND cl.return_id IS NOT NULL) x;

  UPDATE cash_receipts
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  WHERE id = p_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.void_cash_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_cash_receipt(uuid, text) TO authenticated;

-- 9. Ghi bù phiếu tự lập độc lập đã hoàn thành, chưa cấn ở phiếu thu nào -------
DO $bu$
DECLARE
  x record;
  n int := 0;
BEGIN
  FOR x IN
    SELECT ret.id
    FROM returns ret
    WHERE ret.status = 'completed'
      AND ret.invoice_id IS NULL AND ret.order_id IS NULL
      AND ret.applied_receipt_id IS NULL
      AND COALESCE(ret.credit_note_amount, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM receivables rc WHERE rc.return_id = ret.id)
  LOOP
    PERFORM public._cong_no_phieu_tra(x.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '191: ghi bù công nợ âm cho % phiếu trả độc lập', n;
  -- "Chờ xử lý" chỉ còn ở phiếu tự sinh: phiếu tự lập đang chờ về Nháp.
  UPDATE returns SET status = 'draft'
  WHERE status = 'submitted' AND NOT COALESCE(credit_with_invoice, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '191: % phiếu trả tự lập từ Chờ xử lý về Nháp', n;
  -- Chuẩn lại trạng thái các dòng âm theo trigger mới.
  UPDATE receivables SET amount = amount WHERE amount < 0;
  END;
$bu$;

NOTIFY pgrst, 'reload schema';

SELECT 'Luật phiếu trả tự sinh / tự lập' AS hang_muc,
       CASE WHEN position('RETURN_FOLLOWS_INVOICE' IN pg_get_functiondef('public.cancel_return(uuid, text)'::regprocedure)) > 0
                 AND position('_cong_no_phieu_tra' IN pg_get_functiondef('public.complete_return(uuid, text)'::regprocedure)) > 0
                 AND position('(mig 191) Phiếu tự lập không có Chờ xử lý' IN pg_get_functiondef('public.complete_return(uuid, text)'::regprocedure)) > 0
                 AND position('(mig 191)' IN pg_get_functiondef('public.create_cash_receipt(jsonb)'::regprocedure)) > 0
                 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_khoa_dong_tra_tu_sinh')
            THEN 'có' ELSE 'CHƯA' END AS trang_thai,
       (SELECT count(*) FROM receivables WHERE return_id IS NOT NULL) AS so_dong_du_co_phieu_tra,
       (SELECT count(*) FROM returns WHERE status = 'submitted' AND NOT COALESCE(credit_with_invoice, false)) AS phieu_tu_lap_con_cho_xu_ly;
