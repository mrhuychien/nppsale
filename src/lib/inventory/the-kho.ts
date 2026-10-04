/**
 * Thẻ kho TỔNG của một mặt hàng (/inventory/stock-card/[productId]) — phần tính thuần.
 *
 * ⚠ SỬA 04/10/2026 (đội test Kho):
 *   - Lọc Từ / Đến ngày theo NGÀY GIỜ VIỆT NAM. Bản cũ so `posted_at.slice(0, 10)` — đó là ngày UTC: phiếu
 *     ghi sổ 01:30 sáng 25/09 giờ VN (= 18:30Z ngày 24) hiện "25/09" trên chính dòng đó nhưng lọc "Từ ngày
 *     25/09" lại loại nó ra (CLAUDE.md: "so bằng ngày theo giờ VN, không so với mốc ISO/UTC").
 *   - Phiếu CHUYỂN KHO không đổi tồn TỔNG: hàng chỉ đổi chỗ giữa kho bán và kho date. Bản cũ cộng +SL vào tồn
 *     chạy (loại 'adjust'), tồn chạy lệch tồn lô. Thẻ kho theo TỪNG kho là ngăn kéo "Lịch sử"
 *     (`v_stock_movements`, mig 228: nguồn −, đích +).
 */
import { vnDateOf } from "@/lib/analytics/sales"

export type LoaiPhieuKho = "import" | "export" | "transfer" | "stocktake"

/** Chiều của phiếu trên thẻ kho tổng: nhập, xuất, điều chỉnh có dấu (kiểm kê), đổi chỗ (chuyển kho). */
export type ChieuTheKho = "in" | "out" | "adjust" | "move"

export const CHIEU_THE_KHO: Record<LoaiPhieuKho, ChieuTheKho> = {
  import: "in",
  export: "out",
  stocktake: "adjust",
  transfer: "move",
}

export function chieuCua(loai: string): ChieuTheKho {
  return CHIEU_THE_KHO[loai as LoaiPhieuKho] ?? "in"
}

export interface DongTheKho {
  /** Mốc ghi sổ (`posted_at`, lùi về `created_at`) — ISO. */
  date: string
  entry_type: string
  /** SL theo đơn vị cơ sở — kiểm kê mang dấu của chênh lệch. */
  quantity: number
}

/** Biến động tồn TỔNG của một dòng: nhập +, xuất −, kiểm kê theo dấu, chuyển kho 0. */
export function bienDongTong(m: Pick<DongTheKho, "entry_type" | "quantity">): number {
  switch (chieuCua(m.entry_type)) {
    case "out":
      return -Math.abs(m.quantity)
    case "move":
      return 0
    case "in":
      return Math.abs(m.quantity)
    default:
      return m.quantity
  }
}

/** Ngày giờ VN (YYYY-MM-DD) của dòng — khoá để lọc Từ / Đến ngày. */
export function ngayVnCua(m: Pick<DongTheKho, "date">): string {
  return vnDateOf(m.date)
}

/**
 * Lọc theo kỳ (ngày giờ VN) và cộng tồn chạy. Tồn đầu kỳ = mọi biến động TRƯỚC "Từ ngày".
 * @param dong đã xếp theo thời gian tăng dần.
 */
export function tonChayTheKho<T extends DongTheKho>(
  dong: readonly T[],
  tuNgay: string,
  denNgay: string
): { dong: Array<T & { delta: number; running: number }>; dauKy: number; nhap: number; xuat: number } {
  let running = 0
  let dauKy = 0
  let nhap = 0
  let xuat = 0
  const out: Array<T & { delta: number; running: number }> = []
  for (const m of dong) {
    const ngay = ngayVnCua(m)
    const delta = bienDongTong(m)
    if (tuNgay && ngay < tuNgay) {
      running += delta
      dauKy = running
      continue
    }
    if (denNgay && ngay > denNgay) continue
    running += delta
    const chieu = chieuCua(m.entry_type)
    if (chieu === "in") nhap += Math.abs(m.quantity)
    else if (chieu === "out") xuat += Math.abs(m.quantity)
    out.push({ ...m, delta, running })
  }
  return { dong: out, dauKy, nhap, xuat }
}
