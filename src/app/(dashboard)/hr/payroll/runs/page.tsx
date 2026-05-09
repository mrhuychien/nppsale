"use client"

/**
 * T-16: Bảng lương — payroll runs list + compute/lock + per-user
 * inline manual_adjustment.
 *
 * Sits alongside the legacy /hr/payroll page; this canonical Pack3
 * surface uses payroll_runs + payroll_run_items via the
 * compute_payroll_run RPC.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Calculator, Lock, RefreshCw, Plus, FileSpreadsheet, Printer } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { downloadXlsx } from "@/components/analytics/report-frame"
import { Payslip } from "@/components/printing/payslip"
import {
  ensurePayrollRun,
  computePayrollRun,
  lockPayrollRun,
  setManualAdjustment,
  type PayrollRun,
  type PayrollRunItem,
} from "@/lib/payroll/run"

interface UserRow {
  id: string
  full_name: string | null
  role: string
}

function nthOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

export default function PayrollRunsPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const supabase = createClient()
  const { toast } = useToast()

  const now = new Date()
  const [month, setMonth] = useState<string>(nthOfMonth(now))
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [activeRun, setActiveRun] = useState<PayrollRun | null>(null)
  const [items, setItems] = useState<PayrollRunItem[]>([])
  const [users, setUsers] = useState<Map<string, UserRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingAdjust, setPendingAdjust] = useState<Record<string, string>>({})
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({})
  // Per-user payslip print mode — caller picks one row → we render the
  // <Payslip> for it inside the .print-payslip-only block.
  const [payslipFor, setPayslipFor] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>("")

  const loadRuns = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [runsRes, orgRes] = await Promise.all([
      supabase
        .from("payroll_runs")
        .select("*")
        .eq("org_id", user.org_id)
        .order("month", { ascending: false }),
      supabase
        .from("organizations")
        .select("name")
        .eq("id", user.org_id)
        .maybeSingle(),
    ])
    setRuns((runsRes.data as PayrollRun[]) || [])
    setOrgName(((orgRes.data as { name: string } | null)?.name) || "")
    setLoading(false)
  }, [user?.org_id, supabase])

  const loadActive = useCallback(
    async (runId: string) => {
      const [runRes, itemRes, userRes] = await Promise.all([
        supabase.from("payroll_runs").select("*").eq("id", runId).single(),
        supabase
          .from("payroll_run_items")
          .select("*")
          .eq("payroll_run_id", runId)
          .order("created_at"),
        supabase
          .from("users")
          .select("id, full_name, role")
          .eq("org_id", user?.org_id ?? ""),
      ])
      setActiveRun((runRes.data as PayrollRun) ?? null)
      setItems((itemRes.data as PayrollRunItem[]) ?? [])
      const m = new Map<string, UserRow>()
      ;(((userRes.data as UserRow[]) || [])).forEach((u) => m.set(u.id, u))
      setUsers(m)
      setPendingAdjust({})
      setPendingNotes({})
    },
    [supabase, user?.org_id]
  )

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const totals = useMemo(() => {
    return items.reduce(
      (acc, it) => {
        acc.gross +=
          Number(it.prorated_base) +
          Number(it.kpi_bonus) +
          Number(it.order_count_bonus) +
          Number(it.activity_bonus) +
          Number(it.overtime)
        acc.adjustments += Number(it.manual_adjustment || 0)
        acc.deductions += Number(it.deductions || 0) + Number(it.social_insurance || 0)
        acc.net += Number(it.net_salary || 0)
        return acc
      },
      { gross: 0, adjustments: 0, deductions: 0, net: 0 }
    )
  }, [items])

  const handleCreateOrOpen = async () => {
    if (!user?.org_id) return
    setBusy(true)
    try {
      const { run, error } = await ensurePayrollRun(supabase, {
        orgId: user.org_id,
        month,
        userId: user.id,
      })
      if (error) throw new Error(error)
      if (!run) throw new Error("Empty response")
      await loadRuns()
      await loadActive(run.id)
      toast({ title: `Mở bảng lương ${month.slice(0, 7)}` })
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleCompute = async () => {
    if (!activeRun) return
    setBusy(true)
    try {
      const { count, error } = await computePayrollRun(supabase, activeRun.id)
      if (error) throw new Error(error)
      await loadActive(activeRun.id)
      toast({ title: `Đã tính lại — ${count} nhân sự.` })
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleLock = async () => {
    if (!activeRun) return
    if (!window.confirm("Khoá bảng lương này? Sau khi khoá không thể chỉnh sửa.")) {
      return
    }
    setBusy(true)
    try {
      const { error } = await lockPayrollRun(supabase, activeRun.id)
      if (error) throw new Error(error)
      await loadActive(activeRun.id)
      toast({ title: "Đã khoá bảng lương" })
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleExport = async () => {
    if (!activeRun || items.length === 0) return
    const header = [
      "STT",
      "Nhân sự",
      "Vai trò",
      "Công chuẩn",
      "Công thực",
      "Lương cơ bản",
      "Theo công",
      "KPI",
      "Đơn",
      "Hoạt động",
      "OT",
      "Trừ",
      "BHXH",
      "Điều chỉnh",
      "Net",
      "Ghi chú",
    ]
    const rows: (string | number)[][] = [header]
    items.forEach((it, i) => {
      const u = users.get(it.user_id)
      rows.push([
        i + 1,
        u?.full_name || "—",
        u?.role || "",
        Number(it.standard_workdays || 0),
        Number(it.actual_workdays || 0),
        Number(it.base_salary || 0),
        Number(it.prorated_base || 0),
        Number(it.kpi_bonus || 0),
        Number(it.order_count_bonus || 0),
        Number(it.activity_bonus || 0),
        Number(it.overtime || 0),
        Number(it.deductions || 0),
        Number(it.social_insurance || 0),
        Number(it.manual_adjustment || 0),
        Number(it.net_salary || 0),
        it.notes || "",
      ])
    })
    // Totals row.
    rows.push([
      "",
      "TỔNG CỘNG",
      "",
      "",
      "",
      "",
      Number(items.reduce((s, it) => s + Number(it.prorated_base || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.kpi_bonus || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.order_count_bonus || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.activity_bonus || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.overtime || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.deductions || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.social_insurance || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.manual_adjustment || 0), 0).toFixed(0)),
      Number(items.reduce((s, it) => s + Number(it.net_salary || 0), 0).toFixed(0)),
      "",
    ])
    const period = activeRun.month.slice(0, 7)
    await downloadXlsx(`bang-luong-${period}`, rows, `Bảng lương ${period}`)
    toast({ title: `Đã xuất Excel: bang-luong-${period}.xlsx` })
  }

  const printPayslipFor = (itemId: string) => {
    setPayslipFor(itemId)
    const html = document.documentElement
    html.setAttribute("data-print-mode", "payslip")
    requestAnimationFrame(() => {
      window.print()
      setTimeout(() => {
        html.removeAttribute("data-print-mode")
        setPayslipFor(null)
      }, 300)
    })
  }

  const saveAdjust = async (item: PayrollRunItem) => {
    const raw = pendingAdjust[item.id]
    const amt = Number(raw ?? item.manual_adjustment ?? 0) || 0
    const notes = pendingNotes[item.id] ?? item.notes ?? ""
    setBusy(true)
    try {
      const { error } = await setManualAdjustment(supabase, item.id, {
        manual_adjustment: amt,
        notes: notes || null,
      })
      if (error) throw new Error(error)
      if (activeRun) await loadActive(activeRun.id)
      toast({ title: "Đã lưu điều chỉnh" })
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const isLocked = activeRun?.status === "locked"

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
      <PageHeader
        title="Bảng lương (Pack3)"
        description="Tính lương theo tháng — KPI, thưởng số đơn, hoạt động, BHXH"
        backHref="/hr"
      >
        <div className="flex gap-2">
          <Input
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) =>
              setMonth(`${e.target.value}-01`)
            }
            className="h-9 w-40"
          />
          <Button size="sm" onClick={handleCreateOrOpen} disabled={busy}>
            <Plus className="h-4 w-4 mr-1.5" /> Mở / Tạo
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Left: list of runs */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Các kỳ lương</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-40" />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có kỳ nào.</p>
            ) : (
              <ul className="space-y-1">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => loadActive(r.id)}
                      className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                        activeRun?.id === r.id ? "bg-primary/10" : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="font-mono">{r.month.slice(0, 7)}</span>
                      <Badge variant={r.status === "locked" ? "success" : "warning"}>
                        {r.status === "locked" ? "Đã khoá" : "Nháp"}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right: active run details */}
        <div className="lg:col-span-3 space-y-3">
          {!activeRun ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Chọn một kỳ lương ở danh sách bên trái hoặc tạo mới ở header.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Tháng</p>
                    <p className="text-xl font-bold font-mono">{activeRun.month.slice(0, 7)}</p>
                    {activeRun.computed_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Tính lúc {formatDate(activeRun.computed_at)}
                      </p>
                    )}
                  </div>
                  <Badge variant={isLocked ? "success" : "warning"}>
                    {isLocked ? "Đã khoá" : "Nháp"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCompute}
                    disabled={busy || isLocked}
                  >
                    <Calculator className="h-4 w-4 mr-1.5" /> Tính lại
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={items.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Xuất Excel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleLock}
                    disabled={busy || isLocked || items.length === 0}
                  >
                    <Lock className="h-4 w-4 mr-1.5" /> Khoá kỳ
                  </Button>
                </CardContent>
              </Card>

              {/* Totals */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Tổng gross</p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(totals.gross)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Điều chỉnh</p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(totals.adjustments)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Trừ</p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(totals.deductions)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Net</p>
                    <p className="text-lg font-bold tabular-nums text-primary">
                      {formatCurrency(totals.net)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Items */}
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="px-2 py-2 text-left">Nhân sự</th>
                        <th className="px-2 py-2 text-right">Công CN/TT</th>
                        <th className="px-2 py-2 text-right">Lương cơ bản (theo công)</th>
                        <th className="px-2 py-2 text-right">KPI</th>
                        <th className="px-2 py-2 text-right">Đơn</th>
                        <th className="px-2 py-2 text-right">Hoạt động</th>
                        <th className="px-2 py-2 text-right">BHXH</th>
                        <th className="px-2 py-2 text-right">Điều chỉnh</th>
                        <th className="px-2 py-2 text-left">Ghi chú</th>
                        <th className="px-2 py-2 text-right">Net</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center text-muted-foreground py-6">
                            Bấm <strong>Tính lại</strong> để khởi tạo dòng nhân sự.
                          </td>
                        </tr>
                      ) : (
                        items.map((it) => {
                          const u = users.get(it.user_id)
                          const adjVal =
                            pendingAdjust[it.id] !== undefined
                              ? pendingAdjust[it.id]
                              : String(it.manual_adjustment ?? 0)
                          const noteVal =
                            pendingNotes[it.id] !== undefined
                              ? pendingNotes[it.id]
                              : it.notes ?? ""
                          const dirty =
                            (pendingAdjust[it.id] !== undefined &&
                              Number(pendingAdjust[it.id]) !== Number(it.manual_adjustment)) ||
                            (pendingNotes[it.id] !== undefined &&
                              pendingNotes[it.id] !== (it.notes ?? ""))
                          return (
                            <tr key={it.id} className="border-b last:border-0">
                              <td className="px-2 py-2">
                                <div className="font-medium">{u?.full_name || "—"}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {u?.role}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {Number(it.actual_workdays).toLocaleString("vi-VN")} /{" "}
                                {Number(it.standard_workdays).toLocaleString("vi-VN")}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.prorated_base)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.kpi_bonus)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.order_count_bonus)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.activity_bonus)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-destructive">
                                −{formatCurrency(it.social_insurance)}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <Input
                                  type="number"
                                  value={adjVal}
                                  onChange={(e) =>
                                    setPendingAdjust((p) => ({ ...p, [it.id]: e.target.value }))
                                  }
                                  className="h-8 w-28 text-right tabular-nums"
                                  disabled={isLocked}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <Input
                                  value={noteVal}
                                  onChange={(e) =>
                                    setPendingNotes((p) => ({ ...p, [it.id]: e.target.value }))
                                  }
                                  className="h-8 w-40 text-xs"
                                  disabled={isLocked}
                                />
                              </td>
                              <td className="px-2 py-2 text-right font-bold tabular-nums">
                                {formatCurrency(it.net_salary)}
                              </td>
                              <td className="px-2 py-2 flex gap-1 justify-end">
                                {dirty && !isLocked && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => saveAdjust(it)}
                                    disabled={busy}
                                    title="Lưu điều chỉnh"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => printPayslipFor(it.id)}
                                  title="In phiếu lương"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
      </div>{/* /.no-print wrapper */}

      {/* Per-user payslip — toggled by data-print-mode='payslip'. */}
      <div className="print-payslip-only">
        {payslipFor && activeRun && (() => {
          const it = items.find((x) => x.id === payslipFor)
          if (!it) return null
          const u = users.get(it.user_id)
          return (
            <Payslip
              organizationName={orgName || "—"}
              employeeName={u?.full_name || "—"}
              employeeRole={u?.role}
              period={activeRun.month.slice(0, 7)}
              baseSalary={Number(it.base_salary || 0)}
              standardWorkdays={Number(it.standard_workdays || 0)}
              actualWorkdays={Number(it.actual_workdays || 0)}
              proratedBase={Number(it.prorated_base || 0)}
              kpiBonus={Number(it.kpi_bonus || 0)}
              orderCountBonus={Number(it.order_count_bonus || 0)}
              activityBonus={Number(it.activity_bonus || 0)}
              overtime={Number(it.overtime || 0)}
              deductions={Number(it.deductions || 0)}
              socialInsurance={Number(it.social_insurance || 0)}
              manualAdjustment={Number(it.manual_adjustment || 0)}
              netSalary={Number(it.net_salary || 0)}
              notes={it.notes}
              computedAt={activeRun.computed_at}
              lockedAt={activeRun.locked_at}
            />
          )
        })()}
      </div>
    </div>
  )
}
