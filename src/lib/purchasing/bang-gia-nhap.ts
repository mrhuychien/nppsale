/**
 * BẢNG GIÁ NHẬP HÀNG (mig 234) — chủ nhà 06/10/2026: "Làm thêm phần bảng giá nhập hàng -> lưu giá nhập load lại khi
 * làm đơn, nếu giá có thay đổi thì tự cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)".
 *
 * - Bảng `purchase_price_lists`: một giá cho mỗi (mặt hàng, đơn vị) — giá của ĐÚNG đơn vị đó.
 * - Phiếu nhập hoàn thành → máy chủ tự ghi giá theo phiếu (trigger `trg_gia_nhap_tu_phieu`); sửa tay qua RPC
 *   `luu_gia_nhap`. Ở đây chỉ ĐỌC và tính GIÁ GỢI Ý khi thêm hàng vào phiếu — ô giá trên phiếu vẫn sửa tự do.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

export interface GiaNhap {
  unit_name: string
  price: number
}

export interface DongGiaNhap extends GiaNhap {
  product_id: string
  effective_date: string | null
  updated_at: string | null
  source_invoice_id: string | null
  invoice?: { receipt_code?: string | null } | null
}

/** Mặt hàng đủ để quy đổi đơn vị. `gia_nhap` = giá nhập đã lưu của mặt hàng (gắn bằng `ganGiaNhap`). */
export interface HangCoGiaNhap {
  base_unit: string
  units?: ReadonlyArray<{ unit_name: string; conversion: number | string | null }> | null
  cost_price?: number | string | null
  gia_nhap?: ReadonlyArray<GiaNhap> | null
}

const so = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Hệ số quy đổi của đơn vị (đơn vị cơ sở = 1; đơn vị lạ = 1). */
export function heSo(p: Pick<HangCoGiaNhap, "base_unit" | "units">, unit: string): number {
  if (unit === p.base_unit) return 1
  const u = (p.units ?? []).find((x) => x.unit_name === unit)
  return u && so(u.conversion) > 0 ? so(u.conversion) : 1
}

/**
 * Giá nhập gợi ý ở đơn vị `unit`:
 *   1. Bảng giá nhập có giá của ĐÚNG đơn vị này → giá đó (thùng có giá thùng riêng — không lấy giá hộp × 24).
 *   2. Có giá đơn vị cơ sở → × hệ số.
 *   3. Có giá đơn vị khác → quy về đơn vị cơ sở rồi × hệ số.
 *   4. Chưa có trong bảng → giá vốn mặc định của mặt hàng (`cost_price`, mỗi đơn vị cơ sở) × hệ số; không có → 0.
 */
export function giaNhapDonVi(p: HangCoGiaNhap, unit: string): number {
  const ds = (p.gia_nhap ?? []).filter((g) => so(g.price) > 0)
  const dung = ds.find((g) => g.unit_name === unit)
  if (dung) return Math.round(so(dung.price))
  const h = heSo(p, unit)
  const coSo = ds.find((g) => g.unit_name === p.base_unit)
  if (coSo) return Math.round(so(coSo.price) * h)
  const khac = ds.find((g) => (p.units ?? []).some((u) => u.unit_name === g.unit_name && so(u.conversion) > 0))
  if (khac) return Math.round((so(khac.price) / heSo(p, khac.unit_name)) * h)
  const c = so(p.cost_price)
  return c > 0 ? Math.round(c * h) : 0
}

export type BangGiaNhap = ReadonlyMap<string, GiaNhap[]>

/** Gắn giá nhập vào từng mặt hàng của danh mục (mảng mới, không sửa mảng cũ). */
export function ganGiaNhap<T extends { id: string }>(ds: readonly T[], bang: BangGiaNhap): Array<T & { gia_nhap?: GiaNhap[] }> {
  if (bang.size === 0) return ds as Array<T & { gia_nhap?: GiaNhap[] }>
  return ds.map((p) => {
    const g = bang.get(p.id)
    return g ? { ...p, gia_nhap: g } : p
  })
}

/** Bảng chưa có trên sổ (chưa chạy mig 234). */
export function laChuaCoBang(loi: string | null | undefined): boolean {
  return !!loi && /purchase_price_lists|42P01|PGRST205|does not exist|schema cache/i.test(loi)
}

export const CHON_GIA_NHAP =
  "id, product_id, unit_name, price, effective_date, updated_at, source_invoice_id, invoice:purchase_invoices(receipt_code)"

/**
 * Đọc đủ bảng giá nhập của NPP.
 * ⚠ Sổ chưa chạy mig 234 → bảng rỗng + `chuaCo` (màn phiếu nhập vẫn chạy như cũ, gợi ý theo giá vốn mặc định).
 */
export async function napBangGiaNhap(
  sb: SupabaseClient
): Promise<{ bang: Map<string, GiaNhap[]>; dong: DongGiaNhap[]; loi: string | null; chuaCo: boolean; truncated: boolean }> {
  const res = await fetchAllForAggregate<DongGiaNhap>((from, to) =>
    sb.from("purchase_price_lists").select(CHON_GIA_NHAP, { count: "exact" }).order("product_id").order("unit_name").order("id").range(from, to)
  )
  const bang = new Map<string, GiaNhap[]>()
  if (res.error) return { bang, dong: [], loi: res.error, chuaCo: laChuaCoBang(res.error), truncated: false }
  for (const r of res.rows) {
    const ds = bang.get(r.product_id)
    const g = { unit_name: r.unit_name, price: so(r.price) }
    if (ds) ds.push(g)
    else bang.set(r.product_id, [g])
  }
  return { bang, dong: res.rows, loi: null, chuaCo: false, truncated: res.truncated }
}

/** Một thay đổi trên màn Bảng giá nhập: giá mới (null = bỏ giá). */
export interface SuaGiaNhap {
  product_id: string
  unit_name: string
  price: number | null
}

/** Khoá (mặt hàng, đơn vị). */
export const khoaGia = (productId: string, unit: string) => `${productId}|${unit}`

/**
 * Các ô giá đã sửa → danh sách gửi `luu_gia_nhap`. Ô bỏ trống ở đơn vị đang có giá = bỏ giá; ô bỏ trống ở đơn vị chưa
 * có giá / gõ lại đúng giá cũ = không gửi.
 */
export function thayDoiGia(sua: ReadonlyMap<string, string>, cu: ReadonlyMap<string, number>): SuaGiaNhap[] {
  const out: SuaGiaNhap[] = []
  sua.forEach((v, k) => {
    const [product_id, ...dv] = k.split("|")
    const unit_name = dv.join("|")
    const t = v.trim()
    const truoc = cu.get(k)
    if (t === "") {
      if (truoc !== undefined) out.push({ product_id, unit_name, price: null })
      return
    }
    const n = Math.round(Number(t))
    if (!Number.isFinite(n) || n < 0) return
    if (truoc !== undefined && truoc === n) return
    out.push({ product_id, unit_name, price: n })
  })
  return out
}

/* ============================================================== MÀN BẢNG GIÁ NHẬP */

export interface HangBangGia {
  id: string
  name: string
  sku?: string | null
  base_unit: string
  status?: string | null
  cost_price?: number | string | null
  primary_supplier_id?: string | null
  units?: ReadonlyArray<{ unit_name: string; conversion: number | string | null }> | null
}

/** Một dòng của màn: một (mặt hàng, đơn vị). */
export interface DongBangGia {
  khoa: string
  productId: string
  sku: string
  ten: string
  nccId: string | null
  ncc: string
  donVi: string
  heSo: number
  laCoSo: boolean
  /** Giá đã lưu của ĐÚNG đơn vị này (null = chưa có). */
  gia: number | null
  /** Giá sẽ gợi ý khi lập phiếu (đã lưu, hoặc quy từ đơn vị khác / giá vốn mặc định). */
  goiY: number
  ngay: string | null
  nguon: { id: string; ma: string } | null
}

/** Mỗi mặt hàng × mỗi đơn vị (cơ sở trước) thành một dòng, xếp theo tên hàng. */
export function dungBangGia(
  hang: readonly HangBangGia[],
  dong: readonly DongGiaNhap[],
  tenNcc: ReadonlyMap<string, string>
): DongBangGia[] {
  const theoHang = new Map<string, DongGiaNhap[]>()
  for (const d of dong) {
    const ds = theoHang.get(d.product_id)
    if (ds) ds.push(d)
    else theoHang.set(d.product_id, [d])
  }
  const out: DongBangGia[] = []
  const xep = [...hang].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "vi"))
  for (const p of xep) {
    const ds = theoHang.get(p.id) ?? []
    const donVi = [p.base_unit, ...(p.units ?? []).map((u) => u.unit_name).filter((u) => u && u !== p.base_unit)]
    const coGia: HangCoGiaNhap = { ...p, gia_nhap: ds.map((d) => ({ unit_name: d.unit_name, price: so(d.price) })) }
    for (const dv of Array.from(new Set(donVi))) {
      const g = ds.find((d) => d.unit_name === dv)
      out.push({
        khoa: khoaGia(p.id, dv),
        productId: p.id,
        sku: p.sku ?? "",
        ten: p.name,
        nccId: p.primary_supplier_id ?? null,
        ncc: p.primary_supplier_id ? tenNcc.get(p.primary_supplier_id) ?? "" : "",
        donVi: dv,
        heSo: heSo(p, dv),
        laCoSo: dv === p.base_unit,
        gia: g ? so(g.price) : null,
        goiY: giaNhapDonVi(coGia, dv),
        ngay: g?.effective_date ?? null,
        nguon: g?.source_invoice_id ? { id: g.source_invoice_id, ma: g.invoice?.receipt_code || "phiếu nhập" } : null,
      })
    }
  }
  return out
}
