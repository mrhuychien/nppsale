"use client"

import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency } from "@/lib/utils"
import type { Customer } from "@/types"

interface CustomerTableProps {
  customers: Customer[]
}

export function CustomerTable({ customers }: CustomerTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Cua hang</TableHead>
          <TableHead className="hidden sm:table-cell">Chu cua hang</TableHead>
          <TableHead>SĐT</TableHead>
          <TableHead className="hidden md:table-cell">Kenh</TableHead>
          <TableHead className="hidden lg:table-cell">Nhom</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Han muc</TableHead>
          <TableHead>Trang thai</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
