/**
 * NHẬN DIỆN MÁY TÍNH NGAY Ở MÁY CHỦ — chủ nhà 03/11/2026: "phần load pos trên máy có cách gì xử lý nhận diện từ đầu là đang
 * trên máy tính để load pos luôn ko nhỉ".
 *
 * Trước đây chỉ TRÌNH DUYỆT biết khổ màn (`manDuRong`, đo `innerWidth` sau khi trang đã dựng): mở lối POS cũ bằng dấu
 * trang, chuột giữa / Ctrl+bấm (tab mới), gõ địa chỉ, `window.open` hay link dán từ Zalo là máy chủ dựng TRỌN màn cũ, tải dữ
 * liệu của nó, rồi `PosDesktopRedirect` mới chuyển sang POS. Đo trên bản build production (CPU ×4, mạng trễ 80 ms):
 * `/sales-invoices/new?order=` → POS 3,0–3,5 giây, 18–21 câu, ~1,7 MB; mở thẳng POS 2,1–2,4 giây, 10–13 câu.
 *
 * Nay trình duyệt ghi khổ màn vào cookie `npp_kho` (`GhiKhoMan`, mỗi lần vào app + khi đổi cỡ cửa sổ) — CÙNG ngưỡng 1024 px
 * với `manDuRong` — và middleware chuyển thẳng lối POS cũ sang đích POS (`dichPosMayChu`) trước khi dựng gì. Máy chưa có
 * cookie (lần đầu vào app trên máy ấy) thì vẫn còn `PosDesktopRedirect` lo như cũ.
 */
import { POS_MIN_WIDTH, posTargetFor } from "@/lib/nav/pos-preview"

export const COOKIE_KHO = "npp_kho"
export type KhoMan = "rong" | "hep"

/** Khổ màn theo bề ngang cửa sổ — một ngưỡng với `manDuRong` / `lg:` của Tailwind. */
export function khoTheoBeNgang(rong: number): KhoMan {
  return rong >= POS_MIN_WIDTH ? "rong" : "hep"
}

/** Chuỗi `document.cookie` ghi khổ màn: cả app, một năm, không gửi sang trang khác (Lax). */
export function chuoiCookieKho(kho: KhoMan, https: boolean): string {
  return `${COOKIE_KHO}=${kho}; Path=/; Max-Age=31536000; SameSite=Lax${https ? "; Secure" : ""}`
}

/** Đọc khổ màn trong chuỗi `document.cookie`; không có / giá trị lạ → `null`. */
export function docCookieKho(cookie: string | null | undefined): KhoMan | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_KHO}=([^;]*)`).exec(cookie ?? "")
  return m?.[1] === "rong" || m?.[1] === "hep" ? m[1] : null
}

export interface YeuCauMoTrang {
  method: string
  pathname: string
  search: string
  /** Giá trị cookie `npp_kho`. */
  kho?: string | null
  /** Header `RSC` — câu điều hướng mềm / tải trước của Next, KHÔNG phải mở trang. */
  rsc?: string | null
  /** Header `Next-Router-Prefetch`. */
  prefetch?: string | null
  /** Header `Purpose` / `Sec-Purpose` (trình duyệt tải trước). */
  purpose?: string | null
  /** Header `Sec-Fetch-Dest` — có thì phải là `document`. */
  dest?: string | null
  /** Header `Accept` — lượt mở trang của trình duyệt luôn xin `text/html`; câu `fetch` (RSC của Next) thì `*\/*`. */
  accept?: string | null
}

/**
 * Đích POS cho một lượt MỞ TRANG của máy rộng vào lối POS cũ; `null` = để yên.
 *
 * ⚠ CHỈ MỞ TRANG (GET, xin `text/html`, dest = document), KHÔNG đụng câu RSC / tải trước: điều hướng mềm trong app đã có
 *   `PosNewTab` / `diHoacMoPos` mở POS ở TAB MỚI — đổi hướng câu RSC là kéo POS vào ngay tab cũ, ngược luật "POS mở tab mới".
 *   Next GỠ header `RSC` / `Next-Router-Prefetch` trước khi middleware thấy (đã gặp ở e2e 03/11/2026) — nên phép chính là
 *   `Accept` + `Sec-Fetch-Dest` do trình duyệt gắn; hai header của Next chỉ là chặn thêm nếu bản Next sau còn để lại.
 * ⚠ CHỈ KHI COOKIE NÓI "rong". Không cookie (lần đầu trên máy) / "hep" (điện thoại, cửa sổ hẹp) → để màn cũ tự lo — đoán
 *   "rộng" ở máy chủ là đẩy điện thoại sang màn POS 1.400 px không dùng được.
 */
export function dichPosMayChu(y: YeuCauMoTrang): string | null {
  if (y.method !== "GET" || y.kho !== "rong") return null
  if (!/text\/html/i.test(y.accept ?? "")) return null
  if (y.rsc || y.prefetch) return null
  if (/prefetch|prerender/i.test(y.purpose ?? "")) return null
  if (y.dest && y.dest !== "document") return null
  return posTargetFor(`${y.pathname}${y.search}`)
}
