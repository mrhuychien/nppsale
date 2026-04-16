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
import { CheckCircle2, XCircle, Pencil, Trash2, X, ExternalLink, PackageCheck } from "lucide-react"
import type { Return, ReturnLine, ReturnStatus } from "@/types"

type NextStatus = {
  value: ReturnStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

const STATUS_FLOW: Record<ReturnStatus, NextStatus[]> = {
  pending: [
    { value: "approved", label: "Duyệt yêu cầu", icon: CheckCircle2, roles: ["owner", "manager"] },
    { value: "rejected", label: "Từ chối", icon: XCircle, roles: ["owner", "manager"] },
  ],
  approved: [
    { value: "completed", label: "Xác nhận đã nhận hàng", icon: PackageCheck, roles: ["owner", "manager", "warehouse"] },
  ],
  rejected: [],
  completed: [],
}

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("returns")
  const [ret, setRet] = useState<Return | null>(null)
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{ status: ReturnStatus; label: string } | null>(null)
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
        .select("*, customer:customers(*), requester:users!returns_requested_by_fkey(*), approver:users!returns_approved_by_fkey(*)")
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

  const handleChangeStatus = async (newStatus: ReturnStatus) => {
    if (!ret || !user) return
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === "approved") {
        updates.approved_by = user.id
      }
      const { error } = await supabase.from("returns").update(updates).eq("id", ret.id)
      if (error) throw error
      toast({ title: `Đã chuyển trạng thái: ${newStatus}` })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!ret) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("returns").delete().eq("id", ret.id)
      if (error) throw error
      toast({ title: "Đã xóa yêu cầu trả hàng" })
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
      toast({ title: "Đã cập nhật yêu cầu trả hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!ret) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy yêu cầu trả hàng</div>

  const reasonLabel = RETURN_REASONS.find((r) => r.value === ret.reason)?.label || ret.reason || "-"
  const availableTransitions = STATUS_FLOW[ret.status] || []
  const canEdit = user && hasPermission(user.role, "returns", "update") && ret.status === "pending"
  const canDelete = user && user.role === "owner" && ret.status === "pending"

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Trả hàng - ${ret.customer?.store_name || "N/A"}`}
        description={`Tạo: ${formatDate(ret.created_at)} • Lý do: ${reasonLabel}`}
      >
        <StatusBadge status={ret.status} type="return" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details + lines */}
        <div className="lg:col-span-2 space-y-4">
          {/* Lines */}
          <Card>
            <CardHeader><CardTitle>Chi tiết hàng trả</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sản phẩm</TableHead>
                    <TableHead>ĐVT</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead className="text-right">Đơn giá</TableHead>
                    <TableHead className="text-right">Thành tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.product?.name || "-"}</TableCell>
                      <TableCell>{line.unit_name}</TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(line.unit_price)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(line.line_total)}</TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Chưa có sản phẩm trả
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {ret.credit_note_amount != null && (
                <div className="mt-4 text-right border-t border-border/40 pt-4">
                  <p className="text-lg font-black">Credit Note: {formatCurrency(ret.credit_note_amount)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin yêu cầu</CardTitle>
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

        {/* Right column - customer + actions */}
        <div className="space-y-4">
          {/* Customer info */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{ret.customer?.store_name || "-"}</p>
              <p className="text-muted-foreground">{ret.customer?.owner_name}</p>
              <p>{ret.customer?.phone}</p>
              <p className="text-muted-foreground">{ret.customer?.address}</p>
            </CardContent>
          </Card>

          {/* Meta info */}
          <Card>
            <CardHeader><CardTitle>Liên kết</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {ret.order_id && (
                <Link
                  href={`/orders/${ret.order_id}`}
                  className="flex items-center gap-2 text-primary hover:underline font-semibold"
                >
                  <ExternalLink className="h-4 w-4" />
                  Xem đơn hàng gốc
                </Link>
              )}
              <div className="pt-2 border-t border-border/40">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người yêu cầu</Label>
                <p>{ret.requester?.full_name || "-"}</p>
              </div>
              {ret.approver && (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Người duyệt</Label>
                  <p>{ret.approver.full_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status transitions */}
          {(availableTransitions.length > 0 || canDelete) && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {availableTransitions.map((trans) => {
                  if (!user || !trans.roles.includes(user.role)) return null
                  const Icon = trans.icon
                  const isDestructive = trans.value === "rejected"
                  return (
                    <Button
                      key={trans.value}
                      variant={isDestructive ? "destructive" : "default"}
                      className="w-full justify-start"
                      onClick={() => setConfirmOpen({ status: trans.value, label: trans.label })}
                    >
                      <Icon className="h-4 w-4 mr-2" /> {trans.label}
                    </Button>
                  )
                })}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa yêu cầu
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Status change confirm */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho yêu cầu trả hàng này`}
        variant={confirmOpen?.status === "rejected" ? "destructive" : "default"}
        onConfirm={() => confirmOpen && handleChangeStatus(confirmOpen.status)}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn yêu cầu trả hàng?"
        description="Yêu cầu trả hàng này sẽ bị xóa cùng toàn bộ chi tiết. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
