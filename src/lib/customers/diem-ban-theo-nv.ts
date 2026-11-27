/**
 * ĐIỂM BÁN CẦN CẬP NHẬT THEO NHÂN VIÊN — chủ nhà 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật thêm lọc theo nhân viên
 * bán hàng để xem nhân viên bán hàng nào còn bao nhiêu điểm chưa cập nhật".
 *
 * Nhân viên = NV CHÍNH đang làm của điểm bán (role 'primary', status 'active') — cùng nghĩa bộ lọc "Nhân viên" của danh sách
 * khách (`loc-nhan-vien.ts`) và cột "Phụ trách". Số đếm do máy chủ tính (`khach_thieu_anh_theo_nv`, mig 264) theo ĐÚNG luật
 * lọc của danh sách (`khach_thieu_anh` / `khach_cho_duyet_anh` với `p_nv`) — số cạnh tên = số dòng khi chọn người ấy.
 */
import { CHUA_PHAN_CONG } from "@/lib/customers/loc-nhan-vien"

export { CHUA_PHAN_CONG }

/** Tab của màn: ba kiểu còn thiếu + Chờ duyệt. */
export type TabDiemBan = "all" | "no_photo" | "no_gps" | "approval"

/** Số điểm bán của một NV theo từng tab. */
export interface DemNv {
  thieu: number
  chuaAnh: number
  chuaViTri: number
  choDuyet: number
}

/** Người trong sổ `users` — để lấy tên + biết đã nghỉ. */
export interface NguoiNv {
  id: string
  full_name: string | null
  role?: string | null
  is_active?: boolean | null
}

export interface LuaChonNv {
  /** Mã NV, hoặc `CHUA_PHAN_CONG`. */
  id: string
  ten: string
  so: number
  /** Nhãn trên ô chọn: "Lê Thị Sáu · 12". */
  nhan: string
}

export function soTheoTab(d: DemNv | undefined, tab: TabDiemBan): number {
  if (!d) return 0
  return tab === "no_photo" ? d.chuaAnh : tab === "no_gps" ? d.chuaViTri : tab === "approval" ? d.choDuyet : d.thieu
}

/** Dòng thô của `khach_thieu_anh_theo_nv` → bảng đếm theo mã NV (`nv_id` NULL = chưa phân công). */
export function bangDemNv(
  ds: Array<{ nv_id?: string | null; so_thieu?: unknown; so_chua_anh?: unknown; so_chua_vi_tri?: unknown; so_cho_duyet?: unknown }>
): Map<string, DemNv> {
  const m = new Map<string, DemNv>()
  for (const r of ds) {
    m.set(r.nv_id ?? CHUA_PHAN_CONG, {
      thieu: Number(r.so_thieu) || 0,
      chuaAnh: Number(r.so_chua_anh) || 0,
      chuaViTri: Number(r.so_chua_vi_tri) || 0,
      choDuyet: Number(r.so_cho_duyet) || 0,
    })
  }
  return m
}

/**
 * Lựa chọn của ô "Nhân viên phụ trách": "Chưa phân công" trước, rồi mọi NV CÒN VIỆC (có trong bảng đếm — kể cả chủ NPP / quản
 * lý đứng tên khách, kể cả người đã nghỉ mà khách chưa giao lại) + mọi NVBH đang làm (đã xong thì hiện 0). Số theo TAB ĐANG XEM;
 * xếp nhiều trước — câu hỏi của chủ nhà là "ai còn bao nhiêu" — rồi theo tên.
 */
export function luaChonNhanVien(dem: Map<string, DemNv>, nguoi: NguoiNv[], tab: TabDiemBan): LuaChonNv[] {
  const theoId = new Map(nguoi.map((u) => [u.id, u]))
  const ids = new Set<string>()
  dem.forEach((_, id) => {
    if (id !== CHUA_PHAN_CONG) ids.add(id)
  })
  for (const u of nguoi) if (u.role === "sales" && u.is_active !== false) ids.add(u.id)
  const nv = Array.from(ids).map((id) => {
    const u = theoId.get(id)
    const ten = (u?.full_name?.trim() || "Nhân viên không rõ tên") + (u && u.is_active === false ? " (đã nghỉ)" : "")
    return { id, ten, so: soTheoTab(dem.get(id), tab) }
  })
  nv.sort((a, b) => b.so - a.so || a.ten.localeCompare(b.ten, "vi"))
  const chua = { id: CHUA_PHAN_CONG, ten: "Chưa phân công", so: soTheoTab(dem.get(CHUA_PHAN_CONG), tab) }
  return [chua, ...nv].map((o) => ({ ...o, nhan: `${o.ten} · ${o.so}` }))
}

/** Đọc mã NV đang lọc từ đường dẫn (`?nv=`) — mở hồ sơ khách rồi lùi về vẫn giữ người đang xem. */
export function nvTuDuongDan(search: string): string | null {
  const v = new URLSearchParams(search).get("nv")?.trim()
  return v ? v : null
}

/** Đường dẫn sau khi đổi người lọc (giữ các tham số khác). */
export function duongDanVoiNv(href: string, nv: string | null): string {
  const u = new URL(href)
  if (nv) u.searchParams.set("nv", nv)
  else u.searchParams.delete("nv")
  return u.pathname + u.search + u.hash
}
