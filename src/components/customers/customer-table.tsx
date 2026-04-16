"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency } from "@/lib/utils"
import { Eye } from "lucide-react"
import type { Customer } from "@/types"

interface CustomerTableProps {
  customers: Customer[]
}

export function CustomerTable({ customers }: CustomerTableProps) {
  const router = useRouter()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Cửa hàng</TableHead>
          <TableHead className="hidden sm:table-cell">Chủ cửa hàng</TableHead>
          <TableHead>SĐT</TableHead>
          <TableHead className="hidden md:table-cell">Kênh</TableHead>
          <TableHead className="hidden lg:table-cell">Nhóm</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Hạn mức</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="w-12"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c) => (
          <TableRow
            key={c.id}
            className="cursor-pointer"
            onClick={() => router.push(`/customers/${c.id}`)}
          >
            <TableCell>
              <Link
                href={`/customers/${c.id}`}
                className="font-medium text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {c.store_name}
              </Link>
              <p className="text-xs text-muted-foreground sm:hidden">{c.owner_name}</p>
            </TableCell>
            <TableCell className="hidden sm:table-cell">{c.owner_name}</TableCell>
            <TableCell>{c.phone}</TableCell>
            <TableCell className="hidden md:table-cell">
              {c.channel && <Badge variant="outline">{c.channel}</Badge>}
            </TableCell>
            <TableCell className="hidden lg:table-cell">{c.group?.name || "-"}</TableCell>
            <TableCell className="hidden lg:table-cell text-right">{formatCurrency(c.credit_limit)}</TableCell>
            <TableCell>
              <StatusBadge status={c.status} type="customer" />
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
