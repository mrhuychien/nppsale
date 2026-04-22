"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate } from "@/lib/utils"
import { FileText, Printer, Users } from "lucide-react"
import type { Customer, Payment, SalesOrder } from "@/types"

type LedgerRow = {
  id: string
  date: string
  code: string
  type: "invoice" | "payment"
  typeLabel: string
  debit: number
  credit: number
  balance: number
}

export default function AccountantLedgerPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const supabase = createClient()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [loadingLedger, setLoadingLedger] = useState(false)

  useEffect(() => {
    async function fetchCustomers() {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .order("store_name")
      setCustomers((data as Customer[]) || [])
      setLoadingCustomers(false)
    }
    fetchCustomers()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) {
      setOrders([])
      setPayments([])
      return
    }
    async function fetchLedger() {
      setLoadingLedger(true)
      const { data: orderData } = await supabase
        .from("sales_orders")
        .select("*")
        .eq("customer_id", selectedId)
        .eq("status", "delivered")
        .order("order_date")

      // fetch payments via receivables for this customer
      const { data: recData } = await supabase
        .from("receivables")
        .select("id")
        .eq("customer_id", selectedId)
      const receivableIds = ((recData || []) as { id: string }[]).map((r) => r.id)

      let paymentData: Payment[] = []
      if (receivableIds.length > 0) {
        const { data: payData } = await supabase
          .from("payments")
          .select("*")
          .in("receivable_id", receivableIds)
          .order("collected_at")
        paymentData = (payData as Payment[]) || []
      }

      setOrders((orderData as SalesOrder[]) || [])
      setPayments(paymentData)
      setLoadingLedger(false)
    }
    fetchLedger()
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedId),
    [customers, selectedId]
  )

  const ledger: LedgerRow[] = useMemo(() => {
    const rows: Omit<LedgerRow, "balance">[] = []
    orders.forEach((o) => {
      rows.push({
        id: `so-${o.id}`,
        date: o.order_date,
        code: o.order_code,
        type: "invoice",
        typeLabel: "Bán hàng",
        debit: o.total,
        credit: 0,
      })
    })
    payments.forEach((p) => {
      rows.push({
        id: `pay-${p.id}`,
        date: p.collected_at,
        code: `PAY-${p.id.slice(0, 8).toUpperCase()}`,
        type: "payment",
        typeLabel: "Thu tiền",
        debit: 0,
        credit: p.amount,
      })
    })
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let running = 0
    return rows.map((r) => {
      running += r.debit - r.credit
      return { ...r, balance: running }
    })
  }, [orders, payments])

  const totalDebit = ledger.reduce((s, r) => s + r.debit, 0)
  const totalCredit = ledger.reduce((s, r) => s + r.credit, 0)
  const currentBalance = totalDebit - totalCredit

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print()
  }

  if (authLoading || loadingCustomers) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Sổ chi tiết Công nợ" description="Phân tích công nợ theo khách hàng" backHref="/receivables">
        <Button variant="outline" onClick={handlePrint} disabled={!selectedId}>
          <Printer className="mr-2 h-4 w-4" />
          In bản kê
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="min-w-[140px] text-sm font-semibold">
              Chọn khách hàng
            </label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="sm:max-w-md">
                <SelectValue placeholder="-- Chọn khách hàng để xem sổ chi tiết --" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.store_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!selectedId ? (
        <EmptyState
          icon={<Users className="h-8 w-8 text-muted-foreground" />}
          title="Vui lòng chọn khách hàng"
          description="Chọn một khách hàng để xem sổ chi tiết công nợ"
        />
      ) : loadingLedger ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Customer Info Card */}
          {selectedCustomer && (
            <Card>
              <CardContent className="p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                      Hồ sơ khách hàng
                    </span>
                    <h2 className="text-2xl font-black">{selectedCustomer.store_name}</h2>
                    <p className="text-sm text-muted-foreground">
                      Mã: {selectedCustomer.id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                  <div>
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                      {selectedCustomer.status}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Chủ cửa hàng
                    </p>
                    <p className="font-semibold">{selectedCustomer.owner_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Số điện thoại
                    </p>
                    <p className="font-semibold">{selectedCustomer.phone || "-"}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Địa chỉ
                    </p>
                    <p className="font-semibold">{selectedCustomer.address || "-"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Hạn mức nợ
                    </p>
                    <p className="text-lg font-black">
                      {formatCurrency(selectedCustomer.credit_limit || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Nợ hiện tại
                    </p>
                    <p className="text-lg font-black text-destructive">
                      {formatCurrency(currentBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Tổng phát sinh Nợ
                    </p>
                    <p className="text-lg font-black">{formatCurrency(totalDebit)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Tổng phát sinh Có
                    </p>
                    <p className="text-lg font-black text-green-600">
                      {formatCurrency(totalCredit)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transaction Ledger */}
          {ledger.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có phát sinh"
              description="Khách hàng chưa có đơn hàng đã giao hoặc thanh toán nào"
            />
          ) : (
            <>
              {/* Desktop table */}
              <Card className="hidden lg:block">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Mã chứng từ</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead className="text-right">Phát sinh Nợ</TableHead>
                          <TableHead className="text-right">Phát sinh Có</TableHead>
                          <TableHead className="text-right">Tồn cuối</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledger.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="text-sm">{formatDate(row.date)}</TableCell>
                            <TableCell className="text-sm font-bold text-primary">
                              {row.code}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                  row.type === "invoice"
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-green-50 text-green-700"
                                }`}
                              >
                                {row.typeLabel}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {row.debit > 0 ? formatCurrency(row.debit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-green-600">
                              {row.credit > 0 ? formatCurrency(row.credit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-black">
                              {formatCurrency(row.balance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Mobile card list */}
              <div className="lg:hidden space-y-3">
                {ledger.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border bg-card shadow-ambient overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">{formatDate(row.date)}</p>
                          <p className="font-mono text-sm font-bold text-primary mt-0.5">{row.code}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            row.type === "invoice"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-green-50 text-green-700"
                          }`}
                        >
                          {row.typeLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                        <div>
                          <p className="text-muted-foreground">PS Nợ</p>
                          <p className="font-semibold">{row.debit > 0 ? formatCurrency(row.debit) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">PS Có</p>
                          <p className="font-semibold text-green-600">{row.credit > 0 ? formatCurrency(row.credit) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Tồn cuối</p>
                          <p className="font-black">{formatCurrency(row.balance)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
