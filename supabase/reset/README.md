# Làm sạch dữ liệu để bàn giao

Bộ script SQL để reset dữ liệu Supabase trước khi bàn giao NPP. Chạy
thủ công qua **Supabase Dashboard → SQL Editor**, không nằm trong
pipeline migration.

## Thứ tự + lựa chọn

Chọn một trong ba mức dưới đây, theo ý bạn muốn giao môi trường "sạch"
đến đâu:

| Mức | Giữ | Xóa | Chạy file |
|-----|-----|-----|-----------|
| **A. Giữ danh mục** | products, customers, suppliers, routes, config, users | mọi giao dịch (orders, receivables, stock, deliveries, visits, notifications, HR payroll...) | `01_reset_transactions.sql` |
| **B. Giao sạch hoàn toàn** | organizations, users, sales_routes, expense_categories, approval_rules | toàn bộ mức A + customers, suppliers, products, promotions, commissions | `01` → `02_reset_catalog.sql` |
| **C. Chỉ giữ 1 owner** | mức B + 1 tài khoản owner | tất cả user còn lại | `01` → `02` → `04_reset_auth_profile.sql` |

Sau mỗi mức, **nên chạy `03_reseed_defaults.sql`** để chắc chắn 3 bảng
cấu hình mặc định (`sales_routes`, `expense_categories`,
`approval_rules`) còn đầy đủ row mặc định.

## Quy trình

### Bước 0 — Kiểm tra hiện trạng (bắt buộc đọc)

```
-- Paste 00_inspect.sql rồi Run
```

Script này không thay đổi gì, chỉ đếm số dòng mỗi bảng để bạn hình
dung phạm vi xóa. **Screenshot kết quả** trước khi reset để có đối
chứng nếu sau này cần khôi phục.

### Bước 1 — Backup (cực kỳ khuyến nghị)

Vào **Supabase Dashboard → Database → Backups** và đảm bảo PITR đang
bật, hoặc tạo manual snapshot. Mọi TRUNCATE là không thể hoàn tác nếu
không có backup.

### Bước 2 — Chạy mức bạn chọn

Copy toàn bộ nội dung file tương ứng, paste vào SQL Editor, **Run**.
Nếu gặp lỗi FK, đọc thông báo để biết bảng nào bị bỏ sót và thêm dòng
TRUNCATE tương ứng; các script đã dùng `CASCADE` nên hiếm khi lỗi.

### Bước 3 — Reseed config

Luôn chạy `03_reseed_defaults.sql` sau reset — chạy idempotent nên
không ghi đè config đã chỉnh.

### Bước 4 — Reset lại counter (tùy chọn)

Nếu bạn dùng order_code / entry_code tự sinh theo pattern có số tăng
dần, sau reset chúng vẫn sẽ dùng `Date.now()` hoặc random, nên không
cần reset sequence. Không có thao tác thêm.

### Bước 5 — Kiểm tra lại

Chạy lại `00_inspect.sql` — các bảng giao dịch phải ở 0. Các bảng
cấu hình đã reseed phải có >= 1 dòng per org.

## Sau khi xong

- Truy cập app bằng owner account → mọi trang phải trống nhưng chạy
  không lỗi.
- `/home`: KPI = 0, chưa có lộ trình — đúng.
- `/inventory`: tồn kho = 0 — đúng.
- `/reports/finance/pnl`: tất cả = 0 — đúng.
- `/notifications`: không có thông báo — đúng.

Nếu thấy lỗi 500 ở trang nào, có thể do RLS + user_org_id() không
match. Đảm bảo owner account vẫn có `org_id` hợp lệ (`SELECT *
FROM users WHERE email = 'owner@...';`).

## File trong thư mục này

```
00_inspect.sql              — đếm dòng tất cả bảng (read-only)
01_reset_transactions.sql   — xóa giao dịch, giữ danh mục
02_reset_catalog.sql        — xóa thêm KH / SP / NCC / khuyến mãi
03_reseed_defaults.sql      — tạo lại config mặc định (an toàn)
04_reset_auth_profile.sql   — xóa users (trừ 1 owner)
```
