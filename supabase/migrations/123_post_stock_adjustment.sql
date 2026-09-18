-- ---------------------------------------------------------------------
-- 123 — Duyệt phiếu kiểm kê: đưa về MỘT RPC, một giao dịch
--
-- TRIỆU CHỨNG (chủ NPP báo): bấm "Duyệt điều chỉnh", màn báo
--   "Đã duyệt … Kho đã cập nhật" — mà tồn kho KHÔNG đổi một con số nào.
-- ---------------------------------------------------------------------
--
-- NGUYÊN NHÂN: bất đối xứng quyền, cộng với cái bẫy cũ của cả dự án này —
-- RLS TỪ CHỐI LÀ 0 DÒNG, HTTP 200, `error` NULL.
--
-- Nút "Duyệt điều chỉnh" mở cho `owner` và `manager`
-- (`canApprove` ở màn `/inventory/adjustments`). Nhưng policy của
-- `batches` (mig 002) và `stock_entries` (mig 002) chỉ cho
-- `owner` và `warehouse` GHI. Với một người dùng vai `manager`:
--
--   | Bước                    | Bảng            | manager | Kết quả        |
--   |-------------------------|-----------------|---------|----------------|
--   | 1. cộng/trừ tồn         | `batches`       | KHÔNG   | 0 dòng, im lặng|
--   | 2. ghi chi phí hao hụt  | `expenses`      | CÓ      | **GHI THẬT**   |
--   | 3. đóng dấu đã duyệt    | `stock_entries` | KHÔNG   | 0 dòng, im lặng|
--
-- `.throwOnError()` của supabase-js chỉ ném khi `error` KHÁC NULL. RLS từ
-- chối không phải là lỗi — nó là "không có dòng nào khớp". Nên cả ba
-- bước trôi qua êm, và giao diện báo thành công.
--
-- ⚠ HẬU QUẢ TỆ HƠN "KHÔNG ĐỔI GÌ": bước 2 CHẠY ĐƯỢC. Sổ chi phí ghi một
--   khoản hao hụt mà kho không hề giảm — sách và hàng lệch nhau đúng
--   bằng số đó. Và vì bước 3 không chạy, phiếu vẫn nằm ở "chờ duyệt":
--   bấm lại lần nữa là ghi thêm MỘT khoản chi phí trùng nữa. Bấm ba lần,
--   ba khoản.
--
-- ⚠ VÌ SAO KHÔNG AI PHÁT HIỆN SỚM: với vai `owner` thì cả ba bước đều
--   chạy đúng. Người thử nghiệm thường là chủ NPP.
--
-- ---------------------------------------------------------------------
-- CÁCH SỬA: không vá quyền, mà bỏ hẳn vòng lặp ghi từ trình duyệt.
--
-- Bản cũ đọc `batches` rồi ghi lại từng lô một, mỗi lô một lượt mạng.
-- Ngoài chuyện quyền, nó còn ba lỗi nữa mà RPC này xoá bỏ cùng lúc:
--   · KHÔNG PHẢI MỘT GIAO DỊCH — hỏng giữa chừng thì vài lô đã đổi, phiếu
--     chưa đóng dấu, và lần bấm sau cộng chồng lên phần đã cộng;
--   · ĐỌC RỒI GHI (`select qty_on_hand` … `update`) — hai người duyệt hai
--     phiếu cùng lúc thì một người ghi đè mất phần của người kia;
--   · `Math.max(0, current + diff)` KẸP ÂM TRONG IM LẶNG — tồn đã đổi từ
--     lúc kiểm đếm thì phần chênh biến mất, không ai được báo.
--
-- Coder Pack, mục quy ước: "Mọi thao tác đụng tồn kho / công nợ / trạng
-- thái đơn PHẢI đi qua RPC SECURITY DEFINER, một transaction, idempotent.
-- Không loop update từ browser."
-- ---------------------------------------------------------------------

-- --------------------------------------------------------------------
-- Mở ô quyền `inventory.approve` cho quản lý.
--
-- ⚠ `user_has_permission` trả FALSE khi `role_permissions` chưa có dòng
--   (xem mig 120, mục 0c) — không seed thì sau migration này quản lý bấm
--   Duyệt sẽ nhận 'FORBIDDEN', đúng cái nút giao diện vẫn hiện.
--
-- ⚠ KHÔNG mở cho `warehouse`, và đó là CỐ Ý: kho là người ĐẾM. Cho người
--   đếm tự duyệt phần chênh của chính mình là bỏ mất lớp soát duy nhất
--   trên một thao tác ghi thẳng vào tồn kho và sổ chi phí.
-- --------------------------------------------------------------------
INSERT INTO role_permissions (org_id, role, module, action, allowed)
SELECT o.id, 'manager', 'inventory', 'approve', true
FROM organizations o
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------
-- post_stock_adjustment — duyệt một phiếu kiểm kê.
--
-- Trả về số lô đã đụng, tổng hao hụt và tổng thừa, để giao diện NÓI ĐÚNG
-- việc vừa xảy ra thay vì đoán.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.post_stock_adjustment(uuid);
CREATE FUNCTION public.post_stock_adjustment(p_entry_id uuid)
RETURNS TABLE (
  batches_touched int,
  shrink_qty      numeric,
  shrink_value    numeric,
  surplus_qty     numeric,
  surplus_value   numeric,
  expense_id      uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            record;
  l            record;
  b            record;
  v_org        uuid := public.user_org_id();
  v_touched    int := 0;
  v_shrink_q   numeric := 0;
  v_shrink_v   numeric := 0;
  v_surplus_q  numeric := 0;
  v_surplus_v  numeric := 0;
  v_exp        uuid;
  v_cat        uuid;
  v_left       numeric;
  v_take       numeric;
  v_target     uuid;
  v_cost       numeric;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: tài khoản chưa gắn đơn vị, hoặc đã bị khoá'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO e FROM stock_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENTRY_NOT_FOUND: không tìm thấy phiếu kiểm kê'
      USING ERRCODE = 'P0001';
  END IF;
  IF e.org_id <> v_org THEN
    RAISE EXCEPTION 'ORG_MISMATCH: phiếu không thuộc đơn vị của bạn'
      USING ERRCODE = 'P0001';
  END IF;

  -- ⚠ CHỐT IDEMPOTENT. `FOR UPDATE` ở trên khoá dòng phiếu, nên hai lần
  --   bấm song song thì người thứ hai chờ, rồi đọc được `status` đã đổi
  --   và dừng ở đây. Không có chốt này, hai lần bấm là cộng tồn hai lần.
  IF e.status = 'posted' THEN
    RAISE EXCEPTION 'ALREADY_POSTED: phiếu % đã được duyệt lúc %',
      e.entry_code, to_char(e.posted_at, 'HH24:MI DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
  IF e.status <> 'draft' THEN
    RAISE EXCEPTION 'BAD_STATUS: phiếu % đang ở trạng thái %, không duyệt được',
      e.entry_code, e.status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.user_has_permission(auth.uid(), 'inventory.approve') THEN
    RAISE EXCEPTION 'FORBIDDEN: bạn không có quyền duyệt điều chỉnh kho'
      USING ERRCODE = 'P0001';
  END IF;

  -- ==================================================================
  -- Áp từng dòng chênh lệch.
  -- ==================================================================
  FOR l IN
    SELECT sel.id, sel.product_id, sel.batch_id, sel.quantity,
           COALESCE(sel.unit_cost, 0) AS unit_cost,
           p.name AS product_name
    FROM stock_entry_lines sel
    LEFT JOIN products p ON p.id = sel.product_id
    WHERE sel.entry_id = p_entry_id
    ORDER BY sel.id
  LOOP
    CONTINUE WHEN COALESCE(l.quantity, 0) = 0;

    v_cost := l.unit_cost;

    IF l.batch_id IS NOT NULL THEN
      -- --------------------------------------------------------------
      -- Dòng có lô rõ ràng: cộng/trừ thẳng vào đúng lô đã đếm.
      -- --------------------------------------------------------------
      SELECT id, qty_on_hand, COALESCE(unit_cost, 0) AS unit_cost
        INTO b
      FROM batches WHERE id = l.batch_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'BATCH_GONE: lô của dòng "%" không còn tồn tại',
          COALESCE(l.product_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;

      -- ⚠ KHÔNG KẸP ÂM TRONG IM LẶNG. Bản cũ làm `GREATEST(0, …)` nên
      --   phần chênh biến mất mà không ai biết. Tồn đã đổi từ lúc kiểm
      --   đếm là chuyện CẦN NGƯỜI XEM, không phải chuyện để nuốt.
      IF COALESCE(b.qty_on_hand, 0) + l.quantity < 0 THEN
        RAISE EXCEPTION
          'STOCK_MOVED: "%" tồn hiện %, phiếu trừ % — tồn đã đổi từ lúc kiểm đếm. Kiểm đếm lại rồi lập phiếu mới.',
          COALESCE(l.product_name, l.product_id::text),
          COALESCE(b.qty_on_hand, 0), -l.quantity
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE batches
      SET qty_on_hand = COALESCE(qty_on_hand, 0) + l.quantity
      WHERE id = l.batch_id;
      v_touched := v_touched + 1;
      IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;

    ELSIF l.quantity < 0 THEN
      -- --------------------------------------------------------------
      -- Hao hụt không rõ lô → trừ theo FEFO (hạn gần nhất trước).
      -- --------------------------------------------------------------
      v_left := -l.quantity;
      FOR b IN
        SELECT id, qty_on_hand, COALESCE(unit_cost, 0) AS unit_cost
        FROM batches
        WHERE org_id = v_org AND product_id = l.product_id
          AND COALESCE(qty_on_hand, 0) > 0
        ORDER BY expires_at NULLS LAST, id
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(COALESCE(b.qty_on_hand, 0), v_left);
        UPDATE batches SET qty_on_hand = COALESCE(qty_on_hand, 0) - v_take WHERE id = b.id;
        -- Ghi lại lô đã bị trừ — không có vết này thì không ai đối chiếu
        -- được về sau là phiếu đã đụng vào đâu.
        UPDATE stock_entry_lines SET batch_id = b.id WHERE id = l.id AND batch_id IS NULL;
        IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;
        v_left := v_left - v_take;
        v_touched := v_touched + 1;
      END LOOP;

      IF v_left > 0 THEN
        RAISE EXCEPTION
          'NOT_ENOUGH_STOCK: "%" chỉ còn % để trừ, phiếu trừ % — kiểm đếm lại.',
          COALESCE(l.product_name, l.product_id::text),
          -l.quantity - v_left, -l.quantity
          USING ERRCODE = 'P0001';
      END IF;

    ELSE
      -- --------------------------------------------------------------
      -- Thừa không rõ lô → cộng vào lô còn hạn XA NHẤT.
      --
      -- ⚠ BẢN CŨ BỎ QUA TRONG IM LẶNG khi sản phẩm chưa có lô nào. Phần
      --   thừa biến mất, phiếu vẫn đóng dấu đã duyệt. Ở đây nói ra.
      -- --------------------------------------------------------------
      SELECT id, COALESCE(unit_cost, 0) AS unit_cost INTO b
      FROM batches
      WHERE org_id = v_org AND product_id = l.product_id
      ORDER BY expires_at DESC NULLS LAST, id
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'NO_BATCH: "%" chưa có lô nào để ghi phần thừa. Tạo lô cho sản phẩm này trước.',
          COALESCE(l.product_name, l.product_id::text)
          USING ERRCODE = 'P0001';
      END IF;

      v_target := b.id;
      UPDATE batches SET qty_on_hand = COALESCE(qty_on_hand, 0) + l.quantity WHERE id = v_target;
      UPDATE stock_entry_lines SET batch_id = v_target WHERE id = l.id AND batch_id IS NULL;
      IF v_cost = 0 THEN v_cost := b.unit_cost; END IF;
      v_touched := v_touched + 1;
    END IF;

    IF l.quantity < 0 THEN
      v_shrink_q := v_shrink_q + (-l.quantity);
      v_shrink_v := v_shrink_v + (-l.quantity) * v_cost;
    ELSE
      v_surplus_q := v_surplus_q + l.quantity;
      v_surplus_v := v_surplus_v + l.quantity * v_cost;
    END IF;
  END LOOP;

  -- ==================================================================
  -- Chi phí hao hụt — CÙNG giao dịch với phần trừ kho.
  --
  -- ⚠ Bản cũ ghi chi phí ở một lượt mạng riêng, TRƯỚC khi đóng dấu
  --   phiếu. Hỏng ở bước sau là sổ có chi phí mà phiếu vẫn "chờ duyệt".
  -- ==================================================================
  IF v_shrink_v > 0 THEN
    SELECT id INTO v_cat FROM expense_categories
    WHERE org_id = v_org AND code = 'COGS_ADJ' LIMIT 1;
    IF v_cat IS NULL THEN
      SELECT id INTO v_cat FROM expense_categories WHERE org_id = v_org ORDER BY code LIMIT 1;
    END IF;

    INSERT INTO expenses (
      org_id, category_id, expense_date, amount, description,
      reference_code, source_type, source_id, created_by
    ) VALUES (
      v_org, v_cat, CURRENT_DATE, v_shrink_v,
      'Hao hụt từ phiếu kiểm kê ' || e.entry_code,
      e.entry_code, 'stocktake', e.id, auth.uid()
    )
    RETURNING id INTO v_exp;
  END IF;

  UPDATE stock_entries
  SET status = 'posted', posted_at = now()
  WHERE id = p_entry_id;

  RETURN QUERY SELECT v_touched, v_shrink_q, v_shrink_v, v_surplus_q, v_surplus_v, v_exp;
END;
$$;

REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid) TO authenticated;

COMMENT ON FUNCTION public.post_stock_adjustment(uuid) IS
  'Duyệt phiếu kiểm kê trong MỘT giao dịch: cộng/trừ tồn theo từng dòng, '
  'ghi chi phí hao hụt, đóng dấu phiếu. Idempotent bằng khoá dòng phiếu '
  'và chốt ALREADY_POSTED. Thay cho vòng lặp ghi từ trình duyệt — vòng '
  'lặp đó im lặng khi RLS từ chối (0 dòng, HTTP 200, error null).';

NOTIFY pgrst, 'reload schema';

-- --------------------------------------------------------------------
-- Đếm thiệt hại đã có: phiếu kiểm kê nào ĐÃ ghi chi phí hao hụt mà chưa
-- được đóng dấu duyệt — dấu vết của đúng cái lỗi này.
-- --------------------------------------------------------------------
DO $$
DECLARE r record; v_n int := 0; v_sum numeric := 0;
BEGIN
  FOR r IN
    SELECT se.entry_code, count(*) AS n, sum(x.amount) AS amt
    FROM stock_entries se
    JOIN expenses x ON x.source_type = 'stocktake' AND x.source_id = se.id
    WHERE se.status <> 'posted'
    GROUP BY se.entry_code
    ORDER BY se.entry_code
  LOOP
    v_n := v_n + 1;
    v_sum := v_sum + COALESCE(r.amt, 0);
    RAISE NOTICE '123 ⚠ phiếu % chưa duyệt nhưng đã có % khoản chi phí hao hụt, tổng %đ', r.entry_code, r.n, r.amt;
  END LOOP;

  IF v_n = 0 THEN
    RAISE NOTICE '--- 123: không có phiếu kiểm kê nào dính lỗi ghi chi phí mà không trừ kho ---';
  ELSE
    RAISE NOTICE '--- 123 ⚠ % phiếu dính lỗi, tổng chi phí ghi khống %đ. Migration KHÔNG tự xoá — xem lại từng phiếu rồi quyết. ---', v_n, v_sum;
  END IF;
END $$;
