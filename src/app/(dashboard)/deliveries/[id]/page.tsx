"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import { formatDate } from "@/lib/utils"
import { ensureReceivableForOrder } from "@/lib/receivables"
import {
  Camera, PenTool, Play, CheckCircle2, XCircle, Pencil, Trash2, X,
  CheckCheck, AlertCircle, ClipboardCheck,
} from "lucide-react"
import type { Delivery, DeliveryLine, DeliveryPaymentMethod, DeliveryStatus, User } from "@/types"

type NextStatus = {
  value: DeliveryStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

const DELIVERY_FLOW: Record<DeliveryStatus, NextStatus[]> = {
  pending: [
    { value: "in_transit", label: "Bắt đầu giao", icon: Play, roles: ["owner", "manager", "warehouse", "driver"] },
    { value: "cancelled", label: "Hủy chuyến", icon: XCircle, roles: ["owner", "manager"] },
  ],
  in_transit: [
    { value: "completed", label: "Hoàn tất chuyến", icon: CheckCircle2, roles: ["owner", "manager", "driver"] },
    { value: "cancelled", label: "Hủy chuyến", icon: XCircle, roles: ["owner", "manager"] },
  ],
  completed: [],
  cancelled: [],
}

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("deliveries")
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [lines, setLines] = useState<DeliveryLine[]>([])
  const [drivers, setDrivers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{ status: DeliveryStatus; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ driver_id: "", vehicle: "", route_name: "" })
  const [lineNoteMap, setLineNoteMap] = useState<Record<string, string>>({})
  const [linePaymentMethodMap, setLinePaymentMethodMap] = useState<Record<string, DeliveryPaymentMethod>>({})
  const [lineAmountCollectedMap, setLineAmountCollectedMap] = useState<Record<string, string>>({})
  const [handoffLoading, setHandoffLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [delRes, linesRes, driversRes] = await Promise.all([
      supabase.from("deliveries").select("*, driver:users!deliveries_driver_id_fkey(*), warehouse_confirmer:users!deliveries_warehouse_confirmed_by_fkey(*), driver_confirmer:users!deliveries_driver_confirmed_by_fkey(*)").eq("id", id).single(),
      supabase.from("delivery_lines").select("*, order:sales_orders(order_code, total, customer:customers(store_name, phone, address))").eq("delivery_id", id),
      supabase.from("users").select("*").eq("role", "driver").eq("is_active", true).order("full_name"),
    ])
    if (delRes.data) {
      const d = delRes.data as Delivery
      setDelivery(d)
      setEditForm({
        driver_id: d.driver_id || "",
        vehicle: d.vehicle || "",
        route_name: d.route_name || "",
      })
    }
    setLines((linesRes.data as DeliveryLine[]) || [])
    setDrivers((driversRes.data as User[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const handleChangeStatus = async (newStatus: DeliveryStatus) => {
    if (!delivery) return
    if (newStatus === "in_transit" && (!delivery.warehouse_confirmed_at || !delivery.driver_confirmed_at)) {
      toast({ title: "Chưa hoàn tất bàn giao", description: "Kho và tài xế đều phải xác nhận trước khi bắt đầu giao.", variant: "destructive" })
      setConfirmOpen(null)
      return
    }
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === "in_transit") {
        updates.started_at = new Date().toISOString()
      } else if (newStatus === "completed") {
        updates.completed_at = new Date().toISOString()
      }
      const { error } = await supabase.from("deliveries").update(updates).eq("id", delivery.id)
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
    if (!delivery) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("deliveries").delete().eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Đã xóa phiếu giao" })
      router.push("/deliveries")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!delivery) return
    setActionLoading(true)
    try {
      const { error } = await supabase.from("deliveries").update({
        driver_id: editForm.driver_id || null,
        vehicle: editForm.vehicle || null,
        route_name: editForm.route_name || null,
      }).eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Đã cập nhật phiếu giao" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleWarehouseConfirm = async () => {
    if (!delivery || !user) return
    setHandoffLoading(true)
    try {
      const { error } = await supabase.from("deliveries").update({
        warehouse_confirmed_by: user.id,
        warehouse_confirmed_at: new Date().toISOString(),
      }).eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Kho đã xác nhận xuất hàng" })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setHandoffLoading(false)
    }
  }

  const handleDriverConfirm = async () => {
    if (!delivery || !user) return
    setHandoffLoading(true)
    try {
      const { error } = await supabase.from("deliveries").update({
        driver_confirmed_by: user.id,
        driver_confirmed_at: new Date().toISOString(),
      }).eq("id", delivery.id)
      if (error) throw error
      toast({ title: "Tài xế đã xác nhận nhận hàng" })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setHandoffLoading(false)
    }
  }

  const handleLineAction = async (lineId: string, newStatus: "delivered" | "failed") => {
    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = {
        status: newStatus,
        delivered_at: new Date().toISOString(),
      }
      if (lineNoteMap[lineId]) {
        updates.notes = lineNoteMap[lineId]
      }
      if (linePaymentMethodMap[lineId]) {
        updates.payment_method = linePaymentMethodMap[lineId]
      }
      const collected = parseFloat(lineAmountCollectedMap[lineId] || "0")
      if (collected > 0) {
        updates.amount_collected = collected
      }
      const { error } = await supabase.from("delivery_lines").update(updates).eq("id", lineId)
      if (error) throw error

      // If delivered successfully, also mark the sales_order as delivered
      // and auto-create receivable
      if (newStatus === "delivered") {
        const line = lines.find((l) => l.id === lineId)
        if (line?.order_id) {
          await supabase.from("sales_orders").update({ status: "delivered" }).eq("id", line.order_id)
          await ensureReceivableForOrder(supabase, line.order_id)
        }
      }
      toast({ title: newStatus === "delivered" ? "Đã xác nhận giao hàng + công nợ" : "Đã đánh dấu giao thất bại" })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveLine = async (lineId: string) => {
    if (!confirm("Xóa đơn này khỏi chuyến giao?")) return
    const { error } = await supabase.from("delivery_lines").delete().eq("id", lineId)
    if (error) {
      toast({ title: "Lỗi", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Đã xóa khỏi chuyến giao" })
    fetchData()
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!delivery) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy chuyến giao</div>

  const statusConfig = DELIVERY_STATUS_MAP[delivery.status] || { label: delivery.status, variant: "outline" as const }
  const availableTransitions = DELIVERY_FLOW[delivery.status] || []
  const canEdit = user && hasPermission(user.role, "deliveries", "update") && delivery.status === "pending"
  const canDelete = user && hasPermission(user.role, "deliveries", "delete") && ["pending", "cancelled"].includes(delivery.status)
  const canMarkLines = user && ["owner", "manager", "driver", "warehouse"].includes(user.role) && delivery.status === "in_transit"

  return (
    <div className="space-y-4">
      <PageHeader
        title={delivery.route_name || "Chi tiết chuyến giao"}
        description={`Tạo: ${formatDate(delivery.created_at)}${delivery.started_at ? ` • Xuất phát: ${formatDate(delivery.started_at)}` : ""}${delivery.completed_at ? ` • Hoàn tất: ${formatDate(delivery.completed_at)}` : ""}`}
        backHref="/deliveries"
      >
        <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left - lines */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Danh sách đơn hàng ({lines.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>POD</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const lineStatusLabel = line.status === "delivered" ? "Đã giao" :
                    line.status === "failed" ? "Thất bại" :
                    line.status === "partial" ? "Giao 1 phần" : "Chờ giao"
                  const lineStatusVariant: "success" | "danger" | "warning" | "secondary" =
                    line.status === "delivered" ? "success" :
                    line.status === "failed" ? "danger" :
                    line.status === "partial" ? "warning" : "secondary"
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <Link
                          href={`/orders/${line.order_id}`}
                          className="font-mono text-xs text-primary font-bold hover:underline"
                        >
                          {line.order?.order_code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium text-sm">{line.order?.customer?.store_name}</p>
                          <p className="text-xs text-muted-foreground">{line.order?.customer?.phone}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={lineStatusVariant}>{lineStatusLabel}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {line.pod_photo_url && (
                            <span title="Đã chụp ảnh POD">
                              <Camera className="h-4 w-4 text-green-600" />
                            </span>
                          )}
                          {line.pod_signature && (
                            <span title="Đã có chữ ký">
                              <PenTool className="h-4 w-4 text-green-600" />
                            </span>
                          )}
                          {!line.pod_photo_url && !line.pod_signature && line.status === "pending" && (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {canMarkLines && line.status === "pending" ? (
                          <div className="flex gap-1 justify-end flex-wrap">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/deliveries/${delivery.id}/pod/${line.id}`}>
                                <ClipboardCheck className="h-3 w-3 mr-1" /> Xác nhận POD
                              </Link>
                            </Button>
                            <Button size="sm" onClick={() => handleLineAction(line.id, "delivered")} disabled={actionLoading}>
                              <CheckCheck className="h-3 w-3 mr-1" /> Giao OK
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleLineAction(line.id, "failed")} disabled={actionLoading}>
                              <AlertCircle className="h-3 w-3 mr-1" /> Thất bại
                            </Button>
                          </div>
                        ) : line.status === "pending" ? (
                          user && ["owner", "manager"].includes(user.role) && delivery.status === "pending" && (
                            <Button size="sm" variant="ghost" onClick={() => handleRemoveLine(line.id)}>
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          )
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      Chưa có đơn hàng trong chuyến giao này
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Right - info + actions */}
        <div className="space-y-4">
          {/* Info card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin chuyến</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    driver_id: delivery.driver_id || "",
                    vehicle: delivery.vehicle || "",
                    route_name: delivery.route_name || "",
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
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tuyến</Label>
                    <p className="font-semibold">{delivery.route_name || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tài xế</Label>
                    <p className="font-semibold">{delivery.driver?.full_name || "Chưa gán"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phương tiện</Label>
                    <p className="font-semibold">{delivery.vehicle || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tổng đơn</Label>
                    <p className="font-semibold">{lines.length} đơn</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Tên tuyến</Label>
                    <Input value={editForm.route_name} onChange={(e) => setEditForm({ ...editForm, route_name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tài xế</Label>
                    <Select value={editForm.driver_id || "_none"} onValueChange={(v) => setEditForm({ ...editForm, driver_id: v === "_none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Chọn tài xế" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Chưa gán</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phương tiện</Label>
                    <Input value={editForm.vehicle} onChange={(e) => setEditForm({ ...editForm, vehicle: e.target.value })} placeholder="vd: 51A-12345" />
                  </div>
                  <Button onClick={handleSaveEdit} disabled={actionLoading} className="w-full">
                    {actionLoading ? "Đang lưu..." : "Lưu thay đổi"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Handoff card */}
          {delivery.status === "pending" || (delivery.warehouse_confirmed_at && delivery.driver_confirmed_at) ? (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Bàn giao</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {delivery.warehouse_confirmed_at && delivery.driver_confirmed_at ? (
                  <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg p-3">
                    <CheckCircle2 className="h-5 w-5" />
                    <div>
                      <p className="font-semibold">Đã bàn giao</p>
                      <p className="text-xs text-green-600">Kho: {formatDate(delivery.warehouse_confirmed_at)}</p>
                      <p className="text-xs text-green-600">Tài xế: {formatDate(delivery.driver_confirmed_at)}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kho xuất hàng</Label>
                      {delivery.warehouse_confirmed_at ? (
                        <p className="text-green-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Đã xác nhận ({formatDate(delivery.warehouse_confirmed_at)})
                        </p>
                      ) : user && ["warehouse", "owner"].includes(user.role) ? (
                        <Button size="sm" className="w-full" onClick={handleWarehouseConfirm} disabled={handoffLoading}>
                          {handoffLoading ? "Đang xử lý..." : "Kho xác nhận xuất"}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground">Chờ kho xác nhận</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tài xế nhận hàng</Label>
                      {delivery.driver_confirmed_at ? (
                        <p className="text-green-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Đã xác nhận ({formatDate(delivery.driver_confirmed_at)})
                        </p>
                      ) : !delivery.warehouse_confirmed_at ? (
                        <p className="text-muted-foreground">Chờ kho xác nhận trước</p>
                      ) : user && ["driver", "owner"].includes(user.role) ? (
                        <Button size="sm" className="w-full" onClick={handleDriverConfirm} disabled={handoffLoading}>
                          {handoffLoading ? "Đang xử lý..." : "Tài xế xác nhận nhận hàng"}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground">Chờ tài xế xác nhận</p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Status actions */}
          {(availableTransitions.length > 0 || canDelete) && (
            <Card>
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {availableTransitions.map((trans) => {
                  if (!user || !trans.roles.includes(user.role)) return null
                  const Icon = trans.icon
                  const isDestructive = trans.value === "cancelled"
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
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa phiếu giao
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Payment + Notes for line during transit */}
          {canMarkLines && lines.some((l) => l.status === "pending") && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Thu tiền & ghi chú</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Chọn hình thức thu tiền và ghi chú cho từng đơn trước khi bấm &quot;Giao OK&quot;.
                </p>
                {lines.filter((l) => l.status === "pending").map((line) => (
                  <div key={line.id} className="space-y-2 border-b border-border/40 pb-3 last:border-0">
                    <Label className="text-xs font-bold">{line.order?.order_code}</Label>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Hình thức thu</Label>
                      <Select
                        value={linePaymentMethodMap[line.id] || "_none"}
                        onValueChange={(v) => setLinePaymentMethodMap({ ...linePaymentMethodMap, [line.id]: v === "_none" ? undefined as unknown as DeliveryPaymentMethod : v as DeliveryPaymentMethod })}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="Chọn" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">-- Chọn --</SelectItem>
                          <SelectItem value="cod_cash">COD tiền mặt</SelectItem>
                          <SelectItem value="cod_transfer">COD chuyển khoản</SelectItem>
                          <SelectItem value="credit">Công nợ</SelectItem>
                          <SelectItem value="partial">Thanh toán 1 phần</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {linePaymentMethodMap[line.id] && linePaymentMethodMap[line.id] !== "credit" && (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Số tiền thu</Label>
                        <Input
                          type="number"
                          className="h-9"
                          placeholder="0"
                          value={lineAmountCollectedMap[line.id] || ""}
                          onChange={(e) => setLineAmountCollectedMap({ ...lineAmountCollectedMap, [line.id]: e.target.value })}
                        />
                      </div>
                    )}
                    <Textarea
                      rows={2}
                      placeholder="vd: Khách vắng, hẹn giao lại sáng mai"
                      value={lineNoteMap[line.id] || ""}
                      onChange={(e) => setLineNoteMap({ ...lineNoteMap, [line.id]: e.target.value })}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho chuyến ${delivery.route_name || "này"}`}
        variant={confirmOpen?.status === "cancelled" ? "destructive" : "default"}
        onConfirm={() => confirmOpen && handleChangeStatus(confirmOpen.status)}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn phiếu giao?"
        description={`Phiếu giao này sẽ bị xóa cùng toàn bộ dữ liệu liên quan. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  )
}
