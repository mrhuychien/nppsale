"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { misaRelationLabel } from "@/lib/misa/labels"
import { useToast } from "@/hooks/use-toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { AlertTriangle, ExternalLink, FileWarning, Link2, Link2Off, FilePlus2 } from "lucide-react"

/**
 * Đối soát hoá đơn MISA ↔ sổ.
 *
 * Rổ quan trọng nhất là "Chỉ có trên MISA": hoá đơn phát hành thẳng trên
 * web MISA, không đi qua app, nên sổ không hề biết. Đó đúng loại hoá đơn
 * ngoài sổ mà kiểm toán sẽ hỏi — không có màn hình này thì bảng snapshot
 * chỉ là một cái log không ai đọc.
 */

interface SnapshotRow {
  id: string
  ref_id: string
  inv_series: string | null
  inv_no: string | null
  inv_date: string | null
  buyer_name: string | null
  buyer_tax_code: string | null
  total_amount: number | null
  relation: string | null
  match_status: string | null
  match_method: string | null
  match_confidence: string | null
  match_note: string | null
  invoice_id: string | null
}

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "danger" | "secondary" }
> = {
  matched: { label: "Khớp", variant: "success" },
  amount_diff: { label: "Lệch tiền", variant: "warning" },
  misa_only: { label: "Chỉ có trên MISA", variant: "danger" },
  cancelled: { label: "Đã huỷ", variant: "secondary" },
  replaced: { label: "Đã bị thay thế", variant: "secondary" },
  needs_review: { label: "Cần review", variant: "warning" },
}

const METHOD_LABEL: Record<string, string> = {
  ref_id: "Khoá RefID",
  transaction_id: "Mã tra cứu",
  inv_no: "Ký hiệu + số",
  inv_no_loose: "Ký hiệu (bỏ mẫu số) — suy đoán",
  tax_date_amount: "MST + ngày + tiền — suy đoán",
  manual: "Người chốt tay",
}

/** Mặc định mở đúng rổ cần người xử lý, không phải rổ đã khớp. */
const DEFAULT_FILTER = "attention"

export default function ReconcilePage() {
  const { loading: authLoading } = useRoleGuard("invoices")
  const [rows, setRows] = useState<SnapshotRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(DEFAULT_FILTER)
  const [busy, setBusy] = useState<string | null>(null)
  const [linking, setLinking] = useState<SnapshotRow | null>(null)
  const [linkTarget, setLinkTarget] = useState("")
  const [creating, setCreating] = useState<SnapshotRow | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("misa_invoice_snapshots")
      .select(
        "id, ref_id, inv_series, inv_no, inv_date, buyer_name, buyer_tax_code, total_amount, relation, match_status, match_method, match_confidence, match_note, invoice_id"
      )
      .order("inv_date", { ascending: false, nullsFirst: false })
      .limit(500)

    if (filter === "attention") {
      q = q.in("match_status", ["misa_only", "amount_diff", "needs_review"])
    } else if (filter !== "all") {
      q = q.eq("match_status", filter)
    }

    const [{ data, error }, countRes] = await Promise.all([
      q,
      supabase.from("misa_invoice_snapshots").select("match_status").limit(5000),
    ])
    if (error) console.error("[invoices/reconcile] truy vấn lỗi:", error.message)
    setRows((data as SnapshotRow[]) || [])

    const tally: Record<string, number> = {}
    for (const r of (countRes.data as { match_status: string | null }[]) || []) {
      const k = r.match_status || "unknown"
      tally[k] = (tally[k] || 0) + 1
    }
    setCounts(tally)
    setLoading(false)
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  const act = useCallback(
    async (action: "link" | "unlink" | "create", snapshotId: string, invoiceId?: string) => {
      setBusy(snapshotId)
      try {
        const res = await fetch("/api/einvoice/reconcile-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, snapshotId, invoiceId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) throw new Error(data.error || `Lỗi HTTP ${res.status}`)
        // Cảnh báo KHÔNG phải lỗi, nhưng cũng không được nuốt.
        if (Array.isArray(data.warnings) && data.warnings.length) {
          toast({
            title: "Đã nối, nhưng có điểm cần xem lại",
            description: data.warnings.join(" "),
          })
        } else {
          toast({ title: "Xong" })
        }
        setLinking(null)
        setCreating(null)
        setLinkTarget("")
        fetchData()
      } catch (e) {
        toast({ title: "Không thực hiện được", description: (e as Error).message, variant: "destructive" })
      } finally {
        setBusy(null)
      }
    },
    [fetchData, toast]
  )

  const attention = useMemo(
    () => (counts.misa_only || 0) + (counts.amount_diff || 0) + (counts.needs_review || 0),
    [counts]
  )

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Đối soát hoá đơn MISA"
        description={`${rows.length} dòng · ${attention} cần xử lý`}
        backHref="/invoices"
      >
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? "Đang tải..." : "Tải lại"}
        </Button>
      </PageHeader>

      {/* Rổ "chỉ có trên MISA" đứng riêng: đây là hoá đơn NGOÀI SỔ, không
          phải một trạng thái đối soát bình thường. */}
      {(counts.misa_only || 0) > 0 && (
        <Card className="border-destructive/40 bg-destructive/[0.04]">
          <CardContent className="flex items-start gap-3 p-4">
            <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-destructive">
                {counts.misa_only} hoá đơn chỉ có trên MISA
              </p>
              <p className="mt-1 text-muted-foreground">
                Những tờ này phát hành thẳng trên MISA, không đi qua app nên sổ không
                ghi nhận. Doanh thu và thuế đầu ra của chúng đang thiếu trong báo cáo.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">Cần xử lý ({attention})</SelectItem>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="misa_only">Chỉ có trên MISA ({counts.misa_only || 0})</SelectItem>
            <SelectItem value="amount_diff">Lệch tiền ({counts.amount_diff || 0})</SelectItem>
            <SelectItem value="needs_review">Cần review ({counts.needs_review || 0})</SelectItem>
            <SelectItem value="matched">Khớp ({counts.matched || 0})</SelectItem>
            <SelectItem value="replaced">Đã bị thay thế ({counts.replaced || 0})</SelectItem>
            <SelectItem value="cancelled">Đã huỷ ({counts.cancelled || 0})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs uppercase text-muted-foreground">Ký hiệu · Số</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Ngày</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Người mua</TableHead>
              <TableHead className="text-right text-xs uppercase text-muted-foreground">Tiền</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Quan hệ</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Đối soát</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Ghi chú</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8}><Skeleton className="h-8" /></TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Không có dòng nào trong rổ này.
                  {filter === "attention" && " Chưa chạy đối soát bao giờ thì bảng còn trống — vòng kéo chạy 1h sáng mỗi ngày."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const meta = r.match_status
                  ? STATUS_META[r.match_status] ?? { label: r.match_status, variant: "secondary" as const }
                  : null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.inv_series ? `${r.inv_series} · ` : ""}
                      {r.inv_no || <span className="text-muted-foreground">chưa cấp số</span>}
                    </TableCell>
                    <TableCell className="text-xs">{r.inv_date ? formatDate(r.inv_date) : "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">
                      {r.buyer_name || "—"}
                      {r.buyer_tax_code && (
                        <span className="block text-[11px] text-muted-foreground">{r.buyer_tax_code}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {r.total_amount != null ? formatCurrency(r.total_amount) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{misaRelationLabel(r.relation) || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {meta && <Badge variant={meta.variant}>{meta.label}</Badge>}
                        {r.match_method && (
                          <span className="text-[11px] text-muted-foreground">
                            {METHOD_LABEL[r.match_method] ?? r.match_method}
                          </span>
                        )}
                        {r.invoice_id && (
                          <Link
                            href={`/invoices/${r.invoice_id}`}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          >
                            Mở hoá đơn <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px] text-[11px] text-muted-foreground">
                      {r.match_confidence === "review" && (
                        <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-600" />
                      )}
                      {r.match_note || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {r.invoice_id ? (
                          <Button
                            variant="ghost" size="sm" className="justify-start"
                            disabled={busy === r.id}
                            onClick={() => act("unlink", r.id)}
                          >
                            <Link2Off className="mr-1 h-3.5 w-3.5" /> Gỡ nối
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost" size="sm" className="justify-start"
                              disabled={busy === r.id}
                              onClick={() => { setLinking(r); setLinkTarget("") }}
                            >
                              <Link2 className="mr-1 h-3.5 w-3.5" /> Nối tay
                            </Button>
                            {r.match_status === "misa_only" && (
                              <Button
                                variant="ghost" size="sm" className="justify-start"
                                disabled={busy === r.id}
                                onClick={() => setCreating(r)}
                              >
                                <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Dựng hoá đơn
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Nối tay: nhận ID hoá đơn trong sổ. Không có ô tìm kiếm ở đây —
          người dùng mở hoá đơn ở tab khác rồi chép ID, và như thế họ NHÌN
          thấy tờ mình đang nối thay vì chọn mù từ một danh sách. */}
      <ConfirmDialog
        open={!!linking}
        onOpenChange={(o) => { if (!o) setLinking(null) }}
        title="Nối tay với hoá đơn trong sổ"
        description={
          linking
            ? `Hoá đơn MISA ${linking.inv_series || "?"} · ${linking.inv_no || "?"}. ` +
              `Dán ID hoá đơn trong sổ (lấy từ thanh địa chỉ trang chi tiết hoá đơn).`
            : ""
        }
        confirmLabel="Nối"
        onConfirm={() => linking && act("link", linking.id, linkTarget.trim())}
      >
        <Input
          value={linkTarget}
          onChange={(e) => setLinkTarget(e.target.value)}
          placeholder="vd 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
          autoFocus
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!creating}
        onOpenChange={(o) => { if (!o) setCreating(null) }}
        title="Dựng hoá đơn trong sổ"
        description={
          creating
            ? `Tạo một hoá đơn mới trong sổ từ hoá đơn MISA ${creating.inv_series || "?"} · ` +
              `${creating.inv_no || "?"}. Tiền hàng và thuế lấy từ MISA. ` +
              `Hoá đơn tạo ra CHƯA gắn đơn hàng nào, và kỳ ghi nhận lấy theo ngày phát ` +
              `hành trên MISA — không phải hôm nay.`
            : ""
        }
        confirmLabel="Dựng hoá đơn"
        onConfirm={() => creating && act("create", creating.id)}
      />
    </div>
  )
}
