/**
 * Dựng PHIẾU NHẬP TỒN ĐẦU KỲ từ file Excel sản phẩm.
 *
 * Vì sao gắn vào màn nhập sản phẩm chứ không làm màn riêng: lúc bàn giao,
 * NPP có đúng MỘT file — danh mục hàng kèm tồn và giá vốn, xuất từ phần
 * mềm cũ. Bắt họ nhập danh mục ở một chỗ rồi gõ tay từng dòng tồn ở chỗ
 * khác là bắt làm hai lần cùng một việc, và lần thứ hai thì vài trăm dòng.
 *
 * Mọi thứ ở đây là hàm THUẦN. Phần chạm cơ sở dữ liệu nằm ở dialog; tách
 * ra để kiểm được phép tính mà không cần dựng Supabase giả.
 */

import { postedAtFor } from "@/lib/inventory/opening-stock"

/** Một dòng tồn đầu kỳ, đã khớp được với sản phẩm vừa tạo. */
export interface OpeningStockLine {
  productId: string
  sku: string
  name: string
  /** Theo ĐƠN VỊ TÍNH của sản phẩm — cũng là đơn vị cơ bản. */
  qty: number
  unitCost: number
  /** false = file không khai giá vốn. Ghi 0 nhưng phải nói ra. */
  costKnown: boolean
}

export interface OpeningStockPlan {
  lines: OpeningStockLine[]
  totalQty: number
  totalValue: number
  /** Tên sản phẩm có tồn nhưng KHÔNG có giá vốn. */
  missingCost: string[]
  /** Dòng có tồn nhưng không tra ra sản phẩm (SKU trùng nên bị bỏ qua). */
  unmatched: number
}

type PlanRow = {
  sku: string
  name: string
  opening_qty: number
  cost_price: number
}

/**
 * Ghép các dòng có tồn > 0 với sản phẩm vừa tạo.
 *
 * ⚠ `idBySku` chỉ chứa sản phẩm THỰC SỰ vừa được tạo. Dòng có SKU trùng
 * với hàng đã có trong hệ thống đã bị bỏ qua từ trước — nếu vẫn dựng phiếu
 * cho nó thì tồn đầu kỳ sẽ cộng thêm vào một mặt hàng đang có tồn thật,
 * tức là tự nhân đôi kho. Những dòng đó đếm vào `unmatched` để nói ra.
 */
export function planOpeningStock(
  rows: PlanRow[],
  idBySku: Record<string, string>
): OpeningStockPlan {
  const lines: OpeningStockLine[] = []
  const missingCost: string[] = []
  let unmatched = 0

  for (const r of rows) {
    const qty = Number(r.opening_qty) || 0
    if (qty <= 0) continue
    const productId = idBySku[r.sku]
    if (!productId) {
      unmatched++
      continue
    }
    const cost = Number(r.cost_price) || 0
    const costKnown = cost > 0
    if (!costKnown) missingCost.push(r.name)
    lines.push({ productId, sku: r.sku, name: r.name, qty, unitCost: cost, costKnown })
  }

  return {
    lines,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalValue: lines.reduce((s, l) => s + l.qty * l.unitCost, 0),
    missingCost,
    unmatched,
  }
}

/**
 * Mã phiếu tồn đầu kỳ. `DK` để phân biệt với phiếu nhập hằng ngày (`IN-`)
 * ngay trên danh sách, không phải mở ra mới biết.
 *
 * `stock_entries.entry_code` KHÔNG có ràng buộc duy nhất, nên phần ngẫu
 * nhiên không phải để chống trùng ở tầng cơ sở dữ liệu — nó chỉ để hai
 * lần nhập trong cùng một ngày không mang cùng một mã trên màn hình.
 */
export function openingEntryCode(entryDate: string, rand: number): string {
  const d = String(entryDate ?? "").replace(/-/g, "") || "00000000"
  const n = Math.floor(1000 + (Number.isFinite(rand) ? rand : 0) * 9000)
  return `DK-${d}-${n}`
}

/** Hạn dùng khi file không khai: xa hẳn, nghĩa là "không khai hạn". */
export const NO_EXPIRY = "2099-12-31"

export interface OpeningEntryPayload {
  entry: {
    org_id: string
    entry_code: string
    type: "import"
    status: "posted"
    posted_at: string
    created_by: string
    notes: string
  }
  batches: Array<{
    org_id: string
    product_id: string
    batch_code: string
    expires_at: string
    qty_initial: number
    qty_on_hand: number
    unit_cost: number
    /** Khoá thứ tự FIFO (mig 107) — bằng đúng ngày ghi sổ của phiếu. */
    received_at: string
  }>
}

/**
 * Dựng payload để ghi xuống. Lô hàng KHÔNG khai hạn dùng: file danh mục
 * không có hạn dùng của từng lô, và đoán ra một cái hạn là dựng số liệu
 * chưa từng có — trong khi hạn dùng lại là thứ quyết định lô nào xuất
 * trước. Để `2099-12-31` nghĩa là "chưa khai", và người dùng sửa lại từng
 * lô sau nếu cần.
 */
export function buildOpeningEntry(opts: {
  orgId: string
  userId: string
  entryDate: string
  now: Date
  rand: number
  lines: OpeningStockLine[]
}): OpeningEntryPayload {
  const code = openingEntryCode(opts.entryDate, opts.rand)
  // MỘT mốc cho cả phiếu lẫn mọi lô của nó.
  //
  // ⚠ Hàng tồn đầu kỳ là hàng CŨ NHẤT trong kho, nên phải đứng ĐẦU hàng
  // đợi FIFO. Nếu lô mang mốc "lúc tạo dòng" (hôm nay) thì nó xếp sau cả
  // hàng nhập trong tuần, và FIFO lấy ngược — hàng cũ nhất nằm lại trong
  // kho mãi mãi.
  const postedAt = postedAtFor(opts.entryDate, opts.now)
  return {
    entry: {
      org_id: opts.orgId,
      entry_code: code,
      type: "import",
      status: "posted",
      posted_at: postedAt,
      created_by: opts.userId,
      notes: `Tồn kho đầu kỳ — nhập từ file Excel sản phẩm (${opts.lines.length} mặt hàng)`,
    },
    batches: opts.lines.map((l, i) => ({
      org_id: opts.orgId,
      product_id: l.productId,
      batch_code: `LOT-${code}-${i + 1}`,
      expires_at: NO_EXPIRY,
      qty_initial: l.qty,
      qty_on_hand: l.qty,
      unit_cost: l.unitCost,
      received_at: postedAt,
    })),
  }
}

/**
 * Ai được ghi phiếu tồn đầu kỳ.
 *
 * ⚠ Hai quyền KHÔNG trùng nhau: sản phẩm là của owner/manager (RLS mig
 * 002), còn kho là của owner/warehouse. Giao nhau chỉ còn OWNER. Tài
 * khoản Quản lý nhập được danh mục nhưng ghi kho sẽ bị RLS chặn — và lỗi
 * RLS trả về thì không nói được gì cho người dùng. Chặn trước để nói
 * đúng chuyện đang xảy ra.
 */
export function canPostOpeningStock(role: string | null | undefined): boolean {
  return role === "owner"
}
