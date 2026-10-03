import { SectionTabs } from "@/components/analytics/section-tabs"

const TABS = [
  { label: "Tổng quan", href: "/analytics/products/overview" },
  { label: "Tồn kho", href: "/analytics/products/stock" },
  /* "Phân loại hàng hóa" (/analytics/products/categories) không còn trên menu: trang ấy từng gom theo
     nhóm hàng — chủ nhà 03/10/2026 "Bỏ luôn trường nhóm hàng". Gom theo NCC: /bao-cao/ban-hang. */
]

export default function ProductsAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} />
      {children}
    </div>
  )
}
