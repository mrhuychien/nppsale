"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { ChevronLeft, ChevronRight, Calculator, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ROLE_LABELS } from "@/lib/constants"
import { useRouter } from "next/navigation"
import type { HrPayroll, User, HrSalaryConfig, HrMonthlyBonus, HrAttendance } from "@/types"

const STATUS_MAP: Record<string, { label: string; variant: "secondary" | "default" | "success" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  confirmed: { label: "Đã duyệt", variant: "default" },
  paid: { label: "Đã trả", variant: "success" },
}

export default function PayrollPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const router = useRouter()
  const supabase = createClient()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [payrolls, setPayrolls] = useState<HrPayroll[]>([])
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)

  const period = `${year}-${String(month).padStart(2, "0")}`

  const fetchPayrolls = useCallback(async () => {
    if (!authUser?.org_id) return
    setLoading(true)
    const { data } = await supabase
      .from("hr_payroll")
      .select("*, user:users(*)")
      .eq("org_id", authUser.org_id)
      .eq("period", period)
      .order("total_salary", { ascending: false })
    setPayrolls((data as HrPayroll[]) || [])
    setLoading(false)
  }, [authUser?.org_id, period]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPayrolls()
  }, [fetchPayrolls])

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  const calculatePayroll = async () => {
    if (!authUser?.org_id) return
    setCalculating(true)

    try {
      // Fetch salary config
      const { data: configData } = await supabase
        .from("hr_salary_config")
        .select("*")
        .eq("org_id", authUser.org_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()

      const config = configData as HrSalaryConfig | null
      if (!config) {
        alert("Chưa cấu hình lương. Vui lòng vào Cấu hình lương trước.")
        setCalculating(false)
        return
      }

      // Fetch monthly bonus tiers
      const { data: bonusData } = await supabase
        .from("hr_monthly_bonus")
        .select("*")
        .eq("org_id", authUser.org_id)
        .eq("period", period)
        .maybeSingle()
      const bonusConfig = bonusData as HrMonthlyBonus | null

      // Fetch all active employees
      const { data: usersData } = await supabase
        .from("users")
        .select("*")
        .eq("org_id", authUser.org_id)
        .eq("is_active", true)
      const users = (usersData as User[]) || []

      // Fetch attendance for this month
      const startDate = `${period}-01`
      const daysInMonth = new Date(year, month, 0).getDate()
      const endDate = `${period}-${String(daysInMonth).padStart(2, "0")}`
      const { data: attendData } = await supabase
        .from("hr_attendance")
        .select("*")
        .eq("org_id", authUser.org_id)
        .gte("work_date", startDate)
        .lte("work_date", endDate)
      const attendanceList = (attendData as HrAttendance[]) || []

      // Fetch revenue from sales_orders for each sales user
      const { data: revenueData } = await supabase
        .from("sales_orders")
        .select("sales_user_id, total")
        .eq("org_id", authUser.org_id)
        .eq("status", "delivered")
        .gte("order_date", startDate)
        .lte("order_date", endDate)

      const revenueByUser: Record<string, number> = {}
      for (const order of revenueData || []) {
        const uid = order.sales_user_id
        if (uid) {
          revenueByUser[uid] = (revenueByUser[uid] || 0) + (order.total || 0)
        }
      }

      // Count attendance per user
      const attendByUser: Record<string, number> = {}
      const absentByUser: Record<string, number> = {}
      for (const a of attendanceList) {
        if (!attendByUser[a.user_id]) attendByUser[a.user_id] = 0
        if (!absentByUser[a.user_id]) absentByUser[a.user_id] = 0
        if (a.status === "present") attendByUser[a.user_id] += 1
        else if (a.status === "half_day") attendByUser[a.user_id] += 0.5
        else if (a.status === "absent") absentByUser[a.user_id] += 1
      }

      // Calculate payroll for each user
      const payrollRows = users.map((emp) => {
        const isSales = emp.role === "sales"
        const workingDays = attendByUser[emp.id] || 0
        const absentDays = absentByUser[emp.id] || 0
        const totalRevenue = isSales ? (revenueByUser[emp.id] || 0) : 0
        const workingDaysPerMonth = config.working_days_per_month || 26
        const attendanceRatio = workingDaysPerMonth > 0 ? workingDays / workingDaysPerMonth : 0

        const baseSalary = config.base_salary
        const gasAllowance = config.gas_allowance
        const phoneAllowance = config.phone_allowance
        let targetBonus = 0
        let overTargetBonus = 0
        let monthlyRevenueBonus = 0
        let targetAmount = 0
        let targetPercent = 0

        if (isSales) {
          // Find target from tiers - use the highest tier min_percent as the "100% target"
          const tiers = config.target_tiers || []
          // The monthly target (100%) - use the first tier as base reference
          // We look for the tier that represents 100%
          const tier100 = tiers.find((t) => t.min_percent === 100)
          targetAmount = tier100 ? tier100.bonus : 0
          // Actually targetAmount should come from org settings or be a separate field
          // For now, use revenue as % of a target derived from tiers
          // The target_percent is revenue relative to some target
          // We'll calculate target from the config or derive from tiers
          if (tiers.length > 0) {
            // Find max tier to get total target perspective
            // target_amount is often set per user/org - here we use a simple approach
            const maxTier = tiers.reduce((a, b) => (a.min_percent > b.min_percent ? a : b), tiers[0])
            targetAmount = maxTier.min_percent > 0 ? (totalRevenue / (maxTier.min_percent / 100)) : totalRevenue
          }

          targetPercent = targetAmount > 0 ? (totalRevenue / targetAmount) * 100 : 0

          // Under 60%: only revenue * under_60_percent
          if (targetPercent < 60) {
            const total = totalRevenue * ((config.under_60_percent || 0) / 100)
            return {
              org_id: authUser.org_id,
              user_id: emp.id,
              period,
              working_days: workingDays,
              absent_days: absentDays,
              total_revenue: totalRevenue,
              target_amount: targetAmount,
              target_percent: Math.round(targetPercent * 100) / 100,
              base_salary: 0,
              gas_allowance: 0,
              phone_allowance: 0,
              target_bonus: 0,
              over_target_bonus: 0,
              monthly_revenue_bonus: 0,
              deductions: 0,
              total_salary: Math.round(total),
              breakdown: { rule: "under_60", percent: config.under_60_percent },
              status: "draft",
            }
          }

          // Under 70%: only base + gas + phone
          if (targetPercent < 70) {
            const total = (baseSalary + gasAllowance + phoneAllowance) * attendanceRatio
            return {
              org_id: authUser.org_id,
              user_id: emp.id,
              period,
              working_days: workingDays,
              absent_days: absentDays,
              total_revenue: totalRevenue,
              target_amount: targetAmount,
              target_percent: Math.round(targetPercent * 100) / 100,
              base_salary: Math.round(baseSalary * attendanceRatio),
              gas_allowance: Math.round(gasAllowance * attendanceRatio),
              phone_allowance: Math.round(phoneAllowance * attendanceRatio),
              target_bonus: 0,
              over_target_bonus: 0,
              monthly_revenue_bonus: 0,
              deductions: 0,
              total_salary: Math.round(total),
              breakdown: { rule: "under_70" },
              status: "draft",
            }
          }

          // Calculate target bonus from tiers
          for (const tier of tiers.sort((a, b) => b.min_percent - a.min_percent)) {
            if (targetPercent >= tier.min_percent) {
              targetBonus = tier.bonus
              break
            }
          }

          // Over 100% bonus
          if (targetPercent > 100 && config.over_target_percent > 0) {
            overTargetBonus = (totalRevenue - targetAmount) * (config.over_target_percent / 100)
          }

          // Monthly revenue bonus from hr_monthly_bonus tiers
          if (bonusConfig?.tiers) {
            const bonusTiers = [...bonusConfig.tiers].sort((a, b) => b.min_revenue - a.min_revenue)
            for (const bt of bonusTiers) {
              if (totalRevenue >= bt.min_revenue) {
                monthlyRevenueBonus = bt.bonus
                break
              }
            }
          }
        }

        // Prorate everything by attendance
        const proratedBase = baseSalary * attendanceRatio
        const proratedGas = gasAllowance * attendanceRatio
        const proratedPhone = phoneAllowance * attendanceRatio
        const proratedTarget = targetBonus * attendanceRatio
        const proratedOver = overTargetBonus * attendanceRatio
        const proratedMonthly = monthlyRevenueBonus * attendanceRatio

        const totalSalary = proratedBase + proratedGas + proratedPhone + proratedTarget + proratedOver + proratedMonthly

        return {
          org_id: authUser.org_id,
          user_id: emp.id,
          period,
          working_days: workingDays,
          absent_days: absentDays,
          total_revenue: totalRevenue,
          target_amount: Math.round(targetAmount),
          target_percent: Math.round(targetPercent * 100) / 100,
          base_salary: Math.round(proratedBase),
          gas_allowance: Math.round(proratedGas),
          phone_allowance: Math.round(proratedPhone),
          target_bonus: Math.round(proratedTarget),
          over_target_bonus: Math.round(proratedOver),
          monthly_revenue_bonus: Math.round(proratedMonthly),
          deductions: 0,
          total_salary: Math.round(totalSalary),
          breakdown: {
            config_base: config.base_salary,
            config_gas: config.gas_allowance,
            config_phone: config.phone_allowance,
            attendance_ratio: Math.round(attendanceRatio * 10000) / 10000,
            working_days_per_month: workingDaysPerMonth,
          },
          status: "draft",
        }
      })

      // Upsert all payrolls
      await supabase
        .from("hr_payroll")
        .upsert(payrollRows, { onConflict: "user_id,period" })

      await fetchPayrolls()
    } catch (err) {
      console.error("Payroll calculation error:", err)
      alert("Lỗi khi tính lương. Vui lòng thử lại.")
    } finally {
      setCalculating(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Bảng lương" description="Tính lương và quản lý chi trả" backHref="/hr">
        <Button onClick={calculatePayroll} disabled={calculating}>
          {calculating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}
          Tính lương tháng
        </Button>
      </PageHeader>

      {/* Period Selector */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-black">Kỳ lương: {period}</h2>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64" />
      ) : payrolls.length === 0 ? (
        <EmptyState
          icon={<Calculator className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có dữ liệu lương"
          description={`Nhấn "Tính lương tháng" để tính lương kỳ ${period}`}
        />
      ) : (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>STT</TableHead>
                <TableHead>Tên NV</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead className="text-right">Ngày công</TableHead>
                <TableHead className="text-right">Doanh số</TableHead>
                <TableHead className="text-right">% KPI</TableHead>
                <TableHead className="text-right">Lương CB</TableHead>
                <TableHead className="text-right">Phụ cấp</TableHead>
                <TableHead className="text-right">Thưởng KPI</TableHead>
                <TableHead className="text-right">Thưởng DS</TableHead>
                <TableHead className="text-right">Tổng lương</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrolls.map((p, idx) => {
                const status = STATUS_MAP[p.status] || STATUS_MAP.draft
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/hr/payroll/${p.id}`)}
                  >
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-semibold">{p.user?.full_name || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.user?.role ? ROLE_LABELS[p.user.role] : "-"}
                    </TableCell>
                    <TableCell className="text-right">{p.working_days}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.total_revenue)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {p.target_percent > 0 ? `${p.target_percent}%` : "-"}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(p.base_salary)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(p.gas_allowance + p.phone_allowance)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(p.target_bonus)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(p.monthly_revenue_bonus + p.over_target_bonus)}
                    </TableCell>
                    <TableCell className="text-right font-black text-primary">
                      {formatCurrency(p.total_salary)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Summary */}
      {payrolls.length > 0 && (
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <span className="text-sm font-bold text-muted-foreground">
              Tổng quỹ lương kỳ {period}
            </span>
            <span className="text-2xl font-black text-primary">
              {formatCurrency(payrolls.reduce((s, p) => s + p.total_salary, 0))}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
