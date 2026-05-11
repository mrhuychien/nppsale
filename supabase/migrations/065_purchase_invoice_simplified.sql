-- ====================================================================
-- Mua hàng đơn giản hoá: hoá đơn nhập hàng đứng độc lập (không bắt
-- buộc qua đơn mua hàng PO).
--
-- Mô hình mới:
--   purchase_invoices: status ∈ ('draft','completed','cancelled')
--     - Lưu lần đầu → 'draft' (có thể sửa thoải mái).
--     - Từ draft bấm "Hoàn thành" → complete_purchase_invoice RPC:
--         + tạo công nợ NCC (payables)
--         + nhập kho (stock_entries type='import' status='posted' +
--           stock_entry_lines + bump/khởi tạo batches + cập nhật
--           unit_cost bình quân gia quyền)
--         + invoice.status = 'completed', set completed_at, payable_id,
--           stock_entry_id.
--     - completed → bất biến (không sửa).
--   purchase_invoice_lines: chi tiết hàng (SP, ĐVT, SL, đơn giá, VAT).
--
-- mig này cũng migrate trạng thái legacy: confirmed/paid → completed.
-- ====================================================================

-- 1) Cột bổ sung trên purchase_invoices ----------------------------------
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_entry_id uuid REFERENCES stock_entries(id);

-- Migrate legacy status rồi siết CHECK mới.
UPDATE purchase_invoices SET status = 'completed' WHERE status IN ('confirmed', 'paid');

-- Drop mọi CHECK constraint hiện có liên quan tới cột status.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'purchase_invoices'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE purchase_invoices DROP CONSTRAINT %I;', r.conname);
  END LOOP;
END $$;

ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_status_chk
  CHECK (status IN ('draft', 'completed', 'cancelled'));

-- 2) Bảng chi tiết hoá đơn nhập ------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  unit_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 0,
  -- Hệ số quy đổi sang base unit (1 thùng = 20 hộp → conversion_factor = 20)
  conversion_factor numeric NOT NULL DEFAULT 1,
  line_total numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pinv_lines_invoice ON purchase_invoice_lines(invoice_id);

ALTER TABLE purchase_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View pinv lines" ON purchase_invoice_lines;
CREATE POLICY "View pinv lines" ON purchase_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_invoices pi WHERE pi.id = invoice_id AND pi.org_id = public.user_org_id()));
DROP POLICY IF EXISTS "Manage pinv lines" ON purchase_invoice_lines;
CREATE POLICY "Manage pinv lines" ON purchase_invoice_lines FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse'));
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_invoice_lines TO authenticated;

-- 3) Mở rộng quyền manage purchase_invoices (cũ chỉ owner/accountant) ----
DROP POLICY IF EXISTS "Manage purchase invoices" ON purchase_invoices;
CREATE POLICY "Manage purchase invoices" ON purchase_invoices FOR ALL TO authenticated
  USING (public.user_role() IN ('owner', 'manager', 'accountant', 'warehouse'));
GRANT INSERT, UPDATE, DELETE ON purchase_invoices TO authenticated;

-- 4) RPC: hoàn thành hoá đơn nhập ----------------------------------------
CREATE OR REPLACE FUNCTION complete_purchase_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_status text;
  v_supplier uuid;
  v_inv_number text;
  v_inv_date date;
  v_total numeric;
  v_uid uuid := auth.uid();
  v_entry_id uuid;
  v_payable_id uuid;
  v_seq int := 0;
  v_batch_id uuid;
  v_base_qty numeric;
  v_unit_cost numeric;
  v_old_qty numeric;
  v_old_cost numeric;
  v_new_qty numeric;
  v_new_cost numeric;
  v_shelf int;
  r record;
BEGIN
  SELECT org_id, status, supplier_id, invoice_number, invoice_date, total
    INTO v_org, v_status, v_supplier, v_inv_number, v_inv_date, v_total
  FROM purchase_invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_org <> public.user_org_id() THEN
    RAISE EXCEPTION 'ORG_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'completed' THEN
    RETURN p_invoice_id;  -- idempotent
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'INVOICE_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_invoice_lines WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'INVOICE_HAS_NO_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- 4.1 Phiếu nhập kho
  INSERT INTO stock_entries (org_id, entry_code, type, status, posted_at, created_by, supplier_id, notes)
  VALUES (
    v_org,
    'NK-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD-HH24MISS'),
    'import', 'posted', now(), v_uid, v_supplier,
    'Nhập kho từ hoá đơn mua ' || COALESCE(v_inv_number, p_invoice_id::text)
  )
  RETURNING id INTO v_entry_id;

  v_seq := 0;
  FOR r IN
    SELECT l.id, l.product_id, l.unit_name, l.quantity, l.unit_price,
           l.conversion_factor, p.base_unit, p.shelf_life_days
    FROM purchase_invoice_lines l
    JOIN products p ON p.id = l.product_id
    WHERE l.invoice_id = p_invoice_id
  LOOP
    v_seq := v_seq + 1;
    v_base_qty := COALESCE(r.quantity, 0) * COALESCE(r.conversion_factor, 1);
    -- Đơn giá theo base unit để tính unit_cost.
    v_unit_cost := CASE WHEN COALESCE(r.conversion_factor, 1) > 0
                        THEN COALESCE(r.unit_price, 0) / COALESCE(r.conversion_factor, 1)
                        ELSE COALESCE(r.unit_price, 0) END;
    v_shelf := COALESCE(r.shelf_life_days, 0);

    -- Tạo batch mới cho lần nhập này (1 hoá đơn = 1 batch / SP).
    INSERT INTO batches (
      org_id, product_id, batch_code, manufactured_at, expires_at,
      qty_initial, qty_on_hand, status, unit_cost
    ) VALUES (
      v_org, r.product_id,
      'B-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0'),
      CURRENT_DATE,
      CASE WHEN v_shelf > 0 THEN CURRENT_DATE + v_shelf ELSE DATE '2099-12-31' END,
      v_base_qty, v_base_qty, 'available', v_unit_cost
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO stock_entry_lines (entry_id, product_id, batch_id, unit_name, quantity, unit_cost)
    VALUES (v_entry_id, r.product_id, v_batch_id, r.unit_name, v_base_qty, v_unit_cost);
  END LOOP;

  -- 4.2 Công nợ NCC
  INSERT INTO payables (org_id, supplier_id, stock_entry_id, invoice_number, amount, paid, status, notes)
  VALUES (
    v_org, v_supplier, v_entry_id, v_inv_number, COALESCE(v_total, 0), 0, 'open',
    'Hoá đơn mua hàng ' || COALESCE(v_inv_number, p_invoice_id::text)
  )
  RETURNING id INTO v_payable_id;

  -- 4.3 Đóng hoá đơn
  UPDATE purchase_invoices
  SET status = 'completed', completed_at = now(),
      stock_entry_id = v_entry_id, payable_id = v_payable_id
  WHERE id = p_invoice_id;

  RETURN p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_purchase_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_purchase_invoice(uuid) TO authenticated;

COMMENT ON FUNCTION complete_purchase_invoice(uuid) IS
  'Hoàn thành hoá đơn nhập: tạo payables + stock_entries (import,posted) + batches, chuyển status sang completed.';
