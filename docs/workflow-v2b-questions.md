# Workflow v2b — Bảng map tên & câu hỏi

Pack v2b (18/09/2026) mô tả việc tách Đơn đặt hàng (SO) / Hóa đơn bán
(INV). Mục 1 của pack dặn: *"Tên hàm/cột thực tế có thể khác pack v2 →
map theo code thật, ghi vào đây."* Đây là kết quả đọc code thật ở P0.

Quy tắc: `KHỚP` tên pack đúng như code · `LỆCH` tên khác, đã map ·
`KHÔNG CÓ` pack nhắc tới thứ không tồn tại · `MỞ` cần chủ nhà quyết.

---

## A. RPC của v2 — pack sẽ thay hoặc dùng lại

| Pack gọi | Code thật | Chữ ký thật | Trạng thái |
|---|---|---|---|
| `complete_order` | `complete_order` | `(p_order_id uuid) RETURNS TABLE` | KHỚP — sẽ DROP |
| `edit_completed_order` | `edit_completed_order` | `(p_order_id, p_lines jsonb, p_subtotal, p_vat, p_total numeric, p_notes text)` | KHỚP — sẽ DROP |
| `cancel_order` | `cancel_order` | `(p_order_id uuid, p_reason text) RETURNS void` | KHỚP — viết lại (2.5) |
| `_wf2_recompute_receivable` | `_wf2_recompute_receivable` | `(p_order_id uuid) RETURNS uuid` | KHỚP — thay bản theo `invoice_id` |
| `_wf2_export_order` | `_wf2_export_order` | `(p_order_id uuid, p_lines jsonb, p_note text) RETURNS TABLE(entry_id, short_qty, near_expiry_skipped)` | KHỚP — đổi tham số nhận lines từ INV |
| `_wf2_restock` | `_wf2_restock` | `(p_source_line_id uuid, p_qty_base numeric, p_note text, p_entry_id uuid) RETURNS void` | KHỚP — giữ |
| `_wf2_notify` | `_wf2_notify` | `(p_user_id, p_type, p_title, p_body, p_link text) RETURNS void` | KHỚP — giữ |
| `post_stock_export` | `post_stock_export` | mig 107 | KHỚP — giữ |
| — | `_wf2_assert_order_unlocked(p_order_id, p_order_date date, p_check_age boolean)` | | **Pack không nhắc.** Đây là nơi cài 4 khoá "sửa sau Hoàn thành" (D6 bỏ). Phải DROP cùng `edit_completed_order`, nếu không nó thành mã chết còn đọc `completed_edit_days`. |
| `complete_return` / `cancel_return` | có | `(uuid, text)` | KHỚP — đổi sang gọi `_wf2b_recompute_receivable` |
| `create_cash_receipt` / `void_cash_receipt` | có | `(jsonb)` / `(uuid, text)` | KHỚP — không đổi logic (2.7) |

## B. Bảng & cột

| Pack gọi | Code thật | Trạng thái |
|---|---|---|
| `sales_order_lines.quantity`, `unit_price`, `line_discount`, `line_total`, `conversion_factor` | đủ cả | KHỚP |
| `sales_order_lines.vat_rate` (ngụ ý ở 1.2 khi snapshot sang INV) | **KHÔNG CÓ** | ⚠ Dòng đơn hàng KHÔNG lưu thuế suất — nó đọc từ `products.vat_rate` lúc tính. `return_lines` thì CÓ `vat_rate` (mig 069). Xem M1. |
| `sales_orders.completed_at`, `completed_by`, `order_code`, `payment_terms` | đủ cả | KHỚP |
| `organizations.completed_edit_days`, `allow_oversell` | đủ cả (mig 086 / 119) | KHỚP |
| `receivables.order_id` | có | KHỚP — thêm `invoice_id` |
| `cash_receipt_lines.order_id` | có | KHỚP — thêm `invoice_id` |
| `returns.order_id`, `credit_note_amount`, `credited_at`, `is_exchange` (ở `return_lines`) | có | KHỚP |
| `invoices.order_id`, `.status` (HĐĐT MISA) | có, `status IN ('draft','issued','cancelled')` | KHỚP — thêm `sales_invoice_id` |
| `stock_line_consumptions` | có (mig 119:417) | KHỚP — giữ |
| `order_activity_log.action` CHECK | `('add_line','edit_line','remove_line','edit_after_complete','cancel_after_complete')` | LỆCH — pack 2.3 muốn thêm `'invoice_cancelled'`; hai giá trị `*_after_complete` sẽ thành mã chết khi bỏ sửa-sau-hoàn-thành |
| `notifications.type` CHECK | có `order_completed`, `order_edited` | KHỚP — D12: bỏ `order_edited`, thêm `invoice_cancelled` |

## C. TypeScript

| Pack gọi | Code thật | Trạng thái |
|---|---|---|
| `lib/orders/completed-delta.ts` | **KHÔNG CÓ** | ⚠ Không tồn tại tệp nào tên vậy, và không có mã nào import `completed-delta`. Phép tính delta kho nằm TRONG `edit_completed_order` (SQL). Mục 5 dặn "xóa tệp + test" — không có gì để xoá. |
| `canEditCompleted`, `whyLockedCompleted` | `src/lib/orders/edit-permission.ts:115,126` | KHỚP — sẽ xoá |
| `lib/orders/edit-permission.ts` | có, 128 dòng | KHỚP. ⚠ Còn export `canEditOrder`, `canFullEditOrder`, `whyCannotEdit` — ba hàm này dùng cho SO `draft`/`submitted`, **GIỮ** |
| `lib/sell/pricing` (công thức tổng tiền, 2.2) | `pricing.ts` chỉ có chọn ĐƠN GIÁ (`unitPriceFor`, `conversionFor`…). Công thức tổng nằm ở **`src/lib/sell/cart.ts` → `cartTotals()`** | LỆCH — port sang SQL phải theo `cartTotals`, xem M2 |
| `paymentTermsToDays` | có nhưng là hàm **private** trong `src/lib/returns.ts:291`, không export | LỆCH — xem M3 |
| `lib/orders/edit-validator.ts` (`WorkflowStage`) | có | KHỚP |
| `components/orders/*` | `order-drawer`, `desktop-order-table`, `mobile-order-list`, `mobile-order-detail`, `pipeline-tabs`, `order-pipeline`, `order-table`, `approval-badge`, `route-filter` | KHỚP |
| `components/orders/invoice-dialog.tsx` (3.2) | chưa có | Tạo mới ở P4 |

---

## M. Những chỗ LỆCH cần xử lý (ghi để không ai ngạc nhiên)

### M1 — Dòng đơn hàng không lưu thuế suất
`sales_invoice_lines.vat_rate` (1.2) không có nguồn snapshot trên
`sales_order_lines`. Ở v2, VAT của một dòng tính từ `products.vat_rate`
ngay lúc bấm (`cart.ts` đọc `vatRate` từ sản phẩm).

**Thi hành, không hỏi:** `post_invoice` đọc `products.vat_rate` tại thời
điểm ghi sổ và snapshot vào `sales_invoice_lines.vat_rate`.
⚠ Hệ quả: đổi thuế suất sản phẩm rồi xuất tiếp đợt hai của cùng một SO
thì hai INV có thuế suất KHÁC NHAU. Đó là đúng về kế toán (thuế theo
thời điểm xuất), nhưng cần biết trước để không tưởng là lỗi.

### M2 — Công thức tổng tiền nằm ở `cart.ts`, không phải `pricing.ts`
`cartTotals()` (`src/lib/sell/cart.ts:109`):
```
gross    = Σ qty × listPrice
subtotal = Σ qty × price
vat      = Σ qty × price × vatRate      ← VAT trên GIÁ ĐANG ÁP, không trên giá bảng
discount = max(0, gross − subtotal)      ← chỉ nhận phần GIẢM
grandTotal = max(0, round(subtotal + vat − returnCredit))
```
làm tròn về ĐỒNG ở từng con số tổng (`Math.round`), không làm tròn từng dòng.

**Thi hành:** port đúng công thức này sang SQL trong `post_invoice`.
`invoice-totals.test.ts` (mục 5) sẽ so SQL với `cartTotals` trên 5 bộ số.
⚠ Chú ý `round` áp ở TỔNG chứ không ở DÒNG — port sai chỗ làm tròn là
lệch vài đồng mỗi hoá đơn.

### M3 — `paymentTermsToDays` là hàm private
`post_invoice` cần nó để tính `due_date` (2.2 bước 4).
**Thi hành:** export nó khỏi `src/lib/returns.ts` (hoặc chuyển sang
`src/lib/constants.ts`) và viết bản SQL tương ứng trong migration, kèm
chốt so hai bản — hai nguồn sự thật cho cùng một phép tính là chỗ lệch
kinh điển.

### M4 — `_wf2_assert_order_unlocked` phải DROP cùng
Pack 1.10 liệt kê DROP `edit_completed_order`, `complete_order`,
`cancel_order` nhưng không nhắc hàm này. Nó chỉ phục vụ 4 khoá của
"sửa sau Hoàn thành" (D6 bỏ) và là chỗ duy nhất đọc
`completed_edit_days`. Để lại là mã chết còn đọc một cột pack bảo ngừng
dùng. **Thi hành: DROP cùng.**

### M5 — Giao diện "sửa đơn đã Hoàn thành" CHƯA TỪNG ĐƯỢC NỐI
Đo thật: **không mã client nào gọi `edit_completed_order` hay
`cancel_order`.** Chỉ `complete_order` có đường gọi
(`src/lib/orders/complete-order.ts:125`). `orders/[id]/page.tsx` import
`canEditOrder`, `canFullEditOrder`, `whyCannotEdit` — không import
`canEditCompleted`/`whyLockedCompleted`.

⚠ Nghĩa là phần lớn việc "gỡ edit-mode cho completed" ở 3.2 **không có
gì để gỡ**, và hai RPC kia chưa bao giờ chạy từ ứng dụng. Điều này làm
P4 nhẹ đi nhiều so với dự tính của pack — nhưng cũng nghĩa là chúng chưa
từng được thử trên dữ liệu thật.

### M6 — Hai giá trị `order_activity_log.action` sẽ thành mã chết
`edit_after_complete`, `cancel_after_complete` chỉ do
`edit_completed_order` / `cancel_order(completed)` ghi. Bỏ hai RPC đó là
không ai ghi nữa. **Thi hành:** giữ trong CHECK (dữ liệu cũ đã có), thêm
`invoice_cancelled`, và ghi chú rõ hai giá trị kia là lịch sử.

### M7 — Bộ test hiện ghim chặt hai RPC sắp bị xoá
`tests/workflow-v2-rpcs.test.ts` (67 chốt) đọc thẳng mã nguồn của
`edit_completed_order` và `cancel_order` — ví dụ
`fn("cancel_order")` phải chứa
`_wf2_assert_order_unlocked(p_order_id, o.order_date, false)`.

P1 DROP hai RPC đó là **hơn chục chốt đỏ cùng lúc**, và chúng đỏ vì mã
đã cố tình biến mất chứ không phải vì có lỗi. Pack mục 5 chỉ nhắc "viết
lại `workflow-v2-transitions`", không nhắc tệp này.

**Thi hành:** ở P1, sửa các chốt liên quan trong cùng commit với
migration — chốt nào nói về `edit_completed_order` thì ĐẢO CHIỀU thành
"RPC này phải biến mất" (như đã làm với `OVERPAID_AFTER_CREDIT` ở Q11),
chốt nào nói về `cancel_order` thì sửa theo bản thu hẹp ở 2.5. Không xoá
chốt cho im — xoá chốt là mất luôn trí nhớ vì sao mã đó từng tồn tại.

---

## ⚠ V0 — VIỆC PHẢI LÀM TRƯỚC KHI V2B CHẠY ĐƯỢC

**Pack v2b mở đầu bằng "workflow v2 ĐÃ triển khai xong". Đúng với KHO MÃ,
sai với CƠ SỞ DỮ LIỆU.**

Migration **118, 119, 120, 121, 122, 123 chưa chạy ở bất cứ đâu** — kể cả
staging (xem `docs/workflow-v2-progress.md`, mục TODO chủ nhà). Nghĩa là
trên cơ sở dữ liệu thật hôm nay:

- `sales_orders.status` vẫn là sáu giá trị cũ (`confirmed`, `picking`,
  `delivering`, `delivered`…), chưa có `submitted`/`completed` của v2;
- các RPC `complete_order`, `_wf2_*` **chưa tồn tại**;
- `stock_line_consumptions` **chưa có bảng**.

Backfill của v2b (mục 4, D11) đọc `sales_orders WHERE status = 'completed'`
— trên cơ sở dữ liệu chưa chạy 119 thì **không có dòng nào khớp**, và
backfill chạy êm ru tạo ra 0 hóa đơn. Đó đúng là kiểu hỏng im lặng cả hai
pack đang chống.

**Thứ tự bắt buộc:** 118 → 119 → 120 → 121 → 122 → 123 → *(v2b: 124, 125)*,
và phải chạy hết `docs/workflow-v2-checklist.md` trên staging TRƯỚC khi
đụng v2b trên cùng cơ sở dữ liệu đó.

Tôi sẽ thêm một chốt ở đầu migration v2b: `RAISE EXCEPTION` nếu
`sales_orders` còn dòng mang trạng thái của luồng cũ, thay vì để backfill
chạy rỗng.

---

## Q. Câu hỏi (mục 9 của pack cho phép hỏi ở P0)

### Q1 — Bảng MISA "đã phát hành": KHÔNG CẦN HỎI, đã đọc ra
`cancel_invoice` (2.3) cần điều kiện khoá HĐĐT. v2 đã có sẵn, dùng lại y
nguyên (mig 120:458-465):
```sql
i.status = 'issued' OR i.misa_inv_no IS NOT NULL
  OR i.misa_status IN ('signed', 'replaced')
```

### Q2 — SO `completed` có nhiều hơn một phiếu xuất posted
Mục 9 dặn *"chỉ hỏi nếu gặp thật khi backfill trên staging"*. **Chưa gặp
được** vì 119/120 chưa chạy (xem V0). Thi hành mặc định của pack: gộp
thành 1 INV theo dòng SO hiện tại, `stock_entry_id` = phiếu ĐẦU TIÊN,
liệt kê các phiếu còn lại vào `notes`, kèm `RAISE NOTICE`. Gặp thật trên
staging sẽ báo lại.

### Q3 — MỞ, cần chủ nhà quyết: PATCH 1 xoá mất trần giá của NVBH?
PATCH 1 nói *"Giá/CK tự do (NPP không bị trần giá; cảnh báo vàng nếu
lệch `sell_price` > % cấu hình, không chặn)"*.

Nhưng `priceViolation()` (`src/lib/sell/cart.ts:141`) hiện là **chốt
chặn cứng**, và chú thích của nó viết: *"SÀN là giá bảng. NVBH không được
bán thấp hơn bảng giá — đó là chốt chặn duy nhất giữa một cú gõ nhầm và
việc cho không hàng."*

Hai cách hiểu, hậu quả khác hẳn nhau:
- **(a)** Trần/sàn giá chỉ nới cho NPP ở màn **Xuất hàng** (dialog INV);
  NVBH tạo đơn ở `/sell` vẫn bị chặn như cũ. *Tôi nghiêng về cách này* —
  PATCH 1 nói "NPP quyền cao nhất", không nói bỏ chốt của NVBH.
- **(b)** Bỏ `priceViolation` ở mọi nơi.

Chọn (b) là gỡ chốt chặn duy nhất giữa một cú gõ nhầm của NVBH và việc
bán dưới giá vốn. Tôi **không tự quyết**; mặc định thi hành (a) nếu chủ
nhà không nói gì, và ghi lại ở đây.

### Q4 — MỞ: `reissue_invoice` khi đơn trả đang `submitted` link INV cũ
PATCH 1 mục 2.8 nói đơn trả `submitted` chuyển `invoice_id` sang INV mới,
"không hủy". Nhưng INV mới có thể **không còn dòng hàng đó** (NPP sửa bỏ
dòng đi). Khi đó phiếu trả trỏ vào một hoá đơn không hề bán món nó đang
trả, và `trg_return_lines_cap` (1.8) sẽ chặn lúc hoàn thành — người dùng
gặp lỗi ở một chỗ không liên quan gì tới việc họ vừa làm.

Đề xuất: khi chuyển `invoice_id`, kiểm từng dòng phiếu trả có mặt trong
INV mới không; thiếu thì **RAISE** ngay lúc sửa hoá đơn, nêu rõ tên hàng
và bảo huỷ phiếu trả trước. Chặn sớm ở chỗ người dùng đang đứng, thay vì
để họ vấp về sau. Cần chủ nhà xác nhận.
