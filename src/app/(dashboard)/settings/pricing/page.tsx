"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { Save, Info, ArrowDownToLine, ArrowUpFromLine } from "lucide-react"
import {
  DEFAULT_PRICING_RULES,
  loadPricingRules,
  saleFloor,
  returnCeiling,
  type PricingRules,
} from "@/lib/pricing"

const SAMPLE_PRICE = 100_000

export default function PricingSettingsPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [rules, setRules] = useState<PricingRules>(DEFAULT_PRICING_RULES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!authUser?.org_id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const r = await loadPricingRules(supabase, authUser.org_id)
      if (!cancelled) {
        setRules(r)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authUser?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const canEdit = authUser && ["owner", "manager"].includes(authUser.role)
  const update = <K extends keyof PricingRules>(key: K, value: PricingRules[K]) => {
    setRules((prev) => ({ ...prev, [key]: value }))
  }

  const parseNum = (s: string) => {
    const n = parseFloat(s.replace(/[^\d.]/g, ""))
    return isNaN(n) ? 0 : n
  }

  const handleSave = async () => {
    if (!authUser) return
    setSaving(true)
    try {
      const payload = {
        org_id: authUser.org_id,
        allow_sales_override: rules.allow_sales_override,
        sale_min_pct: rules.sale_min_pct,
        sale_min_value: rules.sale_min_value,
        return_max_pct: rules.return_max_pct,
        return_max_value: rules.return_max_value,
        updated_by: authUser.id,
      }
      const { error } = await supabase
        .from("pricing_rules")
        .upsert(payload, { onConflict: "org_id" })
      if (error) throw error
      toast({ title: "Đã lưu cài đặt giá" })
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const sampleSaleFloor = saleFloor(SAMPLE_PRICE, rules)
  const sampleReturnCeiling = returnCeiling(SAMPLE_PRICE, rules)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cài đặt giá"
        description="Cho phép nhân viên sửa giá khi bán/trả + ngưỡng tối đa"
        backHref="/settings"
      />

      <Card>
        <CardHeader>
          <CardTitle>Quy tắc tổng</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label className="text-base font-semibold">
                Cho phép nhân viên sửa giá
              </Label>
              <p className="text-xs text-muted-foreground">
                Khi tắt, NV không sửa được giá ở form đơn hàng / đơn trả. Quản lý vẫn sửa được.
              </p>
            </div>
            <Switch
              checked={rules.allow_sales_override}
              onCheckedChange={(v) => update("allow_sales_override", v)}
              disabled={!canEdit}
            />
          </div>

          {rules.allow_sales_override ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Áp dụng giới hạn nào dễ hơn (% hoặc giá trị tuyệt đối) — bên dưới có ô preview cho giá mẫu {formatCurrency(SAMPLE_PRICE)}.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-muted border p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>Khi tắt master switch, các ngưỡng dưới đây không có hiệu lực.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-emerald-600" />
            Đơn bán: NV được giảm tối đa
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Giá NV nhập KHÔNG được thấp hơn giá mặc định trừ đi ngưỡng này. Đặt 0 = không cho giảm.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Theo % giá mặc định</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  value={rules.sale_min_pct || ""}
                  onChange={(e) => update("sale_min_pct", parseNum(e.target.value))}
                  disabled={!canEdit || !rules.allow_sales_override}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hoặc theo số tiền (đ)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="1000"
                  value={rules.sale_min_value || ""}
                  onChange={(e) => update("sale_min_value", parseNum(e.target.value))}
                  disabled={!canEdit || !rules.allow_sales_override}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">đ</span>
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Ví dụ: giá mặc định {formatCurrency(SAMPLE_PRICE)} → NV được giảm tới
            </p>
            <p className="text-lg font-bold text-emerald-700">
              {formatCurrency(sampleSaleFloor)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpFromLine className="h-5 w-5 text-amber-600" />
            Đơn trả: NV được tăng giá tối đa
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Giá nhận trả KHÔNG được cao hơn giá mặc định cộng ngưỡng này. Đặt 0 = bắt buộc đúng giá mặc định.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Theo % giá mặc định</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.5"
                  value={rules.return_max_pct || ""}
                  onChange={(e) => update("return_max_pct", parseNum(e.target.value))}
                  disabled={!canEdit || !rules.allow_sales_override}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hoặc theo số tiền (đ)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="1000"
                  value={rules.return_max_value || ""}
                  onChange={(e) => update("return_max_value", parseNum(e.target.value))}
                  disabled={!canEdit || !rules.allow_sales_override}
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">đ</span>
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Ví dụ: giá mặc định {formatCurrency(SAMPLE_PRICE)} → NV được nhận trả tối đa
            </p>
            <p className="text-lg font-bold text-amber-700">
              {formatCurrency(sampleReturnCeiling)}
            </p>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="lg">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Đang lưu..." : "Lưu cài đặt"}
          </Button>
        </div>
      )}
    </div>
  )
}
