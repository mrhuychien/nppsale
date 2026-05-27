-- ====================================================================
-- MISA WebAPI v2 — thêm cờ "có mã CQT".
--
-- Lấy từ response /oauth (field IsInvoiceWithCode). Quyết định path:
-- - true  → /v3sainvoice/Code
-- - false → /v3sainvoice
-- Tự fill khi user bấm Test kết nối, không cần nhập tay.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS misa_is_invoice_with_code boolean DEFAULT false;

COMMENT ON COLUMN company_einvoice_config.misa_is_invoice_with_code IS
  'Cờ "hoá đơn có mã CQT" — lấy tự động từ response /oauth.';
