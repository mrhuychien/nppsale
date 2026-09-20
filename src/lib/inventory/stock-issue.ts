/**
 * PHIẾU XUẤT KHO LẺ — phép tính và hằng số.
 *
 * ⚠ ĐÂY LÀ PHIẾU KHO, KHÔNG PHẢI CHỨNG TỪ BÁN. Nó không có giá bán,
 * không có khách, không sinh công nợ — chỉ trừ kho. Hàng vỡ, hàng biếu,
 * hàng mang đi hội chợ, hàng chuyển chi nhánh.
 *
 * ⚠ KHÔNG CÓ TIỀN TRÊN PHIẾU NÀY, CỐ Ý. Giá trị hàng xuất là GIÁ VỐN
 * của đúng những lô mà FIFO lấy ra — chỉ máy chủ biết, sau khi ghi sổ.
 * Cho người dùng gõ một con số tiền ở đây là mời họ tin vào một con số
 * mà sổ sách không dùng tới.
 */

import type { Product, ProductUnit } from "@/types"

export type IssueProduct = Product & { units?: ProductUnit[] }

export interface IssueLine {
  id: string
  product_id: string
  product_name: string
  sku: string
  note: string
  unit_name: string
  quantity: string
  conversion_factor: string
  available_units: ProductUnit[]
  base_unit: string
  /** Tồn khả dụng trong kho đã chọn, theo đơn vị cơ sở. `null` = chưa tra. */
  on_hand: number | null
}

const num = (s: string | number | null | undefined): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Số lượng quy về ĐƠN VỊ CƠ SỞ — đúng con số `post_stock_issue` trừ kho.
 *
 * ⚠ KHÔNG ĐỂ ÂM. Ô số lượng có `min={0}` nhưng người dùng dán được số
 * âm vào; một dòng âm là CỘNG hàng vào kho qua đường xuất kho.
 */
export function baseQtyOf(l: IssueLine): number {
  return Math.max(0, num(l.quantity) * (num(l.conversion_factor) || 1))
}

/**
 * Dòng nào thật sự được ghi xuống.
 *
 * ⚠ `post_stock_issue` bỏ qua dòng số lượng 0 nhưng từ chối cả phiếu
 * nếu KHÔNG còn dòng nào — lọc ở đây để người dùng không phải đọc một
 * thông báo lỗi cho mấy dòng họ cố ý bỏ trống.
 */
export function validIssueLines(lines: IssueLine[]): IssueLine[] {
  return lines.filter((l) => l.product_id && baseQtyOf(l) > 0)
}

/**
 * Những mặt hàng mà TỔNG các dòng vượt tồn.
 *
 * ⚠ GOM THEO MẶT HÀNG, không xét từng dòng. Hai dòng cùng một mã, mỗi
 * dòng riêng thì vừa mà cộng lại thì không — `post_stock_issue` gom
 * đúng như vậy trước khi trừ, nên cảnh báo ở màn phải gom y hệt, nếu
 * không màn hình nói "đủ" rồi máy chủ trả về lỗi.
 *
 * ⚠ CHƯA TRA TỒN THÌ KHÔNG KẾT LUẬN. `on_hand === null` nghĩa là chưa
 * biết; báo "vượt tồn" khi chưa biết là kêu oan, và người dùng học được
 * cách bỏ qua cảnh báo.
 */
export function overIssueProducts(
  lines: IssueLine[]
): Array<{ product_id: string; name: string; need: number; onHand: number }> {
  const byProduct = new Map<string, { name: string; need: number; onHand: number | null }>()
  for (const l of validIssueLines(lines)) {
    const cur = byProduct.get(l.product_id)
    if (cur) {
      cur.need += baseQtyOf(l)
    } else {
      byProduct.set(l.product_id, {
        name: l.product_name,
        need: baseQtyOf(l),
        onHand: l.on_hand,
      })
    }
  }
  const out: Array<{ product_id: string; name: string; need: number; onHand: number }> = []
  // ⚠ `Array.from` chứ không lặp thẳng trên Map — target của dự án
  //   chưa bật `downlevelIteration`.
  for (const [product_id, v] of Array.from(byProduct.entries())) {
    if (v.onHand === null) continue
    if (v.need > v.onHand) out.push({ product_id, name: v.name, need: v.need, onHand: v.onHand })
  }
  return out
}

/** Lý do xuất — định nghĩa cạnh tập giá trị, không rải ra JSX. */
export const ISSUE_REASONS = [
  { value: "damaged", label: "Hàng hỏng / vỡ" },
  { value: "gift", label: "Hàng biếu / khuyến mãi" },
  { value: "sample", label: "Hàng mẫu / trưng bày" },
  { value: "transfer", label: "Chuyển kho / chi nhánh" },
  { value: "other", label: "Khác" },
] as const

export function issueReasonLabel(v: string | null | undefined): string {
  if (!v) return "chưa xác định"
  // ⚠ Mã lạ thì in nguyên mã — giấu đi là giấu luôn manh mối.
  return ISSUE_REASONS.find((r) => r.value === v)?.label ?? v
}

/**
 * "Chuyển kho" KHÔNG phải một lý do xuất — nó là một LOẠI PHIẾU KHÁC.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Tích hợp thêm chuyển kho vào phiếu xuất
 * kho (VD chuyển từ kho hàng bán sang hàng date)". Trên màn thì nó nằm
 * chung một chỗ với xuất lẻ cho tiện; dưới sổ thì nó là
 * `stock_entries.type = 'transfer'` và đi qua `post_stock_transfer`,
 * KHÔNG qua `post_stock_issue`.
 *
 * ⚠ VÌ SAO KHÔNG GỘP LÀM MỘT. Xuất lẻ là hàng RỜI KHỎI kho (vỡ, biếu,
 * mẫu) — tổng tồn giảm. Chuyển kho là hàng ĐỔI CHỖ — tổng tồn không
 * đổi. Ghi chuyển kho bằng một phiếu xuất là khai mất hàng, và báo cáo
 * hao hụt phình lên bằng đúng lượng hàng vẫn còn nguyên trong kho.
 */
export const TRANSFER_REASON = "transfer"

export function isTransfer(reason: string | null | undefined): boolean {
  return reason === TRANSFER_REASON
}

/**
 * Kho đích hợp lệ cho một kho nguồn.
 *
 * ⚠ KHÔNG CHO CHỌN CHÍNH NÓ. `post_stock_transfer` từ chối kho nguồn
 * trùng kho đích; để người dùng chọn được rồi mới báo lỗi là bắt họ đi
 * một vòng cho một thứ màn hình biết trước.
 */
export function destZonesFor(src: string): ReadonlyArray<{ value: string; label: string }> {
  return ISSUE_ZONES.filter((z) => z.value !== src)
}

export const ISSUE_ZONES = [
  { value: "sale", label: "Kho hàng bán" },
  { value: "date", label: "Kho hàng date (gần hạn)" },
] as const

/**
 * Lỗi của `post_stock_issue` dịch sang tiếng người.
 *
 * ⚠ RPC ĐÃ TRẢ VỀ TIẾNG VIỆT SẴN, kèm mã ở đầu. Việc ở đây chỉ là CẮT
 * MÃ — đừng viết lại câu, vì RPC là chỗ duy nhất biết mặt hàng nào
 * thiếu và thiếu bao nhiêu.
 */
export function friendlyIssueError(msg: string): string {
  const m = /^[A-Z_]+:\s*([\s\S]+)$/.exec(msg.trim())
  return m ? m[1] : msg
}
