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
- [ ] **P1** `feat(wf2-P1)` — Migration 119: cột mới, CHECK status mới,
      backfill, bỏ workflow_stage trigger + khoá dòng đã pick, RLS viết
      lại, `is_revenue_status` = `completed`, cascade SQL (mục 2.11).
- [ ] **P2** `feat(wf2-P2)` — Migration 120: 4 helper `_wf2_*` + 7 RPC
      (`complete_order`, `edit_completed_order`, `cancel_order`,
      `complete_return`, `cancel_return`, `create_cash_receipt`,
      `void_cash_receipt`) + grants.
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
