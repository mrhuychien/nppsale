-- ====================================================================
-- Hoá đơn trả hàng NCC (supplier returns).
--
-- Mô hình mirror purchase_invoices nhưng đảo chiều:
--   supplier_returns:
--     status ∈ ('draft','completed','cancelled')
--     warehouse_zone ∈ ('sale','date')  — mặc định 'date' (kho hàng date)
--     Draft → bấm "Gửi phiếu" → complete_supplier_return RPC:
--       + xuất kho (stock_entries type='export' status='posted') —
--         FIFO theo expires_at trong zone đã chọn; trừ qty_on_hand;
--         tạo 1 stock_entry_line cho mỗi batch tiêu thụ.
--       + ghi giảm công nợ NCC: tạo payables row amount=-total,
--         status='open', paid=0 — net balance NCC sẽ giảm theo.
--       + return.status = 'completed', set completed_at,
--         stock_entry_id, payable_credit_id.
--     completed → bất biến.
--   supplier_return_lines: chi tiết SP (giống purchase_invoice_lines).
-- ====================================================================

-- 1) Bảng header --------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  return_code text,                       -- "TH-YYMMDD-####" tự sinh khi gửi
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,                            -- damaged / near_expiry / wrong_item / other
  notes text,
  subtotal numeric NOT NULL DEFAULT 0,
  vat numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed', 'cancelled')),
  -- Xuất từ kho nào (zone của batch): 'sale' hoặc 'date'.
  warehouse_zone text NOT NULL DEFAULT 'date'
    CHECK (warehouse_zone IN ('sale', 'date')),
  -- Liên kết sau khi complete:
  stock_entry_id uuid REFERENCES stock_entries(id),
  payable_credit_id uuid REFERENCES payables(id),
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_returns_org ON supplier_returns(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_returns_supplier ON supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sup_returns_status ON supplier_returns(status);

-- 2) Bảng line ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 0,
  -- 1 thùng = 20 hộp → conversion_factor = 20; qty trên batch tính bằng
  -- base unit nên cần factor để quy đổi.
  conversion_factor numeric NOT NULL DEFAULT 1,
  line_total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_return_lines_return ON supplier_return_lines(return_id);

-- 3) RLS ----------------------------------------------------------------
ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View supplier returns" ON supplier_returns;
CREATE POLICY "View supplier returns" ON supplier_returns FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS "Manage supplier returns" ON supplier_returns;
CREATE POLICY "Manage supplier returns" ON supplier_returns FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','manager','accountant','warehouse'));

DROP POLICY IF EXISTS "View supplier return lines" ON supplier_return_lines;
CREATE POLICY "View supplier return lines" ON supplier_return_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM supplier_returns r WHERE r.id = return_id AND r.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage supplier return lines" ON supplier_return_lines;
CREATE POLICY "Manage supplier return lines" ON supplier_return_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner','manager','accountant','warehouse'));

GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_return_lines TO authenticated;

-- 4) RPC: hoàn thành phiếu trả ------------------------------------------
CREATE OR REPLACE FUNCTION complete_supplier_return(p_return_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_zone text;
  v_total numeric;
  v_return_code text;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_base_qty numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, warehouse_zone, total, return_code
    INTO v_org, v_status, v_supplier, v_zone, v_total, v_return_code
  FROM supplier_returns WHERE id = p_return_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_RETURN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_return_id;  -- idempotent
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'RETURN_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supplier_return_lines WHERE return_id = p_return_id) THEN
    RAISE EXCEPTION 'RETURN_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- Sinh return_code nếu chưa có
  IF v_return_code IS NULL OR v_return_code = '' THEN
    v_return_code := 'TH-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS');
    UPDATE supplier_returns SET return_code = v_return_code WHERE id = p_return_id;
  END IF;

  -- 4.1 Tạo phiếu xuất kho
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'XK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'export', 'posted', now(), v_uid, v_supplier,
    'Xuất kho trả NCC — phiếu ' || v_return_code || ' (zone: ' || v_zone || ')'
  )
  RETURNING id INTO v_entry_id;

  -- 4.2 Trừ kho theo FIFO trong zone đã chọn
  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.conversion_factor
    FROM supplier_return_lines l
    WHERE l.return_id = p_return_id
  LOOP
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    v_need := v_base_qty;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_batch IN
      SELECT id, qty_on_hand, unit_cost
      FROM batches
      WHERE org_id = v_org
        AND product_id = r.product_id
        AND warehouse_zone = v_zone
        AND COALESCE(status, 'available') = 'available'
        AND qty_on_hand > 0
      ORDER BY expires_at NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_on_hand);

      UPDATE batches
      SET qty_on_hand = qty_on_hand - v_take
      WHERE id = v_batch.id;

      v_seq := v_seq + 1;
      INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost)
      VALUES (v_entry_id, r.product_id, v_batch.id, r.unit_name, v_take, COALESCE(v_batch.unit_cost, 0));

      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING
        ERRCODE = 'P0001',
        DETAIL = format('product_id=%s zone=%s thiếu %s đơn vị cơ sở', r.product_id, v_zone, v_need);
    END IF;
  END LOOP;

  -- 4.3 Ghi giảm công nợ NCC (credit memo)
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_return_code,
    -COALESCE(v_total, 0), 0, 'open',
    'Hoàn trả NCC — phiếu ' || v_return_code
  )
  RETURNING id INTO v_payable_id;

  -- 4.4 Đóng phiếu trả
  UPDATE supplier_returns
  SET status = 'completed',
      completed_at = now(),
      completed_by = v_uid,
      stock_entry_id = v_entry_id,
      payable_credit_id = v_payable_id
  WHERE id = p_return_id;

  RETURN p_return_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_supplier_return(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_supplier_return(uuid) TO authenticated;

COMMENT ON FUNCTION complete_supplier_return(uuid) IS
  'Hoàn thành phiếu trả NCC: xuất kho FIFO trong zone đã chọn + tạo credit memo giảm công nợ NCC.';
