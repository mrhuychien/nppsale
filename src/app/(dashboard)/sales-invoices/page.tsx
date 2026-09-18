"use client"

/**
 * HÓA ĐƠN BÁN — danh sách.
 *
 * ⚠ ĐỪNG NHẦM VỚI `/invoices`. Trang kia là hoá đơn điện tử MISA (bảng
 * `invoices`, tên cũ giữ nguyên). Trang này là chứng từ THỰC XUẤT của
 * kho: trừ tồn, sinh công nợ, in phiếu giao. Một hóa đơn bán có thể chưa
 * phát hành hoá đơn điện tử nào, và ngược lại thì không.
 *
 * ⚠ CÙNG NGỮ PHÁP VỚI DANH SÁCH ĐƠN HÀNG (chủ nhà chốt): thẻ trạng thái
 * có số đếm ở trên, thẻ bảng cho máy tính, danh sách thẻ cho điện thoại.
 * Hai màn này người dùng đi lại suốt ngày; bắt họ học hai bố cục cho cùng
 * một việc là thuế đánh lên từng lần chuyển màn.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { PipelineTabs } from "@/components/orders/pipeline-tabs"
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

const SELECT =
  "id, invoice_code, invoice_date, status, total, order_id, replaced_from, replaced_by, customer:customers(store_name), order:sales_orders(order_code)"

/** Thẻ trạng thái — cùng ba lựa chọn với bộ lọc cũ, thêm số đếm. */
const TABS = [
  { key: "posted", label: "Đã xuất", accent: "#12b76a" },
  { key: "cancelled", label: "Đã hủy", accent: "#f04438" },
  { key: "all", label: "Tất cả", accent: "#667085" },
] as const

export default function SalesInvoicesPage() {
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>("posted")
  const pg = usePagination(50)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("sales_invoices")
      .select(SELECT, { count: "exact" })
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

  /**
   * ⚠ ĐẾM RIÊNG, KHÔNG ĐẾM TỪ `rows`. `rows` chỉ là một trang 50 dòng —
   * đếm từ đó thì thẻ "Đã xuất" hiện 50 dù sổ có 4.000, và con số trên
   * thẻ mâu thuẫn với con số dưới chân trang.
   */
  const fetchCounts = useCallback(async () => {
    const [posted, cancelled, all] = await Promise.all([
      supabase.from("sales_invoices").select("id", { count: "exact", head: true }).eq("status", "posted"),
      supabase.from("sales_invoices").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
      supabase.from("sales_invoices").select("id", { count: "exact", head: true }),
    ])
    setCounts({
      posted: posted.count ?? 0,
      cancelled: cancelled.count ?? 0,
      all: all.count ?? 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  useEffect(() => {
    if (!authLoading) fetchCounts()
  }, [authLoading, fetchCounts])

  /**
   * ⚠ LỌC TRONG TRANG ĐANG XEM, và mã nguồn phải nói ra điều đó. Ô tìm
   * này không hỏi lại máy chủ, nên gõ mã của một hóa đơn nằm ở trang 3 sẽ
   * KHÔNG ra gì — placeholder vì thế nói "trong trang này".
   */
  const term = search.trim().toLowerCase()
  const filtered = term
    ? rows.filter(
        (r) =>
          r.invoice_code.toLowerCase().includes(term) ||
          (r.customer?.store_name || "").toLowerCase().includes(term) ||
          (r.order?.order_code || "").toLowerCase().includes(term)
      )
    : rows

  const empty = (
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
  )

  const codeCell = (r: Row) => (
    <>
      <span className="font-mono font-semibold text-primary">{r.invoice_code}</span>
      {/*
        ⚠ NÓI RA KHI HÓA ĐƠN LÀ BẢN LẬP LẠI. Không có dấu này thì một hóa
          đơn đã huỷ nằm cạnh một hóa đơn gần như y hệt, và người tra sổ
          không biết cái nào thay cái nào.
      */}
      {r.replaced_from && <Badge variant="secondary" className="ml-1.5">Lập lại</Badge>}
      {r.replaced_by && <Badge variant="outline" className="ml-1.5">Đã bị thay</Badge>}
    </>
  )

  const statusBadge = (r: Row) => (
    <Badge variant={INVOICE_STATUS_MAP[r.status]?.variant ?? "secondary"}>
      {INVOICE_STATUS_MAP[r.status]?.label ?? r.status}
    </Badge>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hóa đơn bán"
        description="Chứng từ thực xuất: trừ kho, sinh công nợ, là nguồn của hoá đơn điện tử."
      />

      <PipelineTabs
        className="grid"
        active={status}
        onPick={setStatus}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: counts[t.key] ?? 0,
          accent: t.accent,
        }))}
      />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm trong trang này: số hóa đơn, khách hàng, mã đơn…"
          className="pl-8"
        />
      </div>

      {/* ---------------- Máy tính: thẻ bảng ---------------- */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
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
                  <td colSpan={6} className="px-3 py-2"><Skeleton className="h-6" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr className="border-t">
                <td colSpan={6} className="px-3 py-8">{empty}</td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => router.push(`/sales-invoices/${r.id}`)}
                >
                  <td className="px-3 py-2">{codeCell(r)}</td>
                  <td className="px-3 py-2">{formatDate(r.invoice_date)}</td>
                  <td className="px-3 py-2">{r.customer?.store_name || "—"}</td>
                  <td className="px-3 py-2">
                    {/*
                      ⚠ CHẶN NỔI BỌT. Cả hàng đã điều hướng sang hóa đơn;
                        không chặn thì bấm mã đơn là chạy cả hai lệnh và
                        người dùng đáp xuống đúng chỗ họ không chọn.
                    */}
                    <Link
                      href={`/orders/${r.order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.order?.order_code || "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2">{statusBadge(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- Điện thoại: danh sách thẻ ---------------- */}
      <div className="space-y-3 lg:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border bg-card p-6">{empty}</div>
        ) : (
          filtered.map((r) => (
            <Link
              key={r.id}
              href={`/sales-invoices/${r.id}`}
              className="block rounded-xl border bg-card p-3 active:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate">{codeCell(r)}</div>
                  <div className="mt-0.5 truncate text-sm">{r.customer?.store_name || "—"}</div>
                </div>
                {statusBadge(r)}
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {formatDate(r.invoice_date)}
                  {r.order?.order_code ? ` · ${r.order.order_code}` : ""}
                </div>
                <div className="text-base font-bold tabular-nums">{formatCurrency(r.total)}</div>
              </div>
            </Link>
          ))
        )}
      </div>

      <DataPagination pg={pg} />
    </div>
  )
}
