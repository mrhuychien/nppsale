import { SectionTabs } from "@/components/analytics/section-tabs"

const TABS = [
  { label: "Kết quả HĐKD", href: "/reports/finance" },
  { label: "Lãi lỗ (P&L)", href: "/reports/finance/pnl" },
  { label: "Bảng cân đối", href: "/reports/finance/balance-sheet" },
  { label: "Dòng tiền", href: "/reports/finance/cash-flow" },
]

export default function FinanceReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} />
      {children}
    </div>
  )
}
