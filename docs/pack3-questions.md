# Pack3 — Open Questions / Assumptions Log

## Q1: [global] Spec table names don't match the existing schema.

**Spec assumes:**
- `orders`, `order_items`, `items`, `item_uoms`, `stock_ledger_entries`,
  `picking_session_items`, `shipments`, `customers.salesperson_id`.

**Actual schema (mig 001-038):**
- `sales_orders`, `sales_order_lines`, `products`, `product_units`,
  `stock_entries`+`stock_entry_lines` (split, not unified ledger),
  no picking_session table, `deliveries`+`delivery_lines`,
  `customers` has no `salesperson_id` (uses `customer_assignments` table).

**Assumption:** Pack3 implementation maps:
- `orders` → `sales_orders`
- `order_items` → `sales_order_lines`
- `items` → `products`
- `item_uoms` → `product_units`
- `shipments` → `deliveries`
- `stock_ledger_entries` → keep using `stock_entry_lines` for the
  ledger surface; add the new columns specified by T-01 there
  instead of inventing a new table.
- `picking_session_items` → no equivalent; we treat
  `stock_entry_lines` of a posted export entry as the "picked" facts.
  Edit-while-picking T-03 reads `stock_entry_lines` to determine
  picked qty per `sales_order_line_id`. Need a FK column added.
- `customers.salesperson_id` → derive from `customer_assignments`
  (already exists since mig 001).

**Risk:** the spec's FIFO design assumes a unified `stock_ledger_entries`
table. Splitting across `stock_entries` (header) + `stock_entry_lines`
(detail) is fine — the FIFO `source_ledger_id` references
`stock_entry_lines.id`.

## Q2: [T-04] Module "Vận hành" doesn't exist as a folder.

**Search:** no `app/(dashboard)/operations/` directory in this repo.
The sidebar may have had an "Vận hành" group historically, but it
was already collapsed into other modules.

**Assumption:** T-04 reduces to: (a) audit sidebar for any "Vận hành"
label and rename/remove it; (b) replace any `permissions.operations.*`
keys with `permissions.warehouse.*`. Skip the redirect step since
no /operations/* routes exist.

## Q3: [T-15] HR bonus tables already partially exist (mig 031).

**Existing:** `hr_monthly_bonus.tiers / per_unit_bonuses / order_milestone_tiers / kpi_metrics` (jsonb columns, mig 031).

**Spec asks:** new tables `salary_kpi_tiers`, `salary_order_count_bonus_configs`, `monthly_activity_bonuses`.

**Assumption:** keep the existing jsonb-based design (`hr_monthly_bonus`)
as the org-level config; the spec's new per-user tables are layered
on top for per-user overrides. Implementation uses both.

## Q4: [T-13] Permission system already exists differently.

**Existing:** `lib/permissions.ts` has a code-level matrix
`DEFAULT_PERMISSION_MAP` per role, and `migrations/024_permissions_features.sql`
adds feature-key permissions.

**Assumption:** Pack3 layer = per-user `user_permission_overrides` table
gates the existing role-permission resolver. The spec's
`user_has_permission(user_id, perm)` SQL function complements but does
not replace the TS resolver.

## Q5: [T-03] Add-line UI in /orders/[id] edit mode is deferred.

**Spec says:** "Đơn `picking` add SP B → save thành công, picking checklist
hiện thêm SP B"; "Save → re-create picking checklist diff (chỉ thêm SP
mới + delta SL vào checklist)".

**Current state:** The existing `linesEditMode` on `/orders/[id]` only
edits qty/price + product swap on existing lines. There is no "+ Thêm
SP" button or new-line picker.

**Assumption:** T-03 ships the validator + lock UI + DB guard trigger
first. The validator's `OrderLineChange` type already supports
`existing: null` (new line), so adding the UI later is mechanical.
The "picking checklist diff" recreation lives in the stock-out flow
(`/inventory/stock-out`) and will be re-derived from sales_order_lines
on the next pick — no code change needed there because pickList is
re-aggregated from selected orders' lines each time.

**Risk:** A picking-stage warehouse user can't add an extra SP from
the order detail page UI today. Workaround: cancel + re-pick. Track
as follow-up in a future Pack3 iteration.

## Q7: [T-07] Customer-return + unused-swap-stock sources defer to other tasks.

**Spec says:** "Tab 2 — Hàng nhận về" auto-lists items from
   1) failed orders → restocked
   2) customer returns mid-route
   3) unused swap stock (T-12)

**Current state:**
- (1) ships in T-07: pre-fills item rows from failed orders'
  sales_order_lines.
- (2) is already handled by the existing `/deliveries/[id]/settle`
  goods_handover_at/by/notes columns (mig 038) which the driver
  confirms there.
- (3) requires T-12 (swap_stock_movements). T-12 not yet landed; the
  schema column `source_type='unused_swap_stock'` is allowed by the
  CHECK constraint and the UI dropdown supports it, but no rows are
  loaded yet.

**Assumption:** T-07 ships handling for (1) only. After T-12 ships,
the handover page can be extended to query swap_stock_movements
WHERE shipment_id=this and append rows of source_type='unused_swap_
stock' with the spec-D7 "Đã đổi cho khách rồi" checkbox toggling
default destination_zone.

## Q6: [T-03] order_activity_log diff log is deferred.

**Spec says:** "Diff log lưu vào `order_activity_log` action='edit'"

**Current state:** Repo has `order_status_history` (mig 001) for
status transitions only — no per-line edit log table exists.

**Assumption:** Adding `order_activity_log` is a separate concern that
overlaps with T-05 (workflow_sessions) and isn't strictly required
for the locking semantics. T-03 ships without the diff log; if needed
later, the trigger function `enforce_picked_line_lock` is the natural
place to also INSERT into an audit table.
