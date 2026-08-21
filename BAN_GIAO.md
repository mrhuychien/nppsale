# Tài liệu bàn giao — npp.sale

> Mini ERP cho nhà phân phối FMCG. Tài liệu này viết cho **người tiếp nhận
> codebase**, không phải cho người dùng cuối. Hướng dẫn sử dụng cho từng vai
> trò nằm ở các file `HUONG_DAN_*.md`.
>
> Cập nhật: 2026-08-21 · Nhánh: `main` · Xem lịch sử: `git log --oneline`

---

## 1. Tóm tắt điều hành

**Hệ thống là gì.** Ứng dụng web quản lý toàn bộ vòng đời phân phối FMCG: đơn
hàng → duyệt → soạn hàng → giao → công nợ → hoá đơn, kèm kho theo lô/hạn dùng,
nhân sự/lương, và báo cáo. Next.js 14 (App Router) + Supabase (Postgres + Auth
+ RLS), deploy trên Vercel.

**Đang chạy thật.** Có người dùng thật, dữ liệu tiền và tồn kho thật. Không phải
sản phẩm thử nghiệm.

**Rủi ro lớn nhất — đọc kỹ ba điểm này:**

1. **Schema production từng lệch so với code** — nguyên nhân gốc của ít nhất
   3 sự cố (sản phẩm rỗng, không lưu được phân quyền, RLS không hiệu lực).
   **Đã đồng bộ xong** (xem 5.0). Duy trì bằng cách chạy công cụ dò lệch sau
   mỗi lần deploy có migration mới.
2. **Migration từng không chạy lại được** (đã sửa trong đợt này). 141 câu
   `CREATE POLICY` thiếu `DROP POLICY IF EXISTS` → chạy lại sẽ lỗi "already
   exists" và dừng giữa chừng. Đây gần như chắc chắn là lý do database bị lệch
   ngay từ đầu. Nay toàn bộ migration đã idempotent.
3. **Lỗi bị nuốt trên diện rộng.** 63 truy vấn đọc bỏ qua `error` và 191 thao
   tác ghi không kiểm tra kết quả. Hậu quả: hệ thống hỏng mà **không báo gì** —
   người dùng chỉ thấy "không có dữ liệu" hoặc tưởng đã lưu thành công.

**Có dùng được không?** Có, và đang được dùng. Nhưng ba điểm trên khiến việc
chẩn đoán sự cố rất tốn công, và khiến rủi ro tích tụ âm thầm.

---

## 2. Kiến trúc và công nghệ

### Công nghệ

| Lớp | Công nghệ |
|---|---|
| Giao diện | Next.js 14 App Router, React 18, TypeScript, Tailwind, shadcn/ui (Radix) |
| Dữ liệu / Auth | Supabase (Postgres, Auth, Row Level Security) |
| Triển khai | Vercel (production = nhánh `main`) |
| Kiểm thử | Vitest (mới dựng — xem mục 4) |

### Luồng dữ liệu

Trình duyệt **gọi thẳng Supabase** cho hầu hết thao tác đọc/ghi (dùng khoá
`anon` công khai). **Bảo mật nằm ở tầng database (RLS)**, không nằm ở tầng
ứng dụng. Đây là quyết định kiến trúc quan trọng nhất cần nắm:

- Kiểm tra quyền trong React chỉ để **ẩn/hiện giao diện** — không phải hàng rào
  bảo mật. Ai cũng có thể gọi API Supabase trực tiếp.
- Hàng rào thật là **RLS policy** trong `supabase/migrations/*.sql`.
- `src/app/api/*` chỉ dùng cho việc **bắt buộc** phải có `service_role` key
  (tạo/xoá tài khoản nhân viên, đổi token QR). Các route này tự kiểm tra vai
  trò người gọi.

### Bản đồ thư mục

```
src/app/(dashboard)/     123 trang nghiệp vụ, nhóm theo module
src/app/api/             8 route cần service_role (server-only)
src/components/          75 component; ui/ là shadcn, còn lại theo nghiệp vụ
src/lib/                 47 file logic thuần — NƠI ĐÁNG TIN CẬY NHẤT để sửa
src/hooks/               use-auth, use-order-sync, use-role-guard...
supabase/migrations/     91 file, chạy TUẦN TỰ theo số
supabase/diagnostics/    công cụ chẩn đoán sự cố (xem mục 8)
tests/                   test đơn vị (vitest)
```

### Ba cơ chế cần hiểu trước khi sửa code

**Phân quyền hai tầng.** `role` (owner/manager/accountant/sales/warehouse/driver)
cho quyền thô; bảng `role_permissions` cho phép tinh chỉnh từng
module/tính năng. Khoá dạng `orders` (cả nhóm) hoặc `settings.users` (một mục
menu). Xem `src/lib/permissions.ts` và `src/lib/permissions-features.ts`.

**Đơn vị tính (UOM).** Sản phẩm có đơn vị cơ sở (hộp) và đơn vị giao dịch
(thùng). **Mọi phép cộng trừ tồn kho phải quy về đơn vị cơ sở.** Hệ số quy đổi
được chụp lại (`conversion_factor`) tại thời điểm tạo đơn để lịch sử không đổi
khi cấu hình thay đổi sau này. Xem `src/lib/inventory/uom.ts` — đã có test.

**Tạo đơn ngoại tuyến.** Nhân viên đi tuyến mất sóng vẫn tạo được đơn: đơn lưu
vào IndexedDB (`src/lib/offline/`), tự đẩy lên khi có mạng. Đơn đồng bộ luôn
vào ở trạng thái **nháp** để quy trình kiểm tồn/công nợ vẫn chạy. Chống trùng
bằng `client_request_id` (migration 089).

---

## 3. Bắt đầu nhanh

```bash
npm install
cp .env.example .env.local     # điền giá trị, xem bảng dưới
npm run dev                    # http://localhost:3000

npm run verify                 # typecheck + lint + test + build (chạy trước khi push)
npm test                       # chỉ chạy test
```

### Biến môi trường

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Có | Công khai (nhúng vào trình duyệt) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Có | Công khai — an toàn, vì RLS bảo vệ |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | **BÍ MẬT — server only.** Bỏ qua RLS. Thiếu thì không tạo được nhân viên và không đăng nhập QR được |
| `EINVOICE_ENC_KEY` | Nếu dùng HĐĐT | Khoá AES-256-GCM mã hoá thông tin MISA. **Đổi khoá = mất khả năng giải mã dữ liệu cũ** |
| `NEXT_PUBLIC_APP_URL` | Không | Dùng sinh link trong mã QR. Mặc định `https://nppsale.vercel.app` |

### Cài database

- **Cài mới (DB trống):** chạy `supabase/schema_full.sql` một lần trong Supabase
  SQL Editor. Tuỳ chọn: `supabase/seed_demo.sql` cho dữ liệu mẫu —
  **tuyệt đối không chạy trên production** (chứa tài khoản demo mật khẩu công khai).
- **DB đã có sẵn:** chỉ chạy các migration **mới**, theo đúng thứ tự số.
  ⚠️ Không chạy lại `schema_full.sql` trên DB đã có dữ liệu — nó chứa
  `CREATE TABLE` không điều kiện. Chỉ chạy migration mới.

**Migration bắt buộc phải chạy nếu chưa có:**

| Migration | Không chạy thì bị gì |
|---|---|
| `090_fix_role_permissions_module_check.sql` | Không lưu được phân quyền chi tiết |
| `091_backfill_missing_objects.sql` | **Bù 3 mục schema đang thiếu trên production** — gồm cả cột của 089 (đơn ngoại tuyến không đồng bộ được) và của 025 (trang Sản phẩm) |

---

## 4. Tình trạng chất lượng (số liệu thật, đo ngày 2026-08-21)

| Hạng mục | Kết quả |
|---|---|
| `npm run typecheck` | ✅ sạch |
| `npm run lint` | ✅ không lỗi (còn cảnh báo nhẹ) |
| `npm run build` | ✅ 101 trang |
| `npm test` | ✅ **61 test / 3 file, tất cả xanh** |
| Quy mô | 76.290 dòng TS/TSX · 123 trang · 8 API route · 75 component · 47 lib · 90 migration |
| `any` trong code | 2 (rất tốt) |
| TODO/FIXME còn sót | 0 |
| Lỗ hổng dependency | 5 mức cao (phân tích ở mục 5) |

### Phạm vi test hiện có

Test **mới được dựng trong đợt bàn giao này** — trước đó dự án **không có test nào**.

| File | Nội dung | Số test |
|---|---|---|
| `tests/uom.test.ts` | Quy đổi đơn vị, chặn hệ số 0/âm, hiển thị phiếu | 15 |
| `tests/approval.test.ts` | Quy tắc duyệt đơn, ngưỡng, hạn mức tín dụng, phân cấp duyệt | 19 |
| `tests/tien.test.ts` | Định dạng tiền, đọc số thành chữ, luật chặn sửa giá | 27 |

⚠️ **Chưa được phủ test:** toàn bộ 123 trang giao diện, tính lương/thưởng, FIFO
kho, đồng bộ ngoại tuyến, tích hợp hoá đơn điện tử MISA. Đây là khoảng trống
lớn nhất còn lại.

---

## 5. Vấn đề đã biết

### 5.0 Đồng bộ schema production — ĐÃ XỬ LÝ (2026-08-21)

Đã đo bằng `check_migration_drift.sql` trên database thật, rà từng mục, và bù
xong bằng `migrations/091_backfill_missing_objects.sql`.

**Ba mục thiếu thật — đã bù, đã xác nhận biến mất ở lần đo lại:**

| Thiếu | Hậu quả khi thiếu | Trạng thái |
|---|---|---|
| `products.allow_price_edit`, `price_edit_max_type`, `price_edit_max` (mig 025) | **Nguyên nhân gốc lỗi trang Sản phẩm rỗng** | ✅ đã bù |
| `sales_orders.client_request_id` + index (mig 089) | Đơn tạo ngoại tuyến không đồng bộ lên được | ✅ đã bù |
| index `idx_suppliers_org` (mig 006) | Chỉ ảnh hưởng tốc độ | ✅ đã bù |

**Bài học quan trọng cho người tiếp nhận — cách đọc kết quả dò lệch.**
Lần đo đầu báo 14 migration "thiếu", nhưng **11/14 là báo động giả**: policy bị
migration sau cố ý xoá/đổi tên qua nhiều đợt sửa RLS (`004`→`008` cho bảng
`users`; `042` cho `customers`; `034` cho `payables`/`purchase_orders`/
`cash_receipts`), và cột `qr_login_token` của `087` được `088` chuyển sang bảng
riêng `qr_login_tokens`.

Công cụ đã được viết lại để tính **trạng thái cuối cùng** của từng đối tượng
theo đúng thứ tự xuất hiện, nên bản hiện tại không còn báo nhầm. **Nếu thấy kết
quả có cột `trang_thai` là bạn đang chạy bản cũ** — sinh lại bằng
`python3 scripts/build-drift-check.py`.

**Còn một mục chưa ngã ngũ:** policy `visit_photos_*` nằm ở schema `storage`
(bản dò cũ tìm nhầm trong schema `public` nên luôn báo thiếu). Kiểm bằng:

```sql
SELECT policyname FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
  AND policyname LIKE 'visit_photos%';
```

Ít hơn 3 dòng ⇒ chức năng **chụp ảnh viếng thăm khách hàng** đang hỏng ⇒ chạy
lại `migrations/014_visit_photos.sql`.

### 5.1 Đã kiểm chứng bằng bằng chứng cụ thể

| # | Mức | Vấn đề | Ảnh hưởng | Vị trí |
|---|---|---|---|---|
| 1 | ✅ Đã sửa | DB production lệch so với migration | Từng là nguyên nhân gốc của ≥3 sự cố | `migrations/091_backfill_missing_objects.sql` |
| 2 | ✅ Đã sửa | 141 `CREATE POLICY` thiếu `DROP IF EXISTS` | Từng khiến migration không chạy lại được → cài đặt dở dang. Nay đã idempotent | `scripts/make-policies-idempotent.py` |
| 3 | 🟠 Cao | **191 thao tác ghi không kiểm tra lỗi** | Người dùng tưởng đã lưu nhưng dữ liệu không vào DB, **không có cảnh báo nào** | Rải rác `src/app/(dashboard)/**` |
| 4 | 🟠 Cao | **63 truy vấn đọc bỏ qua `error`** | Lỗi hiện thành "không có dữ liệu" → không thể chẩn đoán. Đã sửa 10 trang chính bằng `selectResilient`, còn lại chưa | Rải rác `src/app/(dashboard)/**` |
| 5 | 🟠 Cao | **`xlsx@0.18.5` — Prototype Pollution, chưa có bản vá trên npm** | App **nhận file Excel người dùng tải lên** → có đường khai thác thật | 6 file (import KH/SP/NCC, xuất báo cáo) |
| 6 | 🟡 Trung | **81 file có truy vấn không giới hạn số dòng** | Chạy tốt lúc dữ liệu nhỏ; chậm dần rồi treo khi dữ liệu lớn | `src/app/(dashboard)/**` |
| 7 | 🟡 Trung | **8 file trên 800 dòng** (lớn nhất 2.082) | Khó đọc, khó test, dễ gây hồi quy khi sửa | `orders/[id]/page.tsx`, `order-form.tsx`… |
| 8 | 🟢 Thấp | `userSalesCeiling` trả `110000.00000000001` | Chưa gây lỗi (validate có dung sai 0,5đ) nhưng sẽ sinh lỗi lạ nếu dùng làm `max` của ô nhập | `src/lib/pricing.ts` |

**Về lỗ hổng dependency:** 5 cảnh báo mức cao. Đã phân tích từng cái:

- `xlsx` → **rủi ro thật** (mục 5 ở trên). Bản npm mới nhất vẫn dính; SheetJS đã
  chuyển sang phát hành qua CDN riêng. Cần đánh giá phương án chuyển nguồn cài đặt.
- `next@14.2.35` → là bản mới nhất của dòng 14. Cảnh báo liên quan
  `images.remotePatterns` mà **dự án không cấu hình `images`** → **không có đường
  khai thác**. Chỉ hết cảnh báo khi lên Next 15.
- `nanoid`, `postcss`, `ws` → phụ thuộc gián tiếp, không nằm trên đường đi của
  dữ liệu người dùng. Rủi ro thực tế thấp.

### 5.2 Cần kiểm chứng thêm — CHƯA xác nhận

> Nhóm này phát hiện bằng cách đọc migration. Nhưng vì **DB production lệch so
> với migration**, chưa chắc chúng đang có hiệu lực thật. **Phải xác minh trên
> database thật trước khi sửa** — sửa mù có thể gây khoá quyền, tệ hơn lỗ hổng.

| Mức | Nghi vấn | Vì sao chưa chắc |
|---|---|---|
| 🟠 | `suppliers` và `users` có policy `USING (true)` không lọc `org_id` | Với mô hình 1 tổ chức/1 DB hiện tại thì **không rò rỉ gì**. Chỉ thành vấn đề nếu sau này gộp nhiều tổ chức chung DB |
| 🟠 | 4 view thiếu `security_invoker` → chạy bằng quyền owner, bỏ qua RLS | Cần xác nhận trên DB thật. ⚠️ **Bẫy:** bật `security_invoker` theo gợi ý của Supabase Advisor có thể làm các trang dùng view **đột ngột rỗng vĩnh viễn** — view luôn trả 200 nên không bao giờ có lỗi để hiển thị |
| 🟡 | Policy payments của migration 033 bị OR làm vô hiệu | Siết lại là **đổi hành vi thật** — NV bán hàng sẽ mất quyền xem phiếu thu của người khác. Cần hỏi nghiệp vụ trước |
| 🟢 | Nghi warehouse/driver bị khoá khỏi `customers`/`invoices` | **Chủ sở hữu đã xác nhận tài xế vẫn xem được khách hàng bình thường** → migration 042 nhiều khả năng chưa chạy trên production. Là bằng chứng cho vấn đề #1 |

---

## 6. Nợ kỹ thuật và rủi ro bàn giao

**Dễ vỡ nhất**

- **Ma trận RLS.** 90 migration chồng lấn nhau, nhiều lần "sửa chữa khẩn cấp"
  (`004_fix_*`, `005_fix_*`, `036_rls_repair`). Rất khó biết policy nào đang
  thực sự có hiệu lực nếu chỉ đọc file. **Luôn kiểm tra bằng `pg_policies` trên
  DB thật.**
- **`order-form.tsx` (1.970 dòng).** Chứa tính tiền, kiểm tồn, luật giá, hàng
  trả, hàng đổi, và nhánh ngoại tuyến — tất cả trong một file. Đây là file rủi
  ro nhất khi sửa.
- **Tích hợp hoá đơn điện tử MISA.** Phụ thuộc API bên thứ ba, không có test,
  credentials mã hoá bằng khoá không được xoay vòng.

**Thiếu test:** toàn bộ giao diện, lương/thưởng, FIFO kho, đồng bộ ngoại tuyến.

**Kiến thức chỉ một người biết:** cấu hình MISA; ý nghĩa nghiệp vụ của các cờ
`allow_oversell`, `direct_sale`, `is_exchange`; và quan trọng nhất — **migration
nào đã thực sự chạy trên production**.

---

## 7. Lộ trình đề xuất

**Tuần 1 — cầm máu**
1. ✅ ~~Dò lệch schema~~ — đã đo, xem mục 5.0.
2. ✅ ~~Làm migration chạy lại được~~ — đã sửa 141 policy.
3. ✅ ~~Bù schema thiếu~~ — đã chạy 091, đo lại sạch.
4. Kiểm `visit_photos` ở schema storage (câu lệnh ở mục 5.0) — mục duy nhất còn treo.
5. Kiểm tra RLS thật trên DB (`select * from pg_policies`), đối chiếu mục 5.2 — giờ đã tin được schema nên làm được rồi.
6. Sửa 191 thao tác ghi không kiểm lỗi — **ưu tiên đường tiền: tạo đơn, thu tiền, phiếu kho.**

**Tháng 1 — ổn định**
5. Nốt 63 truy vấn đọc nuốt lỗi (dùng `selectResilient` sẵn có).
6. Xử lý `xlsx`: đổi nguồn cài đặt hoặc cách ly việc phân tích file tải lên.
7. Phủ test cho lương/thưởng và FIFO kho — hai chỗ sai là ra tiền.
8. Phân trang cho các truy vấn không giới hạn.

**Quý 1 — bền vững**
9. Tách `order-form.tsx` và `orders/[id]/page.tsx`; đưa logic nghiệp vụ về `src/lib` để test được.
10. Thêm CI chạy `npm run verify` trên mỗi PR.
11. Test đầu-cuối (Playwright) cho 3 luồng sống còn: tạo đơn → duyệt → giao; thu tiền; nhập kho.
12. Cân nhắc nâng Next 15.

---

## 8. Vận hành — chẩn đoán sự cố

Công cụ có sẵn trong `supabase/diagnostics/` — dán vào **Supabase → SQL Editor**.
Tất cả **chỉ đọc**, không đụng dữ liệu.

| Triệu chứng | Chạy cái này | Ý nghĩa |
|---|---|---|
| Bất kỳ hành vi lạ nào | `check_migration_drift.sql` | **Luôn chạy đầu tiên.** Đối chiếu schema thật với 84/90 migration, chỉ rõ thiếu migration nào và thiếu gì |
| Trang sản phẩm rỗng | `check_products_empty.sql` | Kiểm 6 nguyên nhân: DB trống, thiếu cột, thiếu khoá ngoại, RLS chặn, trạng thái, bẫy gán nhà cung cấp |
| Không lưu được phân quyền | — | Chạy `migrations/090_fix_role_permissions_module_check.sql` |
| Danh sách rỗng không rõ lý do | — | Mở F12 → Console. Nếu thấy lỗi 400 → lệch schema. Nếu không lỗi mà vẫn rỗng → RLS chặn |

**Cảnh báo vàng "cơ sở dữ liệu chưa chạy đủ migration"** trên trang Sản phẩm
nghĩa là hệ thống đang chạy bằng đường dự phòng. Trang vẫn dùng được nhưng
**các thao tác ghi có thể hỏng** — hãy chạy dò lệch ngay.

Sinh lại công cụ dò lệch sau khi thêm migration mới:

```bash
python3 scripts/build-drift-check.py
bash scripts/build-combined-migration.sh   # sinh lại schema_full.sql + seed_demo.sql
```

---

## 9. Quy ước khi sửa code

- **Không dùng `.select('*')`** — có lint chặn. Liệt kê cột tường minh. Nhưng
  **phải xử lý `error`**; xem `src/lib/supabase/resilient.ts` để có sẵn cả hai.
- **Đặt logic nghiệp vụ vào `src/lib/`**, không nhét vào component — để test được.
- **Mọi thao tác ghi phải kiểm `error`** và báo cho người dùng bằng toast.
- **Migration phải idempotent**: `DROP ... IF EXISTS` trước mọi `CREATE`.
- **Giao diện dùng token màu semantic** (không hard-code mã màu) — xem
  `.claude/skills/design-ux-ui/SKILL.md`.
- Chạy `npm run verify` trước khi push.
