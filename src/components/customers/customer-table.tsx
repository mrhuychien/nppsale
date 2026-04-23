"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Eye, Phone, User, Banknote } from "lucide-react"
import type { Customer } from "@/types"

interface LastOrderInfo {
  order_code: string
  order_date: string
  total: number
}

interface LastVisitInfo {
  visit_date: string
  result: string | null
}

interface CustomerTableProps {
  customers: Customer[]
  debts?: Record<string, number>
  lastOrders?: Record<string, LastOrderInfo>
  lastVisits?: Record<string, LastVisitInfo>
  canCollect?: boolean
}

export function CustomerTable({
  customers,
  debts = {},
  lastOrders = {},
  lastVisits = {},
  canCollect = false,
}: CustomerTableProps) {
  const router = useRouter()
  const showEnrichment =
    Object.keys(debts).length > 0 ||
    Object.keys(lastOrders).length > 0 ||
    Object.keys(lastVisits).length > 0

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
              <TableHead>Tuyến</TableHead>
              {showEnrichment && <TableHead>Ghé thăm</TableHead>}
              {showEnrichment && <TableHead>Đơn gần nhất</TableHead>}
              {showEnrichment && <TableHead className="text-right">Công nợ</TableHead>}
              <TableHead>Trạng thái</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const debt = debts[c.id] || 0
              const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
              const lastOrder = lastOrders[c.id]
              const lastVisit = lastVisits[c.id]
              return (
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
                  {showEnrichment && (
                    <TableCell className="text-xs">
                      {lastVisit ? (
                        formatDate(lastVisit.visit_date)
                      ) : (
                        <span className="text-muted-foreground italic">Chưa có</span>
                      )}
                    </TableCell>
                  )}
                  {showEnrichment && (
                    <TableCell className="text-xs">
                      {lastOrder ? (
                        <>
                          <div className="font-medium">{formatDate(lastOrder.order_date)}</div>
                          <div className="text-muted-foreground">{formatCurrency(lastOrder.total)}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">Chưa có</span>
                      )}
                    </TableCell>
                  )}
                  {showEnrichment && (
                    <TableCell className="text-right">
                      {debt > 0 ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className={`font-bold ${isBadDebt ? "text-danger" : ""}`}>
                            {formatCurrency(debt)}
                          </span>
                          {canCollect && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/receivables/collect?customerId=${c.id}`)
                              }}
                            >
                              <Banknote className="h-3 w-3 mr-1" /> Thu
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">0đ</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={c.status} type="customer" />
                  </TableCell>
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="lg:hidden space-y-3">
        {customers.map((c) => {
          const debt = debts[c.id] || 0
          const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
          const lastOrder = lastOrders[c.id]
          const lastVisit = lastVisits[c.id]
          return (
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
                {showEnrichment ? (
                  <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                    <div>
                      <p className="text-muted-foreground mb-0.5">Ghé thăm</p>
                      {lastVisit ? (
                        <p className="font-medium">{formatDate(lastVisit.visit_date)}</p>
                      ) : (
                        <p className="text-muted-foreground italic">Chưa có</p>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-0.5">Đơn gần nhất</p>
                      {lastOrder ? (
                        <>
                          <p className="font-medium">{formatDate(lastOrder.order_date)}</p>
                          <p className="text-[10px] text-muted-foreground">{formatCurrency(lastOrder.total)}</p>
                        </>
                      ) : (
                        <p className="text-muted-foreground italic">Chưa có</p>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-0.5">Công nợ</p>
                      {debt > 0 ? (
                        <p className={`font-bold ${isBadDebt ? "text-danger" : ""}`}>
                          {formatCurrency(debt)}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">0đ</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t text-xs">
                    <span className="text-muted-foreground">
                      {c.group?.name ? `Nhóm: ${c.group.name}` : ""}
                    </span>
                    <span className="font-semibold">
                      Hạn mức: {formatCurrency(c.credit_limit)}
                    </span>
                  </div>
                )}
                {canCollect && debt > 0 && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => router.push(`/receivables/collect?customerId=${c.id}`)}
                    >
                      <Banknote className="h-3.5 w-3.5 mr-1.5" /> Thu tiền
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
