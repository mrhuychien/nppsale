-- ====================================================================
-- MISA meInvoice — cho phép cấu hình API endpoint paths qua UI.
--
-- Lý do: path /auth/token & /api/v1/invoices ở client.ts là placeholder
-- (doc MISA Step 6 nói "verify bằng sandbox"). Tenant khác nhau dùng path
-- khác nhau (Connect API v3 vs Open API v1 vs OEM). Đẩy ra config để
-- kế toán tự nhập theo doc MISA → không cần redeploy code khi MISA đổi.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS token_path text,
  ADD COLUMN IF NOT EXISTS publish_path text;

COMMENT ON COLUMN company_einvoice_config.token_path IS
  'Endpoint lấy access_token, vd: /api/Account/Login hoặc /api/v3/Auth/login.';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'Endpoint phát hành hoá đơn, vd: /api/InvoiceWS/Publish hoặc /api/v3/invoices.';
