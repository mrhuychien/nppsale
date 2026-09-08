# Làm sạch dữ liệu để bàn giao

> ## ⚠ ĐỌC TRƯỚC — cập nhật 08/09/2026
>
> **Muốn "database trắng để bàn giao" thì dùng `05_reset_blank.sql`.**
> Ba file `01` / `02` / `04` bên dưới vẫn để lại làm tham khảo, nhưng
> KHÔNG dùng chúng cho việc đó nữa:
>
> - Chúng liệt kê tên bảng **bằng tay**. Đo được: schema có **72 bảng**,
>   ba file đó chạm tới **40** — sót **32**, trong đó có cấu hình tài
>   khoản MISA (`company_einvoice_config`), mã đăng nhập QR của nhân viên
>   (`qr_login_tokens`), ảnh điểm bán, giá vốn FIFO, phiếu thu, bảng
>   lương, nhật ký hoá đơn. Bàn giao bằng chúng là bàn giao kèm dữ liệu và
>   thông tin đăng nhập của NPP cũ.
> - Không file nào xoá **file trong storage** — ảnh mặt tiền cửa hàng và
>   chữ ký người nhận hàng vẫn nằm nguyên đó.
> - `04_reset_auth_profile.sql` **chạy là lỗi**: nó tra `users.email`,
>   trong khi `public.users` không có cột `email` (email nằm ở
>   `auth.users`, hai bảng dùng chung `id`).
>
> `05_reset_blank.sql` lật ngược mặc định — **xoá mọi bảng trừ danh sách
> giữ lại** — nên bảng thêm về sau tự động được xoá, không cần ai nhớ sửa
> file. Nó cũng dọn storage và tài khoản đăng nhập.
>
> ### `05_reset_blank.sql` có hai chế độ
>
> Sửa dòng `keep_owner` ở đầu khối `DO $$`:
>
> | `keep_owner` | Còn lại | Dùng khi |
> |---|---|---|
> | `true` (mặc định) | 1 org + 1 chủ NPP | muốn đăng nhập được ngay sau khi bàn giao |
> | `false` | **0 org, 0 người, 0 tài khoản đăng nhập** | muốn trắng tinh; người nhận tự tạo tài khoản ở Dashboard rồi chạy `supabase/bootstrap_owner.sql` |
>
> Cả hai chế độ đều xoá 70 bảng dữ liệu, mọi file trong storage, và giữ
> nguyên 3 bucket rỗng. Đã đo trên PostgreSQL 16 với dữ liệu trồng sẵn.
>
> **Với `keep_owner = true`, cờ `scrub_identity` (mặc định `true`) còn tẩy
> danh tính NPP cũ.** Giữ dòng `organizations` lại là giữ luôn tên công ty,
> và `settings` của nó chứa mã số thuế / địa chỉ / điện thoại / email — để
> nguyên thì người nhận mở app thấy thông tin của người khác, và mọi phiếu
> in ra mang thông tin đó. Bật thì:
>
> | Bị xoá | Giữ nguyên |
> |---|---|
> | tên + slug công ty, toàn bộ `settings` (MST, địa chỉ, SĐT, email) | **email + mật khẩu đăng nhập** |
> | cờ `setup_completed_at` → màn `/setup` hiện lại cho chủ mới | `role = owner`, `is_active` |
> | tên, SĐT, username của chủ cũ | |
>
> Tắt (`false`) khi đây là môi trường của chính bạn và chỉ muốn dọn dữ liệu
> giao dịch, không muốn khai báo lại thông tin công ty.
>
> ⚠ Chế độ `false` **không còn đường đăng nhập nào** cho tới khi chạy
> `bootstrap_owner.sql` — app đá về `/login` vì `user_org_id()` trả NULL.
> Đó là đúng ý đồ, không phải hỏng.
>
> ### Hai cách bàn giao — chọn một
>
> | | Cách A: Supabase project MỚI | Cách B: xoá sạch project đang dùng |
> |---|---|---|
> | Sạch | Tuyệt đối — không có gì sót | Sạch phần dữ liệu; cấu hình project (secrets, webhook, log cũ) vẫn là của bạn |
> | Cách làm | Tạo project mới → dán `supabase/schema_full.sql` vào SQL Editor → tạo tài khoản owner đầu tiên | Backup → sửa email trong `05_reset_blank.sql` → chạy → chạy `03_reseed_defaults.sql` |
> | Rủi ro | Phải cấu hình lại env cho app | Không hoàn tác được nếu quên backup |
>
> **Khuyến nghị: cách A.** Bàn giao *code* thì thứ cần chứng minh là "cài
> từ đầu chạy được", và cách A chứng minh đúng điều đó. Đã đo trên
> PostgreSQL 16 dựng từ số 0: 102 migration (bỏ `003_seed`) chạy **0
> lỗi**, ra **72 bảng** và **3 bucket**.
>
> ⚠ **Đừng chạy `seed_demo.sql` cho bản bàn giao** — nó tạo 6 tài khoản
> `*@demo.com` mật khẩu công khai `Demo@123456`.
>
> Sau khi xong, đổi lại các bí mật: `CRON_SECRET`, khoá Supabase, tài
> khoản MISA. Xoá dữ liệu không đổi được khoá.


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
03_reseed_defaults.sql      — tạo lại config mặc định (an toàn, idempotent)
05_reset_blank.sql          — ★ DÙNG CÁI NÀY để bàn giao. Xoá mọi bảng trừ
                              danh sách giữ lại; dọn cả storage và tài
                              khoản đăng nhập; tẩy danh tính NPP cũ.

── để lại tham khảo, KHÔNG dùng để bàn giao (xem cảnh báo đầu file) ──
01_reset_transactions.sql   — liệt kê bảng bằng tay, sót 32 bảng
02_reset_catalog.sql        — cùng vấn đề
04_reset_auth_profile.sql   — cùng vấn đề, VÀ chạy là lỗi (tra users.email)
```

Cần dựng chủ NPP trên một database vừa cài xong (0 org, 0 người):
`supabase/bootstrap_owner.sql`. Cài mới từ đầu: `supabase/INSTALL.md`.
