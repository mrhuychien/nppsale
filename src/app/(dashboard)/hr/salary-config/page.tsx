"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Save, Plus, Trash2, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { HrSalaryConfig } from "@/types"

interface TierRow {
  /** Ngưỡng % của doanh số chung A để được cộng dồn bonus của bậc này. */
  min_percent: number
  /** Số tiền cộng thêm khi đạt bậc này (CỘNG DỒN với các bậc thấp hơn). */
  bonus: number
  label: string
}

export default function SalaryConfigPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const supabase = createClient()
  const isOwner = authUser?.role === "owner"

  const [config, setConfig] = useState<HrSalaryConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState("Cấu hình lương mặc định")
  const [baseSalary, setBaseSalary] = useState(0)
  const [gasAllowance, setGasAllowance] = useState(0)
  const [phoneAllowance, setPhoneAllowance] = useState(0)
  const [workingDays, setWorkingDays] = useState(26)
  const [kpiTargetRevenue, setKpiTargetRevenue] = useState(0)
  const [tiers, setTiers] = useState<TierRow[]>([
    { min_percent: 70, bonus: 1000000, label: "Đạt 70%" },
    { min_percent: 80, bonus: 1000000, label: "Đạt 80%" },
    { min_percent: 90, bonus: 1000000, label: "Đạt 90%" },
    { min_percent: 100, bonus: 1000000, label: "Đạt 100%" },
  ])
  const [overTargetPercent, setOverTargetPercent] = useState(3)
  const [under70Rule, setUnder70Rule] = useState("base_only")
  const [under60Percent, setUnder60Percent] = useState(1)

  useEffect(() => {
    async function fetch() {
      if (!authUser?.org_id) return
      const { data } = await supabase
        .from("hr_salary_config")
        .select("id, name, base_salary, gas_allowance, phone_allowance, working_days_per_month, kpi_target_revenue, target_tiers, over_target_percent, under_70_rule, under_60_percent")
        .eq("org_id", authUser.org_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()
      if (data) {
        const c = data as HrSalaryConfig
        setConfig(c)
        setName(c.name || "Cấu hình lương mặc định")
        setBaseSalary(c.base_salary)
        setGasAllowance(c.gas_allowance)
        setPhoneAllowance(c.phone_allowance)
        setWorkingDays(c.working_days_per_month)
        setKpiTargetRevenue(Number(c.kpi_target_revenue || 0))
        // Bỏ trường min_revenue legacy nếu có — model mới chỉ dùng
        // min_percent + bonus + label.
        setTiers(
          (c.target_tiers || []).map((t) => ({
            min_percent: Number(t.min_percent || 0),
            bonus: Number(t.bonus || 0),
            label: t.label || "",
          }))
        )
        setOverTargetPercent(c.over_target_percent)
        setUnder70Rule(c.under_70_rule || "base_only")
        setUnder60Percent(c.under_60_percent)
      }
      setLoading(false)
    }
    fetch()
  }, [authUser?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!authUser?.org_id || !isOwner) return
    setSaving(true)

    const payload = {
      org_id: authUser.org_id,
      name,
      base_salary: baseSalary,
      gas_allowance: gasAllowance,
      phone_allowance: phoneAllowance,
      working_days_per_month: workingDays,
      kpi_target_revenue: kpiTargetRevenue,
      // Bậc đã sort tăng dần theo min_percent để cộng dồn cho đúng.
      target_tiers: [...tiers].sort((a, b) => a.min_percent - b.min_percent),
      over_target_percent: overTargetPercent,
      under_70_rule: under70Rule,
      under_60_percent: under60Percent,
      is_active: true,
    }

    if (config?.id) {
      const { data } = await supabase
        .from("hr_salary_config")
        .update(payload)
        .eq("id", config.id)
        .select()
        .single()
      if (data) setConfig(data as HrSalaryConfig)
    } else {
      const { data } = await supabase
        .from("hr_salary_config")
        .insert(payload)
        .select()
        .single()
      if (data) setConfig(data as HrSalaryConfig)
    }

    setSaving(false)
  }

  const addTier = () => {
    setTiers([...tiers, { min_percent: 0, bonus: 0, label: "" }])
  }

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx))
  }

  const updateTier = (idx: number, field: keyof TierRow, value: string | number) => {
    const updated = [...tiers]
    updated[idx] = { ...updated[idx], [field]: value }
    setTiers(updated)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cấu hình lương" backHref="/hr" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Chỉ chủ NPP được phép chỉnh sửa cấu hình lương.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Cấu hình lương" description="Thiết lập lương cơ bản, phụ cấp và mức KPI" backHref="/hr">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Lưu cấu hình
        </Button>
      </PageHeader>

      {/* Basic Salary */}
      <Card>
        <CardHeader>
          <CardTitle>Lương cơ bản & Phụ cấp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Tên cấu hình</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Số ngày công / tháng</Label>
              <Input
                type="number"
                value={workingDays}
                onChange={(e) => setWorkingDays(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Lương cơ bản</Label>
              <MoneyInput
                value={baseSalary}
                onChange={(v) => setBaseSalary(v)}
                showSuffix={false}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(baseSalary)}</p>
            </div>
            <div>
              <Label>Phụ cấp xăng xe</Label>
              <MoneyInput
                value={gasAllowance}
                onChange={(v) => setGasAllowance(v)}
                showSuffix={false}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(gasAllowance)}</p>
            </div>
            <div>
              <Label>Phụ cấp điện thoại</Label>
              <MoneyInput
                value={phoneAllowance}
                onChange={(v) => setPhoneAllowance(v)}
                showSuffix={false}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(phoneAllowance)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target Tiers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Mức thưởng KPI</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Một mức doanh số chung A. Mỗi bậc % của A đạt được sẽ
              <strong> cộng dồn </strong> thêm tiền thưởng vào lương cơ bản.
              VD: đạt 70%A → +x1; đạt 80%A → +x1+x2; đạt 90%A → +x1+x2+x3…
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={addTier}>
            <Plus className="h-4 w-4 mr-1" /> Thêm bậc
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mức doanh số chung A */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Mức doanh số chung (A) — VNĐ
            </Label>
            <MoneyInput
              value={kpiTargetRevenue}
              onChange={(v) => setKpiTargetRevenue(v)}
              showSuffix={false}
              className="mt-1 max-w-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {formatCurrency(kpiTargetRevenue)} • Doanh số NV trong kỳ được so
              với A để tính % đạt KPI.
            </p>
          </div>

          <div className="space-y-3">
            {[...tiers]
              .map((t, idx) => ({ t, idx }))
              .sort((a, b) => a.t.min_percent - b.t.min_percent)
              .map(({ t: tier, idx }, displayIdx) => {
                const thresholdRevenue =
                  kpiTargetRevenue > 0
                    ? Math.round((kpiTargetRevenue * (tier.min_percent || 0)) / 100)
                    : 0
                // Tổng cộng dồn từ bậc thấp nhất đến bậc này.
                const sortedTiers = [...tiers].sort(
                  (a, b) => a.min_percent - b.min_percent
                )
                const cumulative = sortedTiers
                  .slice(0, displayIdx + 1)
                  .reduce((s, x) => s + Number(x.bonus || 0), 0)
                return (
                  <div key={idx} className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-2">
                      <Label className="text-xs uppercase text-muted-foreground">% của A</Label>
                      <Input
                        type="number"
                        min={0}
                        value={tier.min_percent}
                        onChange={(e) => updateTier(idx, "min_percent", Number(e.target.value))}
                      />
                      {kpiTargetRevenue > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          ≥ {formatCurrency(thresholdRevenue)}
                        </p>
                      )}
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs uppercase text-muted-foreground">Cộng thêm (VNĐ)</Label>
                      <MoneyInput
                        value={tier.bonus}
                        onChange={(v) => updateTier(idx, "bonus", v)}
                        showSuffix={false}
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        +{formatCurrency(tier.bonus)}
                      </p>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs uppercase text-muted-foreground">Tổng cộng dồn</Label>
                      <div className="h-9 px-3 flex items-center text-sm font-semibold text-tertiary bg-tertiary-fixed/30 rounded-md tabular-data">
                        +{formatCurrency(cumulative)}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Lương = CB + {formatCurrency(cumulative)}
                      </p>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs uppercase text-muted-foreground">Nhãn</Label>
                      <Input
                        value={tier.label}
                        onChange={(e) => updateTier(idx, "label", e.target.value)}
                        placeholder={`Đạt ${tier.min_percent}%`}
                      />
                    </div>
                    <div className="col-span-1 flex items-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => removeTier(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            {tiers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có bậc nào</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Under-performance Rules — đều quy chiếu theo mức doanh số chung A */}
      <Card>
        <CardHeader>
          <CardTitle>Quy tắc theo mức doanh số chung (A)</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Các ngưỡng dưới đây so với cùng <strong>A = {formatCurrency(kpiTargetRevenue)}</strong>{" "}
            đã đặt ở mục Mức thưởng KPI.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>% thưởng vượt A (doanh số &gt; 100% A)</Label>
              <Input
                type="number"
                min={0}
                value={overTargetPercent}
                onChange={(e) => setOverTargetPercent(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Thưởng thêm = (Doanh số − A) × {overTargetPercent}%
                {kpiTargetRevenue > 0 ? ` — A = ${formatCurrency(kpiTargetRevenue)}` : ""}
              </p>
            </div>
            <div>
              <Label>Quy tắc khi đạt dưới 70% A</Label>
              <Input value={under70Rule} onChange={(e) => setUnder70Rule(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                Chỉ nhận lương CB + phụ cấp (không có thưởng KPI)
                {kpiTargetRevenue > 0 ? ` — dưới ${formatCurrency(Math.round(kpiTargetRevenue * 0.7))}` : ""}
              </p>
            </div>
          </div>
          <div>
            <Label>% doanh số khi đạt dưới 60% A</Label>
            <Input
              type="number"
              min={0}
              value={under60Percent}
              onChange={(e) => setUnder60Percent(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Lương = Doanh số × {under60Percent}% (không có lương cơ bản, không thưởng)
              {kpiTargetRevenue > 0 ? ` — dưới ${formatCurrency(Math.round(kpiTargetRevenue * 0.6))}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
