"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Eye, Calendar, User } from "lucide-react"
import type { SalesOrder } from "@/types"

interface OrderTableProps {
  orders: SalesOrder[]
}

export function OrderTable({ orders }: OrderTableProps) {
  const router = useRouter()

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
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
            {orders.map((order) => (
              <TableRow
                key={order.id}
                className="cursor-pointer"
                onClick={() => router.push(`/orders/${order.id}`)}
              >
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
                <TableCell>{order.sales_user?.full_name || "-"}</TableCell>
                <TableCell>{formatDate(order.order_date)}</TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(order.total)}</TableCell>
                <TableCell>
                  <StatusBadge status={order.status} type="order" />
                </TableCell>
                <TableCell>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {orders.map((order) => (
          <div
            key={order.id}
            className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
            onClick={() => router.push(`/orders/${order.id}`)}
          >
            <div className="p-4">
              <div className="flex justify-between items-start gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-bold text-primary">{order.order_code}</p>
                  <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                    {order.customer?.store_name || "-"}
                  </h3>
                  {order.sales_user?.full_name && (
                    <div className="flex items-center gap-1 text-muted-foreground mt-1">
                      <User className="h-3 w-3 shrink-0" />
                      <p className="text-xs truncate">{order.sales_user.full_name}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3 shrink-0" />
                    <p className="text-xs">{formatDate(order.order_date)}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={order.status} type="order" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                <span className="text-xs text-muted-foreground">Tổng tiền</span>
                <span className="font-bold text-base">{formatCurrency(order.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
