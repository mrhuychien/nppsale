/**
 * CÔNG NỢ "TÍNH ĐẾN NGÀY" cho Báo cáo tổng hợp (spec mục 7).
 *
 * Luật (CLAUDE.md "Công nợ tính theo HÓA ĐƠN", "Công nợ ÂM"):
 * - Nguồn duy nhất là `receivables`: mỗi hoá đơn đã ghi sổ một phiếu, nợ đầu kỳ, dòng âm của
 *   phiếu trả tự lập (`return_id`). Không bao giờ lấy tổng đơn hàng.
 * - Nợ = Σ(amount − paid), KHÔNG kẹp từng dòng về 0 — khách dư có thì tổng của khách âm.
 *
 * ⚠ TÍNH LÙI VỀ NGÀY X: nợ tại X của một phiếu = amount − paid(hiện tại) + Σ khoản thu SAU X.
 *   Chỉ tính phiếu phát sinh ≤ X (ngày hoá đơn; phiếu không có hoá đơn thì ngày tạo). Phiếu đã
 *   tất toán hôm nay mà còn thu sau X thì vẫn đang nợ ở X — đọc nó qua các khoản thu sau X.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { vnDateOf } from "@/lib/analytics/sales"
import { congNgay, soNgay } from "./ky"
import type { DanhMucBC } from "./cong"

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

export interface PhieuNoTho {
  id: string
  customer_id: string
  sales_user_id: string | null
  invoice_id: string | null
  return_id?: string | null
  amount: number
  paid: number | null
  due_date: string | null
  status: string | null
  created_at: string
  invoice?: { invoice_code: string | null; invoice_date: string | null } | null
}

export interface KhoanThuTho {
  id: string
  amount: number
  method: string | null
  collected_at: string
  receivable_id: string
  receivable?: PhieuNoTho | null
}

export interface PhieuNoTai {
  id: string
  kh: string
  nv: string
  hd: string | null
  ma: string
  ngay: string
  han: string
  /** Còn phải thu tại X (âm = dư có). */
  con: number
  /** Số ngày quá hạn tại X (≤ 0 = trong hạn). */
  qua: number
}

export const NHOM_TUOI = ["Trong hạn", "1–30 ngày", "31–60 ngày", "61–90 ngày", "Trên 90 ngày"] as const
export const nhomTuoi = (qua: number) => (qua <= 0 ? 0 : qua <= 30 ? 1 : qua <= 60 ? 2 : qua <= 90 ? 3 : 4)

export interface NoKhach {
  kh: string
  nv: string
  no: number
  qua: number
  /** Số ngày quá hạn lâu nhất. */
  lauNhat: number
  hanMuc: number
  thuCuoi: string
  tuoi: number[]
  tinhTrang: string[]
  phieu: PhieuNoTai[]
}

const ngayPhieu = (r: PhieuNoTho) => (r.invoice?.invoice_date ? String(r.invoice.invoice_date).slice(0, 10) : vnDateOf(r.created_at))

/** Phần thuần — test được. */
export function noTaiNgay(p: {
  X: string
  phieu: readonly PhieuNoTho[]
  /** Khoản thu SAU ngày X (kèm phiếu nợ của nó). */
  thuSau: readonly KhoanThuTho[]
  /** Khoản thu ≤ X (để lấy "lần thu cuối"). */
  thuTruoc: readonly KhoanThuTho[]
  dm: DanhMucBC
}): { phieu: PhieuNoTai[]; khach: NoKhach[] } {
  const { X, dm } = p
  const theoId = new Map<string, PhieuNoTho>()
  for (const r of p.phieu) theoId.set(r.id, r)
  const cong = new Map<string, number>()
  for (const t of p.thuSau) {
    if (t.receivable && !theoId.has(t.receivable_id)) theoId.set(t.receivable_id, t.receivable)
    cong.set(t.receivable_id, (cong.get(t.receivable_id) || 0) + Number(t.amount || 0))
  }
  const phieu: PhieuNoTai[] = []
  for (const r of Array.from(theoId.values())) {
    const ngay = ngayPhieu(r)
    if (ngay > X) continue
    const conHienTai = r.status === "paid" ? 0 : Number(r.amount || 0) - Number(r.paid || 0)
    const con = Math.round(conHienTai + (cong.get(r.id) || 0))
    if (!con) continue
    const hanNo = dm.khach.get(r.customer_id)?.hanNo || 0
    const han = r.due_date ? String(r.due_date).slice(0, 10) : congNgay(ngay, hanNo)
    phieu.push({ id: r.id, kh: r.customer_id, nv: r.sales_user_id || "", hd: r.invoice_id, ma: r.invoice?.invoice_code || (r.return_id ? "Phiếu trả" : "Nợ đầu kỳ"), ngay, han, con, qua: soNgay(han, X) })
  }
  const thuCuoi = new Map<string, string>()
  for (const t of p.thuTruoc) {
    const kh = t.receivable?.customer_id
    const d = vnDateOf(t.collected_at)
    if (kh && d <= X && d > (thuCuoi.get(kh) || "")) thuCuoi.set(kh, d)
  }
  const theoKhach = new Map<string, PhieuNoTai[]>()
  for (const x of phieu) {
    const a = theoKhach.get(x.kh)
    if (a) a.push(x)
    else theoKhach.set(x.kh, [x])
  }
  const khach: NoKhach[] = []
  theoKhach.forEach((ds, kh) => {
    const c = dm.khach.get(kh)
    let no = 0, qua = 0, lauNhat = 0
    const tuoi = [0, 0, 0, 0, 0]
    for (const x of ds) {
      no += x.con
      if (x.con > 0) {
        tuoi[nhomTuoi(x.qua)] += x.con
        if (x.qua > 0) {
          qua += x.con
          lauNhat = Math.max(lauNhat, x.qua)
        }
      }
    }
    const hanMuc = c?.hanMuc || 0
    const tinhTrang: string[] = []
    if (qua > 0) tinhTrang.push("Quá hạn")
    if (hanMuc > 0 && no > hanMuc) tinhTrang.push("Vượt hạn mức")
    if (no < 0) tinhTrang.push("Dư có")
    // Nhân viên của khách: người phụ trách; không có thì NV của phiếu nợ mới nhất.
    const nv = c?.nv || ds.slice().sort((a, b) => b.ngay.localeCompare(a.ngay))[0]?.nv || ""
    khach.push({ kh, nv, no, qua, lauNhat, hanMuc, thuCuoi: thuCuoi.get(kh) || "", tuoi, tinhTrang, phieu: ds })
  })
  return { phieu, khach }
}

const COT_PHIEU = "id, customer_id, sales_user_id, invoice_id, return_id, amount, paid, due_date, status, created_at, invoice:sales_invoices(invoice_code, invoice_date)"

export interface SoCongNo {
  phieu: PhieuNoTai[]
  khach: NoKhach[]
  /** Khoản thu trong tháng của X, theo nhân viên (tỉ lệ thu). */
  thuThang: Map<string, number>
  /** Doanh số (tiền phiếu nợ dương) 90 ngày tới X, theo nhân viên (số ngày thu tiền TB). */
  ban90: Map<string, number>
  thieu: boolean
}

export async function napCongNo(sb: SupabaseClient, orgId: string, X: string, dm: DanhMucBC): Promise<SoCongNo> {
  /** `tu` = null: mọi phiếu chưa tất toán; có `tu`: mọi phiếu tạo từ ngày đó (kể cả đã tất toán). */
  const docPhieu = (tu: string | null, ten: string) =>
    docDuHoacNem<PhieuNoTho>((from, to): Trang => {
      const q = sb.from("receivables").select(COT_PHIEU, { count: "exact" }).eq("org_id", orgId)
      const q2 = tu ? q.gte("created_at", `${tu}T00:00:00+07:00`) : q.neq("status", "paid")
      return q2.order("id").range(from, to) as unknown as Trang
    }, ten)
  const docThu = (tu: string, den: string | null, ten: string) =>
    docDuHoacNem<KhoanThuTho>((from, to): Trang => {
      let q = sb
        .from("payments")
        .select(`id, amount, method, collected_at, receivable_id, receivable:receivables(${COT_PHIEU})`, { count: "exact" })
        .gte("collected_at", `${tu}T00:00:00+07:00`)
      if (den) q = q.lte("collected_at", `${den}T23:59:59.999+07:00`)
      return q.order("id").range(from, to) as unknown as Trang
    }, ten)
  const dauThang = X.slice(0, 8) + "01"
  const tuThu = [congNgay(X, -180), dauThang].sort()[0]
  const [mo, thuTu, gan90] = await Promise.all([
    docPhieu(null, "đọc công nợ chưa tất toán"),
    docThu(tuThu, null, "đọc khoản thu"),
    docPhieu(congNgay(X, -91), "đọc phiếu nợ 90 ngày"),
  ])
  // `tuThu` ≤ X nên mọi khoản thu SAU X đều đã nằm trong lượt đọc này.
  const thuSau = thuTu.rows.filter((t) => vnDateOf(t.collected_at) > X)
  const thieu = mo.truncated || thuTu.truncated || gan90.truncated
  const thuTruoc = thuTu.rows.filter((t) => vnDateOf(t.collected_at) <= X)
  const { phieu, khach } = noTaiNgay({ X, phieu: mo.rows, thuSau, thuTruoc, dm })
  const thuThang = new Map<string, number>()
  for (const t of thuTruoc) {
    if (vnDateOf(t.collected_at) < dauThang) continue
    const nv = t.receivable?.sales_user_id || ""
    thuThang.set(nv, (thuThang.get(nv) || 0) + Number(t.amount || 0))
  }
  const ban90 = new Map<string, number>()
  for (const r of gan90.rows) {
    const d = ngayPhieu(r)
    if (d > X || d <= congNgay(X, -90) || Number(r.amount) <= 0 || !r.invoice_id) continue
    const nv = r.sales_user_id || ""
    ban90.set(nv, (ban90.get(nv) || 0) + Number(r.amount || 0))
  }
  return { phieu, khach, thuThang, ban90, thieu }
}

export interface SuKienSo {
  ngay: string
  ma: string
  dien: string
  no: number
  co: number
  du: number
  mo: { loai: "hd" | "tra" | "thu"; id: string } | null
}

/** Sổ chi tiết một khách: 60 ngày tới X, nợ – có – số dư chạy. */
export async function napSoChiTiet(sb: SupabaseClient, kh: string, X: string, duCuoi: number): Promise<{ dau: number; tu: string; ds: SuKienSo[] }> {
  const tu = congNgay(X, -59)
  const [ps, ts] = await Promise.all([
    docDuHoacNem<PhieuNoTho>(
      (from, to): Trang =>
        sb.from("receivables").select(COT_PHIEU, { count: "exact" }).eq("customer_id", kh).gte("created_at", `${congNgay(tu, -1)}T00:00:00+07:00`).order("id").range(from, to) as unknown as Trang,
      "đọc sổ công nợ khách"
    ),
    docDuHoacNem<{ id: string; amount: number; method: string | null; collected_at: string; receivable_id: string }>(
      (from, to): Trang =>
        sb
          .from("payments")
          .select("id, amount, method, collected_at, receivable_id, receivable:receivables!inner(customer_id)", { count: "exact" })
          .eq("receivable.customer_id", kh)
          .gte("collected_at", `${tu}T00:00:00+07:00`)
          .lte("collected_at", `${X}T23:59:59.999+07:00`)
          .order("id")
          .range(from, to) as unknown as Trang,
      "đọc khoản thu của khách"
    ),
  ])
  const ds: Omit<SuKienSo, "du">[] = []
  for (const r of ps.rows) {
    const d = ngayPhieu(r)
    if (d < tu || d > X) continue
    const amt = Number(r.amount || 0)
    ds.push({
      ngay: d,
      ma: r.invoice?.invoice_code || (r.return_id ? "Phiếu trả" : "Nợ đầu kỳ"),
      dien: r.return_id ? "Trả hàng (ghi có)" : r.invoice_id ? "Hoá đơn bán hàng" : "Nợ đầu kỳ",
      no: amt > 0 ? amt : 0,
      co: amt < 0 ? -amt : 0,
      mo: r.invoice_id ? { loai: "hd", id: r.invoice_id } : r.return_id ? { loai: "tra", id: r.return_id } : null,
    })
  }
  for (const t of ts.rows) {
    const amt = Number(t.amount || 0)
    ds.push({
      ngay: vnDateOf(t.collected_at),
      ma: "Thu tiền",
      dien: `Thu tiền · ${t.method === "cash" ? "Tiền mặt" : t.method === "transfer" ? "Chuyển khoản" : t.method || ""}${amt < 0 ? " (rút dư có)" : ""}`,
      no: amt < 0 ? -amt : 0,
      co: amt > 0 ? amt : 0,
      mo: { loai: "thu", id: t.id },
    })
  }
  ds.sort((a, b) => a.ngay.localeCompare(b.ngay) || (a.no ? -1 : 1))
  const dau = duCuoi - ds.reduce((s, e) => s + e.no - e.co, 0)
  let du = dau
  const out = ds.map((e) => ({ ...e, du: (du += e.no - e.co) }))
  return { dau, tu, ds: out }
}
