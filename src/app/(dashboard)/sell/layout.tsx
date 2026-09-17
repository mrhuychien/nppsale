import { SellCartProvider } from "@/hooks/use-sell-cart"

/**
 * Luồng bán hàng trên điện thoại.
 *
 * Giỏ hàng sống ở đây chứ không trong từng màn: đây là NHIỀU TRANG thật
 * (tìm hàng → giỏ → chọn khách → điều khoản) nên nút Back của điện thoại
 * đi lại được giữa chúng mà không mất giỏ.
 */
export default function SellLayout({ children }: { children: React.ReactNode }) {
  return <SellCartProvider>{children}</SellCartProvider>
}
