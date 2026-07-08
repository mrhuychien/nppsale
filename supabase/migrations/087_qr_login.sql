-- ====================================================================
-- 087_qr_login
--
-- Đăng nhập bằng mã QR cho nhân viên.
--
-- Ý tưởng: mỗi nhân viên được cấp 1 token bí mật dài (qr_login_token).
-- Token này được nhúng vào 1 URL và in thành mã QR. Nhân viên dùng
-- camera điện thoại quét QR → mở URL /qr-login?t=<token> → server đối
-- chiếu token (service_role), phát hành phiên đăng nhập Supabase và đưa
-- thẳng vào app. Không cần gõ email/mật khẩu.
--
-- Bảo mật:
--   - Token = chuỗi ngẫu nhiên >=32 byte, đối chiếu server-side bằng
--     service_role. KHÔNG expose qua RPC public để tránh dò token.
--   - Chủ sở hữu có thể xoay (rotate) token → QR cũ hết hiệu lực ngay.
--   - Token chỉ hợp lệ khi user is_active = true (kiểm ở tầng API).
--   - QR = "chìa khoá" nên phải phát qua kênh tin cậy; rò rỉ QR thì
--     xoay token để vô hiệu hoá.
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_login_token text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_login_issued_at timestamptz;

-- Token phải là duy nhất toàn hệ thống để tra ngược 1-1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qr_login_token_unique
  ON users (qr_login_token)
  WHERE qr_login_token IS NOT NULL AND length(trim(qr_login_token)) > 0;

COMMENT ON COLUMN users.qr_login_token IS
  'Token bí mật nhúng trong mã QR đăng nhập. NULL = không bật QR login. Đối chiếu server-side (service_role) — không expose public.';
COMMENT ON COLUMN users.qr_login_issued_at IS
  'Thời điểm phát/xoay token QR gần nhất. Dùng để hiển thị và audit.';
