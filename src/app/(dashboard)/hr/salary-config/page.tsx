"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Save, Plus, Trash2, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import type { HrSalaryConfig } from "@/types"

interface TierRow {
  min_percent: number
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
  const [tiers, setTiers] = useState<TierRow[]>([
    { min_percent: 70, bonus: 1000000, label: "70-79%" },
    { min_percent: 80, bonus: 2000000, label: "80-89%" },
    { min_percent: 90, bonus: 3000000, label: "90-99%" },
    { min_percent: 100, bonus: 5000000, label: "100%+" },
  ])
  const [overTargetPercent, setOverTargetPercent] = useState(3)
  const [under70Rule, setUnder70Rule] = useState("base_only")
  const [under60Percent, setUnder60Percent] = useState(1)

  useEffect(() => {
    async function fetch() {
      if (!authUser?.org_id) return
      const { data } = await supabase
        .from("hr_salary_config")
        .select("*")
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
        setTiers(c.target_tiers || [])
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
      target_tiers: tiers,
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
              <Input
                type="number"
                value={baseSalary}
                onChange={(e) => setBaseSalary(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(baseSalary)}</p>
            </div>
            <div>
              <Label>Phụ cấp xăng xe</Label>
              <Input
                type="number"
                value={gasAllowance}
                onChange={(e) => setGasAllowance(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(gasAllowance)}</p>
            </div>
            <div>
              <Label>Phụ cấp điện thoại</Label>
              <Input
                type="number"
                value={phoneAllowance}
                onChange={(e) => setPhoneAllowance(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(phoneAllowance)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target Tiers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Mức thưởng KPI</CardTitle>
          <Button variant="outline" size="sm" onClick={addTier}>
            <Plus className="h-4 w-4 mr-1" /> Thêm mức
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Từ % KPI</Label>
                  <Input
                    type="number"
                    value={tier.min_percent}
                    onChange={(e) => updateTier(idx, "min_percent", Number(e.target.value))}
                  />
                </div>
                <div className="flex-1">
                  <Label>Thưởng (VNĐ)</Label>
                  <Input
                    type="number"
                    value={tier.bonus}
                    onChange={(e) => updateTier(idx, "bonus", Number(e.target.value))}
                  />
                </div>
                <div className="flex-1">
                  <Label>Nhãn</Label>
                  <Input
                    value={tier.label}
                    onChange={(e) => updateTier(idx, "label", e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive shrink-0"
                  onClick={() => removeTier(idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {tiers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Chưa có mức thưởng nào</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Under-performance Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Quy tắc hiệu suất thấp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>% thưởng vượt chỉ tiêu (trên 100%)</Label>
              <Input
                type="number"
                value={overTargetPercent}
                onChange={(e) => setOverTargetPercent(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                (Doanh số vượt - Chỉ tiêu) x {overTargetPercent}%
              </p>
            </div>
            <div>
              <Label>Quy tắc dưới 70% KPI</Label>
              <Input value={under70Rule} onChange={(e) => setUnder70Rule(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Chỉ nhận lương CB + phụ cấp</p>
            </div>
          </div>
          <div>
            <Label>% doanh số khi dưới 60% KPI</Label>
            <Input
              type="number"
              value={under60Percent}
              onChange={(e) => setUnder60Percent(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Doanh số x {under60Percent}% (không có lương cơ bản)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
