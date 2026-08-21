-- ====================================================================
-- 090_fix_role_permissions_module_check
--
-- SỬA LỖI: "new row for relation role_permissions violates check
-- constraint role_permissions_module_check" khi lưu phân quyền.
--
-- NGUYÊN NHÂN GỐC (bug trong migration 024):
-- 024 định nghĩa constraint bằng chuỗi regex có HAI dấu gạch chéo:
--     module ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$'
-- Postgres mặc định standard_conforming_strings = on, nên dấu \ trong
-- chuỗi '...' là ký tự LITERAL, không phải ký tự thoát. Regex nhận được
-- do đó là  \\.  nghĩa là "một dấu backslash thật, rồi ký tự bất kỳ"
-- — chứ KHÔNG phải "một dấu chấm" như ý định ban đầu.
--
-- Hậu quả: khoá cấp module không dấu chấm ('orders', 'settings') thì
-- lọt, nhưng MỌI khoá tính năng có dấu chấm đều bị chặn:
--     settings.users, analytics.business, reports.end_of_day,
--     finance.cash_receipts, purchasing.invoices, einvoice.config, ...
-- Vì vậy trang Phân quyền lưu thất bại ngay khi có bất kỳ dòng phân
-- quyền chi tiết nào.
--
-- CÁCH SỬA: viết lại constraint với MỘT dấu gạch chéo ( \. = dấu chấm ).
-- An toàn: chỉ NỚI LỎNG điều kiện (mọi giá trị đang hợp lệ vẫn hợp lệ),
-- không đụng dữ liệu, không xoá dòng nào. Idempotent.
-- ====================================================================

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_module_check;

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_module_check
  CHECK (
    char_length(module) BETWEEN 1 AND 64
    AND module ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  );

COMMENT ON COLUMN role_permissions.module IS
  'Khoá module hoặc tính năng. Khoá cấp module ("orders") bao trùm cả nhóm menu; khoá tính năng ("settings.users") ghi đè riêng một mục menu. Định dạng: các từ thường a-z0-9_ ngăn cách bởi dấu chấm, tối đa 64 ký tự.';

-- --------------------------------------------------------------------
-- KIỂM TRA SAU KHI CHẠY — cả 8 dòng phải trả về true.
-- --------------------------------------------------------------------
-- SELECT
--   'orders'                ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS module_don,
--   'settings.users'        ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS tinh_nang,
--   'reports.end_of_day'    ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS co_gach_duoi,
--   'finance.cash_receipts' ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' AS co_gach_duoi_2,
--   NOT ('Orders'           ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_hoa,
--   NOT ('.orders'          ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_dau_cham,
--   NOT ('orders.'          ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_cuoi_cham,
--   NOT ('a b'              ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') AS chan_khoang_trang;
