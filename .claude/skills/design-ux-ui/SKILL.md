---
name: design-ux-ui
description: |
  npp.sale UI/UX patterns. Use whenever editing /src/app/**, /src/components/**,
  Tailwind classes, print layouts, shadcn/ui primitives, or anything user-
  facing in this codebase. Keeps Pack3+ work visually + interactionally
  consistent with what's already shipped.
---

# npp.sale — UI/UX skill

This file is the source of truth for every UI decision in this repo.
When in doubt, follow what's here. When the spec contradicts what's
here, the spec wins for that one feature; this file should then be
amended in the same PR.

## 0. Stack you must use

| Concern | Tool | Notes |
|---|---|---|
| Components | shadcn/ui (`@/components/ui/*`) | Card, Table, Button, Input, Label, Badge, Dialog, Sheet, Select, Checkbox, Skeleton, Textarea, Tabs |
| Icons | `lucide-react` | Pre-imported set; don't add Heroicons / Phosphor |
| Layout | Tailwind utility classes | No new CSS files (except print rules in globals.css) |
| Forms | Plain `useState` + Supabase RPC. No react-hook-form / zod yet | Adopt only if a feature actually needs schema validation |
| Server data | Direct `createClient()` from `@/lib/supabase/client` | No SWR / TanStack Query wrappers in use |
| Currency | `formatCurrency(n)` from `@/lib/utils` | VND, dấu chấm hàng nghìn, no decimals |
| Date | `formatDate(d)` from `@/lib/utils` | vi-VN, Asia/Ho_Chi_Minh |
| Number → Vietnamese | `numberToVietnameseWords()` from `@/lib/utils/number-to-vn-words` | Phiếu thu, payslip |

## 1. Color tokens (semantic, never literal)

Use the role tokens. Hard-coded colors like `bg-blue-600` are reserved
for explicit "self-deliver / primary action" buttons (T-10) and one or
two highlight cases. Default to the semantic set:

> **Palette refresh (2026-07):** primary brightened to `#2563eb`
> (`--primary: 222 83% 53%`), base `--radius` bumped to `0.75rem`, and
> card/overlay shadows softened. Values still live in `globals.css` +
> `tailwind.config.ts` under the same token names — keep using the
> semantic tokens, don't re-hardcode the old navy `#003d9b`. Auth/hero
> surfaces use `.bg-gradient-primary` + `.bg-brand-mesh` + `shadow-brand`.

- `bg-card` / `border` — neutral container
- `bg-muted/30` / `bg-muted/40` — table headers, secondary surfaces
- `bg-primary` / `text-primary-foreground` — primary CTA
- `bg-secondary` — secondary CTA
- `bg-destructive` / `text-destructive` — delete, danger, overdue debt
- `text-muted-foreground` — tertiary/helper text
- Badge variants: `default | secondary | success | warning | danger`

Locked / picked rows use **amber** (`text-amber-600`, `border-amber-300`)
— never red. Red = hard error.

## 2. Layout grammar

- **Page root:** `<div className="space-y-4">` for vertical rhythm.
- **Two-column page:** `grid gap-4 lg:grid-cols-3` with main `lg:col-span-2`
  + side rail. Side rail is `<aside className="space-y-4 lg:sticky lg:top-4 self-start">`
  for action panels.
- **Mobile:** assume mobile-first. Phone use cases for warehouse / driver
  are real users. Tap targets **≥ 44px** (WCAG 2.5.5 — 36px was the old
  number here and it is what produced 107 sub-44px targets on `/orders`
  alone). `lg:hidden` card lists for tables whose desktop view doesn't fit
  narrow screens — see §2b.
- **PageHeader** with `title`, `description`, `backHref` is the standard
  page header. Children = badges + secondary actions.

## 2b. Mobile — chrome, primitives, and the rules that produced them

Everything here comes from measuring the running app on a real phone
(iPhone UA, viewport 317×691, role `sales`), not from taste.

### Chrome heights live in ONE place

`globals.css` `:root` owns `--app-bar-h`, `--bottom-nav-h`,
`--action-bar-h`, `--safe-b`, `--safe-t`, `--content-pad-b`. Never write a
chrome height as a literal. Three files once held three different numbers
(88px, 7rem, 10rem) while the real nav was 103px, and the order form's
total bar sat under the nav — hiding the "Tạo đơn hàng" button.

Use the utilities, not arithmetic:

| Need | Class |
|---|---|
| Bottom padding under a fixed nav | `.pb-nav` |
| …plus a sticky action bar | `.pb-nav-action` |
| Anchor a bar just above the nav | `.bottom-above-nav` |
| Anchor a bar just below the app bar | `.top-below-appbar` |
| Safe-area padding | `.pb-safe` / `.pt-safe` |
| 44px minimum hit area | `.tap` |
| Horizontal chip row | `.row-scroll` |

`viewport-fit=cover` in `layout.tsx` is load-bearing: without it every
`env(safe-area-inset-*)` returns 0 and all of the above silently
under-pad. Never set `maximumScale: 1` or `userScalable: false` — older
reps pinch-zoom to read price lists.

### Shared mobile primitives — use these, don't re-roll

| Component | Use for |
|---|---|
| `MobileFilterBar` | search + filter sheet on any list screen |
| `SegmentedScroller` | one scrolling chip row instead of wrapping chip grids |
| `MobileRecordCard` | list rows: title + **money** on line 1, badges line 2 |
| `LoadMore` | replaces arrow pagination on mobile |
| `QtyStepper` | any quantity field (44px, selects on focus) |
| `StickyActionBar` | the one primary action of a screen |
| `ProductPickerSheet` | picking from a long catalogue |

### Rules with a measured reason behind them

1. **Money goes on the first line of a card, right-aligned.** It is what
   reps scan for; buried in row four they read the whole card.
2. **Card actions live OUTSIDE the main tap area.** Inside, tapping the
   button also opens the record.
3. **Text inputs are `text-base` (16px).** iOS zooms the page on focus for
   anything smaller and does not zoom back out.
4. **Never `type="number"` for quantities or money.** iOS shows a keypad
   with `.` and `e`, and scrolling changes the value. Use
   `type="text" inputMode="numeric"`, or `MoneyInput` for money —
   `type="number"` also refuses to group thousands, so `12400000` is
   uncountable at a glance.
5. **`max` on an input does not stop typed input.** Validate in the submit
   handler AND disable the button with the reason in `title`.
6. **Sticky bars must carry `kb-hide`.** The virtual keyboard pushes
   bottom-fixed bars over the field being typed in. `dashboard-shell`
   sets `body.kb-open` from `useKeyboardOpen()`; detect with
   `visualViewport`, never `window.innerHeight` (unchanged on iOS).
7. **Selection mode beats per-row checkboxes.** A "Chọn" button or a
   500ms long-press; long-press timers belong in a `ref`, and must cancel
   on `touchmove` or scrolling triggers them.
8. **One chip row, not two.** Merge secondary status chips into the same
   `SegmentedScroller`; route by key.
9. **A hidden filter must still show its count.** Badge the filter button,
   otherwise hiding filters hides state.
10. **`AbortError` is not an error.** Fast navigation cancels requests;
    `selectResilient` returns `aborted` — return early rather than
    painting a red banner and blanking the list.
11. **One-time hints are dismissible and remembered** (`localStorage`),
    initialised `false` and enabled in an effect — reading storage during
    the first render is a hydration mismatch.

## 3. Tables

- Always wrap in `<div className="overflow-x-auto rounded-xl border bg-card">`.
- Header rows: `bg-muted/30` + `text-xs uppercase text-muted-foreground`.
- Numeric cells: `text-right tabular-nums`.
- Currency cells: `text-right tabular-nums` + `formatCurrency(n)`.
- Hover state on clickable rows: `cursor-pointer hover:bg-muted/40`.
- Empty state: a single `<TableRow>` colspan-all with muted text, never
  blank. Drill-downs use `<Sheet side="right" className="sm:max-w-3xl">`.

## 4. Forms

- Use `<Label className="text-xs uppercase tracking-wider text-muted-foreground">`
  above every input.
- Number inputs: always `step="any"` + `min={0}` (or `min={pickedQty}`
  when locked).
- Currency input: existing `<MoneyInput>` if it covers the case; else
  `<Input type="number">` with helper text.
- **Tri-state selects** beat checkbox-with-extra-button when a value
  has 3 meanings (e.g. permissions: Theo vai trò / Cấp / Thu hồi).
- Save button states: idle / loading / disabled with reason in `title`.
  Disable + tooltip is more discoverable than hide.
- Dirty tracking: track pending edits in a separate Map; show a save
  button only on rows with pending changes.

## 5. Locks, badges, status

- Show lock state inline next to the locked field with a `<Lock>` icon
  + amber tint. Tooltip explains the reason ("Đã pick X — không thể
  giảm SL, đổi UOM…").
- Pessimistic edit lock (T-06): banner red `🔒 [Tên] đang sửa…`,
  inputs `disabled`, save button gated on `lock.state === 'mine'`.
- Stage badges: use the spec's lowercase enum string (`picking`,
  `delivering`…) but display via a label map in vi-VN.

## 6. Print

This codebase has 4 print modes, all toggled via
`html[data-print-mode="<key>"]` + a matching `.print-<key>-only`
section in `src/app/globals.css`:

| Mode | CSS class | Renders |
|---|---|---|
| (default) | `.print-only` | The main slip / per-order delivery slips |
| `driver-list` | `.print-driver-list-only` | A5 danh sách giao |
| `receipt-tt200` | `.print-receipt-tt200-only` | Phiếu thu mẫu 01-TT |
| `payslip` | `.print-payslip-only` | Per-user A5 phiếu lương |

Pattern for adding a new print mode:

```ts
const html = document.documentElement
html.setAttribute("data-print-mode", "<your-key>")
requestAnimationFrame(() => {
  window.print()
  setTimeout(() => html.removeAttribute("data-print-mode"), 200)
})
```

Add a CSS rule in globals.css inside the `@media print` block:

```css
html[data-print-mode="<your-key>"] .print-only { display: none !important; }
html[data-print-mode="<your-key>"] .print-<your-key>-only { display: block !important; }
```

A5 portrait is the **default print size** (driver-friendly). A4 is
opt-in via the `<PrintButton>`'s dropdown which sets
`data-paper-size="A4"` on `<html>`. Layouts must be readable at 8pt
Times New Roman (`.a5-doc` class enforces this — apply to the wrapper).

UOM display on print: when `conversion_factor_snapshot > 1`, render
`{txQty} {unit_name} ({baseQty} {base_unit})` — e.g. "4 thùng (40 hộp)".

## 7. Vietnamese language conventions

- Currency: `formatCurrency(480000)` → `480.000` (no "đ" / "₫" suffix
  unless on a print slip where it's `VNĐ`).
- Quantities with units: `4 thùng`, `40 hộp`. Plural = singular in vi.
- Dates: dd/MM/yyyy (`formatDate`). Times: `HH:mm` 24-hour.
- Stage / status labels: define in a `labelXxx()` helper next to the
  enum, never hard-code in JSX.
- Action verbs short: "Lưu", "Huỷ", "Sửa", "Xoá", "Tiếp tục →",
  "Bàn giao lại", "Thu tiền". Avoid English mix.

## 8. Loading + empty states

- Loading: `<Skeleton className="h-X" />` (no spinners). Match the
  rendered area's height to avoid layout shift.
- Empty: card / table-row with muted text + the most useful next-action
  link ("Bấm Tính lại để khởi tạo dòng nhân sự."). Never blank.

## 9. Anti-patterns — **don't do these**

- ❌ Custom hex colors. Use semantic tokens.
- ❌ New CSS files. Tailwind only.
- ❌ Toast as the only error feedback when the form already has space
  for inline guidance. Use both: toast for one-off action result,
  inline for validation.
- ❌ `confirm()` for non-destructive actions. Use the existing
  `<ConfirmDialog>` only for delete / lock / void operations.
- ❌ Multi-paragraph comments above components. One short line max.
- ❌ Emoji icons in code (apart from the ones the spec explicitly uses
  for headers like "📄 IN PHIẾU XUẤT"). Use lucide-react.
- ❌ `any` types in event handlers. Type the row + use `as`.
- ❌ Re-rendering the entire page after a single-row edit. Locally
  patch state; reload only when relationships change (lines added/
  removed, status flipped).

## 10. Pre-flight checklist before claiming UI work done

For every UI change, verify in this order:

1. `npx tsc --noEmit` — clean.
2. `npx next lint --dir <touched-dir>` — clean (ignore the
   pre-existing `no-page-custom-font` warning in `src/app/layout.tsx`).
3. Mobile width 375px renders without horizontal scroll on the main
   content (use Chrome DevTools device toolbar).
4. Print preview at A5 portrait fits 1 page for the canonical case
   (e.g. 25-line order on phiếu giao).
5. Vietnamese diacritics render correctly (no UTF-8 issues in print).
6. Locked / readonly states are visually distinct from active.
7. Empty + loading + error states all designed (not just success).
8. The screen has at least one explicit "next action" — never a
   dead end.

## 11. When extending Pack3

- New tables: name `pack3_*` only if Pack3-specific. Otherwise use the
  established singular-noun pattern (`payroll_runs`, `entity_locks`).
- New views: prefix `v_*` (per existing convention).
- New migrations: next number after `054_*`. RLS = `public.user_org_id()`
  helper. Mutations via `SECURITY DEFINER` RPC when the trigger surface
  must be tight.
- New skill keys for permissions: add to the `PACK3_SPEC_GROUPS`
  catalog in `/settings/users/[id]/permissions` so the override is
  toggleable in UI, not just at SQL level.
- New print modes: use the `data-print-mode` pattern (section 6).
- New workflow stages: add to the enum on `sales_orders.current_workflow_stage`
  via migration + the `WorkflowStage` union in
  `lib/orders/edit-validator.ts`. Update label maps.

## 12. Files / locations cheat sheet

| Need | Where |
|---|---|
| Add a UI page | `src/app/(dashboard)/<feature>/page.tsx` |
| Add reusable component | `src/components/<feature>/<kebab>.tsx` |
| Add print component | `src/components/printing/<kebab>.tsx` |
| Add lib helper | `src/lib/<feature>/<kebab>.ts` |
| Add hook | `src/hooks/use-<kebab>.ts` |
| Add migration | `supabase/migrations/NNN_<snake>.sql` |
| Add type | `src/types/index.ts` (single barrel file) |
| Add print CSS rule | `src/app/globals.css` inside `@media print` block |
| Add labels map | inline next to the enum, function `labelXxx()` |
| Tweak status flow | `STATUS_FLOW` map in `/orders/[id]/page.tsx` |
