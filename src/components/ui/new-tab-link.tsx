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
 * ⚠ CHẶN CỬA SỔ BẬT LÊN THÌ PHẢI ĐI TIẾP, KHÔNG ĐƯỢC IM. `window.open`
 * trả `null` khi trình duyệt chặn; không có nhánh dự phòng thì người
 * dùng bấm nút và KHÔNG CÓ GÌ XẢY RA — họ bấm tiếp mấy lần rồi kết luận
 * app hỏng. Thà chuyển trang cùng tab còn hơn không đi đâu cả.
 */
export function openInNewTab(href: string) {
  const w = typeof window !== "undefined" ? window.open(href, "_blank", "noopener,noreferrer") : null
  if (!w && typeof window !== "undefined") window.location.href = href
}
