import { SectionTabs } from "@/components/analytics/section-tabs"

const TABS = [
  { label: "Tổng quan", href: "/analytics/customers/overview" },
  { label: "Phân loại khách hàng", href: "/analytics/customers/categories" },
]

export default function CustomersAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} />
      {children}
    </div>
  )
}
