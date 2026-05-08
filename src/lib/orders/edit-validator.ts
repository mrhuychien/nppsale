/**
 * T-03: Edit-while-picking validator (Pack3 spec D10).
 *
 * Pure function — no DB dependency. Caller fetches per-line picked qty
 * from v_sales_order_line_picked and feeds the proposed change shape.
 *
 * Rule matrix (D10):
 *
 *   stage: draft | pending_approval | approved
 *     - everything allowed
 *
 *   stage: picking
 *     - add new line:               OK
 *     - increase qty (any line):    OK
 *     - decrease/remove unpicked:   OK
 *     - decrease/remove picked:     BLOCKED
 *     - change UOM of picked line:  BLOCKED
 *     - change product of picked:   BLOCKED  (treated as remove+add)
 *     - change price:               OK
 *
 *   stage: delivering | collecting | handover | closed | failed | delivery_failed
 *     - all edits BLOCKED
 *
 * "picked" = picked_qty_in_base_uom > 0 for the (order_id, product_id, unit_name)
 * tuple, derived from posted/draft (non-cancelled) export stock_entry_lines that
 * reference the order via stock_entries.ref_order_ids.
 */

export type WorkflowStage =
  | "draft"
  | "pending_approval"
  | "approved"
  | "picking"
  | "delivering"
  | "collecting"
  | "handover"
  | "closed"
  | "failed"
  | "delivery_failed"

/**
 * Existing line snapshot (current DB state) + the proposed change.
 * `null` for `proposed` means "delete this line".
 * `null` for `existing` means "this is a brand-new line being added".
 */
export interface OrderLineChange {
  existing: {
    id: string
    product_id: string
    unit_name: string
    quantity: number
    /** Snapshot of conversion_factor at line creation; defaults to 1. */
    conversion_factor?: number
    /** Picked qty in base UOM for this (order_id, product_id, unit_name).
     *  Caller fills this from v_sales_order_line_picked. */
    picked_qty_in_base_uom: number
  } | null
  proposed: {
    product_id: string
    unit_name: string
    quantity: number
    /** Conversion factor for the proposed unit_name. Used to compute
     *  the would-be qty-in-base-UOM. Falls back to 1 when omitted. */
    conversion_factor?: number
  } | null
}

export interface ValidateOptions {
  stage: WorkflowStage
  changes: OrderLineChange[]
}

export interface ValidationError {
  /** existing.id when known, otherwise a synthetic key like "new-<idx>". */
  lineKey: string
  reason: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

/* Editable stages — anything beyond `picking` is fully locked. */
const EDITABLE_STAGES: WorkflowStage[] = [
  "draft",
  "pending_approval",
  "approved",
  "picking",
]

const BEYOND_PICKING_STAGES: WorkflowStage[] = [
  "delivering",
  "collecting",
  "handover",
  "closed",
  "failed",
  "delivery_failed",
]

export function isStageEditable(stage: WorkflowStage): boolean {
  return EDITABLE_STAGES.includes(stage)
}

export function isStageBeyondPicking(stage: WorkflowStage): boolean {
  return BEYOND_PICKING_STAGES.includes(stage)
}

/**
 * Run the full rule matrix on a list of line changes for one order.
 * Returns aggregate ok/errors so the caller can show all issues at once.
 */
export function validateOrderEdit(opts: ValidateOptions): ValidationResult {
  const errors: ValidationError[] = []

  // Hard block for stages beyond picking.
  if (isStageBeyondPicking(opts.stage)) {
    return {
      ok: false,
      errors: [
        {
          lineKey: "*",
          reason:
            "Đơn đã chuyển sang giao hàng — không thể sửa dòng đơn nữa.",
        },
      ],
    }
  }

  // Pre-picking stages: anything goes (draft / pending_approval / approved).
  if (opts.stage !== "picking") {
    return { ok: true, errors: [] }
  }

  // Picking-stage rule matrix.
  opts.changes.forEach((change, idx) => {
    const result = validateSingleLine(change, idx)
    if (result) errors.push(result)
  })

  return { ok: errors.length === 0, errors }
}

/** Validate one line. Returns null when ok, or a ValidationError. */
function validateSingleLine(
  change: OrderLineChange,
  idx: number
): ValidationError | null {
  const { existing, proposed } = change
  const lineKey = existing?.id ?? `new-${idx}`

  // New line being added → always allowed at picking stage.
  if (!existing && proposed) return null

  // Removing a line.
  if (existing && !proposed) {
    if (existing.picked_qty_in_base_uom > 0) {
      return {
        lineKey,
        reason: "Đã xuất kho — không thể xoá dòng đã pick.",
      }
    }
    return null
  }

  // Editing an existing line.
  if (existing && proposed) {
    const picked = existing.picked_qty_in_base_uom

    // No-op for unpicked lines: any change is fine.
    if (picked <= 0) return null

    // Picked > 0 → enforce constraints.
    // a) Cannot change product.
    if (existing.product_id !== proposed.product_id) {
      return {
        lineKey,
        reason: "Đã xuất kho — không thể đổi sản phẩm trên dòng đã pick.",
      }
    }

    // b) Cannot change UOM (unit_name).
    if (existing.unit_name !== proposed.unit_name) {
      return {
        lineKey,
        reason: "Đã xuất kho — không thể đổi đơn vị tính của dòng đã pick.",
      }
    }

    // c) Cannot reduce qty below picked qty (in base UOM).
    const proposedFactor = Number(proposed.conversion_factor ?? 1) || 1
    const proposedQtyBase = Number(proposed.quantity || 0) * proposedFactor
    if (proposedQtyBase + 1e-9 < picked) {
      return {
        lineKey,
        reason: `Đã xuất ${formatBase(picked)}, không thể giảm SL xuống dưới mức đã xuất.`,
      }
    }

    return null
  }

  return null
}

function formatBase(qty: number): string {
  // Trim trailing zeros, keep up to 3 decimals.
  return Number(qty.toFixed(3)).toString()
}

/**
 * Quick predicate for UI: is this line locked (picked > 0)?
 * Drives the 🔒 icon + readonly inputs in the order detail page.
 */
export function isLineLocked(pickedQtyInBaseUom: number): boolean {
  return pickedQtyInBaseUom > 0
}
