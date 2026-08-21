"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  ClipboardList, CheckCircle2, XCircle, AlertCircle, TrendingDown, TrendingUp,
  Eye, ChevronRight,
} from "lucide-react"
import type { ExpenseCategory } from "@/types"

type AdjustmentLine = {
  id: string
  product_id: string
  batch_id: string | null
  unit_name: string
  quantity: number
  unit_cost: number
  notes: string | null
  product?: { name: string; sku: string; base_unit: string } | null
  batch?: { batch_code?: string; qty_on_hand?: number } | null
}

type Adjustment = {
  id: string
  entry_code: string
  status: string
  notes: string | null
  posted_at: string | null
  created_at: string
  creator?: { full_name?: string } | null
  lines?: AdjustmentLine[]
}

export default function AdjustmentsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [drafts, setDrafts] = useState<Adjustment[]>([])
  const [recentPosted, setRecentPosted] = useState<Adjustment[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [draftsRes, postedRes, catRes] = await Promise.all([
      supabase
        .from("stock_entries")
        .select(
          "id, entry_code, status, notes, posted_at, created_at, creator:users!stock_entries_created_by_fkey(full_name), lines:stock_entry_lines(*, product:products(name, sku, base_unit), batch:batches(batch_code, qty_on_hand))"
        )
        .eq("org_id", user.org_id)
        .eq("type", "stocktake")
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("stock_entries")
        .select(
          "id, entry_code, status, notes, posted_at, created_at, creator:users!stock_entries_created_by_fkey(full_name), lines:stock_entry_lines(*, product:products(name, sku, base_unit), batch:batches(batch_code, qty_on_hand))"
        )
        .eq("org_id", user.org_id)
        .eq("type", "stocktake")
        .eq("status", "posted")
        .order("posted_at", { ascending: false })
        .limit(10),
      supabase
        .from("expense_categories")
        .select("id, code, name")
        .eq("org_id", user.org_id)
        .eq("bucket", "cogs")
        .eq("is_active", true),
    ])
    setDrafts(((draftsRes.data as unknown) as Adjustment[]) || [])
    setRecentPosted(((postedRes.data as unknown) as Adjustment[]) || [])
    setCategories((catRes.data as ExpenseCategory[]) || [])
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Compute variance summary for one adjustment
  const summarize = (a: Adjustment) => {
    let shrinkQty = 0
    let shrinkValue = 0
    let surplusQty = 0
    let surplusValue = 0
    for (const l of a.lines || []) {
      const qty = Number(l.quantity)
      const cost = Number(l.unit_cost) || 0
      const value = Math.abs(qty) * cost
      if (qty < 0) {
        shrinkQty += -qty
        shrinkValue += value
      } else if (qty > 0) {
        surplusQty += qty
        surplusValue += value
      }
    }
    return { shrinkQty, shrinkValue, surplusQty, surplusValue, netValue: surplusValue - shrinkValue }
  }

  const totalSummary = useMemo(() => {
    let shrink = 0
    let surplus = 0
    for (const d of drafts) {
      const s = summarize(d)
      shrink += s.shrinkValue
      surplus += s.surplusValue
    }
    return { shrink, surplus }
  }, [drafts])

  const canApprove = user && ["owner", "manager"].includes(user.role)

  const handleApprove = async (a: Adjustment) => {
    if (!user?.org_id || !canApprove) return
    const s = summarize(a)
    if (!confirm(
      `Duyệt điều chỉnh ${a.entry_code}?\n\n` +
      `• Hao hụt: ${s.shrinkQty} đơn vị (${formatCurrency(s.shrinkValue)})\n` +
      `• Thừa: ${s.surplusQty} đơn vị (${formatCurrency(s.surplusValue)})\n\n` +
      `Kho sẽ được cập nhật và chi phí hao hụt sẽ được ghi.`
    )) return

    setApprovingId(a.id)
    try {
      // 1. Update batches. For each line with a batch_id, add the signed diff.
      //    Lines with a batch_id were captured with the pre-stocktake qty, so we
      //    just apply the diff. For lines without batch_id (rare — aggregated
      //    adjustment), we fall back to FEFO: shrinkage deducts from first-expiry
      //    batches; surplus goes to the latest batch (or the first if none).
      for (const l of a.lines || []) {
        const diff = Number(l.quantity)
        if (diff === 0) continue

        if (l.batch_id) {
          const { data: b } = await supabase
            .from("batches")
            .select("qty_on_hand")
            .eq("id", l.batch_id)
            .maybeSingle()
          const current = Number((b as { qty_on_hand?: number } | null)?.qty_on_hand) || 0
          const newQty = Math.max(0, current + diff)
          await supabase.from("batches").update({ qty_on_hand: newQty }).eq("id", l.batch_id)
        } else if (diff < 0) {
          // Shrinkage, no batch → FEFO deduct
          let remaining = -diff
          const { data: batches } = await supabase
            .from("batches")
            .select("id, qty_on_hand")
            .eq("product_id", l.product_id)
            .gt("qty_on_hand", 0)
            .order("expires_at", { ascending: true })
          for (const b of (batches as Array<{ id: string; qty_on_hand: number }>) || []) {
            if (remaining <= 0) break
            const take = Math.min(remaining, Number(b.qty_on_hand))
            await supabase.from("batches").update({ qty_on_hand: Number(b.qty_on_hand) - take }).eq("id", b.id)
            remaining -= take
          }
        } else if (diff > 0) {
          // Surplus, no batch → add to the latest batch, or create a floating batch
          const { data: batches } = await supabase
            .from("batches")
            .select("id, qty_on_hand")
            .eq("product_id", l.product_id)
            .order("expires_at", { ascending: false })
            .limit(1)
          const first = (batches as Array<{ id: string; qty_on_hand: number }>)?.[0]
          if (first) {
            await supabase
              .from("batches")
              .update({ qty_on_hand: Number(first.qty_on_hand) + diff })
              .eq("id", first.id)
          }
          // Silently skip if no batch exists for this product — manager should
          // create a batch first.
        }
      }

      // 2. Post an expense for the shrinkage value
      if (s.shrinkValue > 0) {
        const cogsCategory = categories.find((c) => c.code === "COGS_ADJ") || categories[0]
        await supabase.from("expenses").insert({
          org_id: user.org_id,
          category_id: cogsCategory?.id ?? null,
          expense_date: new Date().toISOString().slice(0, 10),
          amount: s.shrinkValue,
          description: `Hao hụt từ phiếu kiểm kê ${a.entry_code}`,
          reference_code: a.entry_code,
          source_type: "stocktake",
          source_id: a.id,
          created_by: user.id,
        }).throwOnError()
      }

      // 3. Post the entry
      await supabase
        .from("stock_entries")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", a.id).throwOnError()

      toast({
        title: `Đã duyệt ${a.entry_code}`,
        description:
          s.shrinkValue > 0
            ? `Kho đã cập nhật • Chi phí hao hụt ${formatCurrency(s.shrinkValue)}`
            : "Kho đã cập nhật",
      })
      await fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: msg, variant: "destructive" })
    } finally {
      setApprovingId(null)
    }
  }

  const handleReject = async (a: Adjustment) => {
    if (!canApprove) return
    if (!confirm(`Hủy phiếu ${a.entry_code}? Không tác động đến kho.`)) return
    setRejectingId(a.id)
    try {
      await supabase
        .from("stock_entries")
        .update({ status: "cancelled" })
        .eq("id", a.id).throwOnError()
      toast({ title: `Đã hủy ${a.entry_code}` })
      await fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi"
      toast({ title: "Lỗi", description: msg, variant: "destructive" })
    } finally {
      setRejectingId(null)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const renderDetailRows = (a: Adjustment) => (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
        Chi tiết chênh lệch ({(a.lines || []).length} dòng)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground bg-muted/20">
            <tr>
              <th className="text-left py-1.5 px-2 font-semibold">SKU</th>
              <th className="text-left py-1.5 px-2 font-semibold">Sản phẩm</th>
              <th className="text-left py-1.5 px-2 font-semibold">Lô</th>
              <th className="text-right py-1.5 px-2 font-semibold">Chênh lệch</th>
              <th className="text-right py-1.5 px-2 font-semibold">Giá vốn</th>
              <th className="text-right py-1.5 px-2 font-semibold">Chi phí lệch</th>
            </tr>
          </thead>
          <tbody>
            {(a.lines || []).map((l) => {
              const diff = Number(l.quantity)
              const cost = Number(l.unit_cost) || 0
              const value = Math.abs(diff) * cost
              return (
                <tr key={l.id} className="border-t">
                  <td className="py-1.5 px-2 font-mono">{l.product?.sku || "-"}</td>
                  <td className="py-1.5 px-2">{l.product?.name || "-"}</td>
                  <td className="py-1.5 px-2 font-mono text-muted-foreground">
                    {l.batch?.batch_code || "—"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-bold ${diff < 0 ? "text-error" : diff > 0 ? "text-tertiary" : ""}`}>
                    {diff > 0 ? `+${diff}` : diff} {l.unit_name}
                  </td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">
                    {cost > 0 ? formatCurrency(cost) : "-"}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-semibold ${diff < 0 ? "text-error" : "text-tertiary"}`}>
                    {value > 0 ? (diff < 0 ? "-" : "+") + formatCurrency(value) : "-"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Điều chỉnh kho (từ kiểm kê)"
        description="Duyệt phiếu kiểm kê: cập nhật tồn kho + ghi nhận chi phí hao hụt"
        backHref="/inventory"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/inventory/stocktake-adjust">+ Tạo kiểm kê</Link>
        </Button>
      </PageHeader>

      {/* Summary */}
      {drafts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Phiếu chờ duyệt
              </p>
              <p className="text-xl font-black mt-1">{drafts.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-error">
                <TrendingDown className="h-3 w-3" /> Chi phí hao hụt chờ ghi
              </div>
              <p className="text-xl font-black mt-1 text-error">
                {formatCurrency(totalSummary.shrink)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-tertiary">
                <TrendingUp className="h-3 w-3" /> Giá trị thừa chờ thu hồi
              </div>
              <p className="text-xl font-black mt-1 text-tertiary">
                {formatCurrency(totalSummary.surplus)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Drafts */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title="Không có phiếu chờ duyệt"
          description="Phiếu kiểm kê có chênh lệch sẽ hiện ở đây"
        >
          <Button asChild className="mt-4">
            <Link href="/inventory/stocktake-adjust">+ Tạo phiếu kiểm kê mới</Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {drafts.map((a) => {
            const s = summarize(a)
            const isExpanded = expandedId === a.id
            return (
              <Card key={a.id} className="border-[#fdb022]/40">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/inventory/entries/${a.id}`}
                          className="font-mono text-sm font-bold text-primary hover:underline"
                        >
                          {a.entry_code}
                        </Link>
                        <Badge variant="warning">Chờ duyệt</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(a.created_at)}
                        {a.creator?.full_name ? ` • Bởi ${a.creator.full_name}` : ""}
                        {` • ${(a.lines || []).length} dòng`}
                      </p>
                      {a.notes && (
                        <p className="text-xs text-muted-foreground italic mt-1">
                          &ldquo;{a.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Hao hụt</p>
                      <p className="font-bold text-error">
                        {s.shrinkQty > 0 ? `-${s.shrinkQty}` : "0"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatCurrency(s.shrinkValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Thừa</p>
                      <p className="font-bold text-tertiary">
                        {s.surplusQty > 0 ? `+${s.surplusQty}` : "0"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatCurrency(s.surplusValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Chi phí lệch ròng</p>
                      <p className={`font-bold ${s.netValue < 0 ? "text-error" : s.netValue > 0 ? "text-tertiary" : ""}`}>
                        {s.netValue > 0 ? "+" : ""}{formatCurrency(s.netValue)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      {isExpanded ? "Ẩn" : "Xem chi tiết"}
                      <ChevronRight className={`h-3 w-3 ml-1 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </Button>
                    {canApprove && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(a)}
                          disabled={approvingId === a.id || rejectingId === a.id}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                          {approvingId === a.id ? "Đang duyệt..." : "Duyệt điều chỉnh"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-error/40 text-error hover:bg-error-container"
                          onClick={() => handleReject(a)}
                          disabled={approvingId === a.id || rejectingId === a.id}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1.5" />
                          {rejectingId === a.id ? "Đang hủy..." : "Hủy phiếu"}
                        </Button>
                      </>
                    )}
                  </div>
                  {isExpanded && renderDetailRows(a)}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {!canApprove && drafts.length > 0 && (
        <div className="rounded-xl border border-dashed p-3 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          Chỉ Owner/Manager mới duyệt được điều chỉnh. Bạn có thể xem.
        </div>
      )}

      {/* Recent posted adjustments — read-only history */}
      {recentPosted.length > 0 && (
        <div className="space-y-2 pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
            Điều chỉnh đã duyệt gần đây ({recentPosted.length})
          </p>
          {recentPosted.map((a) => {
            const s = summarize(a)
            return (
              <Card key={a.id}>
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/inventory/entries/${a.id}`}
                        className="font-mono text-xs font-bold text-primary hover:underline"
                      >
                        {a.entry_code}
                      </Link>
                      <Badge variant="success">Đã duyệt</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(a.posted_at || a.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Hao hụt: {formatCurrency(s.shrinkValue)} • Thừa: {formatCurrency(s.surplusValue)}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/inventory/entries/${a.id}`}>
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
