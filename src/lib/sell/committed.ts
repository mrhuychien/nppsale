/**
 * HÀNG ĐÃ ĐẶT NHƯNG CHƯA RỜI KHO — phần tính thuần.
 *
 * Kho chỉ bị trừ lúc Xuất hàng (`post_invoice`). Từ lúc nhân viên gửi
 * Phiếu tạm tới lúc xuất, số trong `batches` vẫn nguyên — nên màn bán
 * hàng đọc "Tồn 2.838" và ba người cùng bán hết 2.838 ấy trong một buổi
 * sáng. Con số phải đem ra so khi soạn đơn là KHẢ DỤNG = tồn − đã đặt.
 *
 * ⚠ SỐ ĐÃ ĐẶT PHẢI ĐẾN TỪ DATABASE, KHÔNG CỘNG Ở TRÌNH DUYỆT. RLS cho
 * vai trò `sales` chỉ thấy đơn của chính mình (002_rls_policies.sql:286),
 * nên cộng ở đây là mỗi nhân viên chỉ trừ phần mình đã hứa — đúng cái lỗ
 * hổng cần bịt vẫn còn nguyên. Xem `committed_stock_by_product` (mig 136).
 */

/** Trạng thái đọc số đã đặt. `null` = CHƯA/KHÔNG đọc được. */
export type CommittedMap = Record<string, number> | null

/**
 * Tồn khả dụng theo sản phẩm = tồn kho − đã đặt.
 *
 * ⚠ KHÔNG CHẶN Ở 0. Âm nghĩa là đã hứa nhiều hơn số đang có — chuyện có
 * thật khi đơn vị bật "cho phép bán vượt tồn", hoặc khi hàng vừa hỏng.
 * Kẹp về 0 là giấu mất mức độ thiếu, và màn hình sẽ nói "còn 0" cho cả
 * trường hợp vừa vặn lẫn trường hợp thiếu 500 thùng.
 *
 * ⚠ CHƯA ĐỌC ĐƯỢC SỐ ĐÃ ĐẶT THÌ TRẢ VỀ ĐÚNG TỒN KHO. Coi như 0 đã đặt là
 * lựa chọn có chủ ý: chặn nhầm một đơn hợp lệ khiến nhân viên đứng ở quầy
 * không lưu được đơn, còn chốt chặn thật vẫn nằm ở `post_invoice` — nơi
 * kho được khoá và trừ trong cùng một giao dịch. Nhưng màn hình PHẢI nói
 * ra là nó đang thiếu số, chứ không im lặng.
 */
export function availableMapFrom(
  stockByProduct: Record<string, number>,
  committed: CommittedMap
): Record<string, number> {
  if (!committed) return stockByProduct
  const out: Record<string, number> = { ...stockByProduct }
  for (const pid of Object.keys(committed)) {
    out[pid] = (stockByProduct[pid] ?? 0) - (committed[pid] || 0)
  }
  return out
}

/** Số đã đặt của một sản phẩm; `null` khi chưa đọc được. */
export function committedOf(committed: CommittedMap, productId: string): number | null {
  if (!committed) return null
  return committed[productId] || 0
}

/** Gộp các dòng RPC trả về thành bản đồ theo sản phẩm. */
export function committedMapFrom(
  rows: Array<{ product_id: string; committed_base: number | string }>
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const r of rows) {
    if (!r.product_id) continue
    m[r.product_id] = (m[r.product_id] || 0) + (Number(r.committed_base) || 0)
  }
  return m
}

export interface StockDisplay {
  /** Tồn kho theo đơn vị đang chọn. */
  stock: number
  /** Đã đặt theo đơn vị đang chọn. `null` = chưa đọc được. */
  committed: number | null
  /** Còn đặt được. Bằng `stock` khi chưa đọc được số đã đặt. */
  available: number
  /** Không còn gì để đặt thêm. */
  out: boolean
  /**
   * Kho CÓ hàng nhưng đã có người hứa hết.
   *
   * ⚠ ĐÂY LÀ CÂU KHÁC HẲN "HẾT HÀNG". "Hết hàng" thì người bán đi gọi
   * nhập; "đã có người đặt hết" thì họ đi hỏi xem đơn nào đang giữ và
   * có nhường được không. Gộp hai câu là để họ làm sai việc.
   */
  reservedOut: boolean
}

/**
 * Ba con số hiện trên thẻ sản phẩm, đã quy về ĐƠN VỊ ĐANG CHỌN.
 *
 * ⚠ BA CON SỐ, KHÔNG PHẢI MỘT. "Còn 12" một mình làm người bán tưởng kho
 * sắp hết và đi gọi nhập hàng; "Tồn 2.838" một mình là con số họ vừa bán
 * quá. Phải thấy cả ba mới hiểu chuyện gì đang xảy ra.
 */
export function stockDisplayFor(stock: number, committed: number | null): StockDisplay {
  const s = Number(stock) || 0
  if (committed === null) {
    return { stock: s, committed: null, available: s, out: s <= 0, reservedOut: false }
  }
  const c = Math.max(0, Number(committed) || 0)
  const available = s - c
  return {
    stock: s,
    committed: c,
    available,
    out: available <= 0,
    reservedOut: available <= 0 && s > 0,
  }
}
