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
- [ ] **P1** `feat(wf2b-P1)` — Mig 124: schema + trigger + RLS + backfill
      + DROP RPC cũ.
- [ ] **P2** `feat(wf2b-P2)` — Mig 125: 6 RPC + grants.
- [ ] **P3** `feat(wf2b-P3)` — Types/constants/permission + cascade
      SQL/TS + test cũ xanh.
- [ ] **P4** `feat(wf2b-P4)` — `/orders` SO UI + dialog Xuất hàng.
- [ ] **P5** `feat(wf2b-P5)` — `/sales-invoices` + in + HĐĐT đổi nguồn.
- [ ] **P6** `feat(wf2b-P6)` — Đơn trả / Phiếu thu đổi link, NVBH label,
      docs, checklist, test mới.

Số migration: v2b dùng **124** (schema) và **125** (RPC). Migration mới
nhất đang có là 123.

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
- [ ] Trả lời Q3 (trần giá của NVBH) và Q4 (đơn trả khi sửa hóa đơn).
- [ ] Các việc còn treo của v2: xem `docs/workflow-v2-progress.md`.
