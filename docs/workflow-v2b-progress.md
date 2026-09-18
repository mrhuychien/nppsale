# Workflow v2b — Sổ tiến độ

Tách **Đơn đặt hàng (SO)** khỏi **Hóa đơn bán (INV)**. Pack v2b ngày
18/09/2026, kèm PATCH 1 (NPP sửa hóa đơn thoải mái, kỹ thuật = huỷ + lập
lại trong một RPC).

Nhánh: `feat/workflow-v2` (tiếp tục nhánh của v2, chưa merge).

Bảng map tên spec → code thật, và các câu hỏi: xem
`docs/workflow-v2b-questions.md`.

---

## Trạng thái các phase

- [x] **P0** — Đọc code v2 thật, lập sổ tiến độ + sổ câu hỏi kèm bảng
      map tên.
- [x] **P1** `feat(wf2b-P1)` — Mig 124: schema + trigger + RLS + backfill
      + DROP RPC cũ.
- [x] **P2** `feat(wf2b-P2)` — Mig 125: 6 RPC + grants.
- [x] **P3** `feat(wf2b-P3)` — Types/constants/permission + cascade
      SQL/TS + test cũ xanh.
- [x] **P4** `feat(wf2b-P4)` — `/orders` SO UI + dialog Xuất hàng.
- [ ] **P5** `feat(wf2b-P5)` — `/sales-invoices` + in + HĐĐT đổi nguồn.
- [ ] **P6** `feat(wf2b-P6)` — Đơn trả / Phiếu thu đổi link, NVBH label,
      docs, checklist, test mới.

Số migration: v2b dùng **124** (cấu trúc), **125** (RPC) và **126**
(số liệu — doanh thu chuyển gốc sang hóa đơn). Cả ba đi cùng một lượt.

---

## P0 — Đọc code thật

**Đã làm.** Đối chiếu từng tên pack nhắc tới với mã nguồn: 11 RPC, 13
bảng/cột, 8 tệp TypeScript. Kết quả trong sổ câu hỏi: phần lớn KHỚP, sáu
chỗ LỆCH (M1–M6), một việc chặn trước (V0), bốn câu hỏi (Q1–Q4, trong đó
Q1–Q2 tự trả lời được).

**Bất ngờ gặp — ba chỗ đáng kể.**

⚠ **V0 — v2 chưa chạy ở CƠ SỞ DỮ LIỆU nào.** Pack mở đầu bằng "workflow
v2 ĐÃ triển khai xong": đúng với kho mã, sai với cơ sở dữ liệu.
Migration 118–123 chưa chạy ở đâu, kể cả staging. Backfill của v2b đọc
`sales_orders WHERE status = 'completed'` — trên cơ sở dữ liệu chưa chạy
119 thì **không dòng nào khớp**, backfill chạy êm và tạo ra 0 hóa đơn.
Đúng kiểu hỏng im lặng cả hai pack đang chống. P1 sẽ mở đầu bằng một
`RAISE EXCEPTION` nếu còn trạng thái luồng cũ, thay vì để nó chạy rỗng.

⚠ **M5 — giao diện "sửa đơn đã Hoàn thành" chưa từng được nối.** Đo
thật: không mã client nào gọi `edit_completed_order` hay `cancel_order`;
chỉ `complete_order` có đường gọi. Nghĩa là phần lớn việc "gỡ edit-mode
cho completed" ở mục 3.2 **không có gì để gỡ** — P4 nhẹ hơn pack dự
tính. Mặt khác: hai RPC đó chưa bao giờ chạy từ ứng dụng, nên chúng cũng
chưa từng được thử trên dữ liệu thật.

⚠ **M1 — dòng đơn hàng KHÔNG lưu thuế suất.** `sales_invoice_lines.vat_rate`
(pack 1.2) không có nguồn snapshot: `sales_order_lines` không có cột
`vat_rate`, VAT đọc từ `products.vat_rate` lúc tính.
(`return_lines` thì CÓ, từ mig 069 — dễ tưởng là đơn hàng cũng có.)
Thi hành: `post_invoice` đọc `products.vat_rate` lúc ghi sổ và snapshot
vào dòng INV. Hệ quả cần biết: đổi thuế suất sản phẩm rồi xuất đợt hai
của cùng một SO thì hai INV có thuế suất khác nhau — đúng về kế toán,
nhưng dễ bị tưởng là lỗi.

**Ba chỗ lệch nhỏ hơn:** công thức tổng tiền nằm ở `lib/sell/cart.ts`
(`cartTotals`) chứ không phải `lib/sell/pricing` như pack ghi (M2);
`paymentTermsToDays` là hàm private trong `lib/returns.ts`, phải export
trước khi port sang SQL (M3); `lib/orders/completed-delta.ts` mà mục 5
bảo xoá **không tồn tại** — phép tính delta nằm trong SQL (C).

**Cần chủ nhà quyết — hai câu, cả hai đều đổi nghiệp vụ.**

- **Q3.** PATCH 1 nói "giá/CK tự do, NPP không bị trần giá". Nhưng
  `priceViolation()` hiện là chốt chặn cứng, và chú thích của nó nói
  thẳng đó là "chốt chặn duy nhất giữa một cú gõ nhầm và việc cho không
  hàng". Nới cho NPP ở màn Xuất hàng thôi **(a)**, hay bỏ ở mọi nơi kể
  cả NVBH tạo đơn **(b)**? Tôi nghiêng về (a) và sẽ thi hành (a) nếu
  không có chỉ đạo khác.
- **Q4.** `reissue_invoice`: PATCH 1 nói đơn trả `submitted` chuyển sang
  INV mới "không huỷ". Nhưng INV mới có thể không còn dòng hàng đó (NPP
  sửa bỏ dòng). Khi đó phiếu trả trỏ vào một hoá đơn không bán món nó
  đang trả, và người dùng vấp lỗi ở màn Đơn trả — một chỗ không liên
  quan gì tới việc họ vừa làm. Đề xuất: chặn ngay lúc sửa hoá đơn, nêu
  tên hàng.

---

## P1 — Mig 124: khung xương của hóa đơn

**Đã làm.** `supabase/migrations/124_wf2b_sales_invoices.sql`: hai bảng
mới (`sales_invoices`, `sales_invoice_lines`), cột `invoiced_qty` trên
dòng đơn, sáu trạng thái đơn, bốn cột `invoice_id` nối sang công nợ /
phiếu thu / đơn trả / HĐĐT, RLS chỉ-đọc cho hai bảng mới, backfill một
INV cho mỗi đơn đã hoàn thành, và gỡ bốn RPC của luồng cũ
(`complete_order`, `edit_completed_order`, `cancel_order`,
`_wf2_assert_order_unlocked`). Chốt: `tests/wf2b-schema.test.ts`, 38
chốt, thử phá bắt 33/33.

**Bất ngờ gặp — bốn chỗ.**

⚠ **Phải thêm chốt chặn `WF2B_NEEDS_V2` ngay đầu migration.** Hệ quả
trực tiếp của V0: backfill đọc `status = 'completed'`, mà cơ sở dữ liệu
chưa chạy 119 thì không có dòng nào ở trạng thái đó. Migration sẽ chạy
êm và tạo 0 hóa đơn — đúng kiểu hỏng im lặng. Nay nó `RAISE` nếu còn
trạng thái luồng cũ hoặc thiếu `stock_line_consumptions`.

⚠ **`invoiced_qty` cần HAI trigger, không phải một.** Huỷ hóa đơn không
xoá dòng nào — `sales_invoice_lines` vẫn nguyên, chỉ `status` của
`sales_invoices` đổi. Trigger trên dòng không bao giờ nổ, số đã-xuất
đứng im, và đơn hàng vĩnh viễn tưởng mình đã xuất đủ. Thêm
`sync_invoiced_qty_on_status()` trên `AFTER UPDATE OF status`. Cả hai
đều **tính lại** chứ không cộng dồn, nên chạy thừa cũng không sai.

⚠ **Trần số lượng đơn trả chuyển gốc từ SO sang INV.** Trước đây
`enforce_return_line_cap()` đếm `sales_order_lines`; từ nay khách chỉ
trả được thứ đã thực xuất, nên nó đếm `sales_invoice_lines` của
`returns.invoice_id`. Đơn trả cũ chưa có `invoice_id` vẫn đi nhánh cũ.

⚠ **Ba chốt nói dối, thử phá mới lòi ra.** (1) `WF2B_NEEDS_V2` xuất hiện
3 lần trong tệp nên chốt `toContain` xanh cả khi đã xoá lệnh `RAISE` —
phải neo vào nguyên văn. (2) `sales_user_id = auth.uid()` là chuỗi con
của `so.sales_user_id = auth.uid()`, nên nới policy vẫn xanh — neo bằng
xuống dòng + thụt lề, thêm chốt ngược `not.toMatch(/\bOR true\b/)`.
(3) Chốt "có `COMMENT ON COLUMN` giải thích" đọc tệp thô nên chú thích
hoá lệnh đó vẫn xanh — đổi sang đọc bản đã lược chú thích.

**Việc nhỏ kèm theo.** `tests/workflow-v2-rpcs.test.ts` được dán nhãn
đầu tệp: nó mô tả mig 120 — một thời điểm đã qua — nên chốt xanh ở đó
KHÔNG có nghĩa hàm còn sống. Khẳng định "bốn hàm đã bị gỡ" nằm ở
`tests/wf2b-schema.test.ts`.

**Q3/Q4 đã có chỉ đạo:** Q3 = (a) — chỉ nới trần giá ở màn Xuất hàng của
NPP, NVBH giữ nguyên `priceViolation()`. Q4 = chặn ngay lúc sửa hóa đơn,
nêu tên hàng.

---

## P2 — Mig 125: bảy RPC của hóa đơn

**Đã làm.** `supabase/migrations/125_wf2b_invoice_rpcs.sql`:
`get_invoiceable_lines` · `post_invoice` · `cancel_invoice` ·
`reissue_invoice` · `close_order` · `cancel_order` (viết lại) ·
`_wf2b_recompute_receivable`, cùng bốn helper nội bộ bị REVOKE khỏi
PUBLIC. Chốt: `tests/wf2b-rpcs.test.ts`, 102 chốt, thử phá bắt 72/72.

**Bất ngờ gặp — bốn chỗ.**

⚠ **HAI QUY ƯỚC `line_discount` ĐANG ĐÁ NHAU TRONG KHO MÃ.** Nơi GHI
(`src/lib/sell/create-order.ts:52-53`) đặt `unit_price` = giá đang áp,
`line_discount` = qty × (giá bảng − giá đang áp) chỉ để ghi nhớ, và
`line_total = round(qty × giá)`. Nơi ĐỌC
(`src/app/(dashboard)/orders/[id]/page.tsx:620,700`) tính
`max(0, qty × unit_price − line_discount)` — trừ chiết khấu thêm một lần
nữa. Dòng bán đúng giá bảng thì `line_discount = 0` và hai bên bằng
nhau, nên không ai phát hiện; dòng có giảm giá thì lệch đúng bằng phần
giảm. `post_invoice` theo bản GHI (và theo `cartTotals`). **Cần chủ nhà
quyết** trang đọc kia có phải sửa không — nó không thuộc phạm vi v2b.

⚠ **Phải dựng lại `_wf2_recompute_receivable` dưới dạng CẦU TẠM.** 124
gỡ nó, mà `complete_return` / `cancel_return` (mig 120) còn gọi. Dựng
lại nguyên bản cũ thì công nợ lại bám đơn — phá đúng thứ v2b vừa tách.
Bản mới nhận `order_id` rồi ủy quyền cho `_wf2b_recompute_receivable`
theo từng hóa đơn. P6 nối thẳng hai RPC đơn trả rồi mới gỡ cầu.

⚠ **Phiếu trả chưa gắn hóa đơn là một khoản giảm trừ không thuộc về ai.**
`_wf2b_recompute_receivable` cộng theo `invoice_id`, nên phiếu
`invoice_id` rỗng biến mất khỏi phép cộng: khách trả hàng mà nợ không
giảm, không dòng nào báo. Cầu tạm nhận nuôi khi đơn có ĐÚNG MỘT hóa đơn,
và `RAISE RETURN_NEEDS_INVOICE` khi có nhiều hơn — không đoán.

⚠ **Khoá tiền thu của `cancel_invoice` phải bắt cả phiếu thu cũ.**
`create_cash_receipt` còn ghi `order_id`, chưa ghi `invoice_id` (P6 mới
đổi). Chỉ so theo `invoice_id` thì hóa đơn đã thu tiền bằng phiếu cũ vẫn
huỷ được. Chặn rộng hơn: dòng phiếu thu chưa gắn hóa đơn mà trỏ đúng đơn
này thì coi như đã thu.

**Hai chốt nói dối, thử phá mới lòi ra.** (1) Chốt tồn kho hỏi "tệp có
chứa `warehouse_zone = 'sale'` không" — hàm có HAI truy vấn con đếm tồn,
gỡ điều kiện ở một cái vẫn xanh; đổi sang ĐẾM SỐ LẦN phải bằng 2. (2)
Hàm cắt thân hàm kèm chú thích cắt từ chữ `FUNCTION` trở xuống nên bỏ
mất đúng khối chú thích đang được kiểm — chốt đỏ oan, và cách "sửa" tự
nhiên nhất là nới lỏng nó.

**Việc nhỏ kèm theo.** `paymentTermsToDays` được export khỏi
`src/lib/returns.ts` (M3) để chốt so được với bản SQL
`_wf2b_payment_terms_days`.

---

## Chiết khấu bị trừ hai lần — đã sửa

Phát hiện khi làm P2, sửa ngay sau đó theo chỉ đạo "sửa".

`sales_order_lines.unit_price` là giá **đã giảm**; `line_discount` chỉ
**ghi nhớ** đã giảm bao nhiêu so với giá bảng. Ba chỗ trừ nó thêm lần
nữa:

1. `orders/[id]/page.tsx` — thành tiền hiển thị khi đang sửa dòng;
2. cùng tệp — và **ghi** con số ấy xuống `sales_order_lines.line_total`;
3. `api/einvoice/publish/route.ts` — nạp giá đã giảm vào mapper MISA,
   nơi hợp đồng đòi giá **bảng**.

⚠ **Chỗ thứ ba mới là chỗ đau.** Mapper tính
`AmountOC = qty × unit_price` làm thành tiền **gộp**, rồi trừ
`line_discount` ra để lấy doanh thu và gốc tính thuế — đúng, nếu
`unit_price` là giá bảng. Nhưng nơi gọi đưa vào giá đã giảm, nên hoá đơn
gửi cơ quan thuế **thấp hơn thực tế đúng bằng khoản giảm**: kê thiếu cả
doanh thu lẫn thuế. Sửa ở ranh giới (cộng ngược `line_discount/quantity`
vào đơn giá) chứ không sửa mapper — mapper đúng theo hợp đồng của chính
nó, và bộ chốt `misa-mapper.test.ts` ghim đúng hợp đồng đó.

⚠ **Vì sao nó sống lâu đến thế:** dòng bán đúng giá bảng có
`line_discount = 0`, và khi đó hai cách tính bằng nhau. Chỉ dòng có giảm
giá mới lệch. Mọi chốt trong `tests/line-discount-once.test.ts` vì thế
đều chạy với dòng **có** giảm giá.

Kèm theo: khi sửa dòng, `line_discount` nay được **tính lại** theo số
lượng và giá mới — nó là số tiền, không phải tỉ lệ, nên sửa 10 thùng
xuống 5 mà giữ nguyên khoản giảm là ghi nhớ một khoản chiết khấu chưa
từng cho. Giá bảng suy ngược từ chính dòng đang có
(`unit_price + line_discount / quantity`), **không** lấy
`products.sell_price` — giá bảng là giá theo đơn vị bán và theo nhóm giá
của khách, nên `sell_price` trần trụi sai với dòng bán theo thùng.

Chốt: `tests/line-discount-once.test.ts`, 17 chốt, thử phá bắt 16/16.

---

## P3 — Mig 126: doanh thu chuyển gốc sang hóa đơn

**Đã làm.** Tách một câu hỏi cũ thành hai. `is_revenue_status` nay trả
lời **"đơn này đã xuất hàng chưa"** (`partially_invoiced` ·
`completed` · `closed`) và chỉ dùng cho các phép **đếm đơn**; còn **số
tiền** cộng từ `sales_invoices`. Năm hàm đổi nguồn tiền
(`dashboard_summary`, `dashboard_channel_revenue`,
`dashboard_top_customers`, `finance_pnl`, và doanh số gộp của
`compute_payroll_run`), bảng kê trên phiếu lương đổi theo. Chốt:
`tests/wf2b-revenue.test.ts`, 50 chốt, thử phá bắt 26/26.

**Bất ngờ gặp — bốn chỗ.**

⚠ **Một chốt của P1 ghi lại suy luận SAI của chính tôi.** Nó bắt
`partially_invoiced` phải nằm ngoài doanh thu, lý do ghi là "phần đã
xuất đã được hóa đơn con tính rồi". Lý do đó không đúng ở thời điểm ấy:
P1 chưa có hàm nào cộng tiền từ hóa đơn, nên doanh thu của một đơn xuất
một phần không được tính **ở đâu cả** — hàng ra khỏi kho, công nợ đã
ghi, mà sổ doanh thu im lặng. Chốt xanh chỉ vì nó khớp với
`is_revenue_status` của v2, không vì nó đúng. Đã viết lại kèm lời giải
thích, để lần sau đọc còn biết vì sao nó từng ngược.

⚠ **Chỉ nới `is_revenue_status` thôi thì SAI TO HƠN.** Nếu để nguyên các
hàm cộng `sales_orders.total` mà nới bộ lọc, đơn mới giao một nửa được
tính doanh thu **toàn bộ**. Vì thế bộ chốt có một mục riêng: không hàm
nào được vừa lọc bằng `is_revenue_status` vừa cộng `sales_orders.total`,
và migration tự dò lại điều đó ở cuối bằng `pg_get_functiondef`.

⚠ **Sửa kèm một lỗi cũ của `finance_pnl`.** Giá vốn vốn lấy theo
`stock_entries.posted_at` (ngày hàng rời kho), còn doanh thu lấy theo
`order_date`. Lãi gộp một kỳ vì thế đang so doanh thu ngày **đặt** với
giá vốn ngày **giao**: đơn đặt cuối tháng 3 giao đầu tháng 4 làm tháng 3
lãi khống và tháng 4 lỗ khống. Nay cả hai cùng bám ngày giao.

⚠ **`compute_payroll_run` dài 400 dòng, chỉ một câu cần đổi.** Chép lại
cả hàm là dựng bản sao thứ hai mà không ai đối chiếu nổi. Thay vào đó
migration **vá đúng một câu** trong thân hàm đang chạy
(`pg_get_functiondef` + `replace`), và `RAISE` nếu câu ấy không còn đúng
hình dạng mig 096 — hỏng thì dừng, không im lặng bỏ qua. Bộ chốt đối
chiếu chuỗi cần vá với chính mig 096, nên 096 đổi là chốt đỏ **trước**
khi migration kịp chạy rỗng.

**⚠ Đổi ý nghĩa số liệu, chủ nhà cần biết.** Doanh thu nay tính theo
**ngày hóa đơn**, không theo ngày đặt. Đơn đặt cuối tháng 3 giao đầu
tháng 4 rời khỏi doanh thu tháng 3 sang tháng 4. Lương và hoa hồng của
các kỳ đã chốt sẽ tính lại khác đi.

---

## P4 — Màn Đơn hàng và dialog Xuất hàng

**Đã làm.** `src/lib/orders/post-invoice.ts` thay `complete-order.ts` (đã
gỡ — nó gọi một RPC mig 124 đã DROP). `InvoiceDialog` mới: sửa số lượng
và giá thoải mái, cảnh báo vàng chứ không chặn. `OrderStatus` mở rộng
sáu giá trị, màu và khoá sửa đi theo. Chốt:
`tests/wf2b-orders-ui.test.ts`, 52 chốt, thử phá bắt 43/43.

**Bất ngờ gặp — bốn chỗ.**

⚠ **`maybeSingle()` trên công nợ là một quả mìn của v2b.** Màn chi tiết
đơn đọc `receivables` bằng `.maybeSingle()`. Từ nay mỗi HÓA ĐƠN một dòng
nợ, nên đơn xuất hai đợt có hai dòng — và `maybeSingle()` trên hai dòng
là lỗi PGRST116, **cả trang trắng**, không phải một ô hiện sai. Nay đọc
hết, liệt kê từng dòng, và trạng thái gộp lấy theo chỗ xấu nhất: còn một
dòng chưa trả hết thì cả đơn chưa trả hết.

⚠ **Hai đường xuất hàng, có chủ ý.** Thanh chọn nhiều xuất **đủ phần còn
lại** không hỏi gì; nút trên từng dòng và trong ngăn chi tiết mở dialog.
Gộp làm một thì hoặc bắt mở mười dialog cho mười đơn, hoặc mất hẳn chỗ
sửa số lượng. Loạt nhiều đơn **hỏi lại RPC** xem còn gì chưa xuất thay vì
dựng dòng từ state của trang — trang có thể đang giữ bản chụp cũ vài
phút, và `post_invoice` cho phép xuất vượt số đặt nên xuất chồng lên
phần đã giao sẽ không có lệnh nào báo.

⚠ **`P3` sót kiểu `OrderStatus`.** Nó vẫn là union bốn trạng thái của v2,
nên `STATUS_FLOW` thiếu khoá và `orderTone` rơi về màu xám của `draft` —
đơn giao một phần trông y hệt đơn chưa ai đụng tới. Đã mở rộng cả ba
chỗ. `TERMINAL_STATUSES` cũng thiếu `partially_invoiced` và `closed`,
tức màn hình mở nút Sửa rồi trigger `guard_order_lines_locked` từ chối.

⚠ **Nút "Đóng đơn" là chỗ DUY NHẤT gọi `close_order`.** Không có nó thì
hàm ấy là mã chết và đơn giao thiếu kẹt ở "Xuất một phần" vĩnh viễn.

**Sáu chốt nói dối, thử phá mới lòi ra.** (1) `toContain("<InvoiceDialog")`
khớp cả `<InvoiceDialogX`. (2) Chốt chỉ canh nơi ĐỌC `newStatus`, không
canh nơi GHI — hardcode `"completed"` ở nơi ghi vẫn xanh. (3)
`order.status === "partially_invoiced"` có mặt ở hai điều kiện khác nhau
nên gỡ một cái vẫn xanh. (4) Chốt `not.toContain` một chuỗi nhiều dòng đã
không còn khớp, tức vô nghĩa — gắn `maybeSingle()` trở lại vẫn xanh. (5)
Chốt màu chỉ so với `draft`, nên cho `closed` màu xanh của `completed`
vẫn xanh. (6) Chốt nút-trên-dòng thiếu hẳn, chỉ có ở tệp chốt khác.

**Ghi nợ cho P6:** `whyLockedCompleted` / `canEditCompleted` trong
`lib/orders/edit-permission.ts` nay là mã chết — chúng soi theo
`_wf2_assert_order_unlocked` mà mig 124 đã DROP. Đã dán nhãn ngưng dùng
tại chỗ; P6 gỡ cả hàm lẫn chốt của nó.

---

## Quy ước (kế thừa nguyên từ pack v2)

- Mọi thao tác đụng tồn kho / công nợ / trạng thái đơn đi qua RPC
  `SECURITY DEFINER`, một transaction, idempotent. Không loop update từ
  trình duyệt.
- RLS từ chối = 0 dòng, HTTP 200, `error` null. Mọi update/delete từ
  client phải `.select("id")` rồi kiểm `rows.length === 0` → throw.
- RPC RAISE với `ERRCODE='P0001'`, message tiếng Việt mở đầu bằng mã.
- Migration idempotent, header giải thích VÌ SAO, kết thúc bằng
  `NOTIFY pgrst, 'reload schema'` và `RAISE NOTICE` đếm số dòng backfill.
- ⚠ **Migration đã chạy ở bất cứ đâu thì BẤT BIẾN** — sửa tại chỗ là bản
  vá vô hình (bài học Q15 của v2). 124/125 chưa chạy nên sửa tại chỗ
  được, cho tới khi chúng được push lên staging.
- Mỗi phase một commit `feat(wf2b-P<n>): …`, báo cáo 3 dòng, DỪNG chờ
  "tiếp".
- `npx tsc --noEmit` · `npm test` · `npm run build` xanh trước mỗi commit.
- Mỗi ⚠ có một chốt vitest, và mỗi chốt phải bị "thử phá" bắt được.

---

## TODO chủ nhà

- [ ] **Trước mọi thứ:** chạy 118 → 119 → 120 → 121 → 122 → 123 trên
      staging và chạy hết `docs/workflow-v2-checklist.md`. v2b backfill
      từ dữ liệu mà v2 chưa hề đụng tới (V0).
- [x] ~~Trả lời Q3 (trần giá của NVBH) và Q4 (đơn trả khi sửa hóa đơn).~~
      Đã trả lời: Q3 = (a), Q4 = OK.
- [x] ~~`line_discount` bị trừ hai lần.~~ Đã sửa (xem dưới). Đo lại số
      liệu đã gửi cơ quan thuế là việc của chủ nhà — xem mục kế tiếp.
- [ ] ⚠ **Hoá đơn điện tử đã phát hành trước bản sửa này bị kê THIẾU.**
      Mọi hoá đơn có dòng giảm giá đã gửi MISA với doanh thu và thuế
      thấp hơn thực tế đúng bằng khoản giảm. Cần rà lại và làm việc với
      kế toán về các hoá đơn đã ký. Câu truy vấn tìm đơn có dòng giảm
      giá đã phát hành:
      `SELECT DISTINCT i.misa_inv_no, o.order_code FROM invoices i JOIN sales_orders o ON o.id = i.order_id JOIN sales_order_lines l ON l.order_id = o.id WHERE COALESCE(l.line_discount,0) > 0 AND (i.misa_inv_no IS NOT NULL OR i.misa_status IN ('signed','replaced'));`
- [ ] Các việc còn treo của v2: xem `docs/workflow-v2-progress.md`.
