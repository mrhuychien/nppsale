/**
 * ĐỌC "TỒN KHO HIỆN TẠI" QUA RPC `ton_kho_trang` (mig 255) — máy chủ gộp tồn theo mặt hàng, lọc còn tồn, tìm, sắp, chia
 * trang; mỗi dòng kèm tổng số dòng và TỔNG CỘNG của cả tập đã lọc.
 *
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → đợt 4: màn Kho hàng mở là kéo cả bảng tồn theo khu + cả 2.500 mặt
 *   hàng kèm đơn vị (≈1 MB JSON) về máy rồi mới gộp / lọc / cộng / chia trang. Nay máy chỉ nhận trang đang xem.
 * ⚠ Sổ chưa chạy mig 255 → PostgREST báo không có hàm (`chuaCoRpc`) → bảng lùi về cách cũ (đọc đủ, gộp trên máy).
 * Tách khỏi component để chốt chạy được bằng một client giả.
 */
import type { SapXepTon } from "@/lib/inventory/kho-hang-mobile"

/** Trần một trang RPC (LIMIT của hàm) — Xuất Excel đọc từng trang này tới hết. */
export const TRAN_TRANG_TON = 500

export interface SanPhamTon {
  id: string
  sku: string
  name: string
  base_unit: string
  units?: Array<{ unit_name: string; conversion: number }>
  status?: string | null
}
export interface DongTon {
  product: SanPhamTon
  saleQty: number
  saleValue: number
  dateQty: number
  dateValue: number
  totalQty: number
  totalValue: number
}
export interface TongTon {
  saleQty: number
  saleValue: number
  dateQty: number
  dateValue: number
  totalQty: number
  totalValue: number
}
export const TONG_RONG: TongTon = { saleQty: 0, saleValue: 0, dateQty: 0, dateValue: 0, totalQty: 0, totalValue: 0 }

export interface ThamSoTon {
  /** Chuỗi tìm thô — máy chủ bỏ dấu, tách từ, mọi từ phải có mặt (như `viMatchAllWords`). */
  tim: string
  /** "Chỉ hiện hàng còn tồn" = tổng SL > 0. */
  conTon: boolean
  sapXep: SapXepTon
  offset: number
  limit: number
}
export interface TrangTon {
  rows: DongTon[]
  /** Tổng số dòng khớp; `null` = trang rỗng ngoài tầm (offset vượt) — nơi gọi giữ số cũ. */
  tong: number | null
  /** Tổng cộng của CẢ tập đã lọc (không phải của trang); `null` khi trang rỗng. */
  tongCong: TongTon | null
}

type LoiRpc = { message?: string; code?: string } | null
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: LoiRpc }> }
type DongTho = {
  product_id: string
  sku?: string | null
  name?: string | null
  base_unit?: string | null
  status?: string | null
  units?: unknown
  sale_qty?: unknown
  sale_value?: unknown
  date_qty?: unknown
  date_value?: unknown
  total_qty?: unknown
  total_value?: unknown
  total_count?: unknown
  sum_sale_qty?: unknown
  sum_sale_value?: unknown
  sum_date_qty?: unknown
  sum_date_value?: unknown
  sum_total_qty?: unknown
  sum_total_value?: unknown
}

const so = (x: unknown): number => Number(x) || 0

/** Tham số gửi lên hàm — tìm rỗng gửi null; offset không âm; limit 1..trần. */
export function thamSoRpc(t: ThamSoTon): Record<string, unknown> {
  return {
    p_tim: t.tim.trim() || null,
    p_con_ton: t.conTon,
    p_sap: t.sapXep,
    p_offset: Math.max(0, Math.floor(t.offset) || 0),
    p_limit: Math.min(Math.max(1, Math.floor(t.limit) || 1), TRAN_TRANG_TON),
  }
}

function dong(r: DongTho): DongTon {
  const units = Array.isArray(r.units)
    ? (r.units as Array<{ unit_name?: unknown; conversion?: unknown }>).map((u) => ({ unit_name: String(u.unit_name ?? ""), conversion: so(u.conversion) }))
    : []
  return {
    product: { id: r.product_id, sku: r.sku ?? "", name: r.name ?? "", base_unit: r.base_unit ?? "", status: r.status ?? "active", units },
    saleQty: so(r.sale_qty),
    saleValue: so(r.sale_value),
    dateQty: so(r.date_qty),
    dateValue: so(r.date_value),
    totalQty: so(r.total_qty),
    totalValue: so(r.total_value),
  }
}

/** Một trang tồn kho. Lỗi máy chủ thì NÉM (kèm `code`) — nơi gọi quyết lùi về cách cũ hay báo lỗi. */
export async function docTrangTon(sb: Rpc, t: ThamSoTon): Promise<TrangTon> {
  const { data, error } = await sb.rpc("ton_kho_trang", thamSoRpc(t))
  if (error) throw Object.assign(new Error(error.message || "ton_kho_trang"), { code: error.code })
  const ds = (Array.isArray(data) ? data : []) as DongTho[]
  const d0 = ds[0]
  if (!d0) return { rows: [], tong: t.offset <= 0 ? 0 : null, tongCong: t.offset <= 0 ? TONG_RONG : null }
  return {
    rows: ds.map(dong),
    tong: Number(d0.total_count) || ds.length,
    tongCong: {
      saleQty: so(d0.sum_sale_qty), saleValue: so(d0.sum_sale_value),
      dateQty: so(d0.sum_date_qty), dateValue: so(d0.sum_date_value),
      totalQty: so(d0.sum_total_qty), totalValue: so(d0.sum_total_value),
    },
  }
}

/**
 * TOÀN BỘ tập đã lọc, đọc từng trang tới hết — cho Xuất Excel (xuất đúng những dòng đang lọc, không phải một trang).
 * `buoc` = cỡ trang (mặc định trần); `tranDong` chặn vòng lặp khi máy chủ trả tổng lệch.
 */
export async function docTatCaTon(
  sb: Rpc,
  t: Omit<ThamSoTon, "offset" | "limit">,
  buoc = TRAN_TRANG_TON,
  tranDong = 50_000
): Promise<DongTon[]> {
  const out: DongTon[] = []
  const co = new Set<string>()
  for (let offset = 0; offset < tranDong; offset += buoc) {
    const kq = await docTrangTon(sb, { ...t, offset, limit: buoc })
    for (const r of kq.rows) {
      if (!co.has(r.product.id)) {
        co.add(r.product.id)
        out.push(r)
      }
    }
    if (kq.rows.length < buoc || kq.tong === null || out.length >= kq.tong) break
  }
  return out
}
