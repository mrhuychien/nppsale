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

**CHỦ NHÀ TRẢ LỜI 18/09/2026:** "Hoàn thành đơn trả mới nhập kho."

**Chốt thi hành ở P2:** gỡ hẳn `trg_auto_restock_return` và hàm
`auto_restock_on_return()` trong migration 120, ngay trước khi định nghĩa
`complete_return`. Từ đó RPC là nơi DUY NHẤT nhập kho hàng trả, và nó
nhập vào đúng kho người dùng chọn (`sale` hoặc `date`) — điều trigger cũ
không làm được vì không biết kho nào.

**Hệ quả cần biết:** phiếu trả cũ ở trạng thái `completed` đã được trigger
nhập kho từ trước, migration không đụng lại. Không có nguy cơ nhập lần
hai cho dữ liệu cũ vì chúng không bị UPDATE status nữa.

**Trạng thái:** CHỐT.

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

## Q5: [P2, mục 3] Khoá quyền gác phiếu thu không dùng được ở tầng CSDL

**Spec:** create_cash_receipt và void_cash_receipt dùng "key đang gate
/finance/cash-receipts".

**Code thật:** khoá đó là `finance.cash_receipts` (khai trong
`lib/nav/nav-permission.ts` và `lib/permissions-features.ts`). Nhưng
`user_has_permission` tách khoá tại dấu chấm cuối rồi tra bảng
`role_permissions`, mà bảng đó có ràng buộc CHECK giới hạn `module` trong
12 giá trị và `action` trong 6 giá trị — `finance` và `cash_receipts`
đều không nằm trong danh sách. Dùng khoá đó ở RPC thì mọi vai trò trừ
chủ sở hữu đều bị từ chối vĩnh viễn.

Chính trang đó lại gác bằng `useRoleGuard("receivables")`.

**Đã làm:** dùng `receivables.create` cho lập phiếu thu và
`receivables.update` cho huỷ phiếu thu — đúng module mà trang đang gác,
và là cặp có thật trong ma trận.

**Trạng thái:** ĐÃ LÀM, báo để chủ nhà bác nếu muốn khoá khác.

---

## Q6: [P2] Ma trận quyền chưa có dòng thì RPC từ chối tất cả

**Code thật:** `user_has_permission` trả FALSE khi `role_permissions`
chưa có dòng tương ứng. Bản mặc định chỉ nằm trong TypeScript
(`DEFAULT_PERMISSION_MAP`), phía CSDL không có. Toàn repo mới seed đúng
một ô ở migration 116.

**Hệ quả nếu không làm gì:** sau khi chạy 120, quản lý bấm Xuất hàng ra
"FORBIDDEN", kế toán không lập được phiếu thu — trong khi giao diện vẫn
hiện nút vì client đọc bảng mặc định của TypeScript. Chỉ chủ sở hữu dùng
được workflow v2.

**Đã làm:** migration 120 chèn đúng các ô mà bảy RPC cần, lấy y nguyên
theo `DEFAULT_PERMISSION_MAP`, kèm `ON CONFLICT DO NOTHING` để không đè
lên tổ chức đã tự cấu hình:

| Vai trò | Ô mở |
|---|---|
| Quản lý | orders.approve, orders.update, returns.approve |
| Kế toán | receivables.create, receivables.update |
| NVBH | orders.update, receivables.create |

Thủ kho KHÔNG được mở `orders.approve` vì bảng mặc định không cho. Nếu
nhà phân phối muốn thủ kho bấm Xuất hàng thì bật ô đó trong màn phân
quyền.

**Trạng thái:** ĐÃ LÀM, cần chủ nhà xác nhận bảng trên đúng ý.

---

## Q7: [P2, mục 3.5] Phiếu trả không có chỗ chứa lý do huỷ

**Spec:** `cancel_return(p_return_id, p_reason)`.

**Code thật:** bảng `returns` không có cột nào để lưu lý do, và mục 2.3
của spec cũng không thêm. Tham số sẽ rơi vào hư không: người dùng gõ lý
do, hệ thống báo thành công, mở lại không thấy gì.

**Đã làm:** migration 120 thêm `returns.cancel_reason text` và ghi
`p_reason` vào đó ở cả hai nhánh huỷ. Đây là hoàn thiện ý định của chính
spec chứ không phải thêm tính năng.

**Trạng thái:** ĐÃ LÀM.

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

## Q8 — MỞ, cần chủ nhà quyết: lỗ trong trần số lượng trả

**Phát hiện ở P6, khi đo trước lúc viết mã. Đây là lỗ trong chính
migration 119/120, không phải trong giao diện — nên tôi DỪNG, báo cáo,
không tự sửa.**

`enforce_return_line_cap` (migration 119, dòng 343-405) chặn không cho
trả quá số đã bán của đơn gốc. Nhưng phần "đã trả bao nhiêu rồi" của nó
chỉ đếm phiếu ở trạng thái `completed` (dòng 380-387). Và
`complete_return` (migration 120, dòng 827-963) KHÔNG kiểm lại trần đó
lần nữa.

Hệ quả, dựng lại được bằng ba bước:

1. Đơn bán 10 thùng, đã xuất hàng.
2. Lập phiếu trả A: 10 thùng. Lúc chèn dòng, trigger đếm "đã trả" = 0
   (chưa phiếu nào `completed`) → LỌT. Phiếu A nằm ở `submitted`.
3. Lập phiếu trả B: 10 thùng nữa. Trigger vẫn đếm "đã trả" = 0 vì A còn
   ở `submitted` → LỌT.
4. Hoàn thành cả A và B. `complete_return` không kiểm trần → nhập kho 20
   thùng cho một đơn chỉ bán 10, và công nợ bị trừ gấp đôi.

Ba cách xử, cần chủ nhà chọn:

- **(a)** Cho `enforce_return_line_cap` đếm cả phiếu `submitted` vào
  phần "đã trả". Chặt nhất, nhưng phiếu trả nháp/tạm cũng chiếm chỗ —
  lập nhầm một phiếu rồi bỏ đó là chặn mất phiếu thật.
- **(b)** Thêm một phép kiểm trần ngay đầu `complete_return`, đếm các
  phiếu đã `completed` của cùng đơn. Chặn đúng lúc hàng thật sự vào kho,
  không ảnh hưởng phiếu đang soạn. Tôi nghiêng về cách này.
- **(c)** Để nguyên, coi là việc của người duyệt.

**Chưa làm gì cả cho tới khi có câu trả lời.** Nếu chọn (a) hoặc (b) thì
phải sửa migration — mà 119/120 chưa chạy ở đâu nên sửa tại chỗ được;
nếu chúng đã chạy rồi thì phải thêm migration 121.

## Q9 — GHI NHẬN, việc để lại cho P7: hai màn luồng cũ còn ghi hỏng đơn trả

Ngoài `/returns/new` (đã sửa ở P6), còn HAI màn nữa tự lập phiếu trả vào
thẳng `completed`, tức không nhập kho và không giảm công nợ sau khi 120
gỡ trigger:

- `src/app/(dashboard)/deliveries/[id]/handover/page.tsx:678` — lập phiếu
  trả cho phần hàng khách nhận thiếu, và còn sửa công nợ bằng mã trình
  duyệt ở dòng 707.
- `src/app/(dashboard)/inventory/pending/page.tsx:373` — ghi thẳng
  `status: 'completed'`; nguồn dữ liệu của nó lọc `.eq("status",
  "approved")` ở dòng 107, mà giá trị đó đã chết sau 119 nên màn này coi
  như đã tê liệt sẵn.

Cả hai thuộc module luồng cũ mà P7 ẩn khỏi menu. Không sửa ở P6 theo
luật "không đụng luồng cũ", nhưng P7 phải chắc chắn chúng không còn
đường bấm tới.

---

## Q10 — MỞ: thiếu khoá dòng ở vòng kiểm khoản có của `create_cash_receipt`

Lượt đo P6 tìm ra. Trong `create_cash_receipt` (migration 120), vòng kiểm
KHOẢN NỢ dùng `IF NOT EXISTS (SELECT 1 FROM receivables … FOR UPDATE)`
(dòng 1136-1147) — cách viết trông lạ nhưng chạy đúng ở READ COMMITTED:
Postgres khoá dòng rồi đánh giá lại điều kiện, nên hai kế toán thu cùng
một khoản nợ thì một người nhận `BAD_RECEIVABLE_LINE`. **Đừng sửa đoạn
đó.**

Nhưng vòng kiểm KHOẢN CÓ ngay bên dưới (dòng 1150-1162) **không có
`FOR UPDATE`**. Hai kế toán cùng lập phiếu thu cấn trừ CÙNG một phiếu trả
độc lập, cùng lúc: cả hai đọc `applied_receipt_id IS NULL`, cả hai qua,
và khoản có bị cấn trừ hai lần. `UPDATE returns SET applied_receipt_id`
ở cuối chỉ ghi đè, không chặn.

Đề xuất: thêm `FOR UPDATE` vào đúng vòng đó. Một dòng. Nhưng là sửa
migration nên tôi dừng, chờ quyết.

## Q11 — MỞ: `OVERPAID_AFTER_CREDIT` có thể chặn vĩnh viễn

`_wf2_recompute_receivable` RAISE `OVERPAID_AFTER_CREDIT` khi khách đã
trả nhiều hơn số nợ SAU khi trừ khoản có, và nó **rollback cả**
`complete_return` — kể cả phần nhập kho, nên hàng khách trả không vào
tồn.

Thông điệp bảo "huỷ phiếu thu trước khi ghi có". Vấn đề: nếu tiền vào
qua màn thu tiền theo công nợ (`/receivables/collect`, `/receivables/[id]`)
thì **không có `cash_receipts` nào để huỷ**, và không màn nào xoá được
dòng `payments`. Khi đó phiếu trả không bao giờ hoàn thành được.

Tôi đã sửa CÂU CHỮ ở giao diện để không lặp lại một lời khuyên bế tắc,
nhưng đó chỉ là vá miệng. Cần chủ nhà quyết một trong hai:
- **(a)** cho phép ghi số dư có (`receivables.paid > amount` hợp lệ, phần
  dư thành khoản có của khách) — đổi nghiệp vụ, không nhỏ;
- **(b)** làm một đường đảo tiền cho các khoản thu không qua phiếu thu.

**→ Chủ nhà chốt: (a) cho phép ghi số dư có.** Đã làm:
- gỡ `OVERPAID_AFTER_CREDIT` khỏi `_wf2_recompute_receivable` (mig 120),
  thay bằng khối chú thích giải thích vì sao chỗ đó cố ý để trống;
- sửa `void_cash_receipt` xét `'paid'` **trước** `'partial'` — không thì
  một dòng đang dư bị đánh về `partial`;
- thêm `use_credit` vào `create_cash_receipt`, ghi **bút toán hai vế**
  (dòng `payments` âm ở khoản đang dư, dòng dương ở khoản được thu, cùng
  `kind='credit_applied'`) để `void_cash_receipt` đảo được bằng đúng vòng
  lặp sẵn có, không cần biết gì thêm;
- kẹp `GREATEST(0, …)` ở `receivables_by_rep` / `receivables_by_customer`
  và trần 100 cho tỉ lệ thu hồi (093);
- gom phép tính về một chỗ: `src/lib/receivables/credit.ts`;
- màn lập phiếu thu có thẻ "Số dư có của khách" + ô rút, đọc bằng một
  truy vấn RIÊNG không lọc trạng thái (dòng dư mang `status='paid'` nên
  mọi bộ lọc "còn mở" gạt nó đi).

⚠ Hệ quả chưa dọn hết — xem Q13.

## Q12 — MỞ: migration 118 còn nhắc trạng thái phiếu trả đã chết

Lượt đo P6 tìm ra. Migration 118 (dọn phiếu trả khi xoá đơn) ở dòng 44 và
54 vẫn lọc theo giá trị trạng thái cũ. Sau 119:
- phiếu `submitted` **hết chặn** việc xoá đơn (nhánh chặn hỏi giá trị
  không còn tồn tại);
- nhánh dọn khớp 0 dòng, nên khoá ngoại 23503 chặn xoá đơn kèm một câu
  tiếng Anh — **đúng thứ mig 118 sinh ra để sửa**.

118 cũng CHƯA chạy trên production (đã ghi trong sổ tiến độ từ trước).
Sửa tại chỗ được, nhưng `tests/order-delete.test.ts` dòng 139-140 ghim
nguyên văn hai chuỗi cũ nên phải sửa cùng lúc. Dừng, chờ quyết.

**→ Chủ nhà chốt: OK.** Đã sửa 118 tại chỗ (ba giá trị chết biến mất
khỏi cả mã lẫn chú thích) và cập nhật `tests/order-delete.test.ts`.

---

## Q13 — GHI NHẬN, hệ quả của Q11 chưa dọn hết

Ba chỗ còn nói ngược với "số dư có là hợp lệ". Không chặn P7, nhưng để
lâu là ba nguồn số lệch nhau:

1. **`cash_in` / `cash_from_customers` (093, dòng 428 và 490)** cộng
   `payments.amount` **không lọc `method`**. Từ P6, phiếu trả cấn trừ ghi
   dòng `method='return_credit'`, và từ Q11 thêm `method='credit_applied'`
   — cả hai đều KHÔNG phải tiền mặt vào két. Báo cáo dòng tiền vì thế
   khai cao. (Có sẵn từ P6, không phải Q11 sinh ra.)
   ⚠ `credit_applied` ghi **hai vế cộng lại bằng 0** nên nó tự triệt
   tiêu trong một tổng; `return_credit` thì không — đó mới là chỗ lệch
   thật.

2. **`src/lib/opening-balance/parse.ts:333-336`** vẫn cấm
   `amt.value < current.paid` khi nhập số dư đầu kỳ. Sau Q11 điều kiện đó
   không còn đúng: một dòng đang dư có `paid > amount` là hợp lệ, nên
   người dùng không nhập lại được chính con số hệ thống vừa sinh ra.

3. **Nhãn phương thức thanh toán thiếu hai giá trị mới.** `PaymentMethod`
   trong `src/types/index.ts:20` và bốn bảng `PAYMENT_METHOD_LABEL` ở các
   màn đều chưa có `'return_credit'` và `'credit_applied'`. Chỗ nào tra
   bảng rồi hiện thẳng sẽ in ra mã tiếng Anh, hoặc ô trống.

**→ Chủ nhà chốt: xử nốt.** Đã làm cả ba, và trên đường làm phát hiện
thêm một lỗi của chính tôi (Q15).

1. **Dòng tiền** → migration **121**. `finance_balance_sheet.cash_in` và
   `finance_cash_flow.cash_from_customers` nay lọc
   `COALESCE(method,'') NOT IN ('return_credit','credit_applied')`.
   ⚠ Lọc theo danh sách LOẠI TRỪ, không phải danh sách cho phép: viết
   `IN ('cash','transfer','ewallet')` thì người thêm `'momo'` tháng sau
   sẽ thấy doanh thu tiền mặt hụt đi mà không hiểu vì sao.
   `credit_applied` vốn tự triệt tiêu (hai vế cùng `collected_at`) nên
   hôm nay vô hại — lọc ra để con số không phụ thuộc vào một bất biến mà
   không ai nhớ. `return_credit` mới là chỗ sai thật: một vế dương,
   không đối ứng.

2. **Số dư đầu kỳ** → `amt.value < current.paid` không còn là LỖI, nó
   thành **CẢNH BÁO**: dòng ghi được, bảng xem trước nêu rõ số dư sẽ
   sinh ra, và thẻ tổng kết đếm riêng "N dòng sẽ tạo SỐ DƯ CÓ".
   ⚠ XOÁ một khoản đã thu một phần thì VẪN là lỗi — xoá dòng đi là mất
   dấu số tiền đã nhận, không còn chỗ nào ghi nó.
   Thêm trường `PlanRow.warning`, tách hẳn khỏi `message` của dòng lỗi:
   lỗi là "không ghi", cảnh báo là "ghi, và đây là thứ bạn sắp tạo ra".

3. **Nhãn phương thức** → gom bốn bản sao về một
   `PAYMENT_METHOD_LABEL` + `labelPaymentMethod()` trong
   `lib/constants.ts`, thêm hai giá trị mới, nới `PaymentMethod` trong
   `types/index.ts`.
   ⚠ **Bảng NHÃN rộng hơn danh sách CHỌN, và đó là cố ý.**
   `PAYMENT_METHODS` vẫn chỉ ba giá trị tiền thật: cho `return_credit`
   lên ô chọn là mời kế toán lập một phiếu thu cấn trừ RỖNG — không gắn
   phiếu trả nào, không có vế đối ứng, công nợ giảm mà không có gì đỡ
   lưng.
   `payables/[id]` giữ bảng riêng: `payable_payments.method` là enum
   khác (`offset` thay cho `ewallet`), không gộp được.

## Q14 — GHI NHẬN, phát sinh khi làm P7: hai chỗ luồng cũ để lại

1. **`/settings/approval-rules` vẫn còn sống.** Màn "Cấu hình ngưỡng để
   đơn hàng được duyệt tự động hoặc chuyển sang chờ duyệt" cấu hình đúng
   bước duyệt mà v2 đã bỏ. Coder Pack mục 6 dặn **không xoá mã luồng bị
   ẩn trong đợt này**, mà màn này không nằm trong danh sách mục 6 — nên
   tôi **không tự quyết**, chỉ ghi lại. Người dùng vào đó đặt ngưỡng sẽ
   thấy nó không ảnh hưởng gì tới đơn.

2. **Vai `driver` mất module chính.** `/deliveries` nay ẩn với mọi vai,
   nên tài xế đăng nhập không còn màn việc của mình; họ chỉ còn màn thu
   tiền. Tôi đã viết lại phần hướng dẫn của vai này ở `/help` cho đúng sự
   thật, nhưng **việc còn giữ vai `driver` hay không là quyết định nghiệp
   vụ**, không phải việc của thợ xây.

**→ Chủ nhà chốt: xử nốt.**

1. **`/settings/approval-rules` KHÔNG bị khoá — nó được viết lại cho
   đúng việc nó làm.** Đo kỹ trước khi quyết: màn này có hai nửa, và chỉ
   MỘT nửa chết.
   · `auto_approve_max` / `manager_approve_max` — ngưỡng duyệt, đã chết;
   · `customer_debt_max`, `customer_overdue_max`,
     `rep_portfolio_debt_max`, `enforce_credit_limit` — hạn mức công nợ,
     **vẫn còn nguyên giá trị**.
   Và `evaluateApproval` vẫn chạy: `decideStatus` (lib/sell/submit.ts)
   đưa mọi đơn về `submitted` bất kể nó nói gì, nhưng thứ nó trả về được
   ghi vào `approval_reason` — câu nhắc hiện trên màn đơn TRƯỚC khi bấm
   Xuất hàng. Khoá màn này là mất luôn cả cảnh báo hạn mức.
   Nên: giữ nguyên chức năng, đổi TÊN và CÂU CHỮ cho khỏi nói dối —
   "Duyệt đơn tự động" → "Ngưỡng cảnh báo đơn", và mọi câu
   "cần Manager duyệt" → "soát kỹ trước khi Xuất hàng". Người đi tìm một
   cái nút không tồn tại là người đọc câu cũ.
   ⚠ **Giữ nguyên TÊN CỘT.** Đổi tên cột là một migration đụng
   `lib/approval.ts`, `lib/sell/approval-context.ts` và dữ liệu đang có,
   đổi lấy đúng một thứ: tên đẹp hơn. Nhãn trên màn đã nói đúng việc; đó
   là chỗ người dùng đọc.

2. **Vai `driver` không vào ngõ cụt** — đã đo, không phải đoán. Tài xế
   còn thấy: `/home`, `/orders`, `/receivables`, `/receivables/collect`,
   `/receivables/by-customer`, `/finance/cash-receipts`, `/help`. Đủ để
   làm việc thu tiền. **Không đổi mã nào** — còn giữ vai `driver` hay
   không vẫn là quyết định nghiệp vụ.

**→ Chủ nhà chốt (lượt sau): BỎ vai tài xế.** Xem Q16.

## Q16 — CHỐT: bỏ vai Tài xế

Chủ nhà chọn phương án **khoá tài khoản, KHÔNG đổi vai của ai** (trong
bốn phương án đưa ra: chuyển sang `sales`, chuyển sang `warehouse`, khoá,
hoặc chỉ bỏ khỏi ô chọn).

**Vì sao phải hỏi thay vì tự quyết:** `hasPermission` tra `cache[role]`,
vai không có hàng thì trả **false ở mọi ô**. Bỏ `driver` khỏi mã mà tài
khoản thật vẫn mang vai đó là người ta đăng nhập vào một ứng dụng trống
trơn và bị đá về trang chủ, **không câu nào giải thích**. Chọn vai thay
thế nào là quyết định nghiệp vụ có hậu quả lên người thật.

**Đã làm (migration 122 + tầng ứng dụng):**
- khoá `is_active = false` cho tài khoản mang vai `driver`, in TÊN từng
  người ra trước khi đổi;
- **KHÔNG** đổi `role`, **KHÔNG** xoá dòng — `deliveries.driver_id` trỏ
  vào đó, xoá là mọi chuyến giao cũ mất tên người giao;
- **KHÔNG** siết `CHECK (role IN …)`: dòng cũ cố ý giữ `'driver'` nên
  ALTER TABLE sẽ ném lỗi ngay trên dữ liệu đang có. Chặn gán MỚI bằng
  trigger `trg_block_driver_role`, và trigger chỉ bắn khi giá trị THẬT SỰ
  đổi thành `'driver'` — dòng cũ vẫn phải sửa được, nhất là để đổi sang
  vai khác;
- `ROLES` bỏ `driver`, ma trận quyền bỏ hàng của nó, hai ô chọn vai bỏ
  nó. Nhưng **giữ nhãn** "Tài xế (ngưng dùng)" và giữ `driver` trong kiểu
  `Role`: màn Người dùng vẫn liệt kê tài khoản cũ, bỏ nhãn là ô Vai trò
  của họ trống trơn;
- `roleOptionsFor()` ghép vai hiện tại vào ô chọn khi nó đã ngưng dùng —
  **lối ra duy nhất** để chủ NPP đổi tài khoản cũ sang vai khác;
- bỏ `driver@demo.com` khỏi `003_seed.sql` (xem Q17), xoá
  `HUONG_DAN_DRIVER.md`, dọn vai này khỏi `/help` và 6 tệp tài liệu.

## Q17 — PHÁT HIỆN khi bỏ vai: "Khoá tài khoản" TRƯỚC NAY KHÔNG KHOÁ GÌ

Đây là lỗ **có sẵn**, không phải đợt này sinh ra — nhưng nó làm hỏng đúng
thứ chủ nhà vừa chọn, nên phải vá cùng lúc.

Cả kho chỉ có MỘT chỗ đọc `users.is_active` để chặn: đường đăng nhập bằng
mã QR (`src/app/qr-login/route.ts`). Đường email + mật khẩu đọc cờ đó vào
hồ sơ rồi không hỏi tới nó lần nào. Phía cơ sở dữ liệu cũng vậy:
`user_org_id()` và `user_role()` chỉ tra theo `auth.uid()`, không nhìn
`is_active`, nên **mọi policy RLS vẫn cho qua**.

⚠ Nghĩa là: nhân viên đã nghỉ việc, đã bị "Khoá tài khoản" ở màn Cài đặt
→ Người dùng, VẪN đăng nhập được bằng mật khẩu cũ và giữ nguyên quyền của
vai mình. Nút "Khoá" từ trước tới nay chỉ là một cái nhãn.

**Đã vá ở ba lớp:**
1. `user_org_id()` / `user_role()` trả NULL cho tài khoản bị khoá → mọi
   policy RLS không khớp dòng nào. Sửa hai hàm thay vì 167 policy.
2. Màn đăng nhập kiểm `is_active` NGAY sau khi xác thực, trước khi chuyển
   trang — câu giải thích nằm đúng chỗ người đang nhìn.
3. `AuthProvider` kiểm khi nạp hồ sơ, đăng xuất kèm câu giải thích — cho
   tab đã mở sẵn từ trước.

Lớp 1 để không lách được (RLS từ chối là IM LẶNG: 0 dòng, HTTP 200, error
null); lớp 2–3 để người dùng hiểu chuyện gì xảy ra.

⚠ `COALESCE(is_active, true)` ở cả ba lớp là BẮT BUỘC: cột này NULL được
(`is_active boolean DEFAULT true`, mig 001 — không NOT NULL). Đọc NULL
thành "đã khoá" là khoá oan người đang đi làm.

**Cần chủ nhà biết:** nếu trước giờ có ai bị "khoá" mà vẫn dùng app bình
thường, sau khi chạy 122 họ sẽ mất truy cập ngay. Đó là sửa đúng, nhưng
nên rà `SELECT full_name, role FROM users WHERE COALESCE(is_active,true) = false;`
trước khi chạy.

## Q18 — PHÁT HIỆN: bộ seed demo sẽ hỏng nếu không sửa cùng lúc

`003_seed.sql` chèn `driver@demo.com` với `role = 'driver'`. Trigger
`trg_block_driver_role` của mig 122 TỪ CHỐI lệnh đó.

Ở đường cài mới, `seed_demo.sql` chạy **SAU** `schema_full.sql` (xem
`supabase/INSTALL.md`) — tức là sau khi trigger đã tồn tại. Để nguyên thì
bộ demo dừng giữa chừng với một câu tiếng Anh, sau khi đã chèn xong một
phần dữ liệu.

**Đã sửa:** bỏ hẳn tài khoản tài xế khỏi `003_seed.sql` (5 tài khoản
demo thay vì 6), cập nhật ba tệp nói "6 tài khoản demo". `003_seed` chỉ
dùng cho môi trường thử và tự dọn dẹp ở đầu tệp, nên sửa tại chỗ được —
KHÁC với 093 ở Q15.

## Q15 — LỖI CỦA TÔI, đã sửa: vá thẳng vào một migration ĐÃ CHẠY

Lượt trước tôi sửa `093_aggregate_functions.sql` tại chỗ để kẹp số dư có.
Sai, và sai theo đúng kiểu đắt nhất của cả đợt này: **không ai thấy**.

- 093 đã chạy trên production từ lâu. `supabase db push` chỉ chạy
  migration MỚI → bản vá không bao giờ tới nơi.
- 093 dùng `CREATE FUNCTION` trần (không `OR REPLACE`) → chạy lại nó
  trên CSDL có sẵn còn ném "function already exists".
- `schema_full.sql` chỉ dùng để CÀI MỚI, và nó được sinh lại từ
  migrations → bản gộp chứa phép vá, nhìn vào tưởng đã xong.

Kết quả: kho mã nói đã sửa, cơ sở dữ liệu thật vẫn tính sai, và bộ test
cấu trúc vẫn xanh vì nó chỉ đọc tệp.

**Đã sửa:** hoàn `093` về nguyên trạng; toàn bộ phép sửa chuyển sang
migration **121** mới. Thêm một chốt nhìn NGƯỢC
(`tests/workflow-v2-q11-credit.test.ts` → "093 KHÔNG được mang phép sửa")
để không ai — kể cả tôi — "dọn dẹp" bằng cách chép ngược về 093.

⚠ **Luật rút ra, áp cho mọi đợt sau:** migration đã chạy ở bất cứ đâu thì
BẤT BIẾN. Chỉ 118/119/120 sửa tại chỗ được, vì chúng chưa chạy ở đâu cả —
điều đó đã ghi trong sổ tiến độ từ trước, và tôi đã suy rộng nó ra một
tệp không thuộc nhóm đó.

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

---

## Q19 — LỖI THẬT, đã sửa: duyệt kiểm kê xong kho không đổi

Chủ NPP báo: bấm "Duyệt điều chỉnh", màn hiện "Đã duyệt … Kho đã cập
nhật", tồn kho không đổi một con số nào.

**Nguyên nhân: bất đối xứng quyền, cộng cái bẫy lớn nhất của kho này —
RLS TỪ CHỐI LÀ 0 DÒNG, HTTP 200, `error` NULL.**

Nút mở cho `owner` + `manager` (`canApprove`). Policy của `batches` và
`stock_entries` (mig 002) chỉ cho `owner` + `warehouse` ghi. Với vai
`manager`:

| Bước | Bảng | manager | Kết quả |
|---|---|---|---|
| 1. cộng/trừ tồn | `batches` | KHÔNG | 0 dòng, im lặng |
| 2. ghi chi phí hao hụt | `expenses` | **CÓ** | **GHI THẬT** |
| 3. đóng dấu đã duyệt | `stock_entries` | KHÔNG | 0 dòng, im lặng |

`.throwOnError()` chỉ ném khi `error` KHÁC null. RLS từ chối không phải
lỗi — nó là "không có dòng nào khớp". Cả ba bước trôi qua êm.

⚠ **Hậu quả tệ hơn "không đổi gì":** bước 2 chạy được. Sổ chi phí có
khoản hao hụt mà kho không giảm — sách và hàng lệch nhau đúng bằng số
đó. Và vì bước 3 không chạy, phiếu vẫn ở "chờ duyệt": bấm lại là ghi
thêm MỘT khoản trùng nữa. Bấm ba lần, ba khoản.

⚠ **Vì sao không ai phát hiện sớm:** với vai `owner` cả ba bước đều
chạy đúng, mà người thử nghiệm thường là chủ NPP.

**Đã sửa — migration 123 + `src/lib/inventory/post-adjustment.ts`:** bỏ
hẳn vòng lặp ghi từ trình duyệt, đưa về RPC `post_stock_adjustment`
(`SECURITY DEFINER`, một giao dịch, idempotent bằng khoá dòng phiếu +
chốt `ALREADY_POSTED`). Ba lỗi nữa được xoá cùng lúc:
- không còn đọc-rồi-ghi (`select qty_on_hand` … `update`) nên hai người
  duyệt cùng lúc không đè nhau — mọi lô đụng tới đều `FOR UPDATE`;
- không còn `Math.max(0, …)` kẹp âm trong im lặng: tồn đã đổi từ lúc
  kiểm đếm thì ném `STOCK_MOVED` kèm hai con số;
- thừa mà sản phẩm chưa có lô nào thì ném `NO_BATCH`, không bỏ qua.

Và màn hình nay báo theo SỐ RPC TRẢ VỀ (số lô thật sự đụng), không theo
số tính sẵn ở trình duyệt — chính chỗ lệch giữa hai cái đó là lỗi này.

**Cần chủ nhà quyết:** mig 123 in ra danh sách phiếu kiểm kê ĐÃ ghi chi
phí hao hụt mà chưa đóng dấu duyệt — dấu vết của đúng lỗi này.
Migration **KHÔNG tự xoá** các khoản đó (đó là tiền, và xoá nhầm còn tệ
hơn). Xem từng phiếu rồi quyết: xoá khoản ghi khống, hay giữ và duyệt
lại phiếu cho khớp.

**Đã rà các màn khác:** chỉ `/inventory/adjustments` dính. Hai màn
`batches/*` gác đúng `["warehouse","owner"]` khớp policy;
`/inventory/stocktake` và `/inventory/stock-in` dùng `.insert()` — INSERT
bị RLS chặn thì PostgREST trả lỗi 42501 THẬT, nên chúng hỏng to tiếng.
Chỗ im lặng chỉ là UPDATE/DELETE không `.select()`. `/inventory/pending`
cũng có một `.update()` kiểu đó nhưng nằm trong `handleRestock` — đã bị
P7 khoá từ trước.

## Q20 — Mẫu in hoá đơn dựng lại theo bản KiotViet

Chủ NPP gửi bản in KiotViet làm mẫu. Đã dựng
`src/components/printing/sales-invoice.tsx` theo đúng bố cục: tiêu đề
công ty căn TRÁI, tiêu đề "HÓA ĐƠN BÁN HÀNG" + ngày giờ + số HĐ căn
giữa, khối khách hàng bốn nhãn, bảng BẢY cột có kẻ đủ (thêm cột **CK**),
ba dòng tổng nằm TRONG bảng, dòng "Bằng chữ", và BA ô ký (bản cũ chỉ
hai).

⚠ **Một chỗ cố ý KHÔNG giống mẫu: dòng thuế GTGT được giữ.** Mẫu
KiotViet là hoá đơn bán hàng thường, không có thuế. Nhưng màn này in từ
bảng `invoices` — chứng từ có cột `vat` và nối với hoá đơn điện tử MISA.
Bỏ dòng thuế khỏi một chứng từ thuế là làm mất thông tin pháp lý, nên nó
chỉ HIỆN KHI CÓ (`vat > 0`). Hoá đơn không thuế in ra trông y hệt file
gửi. Chủ nhà muốn bỏ hẳn thì nói, đó là quyết định nghiệp vụ.

⚠ **Khổ giấy:** mặc định của kho này là A5 (phiếu giao cho người đi
giao). Hoá đơn bảy cột ở A5 thì chữ rơi xuống 8pt và hai cột tiền dính
nhau, nên nút in của nó khai `defaultPaper="A4"`. Dropdown vẫn cho chọn
A5, và có khối CSS `.a4-doc` co lại cho vừa — không có khối đó thì chọn
A5 là bảng tràn lề, hỏng chỉ lộ ra sau khi đã in.

