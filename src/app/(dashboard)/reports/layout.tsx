import { AnalyticsSidebar } from "@/components/analytics/analytics-sidebar"

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      <AnalyticsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
