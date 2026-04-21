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
      const matchStatus = statusFilter === "all" || o.status === statusFilter
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
        .update({ status: "confirmed", approved_by: user.id, approved_at: new Date().toISOString() })
        .in("id", ids)
      if (error) throw error
      setOrders((prev) =>
        prev.map((o) => (ids.includes(o.id) ? { ...o, status: "confirmed" } : o))
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
          <span className="inline-flex h-5 w-5 rounded-full bg-primary/20 items-center justify-center text-xs font-black">i</span>
          {isSales
            ? "Bạn chỉ thấy đơn do bạn tạo. Ban quản lý sẽ thấy tất cả đơn của tổ chức."
            : "Bạn chỉ thấy đơn thuộc chuyến giao của bạn."}
        </div>
      )}

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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="draft">Nháp</SelectItem>
            <SelectItem value="confirmed">Đã duyệt</SelectItem>
            <SelectItem value="picking">Đang lấy hàng</SelectItem>
            <SelectItem value="delivering">Đang giao</SelectItem>
            <SelectItem value="delivered">Đã giao</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
          </SelectContent>
        </Select>
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

      {selectedIds.size > 0 && (
        <Card className="rounded-2xl border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 shadow-ambient">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="text-sm font-semibold text-primary">
              {selectedIds.size} đơn đã chọn
            </div>
            <div className="flex flex-wrap gap-2">
              {canApprove && (
                <Button size="sm" onClick={handleBulkApprove} disabled={bulkLoading}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Duyệt tất cả
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleExportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Xuất file
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                <X className="mr-2 h-4 w-4" />
                Hủy chọn
              </Button>
            </div>
          </CardContent>
        </Card>
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
          title="Chưa có đơn hàng"
          description="Tạo đơn hàng đầu tiên"
        />
      ) : (
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
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
                <TableHead className="hidden sm:table-cell">NV bán hàng</TableHead>
                <TableHead className="hidden md:table-cell">Ngày đặt</TableHead>
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
                    <TableCell className="hidden sm:table-cell">
                      {order.sales_user?.full_name || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDate(order.order_date)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(order.total)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} type="order" />
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
      )}
    </div>
  )
}
