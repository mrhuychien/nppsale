"use client"

import { useEffect, useState, useCallback } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PaymentStatusBadge, StatusBadge } from "@/components/ui/status-badge"
import { ApprovalBadge } from "@/components/orders/approval-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { misaStatusBadge } from "@/lib/misa/labels"
import { viIncludes, viNormalize } from "@/lib/search"
import { ensureReceivableForOrder } from "@/lib/receivables"
import { ORDER_STATUS_MAP, PAYMENT_TERMS } from "@/lib/constants"
import { CheckCircle2, Package2, Truck, CircleCheck, XCircle, Pencil, Trash2, X, CreditCard, ExternalLink, Clock, FileText, RefreshCw, AlertCircle, Lock, Plus, MoreVertical, Phone } from "lucide-react"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  validateOrderEdit,
  isLineLocked,
  type OrderLineChange,
  type WorkflowStage,
} from "@/lib/orders/edit-validator"
import { useEntityLock } from "@/hooks/use-entity-lock"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import type { SalesOrder, SalesOrderLine, OrderStatus, OrderStatusHistory, Invoice } from "@/types"

type NextStatus = {
  value: OrderStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

type DeliveryLineWithDetails = {
  id: string
  status: "pending" | "delivered" | "partial" | "failed"
  pod_photo_url: string | null
  delivered_at: string | null
  notes: string | null
  delivery?: {
    id: string
    route_name: string | null
    driver?: { full_name?: string } | null
    started_at: string | null
    completed_at: string | null
    status: string
  } | null
}

type OrderStockEntry = {
  id: string
  entry_code: string
  type: "import" | "export" | "transfer" | "stocktake"
  status: string
  posted_at: string | null
  created_at: string
  notes: string | null
  creator?: { full_name?: string } | null
  lines?: Array<{
    id: string
    product_id: string
    quantity: number
    unit_name: string
    unit_cost: number
    product?: { name: string; sku: string } | null
  }>
}

const STATUS_FLOW: Record<OrderStatus, NextStatus[]> = {
  draft: [
    { value: "confirmed", label: "Duyệt đơn", icon: CheckCircle2, roles: ["owner", "manager"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager", "sales"] },
  ],
  confirmed: [
    { value: "picking", label: "Bắt đầu lấy hàng", icon: Package2, roles: ["owner", "manager", "warehouse"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager"] },
  ],
  picking: [
    { value: "delivering", label: "Xuất kho giao hàng", icon: Truck, roles: ["owner", "manager", "warehouse", "driver"] },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager"] },
  ],
  delivering: [
    { value: "delivered", label: "Xác nhận đã giao", icon: CircleCheck, roles: ["owner", "manager", "warehouse", "driver"] },
  ],
  delivered: [],
  cancelled: [],
}

/** T-03: map legacy `status` → new `current_workflow_stage`. Used as a
 *  fallback when the migration hasn't populated the column yet for this
 *  org or when consuming code receives older API payloads. */
function mapStatusToWorkflowStage(status: OrderStatus): WorkflowStage {
  switch (status) {
    case "draft":
      return "draft"
    case "confirmed":
      return "approved"
    case "picking":
      return "picking"
    case "delivering":
      return "delivering"
    case "delivered":
      return "closed"
    case "cancelled":
      return "failed"
    default:
      return "draft"
  }
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [receivableId, setReceivableId] = useState<string | null>(null)
  const [receivable, setReceivable] = useState<
    { amount: number; paid: number; status: string; due_date: string | null } | null
  >(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [misaLoading, setMisaLoading] = useState(false)
  const [statusHistory, setStatusHistory] = useState<OrderStatusHistory[]>([])
  // Q6 — per-line activity log entries (most recent first).
  const [activityLog, setActivityLog] = useState<
    Array<{
      id: string
      order_line_id: string | null
      action: "add_line" | "edit_line" | "remove_line"
      workflow_stage: string | null
      changes: Record<string, unknown>
      created_at: string
      actor?: { full_name?: string | null } | null
    }>
  >([])
  const [deliveryLines, setDeliveryLines] = useState<DeliveryLineWithDetails[]>([])
  const [stockEntries, setStockEntries] = useState<OrderStockEntry[]>([])
  const [linkedReturns, setLinkedReturns] = useState<Array<{
    id: string
    status: string
    reason: string
    credit_note_amount: number | null
    notes: string | null
    created_at: string
    requester?: { full_name?: string | null } | null
    lines?: Array<{
      id: string
      product_id: string
      unit_name: string
      quantity: number
      unit_price: number
      line_total: number
      is_exchange?: boolean | null
      product?: { name?: string; sku?: string } | null
    }>
  }>>([])
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState<{ status: OrderStatus; label: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Edit-line state for draft/confirmed orders.
  const [linesEditMode, setLinesEditMode] = useState(false)
  const [editedLines, setEditedLines] = useState<
    {
      id: string
      quantity: number
      unit_price: number
      line_discount: number
      // §4.5 — product swap on a line. Optional: when set, save replaces
      // sales_order_lines.product_id (and the displayed name follows)
      swap_product_id?: string
      swap_product_name?: string
      swap_sku?: string
    }[]
  >([])
  const [savingLines, setSavingLines] = useState(false)
  // Catalog of swappable products (loaded on first open of edit mode)
  const [swapCatalog, setSwapCatalog] = useState<
    { id: string; name: string; sku: string; sell_price: number; base_unit: string }[]
  >([])
  const [swapDialogFor, setSwapDialogFor] = useState<string | null>(null)
  const [swapSearch, setSwapSearch] = useState("")
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ notes: "", payment_terms: "COD", expected_delivery: "" })
  const [actionLoading, setActionLoading] = useState(false)
  // T-03 — picked qty per line (base UOM). Read from v_sales_order_line_picked.
  // Populated alongside `lines` in fetchData. Lines with picked > 0 cannot be
  // reduced/removed/UOM-changed once stage='picking' (spec D10).
  const [pickedByLine, setPickedByLine] = useState<Record<string, number>>({})
  // Q5 — new lines being added in edit mode. Validator's `existing: null`
  // path always allows adding regardless of stage (D10 picking row says
  // "Thêm SP mới: ✅"). Inserted into sales_order_lines on save.
  const [addedLines, setAddedLines] = useState<
    Array<{
      key: string
      product_id: string
      product_name: string
      sku: string
      unit_name: string
      sell_price: number
      quantity: number
      unit_price: number
    }>
  >([])
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false)
  const [addLineSearch, setAddLineSearch] = useState("")
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  // T-06 — pessimistic edit lock. Activates only while the user is in
  // `linesEditMode`; another user opening the order sees the holder banner
  // and a readonly form.
  const lock = useEntityLock({
    entityType: "sales_order",
    entityId: id,
    enabled: linesEditMode,
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [orderRes, linesRes, recRes, historyRes, invoiceRes, deliveryLinesRes, stockEntriesRes, returnsRes, activityRes] = await Promise.all([
      supabase.from("sales_orders").select("id, org_id, order_code, customer_id, sales_user_id, order_date, expected_delivery, status, current_workflow_stage, payment_terms, subtotal, discount, vat, total, merged_into, notes, approved_by, approved_at, approval_reason, created_at, customer:customers(*), sales_user:users!sales_orders_sales_user_id_fkey(*)").eq("id", id).single(),
      supabase.from("sales_order_lines").select("id, order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, batch_id, note, conversion_factor, product:products(*)").eq("order_id", id),
      supabase.from("receivables").select("id, amount, paid, status, due_date").eq("order_id", id).maybeSingle(),
      supabase.from("order_status_history").select("id, order_id, from_status, to_status, changed_by, changed_at, notes, changer:users!order_status_history_changed_by_fkey(full_name)").eq("order_id", id).order("changed_at", { ascending: false }),
      supabase.from("invoices").select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at, misa_invoice_id, misa_ref_id, misa_inv_no, misa_inv_series, misa_inv_date, misa_invoice_code, misa_relation, misa_org_ref_id, misa_note, misa_no_locked, misa_invoice_url, misa_status, misa_error, misa_sent_at, misa_signed_at, misa_lookup_code, misa_published_at").eq("order_id", id).maybeSingle(),
      supabase
        .from("delivery_lines")
        .select("id, status, pod_photo_url, delivered_at, notes, delivery:deliveries(id, route_name, driver:users!deliveries_driver_id_fkey(full_name), started_at, completed_at, status)")
        .eq("order_id", id),
      // ref_order_ids is jsonb (mig 017), so .contains() generates the
      // wrong PostgREST syntax (`cs.{uuid}` works for text[], not for
      // jsonb arrays). Use the raw filter with a JSON-array literal.
      supabase
        .from("stock_entries")
        .select("id, entry_code, type, status, posted_at, created_at, notes, creator:users!stock_entries_created_by_fkey(full_name), lines:stock_entry_lines(id, product_id, quantity, unit_name, unit_cost, product:products(name, sku))")
        .filter("ref_order_ids", "cs", JSON.stringify([id]))
        .order("created_at", { ascending: false }),
      supabase
        .from("returns")
        .select(
          "id, status, reason, credit_note_amount, notes, created_at, requester:users!returns_requested_by_fkey(full_name), lines:return_lines(id, product_id, unit_name, quantity, unit_price, line_total, is_exchange, product:products(name, sku))"
        )
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
      // Q6 — per-line audit log (mig 052).
      supabase
        .from("order_activity_log")
        .select(
          "id, order_line_id, action, workflow_stage, changes, created_at, actor_id, actor:users!actor_id(full_name)"
        )
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ])
    const qErr2 = ([orderRes, linesRes, recRes, historyRes, invoiceRes, deliveryLinesRes, stockEntriesRes, returnsRes, activityRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr2) console.error("[orders/id] truy vấn lỗi:", qErr2.message)
    setInvoice((invoiceRes.data as Invoice) || null)
    if (orderRes.data) {
      const o = orderRes.data as unknown as SalesOrder
      setOrder(o)
      setEditForm({
        notes: o.notes || "",
        payment_terms: o.payment_terms || "COD",
        expected_delivery: o.expected_delivery || "",
      })
    }
    const fetchedLines = (linesRes.data as unknown as SalesOrderLine[]) || []
    setLines(fetchedLines)

    // T-03: load per-line picked qty (base UOM) from the helper view.
    if (fetchedLines.length > 0) {
      const { data: pickedRows, error: pickedRowsErr } = await supabase
        .from("v_sales_order_line_picked")
        .select("order_line_id, picked_qty_in_base_uom")
        .eq("order_id", id)
      if (pickedRowsErr) console.error("[orders/id] truy vấn lỗi:", pickedRowsErr.message)
      const map: Record<string, number> = {}
      ;((pickedRows as Array<{ order_line_id: string; picked_qty_in_base_uom: number }>) || [])
        .forEach((r) => {
          map[r.order_line_id] = Number(r.picked_qty_in_base_uom || 0)
        })
      setPickedByLine(map)
    } else {
      setPickedByLine({})
    }

    const recRow = recRes.data as
      | { id: string; amount: number; paid: number; status: string; due_date: string | null }
      | null
    setReceivableId(recRow?.id || null)
    setReceivable(
      recRow
        ? { amount: recRow.amount, paid: recRow.paid, status: recRow.status, due_date: recRow.due_date }
        : null
    )
    setStatusHistory((historyRes.data as unknown as OrderStatusHistory[]) || [])
    setDeliveryLines(((deliveryLinesRes.data as unknown) as DeliveryLineWithDetails[]) || [])
    setStockEntries(((stockEntriesRes.data as unknown) as OrderStockEntry[]) || [])
    setLinkedReturns(((returnsRes.data as unknown) as typeof linkedReturns) || [])
    setActivityLog(((activityRes.data as unknown) as typeof activityLog) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateReceivable = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      const { created, error: recErr } = await ensureReceivableForOrder(supabase, order.id)
      if (recErr) throw new Error(recErr)
      toast({
        title: created ? "Đã ghi nhận công nợ" : "Công nợ đã tồn tại",
      })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleXuatHoaDon = async () => {
    if (!order || !user) return
    setMisaLoading(true)
    try {
      // Auto-create invoice if none exists
      let currentInvoiceId = invoice?.id
      if (!currentInvoiceId) {
        const customer = order.customer
        const { data: newInvoice, error: invErr } = await supabase
          .from("invoices")
          .insert({
            org_id: order.org_id,
            order_id: order.id,
            invoice_number: null,
            customer_name: customer?.billing_name || customer?.store_name || "",
            customer_address: customer?.billing_address || customer?.address || null,
            customer_tax_code: customer?.tax_code || null,
            subtotal: order.subtotal,
            vat: order.vat,
            total: order.total,
            status: "draft",
          })
          .select("id")
          .single()
        if (invErr || !newInvoice) throw new Error(invErr?.message || "Không thể tạo hóa đơn")
        currentInvoiceId = newInvoice.id
      }

      const res = await fetch("/api/einvoice/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: currentInvoiceId, mode: "as_sold" }),
      })
      const text = await res.text()
      let data: { error?: string; cached?: boolean; inv_no?: string; lookup_code?: string; sandbox?: boolean } = {}
      try { data = text ? JSON.parse(text) : {} } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || `Phát hành MISA thất bại (HTTP ${res.status})${text && !data.error ? `: ${text.slice(0, 200)}` : ""}`)

      toast({
        title: data.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${data.inv_no ? `Số HĐ: ${data.inv_no} · ` : ""}Mã tra cứu: ${data.lookup_code || "—"}${data.sandbox ? " (sandbox)" : ""}`,
      })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi xuất hóa đơn", description: (error as Error).message, variant: "destructive" })
    } finally {
      setMisaLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [fetchData])

  const handleChangeStatus = async (newStatus: OrderStatus) => {
    if (!order || !user) return

    // Confirmed → picking goes through the stock-out screen so the warehouse
    // can review the pick list and create the export entry before the order
    // flips to "picking".
    if (newStatus === "picking" && order.status === "confirmed") {
      setConfirmOpen(null)
      router.push(`/inventory/stock-out?orderIds=${order.id}`)
      return
    }

    setActionLoading(true)
    try {
      const updates: Record<string, unknown> = { status: newStatus }

      // If confirming an order, evaluate rules + check permission
      if (newStatus === "confirmed") {
        // 3 query ngữ cảnh duyệt độc lập nhau — chạy song song để bước
        // "Duyệt" không cộng dồn round-trip tuần tự.
        const [{ evaluateApproval, canApproveForLevel }, rulesRes, recRes, repDebtRes] =
          await Promise.all([
            import("@/lib/approval"),
            supabase
              .from("approval_rules")
              .select("id, org_id, auto_approve_max, manager_approve_max, customer_debt_max, customer_overdue_max, rep_portfolio_debt_max, enforce_credit_limit, notes, is_active, updated_by, created_at, updated_at")
              .eq("org_id", user.org_id)
              .maybeSingle(),
            supabase
              .from("receivables")
              .select("amount, paid, due_date")
              .eq("customer_id", order.customer_id)
              .neq("status", "paid"),
            supabase
              .from("receivables")
              .select("amount, paid")
              .eq("sales_user_id", order.sales_user_id)
              .neq("status", "paid"),
          ])
        const qErr = ([rulesRes, recRes, repDebtRes] as Array<{ error?: { message?: string } | null }>)
          .find((r) => r?.error)?.error
        if (qErr) console.error("[orders/id] truy vấn lỗi:", qErr.message)
        const rulesData = rulesRes.data

        type RecRow = { amount: number; paid: number; due_date: string | null }
        const recRows = (recRes.data as RecRow[]) || []
        const customerDebt = recRows.reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)
        const now = Date.now()
        const customerOverdue = recRows
          .filter((r) => r.due_date && new Date(r.due_date).getTime() < now)
          .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)

        const repPortfolioDebt = ((repDebtRes.data as Array<{ amount: number; paid: number }>) || [])
          .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)

        const decision = evaluateApproval(rulesData ?? null, {
          orderTotal: order.total,
          // Đơn đã lưu có sẵn hai cột này, cả hai đều CHƯA gồm VAT — dùng
          // để quy tắc chiết khấu sâu chạy cả ở màn duyệt, không chỉ ở màn
          // tạo đơn. Nếu chỉ chặn lúc tạo thì đơn sửa lại thành chiết khấu
          // 100% sau đó vẫn duyệt được như thường.
          grossBeforeDiscount: Number(order.subtotal || 0),
          discountAmount: Number(order.discount || 0),
          customer: order.customer
            ? { id: order.customer.id, credit_limit: order.customer.credit_limit }
            : null,
          customerDebt,
          customerOverdue,
          repPortfolioDebt,
          role: user.role,
        })

        if (!decision.autoApprove && !canApproveForLevel(user.role, decision.expectedApprover)) {
          toast({
            title: "Không có quyền duyệt đơn này",
            description: decision.reason,
            variant: "destructive",
          })
          setActionLoading(false)
          return
        }

        updates.approved_by = user.id
        updates.approved_at = new Date().toISOString()
        updates.approval_reason = null
      }

      const { error } = await supabase.from("sales_orders").update(updates).eq("id", order.id)
      if (error) throw error

      // Notifications for status change (fire-and-forget)
      if (user.org_id && order.sales_user_id && order.sales_user_id !== user.id) {
        const { createNotification } = await import("@/lib/notifications")
        if (newStatus === "confirmed") {
          createNotification(supabase, {
            orgId: user.org_id,
            userId: order.sales_user_id,
            type: "order_approved",
            title: `Đơn ${order.order_code} đã được duyệt`,
            body: `Bởi ${user.full_name || "Quản lý"}`,
            linkUrl: `/orders/${order.id}`,
            metadata: { order_id: order.id, order_code: order.order_code },
          })
        } else if (newStatus === "cancelled") {
          createNotification(supabase, {
            orgId: user.org_id,
            userId: order.sales_user_id,
            type: "order_cancelled",
            title: `Đơn ${order.order_code} đã bị hủy`,
            body: `Bởi ${user.full_name || "Quản lý"}`,
            linkUrl: `/orders/${order.id}`,
            metadata: { order_id: order.id, order_code: order.order_code },
          })
        }
      }

      // Auto-create receivable when order becomes delivered
      if (newStatus === "delivered") {
        const { created, error: recErr } = await ensureReceivableForOrder(supabase, order.id)
        if (recErr) {
          toast({ title: "Cập nhật công nợ thất bại", description: recErr, variant: "destructive" })
        } else if (created) {
          toast({ title: `Đã chuyển trạng thái: ${newStatus} • Đã ghi nhận công nợ` })
          setConfirmOpen(null)
          fetchData()
          return
        }
      }

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
    if (!order) return
    setActionLoading(true)
    try {
      // Delete order lines first, then order (schema: order_lines has ON DELETE CASCADE so just delete order)
      const { error } = await supabase.from("sales_orders").delete().eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã xóa đơn hàng" })
      router.push("/orders")
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
      setActionLoading(false)
    }
  }

  const startLinesEdit = async () => {
    setEditedLines(
      lines.map((l) => ({
        id: l.id,
        quantity: Number(l.quantity || 0),
        unit_price: Number(l.unit_price || 0),
        line_discount: Number(l.line_discount || 0),
      }))
    )
    setLinesEditMode(true)
    // Lazy-load product catalog the first time the user opens edit mode
    if (swapCatalog.length === 0) {
      const { data, error: dataErr } = await supabase
        .from("products")
        .select("id, name, sku, sell_price, base_unit")
        .eq("status", "active")
        .order("name")
      if (dataErr) console.error("[orders/id] truy vấn lỗi:", dataErr.message)
      setSwapCatalog(
        (data as Array<{ id: string; name: string; sku: string; sell_price: number; base_unit: string }>) || []
      )
    }
  }

  const cancelLinesEdit = () => {
    setLinesEditMode(false)
    setEditedLines([])
    setSwapDialogFor(null)
    setAddedLines([])
    setAddLineDialogOpen(false)
    setAddLineSearch("")
    // T-06: release lock (best-effort).
    lock.release().catch(() => {})
  }

  // Q5: pick a product from the catalog and append a draft new line.
  const appendAddedLine = (p: {
    id: string
    name: string
    sku: string
    sell_price: number
    base_unit: string
  }) => {
    setAddedLines((prev) => [
      ...prev,
      {
        key: `add-${p.id}-${Date.now()}`,
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        unit_name: p.base_unit,
        sell_price: Number(p.sell_price || 0),
        quantity: 1,
        unit_price: Number(p.sell_price || 0),
      },
    ])
    setAddLineDialogOpen(false)
    setAddLineSearch("")
  }

  const updateAddedLine = (
    key: string,
    patch: Partial<(typeof addedLines)[number]>
  ) => {
    setAddedLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l))
    )
  }

  const removeAddedLine = (key: string) => {
    setAddedLines((prev) => prev.filter((l) => l.key !== key))
  }

  const applySwap = (
    lineId: string,
    product: { id: string; name: string; sku: string; sell_price: number }
  ) => {
    setEditedLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              swap_product_id: product.id,
              swap_product_name: product.name,
              swap_sku: product.sku,
              // Pick up the new product's default sell price unless the
              // user has already manually edited the price in this session.
              unit_price:
                l.unit_price === Number(lines.find((x) => x.id === lineId)?.unit_price || 0)
                  ? Number(product.sell_price || 0)
                  : l.unit_price,
            }
          : l
      )
    )
    setSwapDialogFor(null)
    setSwapSearch("")
  }

  const undoSwap = (lineId: string) => {
    setEditedLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, swap_product_id: undefined, swap_product_name: undefined, swap_sku: undefined }
          : l
      )
    )
  }

  const setEditedLineField = (
    id: string,
    field: "quantity" | "unit_price",
    value: number
  ) => {
    setEditedLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    )
  }

  const editedLinesTotal = editedLines.reduce(
    (s, l) =>
      s + Math.max(0, l.quantity * l.unit_price - (l.line_discount || 0)),
    0
  )
  // Q5: live total includes new draft lines.
  const addedLinesTotal = addedLines.reduce(
    (s, l) => s + Math.max(0, l.quantity * l.unit_price),
    0
  )

  const saveLineEdits = async () => {
    if (!order) return
    // T-06 — must hold the lock to mutate.
    if (lock.state !== "mine") {
      toast({
        title: "Đơn đang được người khác sửa",
        description: lock.holder?.holderName
          ? `${lock.holder.holderName} đang khoá form. Vui lòng thử lại sau.`
          : "Vui lòng thử lại sau.",
        variant: "destructive",
      })
      return
    }
    setSavingLines(true)
    try {
      // T-03 — validate the edit batch against picking-stage rules (D10).
      const stage: WorkflowStage =
        (order.current_workflow_stage as WorkflowStage | undefined) ??
        mapStatusToWorkflowStage(order.status)
      const editChanges: OrderLineChange[] = editedLines.map((l) => {
        const original = lines.find((x) => x.id === l.id)
        if (!original) {
          return { existing: null, proposed: null }
        }
        const factor = Number(
          (original as unknown as { conversion_factor?: number }).conversion_factor ?? 1
        )
        return {
          existing: {
            id: original.id,
            product_id: original.product_id,
            unit_name: original.unit_name,
            quantity: Number(original.quantity || 0),
            conversion_factor: factor,
            picked_qty_in_base_uom: pickedByLine[original.id] || 0,
          },
          proposed: {
            // swap_product_id (when set) is a product change; the validator
            // will block it if the line is already picked.
            product_id: l.swap_product_id || original.product_id,
            unit_name: original.unit_name,
            quantity: Number(l.quantity || 0),
            conversion_factor: factor,
          },
        }
      })
      // Q5: append "new line" changes for the validator (existing=null,
      // proposed=draft). Validator allows these in any editable stage.
      const addChanges: OrderLineChange[] = addedLines.map((l) => ({
        existing: null,
        proposed: {
          product_id: l.product_id,
          unit_name: l.unit_name,
          quantity: Number(l.quantity || 0),
          conversion_factor: 1,
        },
      }))
      const changes = [...editChanges, ...addChanges]
      const validation = validateOrderEdit({ stage, changes })
      if (!validation.ok) {
        toast({
          title: "Không thể lưu",
          description: validation.errors.map((e) => e.reason).join("\n"),
          variant: "destructive",
        })
        setSavingLines(false)
        return
      }

      // Cập nhật từng line. Tính line_total = qty*price - discount.
      for (const l of editedLines) {
        const lineTotal = Math.max(0, l.quantity * l.unit_price - (l.line_discount || 0))
        const update: Record<string, unknown> = {
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: lineTotal,
        }
        if (l.swap_product_id) {
          // §4.5 — swap product. Reset batch_id since the lot link no
          // longer applies; warehouse will pick a fresh batch.
          update.product_id = l.swap_product_id
          update.batch_id = null
        }
        const { error } = await supabase
          .from("sales_order_lines")
          .update(update)
          .eq("id", l.id)
        if (error) throw error
      }

      // Q5: insert new draft lines.
      if (addedLines.length > 0) {
        const inserts = addedLines
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            order_id: order.id,
            product_id: l.product_id,
            unit_name: l.unit_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            line_total: Math.max(0, l.quantity * l.unit_price),
          }))
        if (inserts.length > 0) {
          const { error: insErr } = await supabase
            .from("sales_order_lines")
            .insert(inserts)
          if (insErr) throw insErr
        }
      }

      // Tính lại tổng đơn — subtotal = existing edited + new added.
      const subtotal = editedLinesTotal + addedLinesTotal
      const total = Math.max(0, subtotal - Number(order.discount || 0) + Number(order.vat || 0))
      const { error: orderErr } = await supabase
        .from("sales_orders")
        .update({ subtotal, total })
        .eq("id", order.id)
      if (orderErr) throw orderErr

      toast({
        title: "Đã cập nhật dòng đơn hàng",
        description: `Tổng đơn mới: ${formatCurrency(total)}`,
      })
      setLinesEditMode(false)
      setEditedLines([])
      setAddedLines([])
      // T-06: release lock after successful save.
      await lock.release().catch(() => {})
      fetchData()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: (err as Error).message,
        variant: "destructive",
      })
    } finally {
      setSavingLines(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      // Build update payload based on order status
      const updates: Record<string, unknown> = {
        notes: editForm.notes || null,
      }
      // Only allow terms + delivery date changes when still editable.
      // Picking-stage edits (§4.4) are limited to lines + notes; payment
      // terms / delivery date stay locked since the customer already
      // agreed to them at draft/confirmed.
      if (order.status === "draft" || order.status === "confirmed") {
        updates.payment_terms = editForm.payment_terms
        updates.expected_delivery = editForm.expected_delivery || null
      }
      const { error } = await supabase
        .from("sales_orders")
        .update(updates)
        .eq("id", order.id)
      if (error) throw error
      toast({ title: "Đã cập nhật đơn hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: (error as Error).message, variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!order) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy đơn hàng</div>

  const availableTransitions = STATUS_FLOW[order.status] || []
  // Allow edit for all non-terminal statuses. Draft/confirmed get full
  // edit; picking gets full edit ONLY for warehouse/owner/manager (§4.4
  // — chỉnh đơn ở bước xuất hàng); picking/delivering for sales rep
  // can edit notes only; delivered/cancelled cannot edit at all.
  const canEdit = !!(user && hasPermission(user.role, "orders", "update") && !["delivered", "cancelled"].includes(order.status))
  const isWarehouseRole = user?.role === "warehouse" || user?.role === "owner" || user?.role === "manager"
  const fullEdit =
    canEdit &&
    (["draft", "confirmed"].includes(order.status) ||
      (order.status === "picking" && isWarehouseRole))
  const canDelete = user && hasPermission(user.role, "orders", "delete") && ["draft", "cancelled"].includes(order.status)

  // M4.2 — trên điện thoại, thẻ "Thao tác" nằm CUỐI cột phụ, tức là sau
  // khách hàng + thông tin đơn + công nợ + hoá đơn. Đo trên đơn 8 dòng:
  // phải cuộn 3.400px mới thấy nút "Duyệt đơn". Gom lại thành MỘT thanh
  // dính đáy: hành động chính hiện thành nút, phần còn lại vào menu ⋮.
  const roleTransitions = availableTransitions.filter(
    (t) => !!user && t.roles.includes(user.role)
  )
  // Hành động chính = bước TIẾN của luồng. "Hủy đơn" không bao giờ là
  // hành động chính — để nó ở nút to là mời người ta bấm nhầm.
  const primaryTransition = roleTransitions.find((t) => t.value !== "cancelled") || null
  const menuTransitions = roleTransitions.filter((t) => t !== primaryTransition)
  // Đơn đã giao không còn bước chuyển nào trong STATUS_FLOW, nhưng việc
  // CHƯA XONG thì vẫn còn: ghi nhận công nợ rồi xuất hoá đơn. Không đưa
  // lên thanh thì đúng trạng thái có việc lại là trạng thái thanh rỗng.
  const deliveredNext =
    order.status === "delivered"
      ? !receivableId
        ? { label: actionLoading ? "Đang tạo..." : "Ghi nhận công nợ", icon: CreditCard, onClick: handleCreateReceivable, busy: actionLoading }
        : !invoice
          ? { label: misaLoading ? "Đang xuất hóa đơn..." : "Xuất hóa đơn", icon: FileText, onClick: handleXuatHoaDon, busy: misaLoading }
          : null
      : null
  const hasMobileActions = !!primaryTransition || !!deliveredNext || menuTransitions.length > 0 || !!canDelete

  return (
    <div className={`space-y-4 ${hasMobileActions ? "pb-nav-action" : ""}`}>
      <PageHeader
        title={order.order_code}
        description={`Ngày đặt: ${formatDate(order.order_date)}${order.approved_at ? ` • Duyệt: ${formatDate(order.approved_at)}` : ""}`}
        backHref="/orders"
      >
        <StatusBadge status={order.status} type="order" />
        <PaymentStatusBadge receivable={receivable} />
        <ApprovalBadge total={order.total} status={order.status} approvedBy={order.approved_by} />
      </PageHeader>

      {/* Approval reason callout — only for draft orders awaiting manual approval */}
      {order.status === "draft" && order.approval_reason && (
        <div className="rounded-xl border border-[#fdb022]/40 bg-[#fff4ed] p-4 flex items-start gap-3">
          <div className="shrink-0 h-8 w-8 rounded-full bg-[#fdb022] text-on-primary flex items-center justify-center font-bold text-sm">
            !
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[#b54708] text-sm">Đơn đang chờ duyệt</p>
            <p className="text-xs text-[#b54708]/90 mt-0.5 whitespace-pre-wrap">
              {order.approval_reason}
            </p>
          </div>
        </div>
      )}

      {/* M4.3 — tóm tắt cho mobile, đặt NGAY dưới tiêu đề.
          Hai thứ người ta mở đơn ra để xem đầu tiên là "của khách nào" và
          "bao nhiêu tiền". Trước đây tên khách nằm ở cột phụ (sau toàn bộ
          bảng hàng) còn tổng tiền nằm cuối thẻ sản phẩm — cả hai đều dưới
          màn hình đầu. Trên desktop hai cột nên đã thấy sẵn: lg:hidden. */}
      <div className="lg:hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{order.customer?.store_name || "Khách lẻ"}</p>
            <p className="truncate text-xs text-on-surface-variant">
              {order.customer?.owner_name || "—"}
            </p>
          </div>
          {order.customer?.phone ? (
            <a
              href={`tel:${order.customer.phone}`}
              className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant"
              aria-label={`Gọi ${order.customer.store_name || "khách"}`}
            >
              <Phone className="h-4 w-4 text-primary" />
            </a>
          ) : null}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-outline-variant pt-3">
          <span className="text-xs uppercase tracking-wider text-on-surface-variant">Tổng đơn</span>
          <span className="text-2xl font-bold tabular-data">{formatCurrency(order.total)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column - details */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Chi tiết sản phẩm</CardTitle>
              {fullEdit && order.status === "picking" && (
                <p className="text-[11px] text-[#b54708] mt-1">
                  Đơn đang ở bước <strong>Xuất kho</strong> — có thể thêm SP / tăng SL / sửa giá.
                  Dòng có icon <Lock className="inline h-3 w-3 mb-0.5" /> đã được pick một phần — không thể giảm SL, đổi đơn vị, đổi sản phẩm hay xoá.
                </p>
              )}
              {linesEditMode && lock.state === "other" && lock.holder && (
                <p className="text-[11px] text-error mt-1 flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  <span>
                    <strong>{lock.holder.holderName || "Người dùng khác"}</strong>{" "}
                    đang sửa đơn này từ {formatDate(lock.holder.lockedAt)}. Form đang khoá.
                  </span>
                </p>
              )}
            </div>
            {fullEdit && lines.length > 0 ? (
              linesEditMode ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAddLineDialogOpen(true)
                      setAddLineSearch("")
                    }}
                    disabled={savingLines || lock.state !== "mine"}
                    title={
                      lock.state !== "mine"
                        ? "Chưa khoá được đơn — đợi người khác xong rồi thử lại."
                        : "Thêm SP mới — vẫn được phép ở stage 'picking' (D10)."
                    }
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Thêm SP
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelLinesEdit}
                    disabled={savingLines}
                  >
                    Hủy
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveLineEdits}
                    disabled={savingLines || lock.state !== "mine"}
                    title={
                      lock.state !== "mine"
                        ? "Chưa khoá được đơn — đợi người khác xong rồi thử lại."
                        : undefined
                    }
                  >
                    {savingLines ? "Đang lưu..." : "Lưu dòng đơn"}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={startLinesEdit}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Sửa SL & đơn giá
                </Button>
              )
            ) : null}
          </CardHeader>
          <CardContent>
            {/* Desktop table */}
            <div className="hidden md:block">
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
                  {lines.map((line) => {
                    const edited = editedLines.find((e) => e.id === line.id)
                    const inEdit = linesEditMode && !!edited
                    const liveQty = edited?.quantity ?? line.quantity
                    const livePrice = edited?.unit_price ?? line.unit_price
                    const liveDiscount = edited?.line_discount ?? Number(line.line_discount || 0)
                    const liveTotal = inEdit
                      ? Math.max(0, liveQty * livePrice - liveDiscount)
                      : line.line_total
                    // T-03: dòng đã pick → khoá giảm SL + đổi SP. Chỉ tính lock
                    // khi đơn đang ở stage 'picking'; trước đó user có toàn
                    // quyền sửa.
                    const pickedBase = pickedByLine[line.id] || 0
                    const lineLocked =
                      order.status === "picking" && isLineLocked(pickedBase)
                    const lineFactor = Number(
                      (line as unknown as { conversion_factor?: number }).conversion_factor ?? 1
                    )
                    const minQtyForLine = lineLocked
                      ? pickedBase / (lineFactor || 1)
                      : 0
                    // T-06 — readonly when someone else holds the lock.
                    const lockReadonly = inEdit && lock.state !== "mine"
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className={`flex items-center gap-1.5 ${edited?.swap_product_id ? "line-through text-muted-foreground" : ""}`}>
                                {lineLocked && (
                                  <span
                                    title={`Đã pick ${pickedBase} ${line.product?.base_unit || ""} — không thể giảm hoặc đổi.`}
                                    className="inline-flex h-4 w-4 items-center justify-center text-[#b54708] shrink-0"
                                  >
                                    <Lock className="h-3.5 w-3.5" />
                                  </span>
                                )}
                                {line.product?.name || "-"}
                              </div>
                              {edited?.swap_product_id && (
                                <div className="text-tertiary font-semibold text-sm">
                                  → {edited.swap_product_name}{" "}
                                  <span className="font-normal text-[11px] text-muted-foreground">
                                    ({edited.swap_sku})
                                  </span>
                                </div>
                              )}
                              {line.note && (
                                <div className="text-[11px] text-muted-foreground italic mt-0.5">
                                  ✏ {line.note}
                                </div>
                              )}
                            </div>
                            {inEdit && (
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                {edited?.swap_product_id ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => undoSwap(line.id)}
                                  >
                                    Bỏ đổi
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      setSwapDialogFor(line.id)
                                      setSwapSearch("")
                                    }}
                                    disabled={lineLocked || lockReadonly}
                                    title={
                                      lockReadonly
                                        ? "Người khác đang sửa — form khoá."
                                        : lineLocked
                                          ? "Đã pick — không thể đổi SP."
                                          : undefined
                                    }
                                  >
                                    Đổi SP
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{line.unit_name}</TableCell>
                        <TableCell className="text-right">
                          {inEdit ? (
                            <Input
                              type="number"
                              min={minQtyForLine}
                              step="any"
                              value={liveQty}
                              onChange={(e) =>
                                setEditedLineField(line.id, "quantity", parseFloat(e.target.value) || 0)
                              }
                              className={`ml-auto h-8 w-24 text-right tabular-nums ${
                                lineLocked ? "border-[#fdb022]/40" : ""
                              }`}
                              disabled={lockReadonly}
                              title={
                                lockReadonly
                                  ? "Người khác đang sửa — form khoá."
                                  : lineLocked
                                    ? `Đã pick ${pickedBase} (base UOM). Tối thiểu ${minQtyForLine} ${line.unit_name}.`
                                    : undefined
                              }
                            />
                          ) : (
                            line.quantity
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {inEdit ? (
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={livePrice}
                              onChange={(e) =>
                                setEditedLineField(line.id, "unit_price", parseFloat(e.target.value) || 0)
                              }
                              className="ml-auto h-8 w-32 text-right tabular-nums"
                              disabled={lockReadonly}
                            />
                          ) : (
                            formatCurrency(line.unit_price)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(liveTotal)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {lines.length === 0 && addedLines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Chưa có sản phẩm
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Q5 — new draft lines being added in edit mode. */}
                  {linesEditMode &&
                    addedLines.map((al) => (
                      <TableRow key={al.key} className="bg-[#ecfdf3]/40">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="success" className="text-[10px]">
                              MỚI
                            </Badge>
                            <span>{al.product_name}</span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {al.sku}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{al.unit_name}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={al.quantity}
                            onChange={(e) =>
                              updateAddedLine(al.key, {
                                quantity: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="ml-auto h-8 w-24 text-right tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={al.unit_price}
                            onChange={(e) =>
                              updateAddedLine(al.key, {
                                unit_price: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="ml-auto h-8 w-32 text-right tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-medium tabular-nums">
                              {formatCurrency(al.quantity * al.unit_price)}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => removeAddedLine(al.key)}
                            >
                              ×
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {lines.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">Chưa có sản phẩm</p>
              ) : (
                lines.map((line) => {
                  const edited = editedLines.find((e) => e.id === line.id)
                  const inEdit = linesEditMode && !!edited
                  const liveQty = edited?.quantity ?? line.quantity
                  const livePrice = edited?.unit_price ?? line.unit_price
                  const liveDiscount = edited?.line_discount ?? Number(line.line_discount || 0)
                  const liveTotal = inEdit
                    ? Math.max(0, liveQty * livePrice - liveDiscount)
                    : line.line_total
                  // T-03: dòng đã pick → khoá giảm SL.
                  const pickedBase = pickedByLine[line.id] || 0
                  const lineLocked =
                    order.status === "picking" && isLineLocked(pickedBase)
                  const lineFactor = Number(
                    (line as unknown as { conversion_factor?: number }).conversion_factor ?? 1
                  )
                  const minQtyForLine = lineLocked
                    ? pickedBase / (lineFactor || 1)
                    : 0
                  const lockReadonly = inEdit && lock.state !== "mine"
                  return (
                    <div key={line.id} className="rounded-xl border bg-muted/20 p-3">
                      <p className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                        {lineLocked && (
                          <Lock className="h-3.5 w-3.5 text-[#b54708] shrink-0" />
                        )}
                        {/* "-" khiến người dùng tưởng giao diện hỏng.
                            Sản phẩm bị xoá khỏi danh mục sau khi lên đơn
                            là chuyện có thật — nói thẳng ra. */}
                        {line.product?.name || (
                          <span className="italic text-on-surface-variant">Sản phẩm đã xoá</span>
                        )}
                      </p>
                      {line.note && (
                        <p className="text-[11px] text-muted-foreground italic mt-1">
                          ✏ {line.note}
                        </p>
                      )}
                      {/* Ở 317px, lưới 3 cột cho mỗi cột ~95px, mà
                          "26.400.000" cần ~105px → cột Thành tiền BỊ CẮT.
                          Chế độ xem: SL × đơn giá một dòng, thành tiền
                          tách riêng canh phải. Chế độ sửa mới bung hai ô
                          nhập xếp dọc, mỗi ô 44px. */}
                      {inEdit ? (
                        <div className="mt-2 space-y-2">
                          <div>
                            <p className="text-xs text-muted-foreground">SL ({line.unit_name})</p>
                            <Input
                              type="number"
                              min={minQtyForLine}
                              step="any"
                              value={liveQty}
                              onChange={(e) =>
                                setEditedLineField(line.id, "quantity", parseFloat(e.target.value) || 0)
                              }
                              className={`mt-0.5 h-11 ${lineLocked ? "border-[#fdb022]/40" : ""}`}
                              disabled={lockReadonly}
                              title={
                                lockReadonly
                                  ? "Người khác đang sửa — form khoá."
                                  : lineLocked
                                    ? `Đã pick ${pickedBase} (base UOM). Tối thiểu ${minQtyForLine} ${line.unit_name}.`
                                    : undefined
                              }
                            />
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Đơn giá</p>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={livePrice}
                              onChange={(e) =>
                                setEditedLineField(line.id, "unit_price", parseFloat(e.target.value) || 0)
                              }
                              className="mt-0.5 h-11"
                              disabled={lockReadonly}
                            />
                          </div>
                          <div className="flex items-baseline justify-between border-t pt-2">
                            <span className="text-xs text-muted-foreground">Thành tiền</span>
                            <span className="text-[15px] font-bold tabular-data">
                              {formatCurrency(liveTotal)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 space-y-1 text-[13px]">
                          <p className="text-on-surface-variant">
                            {line.quantity} {line.unit_name} × {formatCurrency(line.unit_price)}
                          </p>
                          <p className="text-right text-[15px] font-bold tabular-data">
                            {formatCurrency(liveTotal)}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className="mt-4 space-y-1 text-right border-t border-border/40 pt-4">
              <p className="text-sm">
                Tạm tính:{" "}
                {linesEditMode
                  ? formatCurrency(editedLinesTotal + addedLinesTotal)
                  : formatCurrency(order.subtotal)}
              </p>
              <p className="text-sm">Chiết khấu: {formatCurrency(order.discount)}</p>
              <p className="text-sm">VAT: {formatCurrency(order.vat)}</p>
              <p className="text-lg font-bold">
                Tổng:{" "}
                {linesEditMode
                  ? formatCurrency(
                      Math.max(0, editedLinesTotal + addedLinesTotal - Number(order.discount || 0) + Number(order.vat || 0))
                    )
                  : formatCurrency(order.total)}
              </p>
              {linesEditMode ? (
                <p className="text-xs text-muted-foreground">
                  Đang ở chế độ chỉnh sửa — tổng sẽ cập nhật khi bấm <span className="font-semibold">Lưu dòng đơn</span>.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Right column - customer + actions + edit */}
        <div className="space-y-4">
          {/* Customer info */}
          <Card>
            <CardHeader><CardTitle>Khách hàng</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-bold">{order.customer?.store_name}</p>
              <p className="text-muted-foreground">{order.customer?.owner_name}</p>
              <p>{order.customer?.phone}</p>
              <p className="text-muted-foreground">{order.customer?.address}</p>
              {order.sales_user && (
                <p className="pt-2 border-t border-border/40 mt-2">
                  <span className="text-muted-foreground">NV bán: </span>
                  <span className="font-semibold">{order.sales_user.full_name}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thông tin đơn</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {editMode && (
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditMode(false)
                  setEditForm({
                    notes: order.notes || "",
                    payment_terms: order.payment_terms || "COD",
                    expected_delivery: order.expected_delivery || "",
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
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Điều khoản TT</Label>
                    <p className="font-semibold">{order.payment_terms || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày giao dự kiến</Label>
                    <p className="font-semibold">{order.expected_delivery ? formatDate(order.expected_delivery) : "-"}</p>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
                    <p className="whitespace-pre-wrap">{order.notes || <span className="text-muted-foreground">Không có</span>}</p>
                  </div>
                </>
              ) : (
                <>
                  {fullEdit && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Điều khoản TT</Label>
                        <Select value={editForm.payment_terms} onValueChange={(v) => setEditForm({ ...editForm, payment_terms: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TERMS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày giao dự kiến</Label>
                        <input
                          type="date"
                          value={editForm.expected_delivery}
                          onChange={(e) => setEditForm({ ...editForm, expected_delivery: e.target.value })}
                          className="flex h-11 w-full rounded-xl border-0 bg-muted/30 px-4 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}
                  {!fullEdit && (
                    <div className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#b54708]">
                      Đơn đã được duyệt - chỉ cho phép sửa ghi chú. Các trường khác chỉ sửa được khi ở trạng thái nháp hoặc đã duyệt.
                    </div>
                  )}
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

          {/* Receivable status */}
          {order.status === "delivered" && (
            <Card>
              <CardHeader><CardTitle>Công nợ</CardTitle></CardHeader>
              <CardContent>
                {receivableId ? (
                  <Link
                    href={`/receivables/${receivableId}`}
                    className="flex items-center justify-between rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-primary" />
                      <div className="text-sm">
                        <p className="font-semibold">Đã ghi nhận công nợ</p>
                        <p className="text-xs text-muted-foreground">Nhấn để xem chi tiết</p>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Đơn đã giao nhưng chưa ghi nhận công nợ.
                    </p>
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={handleCreateReceivable}
                      disabled={actionLoading}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      {actionLoading ? "Đang tạo..." : "Ghi nhận công nợ"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Hóa đơn MISA */}
          {order.status === "delivered" && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Hóa đơn</CardTitle></CardHeader>
              <CardContent>
                {invoice ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Số HĐ</span>
                      <span className="font-mono font-bold text-sm">{invoice.misa_inv_no || invoice.invoice_number || "Chưa có"}</span>
                    </div>
                    {invoice.misa_status && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Trạng thái MISA</span>
                        <Badge variant={misaStatusBadge(invoice.misa_status)!.variant}>
                          {misaStatusBadge(invoice.misa_status)!.label}
                        </Badge>
                      </div>
                    )}
                    {invoice.misa_invoice_url && (
                      <a
                        href={invoice.misa_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary font-semibold hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Tra cứu hóa đơn
                      </a>
                    )}
                    {invoice.misa_status === "error" && (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 rounded-lg bg-error-container p-2 text-xs text-error">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <span>{invoice.misa_error || "Lỗi không xác định"}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={handleXuatHoaDon}
                          disabled={misaLoading}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                          {misaLoading ? "Đang gửi lại..." : "Gửi lại"}
                        </Button>
                      </div>
                    )}
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-3 w-3" /> Xem chi tiết hóa đơn
                    </Link>
                  </div>
                ) : (
                  <Button
                    className="w-full bg-gradient-to-r from-primary to-primary/80"
                    onClick={handleXuatHoaDon}
                    disabled={misaLoading}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {misaLoading ? "Đang xuất hóa đơn..." : "Xuất hóa đơn"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Status transitions — desktop giữ nguyên thẻ dọc; mobile dùng
              StickyActionBar ở cuối trang (M4.2), không hiện hai lần. */}
          {(availableTransitions.length > 0 || canDelete) && (
            <Card className="hidden lg:block">
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
                    <Trash2 className="h-4 w-4 mr-2" /> Xóa đơn hàng
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Stock History */}
      {(deliveryLines.length > 0 || stockEntries.length > 0) && (
        <CollapsibleSection title="Lịch sử kho">
        <Card className="border-0 bg-transparent shadow-none lg:border lg:bg-surface-container-lowest lg:shadow-card">
          <CardHeader className="hidden lg:flex">
            <CardTitle className="flex items-center gap-2">
              <Package2 className="h-4 w-4" /> Lịch sử kho
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Deliveries */}
            {deliveryLines.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Giao hàng ({deliveryLines.length})
                </p>
                <div className="space-y-2">
                  {deliveryLines.map((dl) => {
                    const statusMeta: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" | "secondary" }> = {
                      pending: { label: "Chờ giao", variant: "secondary" },
                      delivered: { label: "Đã giao", variant: "success" },
                      partial: { label: "Giao một phần", variant: "warning" },
                      failed: { label: "Thất bại", variant: "danger" },
                    }
                    const st = statusMeta[dl.status] || statusMeta.pending
                    return (
                      <div key={dl.id} className="rounded-xl border bg-muted/10 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {dl.delivery && (
                                <Link
                                  href={`/deliveries/${dl.delivery.id}`}
                                  className="text-sm font-semibold text-primary hover:underline"
                                >
                                  {dl.delivery.route_name || "Chuyến giao"}
                                </Link>
                              )}
                              <Badge variant={st.variant}>{st.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {dl.delivery?.driver?.full_name ? `Tài xế: ${dl.delivery.driver.full_name} • ` : ""}
                              {dl.delivered_at ? `Giao: ${formatDate(dl.delivered_at)}` : dl.delivery?.started_at ? `Khởi hành: ${formatDate(dl.delivery.started_at)}` : "Chưa khởi hành"}
                            </p>
                            {dl.notes && (
                              <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                                &ldquo;{dl.notes}&rdquo;
                              </p>
                            )}
                          </div>
                          {dl.pod_photo_url && (
                            <a
                              href={dl.pod_photo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 rounded-lg overflow-hidden border w-16 h-16 bg-muted"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={dl.pod_photo_url}
                                alt="POD"
                                className="w-full h-full object-cover"
                              />
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Stock entries linked to this order */}
            {stockEntries.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Phiếu kho liên quan ({stockEntries.length})
                </p>
                <div className="space-y-2">
                  {stockEntries.map((e) => {
                    const typeMeta: Record<string, { label: string; color: string }> = {
                      import: { label: "Nhập", color: "bg-[#ecfdf3] text-tertiary" },
                      export: { label: "Xuất", color: "bg-error-container text-error" },
                      transfer: { label: "Chuyển", color: "bg-[#eff8ff] text-[#175cd3]" },
                      stocktake: { label: "Kiểm kê", color: "bg-primary/10 text-primary" },
                    }
                    const tm = typeMeta[e.type] || typeMeta.export
                    const totalQty = (e.lines || []).reduce((s, l) => s + Number(l.quantity || 0), 0)
                    return (
                      <div key={e.id} className="rounded-xl border bg-muted/10 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/inventory/entries/${e.id}`}
                                className="text-sm font-mono font-bold text-primary hover:underline"
                              >
                                {e.entry_code}
                              </Link>
                              <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${tm.color}`}>
                                {tm.label}
                              </span>
                              {e.status === "draft" && <Badge variant="warning">Nháp</Badge>}
                              {e.status === "cancelled" && <Badge variant="secondary">Đã hủy</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {e.posted_at ? formatDate(e.posted_at) : formatDate(e.created_at)}
                              {e.creator?.full_name ? ` • Bởi ${e.creator.full_name}` : ""}
                              {` • ${e.lines?.length || 0} SP, tổng ${totalQty}`}
                            </p>
                            {e.lines && e.lines.length > 0 && (
                              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                                {e.lines.map((l) => `${l.product?.sku || "?"}×${l.quantity}`).join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </CollapsibleSection>
      )}

      {/* Linked returns: companion returns recorded with this order */}
      {linkedReturns.length > 0 && (
        <Card className="border-l-4 border-l-amber-400">
          <CardHeader>
            <CardTitle className="text-base">
              Hàng trả kèm đơn này ({linkedReturns.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Sau khi quản lý duyệt, hàng sẽ tự nhập lại kho và số tiền trả sẽ trừ vào công nợ của đơn này.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {linkedReturns.map((r) => {
              const reasonLabel =
                {
                  damaged: "Hư hỏng",
                  wrong_item: "Sai hàng",
                  near_expiry: "Gần hết hạn",
                  expired: "Hết hạn",
                  refused: "Khách từ chối",
                }[r.reason] || r.reason
              const statusVariant: "warning" | "success" | "danger" | "secondary" =
                r.status === "approved" || r.status === "completed"
                  ? "success"
                  : r.status === "rejected"
                    ? "danger"
                    : r.status === "pending"
                      ? "warning"
                      : "secondary"
              const statusLabel =
                {
                  pending: "Chờ duyệt",
                  approved: "Đã duyệt",
                  completed: "Đã hoàn tất",
                  rejected: "Từ chối",
                }[r.status] || r.status
              // Bugfix: phân tách rõ refund (trừ công nợ) vs exchange (đổi).
              const refundLines = (r.lines || []).filter((l) => !l.is_exchange)
              const exchangeLines = (r.lines || []).filter((l) => l.is_exchange)
              const refundTotal = refundLines.reduce(
                (s, l) => s + Number(l.line_total || 0),
                0
              )
              const exchangeTotal = exchangeLines.reduce(
                (s, l) => s + Number(l.line_total || 0),
                0
              )
              return (
                <div key={r.id} className="rounded-xl border bg-[#fff4ed]/30 p-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <Badge variant={statusVariant}>{statusLabel}</Badge>
                        <span className="text-xs text-muted-foreground">{reasonLabel}</span>
                        {r.requester?.full_name && (
                          <span className="text-xs text-muted-foreground">
                            • {r.requester.full_name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
                      {r.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{r.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-[#b54708]">
                        −{formatCurrency(Number(r.credit_note_amount || 0))}
                      </p>
                      <p className="text-[10px] text-muted-foreground">trừ công nợ</p>
                      <Link
                        href={`/returns/${r.id}`}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Mở chi tiết →
                      </Link>
                    </div>
                  </div>

                  {/* Per-kind summary chips so the user thấy ngay 2 nhóm. */}
                  {(refundLines.length > 0 || exchangeLines.length > 0) && (
                    <div className="flex flex-wrap gap-2 text-[11px] mb-2">
                      {refundLines.length > 0 && (
                        <span className="rounded-md bg-[#fff4ed] text-[#b54708] border border-[#fdb022]/40 px-2 py-0.5">
                          Trả trừ công nợ: {refundLines.length} dòng •{" "}
                          <strong>{formatCurrency(refundTotal)}</strong>
                        </span>
                      )}
                      {exchangeLines.length > 0 && (
                        <span className="rounded-md bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40 px-2 py-0.5">
                          Đổi (không trừ công nợ): {exchangeLines.length} dòng •{" "}
                          <strong>{formatCurrency(exchangeTotal)}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {r.lines && r.lines.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#fdb022]/40/50">
                      <div className="space-y-1 text-xs">
                        {r.lines.map((l) => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <span className="truncate flex items-center gap-1.5">
                              {l.is_exchange ? (
                                <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[#eff8ff] text-[#175cd3] border border-[#175cd3]/40 shrink-0">
                                  ĐỔI
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[#fff4ed] text-[#b54708] border border-[#fdb022]/40 shrink-0">
                                  TRẢ
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {l.product?.sku}
                              </span>
                              <span className="truncate">{l.product?.name}</span>
                            </span>
                            <span className="font-semibold whitespace-nowrap">
                              {l.quantity} {l.unit_name} •{" "}
                              {l.is_exchange ? (
                                <span className="text-[#175cd3]">không trừ tiền</span>
                              ) : (
                                formatCurrency(Number(l.line_total || 0))
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Net amount summary */}
            {order && (
              (() => {
                const credits = linkedReturns
                  .filter((r) => r.status === "approved" || r.status === "completed")
                  .reduce((s, r) => s + Number(r.credit_note_amount || 0), 0)
                const pending = linkedReturns
                  .filter((r) => r.status === "pending")
                  .reduce((s, r) => s + Number(r.credit_note_amount || 0), 0)
                if (credits === 0 && pending === 0) return null
                const net = Math.max(0, Number(order.total || 0) - credits)
                return (
                  <div className="rounded-lg bg-muted/40 border p-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Tổng đơn</span>
                      <span className="font-semibold">{formatCurrency(Number(order.total || 0))}</span>
                    </div>
                    {credits > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Trừ đơn trả đã duyệt</span>
                        <span className="font-semibold text-[#b54708]">−{formatCurrency(credits)}</span>
                      </div>
                    )}
                    {pending > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Đơn trả chờ duyệt</span>
                        <span className="font-medium">−{formatCurrency(pending)}</span>
                      </div>
                    )}
                    <div className="h-px bg-border" />
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Phải thu khách</span>
                      <span className="text-lg font-black text-primary">
                        {formatCurrency(net)}
                      </span>
                    </div>
                  </div>
                )
              })()
            )}
          </CardContent>
        </Card>
      )}

      {/* Q6 — line-edit activity log */}
      {activityLog.length > 0 && (
        <CollapsibleSection
          title={`Lịch sử sửa dòng đơn (${activityLog.length})`}
          subtitle="Audit log — 100 entry gần nhất"
        >
        <Card className="border-0 bg-transparent shadow-none lg:border lg:bg-surface-container-lowest lg:shadow-card">
          <CardHeader className="hidden lg:flex">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Lịch sử sửa dòng đơn ({activityLog.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Audit log tự ghi mỗi khi có dòng được thêm / sửa / xoá. 100 entry gần nhất.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {activityLog.map((a) => {
                const actionLabel =
                  a.action === "add_line"
                    ? "Thêm dòng"
                    : a.action === "remove_line"
                      ? "Xoá dòng"
                      : "Sửa dòng"
                const actionVariant: "success" | "danger" | "warning" =
                  a.action === "add_line"
                    ? "success"
                    : a.action === "remove_line"
                      ? "danger"
                      : "warning"
                const actor =
                  (a.actor as unknown as { full_name: string } | null)?.full_name ||
                  "Hệ thống"
                const stage = a.workflow_stage || "—"
                const changedKeys = Object.keys(a.changes || {})
                return (
                  <li key={a.id} className="rounded-md border bg-muted/10 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={actionVariant}>{actionLabel}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Stage <span className="font-mono">{stage}</span>
                      </span>
                      <span className="text-xs">{actor}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {formatDate(a.created_at)}
                      </span>
                    </div>
                    {changedKeys.length > 0 && a.action === "edit_line" && (
                      <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
                        {changedKeys.map((k) => {
                          const c = (a.changes as Record<string, { from?: unknown; to?: unknown }>)[k]
                          if (!c || c.from === undefined) return null
                          return (
                            <div key={k}>
                              <span className="font-mono">{k}</span>: {String(c.from)}{" "}
                              <span className="text-foreground">→</span> {String(c.to)}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
        </CollapsibleSection>
      )}

      {/* Status History */}
      <CollapsibleSection title="Lịch sử trạng thái">
      <Card className="border-0 bg-transparent shadow-none lg:border lg:bg-surface-container-lowest lg:shadow-card">
        <CardHeader className="hidden lg:flex">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Lịch sử trạng thái
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusHistory.length === 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Chưa có thay đổi trạng thái nào được ghi nhận
              </p>
              {/*
                "Chờ duyệt" KHÔNG phải một trạng thái — nó là status='draft'
                kèm approval_reason. Trigger trg_log_order_status (mig
                008:152) chỉ ghi khi cột `status` thật sự đổi, nên đơn vừa
                chuyển sang chờ duyệt thì đúng là chưa có gì để ghi. Nói rõ
                ra, không thì người dùng thấy đơn đã "đi qua nháp → chờ
                duyệt" mà lịch sử trống và tưởng mất dữ liệu.
              */}
              <p className="text-xs text-muted-foreground">
                Đơn chờ duyệt vẫn ở trạng thái Nháp nên chưa tính là thay đổi
                trạng thái. Lịch sử bắt đầu ghi từ lúc đơn được duyệt.
              </p>
            </div>
          ) : (
            <div className="relative pl-6">
              {/* Vertical line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-border" />
              <div className="space-y-4">
                {statusHistory.map((entry) => {
                  const fromLabel = entry.from_status ? (ORDER_STATUS_MAP[entry.from_status]?.label || entry.from_status) : "Mới tạo"
                  const toLabel = ORDER_STATUS_MAP[entry.to_status]?.label || entry.to_status
                  const changerName = (entry.changer as unknown as { full_name: string })?.full_name || "Hệ thống"
                  return (
                    <div key={entry.id} className="relative flex items-start gap-3">
                      {/* Dot */}
                      <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-background" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {fromLabel} <span className="text-muted-foreground mx-1">&rarr;</span> {toLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {changerName} &bull; {formatDate(entry.changed_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </CollapsibleSection>

      {/* M4.2 — một thanh hành động duy nhất cho mobile.
          Một nút chính + menu ⋮ cho phần còn lại; "Hủy đơn" và "Xóa đơn"
          KHÔNG bao giờ là nút chính. */}
      {hasMobileActions && (
        <StickyActionBar>
          {primaryTransition ? (
            <Button
              className="h-12 flex-1"
              onClick={() =>
                setConfirmOpen({ status: primaryTransition.value, label: primaryTransition.label })
              }
            >
              <primaryTransition.icon className="mr-2 h-4 w-4" />
              {primaryTransition.label}
            </Button>
          ) : deliveredNext ? (
            <Button className="h-12 flex-1" onClick={deliveredNext.onClick} disabled={deliveredNext.busy}>
              <deliveredNext.icon className="mr-2 h-4 w-4" />
              {deliveredNext.label}
            </Button>
          ) : (
            // Không còn bước tiến nào: chừa chỗ để menu ⋮ vẫn nằm bên phải
            // như mọi trạng thái khác, thay vì nhảy sang trái.
            <span className="flex-1 text-sm text-on-surface-variant">
              {ORDER_STATUS_MAP[order.status]?.label || order.status}
            </span>
          )}
          {(menuTransitions.length > 0 || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-12 w-12 shrink-0 p-0" aria-label="Thao tác khác">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="min-w-52">
                {menuTransitions.map((trans) => (
                  <DropdownMenuItem
                    key={trans.value}
                    className={`h-11 ${trans.value === "cancelled" ? "text-error" : ""}`}
                    onSelect={() => setConfirmOpen({ status: trans.value, label: trans.label })}
                  >
                    <trans.icon className="mr-2 h-4 w-4" /> {trans.label}
                  </DropdownMenuItem>
                ))}
                {canDelete && (
                  <DropdownMenuItem className="h-11 text-error" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Xóa đơn hàng
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </StickyActionBar>
      )}

      {/* Status change confirm */}
      <ConfirmDialog
        open={!!confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(null)}
        title={confirmOpen?.label || "Xác nhận"}
        description={`Xác nhận thao tác "${confirmOpen?.label}" cho đơn ${order.order_code}`}
        variant={confirmOpen?.status === "cancelled" ? "destructive" : "default"}
        onConfirm={() => confirmOpen && handleChangeStatus(confirmOpen.status)}
        loading={actionLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xóa vĩnh viễn đơn hàng?"
        description={`Đơn ${order.order_code} sẽ bị xóa cùng toàn bộ chi tiết. Không thể khôi phục.`}
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      {/* §4.5 Product swap dialog */}
      <Dialog open={!!swapDialogFor} onOpenChange={(o) => !o && setSwapDialogFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Đổi sản phẩm cho dòng đơn</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={swapSearch}
            onChange={(e) => setSwapSearch(e.target.value)}
            placeholder="Tìm theo tên / SKU…"
          />
          <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
            {(() => {
              const q = viNormalize(swapSearch)
              const list = swapCatalog.filter(
                (p) =>
                  !q ||
                  viIncludes(p.name, q) ||
                  viIncludes(p.sku, q)
              )
              if (list.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Không tìm thấy sản phẩm
                  </p>
                )
              }
              return list.slice(0, 30).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    if (swapDialogFor) applySwap(swapDialogFor, p)
                  }}
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.sku}</span>
                    <span>{formatCurrency(Number(p.sell_price || 0))} / {p.base_unit}</span>
                  </div>
                </button>
              ))
            })()}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Đổi SP sẽ reset batch_id để thủ kho chọn lô khác. Giá đơn vị giữ
            nguyên nếu bạn đã sửa, nếu không sẽ lấy giá bán mặc định của SP mới.
          </p>
        </DialogContent>
      </Dialog>

      {/* Q5 — add-line picker. Reuses swapCatalog (loaded on edit-mode open). */}
      <Dialog open={addLineDialogOpen} onOpenChange={setAddLineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Thêm sản phẩm mới vào đơn</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={addLineSearch}
            onChange={(e) => setAddLineSearch(e.target.value)}
            placeholder="Tìm theo tên / SKU…"
          />
          <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
            {(() => {
              const q = viNormalize(addLineSearch)
              const list = swapCatalog.filter(
                (p) =>
                  !q ||
                  viIncludes(p.name, q) ||
                  viIncludes(p.sku, q)
              )
              if (list.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {swapCatalog.length === 0
                      ? "Đang tải danh mục..."
                      : "Không tìm thấy sản phẩm"}
                  </p>
                )
              }
              return list.slice(0, 30).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors"
                  onClick={() => appendAddedLine(p)}
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                    <span className="font-mono">{p.sku}</span>
                    <span>
                      {formatCurrency(Number(p.sell_price || 0))} / {p.base_unit}
                    </span>
                  </div>
                </button>
              ))
            })()}
          </div>
          <p className="text-[11px] text-muted-foreground">
            SP mới sẽ được thêm với SL=1 và đơn giá mặc định. Bạn có thể chỉnh
            trước khi bấm Lưu dòng đơn.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
