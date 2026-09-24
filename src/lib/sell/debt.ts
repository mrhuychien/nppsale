/**
 * Công nợ theo khách cho luồng /sell — dùng chung màn Chọn khách (2c) và màn
 * Đơn hàng (2b: "Nợ …" dưới tên khách).
 */
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

/**
 * Công nợ theo khách — MỘT bản cho cả phiên, làm mới sau `DEBT_TTL_MS`.
 *
 * ⚠ VÌ SAO. Màn này mở ở MỖI lần chọn khách, và bản đầu kéo về TOÀN BỘ
 * công nợ chưa tất toán của cả đơn vị ở mỗi lần mở — hàng nghìn dòng, phân
 * trang nhiều request, cho một con số đã có cách đây 30 giây. Công nợ đổi
 * theo ngày, không theo cú chạm.
 *
 * `null` = chưa đọc được → hiện "—", không hiện 0.
 */
export const DEBT_TTL_MS = 2 * 60_000
export let debtMemo: { map: Record<string, number> | null; at: number } | null = null
let debtInflight: Promise<Record<string, number> | null> | null = null

export async function loadDebtByCustomer(): Promise<Record<string, number> | null> {
  if (debtMemo && Date.now() - debtMemo.at < DEBT_TTL_MS) return debtMemo.map
  if (debtInflight) return debtInflight
  debtInflight = (async () => {
    // ⚠ PHẢI phân trang. Nhà phân phối có hơn 1.000 công nợ chưa tất
    // toán là chuyện thường, mà server cắt ở 1.000 dòng và KHÔNG báo —
    // khách nằm sau dòng đó sẽ hiện "nợ 0" trong khi đang nợ thật.
    const res = await fetchAllForAggregate<{ customer_id: string; amount: number; paid: number }>(
      (from, to) =>
        createClient()
          .from("receivables")
          .select("customer_id, amount, paid", { count: "exact" })
          .neq("status", "paid")
          // ⚠ THỨ TỰ DUY NHẤT. Các trang chạy SONG SONG; không `.order`
          //   thì Postgres trả mỗi trang một kiểu — một phiếu nợ bị cộng
          //   hai lần, phiếu khác rơi mất, nợ của khách lệch mà không báo.
          .order("id")
          .range(from, to)
    )
    if (res.error || res.truncated) {
      // Không biết thì để TRỐNG, đừng hiện 0 — 0 ở đây nghĩa là "không
      // nợ gì", và đó là câu trả lời sai cho một câu hỏi chưa đọc được.
      // ⚠ Và KHÔNG ghi nhớ lần đọc hỏng: lần mở sau phải thử lại.
      return null
    }
    const m: Record<string, number> = {}
    for (const r of res.rows) {
      m[r.customer_id] = (m[r.customer_id] || 0) + (Number(r.amount) - Number(r.paid))
    }
    debtMemo = { map: m, at: Date.now() }
    return m
  })().finally(() => {
    debtInflight = null
  })
  return debtInflight
}

