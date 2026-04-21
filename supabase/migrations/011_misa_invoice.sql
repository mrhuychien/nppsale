-- Customer billing fields for VAT invoice
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_method_label text DEFAULT 'Chuyển khoản';

-- Invoice MISA integration fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_invoice_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_invoice_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_status text CHECK (misa_status IN ('pending','sent','signed','error'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_error text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS misa_signed_at timestamptz;
