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
3. **Lỗi bị nuốt trên diện rộng** — *đã xử lý xong trong đợt này.* Hàng trăm
   thao tác ghi/đọc từng bỏ qua `error`, khiến hệ thống hỏng mà **không báo
   gì**. Nay thao tác ghi đều báo lỗi cho người dùng, truy vấn đọc đều ghi log
   chẩn đoán, và con số hiện là **0**. CI chạy
   `scripts/audit-unchecked-db.py --strict` nên không thể tái diễn.

**Có dùng được không?** Có. Cả ba điểm trên đã được xử lý trong đợt chuẩn bị bàn
giao: schema đã đồng bộ, migration đã chạy lại được, và lỗi không còn bị nuốt.
Khoảng trống lớn nhất còn lại là **thiếu test cho tầng giao diện** (mục 4).

---

## 1b. VIỆC BẠN CẦN LÀM — 6 việc, khoảng 40 phút

Đây là toàn bộ những gì tôi **không tự làm được** (cần quyền trên Supabase,
hoặc cần người thật mở trang kiểm chứng). Làm theo thứ tự.

| # | Việc | Ở đâu | Vì sao |
|---|---|---|---|
| 1 | Chạy `supabase/migrations/092_rls_hardening.sql` | Supabase SQL Editor | Vá 3 lỗ hổng RLS đã kiểm chứng. **Có 1 thay đổi hành vi thật với vai trò `sales`** — xem 5.2 |
| 2 | Chạy `supabase/migrations/093_aggregate_functions.sql` | Supabase SQL Editor | **BẮT BUỘC.** Tạo 13 hàm cộng số. Chưa chạy thì trang Công nợ / Tổng quan / Báo cáo tài chính sẽ lỗi "function does not exist" — xem 5.1c |
| 3 | Sau khi chạy 092: nhờ **mỗi vai trò mở thử 1 trang** — kho (Kho hàng + lịch sử xuất nhập), kế toán (Phiếu thu), bán hàng (Công nợ) | Trên web | View luôn trả `200 + []` khi bị RLS chặn, tức là **hỏng mà không có lỗi nào hiện ra**. Chỉ mở mắt nhìn mới biết |
| 4 | Chạy `094` → `095` → `096` → `097` **theo đúng thứ tự** | Supabase SQL Editor | Sửa 5 lỗi bảng lương + chuyển sang doanh số thuần. **ĐỔI SỐ TIỀN THẬT** — đọc mục 0.1 trước khi chạy |
| 5 | Sau khi chạy 094–097: mở **Bảng lương → Tính lại** cho kỳ đang mở, xuất Excel, **so tay với bảng lương tháng trước** | Trên web | Bốn migration này đổi công thức tính tiền. Phải nhìn số trước khi trả lương, không chạy xong là tin ngay |
| 6 | Chạy `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` rồi `npm run verify` | Máy của bạn | Nâng `xlsx` lên bản đã vá. Tôi bị chặn ra CDN của SheetJS nên không chạy được. Chi tiết ở 5.1a |

**Việc 2 là gấp nhất** — deploy mới đã lên `main`, mã nguồn đang gọi các hàm
SQL đó. Chưa chạy migration 093 thì trang Công nợ, Tổng quan và Báo cáo tài
chính sẽ báo lỗi. Việc 6 không gấp — đường khai thác đã bị chặn trong mã
nguồn rồi.

### 0.1 Bốn migration lương làm ĐỔI SỐ TIỀN — đọc trước khi chạy

`094`, `095`, `096`, `097` không phải sửa lỗi hiển thị. Chúng đổi công thức
trả lương. Mọi thay đổi dưới đây đều đã dựng lại trên Postgres thật, so số
bản cũ với bản mới trên cùng một bộ dữ liệu:

| Tình huống | Trước | Sau |
|---|---|---|
| NV có đơn đang xuất kho / đang giao lúc bấm "Tính lại" | 447.500 đ | 9.650.000 đ |
| Cấu hình thưởng chọn chu kỳ **"Tuần"** | 1.200.000 đ | 0 đ |
| Bấm "Tính lại" sau khi kế toán trừ tạm ứng 2,5tr | trả thừa 2,5tr | giữ đúng |
| Doanh thu trang Tổng quan (có 1 đơn nháp + 1 đơn huỷ) | 318 triệu | 120 triệu |

**Điều dễ gây tranh cãi nhất — ngưỡng 60% giờ dễ rơi hơn nhiều.** Lương nay
tính trên doanh số **thuần** (đã trừ hàng trả lại). Chính sách "đạt dưới 60%
mức A thì mất lương cứng và mất sạch phụ cấp" vốn đã có, nhưng trước đây tỉ
lệ trả hàng không ảnh hưởng gì tới lương. Nay thì có:

- bán 100tr, khách trả 25tr → thuần 75tr → 75% → lương **9.650.000 đ**
- bán 100tr, khách trả 45tr → thuần 55tr → 55% → lương **492.250 đ**

Cùng một người bán đúng 100tr, chênh **19 lần** tuỳ tỉ lệ trả hàng. Đây là
hệ quả của hai chính sách nhân với nhau, không phải lỗi phần mềm — nhưng
nếu chưa lường trước thì tháng đầu tiên sẽ có nhân viên thắc mắc. Muốn dịu
đi thì chỉnh `under_60_percent` hoặc hạ ngưỡng 60% trong Cấu hình lương.

Hàng trả nhiều hơn hàng bán thì doanh số thuần **kẹp về 0**, không âm — nếu
không thì công thức cho ra lương âm (đã chạy thử: −358.000 đ). Phần trả vượt
được ghi lại trong phiếu lương (`returns_excess`) chứ không tự trừ sang kỳ
sau; muốn trừ tiếp thì phải quyết chính sách rồi mới làm.

**Phiếu lương in ra nay có dòng "bán X − hàng trả lại Y = Z"** để nhân viên
tự đối chiếu được, không phải hỏi kế toán.

**Phiếu trả lập cuối tháng, duyệt đầu tháng sau** trừ vào lương THÁNG SAU,
không phải tháng lập. Trước `097` khoản đó rơi vào khoảng trống giữa hai kỳ
và mất hẳn — đã dựng lại được: phiếu 25tr lập 28/09, duyệt 03/10, không trừ
vào T9 (lúc chốt còn `pending`) cũng không vào T10 (gom theo ngày lập), và
tính lại T9 thì báo `PAYROLL_RUN_LOCKED`. Nay gom theo ngày DUYỆT. Trước khi
khoá một kỳ, gọi `payroll_unbilled_returns('YYYY-MM-01')` để xem có phiếu
nào lập trong kỳ mà duyệt sau kỳ không.

### 0.2 Hai điều CHỦ NPP phải quyết — tôi cố ý không tự sửa

Đợt rà soát tìm ra hai chỗ đúng về mã nguồn nhưng câu trả lời là **chính
sách**, không phải kỹ thuật. Tôi để nguyên và nêu ra đây.

**a) Một bậc KPI riêng có ngưỡng 0 sẽ vô hiệu hoá toàn bộ mức chung A.**
Hàm lương xét bậc riêng của nhân viên TRƯỚC; tìm thấy thì bỏ qua cả mức
chung A lẫn hình phạt dưới 60% / dưới 70%. Đó là ý đồ của chữ "riêng" —
nhưng màn thêm bậc mặc định điền `min_revenue = 0`
(`settings/users/[id]/salary/page.tsx:108`), mà ngưỡng 0 thì luôn khớp.
Nghĩa là chỉ cần thêm một bậc thử rồi quên xoá, nhân viên đó vĩnh viễn
thoát hình phạt dưới 60% mà không có dấu hiệu nào.
Tôi đã cho **phiếu lương nói rõ** "áp dụng bậc riêng — KHÔNG áp dụng mức
chung A và luật dưới 60%/70%" để cấu hình nhầm hiện ra. Còn có nên chặn
`min_revenue = 0` ở giao diện, hay bậc riêng vẫn phải chịu hình phạt, thì
là quyết định của bạn.

**b) Ba định nghĩa doanh thu vẫn chưa về một mối.**
- Bảng lương + Tổng quan: đơn **đã chốt và chưa huỷ** (gồm đang giao)
- Báo cáo lãi lỗ (`093:360` `finance_pnl`): chỉ đơn **đã giao xong**
- Báo cáo nhân viên: đơn đã giao, trừ hàng trả

Chênh lệch giữa (1) và (2) là câu hỏi kế toán thật: ghi nhận doanh thu lúc
**chốt đơn** hay lúc **giao xong**. Trả lương theo lúc chốt đơn là hợp lý
(nhân viên bán xong là xong việc của họ); ghi sổ lãi lỗ theo lúc giao xong
cũng hợp lý. Nên có thể đây KHÔNG phải lỗi — nhưng phải là lựa chọn có ý
thức, vì hiện hai trang cùng ghi "doanh thu" mà ra hai số khác nhau.

> `Max rows = 1000` trên Supabase: **giữ nguyên, không cần chỉnh.** Từng là
> nguyên nhân làm các trang tổng hợp cộng thiếu tiền; nay đã xử lý — xem 5.1c.

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
src/lib/                 48 file logic thuần — NƠI ĐÁNG TIN CẬY NHẤT để sửa
src/hooks/               use-auth, use-order-sync, use-role-guard...
supabase/migrations/     97 file, chạy TUẦN TỰ theo số
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
| `093_aggregate_functions.sql` | **Trang Công nợ / Tổng quan / Báo cáo tài chính báo lỗi "function does not exist"** |
| `091_backfill_missing_objects.sql` | **Bù 3 mục schema đang thiếu trên production** — gồm cả cột của 089 (đơn ngoại tuyến không đồng bộ được) và của 025 (trang Sản phẩm) |
| `094` → `095` → `096` → `097` (chạy đủ cả bốn, đúng thứ tự) | **Bảng lương trả sai tiền.** Doanh số nhảy theo tiến độ kho; thưởng chu kỳ "Tuần" trả thừa ~4 lần; nút "Tính lại" xoá trắng số kế toán sửa tay; NV bán hàng gọi được RPC tính lương của cả công ty; doanh thu Tổng quan tính cả đơn đã huỷ. Chi tiết + bảng so số ở mục 0.1 |

---

## 4. Tình trạng chất lượng (số liệu thật, đo ngày 2026-08-21)

| Hạng mục | Kết quả |
|---|---|
| `npm run typecheck` | ✅ sạch |
| `npm run lint` | ✅ không lỗi (còn cảnh báo nhẹ) |
| `npm run build` | ✅ 101 trang |
| `npm test` | ✅ **330 test / 14 file, tất cả xanh** |
| CI | ✅ `.github/workflows/verify.yml` — 4 bước trên + chặn merge nếu có truy vấn DB chưa kiểm lỗi |
| Truy vấn DB chưa kiểm lỗi | ✅ **0 ghi / 0 đọc** (`scripts/audit-unchecked-db.py`) |
| Quy mô | 76.290 dòng TS/TSX · 123 trang · 8 API route · 75 component · 48 lib · 92 migration |
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
| `tests/luong-thuong.test.ts` | Hệ số ngày công, vai trò bỏ qua chấm công, thưởng đầu thùng, thưởng theo mốc số đơn | 21 |
| `tests/fifo.test.ts` | Gộp giá vốn theo lớp, trừ tồn qua RPC, suy biến khi thiếu migration 040 | 21 |
| `tests/aggregate.test.ts` | Lấy đủ dữ liệu khi server chặn 1.000 dòng/lần, chia trang song song | 14 |
| `tests/stock-check.test.ts` | Kiểm tồn khi soạn đơn: quy đổi đơn vị, cộng dồn nhiều dòng, hàng đổi | 27 |
| `tests/aging-thresholds.test.ts` | Khoá ngưỡng tuổi nợ giữa SQL và TypeScript; các bất biến bảo mật của migration 093 | 7 |
| `tests/permissions.test.ts` | Quyền theo module và theo tính năng, override là phần chênh lệch, owner không tự khoá được | 28 |
| `tests/period.test.ts` | Mốc thời gian báo cáo: tuần bắt đầu thứ Hai, năm nhuận, kỳ so sánh không chồng lấn | 33 |
| `tests/crypto.test.ts` | Mã hoá credentials MISA: khứ hồi, IV ngẫu nhiên, auth tag chống sửa đổi | 15 |
| `tests/import-product.test.ts` | Đọc file Excel sản phẩm: header KiotViet, tiền/VAT, gộp đơn vị quy đổi | 39 |
| `tests/import-customer-supplier.test.ts` | Đọc file khách hàng / NCC: chống trùng, điều khoản thanh toán, kênh bán | 31 |
| `tests/misa-mapper.test.ts` | Dựng hoá đơn thuế: thuế tính sau chiết khấu, nhiều mức VAT, quy đổi đơn vị không đổi tổng tiền | 33 |
| `tests/search.test.ts` | Tìm kiếm bỏ dấu tiếng Việt, kể cả chữ đ/Đ mà `normalize("NFD")` không tách được | 27 |
| `tests/payroll-sql.test.ts` | 5 bất biến bảng lương của migration 094: doanh số không bỏ sót đơn đang giao, thưởng theo tuần, "Tính lại" không xoá số sửa tay, chặn vai trò | 24 |
| `tests/payroll-net-revenue.test.ts` | Doanh số thuần: trừ đúng khoản/đúng phiếu/đúng người/đúng kỳ (giờ VN), chặn số âm. **Tự tìm migration mới nhất định nghĩa hàm** thay vì bám số hiệu cố định | 28 |

**Độ phủ đo bằng `npx vitest run --coverage`** (tính trên `src/lib`):

| Vùng | Dòng được phủ |
|---|---|
| `lib/inventory` (UOM, FIFO) | 100% |
| `lib/customers`, `lib/products`, `lib/suppliers` (nhập file) | 92–99% |
| `lib/utils` | 95% |
| `permissions.ts`, `crypto.ts`, `analytics/period.ts`, `salary.ts`, `approval.ts` | 100% |
| `lib` nói chung | 34,5% |

⚠️ **Vẫn ở mức 0%** — xếp theo mức thiệt hại nếu sai:

| Vùng | Vì sao đáng lo |
|---|---|
| `lib/payroll/run.ts`, `lib/payroll/bonus.ts` | Tính lương và thưởng thực trả |
| `lib/orders/create.ts` + validator | Tạo đơn, kiểm hạn mức |
| `lib/returns.ts`, `lib/receivables.ts` | Trả hàng và công nợ |
| `lib/offline/*` | Đồng bộ đơn ngoại tuyến |
| `lib/handover/confirm.ts`, `lib/locking/entity-lock.ts` | Bàn giao và khoá bản ghi |
| `lib/misa/client.ts` | Gọi API MISA (phần dựng dữ liệu đã phủ 100%) |
| Toàn bộ 123 trang giao diện | Chưa có test nào |

Phần lớn nhóm còn lại là hàm bọc quanh truy vấn database, muốn test tử tế
thì cần dựng client giả như `tests/fifo.test.ts` đang làm — làm được, chỉ
là chưa làm.

**Lưới an toàn tự động.** `.github/workflows/verify.yml` chạy typecheck → lint →
test → build trên mỗi push vào `main` và mỗi pull request, cộng một bước **chặn
merge** nếu xuất hiện truy vấn database không kiểm lỗi. Người tiếp nhận không
cần nhớ chạy tay.

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

**Đã kiểm nốt mục cuối:** policy `visit_photos_*` ở schema `storage` — xác nhận
đủ cả 3 (`insert`/`select`/`delete`), chức năng chụp ảnh viếng thăm khách hàng
hoạt động bình thường. Bản dò cũ báo thiếu là do tìm nhầm trong schema `public`.

➡️ **Kết luận: schema production hiện KHỚP HOÀN TOÀN với mã nguồn.** Từ nay chỉ
cần chạy `check_migration_drift.sql` sau mỗi lần deploy có migration mới; kết
quả không có dòng nào = vẫn khớp.

### 5.1 Đã kiểm chứng bằng bằng chứng cụ thể

| # | Mức | Vấn đề | Ảnh hưởng | Vị trí |
|---|---|---|---|---|
| 1 | ✅ Đã sửa | DB production lệch so với migration | Từng là nguyên nhân gốc của ≥3 sự cố | `migrations/091_backfill_missing_objects.sql` |
| 2 | ✅ Đã sửa | 141 `CREATE POLICY` thiếu `DROP IF EXISTS` | Từng khiến migration không chạy lại được → cài đặt dở dang. Nay đã idempotent | `scripts/make-policies-idempotent.py` |
| 3 | ✅ Đã sửa | Thao tác ghi không kiểm lỗi | Người dùng tưởng đã lưu nhưng dữ liệu không vào DB | **0 còn lại**, CI chặn tái diễn |
| 4 | ✅ Đã sửa | Truy vấn đọc bỏ qua `error` | Lỗi hiện thành "không có dữ liệu" → không chẩn đoán được | **0 còn lại**, CI chặn tái diễn |
| 5 | 🟡 Đã giảm thiểu | **`xlsx@0.18.5` — Prototype Pollution, chưa có bản vá trên npm** | Đã cô lập đường khai thác (xem 5.1a). Còn lại: nâng thư viện lên bản vá | `src/lib/xlsx-safe.ts` |
| 6 | ✅ Đã sửa | **Trang tổng hợp cộng số phía trình duyệt, `max_rows=1000` cắt mất dòng** | Từng hiển thị số tiền THIẾU mà không báo gì. Nay cộng trong database — xem 5.1c | `migrations/093_aggregate_functions.sql` |
| 7 | 🟡 Trung | **8 file trên 800 dòng** (lớn nhất 2.090) | Khó đọc, khó test. Đã rút phần kiểm tồn của `order-form` ra `lib/orders/stock-check.ts` (27 test) | `orders/[id]/page.tsx` |
| 8 | 🟢 Thấp | `userSalesCeiling` trả `110000.00000000001` | Chưa gây lỗi (validate có dung sai 0,5đ) nhưng sẽ sinh lỗi lạ nếu dùng làm `max` của ô nhập | `src/lib/pricing.ts` |

**Về lỗ hổng dependency:** 5 cảnh báo mức cao. Đã phân tích từng cái:

- `xlsx` → **đã giảm thiểu trong code, còn 1 việc cần bạn làm** (xem 5.1a ngay bên dưới).
- `next@14.2.35` → là bản mới nhất của dòng 14. Cảnh báo liên quan
  `images.remotePatterns` mà **dự án không cấu hình `images`** → **không có đường
  khai thác**. Chỉ hết cảnh báo khi lên Next 15.
- `nanoid`, `postcss`, `ws` → phụ thuộc gián tiếp, không nằm trên đường đi của
  dữ liệu người dùng. Rủi ro thực tế thấp.

### 5.1a `xlsx` — đã làm gì, còn phải làm gì

**Phạm vi thật.** Có đúng 3 chỗ phân tích file do người dùng tải lên: nhập khách
hàng, nhập sản phẩm, nhập nhà cung cấp. Cả 3 đều dùng `await import("xlsx")` →
**chạy hoàn toàn phía trình duyệt**. Không có đường phân tích file phía máy chủ.
Nghĩa là hậu quả tệ nhất giới hạn trong phiên của chính người mở file — không
phải lỗ hổng máy chủ, không lan sang người dùng khác.

**Đã làm.** Thêm `src/lib/xlsx-safe.ts` và chuyển cả 3 hộp thoại nhập liệu sang
gọi `readSheetAsRows(file)`. Hàm này chụp lại các khoá nguy hiểm trên
`Object.prototype` trước khi phân tích rồi khôi phục ngay sau, đồng thời lọc
`__proto__` / `constructor` / `prototype` khỏi dữ liệu trả về. Payload
Prototype Pollution do đó không bám lại được vào ứng dụng.

> ⚠️ Quy ước bắt buộc: **đừng gọi `XLSX.read()` trực tiếp ở bất kỳ chỗ nào khác.**
> Mọi nơi đọc file người dùng phải đi qua `readSheetAsRows`.

**Còn lại — bạn cần chạy trên máy mình** (môi trường agent bị chặn ra CDN của
SheetJS nên tôi không chạy được):

```bash
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm run verify
```

Sau lệnh này `npm audit` sẽ còn 4 cảnh báo thay vì 5. Lớp `xlsx-safe.ts` vẫn nên
giữ nguyên — nó là phòng vệ chiều sâu, không phải giải pháp tạm.

### 5.1b Về hai con số ở dòng 3–4: bản đo trước đây ĐẾM THIẾU

Bản `scripts/audit-unchecked-db.py` đầu tiên soi trong một cửa sổ cố định
12 dòng. Cách đó sai theo cả hai chiều:

- **Báo nhầm:** chuỗi dài (`.insert({…10 dòng…}).select().single().throwOnError()`)
  có phần kiểm lỗi rơi ra ngoài cửa sổ → bị coi là chưa kiểm.
- **Bỏ sót:** khử trùng theo khoảng cách dòng nên khi hai lời gọi nằm sát
  nhau, lời gọi thứ hai bị nuốt mất và không bao giờ được báo.

Vì vậy con số "47 ghi / 190 đọc" từng ghi ở đây là **thấp hơn thực tế**.
Máy dò hiện tại bám theo phạm vi biểu thức thật (độ sâu ngoặc), hiểu bốn
cách viết đang dùng trong dự án — destructure `{ error }`, `.throwOnError()`,
`const r = … / if (r.error)`, và kiểm gộp sau `Promise.all([…])` — nên đo
lại đúng hơn hẳn. Kết quả sau khi vá: **0 và 0**.

`npm run verify` chưa gọi máy dò này, nhưng CI thì có, và chạy ở chế độ
`--strict`: thêm một truy vấn không kiểm lỗi là pull request đỏ ngay.

### 5.1c Cộng số ở phía database — ĐÃ XỬ LÝ

**Vấn đề gốc.** Nhiều trang tính tổng bằng cách tải dữ liệu về trình duyệt
rồi cộng bằng JavaScript. `db.max_rows` trên Supabase là **1.000**; khi vượt
trần, API trả **200 kèm đúng 1.000 dòng và KHÔNG có lỗi nào**. Trang hiện
một con số trông bình thường — chỉ là nó thiếu. Với công nợ và bảng cân đối
kế toán, đó là sai tiền mà không có gì để lần ra.

**Cách xử lý — hai tầng, dùng đúng chỗ.**

**Tầng 1 — cộng trong database.** `supabase/migrations/093_aggregate_functions.sql`
tạo 13 hàm SQL trả về SẴN kết quả đã cộng. Một request, vài chục byte, chính
xác tuyệt đối. Dùng cho những chỗ chỉ cần con số:

| Hàm | Dùng ở |
|---|---|
| `receivables_summary()` | /receivables — tổng + 4 nhóm tuổi nợ |
| `receivables_by_rep()` | /receivables/by-rep |
| `receivables_by_customer()` | /receivables/by-customer |
| `payables_by_supplier()` | /payables/by-supplier |
| `payables_summary(since)` | /purchasing |
| `stock_value_summary()` | Báo cáo tài chính — giá trị tồn |
| `finance_pnl(from,to)` | `lib/finance.ts` — lãi lỗ |
| `finance_balance_sheet(as_of)` | `lib/finance.ts` — cân đối kế toán |
| `finance_cash_flow(from,to)` | `lib/finance.ts` — lưu chuyển tiền tệ |
| `dashboard_summary(start)` | Tổng quan — doanh thu, số đơn, công nợ, quá hạn |
| `dashboard_top_customers(start,limit)` | Tổng quan — top khách hàng |
| `dashboard_channel_revenue(start)` | Tổng quan — doanh thu theo kênh |
| `cash_received_total(from,to)` | Báo cáo tài chính — tiền mặt đã nhận |

`src/lib/finance.ts` từ 346 dòng còn 200: ba hàm giờ mỗi hàm một lời gọi RPC
thay cho 11 truy vấn tải cả bảng.

**Tầng 2 — lấy đủ qua nhiều trang.** `src/lib/supabase/aggregate.ts` →
`fetchAllForAggregate()`. Dùng cho những chỗ THẬT SỰ cần các dòng dữ liệu
chứ không chỉ con số (bảng chi phí theo danh mục, danh sách lô để kiểm kê,
sổ chi tiết công nợ). Dùng `count: "exact"` để biết tổng số dòng thật —
con số này không bị `max_rows` cắt — rồi chia trang gọi song song phần còn
lại. Trần 20.000 dòng; chạm trần thì hiện banner cảnh báo.

> ⚠️ Quy ước khi thêm mã mới:
> - Chỉ cần **con số** → viết hàm SQL mới trong migration, đừng tải dữ liệu về.
> - Cần **các dòng** → dùng `fetchAllForAggregate` kèm `count: "exact"`.
> - **Không bao giờ** để một truy vấn không giới hạn rồi `.reduce()` cộng tiền.

**Bảo mật của các hàm SQL.** Tất cả để `SECURITY INVOKER` (mặc định) nên RLS
vẫn áp dụng: nhân viên bán hàng gọi `receivables_by_rep()` chỉ cộng được
trên phần RLS cho họ thấy. **Tuyệt đối không đổi sang `SECURITY DEFINER`** —
làm vậy là mở toang số liệu tài chính cho mọi vai trò và không có lỗi nào
báo ra. Có test chặn: `tests/aging-thresholds.test.ts`.

**Một chỗ trùng lặp cần biết.** Ngưỡng phân nhóm tuổi nợ giờ nằm ở hai nơi:
`getAgingStatus()` (src/lib/utils.ts, tô màu từng dòng) và hàm SQL
`receivables_summary()` (các ô tổng). Sửa một bên mà quên bên kia thì tổng
nhóm "Quá hạn" sẽ khác số badge đỏ đếm được bên dưới. Test
`tests/aging-thresholds.test.ts` đọc thẳng file SQL và khoá hai bên lại với
nhau — nó sẽ đỏ nếu lệch.


### 5.2 Nhóm RLS — ĐÃ KIỂM CHỨNG VÀ XỬ LÝ

Trước đây nhóm này được đánh dấu "cần kiểm chứng thêm" vì database còn
lệch schema. Nay schema đã khớp, đã rà **từng khẳng định trên mã nguồn**.

**Kết quả — 2/5 khẳng định ban đầu là SAI:**

| Nghi vấn ban đầu | Kết luận sau khi kiểm |
|---|---|
| Bảng `users` dùng `USING(true)`, không lọc org | ❌ **SAI** — migration 008 đã siết `org_id` từ lâu; cảnh báo dựa vào 004 vốn đã bị 008 thay thế |
| `customers` (042) khoá warehouse/driver | ❌ **SAI** — policy có nhánh `user_has_permission(..., 'customer.view_all')`; chủ sở hữu xác nhận tài xế vẫn xem được khách hàng |
| `suppliers` dùng `USING(true)` | ✅ **ĐÚNG** — đã vá ở `092` |
| 4 view thiếu `security_invoker` → bỏ qua RLS | ✅ **ĐÚNG** — đã bật ở `092` |
| Policy `payments` của 033 bị OR làm vô hiệu | ✅ **ĐÚNG** — đã vá ở `092` |

Việc bảng `users` chạy tốt với `user_org_id()` cũng **bác bỏ nỗi lo đệ quy**
từng khiến migration 004 phải nới lỏng thành `USING(true)`.

**Migration `092_rls_hardening.sql` — cần chạy trên Supabase.** Nội dung:

1. **`suppliers` lọc `org_id`** — không đổi hành vi (1 tổ chức/1 DB), thuần
   phòng vệ chiều sâu.
2. **Bật `security_invoker` cho 4 view.** Đã kiểm tác động từng view: cả
   4 đều an toàn vì `batches` chỉ lọc `org_id` mà không hạn chế vai trò.
   Đây là chỗ dễ gây sự cố ngầm nhất — view luôn trả `200 + []` nên nếu
   vỡ thì **không bao giờ có lỗi để hiển thị**; vì vậy file có sẵn lệnh
   hoàn tác.
3. **`payments`** — **THAY ĐỔI HÀNH VI THẬT**: nhân viên bán hàng từ nay
   chỉ thấy phiếu thu của đơn **do mình tạo** (đúng ý đồ gốc của migration
   033). Các vai trò khác không đổi. Kèm lệnh hoàn tác nếu nghiệp vụ cần
   cho xem chéo.

⚠️ Sau khi chạy `092`, nhờ **mỗi vai trò mở thử một trang**: kho (Kho hàng
+ lịch sử xuất nhập), kế toán (Phiếu thu), bán hàng (Công nợ). Trang nào
rỗng bất thường thì dùng lệnh hoàn tác tương ứng trong file.

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

**Thiếu test:** toàn bộ giao diện, FIFO kho, đồng bộ ngoại tuyến.

**Kiến thức chỉ một người biết:** cấu hình MISA; ý nghĩa nghiệp vụ của các cờ
`allow_oversell`, `direct_sale`, `is_exchange`; và quan trọng nhất — **migration
nào đã thực sự chạy trên production**.

---

## 7. Lộ trình đề xuất

**Tuần 1 — cầm máu**
1. ✅ ~~Dò lệch schema~~ — đã đo, xem mục 5.0.
2. ✅ ~~Làm migration chạy lại được~~ — đã sửa 141 policy.
3. ✅ ~~Bù schema thiếu~~ — đã chạy 091, đo lại sạch.
4. ✅ ~~Kiểm `visit_photos`~~ — đủ 3 policy, không cần làm gì.
5. Kiểm tra RLS thật trên DB (`select * from pg_policies`), đối chiếu mục 5.2 — giờ đã tin được schema nên làm được rồi.
6. ✅ ~~Sửa thao tác ghi không kiểm lỗi~~ — 47 → 0.
7. **Chạy `migrations/092_rls_hardening.sql`**, rồi nhờ mỗi vai trò mở thử một trang (xem 5.2).

**Tháng 1 — ổn định**
5. ✅ ~~Truy vấn đọc nuốt lỗi~~ — **0 còn lại**; CI chạy `audit-unchecked-db.py --strict` để không tái diễn.
6. ✅ ~~Cách ly việc phân tích file tải lên~~ — đã có `xlsx-safe.ts`. Còn lệnh nâng thư viện bạn tự chạy, xem 5.1a.
7. ✅ ~~Phủ test cho lương/thưởng và FIFO kho~~ — 21 + 21 test, hai chỗ sai là ra tiền.
8. ✅ ~~Xử lý truy vấn bị `max_rows` cắt~~ và ✅ ~~cộng ở phía database~~ — 13 hàm SQL, xem 5.1c.

**Quý 1 — bền vững**
9. Tiếp tục rút logic nghiệp vụ ra `src/lib` như đã làm với `stock-check.ts`. Còn lại: `orders/[id]/page.tsx` (2.090 dòng) và phần tính giá trong `order-form.tsx`. **Rút logic ra rồi phủ test — đừng tách component thuần tuý cho ngắn file**, vì tầng giao diện chưa có test nào đỡ lưng.
10. ✅ ~~CI chạy `npm run verify` trên mỗi PR~~ — `.github/workflows/verify.yml`.
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
