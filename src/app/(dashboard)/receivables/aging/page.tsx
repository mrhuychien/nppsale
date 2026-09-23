"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { docDuHoacNem, fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { docThanhToanCuaPhieu } from "../by-customer/doc-so-cong-no"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { SearchSelect } from "@/components/ui/search-select"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
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
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.store_name,
        hint: [c.owner_name, c.phone].filter(Boolean).join(" · ") || null,
        keywords: [c.owner_name, c.phone].filter(Boolean).join(" "),
      })),
    [customers]
  )
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [loadingLedger, setLoadingLedger] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    async function fetchCustomers() {
      /**
       * ⚠ KÉO ĐỦ THEO TRANG. Bản cũ đọc bằng `.select()` trơn —
       *   PostgREST cắt ở 1.000 dòng, nên khách thứ 1.001 trở đi KHÔNG
       *   tra được sổ chi tiết, và ô chọn im lặng như thể họ không tồn
       *   tại. Với một ô chỉ để CUỘN thì lỗi ấy còn chìm; với một ô GÕ
       *   ĐỂ TÌM thì nó thành "gõ đúng tên mà không ra" — đúng thứ vừa
       *   phải dọn ở ô tìm hàng.
       *
       * ⚠ PHÂN TRANG THEO `id`: mốc chia trang phải DUY NHẤT, hai cửa
       *   hàng trùng tên là các trang lặp/sót nhau.
       */
      const res = await fetchAllForAggregate<Customer>((from, to) =>
        supabase
          .from("customers")
          .select(
            "id, store_name, owner_name, phone, address, credit_limit, status",
            { count: "exact" }
          )
          .order("id")
          .range(from, to)
      )
      if (res.error) setLoadError(`Danh sách khách: ${res.error}`)
      setCustomers(
        res.rows.slice().sort((a, b) => (a.store_name ?? "").localeCompare(b.store_name ?? ""))
      )
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
      setLoadError(null)
      setTruncated(false)
      /**
       * ⚠ SỔ CHI TIẾT PHẢI ĐỌC ĐỦ CẢ BA PHẦN, lỗi thì HIỆN. Bản cũ:
       *   · đơn hàng và danh sách phiếu công nợ đọc TRƠN → khách lâu năm
       *     quá 1.000 đơn thì sổ thiếu dòng "Nợ" mà không báo;
       *   · lần thu tiền `.in("receivable_id", <mọi phiếu>)` một lệnh → quá
       *     ~150 id là URL quá dài → lỗi bị nuốt thành `[]` → cột "Có"
       *     trống, số dư cuối đội lên bằng mọi khoản khách đã trả.
       * ⚠ Mọi phép đọc phân trang có khoá phụ `id` (xem `docDuHoacNem`).
       */
      try {
        const [orderRes, recRes] = await Promise.all([
          docDuHoacNem<SalesOrder>(
            (from, to) =>
              supabase
                .from("sales_orders")
                .select("id, order_code, order_date, total", { count: "exact" })
                .eq("customer_id", selectedId)
                .eq("status", "completed")
                .order("order_date")
                .order("id")
                .range(from, to),
            "Đơn hàng"
          ),
          docDuHoacNem<{ id: string }>(
            (from, to) =>
              supabase
                .from("receivables")
                .select("id", { count: "exact" })
                .eq("customer_id", selectedId)
                .order("id")
                .range(from, to),
            "Phiếu công nợ"
          ),
        ])
        const paymentData = await docThanhToanCuaPhieu<Payment>(
          supabase,
          recRes.rows.map((r) => r.id),
          "id, amount, collected_at"
        )
        setTruncated(orderRes.truncated || recRes.truncated)
        setOrders(orderRes.rows)
        setPayments(paymentData)
      } catch (err) {
        // ⚠ Không vẽ nửa sổ: thiếu một phần là số dư sai.
        setOrders([])
        setPayments([])
        setLoadError(errorMessage(err))
      }
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

      {/* Lỗi tải / số thiếu — nói ra, không để màn hình trông như đúng. */}
      {loadError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải đủ sổ chi tiết công nợ</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số liệu chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="min-w-[140px] text-sm font-semibold">
              Chọn khách hàng
            </label>
            <div className="sm:max-w-md">
              {/*
                ⚠ GÕ ĐỂ TÌM, KHÔNG CUỘN (chủ nhà chốt 21/09/2026). Một
                  `<Select>` liệt kê cả nghìn khách thì không ai tìm nổi
                  một cái tên trong đó.
              */}
              <SearchSelect
                id="aging-customer"
                options={customerOptions}
                valueId={selectedId}
                onPick={(o) => setSelectedId(o?.id ?? "")}
                placeholder="Gõ tên cửa hàng, tên chủ hoặc số điện thoại…"
                emptyHint="Không tìm thấy khách nào khớp."
              />
            </div>
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
                    <span className="rounded-full bg-[#ecfdf3] px-3 py-1 text-xs font-bold text-tertiary">
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
                    <p className="text-lg font-black text-tertiary">
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
                                    ? "bg-[#eff8ff] text-[#175cd3]"
                                    : "bg-[#ecfdf3] text-tertiary"
                                }`}
                              >
                                {row.typeLabel}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {row.debit > 0 ? formatCurrency(row.debit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-tertiary">
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
                    className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden"
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
                              ? "bg-[#eff8ff] text-[#175cd3]"
                              : "bg-[#ecfdf3] text-tertiary"
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
                          <p className="font-semibold text-tertiary">{row.credit > 0 ? formatCurrency(row.credit) : "-"}</p>
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
