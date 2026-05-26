"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusBadge } from "@/components/ui/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Eye, Phone, User, Banknote } from "lucide-react"
import type { Customer } from "@/types"
import type { CustomerColumnKey } from "@/app/(dashboard)/customers/list-config"

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
  visibleColumns: CustomerColumnKey[]
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string, next: boolean) => void
  onToggleSelectAll?: (next: boolean) => void
  allSelected?: boolean
  someSelected?: boolean
}

export function CustomerTable({
  customers,
  debts = {},
  lastOrders = {},
  lastVisits = {},
  canCollect = false,
  visibleColumns,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected = false,
  someSelected = false,
}: CustomerTableProps) {
  const router = useRouter()
  const show = (key: CustomerColumnKey) => visibleColumns.includes(key)
  const showEnrichment =
    Object.keys(debts).length > 0 ||
    Object.keys(lastOrders).length > 0 ||
    Object.keys(lastVisits).length > 0

  return (
    <>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => onToggleSelectAll?.(!!v)}
                    aria-label="Chọn tất cả"
                  />
                </TableHead>
              )}
              <TableHead>Cửa hàng</TableHead>
              {show("owner") && <TableHead>Chủ cửa hàng</TableHead>}
              {show("phone") && <TableHead>SĐT</TableHead>}
              {show("channel") && <TableHead>Tuyến</TableHead>}
              {show("lastVisit") && showEnrichment && <TableHead>Ghé thăm</TableHead>}
              {show("lastOrder") && showEnrichment && <TableHead>Đơn gần nhất</TableHead>}
              {show("debt") && showEnrichment && <TableHead className="text-right">Công nợ</TableHead>}
              {show("status") && <TableHead>Trạng thái</TableHead>}
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const debt = debts[c.id] || 0
              const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
              const lastOrder = lastOrders[c.id]
              const lastVisit = lastVisits[c.id]
              const checked = selectedIds?.has(c.id) ?? false
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => onToggleSelect?.(c.id, !!v)}
                        aria-label={`Chọn ${c.store_name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.store_name}
                    </Link>
                  </TableCell>
                  {show("owner") && <TableCell>{c.owner_name}</TableCell>}
                  {show("phone") && <TableCell>{c.phone}</TableCell>}
                  {show("channel") && (
                    <TableCell>
                      {c.channel && <Badge variant="outline">{c.channel}</Badge>}
                    </TableCell>
                  )}
                  {show("lastVisit") && showEnrichment && (
                    <TableCell className="text-xs">
                      {lastVisit ? (
                        formatDate(lastVisit.visit_date)
                      ) : (
                        <span className="text-muted-foreground italic">Chưa có</span>
                      )}
                    </TableCell>
                  )}
                  {show("lastOrder") && showEnrichment && (
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
                  {show("debt") && showEnrichment && (
                    <TableCell className="text-right tabular-nums">
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
                  {show("status") && (
                    <TableCell>
                      <StatusBadge status={c.status} type="customer" />
                    </TableCell>
                  )}
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list — layout cố định, không phụ thuộc visibleColumns */}
      <div className="lg:hidden space-y-3">
        {customers.map((c) => {
          const debt = debts[c.id] || 0
          const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
          const lastOrder = lastOrders[c.id]
          const lastVisit = lastVisits[c.id]
          const checked = selectedIds?.has(c.id) ?? false
          return (
            <div
              key={c.id}
              className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden active:scale-[0.99] transition-transform"
            >
              <div className="p-4">
                <div className="flex justify-between items-start gap-3 mb-2">
                  {selectable && (
                    <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => onToggleSelect?.(c.id, !!v)}
                        aria-label={`Chọn ${c.store_name}`}
                      />
                    </div>
                  )}
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => router.push(`/customers/${c.id}`)}
                  >
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
