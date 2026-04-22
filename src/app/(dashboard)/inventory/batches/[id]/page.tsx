"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { Pencil, Trash2, X, Save } from "lucide-react"
import type { Batch, Product, StockEntryLine } from "@/types"

const EXPIRY_LABEL: Record<"ok" | "warning" | "danger", string> = {
  ok: "Còn hạn dài",
  warning: "Sắp hết hạn",
  danger: "Cận date / hết hạn",
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [batch, setBatch] = useState<(Batch & { product?: Product }) | null>(null)
  const [entryLines, setEntryLines] = useState<StockEntryLine[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    batch_code: "",
    manufactured_at: "",
    expires_at: "",
    location: "",
    qty_on_hand: 0,
    unit_cost: 0,
  })
  const [actionLoading, setActionLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [batchRes, linesRes] = await Promise.all([
      supabase.from("batches").select("*, product:products(*)").eq("id", id).single(),
      supabase
        .from("stock_entry_lines")
        .select("*, entry:stock_entries(entry_code, type, created_at, creator:users!stock_entries_created_by_fkey(full_name))")
        .eq("batch_id", id),
    ])
    if (batchRes.data) {
      const b = batchRes.data as Batch & { product?: Product }
      setBatch(b)
      setEditForm({
        batch_code: b.batch_code,
        manufactured_at: b.manufactured_at ? b.manufactured_at.slice(0, 10) : "",
        expires_at: b.expires_at ? b.expires_at.slice(0, 10) : "",
        location: b.location || "",
        qty_on_hand: b.qty_on_hand,
        unit_cost: Number(b.unit_cost) || 0,
      })
    }
    setEntryLines((linesRes.data as StockEntryLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleSaveEdit = async () => {
    if (!batch) return
    if (!editForm.batch_code.trim() || !editForm.expires_at) {
      toast({ title: "Vui lòng nhập đầy đủ mã lô và HSD", variant: "destructive" })
      return
    }
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("batches")
        .update({
          batch_code: editForm.batch_code.trim(),
          manufactured_at: editForm.manufactured_at || null,
          expires_at: editForm.expires_at,
          location: editForm.location.trim() || null,
          qty_on_hand: Number(editForm.qty_on_hand),
          unit_cost: Number(editForm.unit_cost) || 0,
        })
        .eq("id", batch.id)
      if (error) throw error
      toast({ title: "Đã cập nhật lô hàng" })
      setEditMode(false)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!batch) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("batches").delete().eq("id", batch.id)
      if (error) throw error
      toast({ title: "Đã xóa lô hàng" })
      router.push("/inventory/batches")
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!batch) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy lô hàng</div>

  const expiryStatus = getExpiryStatus(batch.expires_at, batch.product?.shelf_life_days ?? undefined)
  const expiryVariant: "success" | "warning" | "danger" =
    expiryStatus === "danger" ? "danger" : expiryStatus === "warning" ? "warning" : "success"

  const canEdit = user && hasPermission(user.role, "inventory", "update") && ["warehouse", "owner"].includes(user.role)
  const canDelete =
    user &&
    ["warehouse", "owner"].includes(user.role) &&
    hasPermission(user.role, "inventory", "delete") &&
    entryLines.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title={batch.batch_code}
        description={`Lô của ${batch.product?.name || "sản phẩm"}${batch.product?.sku ? ` (SKU: ${batch.product.sku})` : ""}`}
        backHref="/inventory/batches"
      >
        <Badge variant={expiryVariant}>{EXPIRY_LABEL[expiryStatus]}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - batch fields + stock entries */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin lô hàng</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    batch_code: batch.batch_code,
                    manufactured_at: batch.manufactured_at ? batch.manufactured_at.slice(0, 10) : "",
                    expires_at: batch.expires_at ? batch.expires_at.slice(0, 10) : "",
                    location: batch.location || "",
                    qty_on_hand: batch.qty_on_hand,
                    unit_cost: Number(batch.unit_cost) || 0,
                  })
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!editMode ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mã lô</Label>
                    <p className="font-mono font-semibold">{batch.batch_code}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vị trí kho</Label>
                    <p className="font-semibold">{batch.location || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày sản xuất</Label>
                    <p className="font-semibold">{batch.manufactured_at ? formatDate(batch.manufactured_at) : "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hạn sử dụng</Label>
                    <p className="font-semibold">{formatDate(batch.expires_at)}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">SL ban đầu</Label>
                    <p className="font-semibold">{batch.qty_initial}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tồn hiện tại</Label>
                    <p className="font-semibold text-lg">{batch.qty_on_hand}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Trạng thái</Label>
                    <p className="font-semibold">{batch.status || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tạo ngày</Label>
                    <p className="font-semibold">{formatDate(batch.created_at)}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Mã lô *</Label>
                      <Input
                        value={editForm.batch_code}
                        onChange={(e) => setEditForm({ ...editForm, batch_code: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Vị trí kho</Label>
                      <Input
                        value={editForm.location}
                        onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                        placeholder="vd: T2-K3-05"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Ngày sản xuất</Label>
                      <Input
                        type="date"
                        value={editForm.manufactured_at}
                        onChange={(e) => setEditForm({ ...editForm, manufactured_at: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hạn sử dụng *</Label>
                      <Input
                        type="date"
                        value={editForm.expires_at}
                        onChange={(e) => setEditForm({ ...editForm, expires_at: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tồn hiện tại</Label>
                      <Input
                        type="number"
                        min={0}
                        value={editForm.qty_on_hand}
                        onChange={(e) => setEditForm({ ...editForm, qty_on_hand: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Giá vốn (trên ĐVT cơ bản)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={editForm.unit_cost}
                        onChange={(e) => setEditForm({ ...editForm, unit_cost: Number(e.target.value) })}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full sm:w-auto">
                    <Save className="h-4 w-4 mr-2" />
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stock entries referencing this batch */}
          <Card>
            <CardHeader>
              <CardTitle>Phiếu kho liên quan ({entryLines.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã phiếu</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead>ĐVT</TableHead>
                    <TableHead>Ngày</TableHead>
                    <TableHead>Người tạo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entryLines.map((line) => {
                    const entry = (line as StockEntryLine & { entry?: { entry_code: string; type: string; created_at: string; creator?: { full_name: string } } }).entry
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">{entry?.entry_code || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{entry?.type || "-"}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{line.quantity}</TableCell>
                        <TableCell>{line.unit_name}</TableCell>
                        <TableCell>{entry?.created_at ? formatDate(entry.created_at) : "-"}</TableCell>
                        <TableCell>{entry?.creator?.full_name || "-"}</TableCell>
                      </TableRow>
                    )
                  })}
                  {entryLines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Chưa có phiếu kho liên quan
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Right - product info + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Sản phẩm</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-bold">{batch.product?.name || "-"}</p>
              {batch.product?.sku && (
                <p className="text-muted-foreground">SKU: <span className="font-mono">{batch.product.sku}</span></p>
              )}
              {batch.product?.brand && (
                <p>
                  <span className="text-muted-foreground">Thương hiệu: </span>
                  <span className="font-semibold">{batch.product.brand}</span>
                </p>
              )}
              {batch.product?.category && (
                <p>
                  <span className="text-muted-foreground">Danh mục: </span>
                  <span className="font-semibold">{batch.product.category}</span>
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Đơn vị cơ sở: </span>
                <span className="font-semibold">{batch.product?.base_unit || "-"}</span>
              </p>
              {batch.product?.shelf_life_days != null && (
                <p>
                  <span className="text-muted-foreground">Thời hạn (ngày): </span>
                  <span className="font-semibold">{batch.product.shelf_life_days}</span>
                </p>
              )}
              {batch.product_id && (
                <Link
                  href={`/products/${batch.product_id}`}
                  className="inline-block pt-2 text-primary text-xs font-bold hover:underline"
                >
                  Xem chi tiết sản phẩm →
                </Link>
              )}
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
                  <Trash2 className="h-4 w-4 mr-2" /> Xóa lô hàng
                </Button>
              </CardContent>
            </Card>
          )}
          {!canDelete && entryLines.length > 0 && user && ["warehouse", "owner"].includes(user.role) && (
            <p className="text-xs text-center text-muted-foreground">
              Không thể xóa lô đã có phiếu kho liên quan
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn lô hàng?"
        description={`Lô ${batch.batch_code} sẽ bị xóa khỏi hệ thống. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
