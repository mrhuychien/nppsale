-- ====================================================================
-- Bugfix: returns.credit_note_amount must EXCLUDE return_lines where
-- is_exchange=true. Đổi hàng = vật chất ra/vào, không động đến công nợ.
--
-- Hiện tượng người dùng báo: "có 1 mã đổi hàng + 1 mã trả hàng trừ
-- công nợ, nhưng tính cả 2 là trừ công nợ". Nguyên nhân: credit_note_
-- amount được set thủ công ở một số path (mig 035 chưa enforce auto-
-- compute), nên các phiếu cũ hoặc nhập tay có thể sai.
--
-- Fix:
--   1. SQL function compute_return_credit(return_id) tính sum line_total
--      của các return_lines KHÔNG phải exchange.
--   2. Trigger trên return_lines (INSERT/UPDATE/DELETE) recompute
--      credit_note_amount của return parent. Trở thành source-of-truth
--      cho mọi flow tạo/sửa return.
--   3. One-time backfill: cập nhật mọi returns hiện tại theo công thức
--      trên — sẽ giảm credit_note_amount của các return có lines
--      is_exchange=true.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Compute helper. Returns 0 when the return has no lines (returns
--    can also be header-only credit notes — those keep their manually-
--    set credit_note_amount; trigger only kicks in when lines exist).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_return_credit(p_return_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    SUM(
      CASE
        WHEN COALESCE(rl.is_exchange, false) THEN 0
        ELSE COALESCE(rl.line_total, COALESCE(rl.unit_price, 0) * COALESCE(rl.quantity, 0))
      END
    ),
    0
  )::numeric
  FROM return_lines rl
  WHERE rl.return_id = p_return_id;
$$;

COMMENT ON FUNCTION compute_return_credit(uuid) IS
  'Bugfix: tổng line_total của return_lines KHÔNG đánh dấu is_exchange. Đổi hàng không trừ công nợ.';

-- --------------------------------------------------------------------
-- 2. Trigger: recompute credit_note_amount whenever lines change.
--    Only sets credit_note_amount when at least 1 line exists — header-
--    only credit notes (no lines) keep manual value.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_return_credit_note_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_return_id uuid;
  v_line_count int;
  v_credit numeric;
BEGIN
  v_return_id := COALESCE(NEW.return_id, OLD.return_id);
  IF v_return_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT COUNT(*) INTO v_line_count
  FROM return_lines WHERE return_id = v_return_id;

  IF v_line_count = 0 THEN
    -- All lines deleted — leave credit_note_amount alone (could be a
    -- header-only credit note now).
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  v_credit := compute_return_credit(v_return_id);

  UPDATE returns
  SET credit_note_amount = v_credit
  WHERE id = v_return_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_return_credit ON return_lines;
CREATE TRIGGER trg_sync_return_credit
  AFTER INSERT OR UPDATE OR DELETE ON return_lines
  FOR EACH ROW
  EXECUTE FUNCTION sync_return_credit_note_amount();

-- --------------------------------------------------------------------
-- 3. One-time backfill — recompute every return that has at least 1
--    line. Header-only credit notes keep manual amount.
-- --------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_old numeric;
  v_new numeric;
  v_diff_count int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT return_id FROM return_lines
  LOOP
    SELECT credit_note_amount INTO v_old FROM returns WHERE id = r.return_id;
    v_new := compute_return_credit(r.return_id);
    IF v_old IS DISTINCT FROM v_new THEN
      UPDATE returns SET credit_note_amount = v_new WHERE id = r.return_id;
      v_diff_count := v_diff_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfilled credit_note_amount for % returns', v_diff_count;
END $$;

-- --------------------------------------------------------------------
-- 4. Recompute receivables for every order whose return changed —
--    keep AR consistent with the new credit_note_amount.
--    We touch only orders that have at least 1 return.
-- --------------------------------------------------------------------
DO $$
DECLARE
  o record;
  v_total numeric;
  v_credits numeric;
  v_paid numeric;
  v_net numeric;
  v_status text;
BEGIN
  FOR o IN
    SELECT DISTINCT so.id AS order_id, so.total
    FROM sales_orders so
    JOIN returns r ON r.order_id = so.id
  LOOP
    SELECT COALESCE(SUM(credit_note_amount), 0)
      INTO v_credits
    FROM returns
    WHERE order_id = o.order_id
      AND status IN ('approved', 'completed');

    v_net := GREATEST(0, COALESCE(o.total, 0) - v_credits);

    SELECT COALESCE(paid, 0) INTO v_paid
    FROM receivables
    WHERE order_id = o.order_id
    LIMIT 1;
    v_paid := COALESCE(v_paid, 0);

    v_status := CASE
      WHEN v_paid >= v_net THEN 'paid'
      WHEN v_paid > 0      THEN 'partial'
      ELSE 'open'
    END;

    UPDATE receivables
    SET amount = v_net,
        status = v_status
    WHERE order_id = o.order_id;
  END LOOP;
END $$;
