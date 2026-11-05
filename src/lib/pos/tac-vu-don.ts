/**
 * TÁC VỤ ĐƠN Ở POS — chủ nhà 04/11/2026: "tao muốn tác vụ đơn nghĩa là sau khi hoàn thành 1 đơn thì tự đóng pos, cần thì
 * mở lại sau"; 05/11/2026, sau khi trao đổi ưu / nhược điểm: "In xong đóng luôn".
 *
 * Phần LUẬT THUẦN (không React) để có chốt chạy thật; nối dây ở `src/store/pos/tabs.tsx` (`ketThuc`).
 *
 * ⚠ VÌ SAO: mỗi lần bấm Xuất hàng / Sửa / Tạo đơn ở danh sách là một TAB TRÌNH DUYỆT mới (chủ nhà 23/09/2026), xong việc
 *   tab vẫn nằm đó — cuối ngày hàng chục tab POS, và tab con của POS (lưu CHUNG cho mọi tab trình duyệt) kéo theo tới
 *   trần 8 tab ("Đóng bớt tab để mở thêm"). Tác vụ đơn: một tab POS một việc, xong việc là đóng.
 *
 * ⚠ "IN XONG ĐÓNG LUÔN": loại có mẫu in (hoá đơn, đơn hàng, phiếu trả — `posPrintHref`) thì bật hộp in, HỘP IN ĐÓNG mới
 *   đóng POS (đóng trước là cắt ngang lệnh in). Phiếu nhập / trả NCC chưa có mẫu in thì đóng ngay. Trình duyệt bắn
 *   `afterprint` cả khi người dùng bấm Huỷ — không phân biệt được in thật hay huỷ (đã nói với chủ nhà).
 *
 * ⚠ KHÔNG ĐÓNG khi có điều người dùng PHẢI đọc ngay trên màn ấy (xuất thiếu hàng, chưa gán được người phụ trách): vẫn in,
 *   nhưng ở lại. Lưu nháp / lưu tạm không phải xong việc — không qua đây.
 */
import { posPrintHref, type PosDocType, type PosTab } from "@/lib/pos/tabs"

/** Một chứng từ vừa ghi xong ở POS. */
export interface ChungTuXong {
  docType: PosDocType
  docId: string
  /** Câu báo — hiện ở tab danh sách sau khi POS đóng ("Đã xuất hóa đơn HD-0123"). */
  loiBao: string
  /** Có điều người dùng PHẢI đọc ngay trên màn này → in (nếu có) nhưng KHÔNG đóng. */
  coCanhBao?: boolean
}

export type KetThuc =
  | { dong: false }
  /** `trangIn` = trang in bật trước, đóng SAU khi hộp in đóng; `null` = loại chưa có mẫu in, đóng ngay. */
  | { dong: true; trangIn: string | null }

/** Quyết định sau khi một chứng từ ghi xong: tắt công tắc hoặc có cảnh báo thì ở lại (như cũ). */
export function ketThucTacVu(bat: boolean, x: Pick<ChungTuXong, "docType" | "docId" | "coCanhBao">): KetThuc {
  if (!bat || x.coCanhBao) return { dong: false }
  return { dong: true, trangIn: posPrintHref(x.docType, x.docId) }
}

export type DongGi =
  /** Chứng từ xong là tab DUY NHẤT của cửa sổ → đóng cả tab trình duyệt. `key` = tab con của nó (đường lùi). */
  | { loai: "cua-so"; key: string | null }
  /** Cửa sổ còn tab con khác (người dùng tự mở thêm bằng `+` / Xử lý đặt hàng) → chỉ đóng tab con vừa xong. */
  | { loai: "tab"; key: string }

/**
 * Đóng gì sau khi xong.
 *
 * ⚠ TÌM TAB THEO CHỨNG TỪ, rồi mới tới tab đang đứng: hộp in đóng lúc nào là tuỳ người dùng, và lúc ấy URL đã được
 *   `replace` sang mã thật (tab "Đơn mới 1" đã gắn mã) — tìm theo `activeKey` lúc bấm là có thể trúng tab khác.
 */
export function dongGi(tabs: readonly PosTab[], x: { docType: PosDocType; docId: string }, activeKey: string): DongGi {
  const tab =
    tabs.find((t) => t.docType === x.docType && t.docId === x.docId) ?? tabs.find((t) => t.key === activeKey) ?? null
  if (!tab || tabs.every((t) => t === tab)) return { loai: "cua-so", key: tab?.key ?? null }
  return { loai: "tab", key: tab.key }
}

/** Chờ trình duyệt đóng tab trước khi kết luận là bị chặn. */
export const CHO_DONG_MS = 400

/**
 * Đóng tab trình duyệt; không đóng được thì chạy đường lùi.
 *
 * ⚠ TRÌNH DUYỆT CHỈ CHO SCRIPT ĐÓNG TAB DO SCRIPT MỞ. POS mở từ nút / link trong app đi qua `window.open`
 *   (`openInNewTab`) nên đóng được; mở bằng dấu trang / gõ địa chỉ / chuột giữa thì `close()` bị lờ đi (Chromium:
 *   "Scripts may close only the windows that were opened by them") — `closed` vẫn `false`, phải có đường lùi, không thì
 *   màn đứng im như chưa xong.
 *
 * ⚠ `khiDong` CHỈ CHẠY KHI ĐÓNG ĐƯỢC. Chuẩn HTML bật cờ "đang đóng" ngay trong lượt gọi `close()` nên `closed` thành `true`
 *   liền, mã vẫn chạy nốt lượt ấy (đo Chromium 05/11/2026) — lời báo "POS đã tự đóng" ghi ở đây, tab mở bằng tay thì không
 *   báo nhầm. Trình duyệt nào đóng trễ hơn thì chỉ mất câu báo; hết giờ mà đã đóng thì không chạy đường lùi.
 */
export function dongCuaSo(
  win: { close: () => void; readonly closed: boolean },
  viec: { khiDong?: () => void; duongLui: () => void },
  hen: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms)
): void {
  win.close()
  if (win.closed) {
    viec.khiDong?.()
    return
  }
  hen(() => {
    if (!win.closed) viec.duongLui()
  }, CHO_DONG_MS)
}

/** Câu nói khi trình duyệt không cho tự đóng (POS mở bằng tay). */
export const CAU_KHONG_TU_DONG = "Trình duyệt không cho tự đóng tab này (mở bằng tay) — bấm Ctrl + W để đóng, hoặc mở chứng từ mới."

/**
 * LỜI BÁO GỬI TAB DANH SÁCH. POS đóng thì câu báo ("Đã xuất HD-0123") mất theo tab — ghi vào `localStorage`, các tab
 * khác cùng gốc nhận sự kiện `storage` (`ThongBaoTuPos`). Có `at` nên mỗi lần ghi là một giá trị mới (cùng giá trị thì
 * trình duyệt không bắn sự kiện).
 */
export const KHOA_XONG_POS = "npp.pos.xong"
/** Quá hạn này (tab danh sách ngủ lâu rồi mới mở lại) thì thôi không báo — chuyện đã cũ. */
export const HAN_LOI_BAO_MS = 120_000

export function goiLoiBao(text: string, daIn: boolean, now: number): string {
  return JSON.stringify({ text, daIn, at: now })
}

export function docLoiBao(raw: string | null | undefined, now: number): { text: string; daIn: boolean } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { text?: unknown; daIn?: unknown; at?: unknown }
    if (typeof v?.text !== "string" || !v.text || typeof v.at !== "number") return null
    if (now - v.at > HAN_LOI_BAO_MS || v.at - now > 5000) return null
    return { text: v.text, daIn: v.daIn === true }
  } catch {
    return null
  }
}
