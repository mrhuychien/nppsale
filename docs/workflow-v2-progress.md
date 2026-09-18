# Workflow đơn hàng v2 — Progress Tracker

Branch: `feat/workflow-v2` (tách từ `main` tại `44dbe7f`). Chưa merge.
Nguồn sự thật: Coder Pack "npp.sale — Workflow đơn hàng v2" ngày 18/09/2026.

Mục tiêu: thay luồng 6 trạng thái + duyệt + soạn hàng + giao + bàn giao
bằng 4 trạng thái NPP xử lý trực tiếp — Nháp → Phiếu tạm → Hoàn thành /
Đã hủy. Xuất hàng là MỘT nút: trừ kho FIFO + sinh công nợ + in phiếu giao.
Đơn trả và Phiếu thu là hai chứng từ độc lập, khép kín với công nợ.

Resume: lấy phase chưa tick đầu tiên → đọc đúng mục của Coder Pack →
làm → `npx tsc --noEmit` + `npm test` + `npm run build` xanh → commit
`feat(wf2-P<n>):` → cập nhật file này → báo cáo 3 dòng → DỪNG chờ "tiếp".

## Phase

- [x] **P0** `chore(wf2-P0)` — Branch + baseline + hai file docs.
- [x] **P1** `feat(wf2-P1)` — Migration 119: cột mới, CHECK status mới,
      backfill, bỏ workflow_stage trigger + khoá dòng đã pick, RLS viết
      lại, `is_revenue_status` = `completed`, cascade SQL (mục 2.11).
      Kèm bảng `stock_line_consumptions` + một lệnh chèn trong
      `post_stock_export`, trigger trần số lượng trả, và
      `tests/workflow-v2-transitions.test.ts` (32 chốt, đã thử phá 14
      lần; một chốt nói dối đã bị bắt và siết lại).
- [x] **P2** `feat(wf2-P2)` — Migration 120: 5 helper `_wf2_*` + 7 RPC
      (`complete_order`, `edit_completed_order`, `cancel_order`,
      `complete_return`, `cancel_return`, `create_cash_receipt`,
      `void_cash_receipt`) + grants. Kèm gỡ trigger nhập kho tự động của
      đơn trả (Q3), seed các ô quyền RPC cần (Q6), và
      `tests/workflow-v2-rpcs.test.ts` (66 chốt, thử phá 12 lần đều đỏ).
- [x] **P3** `feat(wf2-P3)` — Types, constants, permissions,
      edit-permission + cascade TS (mục 5); test cũ xanh trở lại.
- [x] **P4** `feat(wf2-P4)` — NVBH mobile: Lưu nháp / Gửi đơn, offline
      `target_status`, /sell/drafts, tab Phiếu tạm / Hoàn thành / Đã hủy.
      Kèm Rút về nháp, gỡ nút ghi công nợ tay ở màn chi tiết, ba loại
      thông báo mới của v2, và `tests/workflow-v2-sales-flow.test.ts`
      (12 chốt, thử phá 10 lần đều đỏ).
- [x] **P5** `feat(wf2-P5)` — NPP /orders: ba tab cho mọi vai trò, nút
      Xuất hàng đọc kết quả RPC, Xem nhanh mở rộng (huy hiệu cảnh báo +
      cột Tồn), mẫu in phiếu giao tách thành
      `components/printing/delivery-slip.tsx`. Kèm `complete-order.ts`,
      `order-stock-preview.ts` và 21 chốt mới; thử phá 28 lần.
- [x] **P6** `feat(wf2-P6)` — Đơn trả (/returns) + Phiếu thu
      (/finance/cash-receipts) gồm cấn trừ đơn trả độc lập. Bốn RPC của
      migration 120 nay đều có giao diện gọi. Kèm
      `lib/returns/complete-return.ts`, `lib/finance/cash-receipt.ts`,
      màn lập phiếu thu mới, và 15 chốt; thử phá 14 lần.
- [x] **P7** `feat(wf2-P7)` — Ẩn module luồng cũ khỏi nav (không xoá
      code), khoá năm nút ghi, cập nhật toàn bộ docs hướng dẫn + bộ
      mockup, checklist E2E, 16 chốt mới. Kèm Q11 (số dư có).

## Baseline P0

Chạy trên `44dbe7f` trước khi sửa gì:

| Bước | Kết quả |
|---|---|
| `npm ci` | xong, chỉ còn cảnh báo `npm audit` có sẵn từ trước |
| `npx tsc --noEmit` | sạch, không dòng nào |
| `npm test` | 74 file, 1788 test, xanh hết |
| `npm run build` | xanh, sinh đủ route |

## Ghi chú P0

- Nhánh tách từ `main` tại `44dbe7f`, cây làm việc sạch trước khi tách.
- Baseline chạy TRƯỚC khi sửa bất cứ thứ gì, nên mọi test đỏ từ P1 trở
  đi là do đợt này gây ra, không phải nợ cũ.
- Đã mở `docs/workflow-v2-questions.md` với một câu hỏi MỞ cần chủ nhà
  quyết trước khi viết backfill ở P1 (Q1: đơn giao xong qua tài xế đang
  nằm ở `confirmed`).
- Chưa đụng một dòng mã sản phẩm nào ở P0.

## Ghi chú P1

- Cascade SQL (mục 2.11) hoá ra nhỏ hơn tưởng: chỉ `finance_pnl` còn lọc
  doanh thu bằng giá trị trạng thái viết thẳng. Mọi hàm lương và tổng
  quan đã gọi `is_revenue_status` từ mig 094 nên tự đi theo. Các dòng
  `status IN ('delivered','confirmed')` còn thấy trong `schema_full.sql`
  đều thuộc các bản `compute_payroll_run` đã bị đè, không tồn tại trong
  CSDL.
- P1 lấn đúng phần đã ghi ở Q2: hằng số `NON_REVENUE_ORDER_STATUSES` và
  một chốt trong `tests/payroll-net-revenue.test.ts`. Chốt cũ đọc danh
  sách `NOT IN (…)` trong thân hàm; v2 viết theo chiều ngược lại nên nó
  được viết lại thành bất biến "hằng số bằng phần bù của
  `is_revenue_status`", suy từ hai nguồn SQL.
- `supabase/INSTALL.md` đổi 72 thành 73 bảng, do bảng mới.
- ⚠ **Việc để lại cho P3:** `src/app/(dashboard)/orders/[id]/page.tsx`
  vẫn đọc view `v_sales_order_line_picked` vừa bị xoá. Trang chi tiết đơn
  sẽ lỗi lúc chạy cho tới khi P3 dọn theo mục 5. Không ảnh hưởng build
  hay test vì đây là truy vấn lúc chạy.
- ⚠ **Chặn P2:** xem Q3 trong sổ câu hỏi — trigger nhập kho tự động của
  đơn trả vẫn sống, sẽ nhập kho hai lần khi có `complete_return`.

## Ghi chú P2

- Trước khi commit đã cho bốn người soi chéo migration theo bốn góc
  (cú pháp PL/pgSQL, đối chiếu schema, đối chiếu nghiệp vụ, an toàn dữ
  liệu). Họ tìm ra 5 lỗi CHẶN và một loạt lỗi nặng; tất cả đã sửa và mỗi
  cái có một chốt test riêng để không quay lại:
  1. Huỷ phiếu thu xoá `payments` trong khi dòng phiếu thu còn trỏ tới →
     lỗi khoá ngoại, không huỷ được phiếu thu nào.
  2. Huỷ đơn đã xuất xoá công nợ trong khi dòng của phiếu thu ĐÃ HUỶ còn
     trỏ tới → lỗi khoá ngoại, hoàn kho cũng mất theo.
  3. `UPDATE … RETURNING … INTO` trên đơn có từ hai phiếu trả nháp → lỗi
     nhiều dòng, cả lần xuất hàng rollback.
  4. Huỷ đơn hoàn kho theo NGUYÊN phiếu xuất, mà phiếu xuất cũ gộp nhiều
     đơn → trả về kho cả hàng của đơn khác.
  5. Hoàn kho không trừ dấu vết đã hoàn → sửa đơn giảm rồi huỷ đơn là
     hoàn hai lần.
- Ba lỗi nặng khác cũng đã sửa: sửa đơn thiếu kiểm chủ đơn (hàm
  SECURITY DEFINER bỏ qua RLS), nhập trả cho đơn chưa xuất cộng khống
  tồn, và hàng trả nhập lại mang giá vốn 0 làm lãi gộp báo khống.
- Quyết định có ghi lại trong sổ câu hỏi: Q5 khoá quyền cho phiếu thu,
  Q6 seed ma trận quyền, Q7 cột lý do huỷ phiếu trả.

## Ghi chú P3

- Đổi kiểu `OrderStatus` và `ReturnStatus` trước, rồi để trình kiểm kiểu
  liệt kê việc: 66 lỗi, dọn hết. Cách này bắt được cả những chỗ so sánh
  trạng thái mà grep bỏ sót.
- Xoá `lib/orders/reapproval.ts` và `lib/sell/send-approval.ts`. Thay bằng
  `lib/sell/send-order.ts`: gửi đơn là một lệnh đổi `draft` → `submitted`,
  có `.eq("status","draft")` chống đua và kiểm số dòng.
- Bộ quy tắc duyệt GIỮ LẠI nhưng đổi vai: nó không quyết trạng thái nữa,
  chỉ ghi `approval_reason` làm cảnh báo cho NPP đọc trước khi xuất hàng.
  Ba chốt test cũ về "tự duyệt / trả về chờ duyệt" được viết lại thành
  "vẫn là phiếu tạm, nhưng phải kèm cảnh báo".
- Nút duyệt hàng loạt ở danh sách đơn đổi thành **Xuất hàng**, gọi RPC
  `complete_order` từng đơn một. Không UPDATE thẳng: trigger 119 chặn, và
  mỗi đơn là một giao dịch nên đơn thiếu tồn không kéo cả loạt đổ theo.
- Bỏ hẳn nút "chuyển bước tiếp theo" hàng loạt — v2 không còn bước trung
  gian nào để chuyển.
- `edit-permission.ts` thêm `canEditCompleted` / `whyLockedCompleted`: bốn
  khoá của đơn đã xuất, có test đối chiếu với đúng bốn mã lỗi trong
  migration 120 để màn hình và RPC không nói hai đằng.
- ⚠ **Việc để lại cho P7:** ba màn của luồng cũ vẫn ghi trạng thái đã bị
  bỏ — `/inventory/stock-out` ghi `picking`, `/inventory/entries/[id]` ghi
  `delivering`, màn thu tiền theo phiếu xuất ghi `delivered`. Chúng sẽ
  hỏng thành LỖI RÕ RÀNG (vi phạm ràng buộc CHECK) chứ không âm thầm sai,
  và P7 gỡ chúng khỏi menu. Không sửa ở P3 vì spec nói giữ nguyên mã luồng
  cũ.

## Ghi chú P4

- Trạng thái nay ĐI CÙNG ĐƠN: `OfflineOrderPayload` mang `targetStatus`,
  `createOrderRecords` ghi thẳng giá trị đó. Bản cũ insert `draft` rồi
  UPDATE lên trạng thái thật — đơn soạn lúc mất mạng không ai chạy bước
  UPDATE nên nằm mãi ở nháp và nhà phân phối không bao giờ thấy.
- **Vượt tồn không còn chặn NVBH gửi đơn** (mục 4.1): nhân viên đọc con
  số tồn có thể đã cũ vài giờ; chặn họ là mất đơn thật vì một số liệu
  không chắc. Băng vàng cảnh báo thay cho nút mờ; chốt chặn thật nằm ở
  `complete_order` — kho khoá và trừ trong cùng một giao dịch.
- Màn "Đơn của tôi" của NVBH nay có BA tab và **không có "Tất cả"**. Giá
  trị lọc nào rơi ngoài ba tab (kể cả mặc định "all" và đường dẫn sâu
  `?status=draft`) được quy về Phiếu tạm.
- ⚠ **Một chỗ lệch spec, đã tự quyết vì không phải chuyện nghiệp vụ:**
  quy ước cũ của repo là "trên điện thoại MỌI bộ lọc nằm trong sheet"
  (người dùng yêu cầu). Ba tab này là ĐIỀU HƯỚNG chứ không phải bộ lọc —
  giấu vào sheet thì màn mở ra ở tab Phiếu tạm và không có đường nào
  sang hai tab kia. Nên chúng đứng ngoài sheet, và bản trong sheet tắt
  đi cho NVBH để hai chỗ không cùng đổi một giá trị.
- Gỡ nút **"Ghi nhận công nợ"** khỏi màn chi tiết đơn. v2 sinh công nợ
  bên trong `complete_order`; đơn đã xuất mà thiếu công nợ là dữ liệu
  lệch, không phải việc còn dở — nay nói ra bằng một khung cảnh báo thay
  vì mời người dùng vá tay. `ensureReceivableForOrder` giữ nguyên trong
  lib vì ba màn của luồng cũ còn gọi (P7 ẩn chúng).
- Thêm **"Rút về nháp"** cho phiếu tạm: gửi nhầm thì không phải huỷ rồi
  soạn lại. `NextStatus` có thêm cờ `backward` — trước đây nút chính lọc
  bằng `t.value !== "cancelled"`, thêm một bước lùi nữa là nó leo lên
  làm nút to.
- Nhãn trạng thái phiếu trả trên màn chi tiết đơn còn là bốn giá trị cũ
  (`pending/approved/rejected`), đã đổi theo `chk_returns_status_v2`.
  Trước khi đổi, mọi phiếu trả rơi xuống `|| r.status` và hiện chữ
  "submitted" trần giữa màn tiếng Việt; phần cấn trừ công nợ cũng đang
  cộng cả phiếu chưa hoàn thành.
- Ba loại thông báo mới (`order_completed`, `order_edited`,
  `return_completed`) thêm vào union + CẢ HAI bảng biểu tượng. Hai loại
  của bước duyệt cũ GIỮ LẠI: thông báo cũ còn nằm trong bảng.
- ⚠ **Sự cố trong lúc làm, đã khắc phục:** kịch bản thử phá sao lưu tệp
  theo tên trần nên ba tệp cùng tên `page.tsx` đè lên nhau, làm hỏng hai
  màn. Lấy lại từ commit P3 rồi làm lại toàn bộ sửa đổi của P4; `tsc`,
  1870 test và `npm run build` đều xanh sau khi làm lại. Lần thử phá thứ
  hai giữ nguyên văn trong bộ nhớ theo khoá và kiểm tệp khớp từng byte
  sau khi phục hồi.

## Ghi chú P5

- Trước khi viết một dòng nào, cho bốn người ĐO bốn mảng việc của P5.
  Bản đo bắt được hai chỗ mà đọc lướt không thấy, và cả hai đều đắt:
  1. **Nút Xuất hàng vứt cả năm cột RPC trả về.** Khi đơn vị bật cho
     phép bán âm, `post_stock_export` KHÔNG ném lỗi lúc thiếu hàng — nó
     cho tồn âm, vẫn sinh công nợ đủ tiền, vẫn trả `error = null`. Màn
     báo "Đã xuất hàng", kho đóng hàng theo phiếu, tài xế tới nơi thì
     thiếu. Cột `short_qty` sinh ra đúng để chặn cảnh đó.
  2. **Ba tab mở ra một cái bẫy tìm kiếm.** Tìm và trạng thái nối AND
     trong cùng một truy vấn, mà ô tìm trên thanh tiêu đề đẩy sang
     `/orders?q=…` không kèm trạng thái — nên nó đáp xuống tab Phiếu tạm
     và trả rỗng cho mọi đơn đã hoàn thành hay đã huỷ. Lỗi này do chính
     P4 gieo và đã sống được một commit.
- Cột Tồn ở Xem nhanh bám theo ĐÚNG mã của RPC, không theo thói quen các
  màn khác: nguồn là `batches` lọc `qty_on_hand > 0` (không lọc khu vực
  kho, không lọc hạn dùng — RPC không lọc), đơn vị cơ sở, hệ số lấy từ
  ảnh chụp `sales_order_lines.conversion_factor` chứ không tra danh mục,
  và CỘNG cả hàng đổi của phiếu trả còn nháp. Lệch một trong bốn điều đó
  là cột này còn tệ hơn không có.
- Thiếu tồn hiện VÀNG hay ĐỎ tuỳ `organizations.allow_oversell`: đơn vị
  cho phép bán âm thì RPC vẫn xuất, tô đỏ ở đó là làm người ta không dám
  bấm một nút vốn bấm được.
- Mẫu in phiếu giao tách sang `components/printing/delivery-slip.tsx`
  theo đúng khuôn ba component in có sẵn: kiểu riêng đã làm phẳng, gốc
  trang mang `print-page a5-doc`, lớp `.print-*-only` để nơi gọi đặt.
  Màn cũ vẫn in y hệt — ba thứ ngoài phạm vi một đơn (`entryCode`,
  `pageIndex`, `pageTotal`) truyền vào qua props chứ không bỏ đi.
- ⚠ **Một lỗi của 119 nằm im trong phiếu giao:** truy vấn phiếu trả lọc
  `pending / approved / completed`, mà hai giá trị đầu đã bị backfill đi
  và `chk_returns_status_v2` cấm. Sau khi 119 chạy, phần hàng trả LẶNG
  LẼ biến mất khỏi phiếu giao — lái xe không biết phải thu lại gì, và
  không có lỗi nào bắn ra. Đã sửa cả bộ lọc lẫn bảng nhãn.
- Một chốt test NÓI DỐI bị bắt trong lượt thử phá: nó soi chuỗi
  `INSUFFICIENT_STOCK` trong tệp, mà cái tên đó còn nằm trong khối chú
  thích đầu tệp — tắt hẳn nhánh dịch lỗi mà chốt vẫn xanh. Đã thay bằng
  test gọi thẳng hàm.

## Ghi chú P6

- **Bốn RPC của 120 trước P6 CHƯA CÓ MỘT LỆNH GỌI NÀO trong src/.** Viết
  xong ở P2 rồi nằm không. P6 nối cả bốn.
- ⚠ **Chỗ hàng trả biến mất khỏi tồn.** `/returns/new` lập phiếu vào
  thẳng `completed` — đúng với hồi còn trigger tự nhập kho, nhưng 120 đã
  gỡ trigger ấy. Hệ quả đọc được từ mã: tồn không đổi, công nợ không
  giảm, nhưng `credited_at` vẫn đóng dấu nên BÁO CÁO thì đổi — sổ báo
  cáo và sổ công nợ nói hai đằng. Và phiếu KẸT VĨNH VIỄN:
  `complete_return` đòi `submitted`, `cancel_return` ném
  `NO_IMPORT_TO_REVERSE`. Nay lập ra ở `submitted`.
- **Kho nhận là quyết định của người duyệt, không đoán hộ.**
  `complete_return` bắt buộc `p_zone`, và trước P6 không màn nào trong
  src/ ghi cột `destination_zone`. Chọn nhầm là hoặc đem hàng cận hạn
  bán tiếp, hoặc chôn hàng còn tốt vào kho chờ xử lý.
- **Huỷ phiếu thu từng chỉ đổi một cột.** Bản cũ `update({ status:
  "voided" })` rồi dừng, để nguyên `payments` đã ghi và `paid` đã cộng —
  khách hiện ra đã trả tiền trong khi phiếu thu đã huỷ. Nay đi qua
  `void_cash_receipt`.
- **Cấn trừ đơn trả độc lập** là ý niệm dễ hiểu nhầm nhất của P6. Hai
  loại phiếu trả giảm công nợ theo hai đường KHÁC NHAU: phiếu GẮN ĐƠN
  giảm ngay lúc `complete_return` gọi `_wf2_recompute_receivable`, nên
  đem nó vào phiếu thu nữa là trừ hai lần và RPC từ chối
  (`BAD_CREDIT`); phiếu ĐỘC LẬP (`order_id` null) thì nằm chờ cho tới
  khi kế toán đem vào một phiếu thu. Màn lập phiếu thu lọc đúng ba điều
  kiện RPC kiểm.
- Hai chốt test NÓI DỐI bị bắt trong lượt thử phá: chúng dùng
  `toContain` với một cụm chữ CÓ SẴN trong thông điệp gốc của RPC, nên
  xoá hẳn nhánh dịch mà vẫn xanh (nhánh cuối trả nguyên văn). Đã đổi
  sang `toBe` với câu dịch đầy đủ.
- ⚠ **Q8 — MỞ, chờ chủ nhà quyết:** lỗ trong trần số lượng trả. Trigger
  chỉ đếm phiếu `completed` là "đã trả", và `complete_return` không kiểm
  lại — nên hai phiếu cùng nằm ở `submitted` đều lọt, hoàn thành cả hai
  là trả gấp đôi và trừ công nợ gấp đôi. Đây là lỗ trong MIGRATION nên
  tôi dừng, không tự sửa.
- Lượt đo P6 về đích SAU khi commit vòng đầu, và bắt thêm bốn lỗi — một
  trong số đó nằm ngay trong màn tôi vừa sửa: hai lệnh ghi ở
  `/returns/[id]` không đếm số dòng, mà bảng `returns` KHÔNG có policy
  DELETE nào và policy UPDATE chỉ mở cho owner/manager. Chủ bấm Xoá thấy
  "Đã xoá" rồi bị đẩy về danh sách nơi phiếu vẫn nằm đó; thủ kho bấm Sửa
  thấy "Đã cập nhật" rồi số cũ hiện về. Ba lỗi kia: ô Credit Note mở cho
  cả phiếu đã hoàn thành (làm `receivables` và `returns` lệch vĩnh viễn),
  thiếu dịch `OVERPAID_AFTER_CREDIT` (mã bắn GIÁN TIẾP từ
  `_wf2_recompute_receivable` nên dễ quên), và câu hướng dẫn trên màn
  danh sách bảo người dùng "chỉ để tra cứu, không cần thao tác duyệt" —
  chính câu đó là lý do hàng trả nằm ngoài sổ.
- Màn danh sách phiếu trả nay là HÀNG ĐỢI VIỆC: mở ra ở tab Chờ xử lý,
  "Tất cả" đứng cuối vì đó là chỗ tra cứu chứ không phải chỗ làm việc.
- ⚠ **Q10, Q11, Q12 — MỞ, chờ chủ nhà quyết** (đều là sửa migration nên
  tôi dừng): thiếu `FOR UPDATE` ở vòng kiểm khoản có của
  `create_cash_receipt` (hai kế toán cấn trừ cùng một phiếu trả là trừ
  hai lần); `OVERPAID_AFTER_CREDIT` có thể chặn `complete_return` vĩnh
  viễn khi tiền vào không qua phiếu thu; migration 118 còn lọc theo
  trạng thái phiếu trả đã chết nên khoá ngoại chặn xoá đơn.
- ⚠ **Q9 — việc để lại cho P7:** còn hai màn luồng cũ tự lập phiếu trả
  vào thẳng `completed` (`deliveries/[id]/handover`, `inventory/pending`)
  và một trong hai còn sửa công nợ bằng mã trình duyệt.

## P7 — ẩn luồng cũ, khoá nút ghi, dọn docs

**Đã làm.**
- `LEGACY_V2_HREFS` ẩn `/deliveries`, `/inventory/stock-out`,
  `/inventory/pending` khỏi MỌI menu, kể cả của chủ.
- **Tách `canSeeHref` (menu) khỏi `canEnterHref` (cửa vào).** Ẩn ≠ chặn:
  dữ liệu luồng cũ là chứng từ, vẫn phải mở xem được.
- Khoá năm nút ghi, chặn ở ĐẦU hàm trước mọi lệnh ghi:
  `stock-out/handleMerge`, `entries/[id]/handleSelfDeliver`,
  `stock-out/collect/handleSubmit`, `handover/handleSubmit`,
  `pending/handleRestock`. Bật lại bằng một hằng
  (`LEGACY_FLOW_WRITES_LOCKED`).
- Gỡ hai lối vào còn sót: ô "Xuất kho" trong menu *Tạo phiếu* ở
  `/inventory/entries`, và ô module *Giao hàng* ở `/help`.
- Viết lại cho đúng v2: `/help` (trang trợ giúp trong app), 8 tệp
  `HUONG_DAN*.md`, `BAN_GIAO.md`, `DEPLOY.md`, `supabase/INSTALL.md`,
  `.claude/skills/design-ux-ui/SKILL.md`, `supabase/mockup/README.md` và
  hai tệp mockup SQL.
- `docs/workflow-v2-checklist.md`: thêm mục 2.3 (lô cận hạn bị bỏ qua),
  4.3/4.4 (`FORBIDDEN_NOT_OWNER`, `TOTAL_MISMATCH`), 5.8
  (`ORDER_NOT_COMPLETED`), 6.6–6.10 (số dư có), mục 9 (P7), và khối
  chép danh sách "đơn Hoàn thành không có phiếu xuất" ở mục 0.
- Sinh lại `supabase/schema_full.sql` (đang lệch 107 dòng thêm / 23 dòng
  bớt so với migrations — đúng phần Q8/Q10/Q11/Q12).
- 16 chốt ở `tests/workflow-v2-p7.test.ts`; thử phá 10/10 bị bắt.

**Bất ngờ gặp.**
- ⚠ **Thêm `/deliveries` vào danh sách ẩn thì CHẶN LUÔN CỬA VÀO.**
  `useRoleGuard` dùng chung `canSeeHref`, nên ẩn khỏi menu cũng thành đá
  người dùng về trang chủ — ngược hẳn với "chứng từ cũ vẫn phải xem
  được". Phải tách làm hai hàm.
- ⚠ **Để nguyên nút ghi còn TỆ HƠN báo lỗi.** Ba màn luồng cũ ghi theo
  nhiều bước rời nhau và bước đổi trạng thái đơn nằm ở CUỐI — mà mig 119
  nay từ chối trạng thái đó. Người dùng không nhận thông báo lỗi, họ
  nhận **ghi dở**: kho đã trừ hoặc tiền đã ghi, đơn thì không đổi, không
  giao dịch nào cuộn lại.
- ⚠ **Hai màn phiếu trả còn tệ hơn nữa:** bảng `returns` KHÔNG có trigger
  chặn chuyển trạng thái, và mig 120 đã gỡ trigger nhập kho tự động. Hai
  màn đó vẫn đẩy phiếu trả thẳng vào `completed` mà hàng không vào kho —
  CSDL không cãi một câu. Ở đó giao diện là lớp chặn DUY NHẤT.
- ⚠ **Bộ mockup không chèn được nữa.** `05_sales_orders.sql` và
  `07_returns_visits.sql` chèn thẳng năm giá trị trạng thái đã chết; sau
  mig 119 mỗi INSERT ném ràng buộc và người cài demo đứng giữa đường với
  nửa bộ dữ liệu. Đã đổi, và cố ý KHÔNG theo backfill của mig 119 ở hai
  đơn `picking` (mig đẩy lên `completed` vì đơn thật có phiếu xuất; đơn
  demo chưa bao giờ trừ tồn).
- **Hai chốt nói dối, bắt được nhờ thử phá:** một chốt hỏi "có chữ
  `return` quanh đây không" vẫn xanh sau khi bỏ hẳn `return` khỏi guard
  (vì có `return` khác trong cửa sổ) → nay đếm ngoặc cắt đúng thân
  guard; một chốt tìm `balRes.error` vẫn xanh sau khi bỏ nó khỏi điều
  kiện rẽ nhánh (vì chữ đó còn ở dòng dưới) → nay neo vào cả câu `if`.

## Q11 — cho phép ghi số dư có (chủ nhà chọn phương án a)

**Đã làm.**
- Gỡ `OVERPAID_AFTER_CREDIT` khỏi `_wf2_recompute_receivable`; sửa
  `void_cash_receipt` xét `'paid'` TRƯỚC `'partial'`.
- Thêm `use_credit` vào `create_cash_receipt`, ghi **bút toán hai vế**
  (`payments` âm ở khoản đang dư + dương ở khoản được thu, cùng
  `kind='credit_applied'`) để `void_cash_receipt` đảo được bằng đúng
  vòng lặp sẵn có.
- Kẹp `GREATEST(0, …)` ở `receivables_by_rep` / `receivables_by_customer`
  và trần 100 cho tỉ lệ thu hồi (093).
- `src/lib/receivables/credit.ts` — một chỗ khai, mọi màn dùng.
- Màn lập phiếu thu: thẻ "Số dư có của khách" + ô rút + hai phép chặn
  bản sao của RPC.
- 28 chốt ở `tests/workflow-v2-q11-credit.test.ts`; thử phá 25/25 bị bắt.

**Bất ngờ gặp.**
- ⚠ **Dòng trả dư mang `status = 'paid'`,** nên danh sách khoản nợ (lọc
  `open/partial/overdue`) gạt nó đi — tiền của khách biến mất khỏi màn.
  Phải có truy vấn RIÊNG, không lọc trạng thái.
- ⚠ **PostgREST không so được cột với cột,** nên không hỏi thẳng
  `paid > amount` được; phải kéo về rồi cộng — và phải kéo qua
  `fetchAllForAggregate`, vì một khách lâu năm vượt 1000 dòng là
  PostgREST cắt bớt trong im lặng và số dư hiện ra THIẾU.
- ⚠ **Hai lớp che chồng lên nhau ở sổ công nợ:** vừa lọc
  `status <> 'paid'` vừa cộng `amount - paid`. Kẹp là đúng, nhưng hệ quả
  là "Tổng công nợ" luôn KHAI CAO đúng bằng số dư — nên phải NÓI RA phần
  bị kẹp, không chỉ kẹp rồi im.

**Cần chủ nhà quyết.** Ba hệ quả của Q11 chưa dọn (Q13) và hai chỗ luồng
cũ để lại (Q14) — xem `docs/workflow-v2-questions.md`.

## Q13 + Q14 + Q15 — xử nốt

**Đã làm.**
- ⚠ **Q15 — sửa một lỗi của chính tôi trước đã.** Lượt trước tôi vá
  thẳng vào `093_aggregate_functions.sql`, một migration ĐÃ CHẠY trên
  production. `supabase db push` chỉ chạy migration mới, và 093 dùng
  `CREATE FUNCTION` trần nên chạy lại còn ném "already exists" — bản vá
  không bao giờ tới cơ sở dữ liệu thật, trong khi `schema_full.sql` (chỉ
  dùng để cài mới) lại chứa nó nên nhìn vào tưởng đã xong. Đã hoàn 093
  về nguyên trạng và chuyển toàn bộ sang **migration 121**.
- **Migration 121** (`CREATE OR REPLACE`, idempotent, có `GRANT` lại,
  `NOTIFY pgrst`, `RAISE NOTICE` đếm dòng bị ảnh hưởng): kẹp số dư có ở
  `receivables_by_rep` / `receivables_by_customer`, trần 100 cho tỉ lệ
  thu hồi, và lọc `return_credit` / `credit_applied` khỏi `cash_in` +
  `cash_from_customers`.
- **Q13.2** — nhập công nợ đầu kỳ: hạ số nợ xuống dưới số đã thu không
  còn là LỖI mà là **CẢNH BÁO** (trường `PlanRow.warning` mới, tách hẳn
  khỏi `message`), hiện trên từng dòng và đếm riêng trên thẻ tổng kết.
  Xoá một khoản đã thu một phần thì VẪN là lỗi.
- **Q13.3** — gom bốn bản sao `PAYMENT_METHOD_LABEL` về một chỗ ở
  `lib/constants.ts` + `labelPaymentMethod()`, thêm hai giá trị mới, nới
  `PaymentMethod`. Danh sách CHỌN vẫn hẹp — đó là hai thứ khác nhau.
- **Q14.1** — `/settings/approval-rules` **không khoá**, viết lại cho
  đúng việc: "Duyệt đơn tự động" → "Ngưỡng cảnh báo đơn", mọi câu "cần
  Manager duyệt" → "soát kỹ trước khi Xuất hàng".
- **Q14.2** — đo thật: tài xế còn 7 màn, không vào ngõ cụt. Không đổi mã.
- Checklist thêm 6.11–6.13 và 9.4–9.5. 12 chốt mới; thử phá 20/20 bị bắt.

**Bất ngờ gặp.**
- ⚠ **Màn ngưỡng duyệt chỉ CHẾT MỘT NỬA.** Định khoá nó như ba màn luồng
  cũ, nhưng đo ra: ngưỡng tiền thì chết, còn hạn mức công nợ / tín dụng
  vẫn chạy — `evaluateApproval` vẫn sinh câu cảnh báo ghi vào
  `approval_reason` và hiện trên màn đơn. Khoá màn là mất luôn cảnh báo
  hạn mức.
- ⚠ **`credit_applied` vô hại, `return_credit` thì không.** Vế kép của
  Q11 tự triệt tiêu trong mọi tổng; chỗ sai thật là `return_credit` —
  một vế dương không đối ứng, khiến tiền mặt trên bảng cân đối cao hơn
  két thật đúng bằng tổng hàng trả đã cấn trừ.
- **Một chốt nói dối nữa, bắt được nhờ thử phá:** chốt đòi câu cảnh báo
  phải nêu số dư sinh ra dùng dữ liệu 2.000.000 − 1.000.000 = 1.000.000,
  nên `toContain("1000000")` khớp nhầm vào chính số mới và vẫn xanh sau
  khi xoá hẳn phần nêu số dư. Đổi sang 2.000.000 − 1.200.000 = 800.000.

## Bỏ vai Tài xế — Q16, Q17, Q18

**Đã làm.** Mig 122: khoá `is_active` cho tài khoản mang vai `driver`
(in tên từng người ra trước), KHÔNG đổi vai, KHÔNG xoá dòng; chặn gán
mới bằng trigger chứ không siết `CHECK`. Tầng ứng dụng: `ROLES` và hai ô
chọn bỏ `driver`, ma trận quyền bỏ hàng của nó, nhưng GIỮ nhãn "Tài xế
(ngưng dùng)" và giữ giá trị trong kiểu `Role`. Bỏ `driver@demo.com`
khỏi seed, xoá `HUONG_DAN_DRIVER.md`, dọn khỏi `/help` và 6 tệp tài
liệu. 14 chốt mới; thử phá 25/25 bị bắt.

**Bất ngờ gặp.**
- ⚠ **"Khoá tài khoản" TRƯỚC NAY KHÔNG KHOÁ GÌ CẢ** (Q17). Chỉ đường
  đăng nhập bằng mã QR kiểm `is_active`; đường email + mật khẩu và cả
  `user_org_id()` đều không. Nhân viên đã nghỉ việc vẫn vào được với
  nguyên quyền. Đây là lỗ có sẵn, nhưng nó làm hỏng đúng phương án chủ
  nhà chọn nên phải vá cùng lúc — ba lớp: hai hàm cổng RLS, màn đăng
  nhập, và `AuthProvider`.
- ⚠ **Bộ seed demo sẽ hỏng giữa chừng** (Q18): `003_seed.sql` chèn
  `driver@demo.com`, mà `seed_demo.sql` chạy SAU `schema_full.sql` nên
  trigger của 122 đã tồn tại và từ chối lệnh đó.
- ⚠ **Phải chừa một lối ra.** Ô chọn vai bỏ hẳn giá trị đang lưu thì nó
  hiện rỗng, bấm Lưu là ghi đè mất vai thật — và không còn cách nào đổi
  tài khoản tài xế cũ sang vai khác. `roleOptionsFor()` ghép vai hiện
  tại vào danh sách khi nó đã ngưng dùng.
- ⚠ **Trigger phải chặn ĐÚNG lúc giá trị đổi thành `driver`**, không
  chặn mọi UPDATE chạm vào dòng đó — chặn rộng là nhốt luôn chủ NPP
  ngoài cửa, không còn đường dọn dẹp.

## Hai việc ngoài pack — Q19, Q20

**Đã làm.**
- **Q19 — duyệt kiểm kê xong kho không đổi.** Lỗi thật, và là đúng cái
  bẫy cả đợt này đang chống: nút mở cho `owner`+`manager`, policy
  `batches`/`stock_entries` chỉ cho `owner`+`warehouse` ghi, mà RLS từ
  chối = 0 dòng + HTTP 200 + `error` null nên `.throwOnError()` im. Tệ
  hơn: bước ghi `expenses` CHẠY ĐƯỢC, nên sổ có chi phí hao hụt mà kho
  không giảm, và bấm lại là ghi thêm khoản trùng. Đã đưa cả ba bước vào
  RPC `post_stock_adjustment` (mig 123) — một giao dịch, idempotent,
  khoá dòng, không kẹp âm im lặng.
- **Q20 — mẫu in hoá đơn** dựng lại theo bản KiotViet chủ NPP gửi: bảy
  cột có kẻ đủ (thêm cột CK), ba dòng tổng trong bảng, dòng "Bằng chữ",
  ba ô ký, in khổ A4.
- 35 chốt mới; thử phá 29/29 bị bắt.

**Bất ngờ gặp.**
- ⚠ **Vai `owner` chạy đúng cả ba bước**, nên lỗi Q19 sống sót lâu — người
  thử nghiệm thường là chủ NPP.
- ⚠ **INSERT hỏng to tiếng, UPDATE hỏng im lặng.** Rà các màn khác thì
  `/inventory/stocktake` và `/inventory/stock-in` dùng `.insert()`, bị
  RLS chặn là PostgREST trả lỗi 42501 thật. Chỗ im lặng chỉ là
  UPDATE/DELETE không `.select()`. Chỉ `/inventory/adjustments` dính.
- ⚠ **Mẫu gửi không có dòng thuế**, nhưng màn này in từ bảng `invoices`
  (có `vat`, nối hoá đơn điện tử MISA). Giữ dòng thuế và chỉ hiện khi
  `vat > 0` — bỏ hẳn là quyết định nghiệp vụ, chờ chủ nhà.

## Quy ước

- Mọi thao tác đụng tồn kho / công nợ / trạng thái đơn đi qua RPC
  `SECURITY DEFINER`, một transaction, idempotent. Không loop update từ
  trình duyệt.
- RLS từ chối = 0 dòng, HTTP 200, `error` null. Mọi update/delete từ
  client phải `.select("id")` rồi kiểm `rows.length === 0` → throw.
- RPC RAISE với `ERRCODE='P0001'`, message tiếng Việt mở đầu bằng mã
  (`LOCKED_HAS_PAYMENT: …`) để giao diện map lý do.
- Migration idempotent, header giải thích VÌ SAO theo phong cách mig
  097/113/115, kết thúc bằng `NOTIFY pgrst, 'reload schema'` và
  `RAISE NOTICE` đếm số dòng backfill.
- Code luồng bị ẩn (mục 6 Coder Pack): KHÔNG xoá trong đợt này.
- Mâu thuẫn giữa spec và code thật: dừng, ghi vào
  `docs/workflow-v2-questions.md`, báo cáo, không tự quyết.

## TODO chủ nhà (tích dần)

- [ ] Chạy migration **118 + 119 + 120 + 121 + 122 + 123** trên staging,
      đọc `RAISE NOTICE` backfill.
- [ ] **Đọc `RAISE NOTICE` của migration 123**: nó liệt kê phiếu kiểm kê
      đã ghi chi phí hao hụt mà chưa đóng dấu duyệt — dấu vết của lỗi
      Q19. Migration KHÔNG tự xoá; xem từng phiếu rồi quyết xoá khoản ghi
      khống hay duyệt lại phiếu cho khớp. ⚠ Chép ngay danh sách "đơn Hoàn thành không có phiếu
      xuất" — nó chỉ in MỘT LẦN (mục 0 của checklist có câu SQL chạy lại).
- [ ] Chạy hết `docs/workflow-v2-checklist.md` (10 mục).
- [x] Q13 + Q14 — đã xử nốt (xem mục trên và sổ câu hỏi).
- [ ] **Đọc `RAISE NOTICE` của migration 121** — nó nói tiền mặt trên
      bảng cân đối sẽ GIẢM bao nhiêu sau khi chạy. Đó là sửa đúng, không
      phải mất tiền; nhưng phải biết trước con số để khỏi hoảng.
- [x] Quyết vai `driver` — chủ nhà chốt BỎ, khoá tài khoản, không đổi vai.
- [ ] **Trước khi chạy 122 trên production:** rà
      `SELECT full_name, role FROM users WHERE COALESCE(is_active,true) = false;`
      ⚠ Mig 122 làm "Khoá tài khoản" thật sự có hiệu lực (Q17). Ai đang
      bị khoá trên giấy mà vẫn dùng app sẽ mất truy cập NGAY.
- [ ] Sau 122: đổi vai cho các tài khoản tài xế cũ ở Cài đặt → Người
      dùng (ô chọn có sẵn "Tài xế (ngưng dùng)" để đổi đi), rồi mở khoá.
- [ ] Bật lại module Giao hàng khi cần — đổi `LEGACY_FLOW_WRITES_LOCKED`
      về `false` và bỏ href khỏi `LEGACY_V2_HREFS`. ⚠ Đọc khối chú thích
      trong `src/lib/nav/legacy-flow.ts` trước khi bật.
- [ ] Merge vào `main` sau 2 tuần đối tác chạy ổn.
- [ ] Migration 118 (dọn đơn trả khi xoá đơn) vẫn chưa chạy trên
      production — việc tồn từ trước Coder Pack này.
