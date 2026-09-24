# npp.sale — quy tắc dự án

ERP nhà phân phối (Next.js 14 + Supabase + Tailwind/shadcn). Trả lời chủ nhà bằng **tiếng Việt**.
Quy tắc giao diện: `.claude/skills/design-ux-ui/SKILL.md`.

## 1. Nghiệp vụ — KHÔNG ĐƯỢC LÀM SAI

### Công nợ tính theo HÓA ĐƠN, không theo đơn hàng
Chủ nhà chốt 24/09/2026: *"công nợ đang tính theo đơn hàng, phải tính theo Hoá đơn mới đúng"*.
- Nguồn sự thật duy nhất của công nợ phải thu là bảng `receivables`: **mỗi hóa đơn đã ghi sổ
  (`sales_invoices.status = 'posted'`) một phiếu**, qua `_wf2b_recompute_receivable(invoice_id)`.
  Nợ đầu kỳ (`opening_balance`) là phiếu không có hóa đơn.
- **Không bao giờ** lấy `sales_orders.total` làm số nợ, cộng tổng đơn "Hoàn thành" làm bên Nợ, hay
  tạo / cập nhật `receivables` theo `order_id` (`ensureReceivableForOrder`, `recomputeReceivableForOrder`
  là luồng cũ — đã khoá).
- Đơn nhiều hóa đơn = nhiều phiếu công nợ: **gộp** (`gopCongNoCuaDon` / `gopCongNoTheoDon` trong
  `src/lib/orders/receivable-sum.ts`), không lấy dòng đầu / dòng cuối.
- Nhãn và liên kết của một khoản nợ là **mã hóa đơn** (`/sales-invoices/<id>`); mã đơn chỉ là thông
  tin phụ.
- Nợ của khách = Σ(`amount − paid`) trên các phiếu `status <> 'paid'` — dùng `loadCustomerDebt`
  (`src/lib/pos/load.ts`) hoặc `loadDebtByCustomer` (`src/lib/sell/debt.ts`), đừng tự viết lại.
- Kiểm hạn mức = **nợ sẵn có + đơn này** so với `credit_limit`.

### Doanh thu tính theo HÓA ĐƠN
Chủ nhà chốt 24/09/2026: *"làm tiếp phần doanh thu tính theo hoá đơn"*.
- Doanh thu = Σ `sales_invoices.total` của hóa đơn **`status = 'posted'`**
  (`is_revenue_invoice_status`), theo **`invoice_date`**; theo mặt hàng thì từ `sales_invoice_lines`
  của hóa đơn đã ghi sổ. Như `dashboard_summary` (mig 126).
- **Không** cộng `sales_orders.total` (đơn "Hoàn thành") làm doanh thu. Đơn hàng chỉ dùng cho số
  liệu HOẠT ĐỘNG (số đơn đã đặt, nháp…).
- `invoice_date` là DATE: so bằng ngày theo giờ VN (`vnDateKey`), không so với mốc ISO/UTC.

### Chuyến giao
Chủ nhà 24/09/2026: không dùng chuyến giao nữa — không làm thêm gì cho luồng chuyến giao.

### Công nợ ÂM khi hàng trả nhiều hơn hàng xuất
Chủ nhà chốt 24/09/2026 (mig 186): phần hàng trả vượt tiền hóa đơn phải ghi thành **công nợ âm**,
không được kẹp về 0.
- `receivables.amount < 0` là **dư có** của khách: vẫn `'open'` tới khi dùng hết (trigger
  `trg_cong_no_am_trang_thai`), được trừ vào tổng nợ, được rút ở phiếu thu (`paid − amount`).
- **Không** kẹp từng dòng về 0 khi cộng nợ (`Math.max(0, amount − paid)` là sai).
- Màn thu tiền không liệt kê dòng âm (không phải khoản để thu).
- POS: "Khách cần trả" vẫn kẹp 0; phần vượt hiện dòng "Ghi có cho khách (công nợ âm)"
  (`tachPhaiTra` trong `src/lib/pos/totals.ts`).

### Quyền
- Tiền, tồn kho, trạng thái chứng từ chỉ đổi qua **RPC** — không ghi thẳng từ trình duyệt.
- Giảm giá: nhân viên theo `users.allow_discount` + trần `discount_max_*` (mig 185); chủ NPP / kế
  toán toàn quyền.
- In ở POS: trang in riêng `/in/*` nạp vào khung ẩn (`inTaiCho`); header phải là
  `X-Frame-Options: SAMEORIGIN` (DENY làm nút In không chạy).

## 2. Git / phát hành
- **Chỉ push lên nhánh `newdesign`** (`git push -u origin newdesign`). Không push `main`. Không tạo PR
  khi chưa được bảo.
- Preview và production **dùng chung một DB Supabase** — migration chạy là chạy thật.
- Commit message tiếng Việt. Không ghi tên / mã model vào bất cứ thứ gì đẩy lên repo.

## 3. Migration (`supabase/migrations/NNN_*.sql`)
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`), đầu tệp có khối **VÌ SAO**
  (trích lời chủ nhà + ngày).
- Thẻ dollar ASCII (`$fn$`, `$chk$`…). Hàm `SECURITY DEFINER` nội bộ phải
  `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (luật mig 166).
- Kết thúc bằng `NOTIFY pgrst, 'reload schema';` và một câu `SELECT` tóm tắt kết quả.
- Thêm một dòng kiểm vào `scripts/sql/kham-so-that.sql`, rồi chạy
  `bash scripts/build-combined-migration.sh`.
- Nhắc chủ nhà các migration cần chạy trên Supabase sau mỗi đợt.

## 4. Trước mỗi commit
`npx tsc --noEmit` · `npx next lint` · `npx vitest run` · `npx next build` · `npx playwright test` (đủ bộ).
- Mỗi sửa lỗi có test; thử phá (mutation) để chắc test bắt được lỗi.
- Không thêm thư viện mới.

## 5. Bảo mật
- **Không bao giờ xin hay nhận khoá / mật khẩu / token qua chat** (chủ nhà: *"đừng đưa khoá cho
  tôi qua chat — nó sẽ nằm lại trong lịch sử hội thoại"*).
