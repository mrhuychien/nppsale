/**
 * DANH SÁCH NHÂN VIÊN TRÊN ĐIỆN THOẠI — logic thuần của màn theo thiết kế "ds-nhan-vien"
 * (chủ nhà 30/09/2026: "Làm lại các màn").
 *
 * Hàng chip có số: "Đang hoạt động" · mỗi vai (trừ Chủ NPP) đang hoạt động · "Tạm khoá" · "Tất cả".
 * Số đếm tính trên danh sách ĐÃ LỌC theo ô tìm (như thiết kế); dòng phụ đầu xanh đếm trên toàn bộ.
 */

import { ROLE_LABELS } from "@/lib/constants"
import { normalizePhone } from "@/lib/users/phone"
import { trangThaiNv } from "@/lib/users/nghi-viec"

export interface NvDong {
  id: string
  full_name: string | null
  role: string
  phone?: string | null
  is_active?: boolean | null
  /** Đã nghỉ việc (mig 223) — chip riêng "Đã nghỉ", không lẫn vào "Tạm khoá". */
  left_at?: string | null
}

/** Khoá lọc: "active" | "locked" | "left" | "all" | "role:<vai>". */
export type LocNv = string

export const LOC_NV_MAC_DINH: LocNv = "active"

export interface ChipNv {
  key: LocNv
  label: string
  count: number
}

/** Thứ tự chip vai — như thiết kế: bán hàng, kho, kế toán, rồi quản lý; vai lạ xếp cuối theo tên. */
const THU_TU_VAI = ["sales", "warehouse", "accountant", "manager"]

const nhanVai = (role: string) => ROLE_LABELS[role] || role

/** Người này có khớp khoá lọc không. */
export function khopLocNv(u: NvDong, loc: LocNv): boolean {
  const tt = trangThaiNv(u)
  if (loc === "all") return true
  if (loc === "locked" || loc === "left") return tt === loc
  if (loc.startsWith("role:")) return tt === "active" && u.role === loc.slice(5)
  return tt === "active"
}

/**
 * Chip có số. Chip vai chỉ hiện khi có người (hoặc đang chọn); "Tạm khoá" chỉ hiện khi có người khoá
 * (hoặc đang chọn); "Đang hoạt động" và "Tất cả" luôn hiện.
 */
export function chipNhanVien(rows: NvDong[], loc: LocNv): ChipNv[] {
  const dang = rows.filter((u) => trangThaiNv(u) === "active")
  const theoVai = new Map<string, number>()
  for (const u of dang) {
    if (u.role === "owner") continue
    theoVai.set(u.role, (theoVai.get(u.role) ?? 0) + 1)
  }
  if (loc.startsWith("role:") && !theoVai.has(loc.slice(5))) theoVai.set(loc.slice(5), 0)
  const vai = Array.from(theoVai.keys()).sort((a, b) => {
    const ia = THU_TU_VAI.indexOf(a)
    const ib = THU_TU_VAI.indexOf(b)
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return nhanVai(a).localeCompare(nhanVai(b), "vi")
  })
  const khoa = rows.filter((u) => trangThaiNv(u) === "locked").length
  const nghi = rows.filter((u) => trangThaiNv(u) === "left").length
  const out: ChipNv[] = [{ key: "active", label: "Đang hoạt động", count: dang.length }]
  for (const r of vai) out.push({ key: `role:${r}`, label: nhanVai(r), count: theoVai.get(r) ?? 0 })
  if (khoa > 0 || loc === "locked") out.push({ key: "locked", label: "Tạm khoá", count: khoa })
  if (nghi > 0 || loc === "left") out.push({ key: "left", label: "Đã nghỉ", count: nghi })
  out.push({ key: "all", label: "Tất cả", count: rows.length })
  return out
}

/** Dòng phụ đầu xanh: "12 đang hoạt động · 1 tạm khoá · 2 đã nghỉ" (vế bằng 0 thì bỏ). */
export function dongPhuNhanVien(rows: NvDong[]): string {
  const dang = rows.filter((u) => trangThaiNv(u) === "active").length
  const khoa = rows.filter((u) => trangThaiNv(u) === "locked").length
  const nghi = rows.filter((u) => trangThaiNv(u) === "left").length
  return `${dang} đang hoạt động` + (khoa > 0 ? ` · ${khoa} tạm khoá` : "") + (nghi > 0 ? ` · ${nghi} đã nghỉ` : "")
}

/** Chủ NPP lên đầu, còn lại giữ thứ tự sẵn có (máy chủ đã xếp theo tên). */
export function sapXepNhanVien<T extends NvDong>(rows: T[]): T[] {
  return [...rows.filter((u) => u.role === "owner"), ...rows.filter((u) => u.role !== "owner")]
}

/**
 * Chữ viết tắt trong ô tròn — tên Việt gọi bằng tên cuối nên lấy HAI TỪ CUỐI (thiết kế:
 * "Đồng Thị Hiền" → "TH", "Nguyễn Đức Hùng" → "ĐH"); một từ thì một chữ.
 */
export function vietTatTenNv(ten: string | null | undefined): string {
  const w = (ten ?? "").trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return "?"
  const chu = (s: string) => Array.from(s)[0] ?? ""
  if (w.length === 1) return chu(w[0]).toLocaleUpperCase("vi")
  return (chu(w[w.length - 2]) + chu(w[w.length - 1])).toLocaleUpperCase("vi")
}

/**
 * SĐT để đọc: di động 10 số "0912 420 924", 11 số "0912 420 9245"; số lạ giữ nguyên như đã nhập.
 * Rỗng → "".
 */
export function dinhDangSdt(raw: string | null | undefined): string {
  const goc = (raw ?? "").trim()
  const d = normalizePhone(goc)
  if (d.length === 10 || d.length === 11) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
  return goc
}

/** Dòng phụ của thẻ: "Vai trò · 0912 420 924" (không có SĐT thì chỉ vai trò). */
export function dongPhuTheNv(u: NvDong): string {
  const sdt = dinhDangSdt(u.phone)
  return sdt ? `${nhanVai(u.role)} · ${sdt}` : nhanVai(u.role)
}
