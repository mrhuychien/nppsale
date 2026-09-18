"use client"

/**
 * HÓA ĐƠN BÁN — danh sách.
 *
 * ⚠ ĐỪNG NHẦM VỚI `/invoices`. Trang kia là hoá đơn điện tử MISA (bảng
 * `invoices`, tên cũ giữ nguyên). Trang này là chứng từ THỰC XUẤT của
 * kho: trừ tồn, sinh công nợ, in phiếu giao. Một hóa đơn bán có thể chưa
 * phát hành hoá đơn điện tử nào, và ngược lại thì không.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { FileText, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { INVOICE_STATUS_MAP } from "@/lib/constants"

interface Row {
  id: string
  invoice_code: string
  invoice_date: string
  status: string
  total: number
  order_id: string
  replaced_from: string | null
  replaced_by: string | null
  customer?: { store_name?: string | null } | null
  order?: { order_code?: string | null } | null
}

export default function SalesInvoicesPage() {
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("posted")
  const pg = usePagination(50)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("sales_invoices")
      .select(
        "id, invoice_code, invoice_date, status, total, order_id, replaced_from, replaced_by, customer:customers(store_name), order:sales_orders(order_code)",
        { count: "exact" }
      )
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
    if (status !== "all") q = q.eq("status", status)

    const { data, error, count } = await q.range(pg.from, pg.to)
    if (error) console.error("[sales-invoices] truy vấn lỗi:", error.message)
    setRows(((data as unknown) as Row[]) || [])
    pg.setTotal(count ?? 0)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pg.from, pg.to])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  const term = search.trim().toLowerCase()
  const filtered = term
    ? rows.filter(
        (r) =>
          r.invoice_code.toLowerCase().includes(term) ||
          (r.customer?.store_name || "").toLowerCase().includes(term) ||
          (r.order?.order_code || "").toLowerCase().includes(term)
      )
    : rows

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hóa đơn bán"
        description="Chứng từ thực xuất: trừ kho, sinh công nợ, là nguồn của hoá đơn điện tử."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Số hóa đơn, khách hàng, mã đơn…"
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="posted">Đã xuất</SelectItem>
            <SelectItem value="cancelled">Đã hủy</SelectItem>
            <SelectItem value="all">Tất cả</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Số hóa đơn</th>
              <th className="px-3 py-2 text-left">Ngày xuất</th>
              <th className="px-3 py-2 text-left">Khách hàng</th>
              <th className="px-3 py-2 text-left">Đơn gốc</th>
              <th className="px-3 py-2 text-right">Tổng tiền</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td colSpan={6} className="px-3 py-2">
                    <Skeleton className="h-6" />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr className="border-t">
                <td colSpan={6} className="px-3 py-8">
                  <EmptyState
                    icon={<FileText className="h-8 w-8" />}
                    title="Chưa có hóa đơn bán nào"
                    description="Hóa đơn sinh ra khi nhà phân phối bấm Xuất hàng trên một đơn."
                  >
                    {/* Không để màn hình thành ngõ cụt — chỉ sang chỗ làm được việc. */}
                    <Link href="/orders" className="text-sm text-primary hover:underline">
                      Tới danh sách đơn →
                    </Link>
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link
                      href={`/sales-invoices/${r.id}`}
                      className="font-mono font-semibold text-primary hover:underline"
                    >
                      {r.invoice_code}
                    </Link>
                    {/*
                      ⚠ NÓI RA KHI HÓA ĐƠN LÀ BẢN LẬP LẠI. Không có dấu
                        này thì một hóa đơn đã huỷ nằm cạnh một hóa đơn
                        gần như y hệt, và người tra sổ không biết cái nào
                        thay cái nào.
                    */}
                    {r.replaced_from && (
                      <Badge variant="secondary" className="ml-1.5">Lập lại</Badge>
                    )}
                    {r.replaced_by && (
                      <Badge variant="outline" className="ml-1.5">Đã bị thay</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDate(r.invoice_date)}</td>
                  <td className="px-3 py-2">{r.customer?.store_name || "—"}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/orders/${r.order_id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.order?.order_code || "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={INVOICE_STATUS_MAP[r.status]?.variant ?? "secondary"}>
                      {INVOICE_STATUS_MAP[r.status]?.label ?? r.status}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DataPagination pg={pg} />
    </div>
  )
}
