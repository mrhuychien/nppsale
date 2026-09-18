"use client"

/**
 * HÓA ĐƠN BÁN — danh sách.
 *
 * ⚠ ĐỪNG NHẦM VỚI `/invoices`. Trang kia là hoá đơn điện tử MISA (bảng
 * `invoices`, tên cũ giữ nguyên). Trang này là chứng từ THỰC XUẤT của
 * kho: trừ tồn, sinh công nợ, in phiếu giao. Một hóa đơn bán có thể chưa
 * phát hành hoá đơn điện tử nào, và ngược lại thì không.
 *
 * ⚠ CÙNG NGỮ PHÁP VỚI DANH SÁCH ĐƠN HÀNG (chủ nhà chốt), tới từng chi
 * tiết dựng hình — KHÔNG phải "cũng là một cái bảng":
 *   • Thẻ trạng thái có số đếm ở trên cùng.
 *   • MỘT thẻ bo 2xl chứa thanh công cụ, lưới, rồi phân trang — tất cả
 *     nằm trong thẻ, không rơi ra ngoài.
 *   • Hàng dựng bằng CSS GRID với `gridTemplateColumns` dùng chung cho
 *     tiêu đề và từng dòng, giống `desktop-order-table.tsx`. Dùng
 *     `<table>` thì cột co giãn theo nội dung và hai màn lệch nhau ngay
 *     từ cái nhìn đầu tiên — đó chính là chỗ bản trước làm chưa giống.
 *   • Điện thoại có danh sách thẻ riêng.
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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PipelineTabs } from "@/components/orders/pipeline-tabs"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
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
  { key: "all", label: "Tất cả", accent: "#181c1e" },
] as const

/**
 * Bề rộng cột, dùng CHUNG cho hàng tiêu đề và mọi dòng.
 *
 * ⚠ MỘT HẰNG SỐ, KHÔNG CHÉP HAI LẦN. Chép ra hai chỗ là một ngày nào đó
 * sửa một chỗ, và tiêu đề lệch khỏi dữ liệu đúng một cột — lỗi khó thấy
 * nhất trong các lỗi dựng hình.
 */
const COLS = "170px minmax(200px,1.5fr) 130px 120px 150px 160px"

const HEAD =
  "flex items-center px-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant"

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
   * thẻ mâu thuẫn với con số dưới chân trang, ngay trên cùng một màn.
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
      <span className="font-mono text-[13px] font-bold text-primary">{r.invoice_code}</span>
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

  const toolbar = (
    <div className="relative min-w-[220px] max-w-sm flex-1">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Tìm trong trang này: số hóa đơn, khách, mã đơn…"
        className="pl-10"
      />
    </div>
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

      {/* ⚠ MÁY TÍNH — một thẻ gồm thanh công cụ, lưới, phân trang. Cùng
          khuôn với màn "Đơn hàng"; đổi ở đây thì đổi cả bên kia. */}
      <div className="hidden lg:flex flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest">
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3">
          {toolbar}
          {search && (
            <Button
              variant="ghost"
              size="sm"
              className="font-extrabold text-primary"
              onClick={() => setSearch("")}
            >
              Xoá lọc
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} / {pg.total} hóa đơn
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[930px]">
            <div
              className="grid h-[42px] items-center border-b border-outline-variant/40 bg-surface-container-low px-2"
              style={{ gridTemplateColumns: COLS }}
            >
              <span className={HEAD}>Số hóa đơn</span>
              <span className={HEAD}>Khách hàng</span>
              <span className={HEAD}>Ngày xuất</span>
              <span className={HEAD}>Đơn gốc</span>
              <span className={cn(HEAD, "justify-end")}>Tổng tiền</span>
              <span className={HEAD}>Trạng thái</span>
            </div>

            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border-b border-outline-variant/30 px-2 py-3">
                  <Skeleton className="h-6" />
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10">{empty}</div>
            ) : (
              filtered.map((r) => (
                <div
                  key={r.id}
                  role="row"
                  onClick={() => router.push(`/sales-invoices/${r.id}`)}
                  className="grid min-h-[52px] cursor-pointer items-center border-b border-outline-variant/30 px-2 transition-colors hover:bg-surface-container-low"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <span className="truncate px-2">{codeCell(r)}</span>
                  <span className="truncate px-2 text-[13px]">
                    {r.customer?.store_name || "—"}
                  </span>
                  <span className="px-2 text-[13px] text-on-surface-variant">
                    {formatDate(r.invoice_date)}
                  </span>
                  <span className="px-2" onClick={(e) => e.stopPropagation()}>
                    {/*
                      ⚠ CHẶN NỔI BỌT. Cả hàng đã điều hướng sang hóa đơn;
                        không chặn thì bấm mã đơn là chạy cả hai lệnh và
                        người dùng đáp xuống đúng chỗ họ không chọn.
                    */}
                    <Link
                      href={`/orders/${r.order_id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.order?.order_code || "—"}
                    </Link>
                  </span>
                  <span className="px-2 text-right text-[13px] font-bold tabular-nums">
                    {formatCurrency(r.total)}
                  </span>
                  <span className="px-2">{statusBadge(r)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="px-4 pb-3 pt-1">
          <DataPagination pg={pg} />
        </div>
      </div>

      {/* ---------------- Điện thoại: danh sách thẻ ---------------- */}
      <div className="space-y-3 lg:hidden">
        {toolbar}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border bg-card p-6">{empty}</div>
        ) : (
          <>
            {filtered.map((r) => (
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
            ))}
            <DataPagination pg={pg} />
          </>
        )}
      </div>
    </div>
  )
}
