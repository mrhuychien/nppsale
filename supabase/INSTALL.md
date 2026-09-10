# Cài npp.sale lên một Supabase project MỚI

Dành cho người **nhận bàn giao code**: dựng một hệ thống trắng, không dính
dữ liệu của nhà phân phối nào trước đó.

Mọi con số dưới đây đã đo trên PostgreSQL 16 dựng từ số 0, không phải ước
lượng.

---

## Trước khi bắt đầu

Cần: một tài khoản Supabase, một tài khoản Vercel (hoặc chỗ chạy Next.js
khác), và `openssl` để sinh khoá bí mật.

> ⚠ **KHÔNG chạy `supabase/seed_demo.sql`.** File đó tạo 6 tài khoản
> `*@demo.com` với mật khẩu công khai `Demo@123456`. Nó chỉ dành cho môi
> trường thử nghiệm.

---

## Bước 1 — Tạo Supabase project

Supabase Dashboard → **New project**. Chọn region gần người dùng (Singapore
cho Việt Nam). Ghi lại **Database password** — Supabase chỉ hiện một lần.

---

## Bước 2 — Dựng schema

SQL Editor → **New query** → dán **toàn bộ** `supabase/schema_full.sql` →
**Run**.

File này gộp 102 migration (đã bỏ seed demo). Chạy một lần trên database
trống, trong một transaction.

Đúng thì được:

| | |
|---|---|
| Bảng trong `public` | **72** |
| Policy RLS | **167** |
| Storage bucket | **3** (`customer-photos`, `pod-photos`, `visit-photos`) |
| Lỗi | **0** |

Kiểm nhanh:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE') AS bang,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public')  AS policy,
  (SELECT count(*) FROM storage.buckets)                        AS bucket;
```

> `schema_full.sql` được sinh tự động từ `supabase/migrations/` bằng
> `bash scripts/build-combined-migration.sh`. Đừng sửa tay — có test
> (`tests/handover.test.ts`) bắt lỗi nếu nó lệch với thư mục migration.

---

## Bước 3 — Tạo tài khoản chủ NPP

Dashboard → **Authentication → Users → Add user**:

- **Email**: `<số điện thoại>@nppsale.local` — ví dụ SĐT `0909123456` thì
  điền `0909123456@nppsale.local`
- **Password**: đặt mật khẩu
- Bật **Auto Confirm User**

> ⚠ Chuỗi email đó **thuần kỹ thuật**. Supabase Auth bắt buộc phải có email,
> nhưng chủ NPP đăng nhập vào app bằng **số điện thoại** và không bao giờ gõ
> chuỗi này. Điền sai dạng cũng không sao — bước 4 sẽ nêu ra đúng chuỗi cần
> tạo.

Phải làm ở Dashboard, không làm bằng SQL: băm mật khẩu là việc của Supabase
Auth, chèn tay vào `auth.users` sẽ ra tài khoản không đăng nhập được.

---

## Bước 4 — Dựng NPP đầu tiên

SQL Editor → dán `supabase/bootstrap_owner.sql` → **sửa 3 dòng đầu**
(số điện thoại chủ NPP, tên NPP, slug) → **Run**.

**Không bỏ được bước này.** Sau bước 2 database có đủ 72 bảng nhưng *không
có org nào và không có người dùng nào*, và dự án **không có trigger nào
trên `auth.users`** — nên tạo tài khoản ở bước 3 cũng không tự sinh dòng
trong `public.users`. Thiếu bước 4 thì đăng nhập xong app đá về `/login`
mãi: `user_org_id()` trả NULL nên mọi policy RLS chặn hết. Màn `/setup`
không cứu được vì nó chỉ *cấu hình* một org đã có.

Script tự dừng nếu chưa có tài khoản ở bước 3, hoặc nếu database đã có
người dùng.

---

## Bước 5 — Cấu hình mặc định

SQL Editor → dán `supabase/reset/03_reseed_defaults.sql` → **Run**.

Được: `sales_routes=3`, `expense_categories=8`, `approval_rules=1`. Chạy
lại nhiều lần vô hại.

---

## Bước 6 — Biến môi trường

Supabase Dashboard → **Settings → API** để lấy hai khoá đầu.

| Biến | Lấy ở đâu | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → anon public | |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role | **CHỈ server.** Bỏ vào biến `NEXT_PUBLIC_*` là mở toang toàn bộ database |
| `NEXT_PUBLIC_APP_URL` | domain của bạn | dùng sinh link trong mã QR đăng nhập |
| `EINVOICE_ENC_KEY` | `openssl rand -hex 32` | mã hoá tài khoản MISA. **Đổi khoá này là mất khả năng giải mã cấu hình đã lưu** |
| `CRON_SECRET` | `openssl rand -hex 32` | hàng rào DUY NHẤT của route chạy theo lịch |

Trên Vercel: **Settings → Environment Variables**, chọn cả ba môi trường
(Production / Preview / Development). Đặt xong phải **deploy lại** thì
biến mới có hiệu lực.

---

## Bước 7 — Việc chạy theo lịch

`vercel.json` khai đúng **một** cron: `/api/cron/daily` lúc `0 18 * * *`
(18:00 UTC = **01:00 sáng giờ Việt Nam hôm sau**). Nó gọi lần lượt: đồng bộ
hoá đơn MISA → nhắc ảnh điểm bán (chỉ thứ Hai giờ VN) → kéo snapshot hoá
đơn.

> Gói Hobby của Vercel không nhận lịch dày hơn một lần mỗi ngày. Khai dày
> hơn thì Vercel **từ chối tạo bản deploy** và bảng điều khiển không hiện
> lỗi nào — đã trả giá bằng 13 commit không lên được production.

Kiểm mà không cần biết bí mật — gọi **không kèm** header:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/api/cron/daily
```

- `401` → đúng: `CRON_SECRET` đã có, hàng rào chặn
- `503` → server chưa thấy biến (chưa đặt, hoặc đặt xong chưa deploy lại)

Gọi tay có xác thực:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" https://<domain>/api/cron/daily
```

---

## Bước 8 — Nghiệm thu

Đăng nhập bằng tài khoản bước 3, rồi đi qua:

- [ ] `/home` — vào được, KPI = 0
- [ ] `/setup` — chạy để đặt thông tin NPP, ngưỡng giá, cấu hình lương
- [ ] Đăng nhập bằng **số điện thoại**, không phải email
- [ ] `/settings/users` — thêm được nhân viên (cần `SUPABASE_SERVICE_ROLE_KEY`);
      màn tạo chỉ hỏi 4 thứ: họ tên, SĐT, mật khẩu, vai trò
- [ ] `/products`, `/customers` — thêm được bản ghi
- [ ] `/orders/new` — tạo được đơn
- [ ] `/inventory` — tồn = 0
- [ ] `/reports/finance` — mọi số = 0, không lỗi 500
- [ ] `curl` cron trả `401`

Lỗi 500 kèm danh sách rỗng ở một trang nào đó thường là bước 4 chưa chạy
hoặc `org_id` của tài khoản bị NULL:

```sql
SELECT u.phone, u.role, u.org_id, u.full_name FROM public.users u;
```

---

## Bàn giao lại về sau

Nếu cần trả một database **đang chạy** về trạng thái trắng thay vì tạo
project mới, xem `supabase/reset/README.md` → `05_reset_blank.sql`.

Xoá dữ liệu **không** đổi được khoá. Sau khi bàn giao, xoay lại:
`CRON_SECRET`, khoá Supabase (Settings → API → Reset), `EINVOICE_ENC_KEY`
(lưu ý: đổi khoá này thì phải nhập lại tài khoản MISA), và mật khẩu database.
