"use client"

import NextLink from "next/link"
import { forwardRef, type ComponentProps } from "react"

/**
 * LIÊN KẾT CỦA APP — `next/link` nhưng TẮT TẢI TRƯỚC mặc định.
 *
 * ⚠ Chủ nhà 26/09/2026: "mở các danh sách trên máy tính cứ bị chậm hơn bình thường". Log
 *   Vercel cho thấy mỗi lần mở danh sách bắn ra hàng loạt lượt tải trước (`/customers/<id>` ×12
 *   trong cùng một giây): `next/link` tự tải trước MỌI liên kết lọt vào khung nhìn — ~10 mục
 *   menu + 1 lượt mỗi dòng danh sách. App này mọi trang đều động (đọc phiên đăng nhập), nên
 *   mỗi lượt là một lần máy chủ chạy trang + hỏi Supabase; danh sách 50 dòng ≈ 60 lượt, gói
 *   Vercel miễn phí xếp hàng và chính trang đang mở phải chờ.
 *   Chỗ nào THẬT SỰ cần tải trước thì truyền `prefetch` rõ ràng.
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function Link(
  { prefetch = false, ...props },
  ref
) {
  return <NextLink ref={ref} prefetch={prefetch} {...props} />
})

export default Link
