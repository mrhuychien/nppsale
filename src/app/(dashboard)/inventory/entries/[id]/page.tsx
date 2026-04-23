"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import { Pencil, Trash2, X, Printer, Package } from "lucide-react"
import type { StockEntry, StockEntryLine } from "@/types"

export default function StockEntryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [entry, setEntry] = useState<StockEntry | null>(null)
  const [lines, setLines] = useState<StockEntryLine[]>([])
  const [refOrders, setRefOrders] = useState<Array<{
    id: string
    order_code: string
    customer?: { store_name?: string } | null
    lines?: Array<{ product_id: string; unit_name: string; quantity: number; product?: { name: string; sku: string } | null }>
  }>>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editNotes, setEditNotes] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [entryRes, linesRes] = await Promise.all([
      supabase
        .from("stock_entries")
        .select("*, creator:users!stock_entries_created_by_fkey(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("stock_entry_lines")
        .select("*, product:products(*), batch:batches(*)")
        .eq("entry_id", id),
    ])
    let entryData: StockEntry | null = null
    if (entryRes.data) {
      const e = entryRes.data as StockEntry
      entryData = e
      setEntry(e)
      setEditNotes(e.notes || "")
    }
    setLines((linesRes.data as StockEntryLine[]) || [])

    // For export entries that wrap multiple orders, load the source orders
    // with their lines so the warehouse can see how to split the aggregate.
    type RefOrder = {
      id: string
      order_code: string
      customer?: { store_name?: string } | null
      lines?: Array<{ product_id: string; unit_name: string; quantity: number; product?: { name: string; sku: string } | null }>
    }
    const refOrderIds =
      (entryData?.type === "export" && Array.isArray(entryData.ref_order_ids))
        ? (entryData.ref_order_ids as string[])
        : []
    if (refOrderIds.length > 0) {
      const { data: orderRows } = await supabase
        .from("sales_orders")
        .select("id, order_code, customer:customers(store_name), lines:sales_order_lines(product_id, unit_name, quantity, product:products(name, sku))")
        .in("id", refOrderIds)
      setRefOrders(((orderRows as unknown) as RefOrder[]) || [])
    } else {
      setRefOrders([])
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleSaveEdit = async () => {
    if (!entry) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("stock_entries")
        .update({ notes: editNotes || null })
        .eq("id", entry.id)
      if (error) throw error
      toast({ title: "Đã cập nhật phiếu kho" })
      setEditMode(false)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!entry) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("stock_entries").delete().eq("id", entry.id)
      if (error) throw error
      toast({ title: "Đã xóa phiếu kho" })
      router.push("/inventory/entries")
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!entry) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu kho</div>

  const typeLabel = STOCK_ENTRY_TYPES.find((t) => t.value === entry.type)?.label || entry.type
  const typeVariant: "default" | "success" | "warning" | "secondary" =
    entry.type === "import" ? "success" :
    entry.type === "export" ? "warning" :
    entry.type === "transfer" ? "default" : "secondary"
  const canEdit = user && hasPermission(user.role, "inventory", "update")
  const canDelete = user && hasPermission(user.role, "inventory", "delete")

  const totalQty = lines.reduce((sum, l) => sum + Number(l.quantity || 0), 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title={entry.entry_code}
        description={`${typeLabel} • Ngày tạo: ${formatDate(entry.created_at)}`}
        backHref="/inventory/entries"
      >
        <Badge variant={typeVariant}>{typeLabel}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - lines */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Chi tiết sản phẩm ({lines.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" /> In phiếu
            </Button>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Phiếu chưa có chi tiết sản phẩm
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sản phẩm</TableHead>
                        <TableHead>Lô / SKU</TableHead>
                        <TableHead>ĐVT</TableHead>
                        <TableHead className="text-right">Số lượng</TableHead>
                        <TableHead>Ghi chú</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            <div className="font-semibold">{line.product?.name || "-"}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              SKU: {line.product?.sku}
                            </div>
                          </TableCell>
                          <TableCell>
                            {line.batch?.batch_code ? (
                              <span className="font-mono text-xs bg-surface-container px-2 py-1 rounded">
                                {line.batch.batch_code}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                          <TableCell>{line.unit_name}</TableCell>
                          <TableCell className="text-right font-bold">{line.quantity}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                            {line.notes || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile card list */}
                <div className="md:hidden space-y-2">
                  {lines.map((line) => (
                    <div key={line.id} className="rounded-xl border bg-muted/20 p-3">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm leading-tight">{line.product?.name || "-"}</p>
                          <p className="font-mono text-xs text-muted-foreground mt-0.5">
                            SKU: {line.product?.sku}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold text-base">{line.quantity} {line.unit_name}</span>
                      </div>
                      {line.batch?.batch_code && (
                        <span className="font-mono text-xs bg-surface-container px-2 py-0.5 rounded inline-block">
                          Lô: {line.batch.batch_code}
                        </span>
                      )}
                      {line.notes && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{line.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4 pt-4 border-t border-border/40 flex justify-between text-sm">
              <span className="text-muted-foreground">Tổng số lượng</span>
              <span className="font-black text-lg">{totalQty}</span>
            </div>
          </CardContent>
        </Card>

        {/* Per-order breakdown (warehouse splits the aggregate by order) */}
        {refOrders.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Chi tiết theo đơn ({refOrders.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Dùng để chia hàng đã gộp theo từng khách hàng khi bàn giao.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {refOrders.map((o) => (
                <div key={o.id} className="rounded-xl border bg-muted/10 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <a
                        href={`/orders/${o.id}`}
                        className="font-mono text-sm font-bold text-primary hover:underline"
                      >
                        {o.order_code}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {o.customer?.store_name || "-"}
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="text-left py-1 font-semibold">SKU</th>
                          <th className="text-left py-1 font-semibold">Sản phẩm</th>
                          <th className="text-right py-1 font-semibold w-24">SL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(o.lines || []).map((l, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="py-1.5 font-mono">{l.product?.sku || "-"}</td>
                            <td className="py-1.5">{l.product?.name || "-"}</td>
                            <td className="py-1.5 text-right font-semibold">
                              {l.quantity} {l.unit_name}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Right - info + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin phiếu</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditNotes(entry.notes || "")
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mã phiếu</Label>
                <p className="font-mono font-semibold">{entry.entry_code}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Loại</Label>
                <p><Badge variant={typeVariant}>{typeLabel}</Badge></p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người tạo</Label>
                <p className="font-semibold">{entry.creator?.full_name || "-"}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày tạo</Label>
                <p className="font-semibold">{formatDate(entry.created_at)}</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                {!editMode ? (
                  <p className="whitespace-pre-wrap">
                    {entry.notes || <span className="text-muted-foreground">Không có</span>}
                  </p>
                ) : (
                  <>
                    <Textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={3}
                      className="mt-1"
                    />
                    <Button
                      onClick={handleSaveEdit}
                      disabled={actionLoading}
                      className="w-full mt-2"
                    >
                      {actionLoading ? "Đang lưu..." : "Lưu ghi chú"}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa phiếu kho
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Xóa phiếu sẽ xóa toàn bộ dòng chi tiết (không thể khôi phục).
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa phiếu kho?"
        description={`Phiếu ${entry.entry_code} và ${lines.length} dòng chi tiết sẽ bị xóa vĩnh viễn.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      {/* Print-only section */}
      <div className="print-only">
        <div className="p-8">
          <h1 className="text-2xl font-black text-center uppercase mb-6">
            {entry.type === "export" ? "Phiếu xuất kho" : entry.type === "import" ? "Phiếu nhập kho" : entry.type === "transfer" ? "Phiếu chuyển kho" : "Phiếu kiểm kê"}
          </h1>

          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <p><span className="text-gray-500">Mã phiếu:</span> <span className="font-bold font-mono">{entry.entry_code}</span></p>
              <p><span className="text-gray-500">Ngày tạo:</span> <span className="font-semibold">{formatDate(entry.created_at)}</span></p>
            </div>
            <div>
              <p><span className="text-gray-500">Người lập:</span> <span className="font-semibold">{entry.creator?.full_name || "-"}</span></p>
              {entry.notes && <p><span className="text-gray-500">Ghi chú:</span> {entry.notes}</p>}
            </div>
          </div>

          <table className="w-full text-sm border-collapse mb-8">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="py-2 text-left font-bold w-12">STT</th>
                <th className="py-2 text-left font-bold">Sản phẩm</th>
                <th className="py-2 text-left font-bold w-24">SKU</th>
                <th className="py-2 text-center font-bold w-16">ĐVT</th>
                <th className="py-2 text-right font-bold w-20">Số lượng</th>
                <th className="py-2 text-left font-bold w-28">Lô hàng</th>
                <th className="py-2 text-left font-bold">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id} className="border-b border-gray-200">
                  <td className="py-2">{index + 1}</td>
                  <td className="py-2 font-medium">{line.product?.name || "-"}</td>
                  <td className="py-2 font-mono text-xs">{line.product?.sku || "-"}</td>
                  <td className="py-2 text-center">{line.unit_name}</td>
                  <td className="py-2 text-right font-bold">{line.quantity}</td>
                  <td className="py-2 text-xs">{line.batch?.batch_code || "-"}</td>
                  <td className="py-2 text-xs">{line.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300">
                <td colSpan={4} className="py-2 text-right font-bold">Tổng cộng:</td>
                <td className="py-2 text-right font-black">{totalQty}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>

          <div className="grid grid-cols-3 gap-8 text-center text-sm mt-16">
            <div>
              <p className="font-bold">Người lập phiếu</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
            </div>
            <div>
              <p className="font-bold">Thủ kho</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
            </div>
            <div>
              <p className="font-bold">Người nhận</p>
              <p className="text-xs text-gray-500 mb-20">(Ký, ghi rõ họ tên)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
