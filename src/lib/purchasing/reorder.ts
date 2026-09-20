/**
 * ĐỀ XUẤT ĐẶT HÀNG — so nhu cầu đang treo với tồn kho.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "So sánh giữa số lượng trên đơn hàng và
 * Tồn kho xem cần đặt những mặt hàng gì. Theo tổng, theo NCC."
 *
 * PHÉP TÍNH
 *   còn phải giao = Σ (quantity − invoiced_qty) × conversion_factor
 *   cần đặt       = max(0, còn phải giao − tồn khả dụng)
 *
 * ⚠ "CÒN PHẢI GIAO", KHÔNG PHẢI "ĐÃ ĐẶT". Cột
 *   `sales_order_lines.invoiced_qty` (migration 124) đếm phần ĐÃ XUẤT
 *   hoá đơn. Lấy `quantity` không trừ đi phần đã xuất là đề xuất đặt
 *   lại hàng vừa giao xong — và với một đơn giao làm nhiều đợt thì sai
 *   đúng bằng phần đã giao.
 *
 * ⚠ QUY VỀ ĐƠN VỊ CƠ SỞ TRƯỚC KHI TRỪ. Dòng đơn hàng ghi theo đơn vị
 *   bán (thùng), tồn kho đếm theo đơn vị cơ sở (hộp). Trừ thẳng là so
 *   "5 thùng" với "40 hộp" rồi kết luận thừa hàng.
 *
 * ⚠ CHỈ ĐƠN CÒN HIỆU LỰC. Đơn nháp chưa phải cam kết; đơn đã huỷ thì
 *   không còn nhu cầu nào. Xem `REORDER_ORDER_STATUSES`.
 */

/**
 * Trạng thái đơn được tính là NHU CẦU ĐANG TREO.
 *
 * ⚠ ĐỐI CHIẾU VỚI SÁU TRẠNG THÁI THẬT của `sales_orders`, đừng liệt kê
 * theo trí nhớ. Bỏ sót `partially_invoiced` là bỏ sót đúng nhóm đơn
 * ĐANG giao dở — nhóm cần đặt hàng nhất. Đó cũng là trạng thái từng
 * biến mất khỏi màn đơn hàng vì một danh sách gõ tay thiếu một dòng.
 *
 * ⚠ `draft` KHÔNG TÍNH: phiếu tạm chưa ai cam kết, đặt hàng theo nó là
 * ôm tồn cho một đơn có thể không bao giờ gửi.
 * `completed` / `closed` / `cancelled` cũng không: đơn đã xong hoặc đã
 * chốt thôi không giao nốt.
 */
export const REORDER_ORDER_STATUSES = ["submitted", "partially_invoiced"] as const

/** Một dòng đơn hàng, đúng những cột phép tính này cần. */
export interface DemandLine {
  product_id: string
  quantity: number | string | null
  invoiced_qty?: number | string | null
  conversion_factor?: number | string | null
}

/** Tồn khả dụng theo mặt hàng, đơn vị cơ sở. */
export type StockByProduct = Record<string, number>

export interface ReorderRow {
  product_id: string
  product_name: string
  sku: string
  base_unit: string
  supplier_id: string | null
  supplier_name: string | null
  /** Còn phải giao, đơn vị cơ sở. */
  demand: number
  /** Tồn khả dụng, đơn vị cơ sở. */
  onHand: number
  /** Cần đặt = max(0, demand − onHand). */
  need: number
}

const num = (s: number | string | null | undefined): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Phần CÒN PHẢI GIAO của một dòng đơn, quy về đơn vị cơ sở.
 *
 * ⚠ KHÔNG ĐỂ ÂM. Xuất quá số đặt là chuyện có thật (khách lấy thêm tại
 * chỗ, hoá đơn gộp); một dòng âm sẽ TRỪ vào nhu cầu của mặt hàng khác
 * khi cộng dồn, và đề xuất thiếu đi đúng chừng ấy.
 */
export function remainingOf(l: DemandLine): number {
  const left = num(l.quantity) - num(l.invoiced_qty)
  if (left <= 0) return 0
  return left * (num(l.conversion_factor) || 1)
}

/**
 * Dựng bảng đề xuất.
 *
 * ⚠ GIỮ CẢ DÒNG `need === 0`? KHÔNG. Màn này trả lời đúng một câu —
 * "cần đặt những mặt hàng gì" — nên mặt hàng đủ tồn không có chỗ ở đây.
 * Ai muốn xem toàn bộ thì đã có màn Kho hàng.
 */
export function buildReorder(
  lines: DemandLine[],
  stock: StockByProduct,
  products: Array<{
    id: string
    name: string
    sku?: string | null
    base_unit: string
    primary_supplier_id?: string | null
  }>,
  supplierNames: Record<string, string>
): ReorderRow[] {
  const demand = new Map<string, number>()
  for (const l of lines) {
    if (!l.product_id) continue
    const r = remainingOf(l)
    if (r <= 0) continue
    demand.set(l.product_id, (demand.get(l.product_id) ?? 0) + r)
  }

  const byId = new Map(products.map((p) => [p.id, p]))
  const out: ReorderRow[] = []
  for (const [productId, d] of Array.from(demand.entries())) {
    const p = byId.get(productId)
    const onHand = num(stock[productId])
    const need = Math.max(0, d - onHand)
    if (need <= 0) continue
    const supplierId = p?.primary_supplier_id ?? null
    out.push({
      product_id: productId,
      /* ⚠ MÃ ĐÃ XOÁ KHỎI DANH MỤC VẪN PHẢI HIỆN. Nhu cầu là có thật —
         giấu dòng đi là giấu mất một mặt hàng sắp thiếu. */
      product_name: p?.name ?? "Sản phẩm đã xoá",
      sku: p?.sku ?? "",
      base_unit: p?.base_unit ?? "",
      supplier_id: supplierId,
      /* ⚠ CHƯA GÁN NCC THÌ NÓI LÀ CHƯA GÁN, đừng gom vào một NCC nào. */
      supplier_name: supplierId ? supplierNames[supplierId] ?? null : null,
      demand: d,
      onHand,
      need,
    })
  }
  // Thiếu nhiều nhất lên đầu — đó là thứ phải đặt trước.
  return out.sort((a, b) => b.need - a.need || a.product_name.localeCompare(b.product_name))
}

export interface ReorderGroup {
  supplier_id: string | null
  supplier_name: string
  rows: ReorderRow[]
  need: number
}

/** Nhãn của nhóm "chưa gán NCC" — một chỗ, không rải ra JSX. */
export const NO_SUPPLIER_LABEL = "Chưa gán NCC"

/**
 * Gom theo NCC.
 *
 * ⚠ NHÓM "CHƯA GÁN NCC" ĐỨNG CUỐI, KHÔNG BỊ BỎ ĐI. Cột
 * `products.primary_supplier_id` được backfill từ phiếu nhập gần nhất
 * (migration 030), nên mã chưa từng nhập về thì nó trống. Bỏ nhóm ấy đi
 * là đề xuất đặt hàng im lặng thiếu đúng những mã mới — thứ dễ hết hàng
 * nhất.
 */
export function groupBySupplier(rows: ReorderRow[]): ReorderGroup[] {
  const map = new Map<string, ReorderGroup>()
  for (const r of rows) {
    const key = r.supplier_id ?? ""
    const cur = map.get(key)
    if (cur) {
      cur.rows.push(r)
      cur.need += r.need
    } else {
      map.set(key, {
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name ?? NO_SUPPLIER_LABEL,
        rows: [r],
        need: r.need,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.supplier_id === null) return 1
    if (b.supplier_id === null) return -1
    return b.need - a.need || a.supplier_name.localeCompare(b.supplier_name)
  })
}
