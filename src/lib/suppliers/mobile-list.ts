/**
 * DANH SÁCH NHÀ CUNG CẤP TRÊN ĐIỆN THOẠI — logic thuần của thiết kế "ds-ncc" (chủ nhà 30/09/2026).
 *
 *  · Nhóm theo CHỮ CÁI GỐC không dấu: "Á Châu", "Ăn Cùng", "An Phát" chung nhóm A (như thiết kế);
 *    riêng Đ là chữ cái riêng — nhóm Đ đứng sau D (thiết kế có nhóm "Đ"). Không phải chữ → nhóm "#" cuối.
 *  · Trong nhóm xếp theo tiếng Việt (`localeCompare(…, "vi")`).
 *  · Trùng tên: so KHÔNG DẤU, không phân biệt hoa thường, bỏ khoảng trắng thừa (`viNormalize`).
 */
import { viNormalize } from "@/lib/search"

export interface NccTen {
  id: string
  name: string | null
}

/** Khoá so trùng tên — "  Detech  CONNAI " ≡ "Detech Connai" ≡ "Detech Connái". */
export const khoaTrungTen = (name: string | null | undefined): string => viNormalize(name ?? "")

/** Chữ cái đầu cho ô vuông — GIỮ dấu ("Á", "Ă", "Đ"). */
export function chuCaiDau(name: string | null | undefined): string {
  const s = (name ?? "").trim().normalize("NFC")
  const c = Array.from(s)[0]
  return c ? c.toLocaleUpperCase("vi") : "?"
}

/** Khoá nhóm: chữ cái gốc không dấu (A–Z), Đ riêng, còn lại "#". */
export function khoaNhomChuCai(name: string | null | undefined): string {
  const c = chuCaiDau(name)
  if (c === "Đ") return "Đ"
  const goc = c.normalize("NFD").replace(/[̀-ͯ]/g, "")
  return /^[A-Z]$/.test(goc) ? goc : "#"
}

/** Thứ tự nhóm: A … D, Đ, E … Z, #. */
function hangNhom(k: string): number {
  if (k === "#") return 1000
  if (k === "Đ") return ("D".charCodeAt(0) - 65) * 2 + 1
  return (k.charCodeAt(0) - 65) * 2
}

export interface NhomChuCai<T> {
  chu: string
  items: T[]
}

export function nhomTheoChuCai<T extends { name: string | null }>(rows: readonly T[]): NhomChuCai<T>[] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = khoaNhomChuCai(r.name)
    const ds = map.get(k)
    if (ds) ds.push(r)
    else map.set(k, [r])
  }
  return Array.from(map.entries())
    .sort((a, b) => hangNhom(a[0]) - hangNhom(b[0]))
    .map(([chu, items]) => ({
      chu,
      items: [...items].sort((a, b) => (a.name ?? "").trim().localeCompare((b.name ?? "").trim(), "vi")),
    }))
}

export interface TrungTen {
  /** Mỗi tên bị trùng một nhóm — `ten` là tên hiện (của bản ghi đầu), `ids` ≥ 2. */
  nhom: Array<{ ten: string; ids: string[] }>
  /** Khoá (`khoaTrungTen`) của các tên bị trùng — để gắn huy hiệu "Trùng tên". */
  khoa: Set<string>
  /** Mọi mã NCC nằm trong một nhóm trùng. */
  ids: string[]
}

export function timTrungTen(rows: readonly NccTen[]): TrungTen {
  const map = new Map<string, { ten: string; ids: string[] }>()
  for (const r of rows) {
    const k = khoaTrungTen(r.name)
    if (!k) continue
    const g = map.get(k)
    if (g) g.ids.push(r.id)
    else map.set(k, { ten: (r.name ?? "").trim().replace(/\s+/g, " "), ids: [r.id] })
  }
  const nhom: TrungTen["nhom"] = []
  const khoa = new Set<string>()
  for (const [k, g] of Array.from(map.entries())) {
    if (g.ids.length < 2) continue
    nhom.push(g)
    khoa.add(k)
  }
  nhom.sort((a, b) => a.ten.localeCompare(b.ten, "vi"))
  return { nhom, khoa, ids: nhom.flatMap((g) => g.ids) }
}

const soVN = (n: number) => n.toLocaleString("vi-VN")

/** Băng cảnh báo: "1 nhà cung cấp bị trùng tên" · "Detech Connai" (nhiều tên thì nối bằng dấu phẩy). */
export function nhanTrungTen(t: TrungTen): { tieuDe: string; phu: string } | null {
  if (t.nhom.length === 0) return null
  return {
    tieuDe: `${soVN(t.nhom.length)} nhà cung cấp bị trùng tên`,
    phu: t.nhom.map((g) => g.ten).join(", "),
  }
}

/** "62 nhà cung cấp". */
export const nhanSoNcc = (n: number) => `${soVN(n)} nhà cung cấp`

/**
 * Dòng phụ của một NCC. Thiết kế ghi loại hình ("Công ty", "Công ty cổ phần") nhưng bảng `suppliers`
 * không có trường loại hình → dùng mã · SĐT.
 */
export function dongPhuNcc(s: { code?: string | null; phone?: string | null }): string {
  return [s.code, s.phone].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ")
}
