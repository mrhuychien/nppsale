"use client"

/**
 * CHI TIẾT PHIẾU NHẬP HÀNG — nơi bấm Hoàn thành và bấm Huỷ.
 *
 * ⚠ HAI NÚT ẤY ĐỀU GỌI RPC, KHÔNG TỰ GHI GÌ. Hoàn thành là nhập kho +
 * ghi công nợ trong một giao dịch; Huỷ là đảo ngược đúng như vậy. Màn
 * này chỉ đọc và hiện kết quả.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Loader2, PackageCheck, Pencil, XCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { duocGhiMuaHang } from "@/lib/purchasing/roles"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ratioToPercent } from "@/lib/purchasing/return-form"
import { friendlyReceiptError, RECEIPT_ZONES } from "@/lib/purchasing/receipt-form"
import { receiptStatusLabel } from "@/lib/purchasing/receipt-status"
import { errorMessage } from "@/lib/errors"

interface Head {
  id: string
  receipt_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  status: string
  warehouse_zone: string | null
  subtotal: number | null
  vat: number | null
  discount: number | null
  total: number | null
  notes: string | null
  cancel_reason: string | null
  completed_at: string | null
  stock_entry_id: string | null
  payable_id: string | null
  supplier?: { name?: string | null; code?: string | null } | null
}

interface Line {
  id: string
  sort_order: number | null
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number | null
  vat_rate: number | null
  conversion_factor: number | null
  line_total: number | null
  /** Cột trong CSDL tên `notes`, số nhiều. */
  notes: string | null
  product?: { name?: string | null; sku?: string | null; base_unit?: string | null } | null
}

export default function PurchaseReceiptDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const ghiDuoc = duocGhiMuaHang(user?.role)
  const supabase = createClient()
  const { toast } = useToast()

  const [head, setHead] = useState<Head | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [askCancel, setAskCancel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [hRes, lRes] = await Promise.all([
      supabase.from("purchase_invoices")
        .select("id, receipt_code, invoice_number, invoice_date, status, warehouse_zone, subtotal, vat, discount, total, notes, cancel_reason, completed_at, stock_entry_id, payable_id, supplier:suppliers(name, code)")
        .eq("id", id).maybeSingle(),
      supabase.from("purchase_invoice_lines")
        .select("id, sort_order, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, notes, product:products(name, sku, base_unit)")
        .eq("invoice_id", id).order("sort_order"),
    ])
    if (hRes.error) console.error("[receipts/detail] lỗi:", hRes.error.message)
    setHead(((hRes.data as unknown) as Head) ?? null)
    setLines(((lRes.data as unknown) as Line[]) || [])
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const run = async (rpc: "complete_purchase_invoice" | "cancel_purchase_invoice", reason?: string) => {
    setBusy(true)
    try {
      const args = rpc === "cancel_purchase_invoice"
        ? { p_invoice_id: id, p_reason: reason ?? null }
        : { p_invoice_id: id }
      const { error } = await supabase.rpc(rpc, args)
      if (error) throw new Error(friendlyReceiptError(error.message))
      toast({
        title: rpc === "complete_purchase_invoice"
          ? "Đã hoàn thành — nhập kho và ghi công nợ NCC"
          : "Đã huỷ phiếu — kho và công nợ đã hoàn về",
      })
      await load()
    } catch (e) {
      toast({ title: "Không thực hiện được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setBusy(false)
      setAskCancel(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (!head) {
    return (
      <div className="space-y-4">
        <PageHeader title="Phiếu nhập hàng" backHref="/purchasing/receipts" />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Không tìm thấy phiếu này, hoặc bạn không có quyền xem nó.
        </div>
        <Link href="/purchasing/receipts" className="text-sm text-primary hover:underline">
          Tới danh sách phiếu nhập →
        </Link>
      </div>
    )
  }

  const isDraft = head.status === "draft"
  const isDone = head.status === "completed"
  const zoneLabel = RECEIPT_ZONES.find((z) => z.value === head.warehouse_zone)?.label ?? head.warehouse_zone

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phiếu nhập ${head.receipt_code || "(chưa cấp mã)"}`}
        description={head.supplier?.name || undefined}
        backHref="/purchasing/receipts"
      >
        <Badge variant="secondary">{receiptStatusLabel(head.status)}</Badge>
      </PageHeader>

      {head.status === "cancelled" && (
        <div className="rounded-xl border border-outline-variant bg-muted/40 px-3.5 py-3 text-sm">
          <span className="font-semibold">Phiếu đã huỷ.</span>{" "}
          {/* ⚠ LÝ DO HUỶ PHẢI HIỆN RA. Không hiện thì người mở lại phiếu
              chỉ thấy một chứng từ chết mà không biết vì sao. */}
          {head.cancel_reason || "Không ghi lý do."}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Thông tin chung</CardTitle></CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Nhà cung cấp" value={head.supplier?.name || "—"} />
          <Row label="Số hoá đơn đầu vào" value={head.invoice_number || "chưa xác định"} />
          <Row label="Ngày nhập" value={head.invoice_date ? formatDate(head.invoice_date) : "chưa xác định"} />
          <Row label="Kho đích" value={zoneLabel || "—"} />
          {head.completed_at && <Row label="Hoàn thành lúc" value={formatDate(head.completed_at)} />}
          {head.notes && <Row label="Ghi chú" value={head.notes} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Chi tiết hàng nhập ({lines.length} dòng)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 px-2 py-2 text-left">STT</th>
                  <th className="w-28 px-2 py-2 text-left">Mã hàng</th>
                  <th className="px-2 py-2 text-left">Tên hàng</th>
                  <th className="px-2 py-2 text-left">Ghi chú</th>
                  <th className="w-24 px-2 py-2 text-left">ĐVT</th>
                  <th className="w-20 px-2 py-2 text-right">SL</th>
                  <th className="w-28 px-2 py-2 text-right">Đơn giá</th>
                  <th className="w-24 px-2 py-2 text-right">Giảm giá</th>
                  <th className="w-16 px-2 py-2 text-right">VAT</th>
                  <th className="w-32 px-2 py-2 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr className="border-t">
                    <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                      Phiếu chưa có dòng hàng nào.
                    </td>
                  </tr>
                ) : lines.map((l, i) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{l.sort_order || i + 1}</td>
                    <td className="px-2 py-2 font-mono text-xs">{l.product?.sku || "—"}</td>
                    <td className="px-2 py-2">{l.product?.name || "Sản phẩm đã xoá"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{l.notes || "—"}</td>
                    <td className="px-2 py-2">
                      {l.unit_name}
                      {Number(l.conversion_factor) > 1 && (
                        <span className="text-[11px] text-muted-foreground"> (×{l.conversion_factor})</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(l.unit_price)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCurrency(Number(l.line_discount || 0))}
                    </td>
                    {/* ⚠ CỘT `vat_rate` LÀ TỈ LỆ — in thẳng rồi dán dấu %
                        vào là hiện "0.1%" cho một dòng thuế 10%. */}
                    <td className="px-2 py-2 text-right tabular-nums">{ratioToPercent(l.vat_rate)}%</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">
                      {formatCurrency(Number(l.line_total || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="ml-auto grid w-full max-w-sm gap-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tiền hàng</span>
          <span className="tabular-nums">{formatCurrency(Number(head.subtotal || 0))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Thuế GTGT</span>
          <span className="tabular-nums">{formatCurrency(Number(head.vat || 0))}</span>
        </div>
        {Number(head.discount || 0) > 0 && (
          <div className="flex justify-between text-[#b54708]">
            <span>Giảm giá cả phiếu</span>
            <span className="tabular-nums">−{formatCurrency(Number(head.discount))}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 text-base font-extrabold">
          <span>Cần trả NCC</span>
          <span className="tabular-nums">{formatCurrency(Number(head.total || 0))}</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {ghiDuoc && isDraft && (
          <Button variant="outline" asChild>
            <Link href={`/purchasing/receipts/${head.id}/edit`}>
              <Pencil className="mr-1.5 h-4 w-4" /> Sửa
            </Link>
          </Button>
        )}
        {ghiDuoc && head.status !== "cancelled" && (
          <Button variant="outline" onClick={() => setAskCancel(true)} disabled={busy}>
            <XCircle className="mr-1.5 h-4 w-4" /> Huỷ phiếu
          </Button>
        )}
        {ghiDuoc && isDraft && (
          <Button onClick={() => run("complete_purchase_invoice")} disabled={busy || lines.length === 0}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />}
            Hoàn thành
          </Button>
        )}
        {isDone && (
          <Button variant="outline" asChild>
            <Link href={`/purchasing/receipts/${head.id}/edit`}>
              <Pencil className="mr-1.5 h-4 w-4" /> Sửa phiếu
            </Link>
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={askCancel}
        onOpenChange={setAskCancel}
        title="Huỷ phiếu nhập hàng?"
        description={
          isDone
            ? "Kho sẽ trừ lại đúng số đã nhập và công nợ NCC của phiếu này bị xoá. Không huỷ được nếu hàng đã xuất bớt hoặc đã trả tiền."
            : "Phiếu tạm chưa đụng tới kho hay công nợ — huỷ chỉ đổi trạng thái."
        }
        confirmLabel="Huỷ phiếu"
        onConfirm={() => run("cancel_purchase_invoice", "Người dùng huỷ từ màn chi tiết")}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 last:border-0 sm:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}
