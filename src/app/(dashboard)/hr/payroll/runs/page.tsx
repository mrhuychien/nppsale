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
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useOrg } from "@/hooks/use-org"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Calculator, Lock, RefreshCw, Plus, FileSpreadsheet, Printer, FileText } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { downloadXlsx } from "@/components/analytics/report-frame"
import { Payslip, type PayslipKpiTier } from "@/components/printing/payslip"
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

interface PayslipOrder {
  id: string
  order_code: string
  order_date: string
  total: number
  status: string
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
  const [pendingSi, setPendingSi] = useState<Record<string, string>>({})
  // Per-user payslip print mode — caller picks one row → we render the
  // <Payslip> for it inside the .print-payslip-only block.
  const [payslipFor, setPayslipFor] = useState<string | null>(null)
  const [payslipOrders, setPayslipOrders] = useState<PayslipOrder[]>([])
  const { org } = useOrg()
  const orgName = org?.name ?? ""
  // Detail dialog state.
  const [detailItem, setDetailItem] = useState<PayrollRunItem | null>(null)
  const [detailOrders, setDetailOrders] = useState<PayslipOrder[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const loadRuns = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const { data, error: dataErr } = await supabase
      .from("payroll_runs")
      .select("id, org_id, month, status, computed_at, locked_at, locked_by, created_at")
      .eq("org_id", user.org_id)
      .order("month", { ascending: false })
    if (dataErr) console.error("[payroll/runs] truy vấn lỗi:", dataErr.message)
    setRuns((data as PayrollRun[]) || [])
    setLoading(false)
  }, [user?.org_id, supabase])

  const loadActive = useCallback(
    async (runId: string) => {
      const [runRes, itemRes, userRes] = await Promise.all([
        supabase.from("payroll_runs").select("id, org_id, month, status, computed_at, locked_at, locked_by, created_at").eq("id", runId).single(),
        supabase
          .from("payroll_run_items")
          .select("id, payroll_run_id, user_id, base_salary, standard_workdays, actual_workdays, prorated_base, allowances, kpi_bonus, order_count_bonus, activity_bonus, overtime, deductions, social_insurance, manual_adjustment, net_salary, notes, computed_breakdown")
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
      setPendingSi({})
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
          Number(it.allowances || 0) +
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

  const openDetail = useCallback(
    async (item: PayrollRunItem) => {
      setDetailItem(item)
      setDetailOrders([])
      setDetailLoading(true)
      try {
        const bd = item.computed_breakdown || {}
        const ps = (bd.period_start as string) || ""
        const pe = (bd.period_end as string) || ""
        if (ps && pe) {
          const { data, error: dataErr } = await supabase
            .from("sales_orders")
            .select("id, order_code, order_date, total, status")
            .eq("sales_user_id", item.user_id)
            .in("status", ["delivered", "confirmed"])
            .gte("order_date", ps)
            .lte("order_date", pe)
            .order("order_date", { ascending: false })
          if (dataErr) console.error("[payroll/runs] truy vấn lỗi:", dataErr.message)
          setDetailOrders((data as PayslipOrder[]) || [])
        }
      } finally {
        setDetailLoading(false)
      }
    },
    [supabase]
  )

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
      // Fresh run → compute straight away so the user sees the payroll
      // lines without a second click. Existing runs are left as-is.
      let computed = 0
      const justCreated = !run.computed_at
      if (justCreated && run.status !== "locked") {
        const { count, error: cErr } = await computePayrollRun(supabase, run.id)
        if (cErr) throw new Error(cErr)
        computed = count
      }
      await loadRuns()
      await loadActive(run.id)
      toast({
        title: justCreated
          ? `Đã tạo & tính bảng lương ${month.slice(0, 7)} — ${computed} nhân sự`
          : `Mở bảng lương ${month.slice(0, 7)}`,
      })
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
      "Lương cơ bản",
      "Phụ cấp",
      "Thưởng KPI",
      "Thưởng số đơn",
      "Thưởng hoạt động",
      "OT",
      "Khấu trừ khác",
      "BHXH",
      "Điều chỉnh",
      "Thực lĩnh",
      "Ghi chú",
    ]
    const rows: (string | number)[][] = [header]
    items.forEach((it, i) => {
      const u = users.get(it.user_id)
      rows.push([
        i + 1,
        u?.full_name || "—",
        u?.role || "",
        Number(it.prorated_base || 0),
        Number(it.allowances || 0),
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
    const sum = (f: (it: PayrollRunItem) => number) =>
      Number(items.reduce((s, it) => s + f(it), 0).toFixed(0))
    rows.push([
      "",
      "TỔNG CỘNG",
      "",
      sum((it) => Number(it.prorated_base || 0)),
      sum((it) => Number(it.allowances || 0)),
      sum((it) => Number(it.kpi_bonus || 0)),
      sum((it) => Number(it.order_count_bonus || 0)),
      sum((it) => Number(it.activity_bonus || 0)),
      sum((it) => Number(it.overtime || 0)),
      sum((it) => Number(it.deductions || 0)),
      sum((it) => Number(it.social_insurance || 0)),
      sum((it) => Number(it.manual_adjustment || 0)),
      sum((it) => Number(it.net_salary || 0)),
      "",
    ])
    const period = activeRun.month.slice(0, 7)
    await downloadXlsx(`bang-luong-${period}`, rows, `Bảng lương ${period}`)
    toast({ title: `Đã xuất Excel: bang-luong-${period}.xlsx` })
  }

  const printPayslipFor = async (item: PayrollRunItem) => {
    // Load the orders that count toward this period so the printed
    // payslip is a self-contained handout for the employee.
    let ords: PayslipOrder[] = []
    try {
      const bd = item.computed_breakdown || {}
      const ps = (bd.period_start as string) || ""
      const pe = (bd.period_end as string) || ""
      if (ps && pe) {
        const { data, error: dataErr } = await supabase
          .from("sales_orders")
          .select("id, order_code, order_date, total, status")
          .eq("sales_user_id", item.user_id)
          .in("status", ["delivered", "confirmed"])
          .gte("order_date", ps)
          .lte("order_date", pe)
          .order("order_date", { ascending: false })
        if (dataErr) console.error("[payroll/runs] truy vấn lỗi:", dataErr.message)
        ords = (data as PayslipOrder[]) || []
      }
    } catch {
      ords = []
    }
    setPayslipOrders(ords)
    setPayslipFor(item.id)
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
    const amt = Number(pendingAdjust[item.id] ?? item.manual_adjustment ?? 0) || 0
    const notes = pendingNotes[item.id] ?? item.notes ?? ""
    const si = Number(pendingSi[item.id] ?? item.social_insurance ?? 0) || 0
    setBusy(true)
    try {
      const { error } = await setManualAdjustment(supabase, item.id, {
        manual_adjustment: amt,
        notes: notes || null,
        social_insurance: si,
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
        title="Bảng lương"
        description="Tính lương tháng cho nhân viên bán hàng — lương CB, phụ cấp, thưởng KPI, thưởng số đơn, hoạt động, BHXH"
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
                        activeRun?.id === r.id ? "bg-primary-fixed text-primary font-semibold" : "hover:bg-surface-container-low"
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
                        <th className="px-2 py-2 text-right">Lương cơ bản</th>
                        <th className="px-2 py-2 text-right">Phụ cấp</th>
                        <th className="px-2 py-2 text-right">KPI</th>
                        <th className="px-2 py-2 text-right">Đơn</th>
                        <th className="px-2 py-2 text-right">Hoạt động</th>
                        <th className="px-2 py-2 text-right">BHXH</th>
                        <th className="px-2 py-2 text-right">Điều chỉnh</th>
                        <th className="px-2 py-2 text-left">Ghi chú</th>
                        <th className="px-2 py-2 text-right">Thực lĩnh</th>
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
                          const siVal =
                            pendingSi[it.id] !== undefined
                              ? pendingSi[it.id]
                              : String(it.social_insurance ?? 0)
                          const dirty =
                            (pendingAdjust[it.id] !== undefined &&
                              Number(pendingAdjust[it.id]) !== Number(it.manual_adjustment)) ||
                            (pendingNotes[it.id] !== undefined &&
                              pendingNotes[it.id] !== (it.notes ?? "")) ||
                            (pendingSi[it.id] !== undefined &&
                              Number(pendingSi[it.id]) !== Number(it.social_insurance))
                          return (
                            <tr key={it.id} className="border-b last:border-0">
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => openDetail(it)}
                                  className="text-left group"
                                  title="Xem chi tiết phiếu lương"
                                >
                                  <div className="font-medium text-primary group-hover:underline">
                                    {u?.full_name || "—"}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {u?.role} · Xem phiếu lương
                                  </div>
                                </button>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.prorated_base)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatCurrency(it.allowances || 0)}
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
                              <td className="px-2 py-2 text-right">
                                <Input
                                  type="number"
                                  value={siVal}
                                  onChange={(e) =>
                                    setPendingSi((p) => ({ ...p, [it.id]: e.target.value }))
                                  }
                                  className="h-8 w-28 text-right tabular-nums text-destructive"
                                  disabled={isLocked}
                                  title="BHXH/BHYT/BHTN — sửa tay nếu cần (mặc định 10,5% lương CB)"
                                />
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
                                  onClick={() => openDetail(it)}
                                  title="Chi tiết phiếu lương"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => printPayslipFor(it)}
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

      {/* Detail dialog — full breakdown + linked orders */}
      <Dialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailItem && (() => {
            const it = detailItem
            const u = users.get(it.user_id)
            const bd = (it.computed_breakdown || {}) as Record<string, unknown>
            const num = (v: unknown) => Number(v || 0)
            const allowances = num(it.allowances)
            const gas = num(bd.gas_allowance)
            const phone = num(bd.phone_allowance)
            const revenue = num(bd.revenue)
            const kpiTarget = num(bd.kpi_target_revenue)
            const kpiPct = bd.kpi_pct != null ? Number(bd.kpi_pct) : null
            const kpiModel = String(bd.kpi_model || "")
            const lowPerf = String(bd.low_perf || "normal")
            const tierBreakdown = (bd.kpi_tier_breakdown as Array<{ min_percent: number; bonus: number; label?: string; passed: boolean }>) || []
            const ocCount = num(bd.oc_count)
            const ocMinCount = num(bd.oc_min_count)
            const ocMinValue = num(bd.oc_min_value)
            const ocPerOrder = num(bd.oc_bonus_per_order)
            const overPct = num(bd.over_target_percent)
            const under60Pct = num(bd.under_60_percent)
            const allowanceDropped = Boolean(bd.allowance_dropped)
            const grossBeforeAdj = num(it.prorated_base) + allowances + num(it.kpi_bonus) + num(it.order_count_bonus) + num(it.activity_bonus) + num(it.overtime)
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Phiếu lương — {u?.full_name || "—"}</DialogTitle>
                  <DialogDescription>
                    {u?.role} • Kỳ {activeRun?.month.slice(0, 7)}
                    {bd.period_start ? ` (${formatDate(String(bd.period_start))} – ${formatDate(String(bd.period_end))})` : ""}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                  {/* Thu nhập */}
                  <div className="rounded-lg border">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                      Các khoản thu nhập
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-t">
                          <td className="px-3 py-2">
                            Lương cơ bản{lowPerf === "under_60" ? " (thay bằng % doanh số)" : ""}
                            <span className="text-[11px] text-muted-foreground">
                              {lowPerf === "under_60"
                                ? ` — doanh số ${formatCurrency(revenue)} × ${under60Pct}%`
                                : ` — theo cấu hình ${formatCurrency(num(it.base_salary))}, không trừ theo chấm công`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(num(it.prorated_base))}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-2">
                            Phụ cấp
                            <span className="text-[11px] text-muted-foreground">
                              {allowanceDropped
                                ? " — không có do đạt dưới 60% A (không hưởng lương cứng)"
                                : ` — xăng xe ${formatCurrency(gas)} + điện thoại ${formatCurrency(phone)}`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(allowances)}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-2">Thưởng KPI doanh số</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(num(it.kpi_bonus))}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-2">Thưởng theo số đơn</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(num(it.order_count_bonus))}</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-2">Thưởng hoạt động</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(num(it.activity_bonus))}</td>
                        </tr>
                        {num(it.overtime) > 0 && (
                          <tr className="border-t">
                            <td className="px-3 py-2">Tăng ca / OT</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(num(it.overtime))}</td>
                          </tr>
                        )}
                        <tr className="border-t-2 bg-muted/20 font-semibold">
                          <td className="px-3 py-2">Tổng thu nhập</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(grossBeforeAdj)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Cách tính thưởng KPI */}
                  <div className="rounded-lg border">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                      Cách tính thưởng KPI doanh số
                    </div>
                    <div className="px-3 py-2 space-y-1.5">
                      <p>
                        Doanh số trong kỳ: <strong>{formatCurrency(revenue)}</strong>
                        {kpiTarget > 0 && (
                          <> / mức chung A = {formatCurrency(kpiTarget)} → đạt <strong>{kpiPct != null ? `${kpiPct}%` : "—"}</strong></>
                        )}
                      </p>
                      {kpiModel === "per_user_tier" && (
                        <p className="text-muted-foreground text-xs">Áp dụng bậc KPI riêng của nhân viên này.</p>
                      )}
                      {lowPerf === "under_60" && (
                        <p className="text-error text-xs">
                          Đạt dưới 60% A → không hưởng lương cứng &amp; không có phụ cấp; lương = doanh số × {under60Pct}% = {formatCurrency(num(it.prorated_base))}; không thưởng KPI.
                        </p>
                      )}
                      {lowPerf === "under_70" && (
                        <p className="text-[#b54708] text-xs">
                          Đạt dưới 70% A → chỉ lương CB + phụ cấp, không thưởng KPI.
                        </p>
                      )}
                      {lowPerf === "over_100" && overPct > 0 && (
                        <p className="text-tertiary text-xs">
                          Vượt 100% A → thưởng thêm = (doanh số − A) × {overPct}% = {formatCurrency(Math.round((revenue - kpiTarget) * overPct / 100))}.
                        </p>
                      )}
                      {tierBreakdown.length > 0 && (
                        <table className="w-full text-xs mt-2 border rounded">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="px-2 py-1 text-left">Bậc</th>
                              <th className="px-2 py-1 text-right">Cộng thêm</th>
                              <th className="px-2 py-1 text-center">Đạt?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tierBreakdown.map((t, i) => (
                              <tr key={i} className={`border-t ${t.passed ? "" : "text-muted-foreground"}`}>
                                <td className="px-2 py-1">{t.label || `Đạt ${t.min_percent}%`} {kpiTarget > 0 ? `(≥ ${formatCurrency(Math.round(kpiTarget * t.min_percent / 100))})` : ""}</td>
                                <td className="px-2 py-1 text-right tabular-nums">+{formatCurrency(t.bonus)}</td>
                                <td className="px-2 py-1 text-center">{t.passed ? "✓" : "—"}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 bg-muted/20 font-semibold">
                              <td className="px-2 py-1">Tổng thưởng KPI</td>
                              <td className="px-2 py-1 text-right tabular-nums" colSpan={2}>{formatCurrency(num(it.kpi_bonus))}</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Cách tính thưởng số đơn */}
                  {(ocCount > 0 || ocMinCount > 0) && (
                    <div className="rounded-lg border">
                      <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                        Cách tính thưởng theo số đơn
                      </div>
                      <div className="px-3 py-2 text-xs space-y-1">
                        <p>Đơn đạt ngưỡng ({formatCurrency(ocMinValue)}/đơn): <strong>{ocCount}</strong> đơn (cần tối thiểu {ocMinCount} đơn).</p>
                        <p>
                          {ocCount >= ocMinCount
                            ? <>Thưởng = {ocCount} × {formatCurrency(ocPerOrder)} = <strong>{formatCurrency(num(it.order_count_bonus))}</strong></>
                            : <span className="text-muted-foreground">Chưa đạt số đơn tối thiểu → không thưởng.</span>}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Khấu trừ */}
                  <div className="rounded-lg border">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                      Khấu trừ & điều chỉnh
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-t">
                          <td className="px-3 py-2">
                            BHXH/BHYT/BHTN
                            <span className="text-[11px] text-muted-foreground">
                              {" "}— mặc định 10,5% lương CB, có thể sửa tay ở danh sách
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-error">−{formatCurrency(num(it.social_insurance))}</td>
                        </tr>
                        {num(it.deductions) > 0 && (
                          <tr className="border-t">
                            <td className="px-3 py-2">Khấu trừ khác</td>
                            <td className="px-3 py-2 text-right tabular-nums text-error">−{formatCurrency(num(it.deductions))}</td>
                          </tr>
                        )}
                        <tr className="border-t">
                          <td className="px-3 py-2">Điều chỉnh tay {it.notes ? <span className="text-[11px] text-muted-foreground">— {it.notes}</span> : ""}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${num(it.manual_adjustment) < 0 ? "text-error" : ""}`}>
                            {num(it.manual_adjustment) >= 0 ? "+" : ""}{formatCurrency(num(it.manual_adjustment))}
                          </td>
                        </tr>
                        <tr className="border-t-2 bg-primary-fixed font-black text-base">
                          <td className="px-3 py-2">THỰC LĨNH</td>
                          <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(num(it.net_salary))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Đơn hàng tham chiếu */}
                  <div className="rounded-lg border">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground flex items-center justify-between">
                      <span>Đơn hàng tính lương ({detailOrders.length})</span>
                      {revenue > 0 && <span className="font-normal normal-case">Tổng {formatCurrency(detailOrders.reduce((s, o) => s + Number(o.total || 0), 0))}</span>}
                    </div>
                    {detailLoading ? (
                      <div className="p-3"><Skeleton className="h-20" /></div>
                    ) : detailOrders.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">Không có đơn nào trong kỳ (status delivered / confirmed).</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/20 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left">Mã đơn</th>
                              <th className="px-2 py-1 text-left">Ngày</th>
                              <th className="px-2 py-1 text-left">Trạng thái</th>
                              <th className="px-2 py-1 text-right">Giá trị</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailOrders.map((o) => (
                              <tr key={o.id} className="border-t">
                                <td className="px-2 py-1">
                                  <Link href={`/orders/${o.id}`} className="font-mono text-primary hover:underline">
                                    {o.order_code}
                                  </Link>
                                </td>
                                <td className="px-2 py-1">{formatDate(o.order_date)}</td>
                                <td className="px-2 py-1">{o.status}</td>
                                <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(Number(o.total || 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { if (detailItem) printPayslipFor(detailItem) }}>
                    <Printer className="h-4 w-4 mr-2" /> In phiếu lương
                  </Button>
                  <Button onClick={() => setDetailItem(null)}>Đóng</Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Per-user payslip — toggled by data-print-mode='payslip'. */}
      <div className="print-payslip-only">
        {payslipFor && activeRun && (() => {
          const it = items.find((x) => x.id === payslipFor)
          if (!it) return null
          const u = users.get(it.user_id)
          const bd = (it.computed_breakdown || {}) as Record<string, unknown>
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
              allowances={Number(it.allowances || 0)}
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
              revenue={bd.revenue != null ? Number(bd.revenue) : null}
              kpiPct={bd.kpi_pct != null ? Number(bd.kpi_pct) : null}
              kpiTargetRevenue={bd.kpi_target_revenue != null ? Number(bd.kpi_target_revenue) : null}
              kpiModel={bd.kpi_model != null ? String(bd.kpi_model) : null}
              lowPerf={bd.low_perf != null ? String(bd.low_perf) : null}
              overTargetPercent={bd.over_target_percent != null ? Number(bd.over_target_percent) : null}
              under60Percent={bd.under_60_percent != null ? Number(bd.under_60_percent) : null}
              kpiTierBreakdown={Array.isArray(bd.kpi_tier_breakdown) ? (bd.kpi_tier_breakdown as PayslipKpiTier[]) : []}
              gasAllowance={bd.gas_allowance != null ? Number(bd.gas_allowance) : null}
              phoneAllowance={bd.phone_allowance != null ? Number(bd.phone_allowance) : null}
              allowanceDropped={bd.allowance_dropped === true}
              ocCount={bd.oc_count != null ? Number(bd.oc_count) : null}
              ocMinCount={bd.oc_min_count != null ? Number(bd.oc_min_count) : null}
              ocMinValue={bd.oc_min_value != null ? Number(bd.oc_min_value) : null}
              ocBonusPerOrder={bd.oc_bonus_per_order != null ? Number(bd.oc_bonus_per_order) : null}
              periodStart={bd.period_start != null ? String(bd.period_start) : null}
              periodEnd={bd.period_end != null ? String(bd.period_end) : null}
              orders={payslipOrders}
            />
          )
        })()}
      </div>
    </div>
  )
}
