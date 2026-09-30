/**
 * DANH SÁCH SẢN PHẨM TRÊN ĐIỆN THOẠI — logic thuần của màn theo thiết kế "ds-san-pham"
 * (chủ nhà 30/09/2026: "Làm lại các màn … Danh sách sản phẩm").
 *
 * Hàng chip theo NCC CHÍNH của sản phẩm (`products.primary_supplier_id`) có số — đếm ở máy chủ
 * (`select=primary_supplier_id,status,count()`, mig 206) cùng mọi bộ lọc của danh sách trừ NCC.
 */

/** Một nhóm đếm: NCC chính (null = chưa gán) × trạng thái. */
export interface DemNccDong {
  ncc: string | null
  status: string
  n: number
}

/** Khoá chip "chưa gán NCC" — trang lọc bằng `.is("primary_supplier_id", null)`. */
export const NCC_CHUA_GAN = "none"

/** Đọc kết quả gom nhóm `primary_supplier_id, status, count()`. `null` = máy chủ chưa gom được. */
export function docDemNcc(kq: { data: unknown; error: unknown }): DemNccDong[] | null {
  if (kq.error || !Array.isArray(kq.data)) return null
  const out: DemNccDong[] = []
  for (const r of kq.data as Array<Record<string, unknown>>) {
    const n = Number(r?.count)
    if (r == null || r.count == null || !Number.isFinite(n) || typeof r.status !== "string") return null
    const ncc = r.primary_supplier_id
    out.push({ ncc: typeof ncc === "string" && ncc ? ncc : null, status: r.status, n })
  }
  return out
}

/** Đường lùi: đếm từ các dòng `{ primary_supplier_id, status }` đã tải hết. */
export function demNccTuDong(rows: Array<{ primary_supplier_id?: string | null; status?: string | null }>): DemNccDong[] {
  const m = new Map<string, DemNccDong>()
  for (const r of rows) {
    const ncc = r.primary_supplier_id || null
    const status = r.status ?? ""
    const k = `${ncc ?? ""}|${status}`
    const g = m.get(k) ?? { ncc, status, n: 0 }
    g.n++
    m.set(k, g)
  }
  return Array.from(m.values())
}

/** Số sản phẩm đang bán trong các nhóm đếm (dòng phụ "N đang bán" của đầu xanh). */
export function soDangBan(dem: DemNccDong[]): number {
  return dem.reduce((s, d) => s + (d.status === "active" ? d.n : 0), 0)
}

export interface ChipNcc {
  key: string
  label: string
  count: number
}

/**
 * Chip "Tất cả N" + mỗi NCC có hàng (nhiều hàng trước, bằng nhau thì theo tên), "Chưa gán NCC"
 * cuối cùng. `status` = bộ lọc trạng thái của trang ("all" = mọi trạng thái).
 */
export function chipNcc(dem: DemNccDong[], suppliers: Array<{ id: string; name: string }>, status: string): ChipNcc[] {
  const ten = new Map(suppliers.map((s) => [s.id, s.name]))
  const theoNcc = new Map<string, number>()
  let chuaGan = 0
  let tong = 0
  for (const d of dem) {
    if (status !== "all" && d.status !== status) continue
    tong += d.n
    if (d.ncc === null) chuaGan += d.n
    else theoNcc.set(d.ncc, (theoNcc.get(d.ncc) ?? 0) + d.n)
  }
  const ds: ChipNcc[] = Array.from(theoNcc.entries())
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ key: id, label: ten.get(id) ?? "NCC khác", count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"))
  const out: ChipNcc[] = [{ key: "all", label: "Tất cả", count: tong }, ...ds]
  if (chuaGan > 0) out.push({ key: NCC_CHUA_GAN, label: "Chưa gán NCC", count: chuaGan })
  return out
}

/** Dòng phụ của thẻ: "SKU · đơn vị · NCC" — bỏ phần trống. */
export function dongPhuSanPham(p: { sku?: string | null; base_unit?: string | null; supplier?: { name?: string | null } | null }): string {
  return [p.sku, p.base_unit, p.supplier?.name].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ")
}

/** Sắp xếp của màn điện thoại — theo tên (máy chủ `order=name`). */
export type SapXepSanPham = "name_asc" | "name_desc"
export const NHAN_SAP_XEP_SP: Record<SapXepSanPham, string> = { name_asc: "Tên A–Z", name_desc: "Tên Z–A" }
export const sapXepTiepTheo = (s: SapXepSanPham): SapXepSanPham => (s === "name_asc" ? "name_desc" : "name_asc")

const soVN = (n: number) => n.toLocaleString("vi-VN")

/** "1.751 sản phẩm". */
export const nhanSoSanPham = (n: number) => `${soVN(n)} sản phẩm`

/** "Xem thêm · đang hiện 20/1.751"; `null` khi đã hiện hết. */
export function nhanXemThem(dangHien: number, tong: number): string | null {
  if (dangHien >= tong) return null
  return `Xem thêm · đang hiện ${soVN(dangHien)}/${soVN(tong)}`
}
