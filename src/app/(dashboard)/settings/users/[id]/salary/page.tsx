"use client"

/**
 * T-15: per-user salary configuration page.
 *
 * /settings/users/[id]/salary
 *
 * Three CRUD sections:
 *   1. salary_kpi_tiers — bậc thang doanh số per month.
 *   2. salary_order_count_bonus_configs — thưởng theo số đơn,
 *      pass cả min_count + min_value mới được tính.
 *   3. monthly_activity_bonuses — số tiền hoạt động kế toán nhập tay
 *      theo tháng (D11).
 *
 * The compute_payroll_run RPC (T-16) reads these directly.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ROLE_LABELS } from "@/lib/permissions"

interface UserRow {
  id: string
  org_id: string
  full_name: string | null
  email: string
  role: string
}

interface KpiTier {
  id: string
  user_id: string | null
  month: string
  min_revenue: number
  bonus_type: "percent" | "fixed"
  bonus_value: number
  order_index: number
}

interface OcConfig {
  id: string
  user_id: string | null
  period: "week" | "month"
  min_order_count: number
  min_order_value: number
  bonus_per_order: number
  effective_from: string
  effective_to: string | null
}

interface ActivityBonus {
  id: string
  user_id: string
  month: string
  amount: number
  note: string | null
  created_at: string
}

function firstOfThisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

export default function UserSalaryPage() {
  const { id } = useParams<{ id: string }>()
  const { user: me } = useAuth()
  const { loading: authLoading } = useRoleGuard("settings")
  const supabase = createClient()
  const { toast } = useToast()

  const [user, setUser] = useState<UserRow | null>(null)
  const [tiers, setTiers] = useState<KpiTier[]>([])
  const [ocs, setOcs] = useState<OcConfig[]>([])
  const [activities, setActivities] = useState<ActivityBonus[]>([])
  const [tierMonth, setTierMonth] = useState<string>(firstOfThisMonth())
  const [activityMonth, setActivityMonth] = useState<string>(firstOfThisMonth())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Drafts for new rows
  const [newTier, setNewTier] = useState<{
    min_revenue: string
    bonus_type: "percent" | "fixed"
    bonus_value: string
  }>({ min_revenue: "0", bonus_type: "fixed", bonus_value: "0" })
  const [newOc, setNewOc] = useState<{
    period: "week" | "month"
    min_order_count: string
    min_order_value: string
    bonus_per_order: string
    effective_from: string
    effective_to: string
  }>({
    period: "month",
    min_order_count: "0",
    min_order_value: "0",
    bonus_per_order: "0",
    effective_from: firstOfThisMonth(),
    effective_to: "",
  })
  const [newActivity, setNewActivity] = useState<{ amount: string; note: string }>({
    amount: "0",
    note: "",
  })

  const fetchData = useCallback(async () => {
    if (!id || !me?.org_id) return
    setLoading(true)
    const [uRes, tRes, oRes, aRes] = await Promise.all([
      supabase
        .from("users")
        .select("id, org_id, full_name, email, role")
        .eq("id", id)
        .single(),
      supabase
        .from("salary_kpi_tiers")
        .select("id, user_id, month, min_revenue, bonus_type, bonus_value, order_index")
        .eq("user_id", id)
        .order("month", { ascending: false })
        .order("min_revenue", { ascending: false }),
      supabase
        .from("salary_order_count_bonus_configs")
        .select(
          "id, user_id, period, min_order_count, min_order_value, bonus_per_order, effective_from, effective_to"
        )
        .eq("user_id", id)
        .order("effective_from", { ascending: false }),
      supabase
        .from("monthly_activity_bonuses")
        .select("id, user_id, month, amount, note, created_at")
        .eq("user_id", id)
        .order("month", { ascending: false }),
    ])
    const qErr = ([uRes, tRes, oRes, aRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[id/salary] truy vấn lỗi:", qErr.message)
    setUser(((uRes.data as UserRow) || null))
    setTiers(((tRes.data as KpiTier[]) || []))
    setOcs(((oRes.data as OcConfig[]) || []))
    setActivities(((aRes.data as ActivityBonus[]) || []))
    setLoading(false)
  }, [id, me?.org_id, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const tiersForMonth = useMemo(
    () => tiers.filter((t) => t.month.startsWith(tierMonth.slice(0, 7))),
    [tiers, tierMonth]
  )

  const addTier = async () => {
    if (!user || !me?.org_id) return
    setBusy(true)
    try {
      const { error } = await supabase.from("salary_kpi_tiers").insert({
        org_id: user.org_id,
        user_id: user.id,
        month: tierMonth,
        min_revenue: Number(newTier.min_revenue) || 0,
        bonus_type: newTier.bonus_type,
        bonus_value: Number(newTier.bonus_value) || 0,
        order_index: tiersForMonth.length,
      })
      if (error) throw error
      setNewTier({ min_revenue: "0", bonus_type: "fixed", bonus_value: "0" })
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const deleteTier = async (rowId: string) => {
    setBusy(true)
    try {
      await supabase.from("salary_kpi_tiers").delete().eq("id", rowId).throwOnError()
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  const addOc = async () => {
    if (!user || !me?.org_id) return
    setBusy(true)
    try {
      const { error } = await supabase.from("salary_order_count_bonus_configs").insert({
        org_id: user.org_id,
        user_id: user.id,
        period: newOc.period,
        min_order_count: Number(newOc.min_order_count) || 0,
        min_order_value: Number(newOc.min_order_value) || 0,
        bonus_per_order: Number(newOc.bonus_per_order) || 0,
        effective_from: newOc.effective_from,
        effective_to: newOc.effective_to || null,
      })
      if (error) throw error
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const deleteOc = async (rowId: string) => {
    setBusy(true)
    try {
      await supabase.from("salary_order_count_bonus_configs").delete().eq("id", rowId).throwOnError()
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  const upsertActivity = async () => {
    if (!user || !me?.org_id || !me.id) return
    setBusy(true)
    try {
      const amt = Number(newActivity.amount) || 0
      const { error } = await supabase
        .from("monthly_activity_bonuses")
        .upsert(
          {
            org_id: user.org_id,
            user_id: user.id,
            month: activityMonth,
            amount: amt,
            note: newActivity.note || null,
            created_by: me.id,
          },
          { onConflict: "user_id,month" }
        )
      if (error) throw error
      setNewActivity({ amount: "0", note: "" })
      await fetchData()
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const deleteActivity = async (rowId: string) => {
    setBusy(true)
    try {
      await supabase.from("monthly_activity_bonuses").delete().eq("id", rowId).throwOnError()
      await fetchData()
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!user) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy user" backHref="/settings/users" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Lương: ${user.full_name || user.email}`}
        description={`Vai trò ${ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] || user.role}`}
        backHref={`/settings/users/${user.id}`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/settings/users/${user.id}`}>
            <ChevronLeft className="h-4 w-4 mr-1.5" /> Quay lại user
          </Link>
        </Button>
      </PageHeader>

      {/* 1. KPI tiers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>1. Bậc thang KPI doanh số</CardTitle>
            <p className="text-xs text-muted-foreground">
              Tier cao nhất pass min_revenue sẽ được áp dụng. Có thể nhập theo tháng.
            </p>
          </div>
          <Input
            type="month"
            value={tierMonth.slice(0, 7)}
            onChange={(e) => setTierMonth(`${e.target.value}-01`)}
            className="h-9 w-40"
          />
        </CardHeader>
        <CardContent>
          {tiersForMonth.length === 0 ? (
            <p className="text-sm text-muted-foreground mb-3">Chưa có bậc nào cho tháng này.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border mb-3">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-right">Tối thiểu doanh số</th>
                    <th className="px-3 py-2 text-left">Kiểu thưởng</th>
                    <th className="px-3 py-2 text-right">Giá trị</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {tiersForMonth.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(t.min_revenue)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={t.bonus_type === "percent" ? "default" : "secondary"}>
                          {t.bonus_type === "percent" ? "Phần trăm" : "Cố định"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.bonus_type === "percent"
                          ? `${t.bonus_value}%`
                          : formatCurrency(t.bonus_value)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteTier(t.id)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-4 items-end">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Doanh số tối thiểu
              </Label>
              <MoneyInput
                value={newTier.min_revenue}
                onChange={(v) => setNewTier({ ...newTier, min_revenue: String(v) })}
                showSuffix={false}
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Kiểu</Label>
              <Select
                value={newTier.bonus_type}
                onValueChange={(v) => setNewTier({ ...newTier, bonus_type: v as "percent" | "fixed" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Cố định (VND)</SelectItem>
                  <SelectItem value="percent">Phần trăm (% revenue)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Giá trị</Label>
              <MoneyInput
                value={newTier.bonus_value}
                onChange={(v) => setNewTier({ ...newTier, bonus_value: String(v) })}
                showSuffix={false}
              />
            </div>
            <Button onClick={addTier} disabled={busy}>
              <Plus className="h-4 w-4 mr-1.5" /> Thêm bậc
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. Order-count bonus */}
      <Card>
        <CardHeader>
          <CardTitle>2. Thưởng theo số đơn</CardTitle>
          <p className="text-xs text-muted-foreground">
            D9: đơn pass cả ngưỡng số lượng + giá trị mới được tính. Bonus = đếm × bonus_per_order.
          </p>
        </CardHeader>
        <CardContent>
          {ocs.length === 0 ? (
            <p className="text-sm text-muted-foreground mb-3">Chưa có cấu hình nào.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border mb-3">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Period</th>
                    <th className="px-3 py-2 text-right">Min count</th>
                    <th className="px-3 py-2 text-right">Min value/đơn</th>
                    <th className="px-3 py-2 text-right">Bonus/đơn</th>
                    <th className="px-3 py-2 text-left">Hiệu lực</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ocs.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Badge variant="default">{o.period}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {o.min_order_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(o.min_order_value)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(o.bonus_per_order)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {o.effective_from} → {o.effective_to || "∞"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteOc(o.id)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-7 items-end">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Period</Label>
              <Select
                value={newOc.period}
                onValueChange={(v) =>
                  setNewOc({ ...newOc, period: v as "week" | "month" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Tuần</SelectItem>
                  <SelectItem value="month">Tháng</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Min count</Label>
              <Input
                type="number"
                min={0}
                value={newOc.min_order_count}
                onChange={(e) =>
                  setNewOc({ ...newOc, min_order_count: e.target.value })
                }
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Min giá trị / đơn
              </Label>
              <MoneyInput
                value={newOc.min_order_value}
                onChange={(v) =>
                  setNewOc({ ...newOc, min_order_value: String(v) })
                }
                showSuffix={false}
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Bonus / đơn</Label>
              <MoneyInput
                value={newOc.bonus_per_order}
                onChange={(v) =>
                  setNewOc({ ...newOc, bonus_per_order: String(v) })
                }
                showSuffix={false}
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Từ ngày</Label>
              <Input
                type="date"
                value={newOc.effective_from}
                onChange={(e) =>
                  setNewOc({ ...newOc, effective_from: e.target.value })
                }
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Đến (rỗng=∞)</Label>
              <Input
                type="date"
                value={newOc.effective_to}
                onChange={(e) => setNewOc({ ...newOc, effective_to: e.target.value })}
              />
            </div>
            <Button onClick={addOc} disabled={busy}>
              <Plus className="h-4 w-4 mr-1.5" /> Thêm
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 3. Activity bonus */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>3. Thưởng hoạt động theo tháng</CardTitle>
            <p className="text-xs text-muted-foreground">
              Kế toán nhập tay, không rule-based (D11). Một dòng / user / tháng.
            </p>
          </div>
          <Input
            type="month"
            value={activityMonth.slice(0, 7)}
            onChange={(e) => setActivityMonth(`${e.target.value}-01`)}
            className="h-9 w-40"
          />
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground mb-3">Chưa có thưởng nào.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border mb-3">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Tháng</th>
                    <th className="px-3 py-2 text-right">Số tiền</th>
                    <th className="px-3 py-2 text-left">Ghi chú</th>
                    <th className="px-3 py-2 text-left">Tạo lúc</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono">{a.month.slice(0, 7)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(a.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs">{a.note || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatDate(a.created_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteActivity(a.id)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3 items-end">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                Số tiền (tháng {activityMonth.slice(0, 7)})
              </Label>
              <MoneyInput
                value={newActivity.amount}
                onChange={(v) => setNewActivity({ ...newActivity, amount: String(v) })}
                showSuffix={false}
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Ghi chú</Label>
              <Input
                value={newActivity.note}
                onChange={(e) => setNewActivity({ ...newActivity, note: e.target.value })}
                placeholder="VD: Hỗ trợ vận động đại lý mở SKU mới"
              />
            </div>
            <Button onClick={upsertActivity} disabled={busy}>
              <Plus className="h-4 w-4 mr-1.5" /> Lưu (upsert)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
