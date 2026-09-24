/**
 * IN CHỨNG TỪ Ở POS.
 *
 * ⚠ LỊCH SỬ: 23/09/2026 chủ nhà muốn "Xuất hàng & lập HĐ / Huỷ HĐ & lập lại
 *   -> bật luôn cửa sổ in"; bản đầu mở một TAB mới (`moCuaInCho`). 24/09/2026:
 *   "in đơn tại chỗ ko cần mở tab. Chỉ bật cửa sổ in" — thay bằng `inTaiCho`.
 */
/** Trang in hóa đơn bật thẳng hộp thoại in. */
export const trangInHoaDon = (invoiceId: string) => `/sales-invoices/${invoiceId}/print?auto=1`

/**
 * IN TẠI CHỖ — chủ nhà 24/09/2026: "Màn Hóa đơn, Đơn hàng, Trả hàng, in đơn
 * tại chỗ ko cần mở tab. Chỉ bật cửa sổ in".
 *
 * Nạp trang in `?auto=1` vào một KHUNG ẨN ngay trên màn đang đứng; trang ấy
 * tự gọi `window.print()` của chính khung, nên chỉ hộp thoại in bật lên,
 * không tab nào mở ra. In xong (hoặc huỷ) khung báo `IN_XONG` về đây thì gỡ.
 *
 * ⚠ KHUNG KHÔNG `display:none`. Chrome in khung bị ẩn hẳn ra trang trắng;
 *   đặt 0×0 ngoài màn thì vẫn có bố cục để in.
 * ⚠ MỘT KHUNG MỘT LÚC — bấm In lần nữa là gỡ khung cũ trước.
 * ⚠ Không cần "cử chỉ người dùng": khung không phải cửa sổ bật lên, nên in
 *   sau `await` (ghi sổ xong) vẫn không bị trình duyệt chặn.
 */
export const KHUNG_IN_ID = "npp-khung-in"

export function voiAuto(url: string): string {
  return /[?&]auto=1\b/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}auto=1`
}

export function inTaiCho(url: string, doc: Document = document): HTMLIFrameElement {
  doc.getElementById(KHUNG_IN_ID)?.remove()
  const f = doc.createElement("iframe")
  f.id = KHUNG_IN_ID
  f.title = "Khung in"
  f.setAttribute("aria-hidden", "true")
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  f.src = voiAuto(url)
  const win = doc.defaultView
  const nghe = (e: MessageEvent) => {
    if (e.source !== f.contentWindow || (e.data as { type?: string } | null)?.type !== "npp:in-xong") return
    win?.removeEventListener("message", nghe)
    /* Gỡ sau một nhịp — gỡ ngay trong `afterprint` của khung là cắt ngang nó. */
    setTimeout(() => f.remove(), 0)
  }
  win?.addEventListener("message", nghe)
  doc.body.appendChild(f)
  return f
}
