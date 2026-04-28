import { SectionTabs } from "@/components/analytics/section-tabs"

const TABS = [
  { label: "Tổng quan", href: "/analytics/business/overview" },
  { label: "Chi phí - Lợi nhuận", href: "/analytics/business/cost-profit" },
]

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} />
      {children}
    </div>
  )
}
