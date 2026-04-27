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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { DELIVERY_STATUS_MAP } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ensureReceivableForOrder } from "@/lib/receivables"
import {
  Camera, PenTool, Play, CheckCircle2, XCircle, Pencil, Trash2, X,
  CheckCheck, AlertCircle, ClipboardCheck, PackageCheck, Wallet,
  Eye, Banknote,
} from "lucide-react"
import type { Delivery, DeliveryLine, DeliveryPaymentMethod, DeliveryStatus, SalesOrder, SalesOrderLine, User } from "@/types"

type OrderDetail = SalesOrder & {
  customer?: SalesOrder["customer"] & { address?: string | null; ward?: string | null; district?: string | null; province?: string | null }
  lines?: (SalesOrderLine & { product?: { name?: string; sku?: string; base_unit?: string } })[]
}

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
  const [handoffLoading, setHandoffLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const [orderDetailOpen, setOrderDetailOpen] = useState(false)
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null)
  const [orderDetailLoading, setOrderDetailLoading] = useState(false)

  const [collectOpen, setCollectOpen] = useState(false)
  const [collectLine, setCollectLine] = useState<DeliveryLine | null>(null)
  const [collectMethod, setCollectMethod] = useState<DeliveryPaymentMethod | "">("")
  const [collectAmount, setCollectAmount] = useState<string>("")
  const [collectNote, setCollectNote] = useState<string>("")
  const [collectSaving, setCollectSaving] = useState(false)

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
      if (newStatus === "completed") {
        router.push(`/deliveries/${delivery.id}/settle`)
        return
      }
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

  const openOrderDetail = async (orderId: string) => {
    setOrderDetailOpen(true)
    setOrderDetail(null)
    setOrderDetailLoading(true)
    try {
      const { data } = await supabase
        .from("sales_orders")
        .select(
          "*, customer:customers(*), lines:sales_order_lines(*, product:products(name, sku, base_unit))"
        )
        .eq("id", orderId)
        .single()
      setOrderDetail((data as unknown as OrderDetail) || null)
    } finally {
      setOrderDetailLoading(false)
    }
  }

  const openCollect = (line: DeliveryLine) => {
    setCollectLine(line)
    setCollectMethod((line.payment_method as DeliveryPaymentMethod) || "cod_cash")
    setCollectAmount(
      line.amount_collected != null && Number(line.amount_collected) > 0
        ? String(line.amount_collected)
        : String(line.order?.total ?? "")
    )
    setCollectNote(line.notes || "")
    setCollectOpen(true)
  }

  const handleSaveCollect = async () => {
    if (!collectLine) return
    setCollectSaving(true)
    try {
      const updates: Record<string, unknown> = {}
      if (collectMethod) updates.payment_method = collectMethod
      const amt = parseFloat(collectAmount || "0")
      if (!Number.isNaN(amt) && amt >= 0) updates.amount_collected = amt
      if (collectNote.trim() !== "") updates.notes = collectNote.trim()
      if (Object.keys(updates).length === 0) {
        setCollectOpen(false)
        return
      }
      const { error } = await supabase
        .from("delivery_lines")
        .update(updates)
        .eq("id", collectLine.id)
      if (error) throw error
      toast({ title: "Đã lưu thu tiền" })
      setCollectOpen(false)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: (err as Error).message, variant: "destructive" })
    } finally {
      setCollectSaving(false)
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
                        <div className="flex gap-1 justify-end flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => openOrderDetail(line.order_id)} title="Xem chi tiết đơn">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {canMarkLines && line.status === "pending" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openCollect(line)}>
                                <Banknote className="h-3 w-3 mr-1" />
                                {line.amount_collected != null && Number(line.amount_collected) > 0 ? "Sửa thu tiền" : "Thu tiền"}
                              </Button>
                              <Button size="sm" variant="outline" asChild>
                                <Link href={`/deliveries/${delivery.id}/pod/${line.id}`}>
                                  <ClipboardCheck className="h-3 w-3 mr-1" /> POD
                                </Link>
                              </Button>
                              <Button size="sm" onClick={() => handleLineAction(line.id, "delivered")} disabled={actionLoading}>
                                <CheckCheck className="h-3 w-3 mr-1" /> Giao OK
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleLineAction(line.id, "failed")} disabled={actionLoading}>
                                <AlertCircle className="h-3 w-3 mr-1" /> Thất bại
                              </Button>
                            </>
                          )}
                          {line.status === "pending" &&
                            user && ["owner", "manager"].includes(user.role) &&
                            delivery.status === "pending" && (
                              <Button size="sm" variant="ghost" onClick={() => handleRemoveLine(line.id)} title="Xóa khỏi chuyến">
                                <X className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                        </div>
                        {line.amount_collected != null && Number(line.amount_collected) > 0 && (
                          <p className="text-[10px] text-emerald-700 font-semibold mt-1">
                            Đã thu: {formatCurrency(Number(line.amount_collected))}
                          </p>
                        )}
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
          {delivery.status === "completed" && (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
                  <Wallet className="h-5 w-5" />
                  Quyết toán chuyến giao
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Tài xế nộp tiền thu được. Hệ thống sẽ kiểm khớp với tổng đơn COD.
                </p>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full h-11">
                  <Link href={`/deliveries/${delivery.id}/settle`}>
                    <Wallet className="h-4 w-4 mr-2" /> Vào màn hình trả tiền
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

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
              <CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Bàn giao</CardTitle></CardHeader>
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

        </div>
      </div>

      {/* Order detail modal */}
      <Dialog open={orderDetailOpen} onOpenChange={setOrderDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {orderDetail ? `Đơn ${orderDetail.order_code}` : "Chi tiết đơn"}
            </DialogTitle>
            {orderDetail && (
              <DialogDescription>
                Khách: {orderDetail.customer?.store_name || "-"}
                {orderDetail.customer?.phone ? ` • ${orderDetail.customer.phone}` : ""}
              </DialogDescription>
            )}
          </DialogHeader>
          {orderDetailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-32" />
            </div>
          ) : orderDetail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Ngày đặt</p>
                  <p className="font-semibold">{formatDate(orderDetail.order_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Hình thức thanh toán</p>
                  <p className="font-semibold">{orderDetail.payment_terms || "COD"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Địa chỉ giao</p>
                  <p className="font-medium">
                    {[orderDetail.customer?.address, orderDetail.customer?.ward, orderDetail.customer?.district, orderDetail.customer?.province]
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </p>
                </div>
                {orderDetail.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Ghi chú đơn</p>
                    <p className="whitespace-pre-wrap">{orderDetail.notes}</p>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold">SKU</th>
                      <th className="text-left px-2 py-2 font-semibold">Sản phẩm</th>
                      <th className="text-center px-2 py-2 font-semibold w-12">ĐVT</th>
                      <th className="text-right px-2 py-2 font-semibold w-12">SL</th>
                      <th className="text-right px-2 py-2 font-semibold w-24">Đơn giá</th>
                      <th className="text-right px-2 py-2 font-semibold w-28">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(orderDetail.lines || []).map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-2 py-1.5 font-mono">{l.product?.sku || "-"}</td>
                        <td className="px-2 py-1.5">{l.product?.name || "-"}</td>
                        <td className="px-2 py-1.5 text-center">{l.unit_name}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{l.quantity}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(Number(l.unit_price || 0))}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(Number(l.line_total || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-6 text-sm border-t pt-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Tạm tính</p>
                  <p className="font-semibold">{formatCurrency(Number(orderDetail.subtotal || 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">VAT</p>
                  <p className="font-semibold">{formatCurrency(Number(orderDetail.vat || 0))}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Tổng tiền</p>
                  <p className="text-lg font-black text-primary">{formatCurrency(Number(orderDetail.total || 0))}</p>
                </div>
              </div>
              <DialogFooter>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/orders/${orderDetail.id}`}>Mở trang đơn</Link>
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Không tìm thấy đơn.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Collect-cash modal */}
      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thu tiền {collectLine?.order?.order_code}</DialogTitle>
            <DialogDescription>
              {collectLine?.order?.customer?.store_name} • Tổng đơn {formatCurrency(Number(collectLine?.order?.total || 0))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Hình thức thu</Label>
              <Select
                value={collectMethod || "_none"}
                onValueChange={(v) => setCollectMethod(v === "_none" ? "" : (v as DeliveryPaymentMethod))}
              >
                <SelectTrigger><SelectValue placeholder="Chọn" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">-- Chọn --</SelectItem>
                  <SelectItem value="cod_cash">COD tiền mặt</SelectItem>
                  <SelectItem value="cod_transfer">COD chuyển khoản</SelectItem>
                  <SelectItem value="credit">Công nợ</SelectItem>
                  <SelectItem value="partial">Thanh toán 1 phần</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Số tiền thu</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ghi chú</Label>
              <Textarea
                rows={2}
                placeholder="vd: Khách thanh toán đủ"
                value={collectNote}
                onChange={(e) => setCollectNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectOpen(false)} disabled={collectSaving}>
              Hủy
            </Button>
            <Button onClick={handleSaveCollect} disabled={collectSaving}>
              {collectSaving ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
