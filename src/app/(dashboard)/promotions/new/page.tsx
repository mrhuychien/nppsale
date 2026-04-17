"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { PROMOTION_TYPES } from "@/lib/constants"
import { formatCurrency } from "@/lib/utils"
import {
  BadgePercent,
  Gift,
  CreditCard,
  TrendingUp,
  Store,
  Calculator,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const TYPE_META: Record<
  string,
  { icon: LucideIcon; description: string; color: string }
> = {
  trade_discount: {
    icon: BadgePercent,
    description: "Giảm % trên giá trị đơn",
    color: "from-blue-500/10 to-blue-500/5 text-blue-700 border-blue-200",
  },
  buy_x_get_y: {
    icon: Gift,
    description: "Mua X sản phẩm tặng Y",
    color: "from-pink-500/10 to-pink-500/5 text-pink-700 border-pink-200",
  },
  payment_discount: {
    icon: CreditCard,
    description: "Chiết khấu khi thanh toán đúng hạn",
    color: "from-emerald-500/10 to-emerald-500/5 text-emerald-700 border-emerald-200",
  },
  cumulative: {
    icon: TrendingUp,
    description: "Thưởng lũy kế theo ngưỡng",
    color: "from-purple-500/10 to-purple-500/5 text-purple-700 border-purple-200",
  },
  display: {
    icon: Store,
    description: "Thưởng trưng bày tại cửa hàng",
    color: "from-orange-500/10 to-orange-500/5 text-orange-700 border-orange-200",
  },
}

export default function NewPromotionPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("promotions")
  const [name, setName] = useState("")
  const [type, setType] = useState("trade_discount")
  const [priority, setPriority] = useState("0")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [discountPercent, setDiscountPercent] = useState("5")
  const [threshold, setThreshold] = useState("")
  const [bonus, setBonus] = useState("")
  const [buyQty, setBuyQty] = useState("10")
  const [getQty, setGetQty] = useState("1")
  const [displayDesc, setDisplayDesc] = useState("")
  const [showRawJson, setShowRawJson] = useState(false)
  const [rulesJson, setRulesJson] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  if (authLoading) return <Skeleton className="h-96" />

  const buildRulesFromType = (): Record<string, unknown> => {
    switch (type) {
      case "trade_discount":
        return { discount_percent: parseFloat(discountPercent) || 0 }
      case "payment_discount":
        return { discount_percent: parseFloat(discountPercent) || 0 }
      case "cumulative":
        return {
          threshold: parseFloat(threshold) || 0,
          bonus: parseFloat(bonus) || 0,
        }
      case "buy_x_get_y":
        return {
          buy_qty: parseInt(buyQty) || 0,
          get_qty: parseInt(getQty) || 0,
        }
      case "display":
        return { description: displayDesc }
      default:
        return { discount_percent: parseFloat(discountPercent) || 0 }
    }
  }

  const renderPreview = () => {
    switch (type) {
      case "trade_discount": {
        const pct = parseFloat(discountPercent) || 0
        const sample = 10_000_000
        const discount = (sample * pct) / 100
        return (
          <>
            <div className="text-xs text-muted-foreground">Đơn hàng mẫu</div>
            <div className="text-sm">
              {formatCurrency(sample)} - {pct}% ={" "}
              <span className="font-bold text-primary">
                {formatCurrency(sample - discount)}
              </span>
            </div>
            <div className="text-xs text-emerald-600">
              Tiết kiệm {formatCurrency(discount)}
            </div>
          </>
        )
      }
      case "payment_discount": {
        const pct = parseFloat(discountPercent) || 0
        return (
          <div className="text-sm">
            Khách thanh toán đúng hạn nhận chiết khấu{" "}
            <span className="font-bold text-primary">{pct}%</span> trên tổng đơn.
          </div>
        )
      }
      case "cumulative": {
        const t = parseFloat(threshold) || 0
        const b = parseFloat(bonus) || 0
        return (
          <div className="text-sm">
            Đạt {formatCurrency(t)} thưởng{" "}
            <span className="font-bold text-primary">{formatCurrency(b)}</span>.
          </div>
        )
      }
      case "buy_x_get_y": {
        const x = parseInt(buyQty) || 0
        const y = parseInt(getQty) || 0
        return (
          <div className="text-sm">
            Mua <span className="font-bold">{x}</span> tặng{" "}
            <span className="font-bold text-primary">{y}</span> sản phẩm cùng loại.
          </div>
        )
      }
      case "display":
        return (
          <div className="text-sm">
            {displayDesc || "Cấu hình mô tả chương trình trưng bày bên dưới."}
          </div>
        )
      default:
        return null
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      let rules: Record<string, unknown> = {}
      if (showRawJson && rulesJson.trim()) {
        try {
          rules = JSON.parse(rulesJson)
        } catch {
          toast({ title: "JSON rules không hợp lệ", variant: "destructive" })
          setLoading(false)
          return
        }
      } else {
        rules = buildRulesFromType()
      }

      const { error } = await supabase.from("promotions").insert({
        name,
        type,
        rules,
        priority: parseInt(priority) || 0,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        is_active: true,
        org_id: user?.org_id,
      })
      if (error) throw error
      toast({ title: "Đã tạo chương trình khuyến mãi" })
      router.push("/promotions")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo chương trình khuyến mãi" />

      <Card className="rounded-2xl shadow-ambient">
        <CardHeader>
          <CardTitle className="text-base">Chọn loại khuyến mãi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PROMOTION_TYPES.map((t) => {
              const meta = TYPE_META[t.value]
              const Icon = meta?.icon || BadgePercent
              const active = type === t.value
              return (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all hover:shadow-ambient ${
                    active
                      ? "border-primary ring-2 ring-primary/30 bg-gradient-to-br " + (meta?.color || "")
                      : "border-border bg-card"
                  }`}
                >
                  <div
                    className={`rounded-xl p-2 ${
                      active ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold">{t.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {meta?.description}
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="rounded-2xl shadow-ambient">
          <CardHeader>
            <CardTitle>Thông tin khuyến mãi</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tên chương trình *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="VD: Chiết khấu mùa tết"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Độ ưu tiên</Label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bắt đầu</Label>
                  <Input
                    type="date"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Kết thúc</Label>
                  <Input
                    type="date"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-semibold">Cấu hình ưu đãi</h3>
                {(type === "trade_discount" || type === "payment_discount") && (
                  <div className="space-y-2">
                    <Label>Mức giảm giá (%) *</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {type === "payment_discount"
                        ? "Chiết khấu áp dụng khi khách thanh toán đúng hạn"
                        : "Chiết khấu thương mại tính trên giá trị đơn hàng"}
                    </p>
                  </div>
                )}
                {type === "cumulative" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Ngưỡng tích lũy</Label>
                      <Input
                        type="number"
                        min="0"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        placeholder="VD: 10000000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Thưởng (VND hoặc %)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={bonus}
                        onChange={(e) => setBonus(e.target.value)}
                        placeholder="VD: 500000"
                      />
                    </div>
                  </div>
                )}
                {type === "buy_x_get_y" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Số lượng mua (X) *</Label>
                      <Input
                        type="number"
                        min="1"
                        value={buyQty}
                        onChange={(e) => setBuyQty(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Số lượng tặng (Y) *</Label>
                      <Input
                        type="number"
                        min="1"
                        value={getQty}
                        onChange={(e) => setGetQty(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {type === "display" && (
                  <div className="space-y-2">
                    <Label>Mô tả chương trình trưng bày</Label>
                    <Textarea
                      value={displayDesc}
                      onChange={(e) => setDisplayDesc(e.target.value)}
                      rows={3}
                      placeholder="VD: Trưng bày 5 mặt hàng ở kệ chính, thưởng 1 triệu/tháng"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowRawJson((v) => !v)}
                    className="text-xs text-muted-foreground underline"
                  >
                    {showRawJson ? "Ẩn JSON nâng cao" : "Chỉnh JSON nâng cao"}
                  </button>
                  {showRawJson && (
                    <Textarea
                      value={rulesJson}
                      onChange={(e) => setRulesJson(e.target.value)}
                      rows={4}
                      className="font-mono text-sm"
                      placeholder='{"discount_percent": 5}'
                    />
                  )}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Hủy
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Đang lưu..." : "Tạo khuyến mãi"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-ambient h-fit bg-gradient-to-br from-primary/5 to-background border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary" />
              Ví dụ áp dụng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-xl bg-background p-3 border space-y-1">
              {renderPreview()}
            </div>
            <p className="text-xs text-muted-foreground">
              Ví dụ minh họa dựa trên cấu hình hiện tại. Giá trị thực tế có thể khác.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
