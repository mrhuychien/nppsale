"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { Pencil, Trash2, X, ExternalLink, Info } from "lucide-react"
import type { Return, ReturnLine } from "@/types"

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("returns")
  const [ret, setRet] = useState<Return | null>(null)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ notes: "", credit_note_amount: "" })
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [retRes, linesRes] = await Promise.all([
      supabase
        .from("returns")
        .select("*, customer:customers(*), requester:users!returns_requested_by_fkey(*), approver:users!returns_approved_by_fkey(*), order:sales_orders(order_code)")
        .eq("id", id)
        .single(),
      supabase.from("return_lines").select("*, product:products(*)").eq("return_id", id),
    ])
    if (retRes.data) {
      const r = retRes.data as Return
      setRet(r)
      setEditForm({
        notes: r.notes || "",
        credit_note_amount: r.credit_note_amount != null ? String(r.credit_note_amount) : "",
      })
    }
    setLines((linesRes.data as ReturnLine[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleDelete = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("returns").delete().eq("id", ret.id)
      if (error) throw error
      toast({ title: "Đã xoá phiếu trả hàng" })
      router.push("/returns")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      const { error } = await supabase
        .from("returns")
        .update({
          notes: editForm.notes || null,
          credit_note_amount: editForm.credit_note_amount ? parseFloat(editForm.credit_note_amount) : null,
        })
        .eq("id", ret.id)
      if (error) throw error
      toast({ title: "Đã cập nhật phiếu trả hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!ret) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy phiếu trả hàng</div>

  const reasonLabel = RETURN_REASONS.find((r) => r.value === ret.reason)?.label || ret.reason || "—"
  const orderCode = (ret as Return & { order?: { order_code?: string } }).order?.order_code
  // Phiếu trả giờ chỉ là bản ghi tra cứu — không còn workflow duyệt.
  // Cho phép sửa ghi chú / credit note + (owner) xoá.
  const canEdit = !!user && hasPermission(user.role, "returns", "update")
  const canDelete = !!user && user.role === "owner"

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phiếu trả — ${ret.customer?.store_name || "N/A"}`}
        description={`Tạo: ${formatDate(ret.created_at)} • Lý do: ${reasonLabel}`}
        backHref="/returns"
      >
        <StatusBadge status={ret.status} type="return" />
      </PageHeader>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-3 text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-primary">
            Phiếu trả là bản ghi tra cứu. Việc nhập lại kho + trừ công nợ đã
            được xử lý ngay ở bước Bàn giao lại từ lái xe — không cần duyệt
            ở đây.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details + lines */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lines */}
          <Card>
            <CardHeader><CardTitle>Chi tiết hàng trả</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loại</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>ĐVT</TableHead>
                      <TableHead className="text-right tabular-nums">SL</TableHead>
                      <TableHead className="text-right tabular-nums">Đơn giá</TableHead>
                      <TableHead className="text-right tabular-nums">VAT</TableHead>
                      <TableHead className="text-right tabular-nums">Thành tiền</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const isExchange = !!(line as { is_exchange?: boolean | null }).is_exchange
                      return (
                        <TableRow key={line.id} className={isExchange ? "bg-[#eff8ff]/40" : undefined}>
                          <TableCell>
                            {isExchange ? (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40">
                                ĐỔI
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fff4ed] text-[#b54708] border border-[#fdb022]/40">
                                TRẢ
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{line.product?.name || "—"}</TableCell>
                          <TableCell>{line.unit_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(line.unit_price)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {Math.round((line.vat_rate ?? 0) * 100)}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {isExchange ? (
                              <span className="text-[#175cd3] italic">không trừ tiền</span>
                            ) : (
                              formatCurrency(line.line_total)
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          Chưa có sản phẩm trả
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {(() => {
                const refundT = lines
                  .filter((l) => !(l as { is_exchange?: boolean | null }).is_exchange)
                  .reduce((s, l) => s + Number(l.line_total || 0), 0)
                const exchangeT = lines
                  .filter((l) => (l as { is_exchange?: boolean | null }).is_exchange)
                  .reduce((s, l) => s + Number(l.line_total || 0), 0)
                if (lines.length === 0 && ret.credit_note_amount == null) return null
                return (
                  <div className="mt-4 text-right border-t border-border/40 pt-4 space-y-1">
                    {refundT > 0 && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Trả trừ công nợ:</span>{" "}
                        <span className="font-semibold">{formatCurrency(refundT)}</span>
                      </p>
                    )}
                    {exchangeT > 0 && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Đổi (không trừ công nợ):</span>{" "}
                        <span className="font-semibold text-[#175cd3]">
                          {formatCurrency(exchangeT)}
                        </span>
                      </p>
                    )}
                    <p className="text-lg font-black">
                      Credit Note: {formatCurrency(ret.credit_note_amount ?? refundT)}
                    </p>
                    {refundT > 0 && exchangeT > 0 && (
                      <p className="text-[11px] italic text-muted-foreground">
                        * Chỉ phần TRẢ trừ công nợ; phần ĐỔI thu về kho mà không động đến tiền.
                      </p>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin phiếu trả</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    notes: ret.notes || "",
                    credit_note_amount: ret.credit_note_amount != null ? String(ret.credit_note_amount) : "",
                  })
                }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!editMode ? (
                <>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Credit Note</Label>
                    <p className="font-semibold">
                      {ret.credit_note_amount != null ? formatCurrency(ret.credit_note_amount) : <span className="text-muted-foreground">Chưa xác định</span>}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <p className="whitespace-pre-wrap">{ret.notes || <span className="text-muted-foreground">Không có</span>}</p>
                  </div>
                  {ret.photo_url && (
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hình ảnh</Label>
                      <Link href={ret.photo_url} target="_blank" className="block text-primary hover:underline">
                        Xem ảnh đính kèm
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Credit Note (VND)</Label>
                    <Input
                      type="number"
                      value={editForm.credit_note_amount}
                      onChange={(e) => setEditForm({ ...editForm, credit_note_amount: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column - customer + links */}
        <div className="space-y-4">
          {/* Customer info */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{ret.customer?.store_name || "—"}</p>
              <p className="text-muted-foreground">{ret.customer?.owner_name}</p>
              <p>{ret.customer?.phone}</p>
              <p className="text-muted-foreground">{ret.customer?.address}</p>
            </CardContent>
          </Card>

          {/* Links */}
          <Card>
            <CardHeader><CardTitle>Liên kết</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ret.order_id && (
                <Link
                  href={`/orders/${ret.order_id}`}
                  className="flex items-center gap-2 text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  Đơn hàng gốc {orderCode ? `(${orderCode})` : ""}
                </Link>
              )}
              <div className="pt-2 border-t border-border/40">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người tạo</Label>
                <p>{ret.requester?.full_name || "—"}</p>
              </div>
              {ret.approver && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người xử lý</Label>
                  <p>{ret.approver.full_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin: delete only */}
          {canDelete && (
            <Card>
              <CardHeader><CardTitle>Thao tác quản trị</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Xoá phiếu trả
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá vĩnh viễn phiếu trả hàng?"
        description="Phiếu trả này sẽ bị xoá cùng toàn bộ chi tiết. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xoá vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
