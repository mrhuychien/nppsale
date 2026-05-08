# Pack3 — Progress Tracker

Branch: `claude/analytics-reporting-system-mmLxf` (system rule overrides spec's `feat/pack3`).
Resume: pick first unchecked task → read spec section 5 → execute per protocol section 3.2.

## Sprint 1 — P0 critical
- [x] T-01 UOM conversion fix (mig 039, lib/inventory/uom.ts, order-form snapshot, stock-out + self-deliver consume in base UOM)
- [x] T-02 FIFO costing infrastructure (mig 040 — fifo_layers + fifo_consumptions tables, fifo_consume() PL/pgSQL helper, JS lib/inventory/fifo.ts)
- [~] T-03 Edit-while-picking + workflow stage (mig 044 — sales_orders.current_workflow_stage + status sync trigger; v_sales_order_line_picked view; enforce_picked_line_lock() server-side trigger; lib/orders/edit-validator.ts pure validator; orders/[id]/page.tsx wires validator into saveLineEdits + 🔒 lock icon + qty min on picked rows + disabled "Đổi SP" on picked rows; banner explains rules in picking stage). Add-line UI ("+ Thêm SP") in detail-page edit mode deferred — validator already supports new lines so wiring is mechanical (Q5).
- [x] T-04 Bỏ module Vận hành (sidebar — Giao hàng + Trả hàng moved into "Kho vận"; no /operations/* routes existed so no redirect needed; Q2)

## Sprint 2 — Bàn giao + state persistence
- [x] T-05 Workflow state persistence + widget "Việc đang dở" (mig 045 — workflow_sessions table + RLS + auto-bump trigger; lib/workflow/sessions.ts client helpers; hooks/use-workflow-session.ts with debounced draft + localStorage mirror; components/dashboard/pending-work-widget.tsx; mounted on /dashboard. Hooked into /inventory/stock-out/collect/[entryId] and /deliveries/[id]/settle as canonical "đang dở" pages — additional pages can opt in by calling `useWorkflowSession`)
- [ ] T-06 Hard-lock concurrency
- [ ] T-07 Driver handover (Bàn giao lại)
- [~] T-08 Phiếu thu lái xe TT200 (component PaymentReceiptTT200 + numberToVietnameseWords helper). Wiring into /deliveries/[id]/settle "In phiếu thu" button deferred — caller can render the component anywhere.

## Sprint 3 — Print + UI tồn kho
- [ ] T-09 Tab Tồn kho hiện tại + drill-down
- [ ] T-10 Layout buttons + In danh sách giao
- [~] T-11 A5 nhỏ chữ (globals.css 8pt Times on A5; .a5-doc class hooks for printing/payment-receipt-tt200). Footer subtotal/VAT/total in delivery slip already exists from prior work — no further change needed.
- [ ] T-12 Phiếu xuất hàng đem đổi

## Sprint 4 — Permission + payroll
- [~] T-13 Phân quyền per-user override (mig 041 — table + resolver fn). Settings UI page deferred (existing /settings/permissions covers role matrix; per-user override UI to add later)
- [x] T-14 Row-level customer (mig 042 — unified RLS for customers + sales_orders honors customer_assignments + customer.view_all override)
- [~] T-15 KPI tiers + Order-count bonus + Activity bonus (mig 043 — 3 per-user tables; lib/payroll/bonus.ts compute helpers). Settings UI to edit per-user values deferred
- [ ] T-16 Bảng lương
- [x] T-17 Đổi tên Chấm công (sidebar label "Tổng quan nhân sự" → "Chấm công" pointing to /hr/attendance which already exists)

## Notes for resume
- Sequential migration ts: 20260508120000+ (Pack3 starts at 039_*).
- Spec table-name → actual mapping recorded in `pack3-questions.md` Q1.
- Each commit prefixed `feat(pack3-T<id>):` for git log audit.
