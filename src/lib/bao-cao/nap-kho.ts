/**
 * KHO cho Báo cáo tổng hợp (spec mục 6).
 *
 * - Tồn hiện tại + lô + HSD: `batches` còn hàng (`qty_on_hand` là SL đơn vị cơ sở, `unit_cost`
 *   là giá MỖI ĐƠN VỊ CƠ SỞ — luật báo cáo 24/09/2026).
 * - Tốc độ bán: SL cơ sở trên hoá đơn đã ghi sổ 90 ngày gần nhất (doanh số theo HOÁ ĐƠN, không
 *   theo đơn đặt).
 * - Xuất – nhập – tồn theo kỳ: phiếu kho ĐÃ GHI SỔ. Không có bảng tồn lịch sử, nên tồn cuối kỳ =
 *   tồn hiện tại − Σ biến động SAU kỳ; tồn đầu = tồn cuối − Σ biến động TRONG kỳ.
 *   Phân loại: nhập lại từ phiếu trả → "Trả về"; nhập khác → "Nhập"; xuất gắn đơn → "Xuất bán";
 *   xuất / chuyển / kiểm kho khác → "Xuất khác" (ghi theo chiều giảm tồn).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docDuHoacNem, docTheoLoId } from "@/lib/supabase/aggregate"
import { fetchRevenueInvoicesDu, fetchInvoiceLines, soLuongCoSoDongHd, soLuongCoSoDongKho, vnDateOf } from "@/lib/analytics/sales"
import { congNgay, soNgay } from "./ky"
import type { DanhMucBC } from "./cong"
import { quyDoiTuDanhMuc } from "./nap-danh-muc"

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

export const NGUONG_KHO = { hetHan: 30, tonThap: 7, khongBan: 30, banHet: 90 } as const

export interface LoKho {
  id: string
  sp: string
  ma: string
  sl: number
  gia: number
  hsd: string | null
  nhap: string
}

export interface TonMatHang {
  sp: string
  sl: number
  giaTri: number
  lo: LoKho[]
  hsd: string | null
  /** SL cơ sở bán TB / ngày (30 ngày). */
  tb30: number
  /** Số ngày đủ bán (∞ khi không bán). */
  duBan: number
  /** Ngày bán gần nhất trong 90 ngày; rỗng = không bán trong 90 ngày. */
  banCuoi: string
  tonThap: boolean
  chamBan: boolean
}

export function tinhTon(lo: readonly LoKho[], ban: ReadonlyMap<string, { sl30: number; cuoi: string }>, homNay: string): TonMatHang[] {
  const m = new Map<string, LoKho[]>()
  for (const l of lo) {
    const a = m.get(l.sp)
    if (a) a.push(l)
    else m.set(l.sp, [l])
  }
  const out: TonMatHang[] = []
  m.forEach((ds, sp) => {
    const sl = ds.reduce((s, l) => s + l.sl, 0)
    const giaTri = ds.reduce((s, l) => s + l.sl * l.gia, 0)
    const hsdDs = ds.map((l) => l.hsd).filter((x): x is string => !!x).sort()
    const b = ban.get(sp)
    const tb30 = (b?.sl30 || 0) / 30
    const duBan = tb30 > 0 ? sl / tb30 : Infinity
    const banCuoi = b?.cuoi || ""
    out.push({
      sp,
      sl,
      giaTri,
      lo: ds.slice().sort((a, b2) => (a.hsd || "9999").localeCompare(b2.hsd || "9999")),
      hsd: hsdDs[0] || null,
      tb30,
      duBan,
      banCuoi,
      tonThap: sl > 0 && duBan < NGUONG_KHO.tonThap,
      chamBan: sl > 0 && (!banCuoi || soNgay(banCuoi, homNay) >= NGUONG_KHO.khongBan || duBan > NGUONG_KHO.banHet),
    })
  })
  return out
}

export async function napTonKho(sb: SupabaseClient, orgId: string, homNay: string, dm: DanhMucBC) {
  const [lo, hd] = await Promise.all([
    docDuHoacNem<{ id: string; product_id: string; batch_code: string | null; qty_on_hand: number; unit_cost: number | null; expires_at: string | null; created_at: string | null }>(
      (from, to): Trang =>
        sb
          .from("batches")
          .select("id, product_id, batch_code, qty_on_hand, unit_cost, expires_at, created_at", { count: "exact" })
          .eq("org_id", orgId)
          .gt("qty_on_hand", 0)
          .order("id")
          .range(from, to) as unknown as Trang,
      "đọc lô tồn kho"
    ),
    fetchRevenueInvoicesDu(sb, orgId, { from: congNgay(homNay, -89), to: homNay }),
  ])
  const ngayHd = new Map(hd.rows.map((h) => [h.id, String(h.invoice_date).slice(0, 10)]))
  const dong = await fetchInvoiceLines(sb, hd.rows.map((h) => h.id))
  const ban = new Map<string, { sl30: number; cuoi: string }>()
  const moc30 = congNgay(homNay, -29)
  for (const l of dong) {
    if (l.is_exchange) continue
    const d = ngayHd.get(l.invoice_id) || ""
    const e = ban.get(l.product_id) || { sl30: 0, cuoi: "" }
    if (d >= moc30) e.sl30 += soLuongCoSoDongHd(l, quyDoiTuDanhMuc(dm, l.product_id))
    if (d > e.cuoi) e.cuoi = d
    ban.set(l.product_id, e)
  }
  const ds: LoKho[] = lo.rows.map((b) => ({
    id: b.id,
    sp: b.product_id,
    ma: b.batch_code || b.id.slice(0, 8),
    sl: Number(b.qty_on_hand || 0),
    gia: Number(b.unit_cost || 0),
    hsd: b.expires_at ? String(b.expires_at).slice(0, 10) : null,
    nhap: b.created_at ? vnDateOf(b.created_at) : "",
  }))
  return { ton: tinhTon(ds, ban, homNay), lo: ds, thieu: lo.truncated || hd.truncated }
}

// ---------------------------------------------------------------- xuất – nhập – tồn

export type LoaiBienDong = "nhap" | "tra" | "ban" | "khac"

export interface BienDong {
  ngay: string
  sp: string
  /** SL cơ sở, có dấu (+ vào kho, − ra kho). */
  sl: number
  loai: LoaiBienDong
  ma: string
  phieu: string
  gia: number
}

export interface DongXnt {
  sp: string
  dau: number
  nhap: number
  ban: number
  tra: number
  khac: number
  cuoi: number
}

/** Tồn hiện tại + biến động từ `a` tới nay → XNT của [a, b]. Thuần — test được. */
export function tinhXnt(tonNay: ReadonlyMap<string, number>, bienDong: readonly BienDong[], a: string, b: string): Map<string, DongXnt> {
  const out = new Map<string, DongXnt>()
  const lay = (sp: string) => {
    let x = out.get(sp)
    if (!x) out.set(sp, (x = { sp, dau: 0, nhap: 0, ban: 0, tra: 0, khac: 0, cuoi: tonNay.get(sp) || 0 }))
    return x
  }
  tonNay.forEach((_, sp) => lay(sp))
  for (const d of bienDong) {
    const x = lay(d.sp)
    if (d.ngay > b) {
      x.cuoi -= d.sl
      continue
    }
    if (d.ngay < a) continue
    if (d.loai === "nhap") x.nhap += d.sl
    else if (d.loai === "tra") x.tra += d.sl
    else if (d.loai === "ban") x.ban -= d.sl
    else x.khac -= d.sl
  }
  out.forEach((x) => {
    x.dau = x.cuoi - x.nhap - x.tra + x.ban + x.khac
  })
  return out
}

export async function napBienDong(sb: SupabaseClient, orgId: string, tu: string): Promise<{ ds: BienDong[]; thieu: boolean }> {
  const pk = await docDuHoacNem<{ id: string; type: string; notes: string | null; entry_code: string | null; posted_at: string | null; ref_order_ids: unknown }>(
    (from, to): Trang =>
      sb
        .from("stock_entries")
        .select("id, type, notes, entry_code, posted_at, ref_order_ids", { count: "exact" })
        .eq("org_id", orgId)
        .eq("status", "posted")
        .gte("posted_at", `${tu}T00:00:00+07:00`)
        .order("id")
        .range(from, to) as unknown as Trang,
    "đọc phiếu kho"
  )
  const theoId = new Map(pk.rows.map((e) => [e.id, e]))
  const dong = await docTheoLoId<{ entry_id: string; product_id: string; quantity: number; qty_in_base_uom: number | null; conversion_factor_snapshot: number | null; unit_cost: number | null }>(
    pk.rows.map((e) => e.id),
    (lo, from, to) =>
      sb
        .from("stock_entry_lines")
        .select("entry_id, product_id, quantity, qty_in_base_uom, conversion_factor_snapshot, unit_cost", { count: "exact" })
        .in("entry_id", lo)
        .order("id")
        .range(from, to),
    "đọc dòng phiếu kho"
  )
  const ds: BienDong[] = []
  for (const l of dong) {
    const e = theoId.get(l.entry_id)
    if (!e || !e.posted_at) continue
    const q = soLuongCoSoDongKho(l)
    const coDon = Array.isArray(e.ref_order_ids) ? e.ref_order_ids.length > 0 : !!e.ref_order_ids
    let loai: LoaiBienDong
    let sl: number
    if (e.type === "import") {
      loai = (e.notes || "").startsWith("Nhập lại từ phiếu trả") ? "tra" : "nhap"
      sl = q
    } else if (e.type === "export") {
      loai = coDon ? "ban" : "khac"
      sl = -q
    } else {
      // Chuyển kho / kiểm kho: giữ dấu của dòng.
      loai = "khac"
      sl = Number(l.qty_in_base_uom ?? l.quantity ?? 0)
    }
    ds.push({ ngay: vnDateOf(e.posted_at), sp: l.product_id, sl, loai, ma: e.entry_code || e.id.slice(0, 8), phieu: e.id, gia: Number(l.unit_cost || 0) })
  }
  ds.sort((x, y) => x.ngay.localeCompare(y.ngay))
  return { ds, thieu: pk.truncated }
}
