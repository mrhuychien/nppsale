import { createClient } from "@/lib/supabase/client"

/** Cửa sổ nhìn lại — 90 ngày. Xa hơn thì thói quen mua đã đổi. */
const LOOKBACK_DAYS = 90
/** Trần số đơn nạp về; đủ cho một khách trong 90 ngày. */
const ORDER_CAP = 300
/** Trần số dòng hàng nạp về. */
const LINE_CAP = 2000

/**
 * Sản phẩm khách này hay lấy, xếp theo số LẦN MUA giảm dần.
 *
 * Dùng để đưa lên đầu bộ chọn sản phẩm — NVBH gõ đơn cho khách quen thì
 * 80% mặt hàng là những thứ lần trước họ đã lấy.
 *
 * HAI TRUY VẤN, KHÔNG dùng embed `!inner`: nhúng qua quan hệ khiến kết quả
 * phụ thuộc vào cách RLS áp lên bảng cha, và `sales_order_lines` không có
 * `org_id` riêng — nó thừa hưởng qua đơn. Lấy id đơn trước rồi `in()` là
 * đường đi rõ ràng, không phụ thuộc hành vi nhúng.
 *
 * Lỗi thì trả mảng RỖNG, không ném: đây là tiện ích sắp xếp, hỏng nó không
 * được chặn người ta tạo đơn.
 */
export async function fetchFrequentProducts(
  customerId: string,
  limit = 20
): Promise<string[]> {
  if (!customerId) return []
  const supabase = createClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const { data: orders, error: orderErr } = await supabase
    .from("sales_orders")
    .select("id")
    .eq("customer_id", customerId)
    .gte("order_date", since)
    // Đơn đã huỷ KHÔNG phản ánh thói quen mua — nó phản ánh một lần nhầm.
    .neq("status", "cancelled")
    .order("order_date", { ascending: false })
    .limit(ORDER_CAP)
  if (orderErr || !orders?.length) return []

  const { data: lines, error: lineErr } = await supabase
    .from("sales_order_lines")
    .select("product_id")
    .in("order_id", orders.map((o) => o.id as string))
    .limit(LINE_CAP)
  if (lineErr || !lines?.length) return []

  // Đếm theo SỐ LẦN xuất hiện, không theo số lượng: một khách lấy 100
  // thùng nước một lần không "hay lấy" bằng khách lấy 2 hộp mỗi tuần.
  const freq = new Map<string, number>()
  for (const r of lines as Array<{ product_id: string }>) {
    if (!r.product_id) continue
    freq.set(r.product_id, (freq.get(r.product_id) ?? 0) + 1)
  }

  // Array.from thay vì spread: target tsconfig chưa bật downlevelIteration
  // nên spread một MapIterator không build được.
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}
