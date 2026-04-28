import { SectionTabs } from "@/components/analytics/section-tabs"

const TABS = [
  { label: "Tổng quan", href: "/analytics/products/overview" },
  { label: "Tồn kho", href: "/analytics/products/stock" },
  { label: "Phân loại hàng hóa", href: "/analytics/products/categories" },
]

export default function ProductsAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} />
      {children}
    </div>
  )
}
