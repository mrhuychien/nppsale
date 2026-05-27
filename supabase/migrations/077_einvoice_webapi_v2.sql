-- ====================================================================
-- MISA meInvoice WebAPI v2 — pivot sang flow nháp (Insert) đơn giản.
--
-- User chỉ cần đẩy data → MISA tạo HĐ nháp → user vào web duyệt + ký
-- thủ công. KHÔNG cần AppID (chỉ dùng cho Integration API trả phí),
-- KHÔNG cần SignType (vì không ký qua API).
--
-- Đổi default api_base/token_path/publish_path. Cột misa_app_id và
-- sign_type giữ lại (đã insert ở 076) nhưng không dùng — sau này nếu
-- cần Integration API trả phí thì bật lại.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ALTER COLUMN api_base SET DEFAULT 'https://testapp.meinvoice.vn/api/v2';

COMMENT ON COLUMN company_einvoice_config.api_base IS
  'Base URL MISA WebAPI v2. Sandbox: https://testapp.meinvoice.vn/api/v2 ; production: https://app.meinvoice.vn/api/v2.';

-- Reset path NULL hiện tại sang default WebAPI (chỉ cập nhật row chưa
-- nhập tay; ai đã nhập path cũ để Integration API → giữ nguyên).
UPDATE company_einvoice_config
SET
  token_path = '/oauth',
  publish_path = '/SAInvoice/Insert'
WHERE token_path IS NULL OR token_path = '';

COMMENT ON COLUMN company_einvoice_config.token_path IS
  'WebAPI v2: /oauth (form-encoded grant_type=password, MST ở header taxcode).';
COMMENT ON COLUMN company_einvoice_config.publish_path IS
  'WebAPI v2: /SAInvoice/Insert (push HĐ nháp; user vào web duyệt + ký).';
