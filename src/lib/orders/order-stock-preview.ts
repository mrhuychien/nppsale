/**
 * Xem trước TỒN KHO của một đơn, trước khi nhà phân phối bấm Xuất hàng.
 *
 * ⚠ MỤC ĐÍCH DUY NHẤT: nói ĐÚNG thứ `complete_order` sắp trừ. Không phải
 * "một phép kiểm tồn nói chung" — nếu con số ở đây lệch với phép trừ của
 * RPC thì nó còn tệ hơn không có: màn báo đủ rồi RPC ném lỗi, hoặc màn
 * báo thiếu cho một đơn xuất được ngon lành, và nhà phân phối mất niềm
 * tin vào cột này sau đúng hai lần.
 *
 * Vì thế mọi lựa chọn dưới đây đều bám theo mã của RPC, không theo thói
 * quen của các màn khác:
 *
 * 1. NGUỒN TỒN là bảng `batches`, lọc ĐÚNG `qty_on_hand > 0`. RPC
 *    (`post_stock_export`, migration 119) chỉ lọc org + sản phẩm + còn
 *    tồn; nó KHÔNG lọc theo khu vực kho, KHÔNG lọc theo hạn dùng. Thêm
 *    bất kỳ điều kiện nào cho "chặt chẽ" là cột này nói khác RPC.
 *
 * 2. ĐƠN VỊ là ĐƠN VỊ CƠ SỞ. `qty_on_hand` ghi theo đơn vị cơ sở; dòng
 *    đơn ghi theo đơn vị bán. So thẳng "4 thùng" với "tồn 40 hộp" ra
 *    "4 ≤ 40 → đủ", trong khi thật ra cần 48 > 40.
 *
 * 3. HỆ SỐ QUY ĐỔI lấy từ `sales_order_lines.conversion_factor` — ảnh
 *    chụp lúc tạo đơn (migration 039) — chứ KHÔNG tra danh mục. RPC dùng
 *    đúng cột đó. Tra danh mục thì chạy đúng ở hầu hết đơn nhưng lệch ở
 *    những đơn có quy cách đóng gói đã đổi từ lúc tạo — mà đó là đơn CŨ,
 *    tức đơn nằm lâu trong Phiếu tạm, tức đơn hay được mở ra xem nhất.
 *
 * 4. CỘNG CẢ HÀNG ĐỔI của phiếu trả còn NHÁP. `complete_order` gộp chúng
 *    vào cùng lệnh xuất kho (khách đổi hàng thì hàng mới cũng rời kho
 *    trong chính chuyến này). Bỏ qua là đơn 8 thùng bán + 2 thùng đổi
 *    trên tồn 9 thùng hiện màu xanh, rồi RPC ném lỗi.
 *    ⚠ CHỈ phiếu `draft`. Chính `complete_order` đẩy chúng sang
 *    `submitted` ngay sau khi xuất, nên đếm cả `submitted` là trừ hai lần
 *    cho một lần đổi hàng.
 *    ⚠ Dòng trả KHÔNG có cột hệ số — phải tra `product_units.conversion`,
 *    fallback 1, y như RPC làm.
 *
 * 5. NHIỀU DÒNG CÙNG MỘT SẢN PHẨM phải cộng lại rồi mới so. Hai dòng mỗi
 *    dòng 6 thùng trên tồn 10 thùng thì từng dòng đều "hợp lệ".
 */

export interface StockPreviewLine {
  productId: string
  /** Số lượng theo đơn vị bán, đúng như trên dòng đơn. */
  quantity: number
  /** Ảnh chụp hệ số lúc tạo đơn. Thiếu thì coi như 1 — y như RPC. */
  conversionFactor: number | null | undefined
}

export interface StockPreviewRow {
  productId: string
  /** Tổng nhu cầu của sản phẩm này, theo ĐƠN VỊ CƠ SỞ. */
  needBase: number
  /** Tồn hiện có, theo ĐƠN VỊ CƠ SỞ. */
  onHandBase: number
  /** Thiếu bao nhiêu (đơn vị cơ sở). 0 = đủ. */
  shortBase: number
}

const baseOf = (l: StockPreviewLine): number =>
  (Number(l.quantity) || 0) * (Number(l.conversionFactor) || 1)

/**
 * Gộp nhu cầu theo sản phẩm rồi đối chiếu với tồn.
 *
 * `saleLines` là dòng bán; `exchangeLines` là dòng ĐỔI của phiếu trả còn
 * nháp — hai nhóm khác nhau ở chỗ lấy hệ số, nhưng cùng rời kho.
 */
export function previewOrderStock(
  saleLines: StockPreviewLine[],
  exchangeLines: StockPreviewLine[],
  onHandByProduct: Record<string, number>
): StockPreviewRow[] {
  const need: Record<string, number> = {}
  for (const l of [...saleLines, ...exchangeLines]) {
    if (!l.productId) continue
    need[l.productId] = (need[l.productId] || 0) + baseOf(l)
  }
  return Object.entries(need).map(([productId, needBase]) => {
    const onHandBase = Number(onHandByProduct[productId] ?? 0)
    return {
      productId,
      needBase,
      onHandBase,
      shortBase: Math.max(0, needBase - onHandBase),
    }
  })
}

/** Tổng thiếu của cả đơn, theo đơn vị cơ sở — cùng thang với `short_qty`. */
export function totalShortBase(rows: StockPreviewRow[]): number {
  return rows.reduce((s, r) => s + r.shortBase, 0)
}

/**
 * Tách `approval_reason` thành từng cảnh báo rời để vẽ huy hiệu.
 *
 * ⚠ ĐƠN SẠCH MANG CHUỖI RỖNG, KHÔNG PHẢI NULL (xem `decideStatus`). Tách
 * chuỗi rỗng ra là được một mảnh rỗng, tức một huy hiệu trắng trơn không
 * ai hiểu là gì.
 *
 * ⚠ Không phải chuỗi nào cũng là nhiều lý do ghép lại. Ba câu cố định —
 * "Lưu nháp — chưa gửi duyệt", "Không đọc được công nợ / quy tắc…",
 * "Tạo offline — …" — đi đường khác và không chứa dấu tách, nên ra đúng
 * một mảnh. Đó là hành vi đúng, đừng cố cắt nhỏ thêm.
 */
export function splitWarnings(reason: string | null | undefined): string[] {
  const s = (reason ?? "").trim()
  if (!s) return []
  return s
    .split(" • ")
    .map((x) => x.trim())
    .filter(Boolean)
}
