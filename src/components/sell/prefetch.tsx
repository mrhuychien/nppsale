"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

/**
 * Nạp sẵn mọi màn của luồng bán hàng.
 *
 * VÌ SAO — ĐÂY LÀ CHỖ "KHÔNG GIỐNG APP" NHẤT
 *   Các màn `/sell/*` là route ĐỘNG (layout đọc cookie phiên), và chúng
 *   được mở bằng `router.push`, không bằng `<Link>` — nên Next KHÔNG tự
 *   nạp sẵn. Mỗi lần chạm "Xem đơn", "Chọn khách", "Hàng trả"… là một
 *   vòng đi-về máy chủ để lấy khung màn hình trước khi vẽ: ~200–400 ms
 *   trên 4G, hơn nửa giây trên 3G, và màn hình đứng im trong lúc đó.
 *   Ghi một đơn 15 dòng là 30 lần chờ như vậy.
 *
 *   `router.prefetch(href)` với kiểu mặc định FULL kéo khung màn hình về
 *   trước và giữ 5 phút; cú `push` sau đó lấy từ bộ nhớ, không chờ mạng.
 *
 * ⚠ Nạp lại ở MỖI LẦN ĐỔI MÀN trong luồng, không chỉ một lần khi vào:
 * người ta ở trong luồng lâu hơn 5 phút là chuyện thường, và mục đã hết
 * hạn thì cú push kế tiếp lại chờ mạng. Nạp lại rẻ — mục còn hạn thì
 * Next bỏ qua, không gửi gì.
 *
 * Danh sách này là MỌI màn trong luồng, không phải "màn kế tiếp có thể":
 * đoán màn kế tiếp là đoán, và đoán sai đúng một lần là người dùng thấy
 * chờ. Tám request nhỏ (mỗi cái vài kB) chạy ngầm sau khi màn đã vẽ.
 */
export const SELL_SCREENS = [
  "/sell",
  "/sell/cart",
  "/sell/customer",
  "/sell/returns",
  "/sell/terms",
  "/sell/scan",
  "/sell/drafts",
  "/sell/done",
] as const

export function SellPrefetch() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Sau khi màn hiện tại đã vẽ xong — không tranh mạng với danh mục.
    const id = window.setTimeout(() => {
      for (const href of SELL_SCREENS) {
        if (href !== pathname) router.prefetch(href)
      }
    }, 300)
    return () => window.clearTimeout(id)
  }, [router, pathname])

  return null
}
