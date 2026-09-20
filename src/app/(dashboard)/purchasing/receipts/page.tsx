"use client"

/**
 * DANH SÁCH PHIẾU NHẬP HÀNG — ba trạng thái, lọc bằng dải viên thuốc.
 *
 * ⚠ DÙNG `StatusChips`, KHÔNG DỰNG KHUNG THỐNG KÊ RIÊNG. Chủ nhà đã
 * chốt dải viên thuốc cho danh sách đơn hàng (20/09/2026: "cho về đơn
 * giản dễ nhìn thôi, không cần làm khung như cũ nữa"), và bài học kèm
 * theo là khung ô cố định ÉP SỐ TRẠNG THÁI — chính nó từng làm đơn
 * `partially_invoiced` biến mất khỏi mọi tab.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChips } from "@/components/ui/status-chips"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import {
  RECEIPT_STATUS, receiptStatusLabel, receiptStatusTone,
} from "@/lib/purchasing/receipt-status"

interface Row {
  id: string
  receipt_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  status: string
  total: number | null
  warehouse_zone: string | null
  supplier?: { name?: string | null; code?: string | null } | null
}

export default function PurchaseReceiptsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const focusTick = useRefreshOnFocus()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  /** "" = chưa chạm tab nào → hiện tất cả. */
  const [tab, setTab] = useState("")

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const { data, error } = await supabase
      .from("purchase_invoices")
      .select("id, receipt_code, invoice_number, invoice_date, status, total, warehouse_zone, supplier:suppliers(name, code)")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false })
      .limit(500)
    if (error) console.error("[purchasing/receipts] truy vấn lỗi:", error.message)
    setRows(((data as unknown) as Row[]) || [])
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load, focusTick])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const s of RECEIPT_STATUS) c[s] = 0
    for (const r of rows) if (c[r.status] !== undefined) c[r.status] += 1
    return c
  }, [rows])

  const shown = useMemo(() => {
    const term = q.trim()
    return rows.filter((r) => {
      if (tab && tab !== "all" && r.status !== tab) return false
      if (!term) return true
      return viMatchAllWords(term, r.receipt_code, r.invoice_number, r.supplier?.name, r.supplier?.code)
    })
  }, [rows, q, tab])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Phiếu nhập hàng" description="Nhập hàng từ nhà cung cấp — hoàn thành là nhập kho và ghi công nợ.">
        <Button asChild>
          <Link href="/purchasing/receipts/new"><Plus className="mr-1.5 h-4 w-4" /> Tạo phiếu</Link>
        </Button>
      </PageHeader>

      <StatusChips
        chips={[
          { key: "all", label: "Tất cả", count: counts.all, accent: "#64748b" },
          ...RECEIPT_STATUS.map((s) => ({
            key: s, label: receiptStatusLabel(s), count: counts[s] ?? 0, accent: receiptStatusTone(s),
          })),
        ]}
        active={tab || "all"}
        onPick={setTab}
      />

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Mã phiếu, số hoá đơn, tên NCC…" className="pl-8"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">
          {/* ⚠ "Chưa có phiếu nào" là một KẾT LUẬN màn hình không có cơ sở
              để rút ra: 0 dòng cũng là thứ ta nhận được khi RLS chặn. */}
          {q.trim() || tab
            ? "Không có phiếu nào khớp bộ lọc."
            : "Chưa thấy phiếu nhập nào. Bấm Tạo phiếu để bắt đầu."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Mã phiếu</th>
                <th className="px-3 py-2 text-left">Nhà cung cấp</th>
                <th className="px-3 py-2 text-left">Số HĐ</th>
                <th className="px-3 py-2 text-left">Ngày</th>
                <th className="px-3 py-2 text-left">Trạng thái</th>
                <th className="px-3 py-2 text-right">Cần trả NCC</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link href={`/purchasing/receipts/${r.id}`} className="font-mono font-semibold text-primary hover:underline">
                      {r.receipt_code || "(chưa cấp mã)"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.supplier?.name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.invoice_number || "—"}</td>
                  <td className="px-3 py-2">{r.invoice_date ? formatDate(r.invoice_date) : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{receiptStatusLabel(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(Number(r.total || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
