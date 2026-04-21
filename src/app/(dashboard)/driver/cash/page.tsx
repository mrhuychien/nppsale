"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import {
  Wallet,
  Send,
  CheckCircle2,
  Banknote,
} from "lucide-react"

interface CodDelivery {
  id: string
  order_id: string
  amount_collected: number
  delivered_at: string | null
  order?: {
    order_code: string
    customer?: { store_name: string }
  }
}

export default function DriverCashPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [codLines, setCodLines] = useState<CodDelivery[]>([])
  const [amountSubmitted, setAmountSubmitted] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const fetchCodLines = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const todayStr = new Date().toISOString().slice(0, 10)

    await supabase
      .from("delivery_lines")
      .select(`
        id, order_id, amount_collected, delivered_at,
        order:sales_orders(order_code, customer:customers(store_name))
      `)
      .eq("payment_method", "cod_cash")
      .eq("status", "delivered")
      .gte("delivered_at", todayStr + "T00:00:00")
      .lte("delivered_at", todayStr + "T23:59:59")

    // Filter by driver: join through delivery
    // Alternative approach: fetch deliveries for this driver first
    const { data: myDeliveries } = await supabase
      .from("deliveries")
      .select("id")
      .eq("driver_id", user.id)

    const myDeliveryIds = new Set((myDeliveries || []).map((d) => d.id))

    // Fetch lines for my deliveries
    const { data: lines } = await supabase
      .from("delivery_lines")
      .select(`
        id, order_id, amount_collected, delivered_at, delivery_id,
        order:sales_orders(order_code, customer:customers(store_name))
      `)
      .eq("payment_method", "cod_cash")
      .eq("status", "delivered")
      .gte("delivered_at", todayStr + "T00:00:00")
      .lte("delivered_at", todayStr + "T23:59:59")

    const filtered = (lines || []).filter((l: Record<string, unknown>) => myDeliveryIds.has(l.delivery_id as string))
    setCodLines(filtered as unknown as CodDelivery[])

    // Check if already submitted today
    const { data: existing } = await supabase
      .from("cash_collections")
      .select("id")
      .eq("driver_id", user.id)
      .eq("work_date", todayStr)
      .limit(1)
    if (existing && existing.length > 0) setSubmitted(true)

    setLoading(false)
  }, [user, supabase])

  useEffect(() => {
    fetchCodLines()
  }, [fetchCodLines])

  const totalCollected = codLines.reduce((sum, l) => sum + (l.amount_collected || 0), 0)

  const handleSubmit = async () => {
    if (!user || !amountSubmitted) return
    setSubmitting(true)
    const todayStr = new Date().toISOString().slice(0, 10)

    await supabase.from("cash_collections").insert({
      driver_id: user.id,
      work_date: todayStr,
      total_collected: totalCollected,
      total_submitted: parseFloat(amountSubmitted),
      status: "submitted",
    })

    setSubmitted(true)
    setSubmitting(false)
  }

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        title="Nộp tiền COD"
        description="Tổng hợp tiền thu COD trong ngày"
      />

      {/* Total card */}
      <Card className="border-l-4 border-primary">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Tổng COD thu hôm nay
              </p>
              <p className="text-2xl font-black text-foreground">{formatCurrency(totalCollected)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* COD lines */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : codLines.length === 0 ? (
        <EmptyState
          icon={<Banknote className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có đơn COD"
          description="Chưa có đơn giao COD tiền mặt nào hôm nay"
        />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chi tiết đơn COD ({codLines.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {codLines.map((line) => (
                <div key={line.id} className="flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {(line.order as unknown as { order_code: string })?.order_code || line.order_id}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {(line.order as unknown as { customer: { store_name: string } })?.customer?.store_name || ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">
                      {formatCurrency(line.amount_collected || 0)}
                    </p>
                    {line.delivered_at && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(line.delivered_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit form */}
      {submitted ? (
        <Card className="border-l-4 border-green-500">
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-700">Đã nộp tiền hôm nay</p>
              <p className="text-xs text-muted-foreground">Chờ kế toán xác nhận</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nộp tiền cho kế toán</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-foreground block mb-1.5">
                Số tiền nộp
              </label>
              <input
                type="number"
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card"
                placeholder={`Tổng thu: ${formatCurrency(totalCollected)}`}
                value={amountSubmitted}
                onChange={(e) => setAmountSubmitted(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Nhập số tiền thực tế bạn nộp cho kế toán
              </p>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !amountSubmitted}
              className="w-full"
            >
              <Send className="h-4 w-4 mr-2" />
              {submitting ? "Đang gửi..." : "Nộp tiền"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
