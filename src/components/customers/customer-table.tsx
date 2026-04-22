"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency } from "@/lib/utils"
import { Eye, Phone, User } from "lucide-react"
import type { Customer } from "@/types"

interface CustomerTableProps {
  customers: Customer[]
}

export function CustomerTable({ customers }: CustomerTableProps) {
  const router = useRouter()

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cửa hàng</TableHead>
              <TableHead>Chủ cửa hàng</TableHead>
              <TableHead>SĐT</TableHead>
              <TableHead>Kênh</TableHead>
              <TableHead>Nhóm</TableHead>
              <TableHead className="text-right">Hạn mức</TableHead>
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
                </TableCell>
                <TableCell>{c.owner_name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell>
                  {c.channel && <Badge variant="outline">{c.channel}</Badge>}
                </TableCell>
                <TableCell>{c.group?.name || "-"}</TableCell>
                <TableCell className="text-right">{formatCurrency(c.credit_limit)}</TableCell>
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
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {customers.map((c) => (
          <div
            key={c.id}
            className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
            onClick={() => router.push(`/customers/${c.id}`)}
          >
            <div className="p-4">
              <div className="flex justify-between items-start gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-extrabold text-base leading-tight truncate text-primary">
                    {c.store_name}
                  </h3>
                  {c.owner_name && (
                    <div className="flex items-center gap-1 text-muted-foreground mt-1">
                      <User className="h-3 w-3 shrink-0" />
                      <p className="text-xs truncate">{c.owner_name}</p>
                    </div>
                  )}
                  {c.phone && (
                    <div className="flex items-center gap-1 text-muted-foreground mt-1">
                      <Phone className="h-3 w-3 shrink-0" />
                      <p className="text-xs">{c.phone}</p>
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <StatusBadge status={c.status} type="customer" />
                  {c.channel && <Badge variant="outline" className="whitespace-nowrap">{c.channel}</Badge>}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t text-xs">
                <span className="text-muted-foreground">
                  {c.group?.name ? `Nhóm: ${c.group.name}` : ""}
                </span>
                <span className="font-semibold">
                  Hạn mức: {formatCurrency(c.credit_limit)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
