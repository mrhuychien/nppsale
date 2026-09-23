/**
 * NHÁNH `newdesign` DÙNG MÀN `/pos` CHO VIỆC LẬP VÀ SỬA ĐƠN TRÊN MÁY
 * TÍNH.
 *
 * Chủ nhà chốt 22/09/2026: "ở branch này mày viết luôn tích hợp phần
 * này vào các thao tác đi, để test trên preview. VD: trên desktop ấn
 * tạo đơn -> dùng tạo đơn pos, sửa -> dùng sửa pos, main vẫn chạy
 * production bình thường".
 *
 * ⚠ ĐỔI Ở HAI CỬA, KHÔNG ĐỔI Ở SÁU CÁI NÚT. Nút "Tạo đơn" nằm ở sáu
 *   chỗ (trang chủ, menu trái, danh sách đơn, danh sách khách, hồ sơ
 *   khách, tuyến thăm) và nút "Sửa đơn" ở ba chỗ. Sửa từng nút là chắc
 *   chắn sót một — và cái sót ấy lại đưa người test về màn cũ, rồi họ
 *   kết luận "POS không chạy". Nên chặn ngay tại `/sell` và
 *   `/sell/edit/[id]`: mọi đường, kể cả dấu trang đã lưu, đều đi qua đó.
 *
 * ⚠ CHỈ MÁY TÍNH. Chủ nhà đã chốt từ đợt thiết kế: "Chỉ đổi trang
 *   desktop, trang mobile để nguyên". Màn `/pos` là bảng ba cột rộng
 *   1.400px — mở trên điện thoại là không dùng được.
 *
 * ⚠ NGƯỠNG TRÙNG VỚI `lg:` CỦA TAILWIND (1024px). Nút "Tạo đơn" ở danh
 *   sách đơn đang ẩn/hiện theo đúng ngưỡng ấy; lấy một ngưỡng khác là
 *   có một dải bề ngang mà nút thì hiện còn chuyển hướng thì không.
 *
 * ⚠ ĐÂY LÀ THỨ CỦA RIÊNG NHÁNH NÀY. `main` không có tệp này và vẫn
 *   chạy `/sell` như cũ — đó là điều chủ nhà yêu cầu.
 */

/** Ngưỡng `lg` của Tailwind. */
export const POS_MIN_WIDTH = 1024

/** Đơn mới trên màn POS. Xem `posHref` — đơn chưa lưu mang mã `moi`. */
export function posNewOrderHref(customerId?: string | null): string {
  const id = (customerId ?? "").trim()
  return id
    ? `/pos/don-hang/moi?customerId=${encodeURIComponent(id)}`
    : "/pos/don-hang/moi"
}

/** Sửa một đơn đã lưu trên màn POS. */
export function posEditOrderHref(orderId: string): string {
  return `/pos/don-hang/${encodeURIComponent(orderId)}/sua`
}

/**
 * Sửa một hóa đơn đã ghi sổ trên màn POS.
 *
 * ⚠ SỬA HÓA ĐƠN KHÔNG PHẢI SỬA TẠI CHỖ. Cả hai màn — cũ lẫn POS — đều
 *   HUỶ tờ cũ rồi lập một tờ mới mang số `-1`, qua cùng một RPC
 *   `reissue_invoice`. Chuyển hướng ở đây chỉ đổi cái giao diện, không
 *   đổi việc ghi sổ.
 */
export function posEditInvoiceHref(invoiceId: string): string {
  return `/pos/hoa-don/${encodeURIComponent(invoiceId)}/sua`
}

/**
 * Xuất hàng (lập hóa đơn từ đơn) trên màn POS — chủ nhà chốt 23/09/2026.
 *
 * ⚠ CÙNG MỘT RPC `post_invoice` với màn Xuất hàng cũ; chỉ đổi giao diện.
 */
export function posNewInvoiceHref(orderId: string): string {
  return `/pos/hoa-don/moi?order=${encodeURIComponent(orderId)}`
}

/**
 * Phiếu trả hàng mới trên màn POS — chủ nhà báo 23/09/2026 "Tạo phiếu trả
 * hàng → chưa chuyển sang pos". Mang theo hóa đơn gốc và khách nếu có.
 */
export function posNewReturnHref(o: { invoiceId?: string | null; customerId?: string | null } = {}): string {
  const q = new URLSearchParams()
  if (o.invoiceId) q.set("invoice", o.invoiceId)
  if (o.customerId) q.set("customerId", o.customerId)
  const s = q.toString()
  return s ? `/pos/tra-hang/moi?${s}` : "/pos/tra-hang/moi"
}

/**
 * Đường dẫn web → màn POS tương ứng; `null` = không phải lối vào POS.
 *
 * ⚠ ĐÚNG BỘ CỬA MÀ `PosDesktopRedirect` ĐANG CHẶN: `/sell` (trừ bước chọn
 *   hàng trả `?mode=return`), `/sell/edit/:id`, `/sales-invoices/new?order=`,
 *   `/sales-invoices/:id/edit`, `/returns/new`. Thêm cửa mới thì thêm ở đây,
 *   nếu không nút ấy lại chuyển trang ngay trong tab cũ.
 */
export function posTargetFor(href: string): string | null {
  let u: URL
  try {
    u = new URL(href, "http://x")
  } catch {
    return null
  }
  const p = u.pathname.replace(/\/+$/, "") || "/"
  const q = u.searchParams
  if (p === "/sell") return q.get("mode") ? null : posNewOrderHref(q.get("customerId"))
  let m = /^\/sell\/edit\/([^/]+)$/.exec(p)
  if (m) return posEditOrderHref(decodeURIComponent(m[1]))
  if (p === "/sales-invoices/new") {
    const o = q.get("order")
    return o ? posNewInvoiceHref(o) : null
  }
  m = /^\/sales-invoices\/([^/]+)\/edit$/.exec(p)
  if (m) return posEditInvoiceHref(decodeURIComponent(m[1]))
  if (p === "/returns/new") return posNewReturnHref({ invoiceId: q.get("invoiceId"), customerId: q.get("customerId") })
  return null
}

/**
 * Máy tính đủ rộng để dùng màn POS chưa?
 *
 * ⚠ TRẢ `false` KHI KHÔNG CÓ `window`. Hàm này chạy cả lúc render trên
 *   máy chủ; đoán "đủ rộng" ở đó là máy chủ dựng một cú chuyển hướng
 *   cho cả người dùng điện thoại.
 */
export function manDuRong(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth >= POS_MIN_WIDTH
}
