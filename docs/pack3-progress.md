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
- [x] T-06 Hard-lock concurrency (mig 046 — entity_locks table with SECURITY DEFINER RPCs acquire_/heartbeat_/release_entity_lock; stale locks reaped lazily on every acquire/heartbeat at 10 min threshold (no pg_cron dependency); lib/locking/entity-lock.ts + hooks/use-entity-lock.ts state machine: idle/acquiring/mine/other/released with 60s heartbeat + Realtime subscription on entity_locks. Wired into orders/[id] linesEditMode: acquire on Sửa SL → release on Hủy/Lưu, banner shows holder name when state='other', inputs disabled, save guard rejects non-mine.)
- [~] T-07 Driver handover (Bàn giao lại) (mig 047 — driver_handovers + _failed_orders + _items + confirm_driver_handover RPC: atomic restock via stock_entries+stock_entry_lines+batches+fifo_layers, flips failed orders to status=cancelled / current_workflow_stage=delivery_failed, auto-closes workflow_session for the delivery. lib/handover/confirm.ts wrapper. Page /deliveries/[id]/handover with 2 sections (failed orders + received goods), entry-point Button on /settle. customer_return source uses existing settle goods_handover flow; unused_swap_stock source is wired to UI but empty until T-12 lands — Q7.)
- [~] T-08 Phiếu thu lái xe TT200 (component PaymentReceiptTT200 + numberToVietnameseWords helper). Wiring into /deliveries/[id]/settle "In phiếu thu" button deferred — caller can render the component anywhere.

## Sprint 3 — Print + UI tồn kho
- [x] T-09 Tab Tồn kho hiện tại + drill-down (mig 048 — v_stock_balance_by_zone view (per product × zone qty + FIFO-valued cost) + v_stock_movements view (signed base UOM, decorated with entry meta). components/inventory/stock-balance-table.tsx (pivoted wide table: SKU | name | sale qty/value | date qty/value | totals + tfoot grand totals + search + "chỉ hiện hàng còn tồn" filter). components/inventory/stock-history-drawer.tsx (Sheet with zone + date filters, running balance per zone, link to source entry). Mounted on existing /inventory "Tồn kho hiện tại" tab.)
- [x] T-10 Layout buttons + In danh sách giao (components/printing/driver-list.tsx — A5 portrait per-driver section grouped by driverName, blank "thực thu" column for driver fill-in, signatures block. globals.css adds .print-driver-list-only + html[data-print-mode='driver-list'] toggle. inventory/entries/[id]: PrintButton kept for "In phiếu xuất & giao hàng", new "In danh sách giao" button next to it which sets data-print-mode and calls window.print(). The "Tự giao hàng & thu tiền" button already exists in the side card from prior work.)
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
