/**
 * BÀN GIAO KHÁCH GIỮA NHÂN VIÊN + "HÀNG KHÁCH ĐÃ LẤY" — mig 246.
 *
 * Chủ nhà 15/10/2026 (chuyển lời một NPP): "Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung khách hàng) Hoặc là
 * như kiểu bàn giao lại khách hàng. Đã lấy sp gì, số lượng … Vậy mình phải tạo: dskh tuyến đó, đã lấy hàng gì, số lượng,
 * hàng cty nào mà nv đó làm". Chốt cùng ngày: cả hai kiểu (làm chung / chuyển hẳn); toàn bộ khách của NV, theo tuyến,
 * theo công ty; chọn mốc 3 / 6 / 12 tháng / tất cả; chuyển hẳn thì công nợ theo NV nhận, doanh số HĐ cũ vẫn của NV cũ.
 *
 * Luật nằm ở máy chủ (`ban_giao_khach`, `hang_khach_da_lay`): ở đây chỉ gọi, đọc kết quả, gom để hiện và dựng Excel.
 * Số lượng đã là ĐƠN VỊ CƠ SỞ, THUẦN (hoá đơn ghi sổ − hàng trả đã trừ, bỏ hàng đổi) — không cộng lại ở đây.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { errorMessage } from "@/lib/errors"
import { laThieuHam } from "@/lib/bao-cao/mot-luot"
import { CHUA_CO_TUYEN } from "@/lib/customers/tao-khach"
import { ngayVN, soLg, type SheetXuat } from "@/lib/xuat-excel/phieu"

export type NguonBanGiao = "nv" | "chua_ai" | "tat_ca"
export type KieuBanGiao = "chung" | "chuyen"
export type VaiPhuTrach = "primary" | "secondary"

export const NHAN_NGUON: Record<NguonBanGiao, string> = {
  nv: "Khách của một nhân viên",
  chua_ai: "Khách chưa ai phụ trách",
  tat_ca: "Mọi khách (theo tuyến / công ty)",
}

export const NHAN_KIEU: Record<KieuBanGiao, string> = {
  chung: "Làm chung",
  chuyen: "Chuyển hẳn",
}

/** Kiểu có dùng được với nguồn này không — chuyển hẳn chỉ từ một NV (máy chủ chặn `CHUYEN_CAN_NV_GIAO`). */
export const kieuHopLe = (nguon: NguonBanGiao, kieu: KieuBanGiao) => kieu === "chung" || nguon === "nv"

export function nhanVai(v: VaiPhuTrach | null | undefined): string {
  return v === "primary" ? "Chính" : v === "secondary" ? "Phụ" : ""
}

/** Ngày đi tuyến của `pjp_routes.day_of_week` (0 = Thứ 2 … 6 = Chủ nhật — như màn Lịch đi tuyến). */
export const NHAN_THU = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const
export function nhanLich(ngay: ReadonlyArray<number> | null | undefined): string {
  return (ngay ?? []).filter((d) => d >= 0 && d <= 6).map((d) => NHAN_THU[d]).join(", ")
}

// ------------------------------------------------------------------------------------------------
// Mốc thời gian "đã lấy hàng"
// ------------------------------------------------------------------------------------------------
export type MocThoiGian = "3t" | "6t" | "12t" | "tat-ca"
export const MOC_THOI_GIAN: ReadonlyArray<{ key: MocThoiGian; nhan: string; thang: number | null }> = [
  { key: "3t", nhan: "3 tháng", thang: 3 },
  { key: "6t", nhan: "6 tháng", thang: 6 },
  { key: "12t", nhan: "12 tháng", thang: 12 },
  { key: "tat-ca", nhan: "Tất cả", thang: null },
]
export const MOC_MAC_DINH: MocThoiGian = "6t"

export const laMoc = (v: string | null | undefined): v is MocThoiGian => MOC_THOI_GIAN.some((m) => m.key === v)

/**
 * Ngày bắt đầu của mốc (YYYY-MM-DD, lịch VN) — lùi đúng N tháng từ `homNay`; ngày cuối tháng thì kẹp về ngày cuối
 * của tháng đích (31/05 lùi 3 tháng → 28/02). "Tất cả" → null.
 */
export function tuNgayTheoMoc(moc: MocThoiGian, homNay: string): string | null {
  const m = MOC_THOI_GIAN.find((x) => x.key === moc)
  if (!m || m.thang == null) return null
  const k = /^(\d{4})-(\d{2})-(\d{2})$/.exec(homNay)
  if (!k) return null
  const nam = Number(k[1])
  const thang = Number(k[2]) - 1 - m.thang
  const dich = new Date(Date.UTC(nam, thang, 1))
  const cuoiThang = new Date(Date.UTC(dich.getUTCFullYear(), dich.getUTCMonth() + 1, 0)).getUTCDate()
  const ngay = Math.min(Number(k[3]), cuoiThang)
  return `${dich.getUTCFullYear()}-${String(dich.getUTCMonth() + 1).padStart(2, "0")}-${String(ngay).padStart(2, "0")}`
}

// ------------------------------------------------------------------------------------------------
// Bàn giao
// ------------------------------------------------------------------------------------------------
export interface ThamSoBanGiao {
  nguon: NguonBanGiao
  /** NV giao — chỉ khi nguồn = "nv". */
  tuNv?: string | null
  denNv: string
  kieu: KieuBanGiao
  /** Mã tuyến (`customers.channel`); `CHUA_CO_TUYEN` = khách chưa có tuyến. Rỗng = mọi tuyến. */
  tuyen?: readonly string[]
  /** Công ty (NCC) — khách đã lấy hàng công ty ấy. Rỗng = không lọc. */
  ncc?: readonly string[]
  /** Mốc "đã lấy hàng" cho lọc công ty (YYYY-MM-DD); null = mọi lúc. */
  tuNgay?: string | null
  /** NV nhận làm phụ trách chính thì nhận luôn nợ NPP đang giữ (NV cũ nghỉ việc). */
  giaoNoNpp?: boolean
}

export interface TienSo {
  so: number
  tien: number
}

export interface KhachBanGiao {
  id: string
  store_name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  ward: string | null
  channel: string | null
  status: string | null
  vai_giao: VaiPhuTrach | null
  vai_nhan: VaiPhuTrach | null
  se_la: VaiPhuTrach
  nv_chinh: string | null
  no_chuyen: TienSo | null
  no_npp: TienSo | null
  lich: number[] | null
}

export interface TongBanGiao {
  so_khach: number
  them_moi: number
  da_co: number
  len_chinh: number
  no_chuyen: TienSo
  no_npp: TienSo
  lich: number
  bo_qua: number
}

export interface KetQuaBanGiao {
  so_khach: number
  them_moi: number
  da_co: number
  len_chinh: number
  bo_khoi_nv_giao: number
  lich: number
  no_chuyen: TienSo
  no_npp: TienSo
  bo_qua: number
  log_id: string | null
}

/** Tham số gọi `ban_giao_khach` — rỗng gửi `null` (máy chủ hiểu là không lọc). */
export function thamSoRpc(t: ThamSoBanGiao, them: { khach?: readonly string[] | null; thucHien: boolean }): Record<string, unknown> {
  return {
    p_den_nv: t.denNv,
    p_kieu: t.kieu,
    p_nguon: t.nguon,
    p_tu_nv: t.nguon === "nv" ? t.tuNv ?? null : null,
    p_tuyen: t.tuyen && t.tuyen.length > 0 ? [...t.tuyen] : null,
    p_ncc: t.ncc && t.ncc.length > 0 ? [...t.ncc] : null,
    p_tu_ngay: t.tuNgay ?? null,
    p_khach: them.khach ? [...them.khach] : null,
    p_giao_no_npp: t.giaoNoNpp ?? true,
    p_thuc_hien: them.thucHien,
  }
}

const so = (v: unknown) => Number(v) || 0
const tienSo = (v: unknown): TienSo => {
  const o = (v ?? {}) as { so?: unknown; tien?: unknown }
  return { so: so(o.so), tien: so(o.tien) }
}

/** Câu lỗi cho người dùng — mã lỗi máy chủ (phần trước dấu ':') đổi ra lời. */
export function loiBanGiao(e: unknown): string {
  const x = e as { code?: string; message?: string } | null
  if (laThieuHam(x)) return "Máy chủ chưa có chức năng bàn giao khách — cần chạy migration 246 trên Supabase."
  const m = String(x?.message ?? "")
  const ma = m.split(":")[0].trim()
  const CAU: Record<string, string> = {
    KHONG_DU_QUYEN: "Chỉ Chủ NPP / Quản lý được bàn giao khách.",
    NV_NHAN_KHONG_HOP_LE: "Người nhận phải là nhân viên bán hàng đang làm.",
    CUNG_MOT_NV: "Nhân viên giao và nhân viên nhận là một người.",
    CHUYEN_CAN_NV_GIAO: "Chuyển hẳn chỉ làm được với khách của một nhân viên.",
    CHON_NV_GIAO: "Chọn nhân viên giao khách.",
    KHONG_TIM_THAY_NV_GIAO: "Không tìm thấy nhân viên giao.",
    KIEU_KHONG_HOP_LE: "Chọn Làm chung hoặc Chuyển hẳn.",
    NGUON_KHONG_HOP_LE: "Chọn nguồn khách cần giao.",
    KHONG_CO_KHACH: "Không còn khách nào khớp để bàn giao (có thể vừa có người đổi phụ trách) — bấm Xem trước lại.",
  }
  return CAU[ma] ?? (errorMessage(e) || "Không bàn giao được")
}

function docKhachBanGiao(r: Record<string, unknown>): KhachBanGiao {
  const vai = (v: unknown): VaiPhuTrach | null => (v === "primary" || v === "secondary" ? v : null)
  return {
    id: String(r.id),
    store_name: String(r.store_name ?? ""),
    owner_name: (r.owner_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    ward: (r.ward as string | null) ?? null,
    channel: (r.channel as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    vai_giao: vai(r.vai_giao),
    vai_nhan: vai(r.vai_nhan),
    se_la: vai(r.se_la) ?? "secondary",
    nv_chinh: (r.nv_chinh as string | null) ?? null,
    no_chuyen: r.no_chuyen ? tienSo(r.no_chuyen) : null,
    no_npp: r.no_npp ? tienSo(r.no_npp) : null,
    lich: Array.isArray(r.lich) ? (r.lich as unknown[]).map(Number) : null,
  }
}

function docTong(t: Record<string, unknown> | null | undefined): TongBanGiao {
  const o = t ?? {}
  return {
    so_khach: so(o.so_khach), them_moi: so(o.them_moi), da_co: so(o.da_co), len_chinh: so(o.len_chinh),
    no_chuyen: tienSo(o.no_chuyen), no_npp: tienSo(o.no_npp), lich: so(o.lich), bo_qua: so(o.bo_qua),
  }
}

/** Xem trước — không đổi gì ở máy chủ. */
export async function xemTruocBanGiao(sb: SupabaseClient, t: ThamSoBanGiao): Promise<{ khach: KhachBanGiao[]; tong: TongBanGiao }> {
  const { data, error } = await sb.rpc("ban_giao_khach", thamSoRpc(t, { thucHien: false }))
  if (error) throw new Error(loiBanGiao(error))
  const d = (data ?? {}) as { khach?: Record<string, unknown>[]; tong?: Record<string, unknown> }
  return { khach: (d.khach ?? []).map(docKhachBanGiao), tong: docTong(d.tong) }
}

/** Thực hiện cho đúng các khách đã chọn ở bước xem trước (máy chủ lọc lại theo phạm vi — khách ngoài phạm vi bỏ qua). */
export async function thucHienBanGiao(sb: SupabaseClient, t: ThamSoBanGiao, khach: readonly string[]): Promise<KetQuaBanGiao> {
  const { data, error } = await sb.rpc("ban_giao_khach", thamSoRpc(t, { khach, thucHien: true }))
  if (error) throw new Error(loiBanGiao(error))
  const o = (data ?? {}) as Record<string, unknown>
  return {
    so_khach: so(o.so_khach), them_moi: so(o.them_moi), da_co: so(o.da_co), len_chinh: so(o.len_chinh),
    bo_khoi_nv_giao: so(o.bo_khoi_nv_giao), lich: so(o.lich),
    no_chuyen: tienSo(o.no_chuyen), no_npp: tienSo(o.no_npp), bo_qua: so(o.bo_qua),
    log_id: (o.log_id as string | null) ?? null,
  }
}

/** NV nhận sẽ ở vai nào với khách này — để hiện ở bảng xem trước. */
export function nhanSeLa(k: Pick<KhachBanGiao, "vai_nhan" | "se_la">): string {
  if (k.vai_nhan && k.vai_nhan === k.se_la) return `Đã có (${nhanVai(k.vai_nhan).toLowerCase()})`
  if (k.vai_nhan === "secondary" && k.se_la === "primary") return "Lên chính"
  return nhanVai(k.se_la)
}

/** Tổng của các khách ĐANG CHỌN (bảng xem trước cho bỏ chọn từng khách). */
export function tongDaChon(ds: readonly KhachBanGiao[], chon: ReadonlySet<string>): TongBanGiao {
  const c = ds.filter((k) => chon.has(k.id))
  const cong = (f: (k: KhachBanGiao) => TienSo | null) =>
    c.reduce((t, k) => ({ so: t.so + (f(k)?.so ?? 0), tien: t.tien + (f(k)?.tien ?? 0) }), { so: 0, tien: 0 })
  return {
    so_khach: c.length,
    them_moi: c.filter((k) => !k.vai_nhan).length,
    da_co: c.filter((k) => !!k.vai_nhan).length,
    len_chinh: c.filter((k) => k.se_la === "primary" && k.vai_nhan !== "primary").length,
    no_chuyen: cong((k) => k.no_chuyen),
    no_npp: cong((k) => k.no_npp),
    lich: c.reduce((t, k) => t + (k.vai_nhan ? 0 : (k.lich ?? []).length), 0),
    bo_qua: 0,
  }
}

// ------------------------------------------------------------------------------------------------
// Hàng khách đã lấy
// ------------------------------------------------------------------------------------------------
export interface KhachHang {
  id: string
  store_name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  ward: string | null
  channel: string | null
  status: string | null
  nv_chinh: string | null
}

/** Một dòng thô: khách `k`, hàng `p`; SL đơn vị cơ sở (`di` hoá đơn, `tra` hàng trả đã trừ, `sl` = di − tra). */
export interface DongHangTho {
  k: string
  p: string
  di: number
  tra: number
  sl: number
  lan: number
  cuoi: string | null
}

export interface SanPhamHang {
  id: string
  sku: string | null
  name: string
  base_unit: string
  ncc: string | null
}

export interface CongTy {
  id: string
  name: string
}

export interface HangDaLay {
  nv: string | null
  khach: KhachHang[]
  hang: DongHangTho[]
  sp: SanPhamHang[]
  ncc: CongTy[]
}

export interface ThamSoHangDaLay {
  /** Chủ / quản lý / kế toán: xem theo NV này (khách + công ty của NV). NVBH: máy chủ bỏ qua, luôn là chính mình. */
  nv?: string | null
  khach?: readonly string[] | null
  tu?: string | null
  tuyen?: readonly string[] | null
}

/** Đọc hàng khách đã lấy. `null` = máy chủ chưa chạy mig 246 (màn lùi về khối cũ / nói rõ). Lỗi khác thì NÉM. */
export async function napHangDaLay(sb: SupabaseClient, q: ThamSoHangDaLay): Promise<HangDaLay | null> {
  const { data, error } = await sb.rpc("hang_khach_da_lay", {
    p_nv: q.nv ?? null,
    p_khach: q.khach ? [...q.khach] : null,
    p_tu: q.tu ?? null,
    p_tuyen: q.tuyen && q.tuyen.length > 0 ? [...q.tuyen] : null,
  })
  if (error) {
    if (laThieuHam(error)) return null
    throw new Error(errorMessage(error) || "Không đọc được hàng khách đã lấy")
  }
  const d = (data ?? {}) as Partial<Record<keyof HangDaLay, unknown>>
  const ds = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : [])
  return {
    nv: (d.nv as string | null) ?? null,
    khach: ds<KhachHang>(d.khach),
    hang: ds<Record<string, unknown>>(d.hang).map((h) => ({
      k: String(h.k), p: String(h.p), di: soLg(h.di), tra: soLg(h.tra), sl: soLg(h.sl), lan: so(h.lan),
      cuoi: (h.cuoi as string | null) ?? null,
    })),
    sp: ds<SanPhamHang>(d.sp),
    ncc: ds<CongTy>(d.ncc),
  }
}

/** Khoá công ty của hàng chưa gán NCC (lọc / nhóm). */
export const CHUA_GAN_CONG_TY = "__chua_gan_cong_ty"
export const NHAN_CHUA_GAN_CONG_TY = "Chưa gán công ty"

export interface DongHang {
  productId: string
  sku: string
  ten: string
  donVi: string
  congTyId: string
  congTy: string
  sl: number
  di: number
  tra: number
  lan: number
  cuoi: string | null
}

/**
 * Hàng theo từng khách, nhiều nhất lên đầu. `congTy` (tuỳ chọn): chỉ giữ hàng các công ty ấy
 * (`CHUA_GAN_CONG_TY` = hàng chưa gán công ty). Rỗng / không truyền = mọi hàng máy chủ trả về.
 */
export function hangTheoKhach(d: HangDaLay, congTy?: ReadonlySet<string> | null): Map<string, DongHang[]> {
  const sp = new Map(d.sp.map((s) => [s.id, s]))
  const ten = new Map(d.ncc.map((n) => [n.id, n.name]))
  const out = new Map<string, DongHang[]>()
  for (const h of d.hang) {
    const s = sp.get(h.p)
    const ctId = s?.ncc ?? CHUA_GAN_CONG_TY
    if (congTy && congTy.size > 0 && !congTy.has(ctId)) continue
    const dong: DongHang = {
      productId: h.p,
      sku: s?.sku ?? "",
      ten: s?.name ?? "Sản phẩm đã xoá",
      donVi: s?.base_unit ?? "",
      congTyId: ctId,
      congTy: s?.ncc ? ten.get(s.ncc) ?? "Công ty khác" : NHAN_CHUA_GAN_CONG_TY,
      sl: h.sl,
      di: h.di,
      tra: h.tra,
      lan: h.lan,
      cuoi: h.cuoi,
    }
    const ds = out.get(h.k)
    if (ds) ds.push(dong)
    else out.set(h.k, [dong])
  }
  out.forEach((ds) => ds.sort((a, b) => b.sl - a.sl || a.ten.localeCompare(b.ten, "vi")))
  return out
}

/** Lần lấy hàng gần nhất của một khách (trong các dòng đang hiện). */
export function lanCuoiCuaKhach(ds: readonly DongHang[] | undefined): string | null {
  let max: string | null = null
  for (const d of ds ?? []) if (d.cuoi && (!max || d.cuoi > max)) max = d.cuoi
  return max
}

/** "24 lon", "1,5 thùng" — số lượng đơn vị cơ sở để hiện. */
export function slHienThi(sl: number, donVi: string): string {
  const s = soLg(sl).toLocaleString("vi-VN", { maximumFractionDigits: 3 })
  return donVi ? `${s} ${donVi}` : s
}

/** Nhãn một tuyến: "GT — General Trade"; rỗng = "Chưa có tuyến". */
export function nhanTuyen(code: string | null | undefined, tuyen: ReadonlyArray<{ code: string; name: string }>): string {
  const c = (code ?? "").trim()
  if (!c || c === CHUA_CO_TUYEN) return "Chưa có tuyến"
  const r = tuyen.find((x) => x.code === c)
  return r?.name && r.name.trim() !== c ? `${c} — ${r.name.trim()}` : c
}

/**
 * Nhóm khách theo tuyến, đúng thứ tự danh mục tuyến (`tuyen` đã xếp); mã lạ theo sau, "Chưa có tuyến" cuối cùng.
 * Trong một tuyến giữ nguyên thứ tự khách đưa vào.
 */
export function nhomTheoTuyen<T extends { channel: string | null }>(
  ds: readonly T[],
  tuyen: ReadonlyArray<{ code: string; name: string }>
): Array<{ code: string; nhan: string; khach: T[] }> {
  const nhom = new Map<string, T[]>()
  for (const k of ds) {
    const c = (k.channel ?? "").trim() || CHUA_CO_TUYEN
    const g = nhom.get(c)
    if (g) g.push(k)
    else nhom.set(c, [k])
  }
  const thuTu = (c: string) => {
    if (c === CHUA_CO_TUYEN) return Number.MAX_SAFE_INTEGER
    const i = tuyen.findIndex((t) => t.code === c)
    return i < 0 ? tuyen.length : i
  }
  return Array.from(nhom.entries())
    .sort((a, b) => thuTu(a[0]) - thuTu(b[0]) || a[0].localeCompare(b[0], "vi"))
    .map(([code, khach]) => ({ code, nhan: nhanTuyen(code, tuyen), khach }))
}

/** Tìm khách theo tên / chủ / SĐT / địa chỉ (không dấu) — trong danh sách ĐÃ được phép xem. */
export function khopTimKhach(k: Pick<KhachHang, "store_name" | "owner_name" | "phone" | "address" | "ward">, q: string): boolean {
  const bo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
  const t = bo(q.trim())
  if (!t) return true
  const so = t.replace(/\D/g, "")
  const chu = bo([k.store_name, k.owner_name, k.address, k.ward].filter(Boolean).join(" "))
  if (chu.includes(t)) return true
  return so.length >= 3 && (k.phone ?? "").replace(/\D/g, "").includes(so)
}

/**
 * Tệp "Danh sách bàn giao" — chủ nhà: "dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào mà nv đó làm".
 * Sheet 1: mỗi dòng một (khách, mặt hàng), theo tuyến; khách chưa lấy hàng trong kỳ vẫn có một dòng.
 * Sheet 2: mỗi khách một dòng (số mặt hàng, lần lấy cuối).
 * ⚠ SL là SỐ (đơn vị cơ sở) — Excel cộng / lọc được; SĐT là CHỮ (giữ số 0 đầu).
 */
export function xuatDanhSachBanGiao(
  d: HangDaLay,
  ctx: {
    tuyen: ReadonlyArray<{ code: string; name: string }>
    congTy?: ReadonlySet<string> | null
    /** Chỉ các khách này (đã lọc tìm / tuyến ở màn); không truyền = mọi khách. */
    khachIds?: ReadonlySet<string> | null
  }
): SheetXuat[] {
  const hang = hangTheoKhach(d, ctx.congTy)
  const khach = d.khach.filter((k) => !ctx.khachIds || ctx.khachIds.has(k.id))
  const nhom = nhomTheoTuyen(khach, ctx.tuyen)
  const chiTiet: Array<Array<string | number>> = [[
    "Tuyến", "Cửa hàng", "Chủ cửa hàng", "SĐT", "Địa chỉ", "Phường/xã", "NV phụ trách chính",
    "Công ty", "Mã hàng", "Tên hàng", "SL đã lấy (đơn vị cơ sở)", "Đơn vị", "Đã trả lại", "Số lần lấy", "Lần lấy cuối",
  ]]
  const tomTat: Array<Array<string | number>> = [[
    "Tuyến", "Cửa hàng", "Chủ cửa hàng", "SĐT", "Địa chỉ", "Phường/xã", "NV phụ trách chính", "Số mặt hàng đã lấy", "Lần lấy cuối",
  ]]
  for (const g of nhom) {
    for (const k of g.khach) {
      const dau = [g.nhan, k.store_name, k.owner_name ?? "", (k.phone ?? "").trim(), k.address ?? "", k.ward ?? "", k.nv_chinh ?? ""]
      const ds = hang.get(k.id) ?? []
      if (ds.length === 0) chiTiet.push([...dau, "", "", "(chưa lấy hàng trong kỳ)", "", "", "", "", ""])
      for (const h of ds) chiTiet.push([...dau, h.congTy, h.sku, h.ten, h.sl, h.donVi, h.tra, h.lan, ngayVN(h.cuoi)])
      tomTat.push([...dau, ds.length, ngayVN(lanCuoiCuaKhach(ds))])
    }
  }
  return [
    { ten: "Hàng đã lấy", rows: chiTiet },
    { ten: "Khách", rows: tomTat },
  ]
}
