"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { SalesOrder } from "@/types"

interface OrderTableProps {
  orders: SalesOrder[]
}

export function OrderTable({ orders }: OrderTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mã đơn</TableHead>
          <TableHead>Khách hàng</TableHead>
          <TableHead className="hidden sm:table-cell">NV bán hàng</TableHead>
          <TableHead className="hidden md:table-cell">Ngày đặt</TableHead>
          <TableHead className="text-right">Tổng tiền</TableHead>
          <TableHead>Trạng thái</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell>
              <Link href={`/orders/${order.id}`} className="font-mono text-sm text-primary hover:underline">
                {order.order_code}
              </Link>
            </TableCell>
            <TableCell className="font-medium">{order.customer?.store_name || "-"}</TableCell>
            <TableCell className="hidden sm:table-cell">{order.sales_user?.full_name || "-"}</TableCell>
            <TableCell className="hidden md:table-cell">{formatDate(order.order_date)}</TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(order.total)}</TableCell>
            <TableCell>
              <StatusBadge status={order.status} type="order" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
