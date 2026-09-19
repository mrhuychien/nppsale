/**
 * CHI TIẾT KHÁCH — các con số dưới thẻ KPI và ba khối bên phải.
 *
 * Mẫu chủ nhà gửi (bản máy tính) thêm bốn thứ màn cũ không có: dòng so
 * sánh dưới mỗi KPI, ba ô chia tuổi nợ, danh sách "sản phẩm hay lấy", và
 * cột phải "Hoạt động gần đây / Cần hoàn thiện".
 *
 * ⚠ KHÔNG CÓ BẢNG NHẬT KÝ HOẠT ĐỘNG TRONG DATABASE. "Hoạt động gần đây"
 * ở đây được GHÉP từ ba nguồn có thật — lượt ghé, đơn hàng, tiền đã thu —
 * chứ không phải đọc từ một bảng log. Nghĩa là nó chỉ kể được ba loại
 * việc đó; những thay đổi khác (sửa hạn mức, đổi phân công) KHÔNG hiện,
 * và màn hình không được nói "toàn bộ hoạt động".
 */

import { daysOverdueOf } from "@/lib/utils"
import { shortMoney } from "@/lib/customers/list-view"

export interface ReceivableAging {
  amount: number
  paid: number
  due_date: string | null
}

export interface DebtBucket {
  key: "current" | "d1_30" | "d30plus"
  label: string
  amount: number
}

/**
 * Chia công nợ còn mở theo tuổi nợ.
 *
 * ⚠ BA Ô, KHÔNG PHẢI BỐN. Mẫu chốt "Trong hạn / Quá hạn 1–30 / Quá hạn
 * trên 30". Thang `AgingStatus` trong `lib/utils` chia bốn bậc (ngưỡng 30
 * và 60); ở đây gộp hai bậc cuối lại, nên NHÃN PHẢI GHI "trên 30" chứ
 * không mượn `AGING_RANGE` — mượn là màn này ghi "31-60 ngày" cho cả
 * khoản quá hạn hai năm.
 *
 * ⚠ CHỈ CỘNG PHẦN CÒN LẠI (`amount - paid`), và bỏ qua dòng âm. Một
 * khoản thu dư làm `remaining` âm; cộng số âm vào ô "trong hạn" là kéo
 * tổng nợ xuống thấp hơn thực tế.
 */
export function debtBuckets(rows: ReceivableAging[]): DebtBucket[] {
  const out: Record<DebtBucket["key"], number> = { current: 0, d1_30: 0, d30plus: 0 }
  for (const r of rows) {
    const remaining = Number(r.amount || 0) - Number(r.paid || 0)
    if (remaining <= 0) continue
    const days = daysOverdueOf(r.due_date)
    if (days <= 0) out.current += remaining
    else if (days <= 30) out.d1_30 += remaining
    else out.d30plus += remaining
  }
  return [
    { key: "current", label: "Trong hạn", amount: out.current },
    { key: "d1_30", label: "Quá hạn 1–30 ngày", amount: out.d1_30 },
    { key: "d30plus", label: "Quá hạn trên 30 ngày", amount: out.d30plus },
  ]
}

export interface OrderLineRef {
  order_id: string
  product_id: string
  product_name: string | null
}

export interface FrequentProduct {
  productId: string
  name: string
  /** Số ĐƠN có mặt hàng này, không phải số dòng. */
  orders: number
  /** Phần trăm so với mặt hàng đứng đầu — chỉ để vẽ thanh. */
  pct: number
}

/**
 * "Sản phẩm hay lấy" — đếm theo SỐ ĐƠN, không theo số lượng.
 *
 * ⚠ ĐẾM ĐƠN CHỨ KHÔNG ĐẾM THÙNG. Người bán hỏi "quán này thường lấy gì"
 * để gợi hàng; một lần lấy 50 thùng nước ngọt cho đám cưới không biến
 * nước ngọt thành mặt hàng quen. Đếm số đơn có mặt hàng đó mới trả lời
 * đúng câu hỏi.
 *
 * ⚠ MỘT ĐƠN CÓ THỂ CÓ HAI DÒNG CÙNG MỘT MẶT HÀNG (khác đơn vị, khác lô).
 * Vì thế phải khử trùng theo cặp (đơn, mặt hàng) trước khi đếm.
 */
export function frequentProducts(lines: OrderLineRef[], limit = 5): FrequentProduct[] {
  const seen = new Set<string>()
  const count = new Map<string, { name: string; n: number }>()
  for (const l of lines) {
    if (!l.product_id || !l.order_id) continue
    const pair = `${l.order_id}|${l.product_id}`
    if (seen.has(pair)) continue
    seen.add(pair)
    const cur = count.get(l.product_id)
    if (cur) cur.n += 1
    else count.set(l.product_id, { name: l.product_name || "—", n: 1 })
  }
  const sorted = Array.from(count.entries())
    .map(([productId, v]) => ({ productId, name: v.name, orders: v.n }))
    // Đồng hạng thì xếp theo tên để thứ tự không nhảy giữa hai lần vẽ.
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, "vi"))
    .slice(0, limit)
  const top = sorted[0]?.orders || 1
  return sorted.map((s) => ({ ...s, pct: Math.round((s.orders / top) * 100) }))
}

/**
 * Dòng so sánh dưới KPI doanh thu.
 *
 * ⚠ THÁNG TRƯỚC BẰNG 0 THÌ KHÔNG CÓ PHẦN TRĂM. Chia cho 0 ra `Infinity`,
 * và "+∞%" là câu vô nghĩa in ra cho chủ nhà đọc.
 */
export function revenueCompareText(thisMonth: number, lastMonth: number): string {
  if (lastMonth <= 0) {
    return thisMonth > 0 ? "Tháng trước chưa có doanh thu" : "Chưa có doanh thu"
  }
  const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : ""
  return `Tháng trước ${shortMoney(lastMonth)} · ${sign}${Math.abs(pct)}%`
}

export type TodoKey = "photos" | "tax_code" | "gps" | "overdue" | "no_assignee"

export interface CustomerTodo {
  key: TodoKey
  label: string
  action: string
  tone: "warn" | "danger"
}

/**
 * "Cần hoàn thiện" — việc còn thiếu ở điểm bán này.
 *
 * ⚠ CHỈ NÊU VIỆC KIỂM ĐƯỢC. Mỗi mục dưới đây đối chiếu được với đúng một
 * cột/bảng; không có mục nào dựa trên phỏng đoán. Thiếu nguồn thì không
 * thêm mục — một danh sách việc có mục sai là danh sách không ai đọc nữa.
 */
export function customerTodos(input: {
  photoCount: number
  maxPhotos: number
  taxCode: string | null | undefined
  hasGps: boolean
  overdueAmount: number
  assigneeCount: number
}): CustomerTodo[] {
  const out: CustomerTodo[] = []
  if (input.overdueAmount > 0) {
    out.push({
      key: "overdue",
      label: `Công nợ quá hạn ${shortMoney(input.overdueAmount)}`,
      action: "Thu tiền",
      tone: "danger",
    })
  }
  if (input.assigneeCount === 0) {
    out.push({
      key: "no_assignee",
      label: "Chưa có nhân viên phụ trách",
      action: "Phân công",
      tone: "danger",
    })
  }
  if (input.photoCount < input.maxPhotos) {
    out.push({
      key: "photos",
      label: `Mới có ${input.photoCount}/${input.maxPhotos} ảnh điểm bán`,
      action: "Chụp",
      tone: "warn",
    })
  }
  if (!input.hasGps) {
    out.push({ key: "gps", label: "Chưa ghim toạ độ điểm bán", action: "Ghim", tone: "warn" })
  }
  if (!input.taxCode) {
    out.push({ key: "tax_code", label: "Chưa có mã số thuế", action: "Bổ sung", tone: "warn" })
  }
  return out
}

export type ActivityKind = "visit" | "order" | "payment"

export interface ActivityItem {
  id: string
  kind: ActivityKind
  label: string
  /** Mốc thời gian ISO để sắp xếp — KHÔNG hiện thẳng ra màn. */
  at: string
  who: string | null
}

/**
 * Ghép ba nguồn thành một dòng thời gian.
 *
 * ⚠ SẮP GIẢM DẦN THEO MỐC THỜI GIAN THẬT, không theo thứ tự truyền vào.
 * Ba nguồn về từ ba truy vấn khác nhau; nối mảng rồi hiện luôn là một
 * dòng thời gian lộn xộn, và người đọc sẽ tin nó là thứ tự xảy ra.
 */
export function mergeActivity(items: ActivityItem[], limit = 6): ActivityItem[] {
  return items
    .filter((i) => !!i.at)
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}
