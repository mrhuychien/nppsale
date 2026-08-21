"use client"

import { useEffect, useMemo, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import {
  ORDER_COLUMNS,
  DEFAULT_ORDER_COLUMNS,
  ORDER_FILTERS,
  DEFAULT_ORDER_FILTERS,
  type OrderColumnKey,
  type OrderFilterKey,
} from "./list-config"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PaymentStatusBadge, StatusBadge } from "@/components/ui/status-badge"
import {
  OrderPipeline,
  classifyOrder,
  type PipelineStepKey,
} from "@/components/orders/order-pipeline"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Filter,
  Plus,
  Search,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react"
import type { Customer, Invoice, SalesOrder, User } from "@/types"

export default function OrdersPage() {
  const { user, loading: authLoading } = useRoleGuard("orders")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const isDriver = authUser?.role === "driver"
  const { toast } = useToast()
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [invoiceMap, setInvoiceMap] = useState<Record<string, Invoice>>({})
  const [customers, setCustomers] = useState<Pick<Customer, "id" | "store_name">[]>([])
  const [salesUsers, setSalesUsers] = useState<Pick<User, "id" | "full_name">[]>([])
  const [receivablesByOrder, setReceivablesByOrder] = useState<
    Record<string, { amount: number; paid: number; status: string; due_date: string | null }>
  >({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [misaLoadingId, setMisaLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [pipelineStep, setPipelineStep] = useState<PipelineStepKey | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [salesFilter, setSalesFilter] = useState("all")
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "orders",
    DEFAULT_ORDER_COLUMNS,
    DEFAULT_ORDER_FILTERS
  )
  const show = (k: OrderColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: OrderFilterKey) => activeFilters.includes(k)

  // Deep-link: /orders?status=draft → preselect the status filter.
  // /orders?q=SO-... → điền ô tìm kiếm (từ ô tìm nhanh trên header).
  useEffect(() => {
    const s = searchParams.get("status")
    if (s) setStatusFilter(s)
    const q = searchParams.get("q")
    if (q !== null) setSearch(q)
  }, [searchParams])

  // Load metadata (customers, users) + counts theo status — 1 lần khi mount.
  useEffect(() => {
    async function loadMeta() {
      const [customersRes, usersRes] = await Promise.all([
        supabase.from("customers").select("id, store_name").order("store_name"),
        supabase.from("users").select("id, full_name, role").in("role", ["sales", "manager", "owner"]).order("full_name"),
      ])
      const qErr2 = ([customersRes, usersRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr2) console.error("[app/orders] truy vấn lỗi:", qErr2.message)
      setCustomers((customersRes.data as Pick<Customer, "id" | "store_name">[]) || [])
      setSalesUsers((usersRes.data as Pick<User, "id" | "full_name">[]) || [])

      // Count theo status — chính xác tổng, không phụ thuộc pagination.
      const statuses = ["draft", "confirmed", "picking", "delivering", "delivered", "cancelled"]
      const [{ count: totalC }, ...statusResps] = await Promise.all([
        supabase.from("sales_orders").select("id", { count: "exact", head: true }),
        ...statuses.map((s) =>
          supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("status", s)
        ),
      ])
      const pendApprRes = await supabase
        .from("sales_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft")
        .not("approval_reason", "is", null)
      const counts: Record<string, number> = { all: totalC ?? 0 }
      statuses.forEach((s, i) => { counts[s] = statusResps[i].count ?? 0 })
      counts.pending_approval = pendApprRes.count ?? 0
      setStatusCounts(counts)
    }
    loadMeta()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page về 1 mỗi khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, statusFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, pipelineStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query — filter server-side, paginate.
  useEffect(() => {
    let cancelled = false
    async function fetchOrders() {
      setLoading(true)
      // selectResilient: nếu DB production thiếu cột (lệch migration) thì tự thử
      // lại với '*' thay vì trả danh sách rỗng im lặng; luôn trả error để hiển thị.
      const build = (select: string) => {
        let q = supabase
          .from("sales_orders")
          .select(select, { count: "exact" })
          .order("created_at", { ascending: false })
          .range(pg.from, pg.to)
        if (debouncedSearch) {
          const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
          q = q.ilike("order_code", term)
        }
        if (statusFilter === "pending_approval") {
          q = q.eq("status", "draft").not("approval_reason", "is", null)
        } else if (statusFilter !== "all") {
          q = q.eq("status", statusFilter)
        }
        if (customerFilter !== "all") q = q.eq("customer_id", customerFilter)
        if (salesFilter !== "all") q = q.eq("sales_user_id", salesFilter)
        if (dateFrom) q = q.gte("order_date", dateFrom)
        if (dateTo) q = q.lte("order_date", dateTo + "T23:59:59")
        if (amountMin) q = q.gte("total", parseFloat(amountMin))
        if (amountMax) q = q.lte("total", parseFloat(amountMax))
        return q
      }
      const res = await selectResilient<SalesOrder>(
        build,
        "id, org_id, order_code, customer_id, sales_user_id, order_date, expected_delivery, status, current_workflow_stage, payment_terms, subtotal, discount, vat, total, merged_into, notes, approved_by, approved_at, approval_reason, created_at, customer:customers(store_name, phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name)",
        // eslint-disable-next-line no-restricted-syntax
        "*, customer:customers(store_name, phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
      )
      if (cancelled) return
      const ordersData = res.data
      setOrders(ordersData)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)

      // Load receivables + invoices CHỈ cho orders đang hiển thị trên page.
      const ids = ordersData.map((o) => o.id)
      if (ids.length > 0) {
        const [recvRes, invRes] = await Promise.all([
          supabase
            .from("receivables")
            .select("order_id, amount, paid, status, due_date")
            .in("order_id", ids),
          supabase.from("invoices").select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at, misa_invoice_id, misa_invoice_url, misa_status, misa_error, misa_sent_at, misa_signed_at, misa_lookup_code, misa_published_at").in("order_id", ids),
        ])
        const qErr = ([recvRes, invRes] as Array<{ error?: { message?: string } | null }>)
          .find((r) => r?.error)?.error
        if (qErr) console.error("[app/orders] truy vấn lỗi:", qErr.message)
        if (cancelled) return
        const recvMap: Record<string, { amount: number; paid: number; status: string; due_date: string | null }> = {}
        for (const r of (recvRes.data as Array<{ order_id: string | null; amount: number; paid: number; status: string; due_date: string | null }>) || []) {
          if (r.order_id) recvMap[r.order_id] = { amount: r.amount, paid: r.paid, status: r.status, due_date: r.due_date }
        }
        setReceivablesByOrder(recvMap)
        const invMap: Record<string, Invoice> = {}
        for (const inv of (invRes.data as Invoice[]) || []) {
          if (inv.order_id) invMap[inv.order_id] = inv
        }
        setInvoiceMap(invMap)
      } else {
        setReceivablesByOrder({})
        setInvoiceMap({})
      }
      setLoading(false)
    }
    fetchOrders()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, statusFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Đã filter server-side (search/status/customer/sales/date/amount).
  // Chỉ còn pipelineStep filter client-side vì cần tổng hợp receivable+invoice.
  // Note: pipeline filter chỉ áp dụng trên trang hiện tại — chấp nhận trade-off
  // để khỏi phải replicate classifyOrder() trong SQL.
  const filtered = useMemo(() => {
    if (!pipelineStep) return orders
    return orders.filter(
      (o) => classifyOrder(o, receivablesByOrder[o.id], invoiceMap[o.id]) === pipelineStep
    )
  }, [orders, pipelineStep, receivablesByOrder, invoiceMap])

  if (authLoading) return <Skeleton className="h-96" />

  const allSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id))
  const someSelected = filtered.some((o) => selectedIds.has(o.id))

  const toggleAll = () => {
    const next = new Set(selectedIds)
    if (allSelected) {
      filtered.forEach((o) => next.delete(o.id))
    } else {
      filtered.forEach((o) => next.add(o.id))
    }
    setSelectedIds(next)
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const clearSelection = () => setSelectedIds(new Set())

  const canApprove = user && hasPermission(user.role, "orders", "approve")

  const handleBulkApprove = async () => {
    if (!user || !canApprove) return
    const ids = Array.from(selectedIds)
    setBulkLoading(true)
    try {
      const { error } = await supabase
        .from("sales_orders")
        .update({
          status: "confirmed",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          approval_reason: null,
        })
        .in("id", ids)
      if (error) throw error

      // Notify each sales rep (fire-and-forget)
      const approvedOrders = orders.filter(
        (o) => ids.includes(o.id) && o.sales_user_id && o.sales_user_id !== user.id
      )
      if (approvedOrders.length > 0 && user.org_id) {
        const { createNotification } = await import("@/lib/notifications")
        for (const o of approvedOrders) {
          createNotification(supabase, {
            orgId: user.org_id,
            userId: o.sales_user_id,
            type: "order_approved",
            title: `Đơn ${o.order_code} đã được duyệt`,
            body: `Bởi ${user.full_name || "Quản lý"}`,
            linkUrl: `/orders/${o.id}`,
            metadata: { order_id: o.id, order_code: o.order_code },
          })
        }
      }

      setOrders((prev) =>
        prev.map((o) =>
          ids.includes(o.id)
            ? { ...o, status: "confirmed", approved_by: user.id, approval_reason: null }
            : o
        )
      )
      toast({ title: `Đã duyệt ${ids.length} đơn hàng` })
      clearSelection()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setBulkLoading(false)
    }
  }

  // Bulk cancel — only applies to orders not yet delivered/cancelled
  const handleBulkCancel = async () => {
    if (!user) return
    const selected = orders.filter((o) => selectedIds.has(o.id))
    const cancellable = selected.filter(
      (o) => o.status !== "delivered" && o.status !== "cancelled"
    )
    if (cancellable.length === 0) {
      toast({ title: "Không có đơn nào hủy được", variant: "destructive" })
      return
    }
    if (!confirm(`Hủy ${cancellable.length} đơn hàng? Không thể hoàn tác.`)) return
    const ids = cancellable.map((o) => o.id)
    setBulkLoading(true)
    try {
      const { error } = await supabase
        .from("sales_orders")
        .update({ status: "cancelled" })
        .in("id", ids)
      if (error) throw error

      if (user.org_id) {
        const { createNotification } = await import("@/lib/notifications")
        for (const o of cancellable) {
          if (o.sales_user_id && o.sales_user_id !== user.id) {
            createNotification(supabase, {
              orgId: user.org_id,
              userId: o.sales_user_id,
              type: "order_cancelled",
              title: `Đơn ${o.order_code} đã bị hủy`,
              body: `Bởi ${user.full_name || "Quản lý"}`,
              linkUrl: `/orders/${o.id}`,
              metadata: { order_id: o.id, order_code: o.order_code },
            })
          }
        }
      }

      setOrders((prev) =>
        prev.map((o) => (ids.includes(o.id) ? { ...o, status: "cancelled" as const } : o))
      )
      toast({ title: `Đã hủy ${ids.length} đơn` })
      clearSelection()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setBulkLoading(false)
    }
  }

  // Bulk transition — advance selected orders to the next status. Only enabled
  // when all selected share the same status.
  const NEXT_STATUS: Partial<Record<string, { to: "picking" | "delivering" | "delivered"; label: string }>> = {
    confirmed: { to: "picking", label: "Bắt đầu lấy hàng" },
    picking: { to: "delivering", label: "Xuất kho giao hàng" },
    delivering: { to: "delivered", label: "Xác nhận đã giao" },
  }

  const handleBulkAdvance = async () => {
    if (!user) return
    const selected = orders.filter((o) => selectedIds.has(o.id))
    if (selected.length === 0) return
    const firstStatus = selected[0].status
    const allSame = selected.every((o) => o.status === firstStatus)
    if (!allSame) {
      toast({
        title: "Trạng thái không đồng nhất",
        description: "Chọn các đơn cùng trạng thái để chuyển sang bước tiếp theo",
        variant: "destructive",
      })
      return
    }
    const next = NEXT_STATUS[firstStatus]
    if (!next) {
      toast({ title: "Không có bước tiếp theo", variant: "destructive" })
      return
    }

    // Confirmed → picking goes through the stock-out screen so the warehouse
    // can review the pick list, scan barcodes, and create the export entry
    // before the orders flip to "picking".
    if (firstStatus === "confirmed") {
      const ids = selected.map((o) => o.id)
      router.push(`/inventory/stock-out?orderIds=${ids.join(",")}`)
      return
    }

    if (!confirm(`${next.label} cho ${selected.length} đơn?`)) return

    const ids = selected.map((o) => o.id)
    setBulkLoading(true)
    try {
      const { error } = await supabase
        .from("sales_orders")
        .update({ status: next.to })
        .in("id", ids)
      if (error) throw error

      setOrders((prev) =>
        prev.map((o) => (ids.includes(o.id) ? { ...o, status: next.to } : o))
      )
      toast({ title: `Đã chuyển ${ids.length} đơn → ${next.label}` })
      clearSelection()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setBulkLoading(false)
    }
  }

  const handleExportCsv = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id))
    const headers = ["Mã đơn", "Khách hàng", "NV bán hàng", "Ngày đặt", "Tổng tiền", "Trạng thái"]
    const rows = selected.map((o) => [
      o.order_code,
      o.customer?.store_name || "",
      o.sales_user?.full_name || "",
      o.order_date,
      String(o.total),
      o.status,
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Đã xuất ${selected.length} đơn hàng` })
  }

  const resetAdvanced = () => {
    setDateFrom("")
    setDateTo("")
    setCustomerFilter("all")
    setSalesFilter("all")
    setAmountMin("")
    setAmountMax("")
  }

  const handleXuatHoaDonList = async (order: SalesOrder) => {
    setMisaLoadingId(order.id)
    try {
      // Auto-create invoice if none exists
      let invoiceId = invoiceMap[order.id]?.id
      if (!invoiceId) {
        const customer = order.customer as Record<string, unknown> | undefined
        const { data: newInvoice, error: invErr } = await supabase
          .from("invoices")
          .insert({
            org_id: order.org_id,
            order_id: order.id,
            invoice_number: null,
            customer_name: (customer?.billing_name as string) || (customer?.store_name as string) || "",
            customer_address: (customer?.billing_address as string) || (customer?.address as string) || null,
            customer_tax_code: (customer?.tax_code as string) || null,
            subtotal: order.subtotal,
            vat: order.vat,
            total: order.total,
            status: "draft",
          })
          .select("id")
          .single()
        if (invErr || !newInvoice) throw new Error(invErr?.message || "Không thể tạo hóa đơn")
        invoiceId = newInvoice.id
      }

      const res = await fetch("/api/einvoice/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, mode: "as_sold" }),
      })
      const text = await res.text()
      let data: { error?: string; cached?: boolean; inv_no?: string; lookup_code?: string; sandbox?: boolean } = {}
      try { data = text ? JSON.parse(text) : {} } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || `Phát hành MISA thất bại (HTTP ${res.status})${text && !data.error ? `: ${text.slice(0, 200)}` : ""}`)

      toast({
        title: data.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${data.inv_no ? `Số HĐ: ${data.inv_no} · ` : ""}Mã tra cứu: ${data.lookup_code || "—"}${data.sandbox ? " (sandbox)" : ""}`,
      })

      // Refresh invoice map
      const { data: updatedInv } = await supabase
        .from("invoices")
        .select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at, misa_invoice_id, misa_invoice_url, misa_status, misa_error, misa_sent_at, misa_signed_at, misa_lookup_code, misa_published_at")
        .eq("id", invoiceId)
        .single()
      if (updatedInv) {
        setInvoiceMap((prev) => ({ ...prev, [order.id]: updatedInv as Invoice }))
      }
    } catch (error) {
      toast({ title: "Lỗi xuất HĐ", description: (error as Error).message, variant: "destructive" })
    } finally {
      setMisaLoadingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Đơn của tôi" : "Đơn hàng"} description={`${orders.length} đơn hàng`}>
        {user && hasPermission(user.role, "orders", "create") && (
          <Button onClick={() => router.push("/orders/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo đơn
          </Button>
        )}
      </PageHeader>

      {(isSales || isDriver) && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>
            {isSales
              ? "Bạn chỉ thấy đơn do bạn tạo. Ban quản lý sẽ thấy tất cả đơn của tổ chức."
              : "Bạn chỉ thấy đơn thuộc chuyến giao của bạn."}
          </span>
        </div>
      )}

      {/* Pipeline 7-step status bar (Update #2 v2 §8) */}
      {filterActive("pipeline") && (
        <OrderPipeline
          orders={orders}
          receivables={receivablesByOrder}
          invoices={invoiceMap}
          active={pipelineStep}
          onChange={(next) => {
            setPipelineStep(next)
            // Picking a pipeline step clears the special-state chip filter
            // so the two filters don't fight each other.
            if (next) setStatusFilter("all")
          }}
        />
      )}

      {/* Special-state quick filter chips (mutually exclusive with pipeline) */}
      {filterActive("specialStatus") && (
      <div className="flex flex-wrap gap-2">
        {([
          { value: "all", label: "Tất cả", color: "" },
          { value: "pending_approval", label: "Chờ duyệt", color: "border-[#fdb022] text-[#b54708] bg-[#fff4ed]" },
          { value: "cancelled", label: "Đã hủy", color: "border-error/40 text-on-error-container bg-error-container" },
        ] as const).map((s) => {
          const count = statusCounts[s.value] || 0
          const active = statusFilter === s.value && !pipelineStep
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setStatusFilter(s.value)
                setPipelineStep(null)
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary text-on-primary border-primary"
                  : s.color || "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  active ? "bg-on-primary/20 text-on-primary" : "bg-surface/70"
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm mã đơn hàng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        {(filterActive("date") || filterActive("customer") || filterActive("sales") || filterActive("amount")) && (
          <Button
            variant="outline"
            onClick={() => setShowAdvanced((v) => !v)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Bộ lọc nâng cao
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={ORDER_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={ORDER_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      {showAdvanced && (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
            {filterActive("date") && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Từ ngày</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Đến ngày</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </>
            )}
            {filterActive("customer") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Khách hàng</label>
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả khách hàng</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.store_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterActive("sales") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">NV bán hàng</label>
                <Select value={salesFilter} onValueChange={setSalesFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả NV</SelectItem>
                    {salesUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterActive("amount") && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Tổng tiền từ</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={amountMin}
                    onChange={(e) => setAmountMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Tổng tiền đến</label>
                  <Input
                    type="number"
                    placeholder="VD: 50000000"
                    value={amountMax}
                    onChange={(e) => setAmountMax(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="md:col-span-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={resetAdvanced}>
                Xóa bộ lọc
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedIds.size > 0 && (() => {
        const selectedOrders = orders.filter((o) => selectedIds.has(o.id))
        const allSameStatus = selectedOrders.length > 0 &&
          selectedOrders.every((o) => o.status === selectedOrders[0].status)
        const sharedStatus = allSameStatus ? selectedOrders[0].status : null
        const next = sharedStatus ? NEXT_STATUS[sharedStatus] : null
        const cancellableCount = selectedOrders.filter(
          (o) => o.status !== "delivered" && o.status !== "cancelled"
        ).length
        const hasDraftNeedingApproval = selectedOrders.some((o) => o.status === "draft")

        return (
          <Card className="rounded-xl border-primary/40 bg-primary-fixed shadow-card sticky top-16 z-20">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="text-sm font-semibold text-on-primary-fixed-variant">
                {selectedIds.size} đơn đã chọn
                {allSameStatus && sharedStatus && (
                  <span className="ml-2 text-xs text-on-surface-variant font-normal">
                    • cùng trạng thái: {sharedStatus}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {canApprove && hasDraftNeedingApproval && (
                  <Button size="sm" onClick={handleBulkApprove} disabled={bulkLoading}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Duyệt đơn nháp
                  </Button>
                )}
                {next && (
                  <Button
                    size="sm"
                    onClick={handleBulkAdvance}
                    disabled={bulkLoading}
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    {next.label}
                  </Button>
                )}
                {cancellableCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkCancel}
                    disabled={bulkLoading}
                    className="border-error/40 text-on-error-container hover:bg-error-container"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Hủy {cancellableCount} đơn
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleExportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Xuất CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  <X className="mr-2 h-4 w-4" />
                  Hủy chọn
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách đơn hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />}
          title={
            loadError
              ? "Không tải được dữ liệu"
              : orders.length === 0
                ? "Chưa có đơn hàng"
                : "Không có đơn hàng phù hợp"
          }
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : orders.length === 0
                ? isDriver
                  ? "Bạn chưa được gán chuyến giao hàng nào. Đơn hàng chỉ hiện sau khi kho lập phiếu giao và gán bạn làm tài xế."
                  : isSales
                    ? "Bạn chưa tạo đơn nào và chưa được phân công khách hàng nào. Nhờ quản lý phân công khách hàng, hoặc tạo đơn đầu tiên."
                    : "Tạo đơn hàng đầu tiên"
                : "Thử điều chỉnh bộ lọc"
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="Chọn tất cả"
                    />
                  </TableHead>
                  <TableHead>Mã đơn</TableHead>
                  {show("customer") && <TableHead>Khách hàng</TableHead>}
                  {show("salesUser") && <TableHead>NV bán hàng</TableHead>}
                  {show("date") && <TableHead>Ngày đặt</TableHead>}
                  {show("total") && <TableHead className="text-right">Tổng tiền</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => {
                  const checked = selectedIds.has(order.id)
                  return (
                    <TableRow
                      key={order.id}
                      data-state={checked ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => router.push(`/orders/${order.id}`)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleOne(order.id)}
                          aria-label={`Chọn ${order.order_code}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-mono text-sm text-primary font-bold hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {order.order_code}
                        </Link>
                      </TableCell>
                      {show("customer") && (
                        <TableCell className="font-medium">{order.customer?.store_name || "-"}</TableCell>
                      )}
                      {show("salesUser") && (
                        <TableCell>
                          {order.sales_user?.full_name || "-"}
                        </TableCell>
                      )}
                      {show("date") && (
                        <TableCell>
                          {formatDate(order.order_date)}
                        </TableCell>
                      )}
                      {show("total") && (
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(order.total)}
                        </TableCell>
                      )}
                      {show("status") && (
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge status={order.status} type="order" />
                            <PaymentStatusBadge receivable={receivablesByOrder[order.id]} />
                            {order.status === "draft" && order.approval_reason && (
                              <span
                                className="text-[10px] text-[#b54708] font-semibold"
                                title={order.approval_reason}
                              >
                                Cần duyệt
                              </span>
                            )}
                          </div>
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {order.status === "delivered" && (
                            invoiceMap[order.id]?.misa_status === "signed" ? (
                              <span title="Đã xuất HĐ" className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[#ecfdf3] text-[#027a48]">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={misaLoadingId === order.id}
                                onClick={() => handleXuatHoaDonList(order)}
                              >
                                <FileText className="h-3 w-3 mr-1" />
                                {misaLoadingId === order.id ? "..." : "HĐ"}
                              </Button>
                            )
                          )}
                          <Eye className="h-4 w-4 text-on-surface-variant" />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {/* Select all bar (mobile) */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Chọn tất cả"
                id="orders-select-all-mobile"
              />
              <label htmlFor="orders-select-all-mobile" className="text-xs font-medium text-muted-foreground">
                Chọn tất cả ({filtered.length})
              </label>
            </div>

            {filtered.map((order) => {
              const checked = selectedIds.has(order.id)
              const invoice = invoiceMap[order.id]
              const showInvoiceAction = order.status === "delivered"
              const isPendingApproval = order.status === "draft" && !!order.approval_reason
              return (
                <div
                  key={order.id}
                  className={`relative rounded-xl border bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform ${
                    checked ? "border-primary bg-primary-fixed/40" : "border-outline-variant/60"
                  } ${isPendingApproval ? "border-l-4 border-l-[#fdb022]" : ""}`}
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-2">
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5 shrink-0">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleOne(order.id)}
                          aria-label={`Chọn ${order.order_code}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-xs font-bold text-primary">{order.order_code}</p>
                          <span className="text-xs text-on-surface-variant">• {formatDate(order.order_date)}</span>
                        </div>
                        <h3 className="font-bold text-base text-on-surface leading-tight truncate mt-0.5">
                          {order.customer?.store_name || "-"}
                        </h3>
                        {order.sales_user?.full_name && (
                          <p className="text-xs text-on-surface-variant truncate">NV: {order.sales_user.full_name}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <StatusBadge status={order.status} type="order" />
                          <PaymentStatusBadge receivable={receivablesByOrder[order.id]} />
                        </div>
                      </div>
                    </div>

                    {isPendingApproval && (
                      <div className="mt-2 rounded-lg bg-[#fff4ed] border border-[#fdb022]/40 p-2">
                        <p className="text-[10px] font-bold text-[#b54708] uppercase tracking-wider mb-0.5">
                          Cần duyệt
                        </p>
                        <p className="text-[11px] text-[#b54708] leading-snug whitespace-pre-wrap line-clamp-3">
                          {order.approval_reason}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-2 mt-3 border-t border-outline-variant/40">
                      <span className="text-xs text-on-surface-variant">Tổng tiền</span>
                      <span className="font-bold text-base text-on-surface tabular-data">{formatCurrency(order.total)}</span>
                    </div>

                    {showInvoiceAction && (
                      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                        {invoice?.misa_status === "signed" ? (
                          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-[#027a48] bg-[#ecfdf3] rounded-lg py-2">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Đã xuất hóa đơn
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            disabled={misaLoadingId === order.id}
                            onClick={() => handleXuatHoaDonList(order)}
                          >
                            <FileText className="h-3.5 w-3.5 mr-2" />
                            {misaLoadingId === order.id ? "Đang xuất..." : "Xuất hóa đơn"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <DataPagination pg={pg} shownCount={filtered.length} />
        </>
      )}
    </div>
  )
}
