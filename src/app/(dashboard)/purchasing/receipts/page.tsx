"use client"

/**
 * DANH SÁCH PHIẾU NHẬP HÀNG — ba trạng thái, lọc bằng dải viên thuốc.
 *
 * (23/09/2026: chủ nhà xin thêm dòng "Tổng tiền · N phiếu" cho mọi danh
 * sách chứng từ — đó là `DocListTotals`, một dòng, không phải khung thẻ
 * thống kê cũ nói dưới đây.)
 *
 * ⚠ DÙNG `StatusChips`, KHÔNG DỰNG KHUNG THỐNG KÊ RIÊNG. Chủ nhà đã
 * chốt dải viên thuốc cho danh sách đơn hàng (20/09/2026: "cho về đơn
 * giản dễ nhìn thôi, không cần làm khung như cũ nữa"), và bài học kèm
 * theo là khung ô cố định ÉP SỐ TRẠNG THÁI — chính nó từng làm đơn
 * `partially_invoiced` biến mất khỏi mọi tab.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { tongChungTu } from "@/lib/orders/list-summary"
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
import { dangChon, trangThaiCuaChon } from "@/lib/list/status-multi"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { khopLoc } from "@/lib/search/advanced-filter"
import { LOC_HOA_DON_MUA } from "@/lib/search/list-filter-fields"
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
  /* Chỉ để lọc nâng cao ở trình duyệt. */
  subtotal: number | null
  vat: number | null
  vat_override: number | null
  notes: string | null
  created_at: string
  completed_at: string | null
  supplier?: { name?: string | null; code?: string | null } | null
}

export default function PurchaseReceiptsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const focusTick = useRefreshOnFocus()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Chạm trần / lỗi đọc — tổng không đủ thì nói ra, không in số hụt. */
  const [canhBao, setCanhBao] = useState<string | null>(null)
  const [q, setQ] = useState("")
  /** "" = chưa chạm tab nào → hiện tất cả. */
  const [tab, setTab] = useState("")
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). Màn tải hết nên lọc ở trình duyệt bằng `khopLoc`. */
  const locNC = useAdvancedFilter("purchasing-receipts", LOC_HOA_DON_MUA)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    /* ⚠ ĐỌC ĐỦ, KHÔNG `.limit(500)`. Bản cũ cắt ngầm ở 500 phiếu: phiếu thứ
       501 không hiện, không tìm được, và số đếm trên các nhãn trạng thái
       hụt theo — không có gì báo. */
    const res = await fetchAllForAggregate<Row>((from, to) =>
      // audit-ok: lỗi đi vào `res.error` ngay dưới.
      supabase
        .from("purchase_invoices")
        .select("id, receipt_code, invoice_number, invoice_date, status, total, warehouse_zone, subtotal, vat, vat_override, notes, created_at, completed_at, supplier:suppliers(name, code)", { count: "exact" })
        .eq("org_id", user.org_id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    )
    if (res.error) console.error("[purchasing/receipts] truy vấn lỗi:", res.error)
    setCanhBao(res.error ? `Không đọc được danh sách phiếu nhập — ${res.error}` : res.truncated ? truncationWarning() : null)
    setRows(res.rows)
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load, focusTick])

  /* Số trên dải trạng thái đếm theo đúng bộ lọc nâng cao đang áp. */
  const locRows = useMemo(
    () => (locNC.dieuKien.length ? rows.filter((r) => khopLoc(r, LOC_HOA_DON_MUA, locNC.dieuKien)) : rows),
    [rows, locNC.dieuKien]
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: locRows.length }
    for (const s of RECEIPT_STATUS) c[s] = 0
    for (const r of locRows) if (c[r.status] !== undefined) c[r.status] += 1
    return c
  }, [locRows])

  const shown = useMemo(() => {
    const term = q.trim()
    return locRows.filter((r) => {
      /* Chọn nhiều trạng thái (chủ nhà 25/09/2026). */
      const chon = trangThaiCuaChon(tab)
      if (chon && !chon.includes(r.status)) return false
      if (!term) return true
      return viMatchAllWords(term, r.receipt_code, r.invoice_number, r.supplier?.name, r.supplier?.code)
    })
  }, [locRows, q, tab])

  const tongPhieu = tongChungTu(
    shown,
    (r) => r.total,
    // Đang xem tab "Đã huỷ" thì cộng chính các phiếu huỷ ấy.
    (r) => !dangChon(tab, "cancelled") && r.status === "cancelled",
    !canhBao
  )

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
        multi
        active={tab || "all"}
        onPick={setTab}
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Mã phiếu, số hoá đơn, tên NCC…" className="pl-8"
          />
        </div>
        <AdvancedFilter truong={LOC_HOA_DON_MUA} value={locNC.dieuKien} onApply={locNC.apDung} />
      </div>

      {canhBao && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{canhBao}</p>
      )}
      {!loading && (
        <DocListTotals
          className="rounded-xl border"
          label="Tổng tiền phiếu nhập"
          countText={`${tongPhieu.soPhieu} phiếu nhập${!dangChon(tab, "cancelled") && (trangThaiCuaChon(tab) === null || tab.includes(",")) ? " · không tính phiếu huỷ" : ""}`}
          total={tongPhieu.tong === null ? null : formatCurrency(tongPhieu.tong)}
        />
      )}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">
          {/* ⚠ "Chưa có phiếu nào" là một KẾT LUẬN màn hình không có cơ sở
              để rút ra: 0 dòng cũng là thứ ta nhận được khi RLS chặn. */}
          {q.trim() || tab || locNC.soDangAp
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
