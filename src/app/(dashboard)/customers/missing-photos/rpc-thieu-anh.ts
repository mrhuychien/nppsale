/**
 * ĐỌC "ĐIỂM BÁN CÒN THIẾU ẢNH / VỊ TRÍ" QUA RPC (mig 253) — máy chủ lọc + đếm ảnh + phân trang.
 *
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: màn này kéo CẢ sổ khách (≈570 KB với 3.000 khách)
 *   + cả bảng ảnh về rồi lọc trên máy, vẽ hết — đo điện thoại 4G: 5,9 giây. Nay chỉ nhận trang đang xem kèm tổng số.
 * ⚠ Sổ chưa chạy mig 253 → PostgREST báo không có hàm (`chuaCoRpc`) → màn lùi về cách cũ (`doc-anh.ts`), không báo lỗi.
 * Tách khỏi `page.tsx` để chốt chạy được bằng một client giả.
 */
import { chuaCoRpc } from "@/lib/supabase/chua-co-rpc"
import { ghepTrang } from "@/lib/list/ghep-trang"
import { bangDemNv, type DemNv } from "@/lib/customers/diem-ban-theo-nv"

export { chuaCoRpc, ghepTrang }

export const TRANG_THIEU_ANH = 50

export type TabThieu = "all" | "no_photo" | "no_gps"
export const TAB_THIEU: TabThieu[] = ["all", "no_photo", "no_gps"]

export interface DongThieuAnh {
  id: string
  store_name: string
  address: string | null
  phone: string | null
  gps_lat: number | null
  gps_lng: number | null
  photoCount: number
}
export interface DongChoDuyet extends DongThieuAnh {
  daDuyet: boolean
  soYeuCau: number
}

type LoiRpc = { message?: string; code?: string } | null
type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) => PromiseLike<{ data: unknown; error: LoiRpc }>
}
type DongTho = {
  id: string
  store_name: string
  address?: string | null
  phone?: string | null
  gps_lat?: number | string | null
  gps_lng?: number | string | null
  photo_count?: number | string | null
  total_count?: number | string | null
  da_duyet?: boolean | null
  so_yeu_cau?: number | string | null
}

const so =(x: number | string | null | undefined) => (x == null || x === "" ? null : Number(x))

function dong(r: DongTho): DongChoDuyet {
  return {
    id: r.id,
    store_name: r.store_name,
    address: r.address ?? null,
    phone: r.phone ?? null,
    gps_lat: so(r.gps_lat),
    gps_lng: so(r.gps_lng),
    photoCount: Number(r.photo_count) || 0,
    daDuyet: !!r.da_duyet,
    soYeuCau: Number(r.so_yeu_cau) || 0,
  }
}

async function goi(sb: Rpc, fn: string, args: Record<string, unknown>): Promise<{ rows: DongChoDuyet[]; tong: number | null }> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw Object.assign(new Error(error.message || fn), { code: error.code })
  const ds = (Array.isArray(data) ? data : []) as DongTho[]
  /* `total_count` giống nhau ở mọi dòng; trang rỗng (offset vượt) thì không biết tổng → null, nơi gọi giữ số cũ. */
  return { rows: ds.map(dong), tong: ds.length > 0 ? Number(ds[0].total_count) || ds.length : args.p_offset === 0 ? 0 : null }
}

/**
 * Lọc theo NV CHÍNH (mig 264): `null` = mọi khách người xem thấy; `CHUA_PHAN_CONG` = chưa có NV chính; còn lại = mã NV.
 * ⚠ Chỉ gửi `p_nv` khi ĐANG lọc: không lọc thì câu gọi y như bản mig 253 — sổ chưa chạy 264 vẫn chạy được.
 */
export type LocNv = string | null
const theoNv = (nv: LocNv) => (nv ? { p_nv: nv } : {})

/** Một trang điểm bán còn thiếu của một tab. */
export function docTrangThieuAnh(sb: Rpc, tab: TabThieu, offset: number, limit = TRANG_THIEU_ANH, nv: LocNv = null) {
  return goi(sb, "khach_thieu_anh", { p_tab: tab, p_offset: offset, p_limit: limit, ...theoNv(nv) })
}

/** Một trang điểm bán chờ duyệt (mig 244) — kèm `daDuyet`, `soYeuCau`. */
export function docTrangChoDuyet(sb: Rpc, offset: number, limit = TRANG_THIEU_ANH, nv: LocNv = null) {
  return goi(sb, "khach_cho_duyet_anh", { p_offset: offset, p_limit: limit, ...theoNv(nv) })
}

/**
 * Số điểm bán cần cập nhật theo NV chính (mig 264) — cùng luật lọc hai hàm trên. `null` = sổ chưa chạy 264 (màn ẩn ô Nhân
 * viên, không phải lỗi); lỗi khác thì NÉM. Hàm STABLE → gọi GET (hết giờ được thử lại, không bị coi là câu ghi).
 */
export async function docDemTheoNv(sb: Rpc): Promise<Map<string, DemNv> | null> {
  const { data, error } = await sb.rpc("khach_thieu_anh_theo_nv", {}, { get: true })
  if (error) {
    if (chuaCoRpc(error)) return null
    throw Object.assign(new Error(error.message || "khach_thieu_anh_theo_nv"), { code: error.code })
  }
  return bangDemNv((Array.isArray(data) ? data : []) as Parameters<typeof bangDemNv>[0])
}
