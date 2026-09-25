import { SellCartProvider } from "@/hooks/use-sell-cart"
import { SellDataProvider } from "@/hooks/use-sell-data"
import { CommittedStockProvider } from "@/hooks/use-committed-stock"
import { SellPrefetch } from "@/components/sell/prefetch"
import { DonDoModal } from "@/components/sell/don-do-modal"

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
 *
 * ⚠ `CommittedStockProvider` PHẢI NẰM TRONG `SellCartProvider`. Số hàng
 * đã đặt phải loại ĐƠN ĐANG SỬA ra, mà chỉ giỏ mới biết đơn nào đang mở.
 */
export default function SellLayout({ children }: { children: React.ReactNode }) {
  return (
    <SellDataProvider>
      <SellCartProvider>
        <CommittedStockProvider>
          <SellPrefetch />
          {/* Chủ nhà 25/09/2026: vào làm đơn mà còn đơn dở thì hỏi Có / Không. */}
          <DonDoModal />
          {children}
        </CommittedStockProvider>
      </SellCartProvider>
    </SellDataProvider>
  )
}
