"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import {
  ClipboardList, Plus, Trash2, Search, Save, AlertCircle, ScanBarcode,
} from "lucide-react"
import type { Product, Batch, ExpenseCategory } from "@/types"

interface AdjustRow {
  key: string
  productId: string
  sku: string
  name: string
  baseUnit: string
  batchId: string | null
  batchCode: string | null
  batchCost: number
  systemQty: number
  actualQty: string
  notes: string
}

function generateEntryCode(): string {
  const now = new Date()
  const y = now.getFullYear().toString().slice(2)
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const r = Math.floor(Math.random() * 9000 + 1000)
  return `KK${y}${m}${d}${r}`
}

export default function StocktakeAdjustPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [search, setSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [matches, setMatches] = useState<Array<Product & { batches?: Batch[] }>>([])
  const [rows, setRows] = useState<AdjustRow[]>([])
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadCategories() {
      if (!user?.org_id) return
      const { data } = await supabase
        .from("expense_categories")
        .select("id, code, name")
        .eq("org_id", user.org_id)
        .eq("bucket", "cogs")
        .eq("is_active", true)
      setCategories((data as ExpenseCategory[]) || [])
    }
    loadCategories()
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search products. Use a left-join so products without active batches
  // (new SKUs, items that fell to 0) still surface — operator needs to be
  // able to record a surplus for them.
  useEffect(() => {
    if (search.trim().length < 2) {
      setMatches([])
      return
    }
    const controller = new AbortController()
    const run = async () => {
      const q = search.trim()
      const { data, error } = await supabase
        .from("products")
        .select("id, sku, name, base_unit, batches(id, batch_code, qty_on_hand, unit_cost, expires_at)")
        .or(`sku.ilike.%${q}%,name.ilike.%${q}%`)
        .eq("status", "active")
        .order("name")
        .limit(15)
        .abortSignal(controller.signal)
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[stocktake search]", error.message)
        return
      }
      setMatches((data as Array<Product & { batches?: Batch[] }>) || [])
    }
    run()
    return () => controller.abort()
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = (product: Product & { batches?: Batch[] }) => {
    // If multiple batches, pick the one with most qty_on_hand as primary
    const primaryBatch = (product.batches || [])
      .slice()
      .sort((a, b) => (b.qty_on_hand || 0) - (a.qty_on_hand || 0))[0]
    const systemQty = (product.batches || []).reduce((s, b) => s + Number(b.qty_on_hand || 0), 0)
    setRows((prev) => [
      ...prev,
      {
        key: `${product.id}-${Date.now()}`,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        baseUnit: product.base_unit,
        batchId: primaryBatch?.id || null,
        batchCode: primaryBatch?.batch_code || null,
        batchCost: Number(primaryBatch?.unit_cost) || 0,
        systemQty,
        actualQty: "",
        notes: "",
      },
    ])
    setSearch("")
    setMatches([])
    setSearchOpen(false)
    searchRef.current?.focus()
  }

  // Load the full on-hand product list so the operator can tick qty for
  // every SKU the org currently holds, instead of searching one by one.
  const loadAllStock = async () => {
    // Two-step load so products without any batch still show up (operator
    // can record a positive/negative adjustment against them).
    const [{ data: prodData }, { data: batchData }] = await Promise.all([
      supabase
        .from("products")
        .select("id, org_id, sku, name, category, brand, barcode, base_unit, vat_rate, shelf_life_days, status, created_at, description, warranty_info, cost_price, sell_price, track_serial, min_stock, max_stock, shelf_location, weight, weight_unit, direct_sale, images, allow_price_edit, price_edit_max_type, price_edit_max, primary_supplier_id")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("batches")
        .select("id, product_id, batch_code, qty_on_hand, unit_cost, expires_at")
        .gt("qty_on_hand", 0),
    ])
    const batchesByProduct: Record<string, Batch[]> = {}
    for (const b of (batchData as Batch[]) || []) {
      if (!batchesByProduct[b.product_id]) batchesByProduct[b.product_id] = []
      batchesByProduct[b.product_id].push(b)
    }
    const list: Array<Product & { batches?: Batch[] }> = ((prodData as Product[]) || []).map((p) => ({
      ...p,
      batches: batchesByProduct[p.id] || [],
    }))
    // Only include products that have stock on hand for the bulk load —
    // operator can still add zero-stock SKUs via search afterwards.
    const withStock = list.filter((p) => (p.batches || []).some((b) => Number(b.qty_on_hand) > 0))
    const existing = new Set(rows.map((r) => r.productId))
    const newRows = withStock
      .filter((p) => !existing.has(p.id))
      .map((product) => {
        const primaryBatch = (product.batches || [])
          .slice()
          .sort((a, b) => (b.qty_on_hand || 0) - (a.qty_on_hand || 0))[0]
        const systemQty = (product.batches || []).reduce(
          (s, b) => s + Number(b.qty_on_hand || 0), 0
        )
        return {
          key: `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          baseUnit: product.base_unit,
          batchId: primaryBatch?.id || null,
          batchCode: primaryBatch?.batch_code || null,
          batchCost: Number(primaryBatch?.unit_cost) || 0,
          systemQty,
          actualQty: "",
          notes: "",
        }
      })
    if (newRows.length === 0) {
      toast({ title: "Không có sản phẩm mới để thêm" })
      return
    }
    setRows((prev) => [...prev, ...newRows])
    toast({
      title: `Đã tải ${newRows.length} sản phẩm`,
      description: "Nhập tồn thực tế cho từng dòng",
    })
  }

  const updateRow = (key: string, patch: Partial<AdjustRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  const summary = useMemo(() => {
    let shrinkageQty = 0
    let shrinkageValue = 0
    let surplusQty = 0
    let surplusValue = 0
    let totalDiffValue = 0
    let rowsWithDiff = 0
    for (const r of rows) {
      if (r.actualQty === "") continue
      const actual = parseFloat(r.actualQty)
      if (isNaN(actual)) continue
      const diff = actual - r.systemQty
      const diffValue = diff * r.batchCost
      if (diff !== 0) rowsWithDiff += 1
      if (diff < 0) {
        shrinkageQty += -diff
        shrinkageValue += -diffValue
      } else if (diff > 0) {
        surplusQty += diff
        surplusValue += diffValue
      }
      totalDiffValue += diffValue
    }
    return { shrinkageQty, shrinkageValue, surplusQty, surplusValue, totalDiffValue, rowsWithDiff }
  }, [rows])

  const handleSave = async () => {
    if (!user?.org_id || !user.id) {
      toast({ title: "Chưa đăng nhập", variant: "destructive" })
      return
    }
    const diffRows = rows
      .filter((r) => r.actualQty !== "")
      .map((r) => {
        const actual = parseFloat(r.actualQty)
        return {
          ...r,
          actual,
          diff: actual - r.systemQty,
        }
      })
      .filter((r) => !isNaN(r.actual) && r.diff !== 0)

    if (diffRows.length === 0) {
      toast({ title: "Không có dòng nào có chênh lệch", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      // 1. Create stocktake entry
      const entryCode = generateEntryCode()
      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert({
          org_id: user.org_id,
          entry_code: entryCode,
          type: "stocktake",
          // Save as draft. A manager will review and approve the adjustment
          // at /inventory/adjustments; that step is what moves stock and
          // posts the expense.
          status: "draft",
          posted_at: null,
          created_by: user.id,
          notes: notes || null,
        })
        .select("id")
        .single()
      if (entryErr || !entry) throw entryErr || new Error("Không tạo được phiếu")

      // 2. Insert lines ONLY — do NOT touch batches or expenses. The
      //    adjustment workflow will do that after approval.
      for (const r of diffRows) {
        await supabase.from("stock_entry_lines").insert({
          entry_id: entry.id,
          product_id: r.productId,
          batch_id: r.batchId,
          unit_name: r.baseUnit,
          quantity: r.diff, // signed: negative = shrinkage, positive = surplus
          qty_in_base_uom: r.diff,
          qty_in_transaction_uom: r.diff,
          transaction_uom: r.baseUnit,
          conversion_factor_snapshot: 1,
          unit_cost: r.batchCost,
          notes: r.notes || null,
        })
      }

      toast({
        title: `Đã lưu phiếu kiểm kê ${entryCode}`,
        description: "Chênh lệch đang chờ duyệt điều chỉnh để cập nhật kho + chi phí.",
      })
      router.push(`/inventory/adjustments`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi khi lưu"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kiểm kê / Điều chỉnh"
        description="Gõ SKU, tồn thực tế. Chênh lệch âm sẽ tự động ghi vào chi phí hao hụt."
        backHref="/inventory"
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số dòng chênh</p>
            <p className="text-xl font-black mt-1">{summary.rowsWithDiff}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-error">Hao hụt</p>
            <p className="text-xl font-black mt-1 text-error">-{summary.shrinkageQty}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(summary.shrinkageValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-tertiary">Thừa</p>
            <p className="text-xl font-black mt-1 text-tertiary">+{summary.surplusQty}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(summary.surplusValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Giá trị chênh (ròng)</p>
            <p className={`text-xl font-black mt-1 ${summary.totalDiffValue < 0 ? "text-error" : summary.totalDiffValue > 0 ? "text-tertiary" : ""}`}>
              {summary.totalDiffValue > 0 ? "+" : ""}{formatCurrency(summary.totalDiffValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search bar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Thêm sản phẩm</CardTitle>
          <Button variant="outline" size="sm" onClick={loadAllStock}>
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
            Tải toàn bộ tồn kho
          </Button>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Gõ SKU hoặc tên sản phẩm..."
              className="pl-10 pr-10"
            />
            <ScanBarcode className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            {searchOpen && matches.length > 0 && (
              <div className="absolute z-20 top-full mt-1 w-full bg-card border rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {matches.map((p) => {
                  const onHand = (p.batches || []).reduce((s, b) => s + Number(b.qty_on_hand || 0), 0)
                  const already = rows.some((r) => r.productId === p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={already}
                      className="w-full text-left p-3 hover:bg-muted/50 border-b last:border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => addRow(p)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs text-primary font-bold">{p.sku}</p>
                          <p className="text-sm font-medium truncate">{p.name}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-muted-foreground">Tồn hệ thống</p>
                          <p className="font-bold">{onHand} {p.base_unit}</p>
                        </div>
                      </div>
                      {already && (
                        <p className="text-[10px] text-[#b54708] mt-1">Đã trong danh sách</p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rows */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có sản phẩm"
          description="Tìm và thêm sản phẩm cần kiểm kê phía trên"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danh sách điều chỉnh ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rows.map((r) => {
                const actual = r.actualQty === "" ? null : parseFloat(r.actualQty)
                const diff = actual !== null && !isNaN(actual) ? actual - r.systemQty : null
                const hasDiff = diff !== null && diff !== 0
                return (
                  <div
                    key={r.key}
                    className={`rounded-xl border p-3 ${hasDiff ? diff! < 0 ? "border-error/40 bg-error-container/50" : "border-tertiary/40 bg-[#ecfdf3]/50" : "bg-card"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-primary">{r.sku}</p>
                        <p className="font-semibold text-sm leading-tight">{r.name}</p>
                        {r.batchCode && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Lô: <span className="font-mono">{r.batchCode}</span>
                            {r.batchCost > 0 && ` • Giá vốn: ${formatCurrency(r.batchCost)}`}
                          </p>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeRow(r.key)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Tồn hệ thống
                        </Label>
                        <p className="font-semibold text-sm mt-1">{r.systemQty} {r.baseUnit}</p>
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Tồn thực tế
                        </Label>
                        <Input
                          type="number"
                          value={r.actualQty}
                          onChange={(e) => updateRow(r.key, { actualQty: e.target.value })}
                          placeholder="-"
                          className="h-9 text-center"
                        />
                      </div>
                      <div className="text-right">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Chênh lệch
                        </Label>
                        <p className={`font-bold text-sm mt-1 ${hasDiff ? diff! < 0 ? "text-error" : "text-tertiary" : "text-muted-foreground"}`}>
                          {diff === null ? "-" : diff > 0 ? `+${diff}` : String(diff)}
                        </p>
                        {hasDiff && r.batchCost > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            {formatCurrency(diff! * r.batchCost)}
                          </p>
                        )}
                      </div>
                    </div>

                    <Input
                      className="h-8 text-xs mt-2"
                      placeholder="Ghi chú (hỏng, rớt vỡ...)"
                      value={r.notes}
                      onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                    />
                  </div>
                )
              })}
            </div>

            <div className="mt-4 space-y-2">
              <Label>Ghi chú toàn phiếu</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="VD: Kiểm kê định kỳ tháng..."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {summary.shrinkageValue > 0 && (
        <div className="rounded-xl border border-[#fdb022]/40 bg-[#fff4ed] p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-[#b54708] shrink-0 mt-0.5" />
          <div className="text-sm text-[#b54708]">
            <p className="font-semibold">
              Hao hụt {formatCurrency(summary.shrinkageValue)} sẽ ghi vào chi phí khi duyệt điều chỉnh
            </p>
            <p className="text-xs mt-0.5">
              Phiếu sẽ được tạo ở trạng thái <strong>Nháp</strong>. Vào{" "}
              <span className="font-mono">/inventory/adjustments</span> để duyệt, tồn kho sẽ cập nhật sau khi duyệt.
              {" "}Danh mục chi phí:{" "}
              <span className="font-mono">
                {categories.find((c) => c.code === "COGS_ADJ")?.name || "Điều chỉnh kiểm kê"}
              </span>
            </p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Hủy
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || summary.rowsWithDiff === 0}
          >
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? "Đang lưu..." : `Lưu phiếu (${summary.rowsWithDiff} chênh lệch)`}
          </Button>
        </div>
      )}

      {!rows.length && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); searchRef.current?.focus() }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Thêm sản phẩm
          </Button>
        </div>
      )}
    </div>
  )
}
