/**
 * NẠP ĐƠN ĐẶT → `DongDat[]` — số HOẠT ĐỘNG (spec mục 4.1 nguồn "Đơn đặt"), KHÔNG phải doanh thu.
 *
 * - Đơn không huỷ, theo `order_date` (`fetchAllOrdersDu`).
 * - "Đã xuất" của một dòng = tiền dòng × SL đã xuất hoá đơn / SL đặt (`invoiced_qty`, trigger
 *   `trg_sync_invoiced_qty`) — đơn xuất nhiều đợt thì phần chưa xuất vẫn hiện ở "Chưa xuất".
 * - Tiền dòng phân bổ theo tỉ lệ để Σ dòng của một đơn = `sales_orders.total` (như dòng bán).
 * - Trạng thái ghi bằng NHÃN (`ORDER_STATUS_MAP`): "Xuất một phần" và "Hoàn thành" là một.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllOrdersDu, type SalesOrderRow } from "@/lib/analytics/sales"
import { docDuHoacNem, docTheoLoId } from "@/lib/supabase/aggregate"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import type { DongDat } from "./cong"

export interface DonDatBC {
  id: string
  ma: string
  ngay: string
  kh: string
  nv: string
  tong: number
  trangThai: string
}

interface DongDonTho {
  order_id: string
  product_id: string
  quantity: number | null
  invoiced_qty: number | null
  line_total: number | null
}

export const nhanTrangThaiDon = (s: string) => ORDER_STATUS_MAP[s]?.label || s

export function dungDongDat(don: readonly SalesOrderRow[], dong: readonly DongDonTho[]): { dong: DongDat[]; don: Map<string, DonDatBC> } {
  const theoDon = new Map<string, DongDonTho[]>()
  for (const l of dong) {
    const a = theoDon.get(l.order_id)
    if (a) a.push(l)
    else theoDon.set(l.order_id, [l])
  }
  const out: DongDat[] = []
  const ds = new Map<string, DonDatBC>()
  for (const o of don) {
    if (o.status === "cancelled") continue
    const ngay = String(o.order_date).slice(0, 10)
    const tong = Number(o.total || 0)
    const trangThai = nhanTrangThaiDon(o.status)
    ds.set(o.id, { id: o.id, ma: o.order_code, ngay, kh: o.customer_id, nv: o.sales_user_id || "", tong, trangThai })
    const base = { ngay, don: o.id, kh: o.customer_id, nv: o.sales_user_id || "", trangThai, nguoiTao: o.created_by || "" }
    const ls = theoDon.get(o.id) || []
    const S = ls.reduce((s, l) => s + Number(l.line_total || 0), 0)
    const daXong = o.status === "completed" || o.status === "closed"
    if (!ls.length || S <= 0) {
      out.push({ ...base, sp: ls[0]?.product_id || "", tien: tong, daXuat: daXong ? tong : 0 })
      continue
    }
    let conLai = tong
    ls.forEach((l, i) => {
      const tien = i === ls.length - 1 ? conLai : Math.round((Number(l.line_total || 0) / S) * tong)
      conLai -= tien
      const q = Number(l.quantity || 0)
      const tiLe = q > 0 ? Math.min(1, Math.max(0, Number(l.invoiced_qty || 0) / q)) : 0
      out.push({ ...base, sp: l.product_id, tien, daXuat: Math.round(tien * tiLe) })
    })
  }
  return { dong: out, don: ds }
}

export async function napDonDat(sb: SupabaseClient, orgId: string, a: string, b: string) {
  const r = await fetchAllOrdersDu(sb, orgId, { from: a, to: b })
  const ids = r.rows.filter((o) => o.status !== "cancelled").map((o) => o.id)
  const dong = await docTheoLoId<DongDonTho>(
    ids,
    (lo, from, to) =>
      sb
        .from("sales_order_lines")
        .select("order_id, product_id, quantity, invoiced_qty, line_total", { count: "exact" })
        .in("order_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng đơn đặt"
  )
  return { ...dungDongDat(r.rows, dong), thieu: r.truncated }
}

/** Đơn đặt còn phần chưa xuất hoá đơn (mọi ngày): Phiếu tạm + Xuất một phần. */
export async function napDonChuaXuat(sb: SupabaseClient, orgId: string) {
  const r = await docDuHoacNem<SalesOrderRow>(
    (from, to) =>
      sb
        .from("sales_orders")
        .select("id, order_code, order_date, status, total, subtotal, discount, vat, customer_id, sales_user_id, created_by, payment_terms", { count: "exact" })
        .eq("org_id", orgId)
        .in("status", ["submitted", "partially_invoiced"])
        .order("id")
        .range(from, to),
    "đọc đơn chưa xuất hoá đơn"
  )
  const dong = await docTheoLoId<DongDonTho>(
    r.rows.map((o) => o.id),
    (lo, from, to) =>
      sb.from("sales_order_lines").select("order_id, product_id, quantity, invoiced_qty, line_total", { count: "exact" }).in("order_id", lo).order("id").range(from, to),
    "đọc dòng đơn chưa xuất"
  )
  const { dong: ds } = dungDongDat(r.rows, dong)
  return { soDon: r.rows.length, conLai: ds.reduce((s, l) => s + l.tien - l.daXuat, 0), thieu: r.truncated }
}
