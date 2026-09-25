import type { SupabaseClient } from "@supabase/supabase-js"
import { creditOnInvoice, type CreditInput } from "@/lib/orders/invoice-credit"
import { RETURN_REVENUE_DATE_COL } from "./sales"

/**
 * DOANH SỐ THUẦN = HÀNG ĐI − HÀNG TRẢ (chủ nhà 25/09/2026, mig 192).
 *
 * ⚠ "check lại màn này Doanh thu lệch công nợ. Danh sách Hoá đơn bán HD 0403 thực chất
 *   số tiền còn 2988500 (sau khi trừ hàng trả). Rà soát lại toàn bộ doanh số tính bằng
 *   số đi - số trả."
 *   Một luật, khớp công nợ: phiếu tự sinh theo hóa đơn trừ vào ngày hóa đơn (kể cả khi
 *   còn Chờ xử lý), phiếu tự lập trừ vào ngày hoàn thành — cột `returns.revenue_date`.
 */

/** Khoản trả ĐÃ trừ vào từng hóa đơn — cùng luật công nợ (`creditOnInvoice`). */
export async function traTheoHoaDon(
  supabase: SupabaseClient,
  invoiceIds: readonly string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = Array.from(new Set(invoiceIds.filter(Boolean)))
  for (let i = 0; i < ids.length; i += 200) {
    const lo = ids.slice(i, i + 200)
    const { data, error } = await supabase
      .from("returns")
      .select("invoice_id, status, credit_with_invoice, credit_note_amount")
      .in("invoice_id", lo)
    if (error) throw new Error(`Không đọc được phiếu trả của hóa đơn: ${error.message}`)
    const theoHD = new Map<string, CreditInput[]>()
    for (const r of (data ?? []) as Array<CreditInput & { invoice_id: string }>) {
      const ds = theoHD.get(r.invoice_id) ?? []
      ds.push(r)
      theoHD.set(r.invoice_id, ds)
    }
    theoHD.forEach((ds, id) => {
      const c = creditOnInvoice(ds)
      if (c) out.set(id, c)
    })
  }
  return out
}

/**
 * Tổng hàng trả trừ doanh số của MỘT khách trong khoảng ngày [from, to) (to = null:
 * tới nay). Chưa chạy mig 192 thì lùi về phiếu đã hoàn thành theo `credited_at`.
 */
export async function traCuaKhach(
  supabase: SupabaseClient,
  customerId: string,
  from: string,
  toExclusive: string | null
): Promise<number> {
  let q = supabase
    .from("returns")
    .select(`credit_note_amount, ${RETURN_REVENUE_DATE_COL}`)
    .eq("customer_id", customerId)
    .gte(RETURN_REVENUE_DATE_COL, from)
  if (toExclusive) q = q.lt(RETURN_REVENUE_DATE_COL, toExclusive)
  let res = await q
  if (res.error && /42703|revenue_date/.test(res.error.message + (res.error.code ?? ""))) {
    let q2 = supabase
      .from("returns")
      .select("credit_note_amount, credited_at")
      .eq("customer_id", customerId)
      .in("status", ["approved", "completed"])
      .gte("credited_at", `${from}T00:00:00+07:00`)
    if (toExclusive) q2 = q2.lt("credited_at", `${toExclusive}T00:00:00+07:00`)
    res = (await q2) as typeof res
  }
  if (res.error) throw new Error(`Không đọc được phiếu trả của khách: ${res.error.message}`)
  return ((res.data ?? []) as Array<{ credit_note_amount: number | null }>).reduce(
    (s, r) => s + Number(r.credit_note_amount || 0),
    0
  )
}
