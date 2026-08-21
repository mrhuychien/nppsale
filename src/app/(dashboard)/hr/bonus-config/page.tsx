"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Save, Plus, Trash2, ChevronLeft, ChevronRight, Loader2, Package, ListOrdered, Target } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import type {
  HrMonthlyBonus,
  KpiMetricConfig,
  OrderMilestoneTier,
  PerUnitBonus,
} from "@/types"

interface ProductOption {
  id: string
  sku: string
  name: string
  base_unit: string
}

interface ProductUnitOption {
  product_id: string
  unit_name: string
}

interface BonusTier {
  min_revenue: number
  bonus: number
}

const DEFAULT_KPI_METRICS: KpiMetricConfig[] = [
  {
    key: "new_customers",
    label: "Khách hàng mới",
    higher_is_better: true,
    tiers: [
      { min: 5, bonus: 200_000 },
      { min: 10, bonus: 500_000 },
      { min: 15, bonus: 800_000 },
    ],
  },
  {
    key: "visit_coverage",
    label: "% phủ tuyến (visits/route)",
    higher_is_better: true,
    tiers: [
      { min: 80, bonus: 200_000 },
      { min: 90, bonus: 400_000 },
      { min: 95, bonus: 600_000 },
    ],
  },
  {
    key: "aov",
    label: "AOV — Giá trị đơn TB",
    higher_is_better: true,
    tiers: [
      { min: 800_000, bonus: 200_000 },
      { min: 1_200_000, bonus: 400_000 },
    ],
  },
  {
    key: "return_rate",
    label: "% trả hàng (thấp hơn = tốt)",
    higher_is_better: false,
    tiers: [
      { min: 5, bonus: 100_000, label: "≤ 5%" },
      { min: 3, bonus: 300_000, label: "≤ 3%" },
      { min: 1, bonus: 500_000, label: "≤ 1%" },
    ],
  },
  {
    key: "above_list_pct",
    label: "% đơn vượt giá list",
    higher_is_better: true,
    tiers: [
      { min: 20, bonus: 200_000 },
      { min: 40, bonus: 500_000 },
    ],
  },
]

export default function BonusConfigPage() {
  const { toast } = useToast()
  const { loading: authLoading } = useRoleGuard("settings")
  const { user: authUser } = useAuth()
  const supabase = createClient()
  const isOwner = authUser?.role === "owner"

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [config, setConfig] = useState<HrMonthlyBonus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<HrMonthlyBonus[]>([])

  // Form state
  const [tiers, setTiers] = useState<BonusTier[]>([])
  const [perUnit, setPerUnit] = useState<PerUnitBonus[]>([])
  const [milestoneTiers, setMilestoneTiers] = useState<OrderMilestoneTier[]>([])
  const [kpiMetrics, setKpiMetrics] = useState<KpiMetricConfig[]>([])
  const [notes, setNotes] = useState("")
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productUnits, setProductUnits] = useState<ProductUnitOption[]>([])

  const period = `${year}-${String(month).padStart(2, "0")}`

  const fetchData = useCallback(async () => {
    if (!authUser?.org_id) return
    setLoading(true)

    const [currentRes, historyRes, productsRes, unitsRes] = await Promise.all([
      supabase
        .from("hr_monthly_bonus")
        .select("id, tiers, per_unit_bonuses, order_milestone_tiers, kpi_metrics, notes")
        .eq("org_id", authUser.org_id)
        .eq("period", period)
        .maybeSingle(),
      supabase
        .from("hr_monthly_bonus")
        .select("id, period, tiers, notes, created_at")
        .eq("org_id", authUser.org_id)
        .order("period", { ascending: false })
        .limit(12),
      supabase
        .from("products")
        .select("id, sku, name, base_unit")
        .eq("org_id", authUser.org_id)
        .order("name", { ascending: true }),
      supabase
        .from("product_units")
        .select("product_id, unit_name"),
    ])
    const qErr = ([currentRes, historyRes, productsRes, unitsRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[hr/bonus-config] truy vấn lỗi:", qErr.message)
    setProducts((productsRes.data as ProductOption[]) || [])
    setProductUnits((unitsRes.data as ProductUnitOption[]) || [])

    if (currentRes.data) {
      const c = currentRes.data as HrMonthlyBonus
      setConfig(c)
      setTiers(c.tiers || [])
      setPerUnit(c.per_unit_bonuses || [])
      setMilestoneTiers(c.order_milestone_tiers || [])
      setKpiMetrics(c.kpi_metrics?.length ? c.kpi_metrics : DEFAULT_KPI_METRICS)
      setNotes(c.notes || "")
    } else {
      setConfig(null)
      setTiers([
        { min_revenue: 50000000, bonus: 500000 },
        { min_revenue: 100000000, bonus: 1000000 },
        { min_revenue: 200000000, bonus: 2000000 },
      ])
      setPerUnit([])
      setMilestoneTiers([
        { min_orders: 30, min_order_value: 0, bonus: 10_000, label: "30+ đơn" },
        { min_orders: 50, min_order_value: 0, bonus: 14_000, label: "50+ đơn" },
        { min_orders: 80, min_order_value: 0, bonus: 18_000, label: "80+ đơn" },
      ])
      setKpiMetrics(DEFAULT_KPI_METRICS)
      setNotes("")
    }

    setHistory((historyRes.data as HrMonthlyBonus[]) || [])
    setLoading(false)
  }, [authUser?.org_id, period]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSave = async () => {
    if (!authUser?.org_id || !isOwner) return
    setSaving(true)

    const payload = {
      org_id: authUser.org_id,
      period,
      tiers,
      per_unit_bonuses: perUnit,
      order_milestone_tiers: milestoneTiers,
      kpi_metrics: kpiMetrics,
      notes,
    }

    const { error } = config?.id
      ? await supabase.from("hr_monthly_bonus").update(payload).eq("id", config.id)
      : await supabase.from("hr_monthly_bonus").insert(payload)
    if (error) {
      toast({
        title: "Lưu cấu hình thưởng thất bại",
        description: error.message,
        variant: "destructive",
      })
      setSaving(false)
      return
    }

    await fetchData()
    setSaving(false)
  }

  const addTier = () => {
    setTiers([...tiers, { min_revenue: 0, bonus: 0 }])
  }

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx))
  }

  const updateTier = (idx: number, field: keyof BonusTier, value: number) => {
    const updated = [...tiers]
    updated[idx] = { ...updated[idx], [field]: value }
    setTiers(updated)
  }

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <PageHeader title="Thưởng doanh số" backHref="/hr" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Chỉ chủ NPP được phép chỉnh sửa cấu hình thưởng.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thưởng doanh số"
        description="Cấu hình mức thưởng theo doanh số hàng tháng"
        backHref="/hr"
      >
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Lưu
        </Button>
      </PageHeader>

      {/* Period Selector */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Button variant="outline" size="icon" onClick={() => changeMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-black">Tháng {month}/{year}</h2>
          <Button variant="outline" size="icon" onClick={() => changeMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Tiers Editor */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Mức thưởng doanh số</CardTitle>
          <Button variant="outline" size="sm" onClick={addTier}>
            <Plus className="h-4 w-4 mr-1" /> Thêm mức
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Doanh số tối thiểu (VNĐ)</Label>
                  <MoneyInput
                    value={tier.min_revenue}
                    onChange={(v) => updateTier(idx, "min_revenue", v)}
                    showSuffix={false}
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(tier.min_revenue)}</p>
                </div>
                <div className="flex-1">
                  <Label>Thưởng (VNĐ)</Label>
                  <MoneyInput
                    value={tier.bonus}
                    onChange={(v) => updateTier(idx, "bonus", v)}
                    showSuffix={false}
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(tier.bonus)}</p>
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

      {/* §2.1 Per-unit bonus (đầu thùng) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Thưởng đầu thùng
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Thưởng X đồng / 1 đơn vị (thùng / lốc / chai…) SP bán ra trong kỳ.
              Để trống mã SP = áp dụng cho mọi sản phẩm.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPerUnit([...perUnit, { product_id: null, unit_name: "thùng", bonus: 0 }])
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Thêm
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {perUnit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Chưa có thưởng đầu thùng nào
            </p>
          ) : (
            perUnit.map((p, idx) => {
              const product = products.find((pp) => pp.id === p.product_id) || null
              const unitOptions: string[] = product
                ? Array.from(
                    new Set([
                      product.base_unit,
                      ...productUnits
                        .filter((u) => u.product_id === product.id)
                        .map((u) => u.unit_name),
                    ])
                  ).filter(Boolean)
                : []
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs uppercase text-muted-foreground">
                      Sản phẩm
                    </Label>
                    <Select
                      value={p.product_id || "_all"}
                      onValueChange={(v) => {
                        const next = [...perUnit]
                        const newProductId = v === "_all" ? null : v
                        // Khi đổi SP → reset unit_name về base_unit của SP mới
                        // (tránh giữ ĐVT không thuộc SP đó). null → giữ
                        // unit_name cũ vì đã là "mọi SP".
                        let newUnit = p.unit_name
                        if (newProductId) {
                          const newProd = products.find((pp) => pp.id === newProductId)
                          if (newProd) newUnit = newProd.base_unit
                        }
                        next[idx] = { ...p, product_id: newProductId, unit_name: newUnit }
                        setPerUnit(next)
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Chọn SP" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_all">— Mọi sản phẩm —</SelectItem>
                        {products.map((pp) => (
                          <SelectItem key={pp.id} value={pp.id}>
                            {pp.sku} — {pp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs uppercase text-muted-foreground">ĐVT</Label>
                    {unitOptions.length > 0 ? (
                      <Select
                        value={p.unit_name || ""}
                        onValueChange={(v) => {
                          const next = [...perUnit]
                          next[idx] = { ...p, unit_name: v }
                          setPerUnit(next)
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Chọn ĐVT" />
                        </SelectTrigger>
                        <SelectContent>
                          {unitOptions.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={p.unit_name}
                        onChange={(e) => {
                          const next = [...perUnit]
                          next[idx] = { ...p, unit_name: e.target.value }
                          setPerUnit(next)
                        }}
                        placeholder="thùng / lốc / hộp"
                      />
                    )}
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs uppercase text-muted-foreground">Thưởng / 1 ĐVT</Label>
                    <MoneyInput
                      value={p.bonus}
                      onChange={(v) => {
                        const next = [...perUnit]
                        next[idx] = { ...p, bonus: v }
                        setPerUnit(next)
                      }}
                      showSuffix={false}
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatCurrency(p.bonus)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs uppercase text-muted-foreground">Nhãn</Label>
                    <Input
                      value={p.label || ""}
                      onChange={(e) => {
                        const next = [...perUnit]
                        next[idx] = { ...p, label: e.target.value }
                        setPerUnit(next)
                      }}
                      placeholder="VD: Thưởng thùng"
                    />
                  </div>
                  <div className="col-span-1 flex items-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setPerUnit(perUnit.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* §2.2 Order-milestone bonus */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" />
              Thưởng đơn hàng (số đơn)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Bậc thang theo số đơn DELIVERED trong kỳ. Áp dụng bậc cao nhất
              mà NV đạt được.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setMilestoneTiers([
                ...milestoneTiers,
                { min_orders: 0, min_order_value: 0, bonus: 0 },
              ])
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Thêm bậc
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Mỗi đơn pass cả 2 ngưỡng (số đơn tối thiểu + giá trị tối thiểu mỗi
            đơn) sẽ được tính. Tổng thưởng = số đơn pass × giá trị thưởng mỗi đơn.
          </p>
          {milestoneTiers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Chưa có bậc thưởng
            </p>
          ) : (
            milestoneTiers.map((t, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-2">
                  <Label className="text-xs uppercase text-muted-foreground">
                    Số đơn tối thiểu
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={t.min_orders}
                    onChange={(e) => {
                      const next = [...milestoneTiers]
                      next[idx] = { ...t, min_orders: Number(e.target.value) || 0 }
                      setMilestoneTiers(next)
                    }}
                  />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs uppercase text-muted-foreground">
                    Giá trị tối thiểu mỗi đơn
                  </Label>
                  <MoneyInput
                    value={t.min_order_value ?? 0}
                    onChange={(v) => {
                      const next = [...milestoneTiers]
                      next[idx] = { ...t, min_order_value: v }
                      setMilestoneTiers(next)
                    }}
                    showSuffix={false}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatCurrency(Number(t.min_order_value || 0))}
                  </p>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs uppercase text-muted-foreground">
                    Giá trị thưởng mỗi đơn
                  </Label>
                  <MoneyInput
                    value={t.bonus}
                    onChange={(v) => {
                      const next = [...milestoneTiers]
                      next[idx] = { ...t, bonus: v }
                      setMilestoneTiers(next)
                    }}
                    showSuffix={false}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatCurrency(t.bonus)}
                  </p>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs uppercase text-muted-foreground">Nhãn (tuỳ chọn)</Label>
                  <Input
                    value={t.label || ""}
                    onChange={(e) => {
                      const next = [...milestoneTiers]
                      next[idx] = { ...t, label: e.target.value }
                      setMilestoneTiers(next)
                    }}
                    placeholder={`Đạt ${t.min_orders} đơn`}
                  />
                </div>
                <div className="col-span-1 flex items-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() =>
                      setMilestoneTiers(milestoneTiers.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* §2.3 KPI metrics */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Thưởng KPI tháng
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              5 chỉ số KPI, mỗi chỉ số có bậc thang riêng. Tổng thưởng = cộng
              dồn các bậc đạt được.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setKpiMetrics(DEFAULT_KPI_METRICS)}
          >
            Khôi phục mặc định
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {kpiMetrics.map((m, mi) => (
            <div key={m.key} className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Mã: <code className="font-mono">{m.key}</code> •{" "}
                    {m.higher_is_better ? "Cao hơn = tốt hơn" : "Thấp hơn = tốt hơn"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = [...kpiMetrics]
                    next[mi] = {
                      ...m,
                      tiers: [...m.tiers, { min: 0, bonus: 0 }],
                    }
                    setKpiMetrics(next)
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Thêm bậc
                </Button>
              </div>
              <div className="space-y-1.5">
                {m.tiers.map((t, ti) => (
                  <div key={ti} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Label className="text-[10px]">
                        {m.higher_is_better ? "≥" : "≤"} ngưỡng
                      </Label>
                      <Input
                        type="number"
                        value={t.min}
                        onChange={(e) => {
                          const next = [...kpiMetrics]
                          const tiers = [...m.tiers]
                          tiers[ti] = { ...t, min: Number(e.target.value) || 0 }
                          next[mi] = { ...m, tiers }
                          setKpiMetrics(next)
                        }}
                      />
                    </div>
                    <div className="col-span-5">
                      <Label className="text-[10px]">Thưởng</Label>
                      <MoneyInput
                        value={t.bonus}
                        onChange={(v) => {
                          const next = [...kpiMetrics]
                          const tiers = [...m.tiers]
                          tiers[ti] = { ...t, bonus: v }
                          next[mi] = { ...m, tiers }
                          setKpiMetrics(next)
                        }}
                        showSuffix={false}
                      />
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-muted-foreground">
                        {formatCurrency(t.bonus)}
                      </p>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => {
                          const next = [...kpiMetrics]
                          next[mi] = {
                            ...m,
                            tiers: m.tiers.filter((_, i) => i !== ti),
                          }
                          setKpiMetrics(next)
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Ghi chú</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Ghi chú về cấu hình thưởng tháng này..."
          />
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lịch sử cấu hình</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kỳ</TableHead>
                  <TableHead className="text-right">Số mức</TableHead>
                  <TableHead>Ghi chú</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow
                    key={h.id}
                    className={h.period === period ? "bg-primary-fixed" : "cursor-pointer"}
                    onClick={() => {
                      const [y, m] = h.period.split("-").map(Number)
                      setYear(y)
                      setMonth(m)
                    }}
                  >
                    <TableCell className="font-semibold">{h.period}</TableCell>
                    <TableCell className="text-right">{h.tiers?.length || 0}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">
                      {h.notes || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(h.created_at).toLocaleDateString("vi-VN")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
