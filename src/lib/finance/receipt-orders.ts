/**
 * CHỌN ĐƠN ĐỂ THU — phần tính toán, tách khỏi giao diện.
 *
 * Chủ nhà yêu cầu: một phiếu thu có thể thu từ MỘT hoặc NHIỀU đơn; gõ
 * tìm đơn, danh sách hiện kèm ngày · khách · người bán · số tiền; chọn
 * đơn thì tự nạp khách và số tiền, và tổng tự cộng.
 *
 * ⚠ PHIẾU THU KHÔNG THU THEO ĐƠN, NÓ THU THEO CÔNG NỢ. Từ v2b mỗi hóa
 * đơn sinh một dòng `receivables`, và dòng đó giữ cả `order_id` lẫn
 * `invoice_id`. Nên "chọn đơn" ở đây thực chất là chọn DÒNG CÔNG NỢ của
 * đơn ấy — một đơn xuất hai đợt có HAI dòng nợ, và người thu tiền phải
 * thấy cả hai chứ không phải một dòng gộp.
 *
 * ⚠ MỘT PHIẾU THU CHỈ CỦA MỘT KHÁCH. RPC `create_cash_receipt` nhận đúng
 * một `customer_id`. Nên khi đã chọn đơn đầu tiên thì ô tìm phải khoá
 * lại theo khách đó — cho chọn tự do rồi mới từ chối là để người dùng
 * gõ xong cả phiếu mới biết mình làm sai.
 *
 * PHẠM VI: chỗ này chỉ lo TÌM và CHỌN. Số tiền từng dòng và tổng phiếu
 * vẫn nằm ở màn `/finance/cash-receipts/new` như cũ — chọn đơn chỉ điền
 * sẵn số còn phải thu vào ô của dòng ấy, kế toán sửa lại được.
 */

/** Một dòng công nợ đang mở, kèm thông tin đơn để nhận ra nó. */
export interface OrderDebtRow {
  receivableId: string
  orderId: string | null
  orderCode: string | null
  invoiceCode: string | null
  customerId: string
  customerName: string
  salesUserName: string | null
  orderDate: string | null
  dueDate: string | null
  amount: number
  paid: number
}

/**
 * Còn phải thu của một dòng.
 *
 * ⚠ KẸP VỀ 0. Dòng trả dư có `paid > amount` (xem
 * `_wf2b_recompute_receivable`); để số âm chạy tiếp là tổng phiếu thu bị
 * trừ đi một khoản không ai chọn.
 */
export function outstandingOf(r: Pick<OrderDebtRow, "amount" | "paid">): number {
  return Math.max(0, Number(r.amount || 0) - Number(r.paid || 0))
}

/**
 * Lọc danh sách đơn cho ô tìm.
 *
 * ⚠ BỎ DẤU TRƯỚC KHI SO. Kế toán gõ "tap hoa" để tìm "Tạp hoá"; bắt gõ
 * đủ dấu là bắt họ bỏ cuộc và quay lại cách cũ.
 *
 * ⚠ KHOÁ THEO KHÁCH SAU KHI ĐÃ CHỌN ĐƠN ĐẦU TIÊN. Một phiếu thu chỉ của
 * một khách; hiện đơn của khách khác là mời người dùng đi vào một phiếu
 * mà RPC sẽ từ chối.
 *
 * ⚠ BỎ DÒNG ĐÃ CHỌN khỏi gợi ý. Chọn lại lần hai thành hai dòng cùng một
 * khoản nợ, và tổng phiếu cộng đôi.
 *
 * ⚠ BỎ DÒNG KHÔNG CÒN PHẢI THU. Nợ đã trả đủ mà vẫn gợi ý là kế toán
 * chọn vào rồi thu thêm một lần nữa.
 */
export function searchOrderDebts(
  rows: readonly OrderDebtRow[],
  term: string,
  opts: {
    lockedCustomerId?: string | null
    alreadyPicked?: ReadonlySet<string>
    limit?: number
  } = {}
): OrderDebtRow[] {
  const { lockedCustomerId = null, alreadyPicked, limit = 20 } = opts
  const t = normalize(term)
  const out: OrderDebtRow[] = []
  for (const r of rows) {
    if (outstandingOf(r) <= 0) continue
    if (alreadyPicked?.has(r.receivableId)) continue
    if (lockedCustomerId && r.customerId !== lockedCustomerId) continue
    if (t && !matches(r, t)) continue
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

function matches(r: OrderDebtRow, t: string): boolean {
  return (
    normalize(r.orderCode ?? "").includes(t) ||
    normalize(r.invoiceCode ?? "").includes(t) ||
    normalize(r.customerName).includes(t) ||
    normalize(r.salesUserName ?? "").includes(t)
  )
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
}
