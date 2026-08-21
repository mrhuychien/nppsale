"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency } from "@/lib/utils"
import { ROLE_LABELS } from "@/lib/constants"
import { CheckCircle2, Printer, Trash2, Loader2, Banknote } from "lucide-react"
import type { HrPayroll } from "@/types"
import { useToast } from "@/hooks/use-toast"

const STATUS_MAP: Record<string, { label: string; variant: "secondary" | "default" | "success" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  confirmed: { label: "Đã duyệt", variant: "default" },
  paid: { label: "Đã trả", variant: "success" },
}

export default function PayrollDetailPage() {
  const { toast } = useToast()
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const id = params.id as string

  const [payroll, setPayroll] = useState<HrPayroll | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deductions, setDeductions] = useState(0)
  const [notes, setNotes] = useState("")

  const isOwner = authUser?.role === "owner"

  useEffect(() => {
    async function fetch() {
      const { data, error: dataErr } = await supabase
        .from("hr_payroll")
        .select("id, org_id, user_id, period, working_days, absent_days, total_revenue, target_amount, target_percent, base_salary, gas_allowance, phone_allowance, target_bonus, over_target_bonus, monthly_revenue_bonus, deductions, total_salary, breakdown, status, confirmed_by, confirmed_at, paid_at, notes, created_at, user:users(*)")
        .eq("id", id)
        .single()
      if (dataErr) console.error("[payroll/id] truy vấn lỗi:", dataErr.message)
      if (data) {
        const p = data as unknown as HrPayroll
        setPayroll(p)
        setDeductions(p.deductions || 0)
        setNotes(p.notes || "")
      }
      setLoading(false)
    }
    fetch()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const updatePayroll = async (updates: Record<string, unknown>) => {
    setSaving(true)
    const { data, error } = await supabase
      .from("hr_payroll")
      .update(updates)
      .eq("id", id)
      .select("id, org_id, user_id, period, working_days, absent_days, total_revenue, target_amount, target_percent, base_salary, gas_allowance, phone_allowance, target_bonus, over_target_bonus, monthly_revenue_bonus, deductions, total_salary, breakdown, status, confirmed_by, confirmed_at, paid_at, notes, created_at, user:users(*)")
      .single()
    if (error) {
      toast({ title: "Lưu bảng lương thất bại", description: error.message, variant: "destructive" })
      setSaving(false)
      return
    }
    if (data) {
      const p = data as unknown as HrPayroll
      setPayroll(p)
      setDeductions(p.deductions || 0)
      setNotes(p.notes || "")
    }
    setSaving(false)
  }

  const handleSaveDeductions = () => {
    const newTotal = (payroll?.total_salary || 0) + (payroll?.deductions || 0) - deductions
    updatePayroll({ deductions, notes, total_salary: Math.max(0, newTotal) })
  }

  const handleConfirm = () => {
    updatePayroll({
      status: "confirmed",
      confirmed_by: authUser?.id,
      confirmed_at: new Date().toISOString(),
    })
  }

  const handlePaid = () => {
    updatePayroll({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
  }

  const handleDelete = async () => {
    if (!confirm("Xóa bảng lương này?")) return
    const { error } = await supabase.from("hr_payroll").delete().eq("id", id)
    if (error) {
      toast({ title: "Xóa bảng lương thất bại", description: error.message, variant: "destructive" })
      return
    }
    router.push("/hr/payroll")
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!payroll) return <div className="p-8 text-center text-muted-foreground">Không tìm thấy bảng lương</div>

  const status = STATUS_MAP[payroll.status] || STATUS_MAP.draft
  const breakdown = (payroll.breakdown || {}) as Record<string, unknown>

  return (
    <div className="space-y-6 print:space-y-4">
      <PageHeader
        title={`Lương: ${payroll.user?.full_name || "NV"}`}
        description={`Kỳ ${payroll.period}`}
        backHref="/hr/payroll"
      >
        <div className="flex items-center gap-2 print:hidden">
          <Badge variant={status.variant}>{status.label}</Badge>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" /> In
          </Button>
        </div>
      </PageHeader>

      {/* Employee Info */}
      <Card>
        <CardHeader>
          <CardTitle>Thông tin nhân viên</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Họ tên</p>
              <p className="text-lg font-black">{payroll.user?.full_name}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Vai trò</p>
              <p className="font-semibold">{payroll.user?.role ? ROLE_LABELS[payroll.user.role] : "-"}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Kỳ lương</p>
              <p className="font-semibold">{payroll.period}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Salary Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Chi tiết lương</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Row label="Ngày công" value={`${payroll.working_days} ngày`} />
            <Row label="Ngày vắng" value={`${payroll.absent_days} ngày`} />
            {breakdown.attendance_ratio !== undefined && (
              <Row label="Hệ số chuyên cần" value={`${Math.round(Number(breakdown.attendance_ratio) * 100)}%`} />
            )}
            <hr className="border-border/50" />
            <Row label="Doanh số" value={formatCurrency(payroll.total_revenue)} />
            {payroll.target_percent > 0 && (
              <>
                <Row label="Chỉ tiêu" value={formatCurrency(payroll.target_amount)} />
                <Row label="% KPI đạt được" value={`${payroll.target_percent}%`} highlight />
              </>
            )}
            <hr className="border-border/50" />
            <Row label="Lương cơ bản" value={formatCurrency(payroll.base_salary)} />
            <Row label="Phụ cấp xăng" value={formatCurrency(payroll.gas_allowance)} />
            <Row label="Phụ cấp điện thoại" value={formatCurrency(payroll.phone_allowance)} />
            <Row label="Thưởng KPI" value={formatCurrency(payroll.target_bonus)} />
            <Row label="Thưởng vượt chỉ tiêu" value={formatCurrency(payroll.over_target_bonus)} />
            <Row label="Thưởng doanh số tháng" value={formatCurrency(payroll.monthly_revenue_bonus)} />
            <Row label="Khấu trừ" value={`-${formatCurrency(payroll.deductions)}`} negative />
            <hr className="border-border/50" />
            <div className="flex items-center justify-between pt-2">
              <span className="text-base font-black">TỔNG LƯƠNG</span>
              <span className="text-2xl font-black text-primary">{formatCurrency(payroll.total_salary)}</span>
            </div>
            {breakdown.rule ? (
              <p className="text-xs text-[#b54708] font-semibold mt-1">
                * Áp dụng quy tắc: {String(breakdown.rule) === "under_60" ? "Dưới 60% KPI" : "Dưới 70% KPI"}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Edit Deductions (draft only) */}
      {payroll.status === "draft" && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Điều chỉnh</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Khấu trừ</Label>
              <Input
                type="number"
                value={deductions}
                onChange={(e) => setDeductions(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Ghi chú</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            <Button onClick={handleSaveDeductions} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Lưu điều chỉnh
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 print:hidden">
        {payroll.status === "draft" && isOwner && (
          <Button onClick={handleConfirm} disabled={saving}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Duyệt lương
          </Button>
        )}
        {payroll.status === "confirmed" && isOwner && (
          <Button onClick={handlePaid} disabled={saving}>
            <Banknote className="h-4 w-4 mr-2" /> Đánh dấu đã trả
          </Button>
        )}
        {payroll.status === "draft" && isOwner && (
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" /> Xóa
          </Button>
        )}
      </div>

      {/* Confirmed/Paid info */}
      {payroll.confirmed_at && (
        <p className="text-xs text-muted-foreground">
          Duyệt lúc: {new Date(payroll.confirmed_at).toLocaleString("vi-VN")}
        </p>
      )}
      {payroll.paid_at && (
        <p className="text-xs text-muted-foreground">
          Trả lương lúc: {new Date(payroll.paid_at).toLocaleString("vi-VN")}
        </p>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  highlight,
  negative,
}: {
  label: string
  value: string
  highlight?: boolean
  negative?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold ${
          highlight ? "text-primary" : negative ? "text-destructive" : ""
        }`}
      >
        {value}
      </span>
    </div>
  )
}
