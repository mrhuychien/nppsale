-- ====================================================================
-- MISA meInvoice — bổ sung trường khớp doc tích hợp thật:
-- - misa_app_id: AppID do MISA cấp (khác Company ID), dùng cho token.
-- - sign_type: SignType khi phát hành (1=USB/file, 2=HSM, 3=HSM async,
--   4=vé không ký, 5=POS không ký). Mặc định 1.
-- ====================================================================

ALTER TABLE company_einvoice_config
  ADD COLUMN IF NOT EXISTS misa_app_id text,
  ADD COLUMN IF NOT EXISTS sign_type smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN company_einvoice_config.misa_app_id IS
  'AppID do MISA cấp (request body token: appid).';
COMMENT ON COLUMN company_einvoice_config.sign_type IS
  'SignType MISA: 1=USB/file, 2=HSM, 3=HSM async, 4=vé không ký, 5=POS không ký.';
