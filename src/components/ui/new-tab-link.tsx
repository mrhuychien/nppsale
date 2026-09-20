"use client"

/**
 * NÚT CHỨC NĂNG MỞ SANG TAB MỚI — dùng ở ngăn Xem nhanh của danh sách
 * đơn hàng và danh sách hóa đơn.
 *
 * ⚠ VÌ SAO KHÔNG `router.push`. Chủ nhà chốt 20/09/2026: "ngoài xem
 * nhanh đơn hàng trong danh sách, khi bấm vào các nút chức năng → mở tab
 * khác, không chuyển trang cùng tab". Người đối chiếu sổ đang đứng ở
 * trang 3 của một danh sách đã lọc; đi sang chi tiết rồi bấm Back là mất
 * cả bộ lọc lẫn chỗ đang đứng, và phải cuộn lại từ đầu cho từng chứng từ.
 *
 * ⚠ THẺ `<a>` THẬT, KHÔNG PHẢI `window.open`. Thẻ thật cho chuột giữa,
 * Ctrl/Cmd+click, "mở trong cửa sổ mới", và hiện đường dẫn ở thanh trạng
 * thái — `window.open` mất hết những thứ đó và còn bị trình duyệt chặn
 * như cửa sổ bật lên trong vài trường hợp.
 *
 * ⚠ `rel="noopener noreferrer"` là BẮT BUỘC đi kèm `target="_blank"`:
 * thiếu nó thì trang mở ra nắm được `window.opener` của trang gốc.
 *
 * ⚠ `inline-flex items-center justify-center` nằm sẵn ở đây: `<a>` không
 * phải hộp flex như `<button>`, thiếu nó là chữ dính lên mép trên của
 * nút thay vì nằm giữa.
 */

import { cn } from "@/lib/utils"

export function NewTabLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center justify-center", className)}
    >
      {children}
    </a>
  )
}

/**
 * Mở một đường dẫn ở tab mới khi CHƯA CÓ sẵn thẻ `<a>` để bấm — dùng cho
 * những chỗ chỉ nhận được một hàm gọi lại (`onApprove`), không nhận được
 * đường dẫn lúc dựng.
 *
 * ⚠ KHÔNG ĐƯỢC ĐƯA `noopener` VÀO THAM SỐ THỨ BA. Theo chuẩn, `window.open`
 * kèm `noopener` LUÔN trả `null` — kể cả khi tab mới mở ra bình thường.
 * Bản đầu đọc `null` đó là "bị chặn cửa sổ bật lên" rồi chạy nhánh dự
 * phòng, nên MỖI LẦN bấm đều mở tab mới VÀ chuyển luôn cả tab cũ. Người
 * dùng báo đúng chuyện đó: "bật tab mới để chuyển trang nhưng lại chuyển
 * trang cả tab cũ". Cắt liên hệ bằng cách gán `opener = null` SAU khi mở
 * — cùng tác dụng bảo mật, mà `null` lại giữ đúng nghĩa "bị chặn".
 *
 * ⚠ VẪN GIỮ NHÁNH DỰ PHÒNG. Khi trình duyệt chặn thật thì không có nhánh
 * này là người dùng bấm nút và KHÔNG CÓ GÌ XẢY RA — họ bấm tiếp mấy lần
 * rồi kết luận app hỏng. Thà chuyển trang cùng tab còn hơn không đi đâu.
 */
export function openInNewTab(href: string) {
  if (typeof window === "undefined") return
  const w = window.open(href, "_blank")
  if (!w) {
    window.location.href = href
    return
  }
  // Tab mới không được nắm `window.opener` của tab này.
  try {
    w.opener = null
  } catch {
    /* Trình duyệt không cho gán thì thôi — tab mới vẫn mở đúng. */
  }
}
