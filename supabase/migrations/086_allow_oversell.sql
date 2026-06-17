-- ====================================================================
-- 086_allow_oversell
--
-- Cho phép NPP bật/tắt khả năng tạo đơn vượt tồn kho. Mặc định false
-- (chặn như trước). Khi bật, order-form sẽ chỉ cảnh báo (amber) thay
-- vì chặn submit — đơn vẫn được tạo, tồn sẽ về âm khi kho pick.
--
-- Cờ ở cấp tổ chức, không cấp user — owner/manager quyết định cho cả
-- NPP. RLS không cần đổi: read settings vốn dĩ open cho member.
-- ====================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_oversell boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.allow_oversell IS
  'Cho phép tạo đơn bán vượt tồn kho. false (mặc định) = chặn ở UI; true = chỉ cảnh báo.';
