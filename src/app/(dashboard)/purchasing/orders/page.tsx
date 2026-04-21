"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Plus, Search, ShoppingCart, Eye } from "lucide-react"
import type { PurchaseOrder } from "@/types"

export default function PurchaseOrdersPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from("purchase_orders")
        .select("*, supplier:suppliers(name, code)")
        .order("created_at", { ascending: false })
      setOrders((data as PurchaseOrder[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const q = search.toLowerCase()
      const matchSearch =
        o.po_code.toLowerCase().includes(q) ||
        o.supplier?.name?.toLowerCase().includes(q) ||
        false
      const matchStatus = statusFilter === "all" || o.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [orders, search, statusFilter])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Đơn mua hàng"
        description={`${orders.length} đơn mua hàng`}
        backHref="/purchasing"
      >
        {user && hasPermission(user.role, "inventory", "create") && (
          <Button onClick={() => router.push("/purchasing/orders/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo đơn mua
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm mã PO, tên NCC..."
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
            <SelectItem value="received">Đã nhập kho</SelectItem>
            <SelectItem value="partial">Nhập 1 phần</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có đơn mua hàng"
          description="Tạo đơn mua hàng đầu tiên từ nhà cung cấp"
        />
      ) : (
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mã PO</TableHead>
                <TableHead>NCC</TableHead>
                <TableHead className="hidden sm:table-cell">Ngày</TableHead>
                <TableHead className="text-right">Tổng tiền</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <TableRow
                  key={order.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/purchasing/orders/${order.id}`)}
                >
                  <TableCell>
                    <Link
                      href={`/purchasing/orders/${order.id}`}
                      className="font-mono text-sm text-primary font-bold hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {order.po_code}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">
                    {order.supplier?.name || "-"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {formatDate(order.order_date)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(order.total)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} type="po" />
                  </TableCell>
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
