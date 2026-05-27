-- ====================================================================
-- MISA WebAPI v2 — sync code với doc HDGTGT.html:
-- - publish_path đổi default sang /v3sainvoice (không phải SAInvoice/Insert).
-- - Thêm invoice_type (int, default 1 = HĐ GTGT bán hàng).
-- - Thêm is_inherit_from_old_template (bool, default false).
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS invoice_type smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_inherit_from_old_template boolean NOT NULL DEFAULT false;

-- Reset publish_path NULL hoặc đang trỏ tới SAInvoice/Insert (sai) → v3sainvoice.
UPDATE company_einvoice_config
SET publish_path = '/v3sainvoice'
WHERE publish_path IS NULL OR publish_path = '' OR publish_path LIKE '%SAInvoice/Insert%';

COMMENT ON COLUMN company_einvoice_config.invoice_type IS
  'InvoiceType MISA: 1=HĐ GTGT bán hàng (mặc định). Lấy từ "Lấy danh sách mẫu HD".';
COMMENT ON COLUMN company_einvoice_config.is_inherit_from_old_template IS
  'IsInheritFromOldTemplate: theo response "Lấy danh sách mẫu HD".';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'Endpoint đẩy HĐ nháp WebAPI v2 — mặc định /v3sainvoice. Dùng /v3sainvoice/Code nếu HĐ có mã CQT.';
