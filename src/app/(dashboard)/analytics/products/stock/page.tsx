"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/analytics/kpi-card"
import { TopListCard, MoneyCell, NumberCell } from "@/components/analytics/top-list"

interface BatchRow {
  id: string
  product_id: string
  batch_code: string
  expires_at: string | null
  qty_on_hand: number
  unit_cost: number
  status: string
}

interface ProductRow {
  id: string
  sku: string
  name: string
  category: string | null
  shelf_life_days: number | null
}

export default function ProductsStockPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [batchesRes, productsRes] = await Promise.all([
      supabase
        .from("batches")
        .select("id, product_id, batch_code, expires_at, qty_on_hand, unit_cost, status")
        .eq("org_id", user.org_id)
        .gt("qty_on_hand", 0),
      supabase
        .from("products")
        .select("id, sku, name, category, shelf_life_days")
        .eq("org_id", user.org_id),
    ])
    const qErr = ([batchesRes, productsRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[products/stock] truy vấn lỗi:", qErr.message)
    setBatches((batchesRes.data as BatchRow[]) || [])
    setProducts((productsRes.data as ProductRow[]) || [])
    setLoading(false)
  }, [user?.org_id, supabase])

  useEffect(() => {
    load()
  }, [load])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const stats = useMemo(() => {
    const skuOnHand = new Set(batches.map((b) => b.product_id)).size
    const totalQty = batches.reduce((s, b) => s + Number(b.qty_on_hand || 0), 0)
    const totalValue = batches.reduce((s, b) => s + Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0), 0)
    const expiringIn30 = batches.filter((b) => {
      if (!b.expires_at) return false
      const days = Math.ceil((new Date(b.expires_at).getTime() - Date.now()) / 86400000)
      return days <= 30 && days > 0
    }).length
    const expired = batches.filter((b) => {
      if (!b.expires_at) return false
      return new Date(b.expires_at).getTime() < Date.now()
    }).length
    return { skuOnHand, totalQty, totalValue, batchCount: batches.length, expiringIn30, expired }
  }, [batches])

  const byProduct = useMemo(() => {
    const m = new Map<string, { qty: number; value: number; batches: number }>()
    for (const b of batches) {
      const e = m.get(b.product_id) || { qty: 0, value: 0, batches: 0 }
      e.qty += Number(b.qty_on_hand || 0)
      e.value += Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0)
      e.batches += 1
      m.set(b.product_id, e)
    }
    return Array.from(m.entries())
      .map(([pid, e]) => ({
        id: pid,
        sku: productMap.get(pid)?.sku || "—",
        name: productMap.get(pid)?.name || "—",
        category: productMap.get(pid)?.category || "—",
        qty: e.qty,
        value: e.value,
        batches: e.batches,
      }))
      .sort((a, b) => b.value - a.value)
  }, [batches, productMap])

  const expiring = useMemo(() => {
    return batches
      .filter((b) => {
        if (!b.expires_at) return false
        const days = Math.ceil((new Date(b.expires_at).getTime() - Date.now()) / 86400000)
        return days <= 60
      })
      .map((b) => {
        const days = b.expires_at
          ? Math.ceil((new Date(b.expires_at).getTime() - Date.now()) / 86400000)
          : 0
        return {
          id: b.id,
          name: productMap.get(b.product_id)?.name || "—",
          batch_code: b.batch_code,
          expires_at: b.expires_at || "",
          qty: Number(b.qty_on_hand || 0),
          value: Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0),
          daysLeft: days,
        }
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 20)
  }, [batches, productMap])

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tồn kho</h1>
        <p className="text-sm text-muted-foreground">Số liệu tức thời tại thời điểm hiện tại</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="SKU đang tồn" value={stats.skuOnHand} format="number" changePct={null} avgLabel="Số lô" avgValue={stats.batchCount} />
        <KpiCard label="Tổng đơn vị tồn" value={stats.totalQty} format="number" changePct={null} avgLabel="Lô tồn" avgValue={stats.batchCount} />
        <KpiCard label="Giá trị tồn kho" value={stats.totalValue} format="compactCurrency" changePct={null} avgLabel="Lô bình quân" avgValue={stats.batchCount > 0 ? stats.totalValue / stats.batchCount : 0} />
        <KpiCard label="Cận date / Hết hạn" value={`${stats.expiringIn30} / ${stats.expired}`} format="raw" changePct={null} avgLabel="< 30 ngày / đã hết hạn" avgValue="" />
      </div>

      <TopListCard
        title="Top sản phẩm theo giá trị tồn kho"
        rows={byProduct.slice(0, 20)}
        rowKey={(r) => r.id}
        columns={[
          { key: "sku", label: "SKU", render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "category", label: "Nhóm hàng", render: (r) => r.category },
          { key: "qty", label: "SL tồn", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "value", label: "Giá trị", align: "right", render: (r) => <MoneyCell value={r.value} /> },
          { key: "batches", label: "Số lô", align: "right", render: (r) => <NumberCell value={r.batches} /> },
        ]}
      />

      <TopListCard
        title="Lô hàng cận date hoặc đã hết hạn"
        description="20 lô có ngày hết hạn gần nhất"
        rows={expiring}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "batch", label: "Mã lô", render: (r) => <span className="font-mono text-xs">{r.batch_code}</span> },
          { key: "expires", label: "Hạn dùng", render: (r) =>
            r.expires_at ? new Date(r.expires_at).toLocaleDateString("vi-VN") : "—" },
          { key: "days", label: "Còn lại (ngày)", align: "right", render: (r) => (
            <span className={r.daysLeft <= 0 ? "font-semibold text-error tabular-data" : r.daysLeft <= 30 ? "font-semibold text-[#b54708] tabular-data" : "text-on-surface tabular-data"}>
              {r.daysLeft}
            </span>
          )},
          { key: "qty", label: "SL tồn", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "value", label: "Giá trị", align: "right", render: (r) => <MoneyCell value={r.value} /> },
        ]}
        emptyText="Không có lô cận date trong 60 ngày"
      />
    </div>
  )
}
