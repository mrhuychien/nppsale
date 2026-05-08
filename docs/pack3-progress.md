# Pack3 — Progress Tracker

Branch: `claude/analytics-reporting-system-mmLxf` (system rule overrides spec's `feat/pack3`).
Resume: pick first unchecked task → read spec section 5 → execute per protocol section 3.2.

## Sprint 1 — P0 critical
- [x] T-01 UOM conversion fix (mig 039, lib/inventory/uom.ts, order-form snapshot, stock-out + self-deliver consume in base UOM)
- [x] T-02 FIFO costing infrastructure (mig 040 — fifo_layers + fifo_consumptions tables, fifo_consume() PL/pgSQL helper, JS lib/inventory/fifo.ts)
- [ ] T-03 Edit-while-picking + workflow stage
- [x] T-04 Bỏ module Vận hành (sidebar — Giao hàng + Trả hàng moved into "Kho vận"; no /operations/* routes existed so no redirect needed; Q2)

## Sprint 2 — Bàn giao + state persistence
- [ ] T-05 Workflow state persistence + widget "Việc đang dở"
- [ ] T-06 Hard-lock concurrency
- [ ] T-07 Driver handover (Bàn giao lại)
- [ ] T-08 Phiếu thu lái xe TT200

## Sprint 3 — Print + UI tồn kho
- [ ] T-09 Tab Tồn kho hiện tại + drill-down
- [ ] T-10 Layout buttons + In danh sách giao
- [ ] T-11 A5 nhỏ chữ + footer phiếu giao
- [ ] T-12 Phiếu xuất hàng đem đổi

## Sprint 4 — Permission + payroll
- [ ] T-13 Phân quyền per-user override
- [ ] T-14 Row-level customer
- [ ] T-15 KPI tiers + Order-count bonus + Activity bonus
- [ ] T-16 Bảng lương
- [ ] T-17 Đổi tên Chấm công + UI

## Notes for resume
- Sequential migration ts: 20260508120000+ (Pack3 starts at 039_*).
- Spec table-name → actual mapping recorded in `pack3-questions.md` Q1.
- Each commit prefixed `feat(pack3-T<id>):` for git log audit.
