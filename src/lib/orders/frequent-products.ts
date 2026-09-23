import { createClient } from "@/lib/supabase/client"

/** Cửa sổ nhìn lại — 90 ngày. Xa hơn thì thói quen mua đã đổi. */
const LOOKBACK_DAYS = 90
/**
 * Trần số đơn nạp về — 150 đơn gần nhất, đủ cho một khách trong 90 ngày.
 *
 * ⚠ ĐỪNG NÂNG QUÁ 150. Danh sách id này đi thẳng vào `.in("order_id", …)`;
 *   300 uuid ≈ 11 KB URL, quá mốc an toàn `ID_MOI_LO` của dự án.
 */
const ORDER_CAP = 150
/**
 * Trần số dòng hàng nạp về.
 *
 * ⚠ 1.000 LÀ TRẦN THẬT (`db.max_rows`). Bản cũ ghi 2.000 nhưng máy chủ vẫn
 *   trả 1.000 — con số nói dối. Đây là gợi ý "hay lấy", không phải sổ
 *   sách: một mẫu 1.000 dòng của 150 đơn gần nhất đủ để xếp hạng.
 */
const LINE_CAP = 1000

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
/**
 * ⚠ Bộ nhớ theo khách, sống trong phiên. Màn bán hàng MỞ LẠI mỗi lần quay
 * về từ giỏ (thêm một dòng là một lần), và mỗi lần mở là hai truy vấn
 * này chạy lại cho cùng một khách — thói quen mua của khách không đổi
 * trong năm phút người ta đang ghi đơn cho họ.
 */
const FREQ_TTL_MS = 5 * 60_000
const freqCache = new Map<string, { ids: string[]; at: number }>()

export async function fetchFrequentProducts(
  customerId: string,
  limit = 20
): Promise<string[]> {
  if (!customerId) return []
  const hit = freqCache.get(customerId)
  if (hit && Date.now() - hit.at < FREQ_TTL_MS) return hit.ids
  const ids = await fetchFrequentProductsUncached(customerId, limit)
  freqCache.set(customerId, { ids, at: Date.now() })
  return ids
}

async function fetchFrequentProductsUncached(
  customerId: string,
  limit: number
): Promise<string[]> {
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
