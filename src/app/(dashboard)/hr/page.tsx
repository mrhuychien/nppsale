"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarCheck, Calculator, Settings2, Trophy, Users } from "lucide-react"
import Link from "next/link"

const HR_LINKS = [
  {
    label: "Bảng lương",
    description: "Tính lương theo tháng — lương CB, phụ cấp, thưởng KPI, BHXH",
    href: "/hr/payroll/runs",
    icon: Calculator,
  },
  {
    label: "Cấu hình lương",
    description: "Lương cơ bản, phụ cấp, mức doanh số chung & thưởng KPI",
    href: "/hr/salary-config",
    icon: Settings2,
  },
  {
    label: "Cấu hình thưởng",
    description: "Thưởng đầu thùng, thưởng theo số đơn, KPI tháng",
    href: "/hr/bonus-config",
    icon: Trophy,
  },
  {
    label: "Chấm công",
    description: "Bảng chấm công nhân viên (tham khảo — lương không phụ thuộc)",
    href: "/hr/attendance",
    icon: CalendarCheck,
  },
]

export default function HrPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user } = useAuth()
  const [stats, setStats] = useState({ totalEmployees: 0, payrollStatus: "" })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchStats() {
      if (!user?.org_id) return
      const currentPeriod = new Date().toISOString().slice(0, 7)

      const monthStart = `${currentPeriod}-01`
      const [usersRes, payrollRes] = await Promise.all([
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("org_id", user.org_id)
          .eq("is_active", true),
        supabase
          .from("payroll_runs")
          .select("status, computed_at")
          .eq("org_id", user.org_id)
          .eq("month", monthStart)
          .limit(1),
      ])

      const totalEmployees = usersRes.count ?? 0
      const payrollData = payrollRes.data as Array<{ status: string; computed_at: string | null }> | null
      let payrollStatus = "Chưa tạo kỳ lương"
      if (payrollData && payrollData.length > 0) {
        const r = payrollData[0]
        if (r.status === "locked") payrollStatus = "Đã khoá"
        else if (r.computed_at) payrollStatus = "Đã tính (nháp)"
        else payrollStatus = "Mới tạo, chưa tính"
      }

      setStats({ totalEmployees, payrollStatus })
      setLoading(false)
    }
    fetchStats()
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhân sự"
        description="Quản lý chấm công, lương thưởng nhân viên"
        backHref="/"
      />

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Tổng nhân viên
              </p>
              <h3 className="text-2xl font-black">{stats.totalEmployees}</h3>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calculator className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Lương tháng này
              </p>
              <h3 className="text-lg font-black">{stats.payrollStatus}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {HR_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <link.icon className="h-5 w-5" />
                  {link.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{link.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
