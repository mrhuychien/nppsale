"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
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
import { StatusBadge } from "@/components/ui/status-badge"
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
  const [loading, setLoading] = useState(true)
  const [misaLoadingId, setMisaLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [salesFilter, setSalesFilter] = useState("all")
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const [ordersRes, customersRes, usersRes] = await Promise.all([
        supabase
          .from("sales_orders")
          .select(
            "*, customer:customers(store_name, phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
          )
          .order("created_at", { ascending: false }),
        supabase.from("customers").select("id, store_name").order("store_name"),
        supabase.from("users").select("id, full_name, role").in("role", ["sales", "manager", "owner"]).order("full_name"),
      ])
      const allOrders = (ordersRes.data as SalesOrder[]) || []
      setOrders(allOrders)
      setCustomers((customersRes.data as Pick<Customer, "id" | "store_name">[]) || [])
      setSalesUsers((usersRes.data as Pick<User, "id" | "full_name">[]) || [])

      // Fetch invoices for delivered orders
      const deliveredIds = allOrders
        .filter((o) => o.status === "delivered")
        .map((o) => o.id)
      if (deliveredIds.length > 0) {
        const { data: invoicesData } = await supabase
          .from("invoices")
          .select("*")
          .in("order_id", deliveredIds)
        if (invoicesData) {
          const map: Record<string, Invoice> = {}
          for (const inv of invoicesData as Invoice[]) {
            if (inv.order_id) map[inv.order_id] = inv
          }
          setInvoiceMap(map)
        }
      }
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const matchSearch = o.order_code.toLowerCase().includes(search.toLowerCase())
      const matchStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "pending_approval"
            ? o.status === "draft" && !!o.approval_reason
            : o.status === statusFilter
      const matchCustomer = customerFilter === "all" || o.customer_id === customerFilter
      const matchSales = salesFilter === "all" || o.sales_user_id === salesFilter
      const matchFrom = !dateFrom || new Date(o.order_date) >= new Date(dateFrom)
      const matchTo = !dateTo || new Date(o.order_date) <= new Date(dateTo + "T23:59:59")
      const matchMin = !amountMin || o.total >= parseFloat(amountMin)
      const matchMax = !amountMax || o.total <= parseFloat(amountMax)
      return (
        matchSearch &&
        matchStatus &&
        matchCustomer &&
        matchSales &&
        matchFrom &&
        matchTo &&
        matchMin &&
        matchMax
      )
    })
  }, [orders, search, statusFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax])

  const pendingApprovalCount = useMemo(
    () => orders.filter((o) => o.status === "draft" && !!o.approval_reason).length,
    [orders]
  )

  // Counts per status for the quick filter chips
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: orders.length,
      pending_approval: pendingApprovalCount,
      draft: 0, confirmed: 0, picking: 0, delivering: 0, delivered: 0, cancelled: 0,
    }
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1
    return c
  }, [orders, pendingApprovalCount])

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
            misa_status: "pending",
          })
          .select("id")
          .single()
        if (invErr || !newInvoice) throw new Error(invErr?.message || "Không thể tạo hóa đơn")
        invoiceId = newInvoice.id
      }

      const res = await fetch("/api/invoice/misa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Gửi MISA thất bại")

      toast({
        title: "Xuất hóa đơn thành công",
        description: `Số HĐ: ${data.invoice_number}${data.mock ? " (thử nghiệm)" : ""}`,
      })

      // Refresh invoice map
      const { data: updatedInv } = await supabase
        .from("invoices")
        .select("*")
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
        <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm text-primary flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-bold">i</span>
          {isSales
            ? "Bạn chỉ thấy đơn do bạn tạo. Ban quản lý sẽ thấy tất cả đơn của tổ chức."
            : "Bạn chỉ thấy đơn thuộc chuyến giao của bạn."}
        </div>
      )}

      {/* Status quick filter chips */}
      <div className="flex flex-wrap gap-2">
        {([
          { value: "all", label: "Tất cả", color: "" },
          { value: "pending_approval", label: "Chờ duyệt", color: "border-amber-400 text-amber-800 bg-amber-50" },
          { value: "draft", label: "Nháp", color: "" },
          { value: "confirmed", label: "Đã duyệt", color: "border-blue-300 text-blue-800 bg-blue-50" },
          { value: "picking", label: "Đang lấy", color: "border-indigo-300 text-indigo-800 bg-indigo-50" },
          { value: "delivering", label: "Đang giao", color: "border-purple-300 text-purple-800 bg-purple-50" },
          { value: "delivered", label: "Đã giao", color: "border-emerald-300 text-emerald-800 bg-emerald-50" },
          { value: "cancelled", label: "Đã hủy", color: "border-red-300 text-red-800 bg-red-50" },
        ] as const).map((s) => {
          const count = statusCounts[s.value] || 0
          const active = statusFilter === s.value
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-primary text-white border-primary"
                  : s.color || "bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-background/70"
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm mã đơn hàng..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowAdvanced((v) => !v)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Bộ lọc nâng cao
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {showAdvanced && (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Từ ngày</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Đến ngày</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
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
          <Card className="rounded-2xl border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 shadow-sm sticky top-16 z-20">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="text-sm font-semibold text-primary">
                {selectedIds.size} đơn đã chọn
                {allSameStatus && sharedStatus && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
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
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
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
                    className="border-red-300 text-red-700 hover:bg-red-50"
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

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có đơn hàng"
          description="Tạo đơn hàng đầu tiên"
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
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
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>NV bán hàng</TableHead>
                  <TableHead>Ngày đặt</TableHead>
                  <TableHead className="text-right">Tổng tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
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
                      <TableCell className="font-medium">{order.customer?.store_name || "-"}</TableCell>
                      <TableCell>
                        {order.sales_user?.full_name || "-"}
                      </TableCell>
                      <TableCell>
                        {formatDate(order.order_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(order.total)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <StatusBadge status={order.status} type="order" />
                          {order.status === "draft" && order.approval_reason && (
                            <span
                              className="text-[10px] text-amber-700 font-semibold"
                              title={order.approval_reason}
                            >
                              Cần duyệt
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {order.status === "delivered" && (
                            invoiceMap[order.id]?.misa_status === "signed" ? (
                              <span title="Đã xuất HĐ" className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-green-100 text-green-600">
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
                          <Eye className="h-4 w-4 text-muted-foreground" />
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
                  className={`relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform ${
                    checked ? "border-primary bg-primary/5" : ""
                  } ${isPendingApproval ? "border-l-4 border-l-amber-400" : ""}`}
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
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <p className="font-mono text-xs font-bold text-primary">{order.order_code}</p>
                          <StatusBadge status={order.status} type="order" />
                        </div>
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {order.customer?.store_name || "-"}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {order.sales_user?.full_name ? `NV: ${order.sales_user.full_name} • ` : ""}
                          {formatDate(order.order_date)}
                        </p>
                      </div>
                    </div>

                    {isPendingApproval && (
                      <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
                        <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-0.5">
                          Cần duyệt
                        </p>
                        <p className="text-[11px] text-amber-800 leading-snug whitespace-pre-wrap line-clamp-3">
                          {order.approval_reason}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-2 mt-3 border-t">
                      <span className="text-xs text-muted-foreground">Tổng tiền</span>
                      <span className="font-bold text-base">{formatCurrency(order.total)}</span>
                    </div>

                    {showInvoiceAction && (
                      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                        {invoice?.misa_status === "signed" ? (
                          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg py-2">
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
        </>
      )}
    </div>
  )
}
