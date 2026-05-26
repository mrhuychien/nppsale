-- ====================================================================
-- MISA meInvoice — hoá đơn điện tử (e-invoice) GTGT.
--
-- 1) company_einvoice_config: cấu hình tài khoản MISA theo từng NPP
--    (org). Username/password lưu mã hoá (AES-256-GCM, key =
--    EINVOICE_ENC_KEY) — cột *_enc chứa ciphertext base64.
-- 2) einvoice_logs: audit trail MỌI lần gọi MISA (success/failed/
--    pending) — nguồn debug duy nhất khi MISA trả lỗi.
-- 3) invoices.misa_lookup_code: mã tra cứu MISA (idempotency flag).
-- ====================================================================

-- 1) Cấu hình MISA theo NPP --------------------------------------------
CREATE TABLE IF NOT EXISTS company_einvoice_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'misa',
  api_base text NOT NULL DEFAULT 'https://app.meinvoice.vn',
  -- Thông tin người bán in trên hoá đơn
  tax_code text,                       -- MST người bán
  seller_name text,                    -- tên công ty (fallback: org.name)
  seller_address text,
  -- Định danh MISA meInvoice
  misa_company_id text,                -- vd 156217
  misa_org_unit_id text,
  misa_template_id text,
  misa_user_id text,
  misa_inv_series text,                -- vd 1C26THG (kí hiệu theo năm)
  misa_inv_template_no text NOT NULL DEFAULT '1',
  -- Credentials (mã hoá at rest)
  username_enc text,
  password_enc text,
  sandbox boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE company_einvoice_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View einvoice config" ON company_einvoice_config;
CREATE POLICY "View einvoice config" ON company_einvoice_config FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));
DROP POLICY IF EXISTS "Manage einvoice config" ON company_einvoice_config;
CREATE POLICY "Manage einvoice config" ON company_einvoice_config FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON company_einvoice_config TO authenticated;

-- 2) Audit log mọi lần gọi MISA ----------------------------------------
CREATE TABLE IF NOT EXISTS einvoice_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  request_payload jsonb,
  response_payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('success','failed','pending')),
  error_message text,
  misa_lookup_code text,
  misa_inv_no text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_org ON einvoice_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_invoice ON einvoice_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_einvoice_logs_order ON einvoice_logs(order_id);

ALTER TABLE einvoice_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View einvoice logs" ON einvoice_logs;
CREATE POLICY "View einvoice logs" ON einvoice_logs FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));
DROP POLICY IF EXISTS "Manage einvoice logs" ON einvoice_logs;
CREATE POLICY "Manage einvoice logs" ON einvoice_logs FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_role() IN ('owner','accountant','manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON einvoice_logs TO authenticated;

-- 3) Mã tra cứu MISA trên invoices (idempotency) -----------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS misa_lookup_code text,
  ADD COLUMN IF NOT EXISTS misa_published_at timestamptz;

COMMENT ON COLUMN invoices.misa_lookup_code IS
  'Mã tra cứu hoá đơn MISA — cờ idempotency: đã có thì không phát hành lại.';
