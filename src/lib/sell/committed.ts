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

import { formatInt } from "@/lib/utils"

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

/**
 * Lời cảnh báo khi thêm một mặt hàng KHÔNG CÒN ĐẶT ĐƯỢC.
 *
 * ⚠ CẢNH BÁO, KHÔNG PHẢI CHẶN (chủ nhà chốt 20/09/2026: "mở khoá cả cho
 * đặt với sản phẩm hết hàng"). Trước đây hai màn thêm hàng — danh sách
 * và quét mã — ném một toast đỏ rồi `return`, tức là KHÔNG thêm. Nhưng
 * giỏ hàng thì đã cho phép vượt tồn từ lâu và nói thẳng "vẫn gửi đơn
 * được để nhà phân phối biết nhu cầu thật". Hai cách cư xử cho cùng một
 * việc: gõ số lượng lên 50 khi kho còn 2 thì được, mà thêm một mặt hàng
 * kho còn 0 thì không.
 *
 * Cái giá của việc chặn không phải là sự bất tiện — mà là SỐ LIỆU. Đơn
 * không đặt được thì nhu cầu đó không tồn tại ở đâu cả, và nhà phân phối
 * nhập hàng theo một bức tranh thiếu đúng phần đang thiếu hàng nhất.
 *
 * ⚠ HAI CÂU KHÁC NHAU, GIỮ NGUYÊN. "Hết hàng" thì người bán đi gọi nhập;
 * "đã có đơn khác đặt hết" thì họ đi hỏi xem đơn nào đang giữ và có
 * nhường được không (xem `StockDisplay.reservedOut`). Gộp lại là để họ
 * làm sai việc.
 *
 * ⚠ `null` NGHĨA LÀ KHÔNG CÓ GÌ ĐỂ NÓI. Còn đặt được thì im — một toast
 * ở mỗi cú chạm là cách nhanh nhất dạy người dùng bỏ qua mọi toast.
 */
export function addOverstockWarning(
  productName: string,
  onHand: number,
  available: number,
  baseUnit: string
): { title: string; description: string } | null {
  if (available > 0) return null
  if (onHand > 0) {
    return {
      title: `Đã có đơn khác đặt hết: ${productName}`,
      description:
        `Kho còn ${formatInt(onHand)} ${baseUnit} nhưng đã nằm trong Phiếu tạm khác. ` +
        "Vẫn đặt được — khi xuất hàng sẽ chỉ giao được phần có trong kho.",
    }
  }
  return {
    title: `Hết hàng: ${productName}`,
    description:
      "Vẫn đặt được để nhà phân phối biết nhu cầu thật; khi xuất hàng sẽ chỉ " +
      "giao được phần có trong kho.",
  }
}
