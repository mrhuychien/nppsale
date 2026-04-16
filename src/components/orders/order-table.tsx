"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Eye } from "lucide-react"
import type { SalesOrder } from "@/types"

interface OrderTableProps {
  orders: SalesOrder[]
}

export function OrderTable({ orders }: OrderTableProps) {
  const router = useRouter()

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
            <TableCell className="hidden sm:table-cell">{order.sales_user?.full_name || "-"}</TableCell>
            <TableCell className="hidden md:table-cell">{formatDate(order.order_date)}</TableCell>
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
  )
}
