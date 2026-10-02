/**
 * LƯỢT SOẠN HÀNG — lõi thuần của màn Kho vận › Soạn hàng (máy tính + điện thoại, mig 225).
 *
 * ⚠ CHỦ NHÀ 02/10/2026: "thiết kế màn soạn hàng các tính năng kiểu như giao diện mẫu này" — chọn hoá đơn →
 *   NHẶT TỔNG theo kệ (hoặc nhà cung cấp) → CHIA vào rổ A, B, C… theo từng đơn → Hoàn tất soạn (đánh dấu hoá đơn
 *   đã soạn, không trừ kho). Thiếu hàng: "Ghi thiếu, báo để sửa HĐ" — chia đủ theo thứ tự rổ, rổ sau thiếu.
 *
 * ⚠ SỐ LƯỢNG QUY VỀ ĐƠN VỊ CƠ SỞ trước khi cộng (luật báo cáo 24/09/2026): 2 thùng + 5 gói ≠ "7". Hệ số lấy
 *   trên dòng hoá đơn. Dòng HÀNG ĐỔI cũng rời kho → tính vào, đánh dấu riêng (như phiếu soạn cũ).
 */
import { tachDonVi, type ProductUnits } from "@/lib/orders/pick-list"

export const CHU_RO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
export const TOI_DA_RO = CHU_RO.length

export interface HdSoan {
  id: string
  ma: string
  khach: string
  tuyen?: string | null
  tong?: number
}

export interface DongHdSoan {
  invoiceId: string
  productId: string
  ten: string
  sku: string | null
  viTri: string | null
  ncc: string | null
  donVi: string
  heSo: number
  sl: number
  doi?: boolean
}

export interface PhanRo {
  invoiceId: string
  ro: string
  ma: string
  khach: string
  /** SL đơn vị cơ sở của rổ này. */
  sl: number
}

export interface DongNhat {
  productId: string
  ten: string
  sku: string | null
  viTri: string | null
  ncc: string | null
  donViCoSo: string
  /** Tổng cần nhặt — đơn vị cơ sở. */
  tong: number
  phan: PhanRo[]
  coDoi: boolean
  sp?: ProductUnits
}

export interface TienDo {
  /** SL cơ sở đã nhặt của từng mặt hàng (thiếu thì < tổng). Chưa nhặt = không có khoá. */
  nhat: Record<string, number>
  /** `<product_id>|<invoice_id>` → đã bỏ vào rổ. */
  chia: Record<string, boolean>
}

export const TIEN_DO_RONG: TienDo = { nhat: {}, chia: {} }
export const khoaChia = (productId: string, invoiceId: string) => `${productId}|${invoiceId}`

/** Đọc tiến độ từ jsonb máy chủ — sai dạng thì coi như rỗng (không vỡ màn). */
export function docTienDo(x: unknown): TienDo {
  const o = (x && typeof x === "object" ? x : {}) as { nhat?: unknown; chia?: unknown }
  const nhat: Record<string, number> = {}
  const chia: Record<string, boolean> = {}
  if (o.nhat && typeof o.nhat === "object") for (const [k, v] of Object.entries(o.nhat)) if (Number.isFinite(Number(v)) && v !== null) nhat[k] = Number(v)
  if (o.chia && typeof o.chia === "object") for (const [k, v] of Object.entries(o.chia)) if (v === true) chia[k] = true
  return { nhat, chia }
}

const so = (n: number) => Math.round(n * 1e6) / 1e6

/** Gộp dòng các hoá đơn (theo thứ tự = rổ A, B…) thành dòng nhặt, xếp theo vị trí kệ (chưa có vị trí xuống cuối). */
export function dungDongNhat(hd: readonly HdSoan[], dong: readonly DongHdSoan[], sp: Readonly<Record<string, ProductUnits>> = {}): DongNhat[] {
  const roCua = new Map(hd.slice(0, TOI_DA_RO).map((h, i) => [h.id, { ro: CHU_RO[i], h }]))
  const m = new Map<string, DongNhat>()
  for (const l of dong) {
    const r = roCua.get(l.invoiceId)
    const q = Number(l.sl) || 0
    if (!r || q <= 0 || !l.productId) continue
    const heSo = Number(l.heSo) > 0 ? Number(l.heSo) : 1
    let d = m.get(l.productId)
    if (!d) {
      const u = sp[l.productId]
      d = {
        productId: l.productId, ten: l.ten, sku: l.sku, viTri: l.viTri?.trim() || null, ncc: l.ncc?.trim() || null,
        donViCoSo: u?.base_unit || (heSo === 1 ? l.donVi : "") || "đv cơ sở", tong: 0, phan: [], coDoi: false, sp: u,
      }
      m.set(l.productId, d)
    }
    d.tong = so(d.tong + q * heSo)
    if (l.doi) d.coDoi = true
    const p = d.phan.find((x) => x.invoiceId === l.invoiceId)
    if (p) p.sl = so(p.sl + q * heSo)
    else d.phan.push({ invoiceId: l.invoiceId, ro: r.ro, ma: r.h.ma, khach: r.h.khach, sl: so(q * heSo) })
  }
  const ds = Array.from(m.values())
  for (const d of ds) d.phan.sort((a, b) => a.ro.localeCompare(b.ro))
  return ds.sort((a, b) => {
    if (!!a.viTri !== !!b.viTri) return a.viTri ? -1 : 1
    return (a.viTri ?? "").localeCompare(b.viTri ?? "", "vi", { numeric: true }) || (a.sku ?? a.ten).localeCompare(b.sku ?? b.ten, "vi")
  })
}

/** "A1-03" → "Kệ A"; "TĐ-01" → "Kệ TĐ"; rỗng → "Chưa có vị trí kệ". */
export function khuKe(viTri: string | null | undefined): string {
  const v = (viTri ?? "").trim()
  if (!v) return "Chưa có vị trí kệ"
  const m = /^([^\d\s-]+)/.exec(v)
  return `Kệ ${(m ? m[1] : v.split(/[-\s]/)[0]).toLocaleUpperCase("vi")}`
}

export type NhomTheo = "ke" | "ncc"

/** Nhóm dòng nhặt theo khu kệ (đúng đường đi) hoặc nhà cung cấp (A→Z). */
export function nhomDong(rows: readonly DongNhat[], theo: NhomTheo): { ten: string; rows: DongNhat[] }[] {
  const m = new Map<string, DongNhat[]>()
  for (const r of rows) {
    const k = theo === "ke" ? khuKe(r.viTri) : r.ncc || "Chưa có nhà cung cấp"
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  const out = Array.from(m, ([ten, rows]) => ({ ten, rows }))
  return theo === "ncc" ? out.sort((a, b) => a.ten.localeCompare(b.ten, "vi")) : out
}

/** Chia số đã nhặt vào các rổ THEO THỨ TỰ rổ — thiếu thì rổ sau thiếu (như mẫu). Chưa nhặt = chia đủ. */
export function chiaVaoRo(d: DongNhat, daNhat?: number): (PhanRo & { duoc: number })[] {
  let con = daNhat ?? d.tong
  return d.phan.map((p) => {
    const duoc = so(Math.min(p.sl, Math.max(con, 0)))
    con = so(con - duoc)
    return { ...p, duoc }
  })
}

export interface TongKet {
  soMat: number
  daNhat: number
  /** Ô cần chia (rổ có hàng sau khi trừ thiếu). */
  soO: number
  daChia: number
  /** Rổ đã đủ mọi ô. */
  roDu: Set<string>
  xongNhat: boolean
  xongChia: boolean
  /** Mặt hàng nhặt thiếu. */
  matThieu: number
}

export function tongKet(rows: readonly DongNhat[], t: TienDo): TongKet {
  let daNhat = 0
  let soO = 0
  let daChia = 0
  let matThieu = 0
  const oCuaRo = new Map<string, { n: number; d: number }>()
  for (const r of rows) {
    const g = t.nhat[r.productId]
    if (g !== undefined) {
      daNhat++
      if (g < r.tong) matThieu++
    }
    for (const p of chiaVaoRo(r, g)) {
      if (p.duoc <= 0) continue
      soO++
      const on = !!t.chia[khoaChia(r.productId, p.invoiceId)]
      if (on) daChia++
      const o = oCuaRo.get(p.invoiceId) ?? { n: 0, d: 0 }
      o.n++
      if (on) o.d++
      oCuaRo.set(p.invoiceId, o)
    }
  }
  const roDu = new Set(Array.from(oCuaRo).filter(([, o]) => o.n > 0 && o.d === o.n).map(([id]) => id))
  const xongNhat = rows.length > 0 && daNhat === rows.length
  return { soMat: rows.length, daNhat, soO, daChia, roDu, xongNhat, xongChia: xongNhat && soO > 0 && daChia === soO, matThieu }
}

/** Hiện SL: "2 thùng + 5 gói" / phụ "= 35 gói" (chỉ khi có đơn vị lớn). */
export function hienSoLuong(q: number, d: Pick<DongNhat, "sp" | "donViCoSo">): { chinh: string; phu: string } {
  const f = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(n)
  const t = tachDonVi(q, d.sp, d.donViCoSo)
  const chinh = t.map((x) => `${f(x.qty)} ${x.unitName}`).join(" + ")
  const coLon = t.some((x) => x.unitName !== d.donViCoSo)
  return { chinh, phu: coLon ? `= ${f(q)} ${d.donViCoSo}` : "" }
}

/** Dòng thiếu của từng hoá đơn: "Thiếu 3 gói · Kẹo dẻo" — cho bước kiểm tra (báo để sửa HĐ). */
export function thieuTheoHd(rows: readonly DongNhat[], t: TienDo): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const g = t.nhat[r.productId]
    if (g === undefined || g >= r.tong) continue
    for (const p of chiaVaoRo(r, g)) {
      if (p.duoc >= p.sl) continue
      const a = out.get(p.invoiceId) ?? []
      a.push(`Thiếu ${so(p.sl - p.duoc)} ${r.donViCoSo} · ${r.ten}`)
      out.set(p.invoiceId, a)
    }
  }
  return out
}

/** Mặt hàng chưa nhặt kế tiếp sau `tu` (vòng lại đầu); -1 = đã nhặt hết. */
export function chuaNhatKeTiep(rows: readonly DongNhat[], t: TienDo, tu: number): number {
  const n = rows.length
  for (let k = 1; k <= n; k++) {
    const i = (tu + k + n) % n
    if (t.nhat[rows[i].productId] === undefined) return i
  }
  return -1
}

/** Dòng còn ô chưa chia kế tiếp sau `tu`; -1 = đã chia hết. */
export function chuaChiaKeTiep(rows: readonly DongNhat[], t: TienDo, tu: number): number {
  const n = rows.length
  for (let k = 1; k <= n; k++) {
    const i = (tu + k + n) % n
    const r = rows[i]
    if (chiaVaoRo(r, t.nhat[r.productId]).some((p) => p.duoc > 0 && !t.chia[khoaChia(r.productId, p.invoiceId)])) return i
  }
  return -1
}

/** Vai được soạn hàng — đúng luật RPC mig 225. */
export const duocSoanHang = (role: string | null | undefined) =>
  role === "owner" || role === "manager" || role === "warehouse" || role === "accountant"

/** Câu lỗi tiếng Việt cho mã lỗi mig 225. */
export function loiLuotSoan(msg: string | null | undefined): string {
  const m = String(msg ?? "")
  if (m.includes("KHONG_DU_QUYEN")) return "Chỉ chủ NPP, quản lý, thủ kho, kế toán được soạn hàng."
  if (m.includes("QUA_NHIEU_RO")) return "Một lượt soạn tối đa 26 hoá đơn (rổ A–Z)."
  if (m.includes("HOA_DON_KHONG_HOP_LE")) return "Có hoá đơn chưa ghi sổ / đã huỷ — bỏ ra khỏi lượt."
  if (m.includes("LUOT_DA_DONG")) return "Lượt soạn này đã hoàn tất hoặc đã huỷ."
  if (m.includes("CHUA_CHON_HOA_DON")) return "Chưa chọn hoá đơn nào."
  if (/luot_soan|tao_luot_soan|cap_nhat_luot_soan/.test(m) && /exist|schema cache|PGRST20/i.test(m)) return "Máy chủ chưa chạy migration 225 (lượt soạn hàng)."
  return m || "Lỗi không xác định"
}
