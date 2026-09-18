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
- [ ] **P3** `feat(wf2-P3)` — Types, constants, permissions,
      edit-permission + cascade TS (mục 5); test cũ xanh trở lại.
- [ ] **P4** `feat(wf2-P4)` — NVBH mobile: Lưu nháp / Gửi đơn, offline
      `target_status`, /sell/drafts, tab Phiếu tạm / Hoàn thành / Đã hủy.
- [ ] **P5** `feat(wf2-P5)` — NPP /orders: 3 tab, Xem nhanh mở rộng
      (badge cảnh báo + cột Tồn), nút Xuất hàng, in phiếu giao tách
      thành component dùng chung.
- [ ] **P6** `feat(wf2-P6)` — Đơn trả (/returns) + Phiếu thu
      (/finance/cash-receipts) gồm cấn trừ đơn trả độc lập.
- [ ] **P7** `feat(wf2-P7)` — Ẩn module luồng cũ khỏi nav (không xoá
      code), cập nhật docs hướng dẫn, checklist E2E, test mới.

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

- [ ] Chạy migration 119 + 120 trên staging, đọc `RAISE NOTICE` backfill.
- [ ] Chạy `docs/workflow-v2-checklist.md` (tạo ở P7).
- [ ] Bật lại module Giao hàng khi cần (D12) — chỉ là nav.
- [ ] Merge vào `main` sau 2 tuần đối tác chạy ổn.
- [ ] Migration 118 (dọn đơn trả khi xoá đơn) vẫn chưa chạy trên
      production — việc tồn từ trước Coder Pack này.
