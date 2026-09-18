# Workflow v2 — Open Questions / Assumptions Log

Ghi lại mọi chỗ spec (Coder Pack 18/09/2026) lệch với code thật, kèm đề
xuất mapping và trạng thái trả lời. Quy tắc: gặp mâu thuẫn thì DỪNG, ghi
vào đây, hỏi chủ nhà, không tự quyết.

Trạng thái: `MỞ` chờ chủ nhà · `CHỐT` đã có câu trả lời · `TỰ GIẢI` đọc
code xong thì rõ, không cần hỏi.

---

## Q0: [P0] Nhánh phát triển

**Spec:** branch `feat/workflow-v2`.

**Quy tắc phiên làm việc trước đó:** phát triển trên nhánh do hệ thống
chỉ định và "chỉ push lên main".

**Xử lý:** Coder Pack là chỉ thị trực tiếp và mới hơn của chủ nhà, nên
theo spec — làm trên `feat/workflow-v2`, không merge.

**Trạng thái:** CHỐT.

---

## Q1: [P1, mục 1] Đơn giao xong qua tài xế đang nằm ở `confirmed`

**Spec nói:** `confirmed` → `submitted` (Phiếu tạm), không có ngoại lệ.

**Code thật:** nhánh giao hàng qua tài xế KHÔNG bao giờ ghi ngược
`sales_orders.status`. `/deliveries/new` chỉ lấy đơn `confirmed`
(`src/app/(dashboard)/deliveries/new/page.tsx:44-48`); ba chỗ còn lại
chạm `sales_orders` trong `deliveries/**` đều là `select`
(`deliveries/[id]/page.tsx:204`, `deliveries/[id]/handover/page.tsx:615`).
Chỉ RPC `confirm_driver_handover` ghi, và chỉ cho đơn giao THẤT BẠI
(`supabase/schema_full.sql:13989-13994`). Màn quyết toán chuyến vẫn tạo
công nợ và ghi nhận tiền thu (`deliveries/[id]/settle/page.tsx:308-312`).

**Hệ quả nếu backfill theo đúng bảng mục 1:** đơn đã giao xong, khách đã
trả tiền, sẽ quay về "Phiếu tạm". Hai chuyện đi kèm:

1. Doanh thu kỳ cũ TỤT. Hàm `is_revenue_status` hiện tính cả `confirmed`;
   mục 2.8 đổi thành chỉ `completed`. Những đơn này rơi khỏi doanh thu,
   kéo theo lương và hoa hồng các kỳ đã chốt.
2. NPP nhìn thấy chúng ở tab Phiếu tạm và có thể bấm "Xuất hàng" lần
   nữa. Tồn kho thì đúng (nhánh tài xế chưa từng trừ kho), nhưng
   `completed_at` sẽ là hôm nay chứ không phải ngày giao thật, và phiếu
   giao in lại lần hai.

**Đề xuất lúc đó (ĐÃ BÁC):** tách `confirmed` làm hai nhánh khi backfill,
đơn đã giao đã thu thì cho thẳng sang `completed`.

**CHỦ NHÀ TRẢ LỜI 18/09/2026:** "Bảng map trong mục 1 cho confirmed
thành submitted không có ngoại lệ."

**Chốt thi hành ở P1:** backfill đúng bảng mục 1, một luật duy nhất,
`confirmed` → `submitted` cho mọi đơn, không nhìn chuyến giao, không
nhìn công nợ đã thu. Không viết nhánh ngoại lệ nào.

**Hai hệ quả trên được chấp nhận, ghi lại để không ai ngạc nhiên về sau:**

1. Đơn đã giao qua tài xế và đã thu tiền sẽ nằm ở tab Phiếu tạm. NPP
   phải tự bấm "Xuất hàng" cho từng đơn nếu muốn đưa chúng về Hoàn
   thành, và khi đó `completed_at` là ngày bấm chứ không phải ngày giao
   thật.
2. Doanh thu, lương và hoa hồng các kỳ đã chốt sẽ tính lại thấp hơn với
   phần đơn này, cho tới khi chúng được xuất hàng.

**Diagnostics: ĐÃ BỎ.** Tôi định thêm một `RAISE NOTICE` liệt kê những
đơn `submitted` đã có chuyến giao hoàn tất hoặc đã thu tiền. Chủ nhà trả
lời 18/09/2026: "Bỏ, ko cần làm." P1 không in danh sách này.

**Lưu ý cho người làm P1:** việc bỏ trên CHỈ áp cho dòng thông báo vừa
nói. Hai thứ spec yêu cầu vẫn phải có trong migration 119: `RAISE NOTICE`
đếm số dòng backfill (quy tắc 5 của Coder Pack) và `RAISE NOTICE` liệt kê
đơn `completed` mà không có phiếu xuất posted (mục 1, đoạn cuối).

**Trạng thái:** CHỐT.

---

## Q2: [P1] Đổi `is_revenue_status` ở P1 làm đỏ test, mà test chỉ được
sửa ở P3

**Xung đột trong chính Coder Pack:** mục 2.8 nằm ở P1 (đổi
`is_revenue_status` thành chỉ `completed`), nhưng mục 5 xếp việc sửa test
cũ vào P3. Quy tắc 8 lại bắt `npm test` xanh TRƯỚC MỖI commit.

**Cái sẽ đỏ ngay khi 119 chạy** (đã đọc, không phải suy đoán):

- `tests/payroll-sql.test.ts:50` chốt "is_revenue_status loại đúng
  'draft' và 'cancelled' — không loại gì khác".
- `tests/payroll-sql.test.ts:57` chốt "picking và delivering KHÔNG bị
  loại".
- `tests/payroll-net-revenue.test.ts:390` so hằng số TypeScript
  `NON_REVENUE_ORDER_STATUSES` với danh sách `NOT IN (…)` đọc từ SQL.
  Định nghĩa mới không còn `NOT IN` nên phép so này vỡ.

**Giả định thi hành (không hỏi, ghi lại để chủ nhà bác nếu sai):** P1 sẽ
sửa đúng ba chốt trên cộng với hằng số `NON_REVENUE_ORDER_STATUSES` trong
`src/lib/constants.ts` thành `['draft','submitted','cancelled']` — đúng
giá trị mục 5 đã ghi sẵn. Không đụng thêm bất kỳ file TypeScript nào
khác; phần cascade TS còn lại vẫn để nguyên cho P3.

**Lý do chọn cách này:** thà để P1 lấn một hằng số và ba dòng test, còn
hơn commit một migration với bộ test đỏ rồi không ai biết P3 làm đỏ thêm
cái gì.

**Trạng thái:** ĐÃ QUYẾT ở mức thi hành, chủ nhà bác thì tôi lùi lại.

---

## Q3: [P2 sẽ hỏng] Trigger nhập kho tự động của đơn trả vẫn còn sống

**Code thật:** `trg_auto_restock_return` trên bảng `returns`
(`supabase/schema_full.sql:1700-1704`, hàm `auto_restock_on_return()` ở
`:1664-1697`, từ mig 008). Nó chạy AFTER UPDATE OF status và khi
`NEW.status = 'completed'` thì TỰ tạo một phiếu nhập `RTN-…` cộng kho.

**Spec:** mục 2.3 không nhắc tới trigger này. Mục 3.4 lại bảo RPC
`complete_return` tự nhập kho (port `processApprovedReturn` sang SQL).

**Mâu thuẫn:** ngay khi P2 có `complete_return`, một lần hoàn thành phiếu
trả sẽ nhập kho HAI LẦN — một lần do RPC, một lần do trigger. Tồn kho
tăng gấp đôi số hàng trả, không có gì báo.

**Chưa tự quyết.** Hai đường ra, chủ nhà chọn:

1. Bỏ trigger trong migration 119 (một dòng `DROP TRIGGER`), để RPC là
   nơi duy nhất nhập kho hàng trả. Đây là hướng tôi nghiêng về.
2. Giữ trigger, viết `complete_return` không nhập kho mà chỉ đổi trạng
   thái. Rủi ro: trigger không chọn được kho nhận (`sale` hay `date`),
   nên mất tính năng mục 3.4 đã chốt.

P1 KHÔNG đụng tới nó. Việc này phải xong trước khi viết P2.

**Trạng thái:** MỞ.

---

## Q4: [P1, mục 2.10] Spec gọi tên những policy đã bị xoá từ lâu

**Spec bảo DROP:** "Admin roles can view all orders", "Sales see own
orders", "Sales can update own draft orders". **Spec bảo GIỮ:** "Driver
sees delivery orders".

**Code thật:** cả bốn cái đã bị migration 042 và 115 gộp lại từ trước.
Quyền đọc đơn hiện nằm trong một policy duy nhất tên `sales_order_select`
(`supabase/schema_full.sql:4386`), và nhánh cho vai trò tài xế là một vế
OR bên trong chính policy đó.

**Đã làm ở P1 (làm theo Ý ĐỊNH, không theo tên):** viết lại
`sales_order_select` giữ nguyên logic phân quyền theo hàng của mig 042,
thêm điều kiện nháp chỉ chủ đơn thấy đúng như hai gạch đầu dòng của mục
2.10, và GIỮ NGUYÊN vế OR của tài xế. Nếu xoá vế đó theo nghĩa đen của
spec thì tài xế mất quyền đọc đơn, trong khi D12 nói module giao hàng chỉ
ẩn khỏi menu chứ chưa bỏ.

**Trạng thái:** ĐÃ LÀM, báo để chủ nhà biết chỗ lệch chữ.

---

## Điểm cần xác minh khi vào phase sau

Chưa phải câu hỏi. Đây là những chỗ Coder Pack yêu cầu ĐỌC CODE trước
khi quyết, ghi ra để không quên:

- **P2 / mục 3.2** — cột nào của bảng hoá đơn MISA nghĩa là "đã phát
  hành" để khoá sửa đơn hoàn thành. Phải đọc `lib/misa/status.ts` và
  các migration MISA trước; vẫn không rõ thì mới hỏi.
- **P2 / mục 3.6** — khoá quyền đang gác `/finance/cash-receipts`. Phải
  tìm trong `lib/permissions-features.ts` và `lib/nav/nav-permission.ts`;
  không tìm thấy thì hỏi, không tự tạo khoá mới.
- **P2 / mục 3.0** — `paymentTermsToDays` hiện là hàm TypeScript, cần
  port sang SQL cho đúng số ngày COD / NET15 / NET30 / NET45. Đọc bản TS
  để khớp, không đoán.
- **P1 / mục 2.11** — grep toàn bộ `supabase/migrations/*.sql` cho các
  literal trạng thái cũ để không sót function nào; kiểm luôn xem
  `supabase/schema_full.sql` có phải bản gộp cần cập nhật theo
  `supabase/INSTALL.md` không.

---

## Những gì đã biết trước khi bắt đầu

Rút từ lượt lập bản đồ luồng đơn hàng hiện tại (đọc mã, chưa chạy thử
trên CSDL thật). Đây là bối cảnh cho phase sau, không phải câu hỏi:

- `check_order_status_transition` hiện cấm đi ngược từ `confirmed` về
  `draft`, trong khi hai đường "sửa đơn đã duyệt cần duyệt lại" đều đặt
  về `draft`. Mục 2.9 viết lại trigger này nên nhánh đó biến mất, nhưng
  P3 phải xoá luôn `lib/orders/reapproval.ts` để không còn mã chết.
- Huỷ phiếu xuất chỉ đánh dấu phiếu `cancelled`, không trả đơn về bước
  trước; trigger lại cấm `picking → confirmed`. Sau khi đổi sang 4 trạng
  thái thì `picking` không còn, nhưng backfill mục 1 phải phủ đúng các
  đơn đang kẹt ở `picking`.
- Nhánh giao hàng qua tài xế hiện không ghi ngược trạng thái đơn, trừ
  đơn thất bại qua RPC bàn giao. Module này bị ẩn ở P7 nên không sửa,
  nhưng backfill vẫn phải xử đúng các đơn `confirmed` đã giao xong.
- Công nợ hiện được tạo ở bước `delivering`, còn sổ công nợ và chỉ số
  khách hàng chỉ đọc đơn `delivered`. Sau v2, công nợ sinh tại
  `complete_order` nên hai đầu khớp nhau.
- Có hai định nghĩa doanh thu đang chạy song song: phía SQL tính mọi đơn
  trừ nháp và huỷ, phía TypeScript chỉ tính đơn đã giao. Mục 2.8 và mục
  5 gộp về một mối là `completed`.
