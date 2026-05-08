-- ====================================================================
-- 035_return_exchange
--
-- Cho phép NV tick "Đổi hàng" trên dòng hàng trả: dòng trả là 1 SP
-- khách trả lại (vì hư / sai / muốn đổi), nhưng KHÔNG trừ vào công
-- nợ — chỉ xuất hiện trên phiếu giao để lái xe biết cần thu lại.
--
-- Quy tắc:
--   • is_exchange = true: dòng trả là phần đổi hàng, value KHÔNG cộng
--     vào credit_note_amount của bảng returns.
--   • is_exchange = false (default): dòng trả thật, sẽ trừ công nợ.
--
-- Khi tạo đơn, OrderForm tự tính credit_note_amount = sum(line_total)
-- của các dòng KHÔNG đổi-hàng. Trigger bên dưới đảm bảo invariant ngay
-- cả nếu UI quên tính.
-- ====================================================================

ALTER TABLE return_lines
  ADD COLUMN IF NOT EXISTS is_exchange boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN return_lines.is_exchange IS
  'True = đổi hàng (in trên phiếu giao, không trừ công nợ). False = trả tiền.';

CREATE INDEX IF NOT EXISTS idx_return_lines_exchange
  ON return_lines(return_id, is_exchange) WHERE is_exchange = true;

-- Recompute credit_note_amount on returns whenever its lines change.
CREATE OR REPLACE FUNCTION sync_return_credit_amount()
RETURNS TRIGGER AS $$
DECLARE
  v_return_id uuid;
  v_total numeric;
BEGIN
  v_return_id := COALESCE(NEW.return_id, OLD.return_id);
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM return_lines
  WHERE return_id = v_return_id
    AND is_exchange = false;
  UPDATE returns SET credit_note_amount = v_total WHERE id = v_return_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_return_lines_sync_credit ON return_lines;
CREATE TRIGGER trg_return_lines_sync_credit
  AFTER INSERT OR UPDATE OR DELETE ON return_lines
  FOR EACH ROW EXECUTE FUNCTION sync_return_credit_amount();
