-- ====================================================================
-- 088_qr_token_isolation
--
-- SỬA LỖI BẢO MẬT: 087 đặt qr_login_token trong bảng users, nhưng RLS
-- của users cho phép MỌI thành viên org SELECT (policy "org_id =
-- user_org_id()"). Nghĩa là nhân viên thường đọc được token của Chủ sở
-- hữu và chiếm tài khoản.
--
-- Khắc phục: chuyển token sang bảng riêng qr_login_tokens, bật RLS và
-- KHÔNG tạo policy nào → chỉ service_role (bypass RLS) đọc/ghi được.
-- Toàn bộ thao tác token đều đi qua API server-side sẵn có.
-- ====================================================================

CREATE TABLE IF NOT EXISTS qr_login_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_login_tokens_token
  ON qr_login_tokens (token);

-- RLS bật, không policy: anon/authenticated bị chặn hoàn toàn.
ALTER TABLE qr_login_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qr_login_tokens FROM anon, authenticated;

COMMENT ON TABLE qr_login_tokens IS
  'Token đăng nhập QR — service_role only. Không thêm policy RLS cho bảng này.';

-- Di trú dữ liệu từ 087 (nếu có) rồi gỡ cột khỏi users.
INSERT INTO qr_login_tokens (user_id, token, issued_at)
SELECT id, qr_login_token, COALESCE(qr_login_issued_at, now())
FROM users
WHERE qr_login_token IS NOT NULL AND length(trim(qr_login_token)) > 0
ON CONFLICT (user_id) DO NOTHING;

DROP INDEX IF EXISTS idx_users_qr_login_token_unique;
ALTER TABLE users DROP COLUMN IF EXISTS qr_login_token;
ALTER TABLE users DROP COLUMN IF EXISTS qr_login_issued_at;
