"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/ui/page-header"
import { useToast } from "@/hooks/use-toast"
import { ClipboardCheck, Save, AlertTriangle } from "lucide-react"
import type { Product, Batch } from "@/types"

type BatchWithProduct = Batch & { product?: Product }

interface StocktakeRow {
  productId: string
  productName: string
  sku: string
  baseUnit: string
  systemQty: number
  actualQty: string
}

export default function StocktakeCheckPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<BatchWithProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stocktakeDate, setStocktakeDate] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [rows, setRows] = useState<StocktakeRow[]>([])
  const [saved, setSaved] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchBatches = useCallback(async () => {
    setLoading(true)
    // Phiếu kiểm kê phải liệt kê ĐỦ lô đang có tồn — thiếu lô nào là lô đó
    // không được kiểm, và chênh lệch sẽ đổ vào lần kiểm sau.
    const res = await fetchAllForAggregate((from, to) =>
      supabase
        .from("batches")
        .select("id, product_id, qty_on_hand, product:products(*)", { count: "exact" })
        .gt("qty_on_hand", 0)
        .order("product_id")
        .range(from, to)
    )
    if (res.error) console.error("[inventory/stocktake-check] truy vấn lỗi:", res.error)
    setBatches(res.rows as unknown as BatchWithProduct[])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchBatches()
  }, [fetchBatches])

  // Group batches by product
  useEffect(() => {
    if (batches.length === 0) return

    const grouped = new Map<string, { product: Product; totalQty: number }>()
    for (const b of batches) {
      if (!b.product) continue
      const existing = grouped.get(b.product_id)
      if (existing) {
        existing.totalQty += b.qty_on_hand || 0
      } else {
        grouped.set(b.product_id, {
          product: b.product,
          totalQty: b.qty_on_hand || 0,
        })
      }
    }

    const newRows: StocktakeRow[] = Array.from(grouped.entries()).map(
      ([productId, { product, totalQty }]) => ({
        productId,
        productName: product.name,
        sku: product.sku,
        baseUnit: product.base_unit,
        systemQty: totalQty,
        actualQty: "",
      })
    )
    newRows.sort((a, b) => a.productName.localeCompare(b.productName, "vi"))
    setRows(newRows)
  }, [batches])

  const handleActualQtyChange = (index: number, value: string) => {
    setRows((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], actualQty: value }
      return updated
    })
  }

  const discrepancyRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.actualQty === "") return false
      const actual = parseFloat(r.actualQty)
      if (isNaN(actual)) return false
      return actual !== r.systemQty
    })
  }, [rows])

  const summary = useMemo(() => {
    let positiveCount = 0
    let negativeCount = 0
    let positiveTotal = 0
    let negativeTotal = 0

    for (const r of discrepancyRows) {
      const diff = parseFloat(r.actualQty) - r.systemQty
      if (diff > 0) {
        positiveCount++
        positiveTotal += diff
      } else {
        negativeCount++
        negativeTotal += diff
      }
    }

    return {
      total: discrepancyRows.length,
      positiveCount,
      negativeCount,
      positiveTotal,
      negativeTotal,
    }
  }, [discrepancyRows])

  const handleSave = async () => {
    if (discrepancyRows.length === 0) {
      toast({ title: "Không có chênh lệch", description: "Tất cả sản phẩm khớp với tồn hệ thống." })
      return
    }
    if (!user) return

    setSaving(true)
    try {
      const entryCode = `ST-${stocktakeDate.replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`

      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert({
          entry_code: entryCode,
          type: "stocktake",
          created_by: user.id,
          org_id: user.org_id,
          notes: `Kiểm kê ngày ${stocktakeDate}. ${discrepancyRows.length} sản phẩm chênh lệch.`,
        })
        .select()
        .single()

      if (entryErr) throw entryErr

      const lineInserts = discrepancyRows.map((r) => {
        const diff = parseFloat(r.actualQty) - r.systemQty
        return {
          entry_id: entry.id,
          product_id: r.productId,
          unit_name: r.baseUnit,
          quantity: diff,
          notes: `Tồn HT: ${r.systemQty}, Thực tế: ${r.actualQty}, Chênh lệch: ${diff > 0 ? "+" : ""}${diff}`,
        }
      })

      const { error: lineErr } = await supabase
        .from("stock_entry_lines")
        .insert(lineInserts)

      if (lineErr) throw lineErr

      toast({ title: `Đã lưu kiểm kê ${entryCode}`, description: `${discrepancyRows.length} sản phẩm chênh lệch` })
      setSaved(true)
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

  if (authLoading) return <Skeleton className="h-96" />

  // Permission check: warehouse + owner only
  const allowed = user && (user.role === "warehouse" || user.role === "owner")
  if (!authLoading && user && !allowed) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Bạn không có quyền truy cập trang kiểm kê. Chỉ thủ kho và chủ NPP được phép.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kiểm kê tồn kho"
        description="Đối chiếu tồn kho thực tế với hệ thống"
        backHref="/inventory"
      >
        <Badge variant="secondary">
          <ClipboardCheck className="h-3 w-3 mr-1" />
          Stocktake
        </Badge>
      </PageHeader>

      {/* Date picker */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="space-y-2">
              <Label>Ngày kiểm kê</Label>
              <Input
                type="date"
                value={stocktakeDate}
                onChange={(e) => setStocktakeDate(e.target.value)}
                className="w-48"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Dữ liệu tồn kho hệ thống tính đến thời điểm hiện tại. Nhập số lượng thực tế đếm được.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {discrepancyRows.length > 0 && (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-bold">
                  {summary.total} sản phẩm chênh lệch
                </p>
                {summary.positiveTotal > 0 && (
                  <p className="text-tertiary">
                    Thừa: +{summary.positiveTotal} ({summary.positiveCount} sản phẩm)
                  </p>
                )}
                {summary.negativeTotal < 0 && (
                  <p className="text-destructive">
                    Thiếu: {summary.negativeTotal} ({summary.negativeCount} sản phẩm)
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Danh sách sản phẩm ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48" />
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Không có sản phẩm tồn kho để kiểm kê
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Tồn hệ thống</TableHead>
                      <TableHead className="text-right w-32">Tồn thực tế</TableHead>
                      <TableHead className="text-right">Chênh lệch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => {
                      const actual = row.actualQty !== "" ? parseFloat(row.actualQty) : null
                      const diff = actual !== null && !isNaN(actual) ? actual - row.systemQty : null
                      const hasDiff = diff !== null && diff !== 0

                      return (
                        <TableRow key={row.productId} className={hasDiff ? "bg-destructive/5" : ""}>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {row.systemQty} {row.baseUnit}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              value={row.actualQty}
                              onChange={(e) => handleActualQtyChange(index, e.target.value)}
                              placeholder="-"
                              className="w-24 text-right ml-auto"
                              disabled={saved}
                            />
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {diff !== null && !isNaN(diff) ? (
                              <span
                                className={
                                  diff > 0
                                    ? "text-tertiary"
                                    : diff < 0
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                }
                              >
                                {diff > 0 ? "+" : ""}{diff}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {rows.map((row, index) => {
                  const actual = row.actualQty !== "" ? parseFloat(row.actualQty) : null
                  const diff = actual !== null && !isNaN(actual) ? actual - row.systemQty : null
                  const hasDiff = diff !== null && diff !== 0

                  return (
                    <div
                      key={row.productId}
                      className={`rounded-xl border p-3 ${hasDiff ? "bg-destructive/5 border-destructive/40" : "bg-card"}`}
                    >
                      <div className="mb-2">
                        <p className="font-semibold text-sm leading-tight">{row.productName}</p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5">SKU: {row.sku}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Tồn hệ thống
                          </p>
                          <p className="font-semibold text-sm mt-0.5">
                            {row.systemQty} {row.baseUnit}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                            Tồn thực tế
                          </p>
                          <Input
                            type="number"
                            value={row.actualQty}
                            onChange={(e) => handleActualQtyChange(index, e.target.value)}
                            placeholder="-"
                            className="h-9 text-center"
                            disabled={saved}
                          />
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Chênh lệch
                          </p>
                          <p className="font-bold text-sm mt-0.5">
                            {diff !== null && !isNaN(diff) ? (
                              <span
                                className={
                                  diff > 0
                                    ? "text-tertiary"
                                    : diff < 0
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                }
                              >
                                {diff > 0 ? "+" : ""}{diff}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save button */}
      {!saved ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving || discrepancyRows.length === 0}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Đang lưu..." : `Lưu kiểm kê (${discrepancyRows.length} chênh lệch)`}
          </Button>
        </div>
      ) : (
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold text-tertiary">
              Đã lưu kiểm kê thành công. Phiếu kiểm kê đã được tạo trong danh sách phiếu kho.
            </p>
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => router.push("/inventory")}>
                Về trang kho
              </Button>
              <Button variant="outline" size="sm" onClick={() => router.push("/inventory/entries")}>
                Xem phiếu kho
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
