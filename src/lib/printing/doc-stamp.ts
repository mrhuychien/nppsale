/**
 * MỐC THỜI GIAN TRÊN CHỨNG TỪ IN — ghim GIỜ VIỆT NAM.
 *
 * ⚠ VÌ SAO TÁCH RA KHỎI COMPONENT. Hai bản trước (`stamp` và `longDate`
 * nằm trong `printing/sales-invoice.tsx`) dùng `d.getDate()` /
 * `d.getHours()`, tức là GIỜ CỦA MÁY ĐANG CHẠY. Trang in là Client
 * Component nhưng Next vẫn dựng trước ở máy chủ — máy chủ chạy UTC, máy
 * người dùng chạy giờ Việt Nam, nên:
 *
 *   1. Hai bên ra hai chuỗi khác nhau → React báo lệch hydration.
 *   2. Hoá đơn ghi 20:00 ngày 20/04 giờ Việt Nam in ra "20/04 13:00"
 *      trên bản dựng sẵn rồi nhảy sang "20/04 20:00" sau khi tải xong.
 *      Tờ giấy kẹp trong máy in nhận cái nào là tuỳ lúc bấm.
 *
 * Cả kho mã đã ghim `VN_TZ` cho mọi chỗ hiện ngày giờ (xem `lib/utils`);
 * riêng hai hàm của bản in thì chưa.
 *
 * ⚠ KHÔNG DÙNG `formatDateTime` CÓ SẴN. Nó cho ra "07:39 17/09/2026" —
 * giờ đứng TRƯỚC ngày, theo quy ước vi-VN của trình duyệt. Mẫu chủ nhà
 * gửi viết "Ngày 17/09/2026 07:39", ngày trước giờ sau.
 */

import { VN_TZ } from "@/lib/utils"

/** Các phần ngày/giờ của một mốc, đọc theo giờ Việt Nam. */
function partsVN(d: Date): { y: number; m: number; day: number; hh: string; mm: string } {
  // `en-CA` cho ra YYYY-MM-DD — dạng duy nhất tách được bằng `split` mà
  // không phải đoán thứ tự ngày/tháng.
  const [y, m, day] = d
    .toLocaleDateString("en-CA", { timeZone: VN_TZ })
    .split("-")
    .map(Number)
  const [hh, mm] = d
    .toLocaleTimeString("en-GB", {
      timeZone: VN_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .split(":")
  return { y, m, day, hh, mm }
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * "17/09/2026 07:39" — dòng dưới tiêu đề chứng từ.
 *
 * ⚠ KHÔNG CÓ MỐC THÌ TRẢ "—", ĐỪNG LẤY GIỜ HIỆN TẠI. Một chứng từ không
 * biết mình lập lúc nào mà in ra giờ đang bấm in là bịa một dữ kiện, và
 * hai lần in ra hai tờ khác nhau.
 */
export function stampVN(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "—"
  const p = partsVN(d)
  return `${pad(p.day)}/${pad(p.m)}/${p.y} ${p.hh}:${p.mm}`
}

/** "17/09/2026" — khi chỉ có ngày, không có giờ. */
export function dateVN(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "—"
  const p = partsVN(d)
  return `${pad(p.day)}/${pad(p.m)}/${p.y}`
}

/**
 * "Ngày 17 tháng 09 năm 2026" — dòng trên ô ký.
 *
 * ⚠ Ở ĐÂY MỚI ĐƯỢC LÙI VỀ HÔM NAY. Dòng này là ngày KÝ, không phải ngày
 * lập chứng từ; người cầm bút ký hôm nay.
 */
export function longDateVN(d: Date | null | undefined): string {
  const x = d && !Number.isNaN(d.getTime()) ? d : new Date()
  const p = partsVN(x)
  return `Ngày ${pad(p.day)} tháng ${pad(p.m)} năm ${p.y}`
}

/**
 * Mốc hiện trên chứng từ: ưu tiên thời điểm GHI SỔ, lùi về ngày chứng từ.
 *
 * ⚠ `invoice_date` / `order_date` LÀ KIỂU `date`, KHÔNG CÓ GIỜ. Dựng
 * `new Date("2026-09-17")` ra nửa đêm UTC = 07:00 giờ Việt Nam, nên in
 * kèm giờ là in ra "07:00" cho mọi chứng từ — một con số trông như dữ
 * liệu thật mà không phải. Giờ thật nằm ở `created_at` (timestamptz).
 */
export function docStampAt(
  createdAt: string | null | undefined,
  docDate: string | null | undefined
): { at: Date | null; hasTime: boolean } {
  if (createdAt) {
    const d = new Date(createdAt)
    if (!Number.isNaN(d.getTime())) return { at: d, hasTime: true }
  }
  if (docDate) {
    const d = new Date(docDate)
    if (!Number.isNaN(d.getTime())) return { at: d, hasTime: false }
  }
  return { at: null, hasTime: false }
}

/**
 * Mốc in của PHIẾU TRẢ HÀNG — ngày chứng từ người dùng chọn (mig 188).
 *
 * Cùng ngày với lúc lập → giữ giờ lập (có giờ). Ngày khác (nhập bù) → chỉ in
 * NGÀY đã chọn, không bịa giờ.
 */
export function mocInPhieuTra(
  createdAt: string | null | undefined,
  returnDate: string | null | undefined
): { at: Date | null; hasTime: boolean } {
  const lap = docStampAt(createdAt, null)
  if (!returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return lap
  if (lap.at) {
    const p = partsVN(lap.at)
    if (`${p.y}-${pad(p.m)}-${pad(p.day)}` === returnDate) return lap
  }
  return { at: new Date(`${returnDate}T12:00:00+07:00`), hasTime: false }
}

/**
 * GIỜ SỬA CUỐI cho mốc trên tờ in — chủ nhà 01/10/2026: "Giờ sửa cuối. Hiện tại đang giờ tạo lần đầu".
 * `updated_at` (mig 220) chỉ đổi khi SỬA nội dung chứng từ / dòng hàng; chưa có (mig chưa chạy, dòng cũ)
 * thì lùi về `created_at` như trước.
 */
export function gioSuaCuoi(updatedAt: string | null | undefined, createdAt: string | null | undefined): string | null {
  for (const s of [updatedAt, createdAt]) {
    if (s && !Number.isNaN(new Date(s).getTime())) return s
  }
  return null
}

/**
 * Đọc `updated_at` của MỘT chứng từ bằng câu riêng — cột chưa có (mig 220 chưa chạy) thì trả `null`,
 * tờ in vẫn ra như cũ (giờ lập), không trắng tờ.
 */
export async function docGioSuaCuoi(
  sb: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } } },
  bang: "sales_orders" | "sales_invoices" | "returns",
  id: string
): Promise<string | null> {
  try {
    const { data, error } = await sb.from(bang).select("updated_at").eq("id", id).maybeSingle()
    if (error) return null
    return (data as { updated_at?: string | null } | null)?.updated_at ?? null
  } catch {
    return null
  }
}

/**
 * NGÀY CHỨNG TỪ cho tờ in hoá đơn / đơn hàng — chủ nhà 01/10/2026 (chọn "chỉ in ngày hoá đơn, bỏ hẳn giờ"):
 * in đúng ngày trên chứng từ (`invoice_date` / `order_date`, kiểu DATE), không kèm giờ. Dựng lúc 12:00 giờ
 * VN để đổi múi giờ nào cũng không trượt sang ngày bên cạnh.
 */
export function ngayChungTu(docDate: string | null | undefined): Date | null {
  if (!docDate || !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return null
  const d = new Date(`${docDate}T12:00:00+07:00`)
  return Number.isNaN(d.getTime()) ? null : d
}
