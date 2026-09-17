import { SellCartProvider } from "@/hooks/use-sell-cart"
import { SellDataProvider } from "@/hooks/use-sell-data"
import { SellPrefetch } from "@/components/sell/prefetch"

/**
 * Luồng bán hàng trên điện thoại.
 *
 * Cả giỏ hàng lẫn danh mục sống ở đây chứ không trong từng màn: đây là
 * NHIỀU TRANG thật (tìm hàng → giỏ → chọn khách → điều khoản) nên nút Back
 * của điện thoại đi lại được giữa chúng mà không mất giỏ và không phải tải
 * lại 1.700 sản phẩm mỗi lần chuyển màn.
 *
 * `SellPrefetch` nạp sẵn khung của mọi màn trong luồng để chuyển màn không
 * chờ mạng — xem chú thích trong file đó.
 */
export default function SellLayout({ children }: { children: React.ReactNode }) {
  return (
    <SellDataProvider>
      <SellCartProvider>
        <SellPrefetch />
        {children}
      </SellCartProvider>
    </SellDataProvider>
  )
}
