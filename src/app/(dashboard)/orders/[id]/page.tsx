"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { canDeleteOrder, deleteOrder } from "@/lib/orders/delete"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { orderTone } from "@/lib/orders/status-tone"
import {
  DetailHero, StatusPill, DetailCard, DetailRow, DetailTimeline, DetailCustomerCard,
  type TimelineStep,
} from "@/components/detail/detail-chrome"
import { PaymentStatusBadge } from "@/components/ui/status-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { closeOrder } from "@/lib/orders/post-invoice"
import { ensureEInvoiceRow, publishEInvoice } from "@/lib/einvoice/publish"
import { INVOICE_STATUS_MAP } from "@/lib/constants"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { misaStatusBadge } from "@/lib/misa/labels"
import { viIncludes, viNormalize } from "@/lib/search"
import { ORDER_STATUS_MAP, PAYMENT_TERMS } from "@/lib/constants"
import { Package2, XCircle, Pencil, Trash2, X, CreditCard, ExternalLink, Clock, FileText, RefreshCw, AlertCircle, Lock, Plus, MoreVertical, Phone, Send, Undo2, PackageCheck, Archive, Printer } from "lucide-react"
import { StickyActionBar } from "@/components/ui/sticky-action-bar"
import { MobileOrderDetail } from "@/components/orders/mobile-order-detail"
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
import {
  canEditOrder,
  canFullEditOrder,
  whyCannotEdit,
} from "@/lib/orders/edit-permission"
import { loadApprovalContext } from "@/lib/sell/approval-context"
import { sendOrder, grossFromSavedLines } from "@/lib/sell/send-order"
import { evaluateApproval } from "@/lib/approval"
import { isSellEditable } from "@/lib/sell/order-edit"
import { lineDiscountOf, lineTotalOf } from "@/lib/sell/create-order"
import { returnReasonLabel } from "@/lib/sell/returns"
import { useEntityLock } from "@/hooks/use-entity-lock"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import type { SalesOrder, SalesOrderLine, OrderStatus, OrderStatusHistory, Invoice } from "@/types"
import { errorMessage } from "@/lib/errors"

type NextStatus = {
  value: OrderStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  /**
   * Bước LÙI: rút đơn về, huỷ đơn. Không bao giờ được làm nút chính —
   * nút chính là cái to nhất trên thanh dính đáy, và đặt một bước lùi ở
   * đó là mời người ta bấm nhầm để rồi đơn biến khỏi mắt nhà phân phối.
   */
  backward?: boolean
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

/**
 * Bước chuyển trạng thái làm được bằng MỘT lệnh ghi từ màn hình.
 *
 * ⚠ BA TRẠNG THÁI CỦA HÓA ĐƠN KHÔNG CÓ Ô NÀO Ở ĐÂY, và ô rỗng là câu
 * trả lời đúng chứ không phải chỗ chưa làm xong. `partially_invoiced`,
 * `completed`, `closed` trừ kho và đụng công nợ, nên chỉ RPC của
 * migration 125 mới đặt được; trigger ở 124 chặn mọi lệnh ghi thẳng.
 * Nút của chúng (Xuất hàng · Đóng đơn) dựng riêng, không đi qua bảng
 * này.
 *
 * ⚠ ĐƠN ĐÃ XUẤT KHÔNG HUỶ ĐƯỢC TỪ ĐÂY NỮA. Hàng đã rời kho thuộc về một
 * hóa đơn, và chỉ `cancel_invoice` mới biết hoàn về đúng lô nào. Mở một
 * ô "Hủy đơn" cho `completed` là dựng đường thứ hai cùng đụng tồn kho.
 */
const STATUS_FLOW: Record<OrderStatus, NextStatus[]> = {
  draft: [
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager", "sales"], backward: true },
  ],
  submitted: [
    /**
     * RÚT VỀ NHÁP — đường lùi duy nhất của phiếu tạm. Gửi nhầm đơn thì
     * cách chữa cũ là huỷ nó rồi soạn lại từ đầu; rút về nháp giữ nguyên
     * dòng hàng để sửa. Hàng chưa rời kho nên không đụng gì tới tồn.
     *
     * ⚠ Chỉ còn mở khi đơn CHƯA xuất. Migration 119 chặn completed →
     * draft ở trigger, nên bấm nhầm ở đơn đã xuất là một lỗi P0001 chứ
     * không phải một đơn bị kéo ngược.
     */
    { value: "draft", label: "Rút về nháp", icon: Undo2, roles: ["owner", "manager", "sales"], backward: true },
    { value: "cancelled", label: "Hủy đơn", icon: XCircle, roles: ["owner", "manager", "sales"], backward: true },
  ],
  partially_invoiced: [],
  completed: [],
  closed: [],
  cancelled: [],
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [receivableId, setReceivableId] = useState<string | null>(null)
  /**
   * Hóa đơn bán của đơn này. Một đơn đẻ ra 0..n hóa đơn từ v2b.
   *
   * ⚠ LẤY CẢ HÓA ĐƠN ĐÃ HUỶ. Giấu chúng đi thì một đơn quay từ "Hoàn
   * thành" về "Phiếu tạm" trông như chưa từng có chuyện gì xảy ra, và
   * phiếu nhập hoàn kho nằm trong danh sách phiếu kho không có gì giải
   * thích.
   */
  const [salesInvoices, setSalesInvoices] = useState<
    Array<{
      id: string
      invoice_code: string
      invoice_date: string
      status: string
      total: number
      stock_entry_id: string | null
      replaced_by: string | null
      cancel_reason: string | null
    }>
  >([])
  const [receivables, setReceivables] = useState<
    Array<{ id: string; invoice_id: string | null; amount: number; paid: number; status: string; due_date: string | null }>
  >([])
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
      /**
       * Giá bảng của dòng, suy ngược từ chính dòng đang có:
       * `unit_price + line_discount / quantity`.
       *
       * ⚠ KHÔNG LẤY TỪ `products.sell_price`. Giá bảng là giá theo ĐƠN VỊ
       * BÁN và theo NHÓM GIÁ của khách (`unitPriceFor`), nên `sell_price`
       * trần trụi sai ngay với dòng bán theo thùng hoặc khách có bảng giá
       * riêng — và sai theo kiểu vẫn ra một con số trông hợp lý.
       */
      list_price: number
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
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeReason, setCloseReason] = useState("")
  const [closing, setClosing] = useState(false)
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
    const [orderRes, linesRes, recRes, historyRes, invoiceRes, deliveryLinesRes, stockEntriesRes, returnsRes, activityRes, salesInvoicesRes] = await Promise.all([
      supabase.from("sales_orders").select("id, org_id, order_code, customer_id, sales_user_id, order_date, expected_delivery, status, current_workflow_stage, payment_terms, subtotal, discount, vat, total, merged_into, notes, approved_by, approved_at, approval_reason, created_at, customer:customers(*, group:customer_groups(name)), sales_user:users!sales_orders_sales_user_id_fkey(*)").eq("id", id).single(),
      supabase.from("sales_order_lines").select("id, order_id, product_id, unit_name, quantity, unit_price, line_discount, line_total, batch_id, note, conversion_factor, product:products(*)").eq("order_id", id),
      /**
       * ⚠ KHÔNG `maybeSingle()` NỮA. Từ v2b mỗi HÓA ĐƠN một dòng công
       *   nợ, nên đơn xuất hai đợt có hai dòng — và `maybeSingle()` trên
       *   hai dòng là lỗi PGRST116, cả trang trắng chứ không phải một ô
       *   hiện sai. Cộng lại để ô "Công nợ" nói về cả đơn.
       */
      supabase
        .from("receivables")
        .select("id, invoice_id, amount, paid, status, due_date")
        .eq("order_id", id)
        .order("due_date", { ascending: true }),
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
      supabase
        .from("sales_invoices")
        .select("id, invoice_code, invoice_date, status, total, stock_entry_id, replaced_by, cancel_reason")
        .eq("order_id", id)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false }),
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

    /**
     * ⚠ KHÔNG CÒN TRUY VẤN `v_sales_order_line_picked` — migration 119 đã
     * `DROP VIEW` nó cùng với bước soạn hàng. Truy vấn một quan hệ không
     * tồn tại chỉ ghi một dòng đỏ ra console rồi trả về rỗng, nhưng nó
     * nằm giữa `setLoading(true)` và `setLoading(false)` nên mỗi lần mở
     * đơn là một vòng gọi mạng thừa TRƯỚC khi màn hiện ra.
     *
     * Workflow v2 không có bước pick, nên "đã soạn bao nhiêu" luôn là 0 —
     * đúng thứ `isLineLocked` cần để không khoá dòng nào. Giữ `state` lại
     * vì bộ kiểm tra sửa đơn còn đọc nó.
     */
    setPickedByLine({})

    const recRows = (recRes.data as Array<{
      id: string
      invoice_id: string | null
      amount: number
      paid: number
      status: string
      due_date: string | null
    }> | null) ?? []
    setReceivables(recRows)
    /**
     * ⚠ GỘP, KHÔNG LẤY DÒNG ĐẦU. Đơn xuất hai đợt có hai dòng nợ; hiện
     * dòng đầu là nói khách nợ một nửa số thật.
     *
     * ⚠ TRẠNG THÁI GỘP LẤY THEO CHỖ XẤU NHẤT: còn một dòng chưa trả hết
     * thì cả đơn chưa trả hết. Lấy `status` của dòng đầu thì một đơn có
     * đợt 1 đã thu, đợt 2 chưa thu sẽ hiện "đã thanh toán".
     */
    setReceivableId(recRows[0]?.id || null)
    setReceivable(
      recRows.length > 0
        ? {
            amount: recRows.reduce((a, r) => a + Number(r.amount || 0), 0),
            paid: recRows.reduce((a, r) => a + Number(r.paid || 0), 0),
            status: recRows.some((r) => r.status !== "paid") ? "open" : "paid",
            due_date:
              recRows.map((r) => r.due_date).filter(Boolean).sort()[0] ?? null,
          }
        : null
    )
    setStatusHistory((historyRes.data as unknown as OrderStatusHistory[]) || [])
    setDeliveryLines(((deliveryLinesRes.data as unknown) as DeliveryLineWithDetails[]) || [])
    setStockEntries(((stockEntriesRes.data as unknown) as OrderStockEntry[]) || [])
    setLinkedReturns(((returnsRes.data as unknown) as typeof linkedReturns) || [])
    setActivityLog(((activityRes.data as unknown) as typeof activityLog) || [])
    setSalesInvoices(((salesInvoicesRes.data as unknown) as typeof salesInvoices) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * NVBH gửi đơn nháp của mình đi: `draft` → `submitted`.
   *
   * ⚠ TRƯỚC ĐÂY KHÔNG CÓ ĐƯỜNG NÀY. Bảng `STATUS_FLOW` chỉ cho owner/manager
   * bấm "Duyệt đơn", còn NVBH chỉ có "Huỷ đơn" — lưu nháp xong là đơn nằm
   * im, nhà phân phối không thấy, và người duy nhất biết nó tồn tại là
   * người soạn nó. Workflow v2 không còn bước duyệt: bộ quy tắc vẫn chạy
   * nhưng chỉ để ghi CẢNH BÁO cho nhà phân phối đọc trước khi xuất hàng.
   */
  const handleSendOrder = async () => {
    if (!order || !user?.org_id) return
    setActionLoading(true)
    try {
      const ctx = await loadApprovalContext(supabase, {
        orgId: order.org_id,
        customerId: order.customer_id,
        salesUserId: order.sales_user_id ?? user.id,
      })
      // Bộ quy tắc chỉ còn sinh CẢNH BÁO cho nhà phân phối đọc trước khi
      // xuất hàng — nó không chặn ai và không quyết trạng thái nữa.
      const subtotal = Number(order.subtotal || 0)
      // Số TRƯỚC chiết khấu lấy từ dòng đã lưu — xem chú thích của
      // `grossFromSavedLines`.
      const gross = grossFromSavedLines(subtotal, lines)
      const warn = ctx.failed
        ? "Không đọc được công nợ / quy tắc — kiểm tay trước khi xuất hàng."
        : evaluateApproval(ctx.rules, {
            orderTotal: Number(order.total || 0),
            grossBeforeDiscount: gross,
            discountAmount: Math.max(0, gross - subtotal),
            customer: order.customer
              ? { id: order.customer_id, credit_limit: Number(order.customer.credit_limit || 0) }
              : null,
            customerDebt: ctx.customerDebt,
            customerOverdue: ctx.customerOverdue,
            repPortfolioDebt: ctx.repPortfolioDebt,
            role: user.role,
          }).reason

      await sendOrder(supabase, { orderId: order.id, reason: warn })
      toast({ title: "Đã gửi đơn", description: warn || undefined })
      fetchData()
    } catch (error) {
      toast({
        title: "Không gửi được đơn",
        description: errorMessage(error),
        variant: "destructive",
      })
    } finally {
      setActionLoading(false)
    }
  }

  /**
   * PHÁT HÀNH HOÁ ĐƠN ĐIỆN TỬ cho đơn này.
   *
   * ⚠ MỐC LÀ HÓA ĐƠN BÁN, KHÔNG PHẢI ĐƠN. Bản cũ lập hoá đơn điện tử
   *   thẳng từ `sales_orders` với tổng tiền của cả đơn. Từ v2b một đơn có
   *   thể xuất làm hai đợt — làm thế thì cả hai lần đều khai toàn bộ đơn,
   *   khách bị xuất thuế hai lần cho cùng một lô hàng, và hoá đơn đã phát
   *   hành thì không sửa được.
   *
   * ⚠ NHIỀU HƠN MỘT HÓA ĐƠN THÌ DỪNG, KHÔNG ĐOÁN. Chọn bừa một cái là
   *   phát hành nhầm chứng từ thuế. Chỉ đường sang trang hóa đơn bán để
   *   người dùng tự chọn.
   */
  const handleXuatHoaDon = async () => {
    if (!order || !user) return
    setMisaLoading(true)
    try {
      const posted = salesInvoices.filter((si) => si.status === "posted")
      if (posted.length === 0) {
        throw new Error(
          "Đơn chưa có hóa đơn bán nào — xuất hàng trước rồi mới phát hành hoá đơn điện tử."
        )
      }
      if (posted.length > 1) {
        throw new Error(
          `Đơn có ${posted.length} hóa đơn bán. Mở từng hóa đơn ở mục Hóa đơn bán rồi phát hành riêng — phát hành gộp là khai sai chứng từ thuế.`
        )
      }

      const { data: si, error: siErr } = await supabase
        .from("sales_invoices")
        .select(
          "id, org_id, order_id, invoice_code, status, subtotal, vat, total, customer:customers(store_name, billing_name, billing_address, address, tax_code)"
        )
        .eq("id", posted[0].id)
        .single()
      if (siErr || !si) throw new Error(siErr?.message || "Không đọc được hóa đơn bán")

      const raw = (si as { customer: unknown }).customer
      const currentInvoiceId = await ensureEInvoiceRow(supabase, {
        ...(si as unknown as {
          id: string; org_id: string; order_id: string; invoice_code: string
          status: string; subtotal: number; vat: number; total: number
        }),
        customer: (Array.isArray(raw) ? raw[0] : raw) as never,
      })

      const data = await publishEInvoice(currentInvoiceId)

      toast({
        title: data.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${data.invNo ? `Số HĐ: ${data.invNo} · ` : ""}Mã tra cứu: ${data.lookupCode || "—"}${data.sandbox ? " (sandbox)" : ""}`,
      })
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi xuất hóa đơn", description: errorMessage(error), variant: "destructive" })
    } finally {
      setMisaLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [fetchData])

  const handleChangeStatus = async (newStatus: OrderStatus) => {
    if (!order || !user) return
    setActionLoading(true)
    try {
      const { data: statusRows, error } = await supabase
        .from("sales_orders")
        .update({ status: newStatus })
        .eq("id", order.id)
        .select("id")
      if (error) throw error
      // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. Báo "Đã chuyển
      // trạng thái" cho một lệnh chưa chạy là cách nhanh nhất để hai người
      // hiểu đơn đang ở hai bước khác nhau.
      if (!statusRows || statusRows.length === 0) {
        throw new Error(
          "Không đổi được trạng thái đơn — bạn không có quyền ở bước này. Tải lại trang để xem trạng thái mới."
        )
      }

      if (
        newStatus === "cancelled" &&
        user.org_id &&
        order.sales_user_id &&
        order.sales_user_id !== user.id
      ) {
        const { createNotification } = await import("@/lib/notifications")
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

      toast({ title: `Đã chuyển trạng thái: ${ORDER_STATUS_MAP[newStatus]?.label ?? newStatus}` })
      setConfirmOpen(null)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: errorMessage(error), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }
  const handleDelete = async () => {
    if (!order) return
    setActionLoading(true)
    try {
      // ⚠ PHẢI LẤY VỀ DÒNG ĐÃ XOÁ, không chỉ kiểm `error`.
      //
      // RLS chặn thì PostgREST trả 200 kèm mảng RỖNG và KHÔNG có lỗi —
      // trước mig 113 `sales_orders` không hề có policy DELETE, nên mọi
      // lần bấm xoá đều "thành công" mà không xoá gì. Người dùng quay về
      // danh sách và thấy đơn vẫn nằm đó.
      //
      // Dòng hàng có ON DELETE CASCADE, phiếu trả chưa duyệt đi theo nhờ
      // trigger mig 118 — chỉ cần xoá đơn. Xem `deleteOrder`.
      await deleteOrder(supabase, order.id)
      toast({ title: "Đã xóa đơn hàng" })
      router.push("/orders")
    } catch (error) {
      toast({ title: "Lỗi", description: errorMessage(error), variant: "destructive" })
      setActionLoading(false)
    }
  }

  const startLinesEdit = async () => {
    setEditedLines(
      lines.map((l) => {
        const qty = Number(l.quantity || 0)
        const price = Number(l.unit_price || 0)
        const disc = Number(l.line_discount || 0)
        return {
          id: l.id,
          quantity: qty,
          unit_price: price,
          line_discount: disc,
          // qty = 0 thì không có phép chia nào, mà cũng không có chiết
          // khấu nào để suy ra: giá bảng = giá đang áp.
          list_price: qty > 0 ? price + disc / qty : price,
        }
      })
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
      prev.map((l) => {
        if (l.id !== lineId) return l
        // Pick up the new product's default sell price unless the user has
        // already manually edited the price in this session.
        const price =
          l.unit_price === Number(lines.find((x) => x.id === lineId)?.unit_price || 0)
            ? Number(product.sell_price || 0)
            : l.unit_price
        return {
          ...l,
          swap_product_id: product.id,
          swap_product_name: product.name,
          swap_sku: product.sku,
          unit_price: price,
          // ⚠ Giá bảng của dòng cũ nói về một MẶT HÀNG KHÁC — giữ lại là
          // ghi một khoản chiết khấu so với giá của thứ không còn ở đây.
          // Không biết giá bảng của hàng mới theo đơn vị này và theo nhóm
          // giá của khách, nên để bằng giá đang áp: "không ghi nhận chiết
          // khấu", thay vì một con số bịa.
          list_price: price,
        }
      })
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
    (s, l) => s + lineTotalOf({ qty: l.quantity, price: l.unit_price }),
    0
  )
  // Q5: live total includes new draft lines.
  const addedLinesTotal = addedLines.reduce(
    (s, l) => s + Math.max(0, l.quantity * l.unit_price),
    0
  )

  /**
   * Khoản trừ hàng trả ĐÃ NẰM TRONG `order.total`.
   *
   * ⚠ ĐÂY LÀ PHÉP SUY, KHÔNG PHẢI PHÉP CỘNG. `cartTotals` ghi
   * `grandTotal = subtotal + vat − returnCredit`, nên khoảng hụt giữa
   * (tạm tính + VAT) và tổng CHÍNH LÀ khoản trừ đã áp. Cộng lại từ bảng
   * `returns` thì sai trong đúng ca hay gặp nhất: phiếu trả bị huỷ sau
   * khi đơn đã lưu — `order.total` không được tính lại, nên phép cộng ra
   * 0 và khoảng hụt vẫn nằm đó không ai giải thích.
   *
   * ⚠ KẸP VỀ 0. Đơn cũ lưu bằng công thức khác có thể cho hiệu âm; một
   * dòng "Trừ hàng trả: −(−5.000)" thì thà đừng vẽ.
   */
  /** Tên bảng giá của khách — ô "BẢNG GIÁ" trong mẫu. */
  const priceGroupName =
    (order?.customer as unknown as { group?: { name?: string | null } | null } | undefined)
      ?.group?.name ?? null

  const orderReturnCredit = order
    ? Math.max(
        0,
        Number(order.subtotal || 0) + Number(order.vat || 0) - Number(order.total || 0)
      )
    : 0

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
      // Cột giai đoạn đã bị gỡ ở migration 119; luật sửa dòng giờ đi theo
      // chính trạng thái đơn.
      const stage: WorkflowStage = order.status === "completed" ? "closed" : "draft"
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

      // Cập nhật từng line.
      //
      // ⚠ `line_total` = qty × giá, KHÔNG trừ `line_discount`. Chiết khấu
      //   đã nằm trong giá; trừ lần nữa là trừ hai lần — và dòng này GHI
      //   xuống cơ sở dữ liệu, nên con số sai nằm lại đó.
      //
      // ⚠ `line_discount` phải tính lại theo số lượng và giá MỚI. Nó là
      //   số tiền, không phải tỉ lệ: sửa 10 thùng xuống 5 mà giữ nguyên
      //   khoản giảm là ghi nhớ một khoản chiết khấu chưa từng cho.
      for (const l of editedLines) {
        const money = { qty: l.quantity, price: l.unit_price, listPrice: l.list_price }
        const update: Record<string, unknown> = {
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: lineTotalOf(money),
          line_discount: lineDiscountOf(money),
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

      // Workflow v2 không còn bước duyệt, nên sửa dòng chỉ cập nhật lại
      // tổng. Đơn đã xuất hàng thì không đi đường này — nó có RPC riêng.
      const headerUpdate: Record<string, unknown> = { subtotal, total }

      const { data: headerRows, error: orderErr } = await supabase
        .from("sales_orders")
        .update(headerUpdate)
        .eq("id", order.id)
        .select("id")
      if (orderErr) throw orderErr
      /**
       * ⚠ RLS TỪ CHỐI MÀ KHÔNG BÁO LỖI. Lệnh UPDATE không khớp chính sách
       * nào thì Postgres sửa 0 dòng, PostgREST trả HTTP 200 và `error` là
       * null. Không kiểm số dòng ở đây thì màn hình báo "Đã cập nhật" trong
       * khi dòng hàng đã đổi còn tổng tiền thì không — đơn sai lệch mà
       * không ai được báo.
       */
      if (!headerRows || headerRows.length === 0) {
        throw new Error(
          "Đã sửa dòng hàng nhưng KHÔNG cập nhật được tổng đơn — bạn không còn quyền sửa đơn này. Tải lại trang và báo quản lý."
        )
      }

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
        description: errorMessage(err),
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
      // Điều khoản và ngày giao chỉ đổi khi hàng chưa rời kho. Đơn đã
      // xuất thì chỉ còn sửa ghi chú ở màn này.
      if (order.status === "draft" || order.status === "submitted") {
        updates.payment_terms = editForm.payment_terms
        updates.expected_delivery = editForm.expected_delivery || null
      }
      const { data: rows, error } = await supabase
        .from("sales_orders")
        .update(updates)
        .eq("id", order.id)
        .select("id")
      if (error) throw error
      // ⚠ Cùng cái bẫy như bên lưu dòng hàng: RLS từ chối thì 0 dòng, HTTP
      // 200, không lỗi. Không kiểm thì màn hình báo thành công cho một
      // lệnh chưa bao giờ chạy.
      if (!rows || rows.length === 0) {
        throw new Error(
          "Không lưu được — bạn không còn quyền sửa đơn này (có thể kho đã bắt đầu lấy hàng). Tải lại trang để xem trạng thái mới."
        )
      }
      toast({ title: "Đã cập nhật đơn hàng" })
      setEditMode(false)
      fetchData()
    } catch (error) {
      toast({ title: "Lỗi", description: errorMessage(error), variant: "destructive" })
    } finally {
      setActionLoading(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!order) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy đơn hàng</div>

  const availableTransitions = STATUS_FLOW[order.status] || []
  // Luật "ai sửa được gì" nằm trong `@/lib/orders/edit-permission`, không
  // viết thẳng ở đây nữa: nó phải KHỚP chính sách RLS (mig 115), và một
  // biểu thức boolean giữa trang 2.300 dòng thì không đối chiếu được với
  // gì cả.
  const editCtx = user
    ? {
        role: user.role,
        userId: user.id,
        status: order.status,
        salesUserId: order.sales_user_id ?? null,
        hasUpdatePermission: hasPermission(user.role, "orders", "update"),
      }
    : null
  const canEdit = !!editCtx && canEditOrder(editCtx)
  const fullEdit = !!editCtx && canFullEditOrder(editCtx)
  const cannotEditReason = editCtx ? whyCannotEdit(editCtx) : null
  // ⚠ Một phép gài cho cả ba màn, chép đúng chính sách database (mig 113 +
  // 117) — trước đây nút này gài theo bảng phân quyền, mà bảng đó không
  // cấp orders.delete cho NVBH, nên NVBH không thấy nút xoá nháp của mình.
  const canDelete =
    !!user &&
    canDeleteOrder(user, order, hasPermission(user.role, "orders", "delete"))

  // M4.2 — trên điện thoại, thẻ "Thao tác" nằm CUỐI cột phụ, tức là sau
  // khách hàng + thông tin đơn + công nợ + hoá đơn. Đo trên đơn 8 dòng:
  // phải cuộn 3.400px mới thấy nút "Duyệt đơn". Gom lại thành MỘT thanh
  // dính đáy: hành động chính hiện thành nút, phần còn lại vào menu ⋮.
  const roleTransitions = availableTransitions.filter(
    (t) => !!user && t.roles.includes(user.role)
  )
  // Hành động chính = bước TIẾN của luồng. Bước LÙI (rút về nháp, huỷ
  // đơn) không bao giờ là hành động chính — để nó ở nút to là mời người
  // ta bấm nhầm.
  const primaryTransition = roleTransitions.find((t) => !t.backward) || null
  const menuTransitions = roleTransitions.filter((t) => t !== primaryTransition)
  /**
   * Việc còn lại của đơn ĐÃ XUẤT.
   *
   * ⚠ KHÔNG CÒN NÚT "GHI NHẬN CÔNG NỢ". Workflow v2 sinh công nợ TRONG
   * `complete_order`, cùng một giao dịch với lệnh trừ kho. Đơn đã xuất mà
   * chưa có công nợ nghĩa là dữ liệu lệch, không phải một việc còn dở —
   * để nút ở đây là mời người dùng tự vá bằng tay lên một chỗ hỏng mà
   * không ai biết vì sao hỏng.
   */
  /**
   * XUẤT HÀNG — hành động chính của đơn chưa giao xong.
   *
   * ⚠ ĐƠN ĐÃ XUẤT MỘT PHẦN VẪN CÒN NÚT NÀY. Bỏ đi là đơn giao đợt một
   * xong thì không còn đường nào giao nốt phần còn lại, và người dùng
   * phải quay ra danh sách tìm lại chính đơn vừa mở.
   */
  const canInvoice =
    !!user &&
    hasPermission(user.role, "orders", "approve") &&
    (order.status === "submitted" || order.status === "partially_invoiced")
  const invoiceAction = canInvoice
    ? { label: "Xuất hàng", icon: PackageCheck, onClick: () => router.push(`/sales-invoices/new?order=${order.id}`), busy: false }
    : null
  /**
   * ĐÓNG ĐƠN — chốt không giao nốt phần còn lại.
   *
   * ⚠ KHÁC HUỶ ĐƠN, và chỉ hiện khi đã xuất một phần. Đơn chưa xuất gì
   * mà "đóng" thì đúng ra là HUỶ, và huỷ có đường riêng. Đây cũng là chỗ
   * DUY NHẤT trong ứng dụng gọi `close_order` — bỏ nút là hàm đó thành
   * mã chết, và đơn giao thiếu kẹt ở "Xuất một phần" vĩnh viễn.
   */
  const closeAction =
    canInvoice && order.status === "partially_invoiced"
      ? { label: "Đóng đơn", icon: Archive, onClick: () => setCloseOpen(true), busy: false }
      : null
  const deliveredNext =
    order.status === "completed" && !invoice
      ? { label: misaLoading ? "Đang xuất hóa đơn..." : "Xuất hóa đơn", icon: FileText, onClick: handleXuatHoaDon, busy: misaLoading }
      : null
  /**
   * Hai việc của mẫu thiết kế "Chi tiết đơn": SỬA ĐƠN (mở lại đúng màn
   * bán hàng) và ĐẶT LẠI ĐƠN NÀY (chép dòng vào đơn mới, giá hôm nay).
   * Chúng chỉ là nút CHÍNH khi không còn bước chuyển trạng thái nào và
   * đơn không còn việc dở nào (xem `deliveredNext`).
   */
  const sellEdit = canEdit && isSellEditable(order.status)
  const canReorder = !!user && hasPermission(user.role, "orders", "create")
  const editAction = sellEdit
    ? { label: "Sửa đơn", icon: Pencil, onClick: () => router.push(`/sell/edit/${order.id}`), busy: false }
    : null
  const reorderAction = canReorder
    ? { label: "Đặt lại đơn này", icon: RefreshCw, onClick: () => router.push(`/sell/reorder/${order.id}`), busy: false }
    : null
  // ⚠ XUẤT HÀNG ĐỨNG TRƯỚC MỌI THỨ. Đó là việc người ta mở đơn ra để
  //   làm; để nó trong menu ⋮ là giấu hành động chính.
  const mobilePrimary = primaryTransition
    ? null
    : invoiceAction ?? deliveredNext ?? editAction ?? reorderAction
  // Nút nào không làm nút chính thì vào menu ⋮.
  const mobileExtras = [closeAction, editAction, reorderAction].filter(
    (a): a is NonNullable<typeof a> => !!a && a !== mobilePrimary
  )
  const hasMobileActions =
    !!primaryTransition || !!mobilePrimary || menuTransitions.length > 0 || mobileExtras.length > 0 || !!canDelete
  /**
   * ⚠ Bản mobile theo mẫu là MÀN ĐỌC. Đang sửa dòng (kho/quản lý ở bước
   * lấy hàng) hay sửa thông tin đơn thì trang quay về bản có ô nhập —
   * mẫu không vẽ ô nhập nào, và nhét vào là vẽ lại toàn bộ luật khoá dòng.
   */
  const mobileTemplate = !linesEditMode && !editMode

  // Hai khung cảnh báo — dùng cho CẢ bản desktop lẫn bản mobile, một JSX.
  const callouts = (
    <>
      {/* Cảnh báo kèm đơn — nhà phân phối đọc trước khi bấm Xuất hàng. */}
      {order.status === "submitted" && !!order.approval_reason && (
        <div className="rounded-xl border border-[#fdb022]/40 bg-[#fff4ed] p-4 flex items-start gap-3">
          <div className="shrink-0 h-8 w-8 rounded-full bg-[#fdb022] text-on-primary flex items-center justify-center font-bold text-sm">
            !
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[#b54708] text-sm">Cần xem lại trước khi xuất hàng</p>
            <p className="text-xs text-[#b54708]/90 mt-0.5 whitespace-pre-wrap">
              {order.approval_reason}
            </p>
          </div>
        </div>
      )}

      {/* Đơn còn là nháp: nhà phân phối chưa nhìn thấy nó. */}
      {order.status === "draft" && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm">Bản nháp — chưa gửi</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Nhà phân phối chưa nhìn thấy đơn này. Bấm Gửi đơn khi đã nhập xong.
            </p>
          </div>
          {canEdit && (
            <Button onClick={handleSendOrder} disabled={actionLoading || lines.length === 0}>
              <Send className="h-4 w-4 mr-1.5" />
              {actionLoading ? "Đang gửi..." : "Gửi đơn"}
            </Button>
          )}
        </div>
      )}
    </>
  )

  /**
   * ⚠ DÒNG TÓM TẮT NÓI ĐỦ BỐN THỨ người ta mở đơn ra để xem: khi nào,
   *   bao nhiêu mặt hàng, tuyến nào, ai bán. Thiếu một cái là phải cuộn
   *   xuống tìm — mà đó đúng là thứ mẫu thiết kế gộp lên đầu trang.
   */
  /**
   * HÀNG NÚT Ở ĐẦU TRANG — cùng bộ với ngăn Xem nhanh, cộng hai nút của
   * mẫu (In đơn · Đặt lại đơn này).
   *
   * ⚠ CHỦ NHÀ BÁO: "vào chi tiết đơn hàng cũng phải đầy đủ các nút như
   *   màn Xem nhanh". Trước đó mọi hành động nằm trong thẻ "Thao tác" ở
   *   cột phải — người mở đơn từ ngăn xem nhanh sang chi tiết thấy nút
   *   biến mất và tưởng mình hết quyền.
   *
   * ⚠ KHÔNG DỰNG LẠI HÀNH VI. Mỗi nút gọi đúng thứ thẻ "Thao tác" gọi;
   *   thẻ đó GIỮ NGUYÊN vì nó còn các bước lùi (Rút về nháp) và nút Xoá
   *   đơn. Chép logic ra hai chỗ là hai chỗ để lệch.
   *
   * ⚠ HUỶ ĐƠN LẤY TỪ `roleTransitions`, không tự dựng điều kiện. Bảng
   *   `STATUS_FLOW` mới là nơi nói đơn ở trạng thái nào thì huỷ được, và
   *   nó đã lọc theo vai trò.
   */
  const cancelTransition = roleTransitions.find((t) => t.value === "cancelled") ?? null
  const heroActions = (
    <>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="mr-1.5 h-4 w-4" /> In đơn
      </Button>
      {reorderAction && (
        <Button variant="outline" onClick={reorderAction.onClick}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> {reorderAction.label}
        </Button>
      )}
      {editAction && (
        <Button variant="outline" onClick={editAction.onClick}>
          <Pencil className="mr-1.5 h-4 w-4" /> {editAction.label}
        </Button>
      )}
      {closeAction && (
        <Button variant="outline" onClick={closeAction.onClick}>
          <Archive className="mr-1.5 h-4 w-4" /> {closeAction.label}
        </Button>
      )}
      {cancelTransition && (
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive"
          onClick={() => setConfirmOpen({ status: cancelTransition.value, label: cancelTransition.label })}
        >
          <XCircle className="mr-1.5 h-4 w-4" /> {cancelTransition.label}
        </Button>
      )}
      {/* ⚠ XUẤT HÀNG ĐỨNG CUỐI, tức ngoài cùng bên phải và là nút ĐẶC.
          Đó là việc người ta mở đơn ra để làm. */}
      {invoiceAction && (
        <Button onClick={invoiceAction.onClick}>
          <PackageCheck className="mr-1.5 h-4 w-4" /> {invoiceAction.label}
        </Button>
      )}
      {!invoiceAction && deliveredNext && (
        <Button onClick={deliveredNext.onClick} disabled={deliveredNext.busy}>
          <FileText className="mr-1.5 h-4 w-4" /> {deliveredNext.label}
        </Button>
      )}
    </>
  )

  const creditLimit = Number(order.customer?.credit_limit || 0)
  /**
   * ⚠ CÔNG NỢ CỦA ĐƠN NÀY, không phải tổng nợ của khách. Mẫu vẽ "công nợ
   *   / hạn mức" của khách, nhưng màn này chỉ nạp dòng nợ của đơn đang
   *   mở — lấy nó rồi gắn nhãn "công nợ khách" là nói sai. Nhãn dưới đây
   *   vì thế nói đúng thứ đang đo.
   */
  const customerDebt = Math.max(
    0,
    Number(receivable?.amount || 0) - Number(receivable?.paid || 0)
  )
  const paymentTermLabel =
    PAYMENT_TERMS.find((t) => t.value === order.payment_terms)?.label ??
    order.payment_terms ??
    "—"

  const heroSummary = [
    `Đặt ${formatDate(order.order_date)}`,
    `${lines.length} mặt hàng`,
    order.customer?.store_name || null,
    order.sales_user?.full_name ? `NVBH ${order.sales_user.full_name}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  /**
   * ⚠ TIẾN TRÌNH ĐỌC TỪ TRẠNG THÁI THẬT, không vẽ sẵn bốn mốc rồi tô
   *   xanh theo cảm tính. Đơn huỷ và đơn đóng sớm KHÔNG đi hết đường —
   *   vẽ chúng như đang chờ bước sau là hứa một việc sẽ không xảy ra.
   */
  const heroTimeline: TimelineStep[] = (() => {
    const st = order.status
    const done = (k: string) => `Xong · ${formatDate(k)}`
    if (st === "cancelled") {
      return [
        { label: "Tạo đơn", detail: formatDate(order.order_date), state: "done" as const },
        { label: "Đã huỷ", detail: order.approval_reason || "—", state: "done" as const },
      ]
    }
    return [
      {
        label: "Tạo đơn",
        detail: `${formatDate(order.order_date)}${order.sales_user?.full_name ? ` · ${order.sales_user.full_name}` : ""}`,
        state: "done" as const,
      },
      {
        /**
         * ⚠ "GỬI ĐƠN", KHÔNG PHẢI "GỬI DUYỆT". Workflow v2 không có người
         *   duyệt; chữ "duyệt" còn sót trên màn là chỉ NVBH đi ngồi đợi
         *   một bước không tồn tại, trong khi việc thật là nhà phân phối
         *   bấm Xuất hàng. Chốt ở `orders-mobile-template.test.ts` canh
         *   đúng chỗ này và đã bắt được tôi.
         */
        label: "Gửi đơn",
        detail: st === "draft" ? "Còn là bản nháp, NPP chưa thấy" : "Đã gửi cho NPP",
        state: st === "draft" ? "current" : "done",
      },
      {
        label: "Xuất hàng",
        detail:
          st === "completed"
            ? order.completed_at
              ? done(order.completed_at)
              : "Đã xuất đủ"
            : st === "partially_invoiced"
              ? "Mới xuất một phần — còn hàng nằm lại trên đơn"
              : st === "closed"
                ? "Đã đóng đơn, không giao nốt phần còn lại"
                : "Chưa xuất",
        state:
          st === "completed" || st === "closed"
            ? "done"
            : st === "partially_invoiced"
              ? "current"
              : st === "submitted"
                ? "current"
                : "todo",
      },
      {
        label: "Hoá đơn điện tử",
        detail: invoice ? "Đã tạo" : "Chưa phát hành",
        state: invoice ? "done" : "todo",
      },
    ]
  })()

  return (
    <div className={`space-y-4 ${hasMobileActions ? "pb-nav-action" : ""}`}>
      {mobileTemplate && (
        <div className="lg:hidden">
          <MobileOrderDetail
            order={order}
            lines={lines}
            statusHistory={statusHistory}
            receivable={receivable}
            receivableId={receivableId}
            invoice={invoice}
            deliveryLines={deliveryLines}
            linkedReturns={linkedReturns}
            activityLog={activityLog}
            showSalesName={user?.role !== "sales"}
            callout={callouts}
            onBack={() => router.push("/orders")}
          />
        </div>
      )}

      <div className={mobileTemplate ? "hidden lg:block space-y-4" : "space-y-4"}>
      {/* ⚠ ĐƯỜNG VỀ PHẢI CÒN. Mẫu vẽ nó ở thanh trên cùng — thanh đó là
          khung ứng dụng chung, nên ở trang giữ một liên kết nhỏ, nếu
          không mở đơn từ đâu cũng thành ngõ cụt. */}
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface"
      >
        ← Đơn hàng
      </Link>

      <DetailHero
        code={order.order_code}
        summary={heroSummary}
        actions={heroActions}
        status={
          <>
            <StatusPill label={orderTone(order.status).label} tone={orderTone(order.status)} />
            <PaymentStatusBadge receivable={receivable} />
          </>
        }
      >
        {/* ⚠ ĐÃ BỎ `ApprovalBadge`. Nó gắn nhãn "Cần Owner duyệt" /
            "Cần Manager duyệt" theo NGƯỠNG TIỀN, mà workflow v2 không có
            người duyệt — và mọi đơn đều đi qua `draft` nên nhãn đó hiện
            trên gần như đơn nào cũng có. Nhân viên đọc xong ngồi đợi một
            bước không tồn tại. Cảnh báo thật nằm ở khung `callouts` ngay
            dưới, lấy từ `approval_reason`. Component giữ nguyên trong
            kho, chỉ không gọi ở đây nữa. */}
      </DetailHero>

      {callouts}

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

      {/*
        KHỐI KHÁCH HÀNG theo mẫu — chỉ bản máy tính, vì bản điện thoại đã
        có khối tóm tắt riêng ngay trên.

        ⚠ CÔNG NỢ LẤY TỪ DÒNG NỢ CỦA ĐƠN, không cộng lại từ tổng đơn. Đơn
          đã thu một phần thì hai số đó khác nhau, và số đúng là số trong
          sổ công nợ.

        ⚠ CHƯA CÓ HẠN MỨC THÌ KHÔNG VẼ THANH. Thanh chạy trên một hạn mức
          bằng 0 thì hoặc luôn đầy hoặc chia cho 0 — cả hai đều nói dối.
      */}
      <div className="hidden lg:block">
        <DetailCustomerCard
          href={order.customer_id ? `/customers/${order.customer_id}` : null}
          name={order.customer?.store_name || "Khách lẻ"}
          contact={[order.customer?.phone, order.customer?.address].filter(Boolean).join(" · ")}
          stats={[
            ...(creditLimit > 0
              ? [
                  {
                    label: "Công nợ / hạn mức",
                    value: (
                      <>
                        {formatCurrency(customerDebt)}{" "}
                        <span className="font-medium text-on-surface-variant">
                          / {formatCurrency(creditLimit)}
                        </span>
                      </>
                    ),
                    bar: {
                      pct: (customerDebt / creditLimit) * 100,
                      tone: customerDebt > creditLimit ? "#f04438" : "#d99b0d",
                    },
                  },
                ]
              : []),
            /* ⚠ Ô "BẢNG GIÁ" CỦA MẪU. Không có nhóm giá thì KHÔNG vẽ ô
               trống có nhãn — nhãn trên một ô rỗng đọc như dữ liệu chưa
               tải xong (xem `DetailCustomerCard`). */
            ...(priceGroupName ? [{ label: "Bảng giá", value: priceGroupName }] : []),
            { label: "Hình thức", value: paymentTermLabel },
            { label: "NV bán hàng", value: order.sales_user?.full_name || "—" },
          ]}
        />
      </div>

      {/*
        ⚠ `items-start` — ĐÂY LÀ CHỖ HAI MÀN CHI TIẾT LỆCH NHAU. Màn hóa
          đơn dựng bằng `DetailColumns`, vốn có `items-start` + `self-start`;
          màn này tự dựng lưới và thiếu cả hai, nên ô lưới kéo thẻ "Chi
          tiết sản phẩm" cao bằng cả cột phải — đơn một mặt hàng ra một
          mảng trắng dài hơn nửa màn. Giữ hai chỗ giống nhau đến từng
          khoảng cách, đúng như `detail-chrome.tsx` đã nói.
      */}
      <div className="grid items-start gap-5 lg:grid-cols-3">
        {/*
          ⚠ CỘT TRÁI PHẢI CÓ BỌC. Thẻ "Mặt hàng" và thẻ "Ghi chú" đều rộng
            2 cột; để chúng làm con TRỰC TIẾP của lưới thì thẻ thứ hai
            không lọt vào hàng đầu (chỉ còn 1 cột trống) nên rơi xuống
            hàng dưới, kéo cả cột phải xuống theo. Bọc lại thì cột phải
            vẫn nằm cạnh bảng hàng.
        */}
        <div className="space-y-5 lg:col-span-2">
        {/* Left column - details */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              {/* ⚠ TÊN THEO MẪU: "Mặt hàng", kèm dòng phụ đếm dòng — người
                  đọc biết bảng này dài bao nhiêu trước khi cuộn. */}
              <CardTitle className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
                Mặt hàng{" "}
                <span className="ml-1 font-semibold normal-case tracking-normal">
                  {lines.length} dòng
                </span>
              </CardTitle>
              {false && (
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
                <div className="flex gap-1">
                  {/* ⚠ Trên điện thoại, bảng SL/đơn giá ở đây là một cách
                      nhập hàng KHÁC với màn bán hàng đã dùng lúc tạo đơn —
                      hai cách cho cùng một việc. Nút này đưa về đúng màn đó:
                      thêm hàng, đổi đơn vị, sửa giá, rồi Lưu. */}
                  {isSellEditable(order.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="md:hidden"
                      onClick={() => router.push(`/sell/edit/${order.id}`)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Sửa bằng màn bán hàng
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={startLinesEdit}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Sửa SL &amp; đơn giá
                  </Button>
                </div>
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
                    const liveTotal = inEdit
                      ? lineTotalOf({ qty: liveQty, price: livePrice })
                      : line.line_total
                    // T-03: dòng đã pick → khoá giảm SL + đổi SP. Chỉ tính lock
                    // khi đơn đang ở stage 'picking'; trước đó user có toàn
                    // quyền sửa.
                    const pickedBase = pickedByLine[line.id] || 0
                    const lineLocked =
                      false && isLineLocked(pickedBase)
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
                              {/*
                                DÒNG PHỤ THEO MẪU: mã SP · SL × đơn giá, phông
                                đều nét.

                                ⚠ NÓ TRẢ LỜI ĐÚNG CÂU NGƯỜI ĐỌC HAY HỎI —
                                  "thành tiền này ở đâu ra". Mẫu để phép nhân
                                  ngay dưới tên hàng nên không phải liếc qua
                                  ba cột rồi nhân nhẩm.
                                ⚠ ẨN KHI ĐANG SỬA: lúc ấy SL và đơn giá nằm
                                  trong ô nhập, còn dòng này in số ĐÃ LƯU —
                                  hai con số khác nhau cạnh nhau, không ai
                                  biết cái nào là thật.
                              */}
                              {!inEdit && (
                                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                  {line.product?.sku ? `${line.product.sku} · ` : ""}
                                  {line.quantity} {line.unit_name} × {formatCurrency(line.unit_price)}
                                </div>
                              )}
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
                  const liveTotal = inEdit
                    ? lineTotalOf({ qty: liveQty, price: livePrice })
                    : line.line_total
                  // T-03: dòng đã pick → khoá giảm SL.
                  const pickedBase = pickedByLine[line.id] || 0
                  const lineLocked =
                    false && isLineLocked(pickedBase)
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

          </CardContent>
        </Card>

        {/*
          GHI CHÚ — mẫu để nó thành THẺ RIÊNG dưới bảng hàng, không nhét
          vào ô thông tin đơn bên phải.

          ⚠ CHỈ VẼ KHI CÓ CHỮ. Một thẻ "Ghi chú: Không có" chiếm đúng chỗ
            của thứ người đọc đang tìm, và lần nào cũng phải đọc để biết
            nó rỗng.
          ⚠ `whitespace-pre-wrap`: ghi chú giao hàng hay xuống dòng ("gọi
            trước 15 phút"), gộp thành một đoạn là mất ý.
        */}
        {order.notes && (
          <DetailCard
            title="Ghi chú"
            bodyClassName="whitespace-pre-wrap px-4 py-3.5 text-sm"
          >
            {order.notes}
          </DetailCard>
        )}
        </div>

        {/* Right column - customer + actions + edit */}
        <div className="space-y-5 self-start lg:sticky lg:top-4">
          {/*
            CỘNG TIỀN — theo mẫu, khối này nằm ở ĐẦU cột phải.

            ⚠ ĐÃ BỎ THẺ "KHÁCH HÀNG" TRÙNG Ở ĐÂY. Tên, điện thoại, địa chỉ
              và NV bán đã nằm trong `DetailCustomerCard` ngay dưới tiêu
              đề trang. Hiện hai lần trên cùng một màn là người đọc phải tự
              kiểm xem hai chỗ có khớp nhau không.
          */}
          <DetailCard title="Cộng tiền">
            <DetailRow
              label="Tạm tính"
              value={
                linesEditMode
                  ? formatCurrency(editedLinesTotal + addedLinesTotal)
                  : formatCurrency(order.subtotal)
              }
            />
            {/*
              ⚠ CHIẾT KHẤU ĐÃ NẰM TRONG TẠM TÍNH, KHÔNG TRỪ LẦN NỮA.
                `cartTotals` tính `subtotal = Σ qty × giá ĐANG ÁP`, còn
                `discount` chỉ là phần chênh so với giá bảng — ghi nhớ, không
                phải một phép trừ. Vẽ nó kèm dấu trừ giữa Tạm tính và Tổng là
                mời người đọc trừ thêm một lần và ra một con số không có
                thật. Nên ghi rõ "đã tính trong tạm tính".
            */}
            {Number(order.discount || 0) > 0 && (
              <DetailRow
                label="Chiết khấu (đã tính trong tạm tính)"
                value={formatCurrency(order.discount)}
              />
            )}
            <DetailRow label="VAT" value={formatCurrency(order.vat)} />
            {/*
              TRỪ HÀNG TRẢ — chủ nhà yêu cầu hiện ngay ở ô Cộng tiền.

              ⚠ KHOẢN NÀY VỐN ĐÃ NẰM TRONG `order.total`. `cartTotals` ghi
                `grandTotal = subtotal + vat − returnCredit`, nên đơn có hàng
                trả hiện Tạm tính 114.000 mà Tổng 90.600, và KHÔNG có dòng
                nào giải thích 23.400 biến đi đâu. Người đọc hoặc tưởng máy
                tính sai, hoặc tự nghĩ ra một lý do.

              ⚠ SUY TỪ BA CON SỐ ĐÃ LƯU, KHÔNG CỘNG LẠI TỪ PHIẾU TRẢ. Phiếu
                trả bị huỷ sau khi lên đơn thì `order.total` KHÔNG được tính
                lại — cộng từ phiếu sẽ ra 0 và để nguyên khoảng hụt. Lấy
                đúng khoảng hụt thì dòng này luôn giải thích được con số
                đang hiện, dù khoảng hụt ấy từ đâu ra.
            */}
            {orderReturnCredit > 0 && (
              <DetailRow
                label="Trừ hàng trả"
                value={`−${formatCurrency(orderReturnCredit)}`}
              />
            )}
            <DetailRow
              strong
              label="Tổng tiền"
              value={
                linesEditMode
                  ? formatCurrency(
                      Math.max(
                        0,
                        editedLinesTotal +
                          addedLinesTotal -
                          Number(order.discount || 0) +
                          Number(order.vat || 0)
                      )
                    )
                  : formatCurrency(order.total)
              }
            />
            {/* ⚠ ĐANG SỬA THÌ NÓI RÕ SỐ NÀY CHƯA VÀO SỔ. Không nói thì
                người đọc tưởng đơn đã đổi tổng. */}
            {linesEditMode && (
              <p className="mt-2 text-xs text-on-surface-variant">
                Đang sửa — tổng chỉ vào sổ khi bấm{" "}
                <span className="font-semibold">Lưu dòng đơn</span>.
              </p>
            )}
          </DetailCard>

          {/* Edit panel */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Thanh toán &amp; giao hàng</CardTitle>
              {canEdit && !editMode && (
                <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-1" /> Sửa
                </Button>
              )}
              {/* ⚠ Nút biến mất không một lời giải thích là lý do người
                  dùng phải nhắn đi hỏi. Nói thẳng vì sao không sửa được. */}
              {!canEdit && cannotEditReason && (
                <span className="text-xs text-muted-foreground">{cannotEditReason}</span>
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
                      Đơn đã rời khỏi tay bạn — chỉ sửa được ghi chú. Các trường khác chỉ mở khi
                      đơn còn là nháp hoặc phiếu tạm.
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

          {/*
            HÓA ĐƠN BÁN CỦA ĐƠN NÀY.

            ⚠ HIỆN CẢ HÓA ĐƠN ĐÃ HUỶ. Giấu chúng đi thì một đơn quay từ
              "Hoàn thành" về "Phiếu tạm" trông như chưa từng có chuyện
              gì, và phiếu nhập hoàn kho nằm trong sổ kho không có gì
              giải thích.
          */}
          {salesInvoices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Hóa đơn bán ({salesInvoices.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {salesInvoices.map((si) => (
                  <div
                    key={si.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{si.invoice_code}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(si.invoice_date)}
                        {si.cancel_reason ? ` • ${si.cancel_reason}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm tabular-nums">{formatCurrency(si.total)}</span>
                      <Badge variant={INVOICE_STATUS_MAP[si.status]?.variant ?? "secondary"}>
                        {INVOICE_STATUS_MAP[si.status]?.label ?? si.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Receivable status */}
          {(order.status === "completed" ||
            order.status === "partially_invoiced" ||
            order.status === "closed") && (
            <Card>
              <CardHeader><CardTitle>Công nợ</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {/*
                  ⚠ MỖI HÓA ĐƠN MỘT DÒNG NỢ, nên liệt kê hết thay vì dẫn
                    vào dòng đầu. Đơn xuất hai đợt mà chỉ hiện một liên
                    kết thì đợt kia trông như chưa ghi nợ, và người dùng
                    đi tạo tay một dòng thứ hai đã tồn tại sẵn.
                */}
                {receivables.length > 0 ? (
                  receivables.map((rc) => (
                    <Link
                      key={rc.id}
                      href={`/receivables/${rc.id}`}
                      className="flex items-center justify-between rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <CreditCard className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">
                            {salesInvoices.find((si) => si.id === rc.invoice_id)?.invoice_code ??
                              "Đã ghi nhận công nợ"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Còn nợ {formatCurrency(Math.max(0, Number(rc.amount || 0) - Number(rc.paid || 0)))}
                            {rc.due_date ? ` • đến hạn ${formatDate(rc.due_date)}` : ""}
                          </p>
                        </div>
                      </div>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))
                ) : (
                  /* ⚠ ĐÂY LÀ DẤU HIỆU DỮ LIỆU LỆCH, KHÔNG PHẢI VIỆC CÒN DỞ.
                     `post_invoice` sinh công nợ trong cùng giao dịch với
                     lệnh trừ kho, nên đơn đã xuất thì phải có công nợ. Nói
                     ra để người ta đi tìm nguyên nhân, đừng đưa nút vá tay. */
                  <div className="space-y-1 rounded-lg bg-[#fff4ed] p-3">
                    <p className="text-sm font-bold text-[#b54708]">
                      Đơn đã xuất hàng nhưng không tìm thấy công nợ
                    </p>
                    <p className="text-xs text-[#b54708]/90">
                      Công nợ được sinh cùng lúc xuất hàng. Thiếu ở đây là dữ liệu lệch — báo quản
                      trị kiểm lại, đừng tạo tay.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Hóa đơn MISA */}
          {order.status === "completed" && (
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
          {/* ⚠ TIẾN TRÌNH ĐẶT NGAY TRÊN THAO TÁC, theo mẫu. Người mở đơn ra
              nhìn "đang ở đâu" trước rồi mới quyết định bấm gì; đảo hai
              khối là bắt họ quyết trước khi biết.
              ⚠ NẰM NGOÀI điều kiện hiện thẻ Thao tác: đơn đã xong không còn
              bước nào để bấm, nhưng tiến trình của nó vẫn là thứ người ta
              mở đơn ra để tra. */}
          <DetailCard title="Tiến trình" className="hidden lg:block">
            <DetailTimeline steps={heroTimeline} />
          </DetailCard>

          {(roleTransitions.length > 0 || canDelete) && (
            <Card className="hidden lg:block">
              <CardHeader><CardTitle>Thao tác</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {/* ⚠ DÙNG `roleTransitions`, KHÔNG PHẢI `availableTransitions`.
                    Bản mobile lọc theo vai trò rồi mới vẽ; thẻ này thì vẽ cả
                    bảng rồi lọc bên trong bằng `return null`, nên điều kiện
                    hiện thẻ ở trên đếm cả những bước người dùng không có
                    quyền — thẻ "Thao tác" rỗng hiện ra cho vai trò không làm
                    được gì.
                    ⚠ Và mọi bước ở đây đều là bước LÙI (v2 không còn bước
                    tiến nào làm được bằng một lệnh ghi thẳng), nên KHÔNG
                    dùng variant "default" — nút xanh đậm to nhất thẻ là chỗ
                    mắt rơi vào đầu tiên, đặt "Rút về nháp" ở đó là mời bấm
                    nhầm. */}
                {roleTransitions.map((trans) => {
                  const Icon = trans.icon
                  const isDestructive = trans.value === "cancelled"
                  return (
                    <Button
                      key={trans.value}
                      variant={isDestructive ? "destructive" : "outline"}
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
              Hàng chỉ nhập lại kho và trừ vào công nợ khi phiếu trả được HOÀN THÀNH.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {linkedReturns.map((r) => {
              // ⚠ BẢN CHÉP THỨ BA của danh sách lý do trả. Hai bản kia vừa
              // gộp về `@/lib/constants`; để bản này lại là chỗ duy nhất
              // còn nói khác đi khi ai đó thêm một lý do mới.
              const reasonLabel = returnReasonLabel(r.reason)
              /**
               * ⚠ BỐN TRẠNG THÁI CỦA WORKFLOW V2, không phải bốn cái cũ.
               * `chk_returns_status_v2` (mig 119) chỉ còn cho
               * draft/submitted/completed/cancelled — bảng nhãn cũ để lại
               * thì phiếu trả nào cũng rơi xuống `|| r.status` và hiện chữ
               * "submitted" trần ra giữa màn tiếng Việt.
               */
              const statusVariant: "warning" | "success" | "danger" | "secondary" =
                r.status === "completed"
                  ? "success"
                  : r.status === "cancelled"
                    ? "danger"
                    : r.status === "submitted"
                      ? "warning"
                      : "secondary"
              const statusLabel =
                {
                  draft: "Nháp",
                  submitted: "Chờ xử lý",
                  completed: "Đã hoàn tất",
                  cancelled: "Đã huỷ",
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
                /**
                 * ⚠ CHỈ PHIẾU TRẢ ĐÃ HOÀN THÀNH MỚI TRỪ CÔNG NỢ. Trong v2,
                 * `complete_return` là nơi duy nhất nhập kho và cấn trừ —
                 * đếm cả phiếu chưa hoàn thành vào đây là màn hình báo
                 * khách còn nợ ít hơn thực tế.
                 */
                const credits = linkedReturns
                  .filter((r) => r.status === "completed")
                  .reduce((s, r) => s + Number(r.credit_note_amount || 0), 0)
                const pending = linkedReturns
                  .filter((r) => r.status === "submitted")
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
                        <span className="text-muted-foreground">Trừ đơn trả đã hoàn thành</span>
                        <span className="font-semibold text-[#b54708]">−{formatCurrency(credits)}</span>
                      </div>
                    )}
                    {pending > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Đơn trả chờ xử lý</span>
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
                Trigger trg_log_order_status (mig 008:152) chỉ ghi khi cột
                `status` thật sự đổi. Đơn còn là nháp thì đúng là chưa có gì
                để ghi — nói rõ ra, không thì người dùng thấy lịch sử trống
                và tưởng mất dữ liệu.
              */}
              <p className="text-xs text-muted-foreground">
                Lịch sử bắt đầu ghi từ lúc đơn được gửi đi.
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

      </div>

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
          ) : mobilePrimary ? (
            <Button className="h-12 flex-1" onClick={mobilePrimary.onClick} disabled={mobilePrimary.busy}>
              <mobilePrimary.icon className="mr-2 h-4 w-4" />
              {mobilePrimary.label}
            </Button>
          ) : (
            // Không còn bước tiến nào: chừa chỗ để menu ⋮ vẫn nằm bên phải
            // như mọi trạng thái khác, thay vì nhảy sang trái.
            <span className="flex-1 text-sm text-on-surface-variant">
              {ORDER_STATUS_MAP[order.status]?.label || order.status}
            </span>
          )}
          {(menuTransitions.length > 0 || mobileExtras.length > 0 || canDelete) && (
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
                {mobileExtras.map((a) => (
                  <DropdownMenuItem key={a.label} className="h-11" onSelect={a.onClick}>
                    <a.icon className="mr-2 h-4 w-4" /> {a.label}
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


      <ConfirmDialog
        open={closeOpen}
        onOpenChange={(o) => !closing && setCloseOpen(o)}
        title="Đóng đơn, không giao phần còn lại?"
        description="Phần đã xuất vẫn tính doanh thu và công nợ như cũ. Phần chưa xuất sẽ thôi, và đơn không mở lại được trừ khi huỷ một hóa đơn."
        confirmLabel="Đóng đơn"
        loading={closing}
        onConfirm={async () => {
          setClosing(true)
          try {
            await closeOrder(supabase, order.id, closeReason.trim())
            toast({ title: `Đã đóng đơn ${order.order_code}` })
            setCloseOpen(false)
            setCloseReason("")
            fetchData()
          } catch (e) {
            toast({ title: "Không đóng được đơn", description: errorMessage(e), variant: "destructive" })
          } finally {
            setClosing(false)
          }
        }}
      >
        <div>
          <Label
            htmlFor="close-reason"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Lý do
          </Label>
          <Textarea
            id="close-reason"
            rows={2}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            placeholder="Ví dụ: khách không lấy nốt, hàng ngừng kinh doanh"
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}
