"use client"

/**
 * Dialog XUẤT HÀNG — lập một hóa đơn từ đơn đặt hàng.
 *
 * ⚠ ĐÂY LÀ MÀN "ĐANG SOẠN", CHƯA CHẠM CƠ SỞ DỮ LIỆU. Mọi con số trong
 * dialog sống trên trình duyệt cho tới khi bấm nút cuối. Hóa đơn không
 * có trạng thái nháp, nên nếu có một bảng `sales_invoices` mang dòng dở
 * dang thì đó là giấy đã in mà kho chưa trừ.
 *
 * ⚠ NPP TOÀN QUYỀN SỬA SỐ LƯỢNG VÀ GIÁ (PATCH 1). Không có chốt chặn nào
 * ở đây — chỉ cảnh báo vàng. Trần giá của nhân viên bán hàng
 * (`priceViolation` ở màn `/sell`) GIỮ NGUYÊN và không liên quan tới
 * dialog này; chủ nhà đã chốt như vậy (Q3 = a).
 */

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MoneyInput } from "@/components/ui/money-input"
import { formatCurrency } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import {
  invoiceTotals,
  loadInvoiceableLines,
  postInvoice,
  invoiceWarnings,
  shortageOf,
  type InvoiceableLine,
  type InvoiceDraftLine,
  type PostInvoiceResult,
} from "@/lib/orders/post-invoice"

interface Props {
  orderId: string | null
  orderCode: string
  /** Bao nhiêu phần trăm lệch giá thì nhuộm vàng. 0 = không cảnh báo. */
  priceWarnPct?: number
  onClose: () => void
  onPosted: (r: PostInvoiceResult) => void
}

interface Row extends InvoiceableLine {
  key: string
  qty: number
  price: number
}

export function InvoiceDialog({
  orderId, orderCode, priceWarnPct = 10, onClose, onPosted,
}: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadInvoiceableLines(supabase, orderId)
      .then((lines) => {
        if (cancelled) return
        setRows(
          lines.map((l, i) => ({
            ...l,
            key: l.orderLineId ?? l.returnLineId ?? `x${i}`,
            // Mặc định xuất hết phần còn lại — việc thường ngày là xuất
            // đủ, xuất thiếu mới là ngoại lệ phải gõ tay.
            qty: l.remainingQty,
            price: l.unitPrice,
          }))
        )
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const draft: InvoiceDraftLine[] = useMemo(
    () =>
      rows.map((r) => ({
        orderLineId: r.orderLineId,
        productId: r.productId,
        unitName: r.unitName,
        conversionFactor: r.conversionFactor,
        quantity: r.qty,
        unitPrice: r.price,
        // ⚠ CHIẾT KHẤU CHỈ ĐỂ GHI NHỚ, và nó là số tiền của cả dòng —
        //   giữ nguyên số của đơn thì dòng xuất một nửa mang khoản giảm
        //   của cả đơn. Tính lại theo tỉ lệ phần đang xuất.
        lineDiscount:
          r.remainingQty > 0 && r.lineDiscount > 0
            ? Math.round((r.lineDiscount * r.qty) / r.remainingQty)
            : 0,
        vatRate: r.vatRate,
        isExchange: r.isExchange,
        note: r.note,
      })),
    [rows]
  )

  const totals = useMemo(() => invoiceTotals(draft), [draft])
  const picked = rows.filter((r) => r.qty > 0)

  /**
   * ⚠ SO GIÁ VỚI GIÁ TRÊN ĐƠN, KHÔNG VỚI `products.sell_price`.
   * `sell_price` là giá theo ĐƠN VỊ CƠ SỞ, còn dòng đơn có thể bán theo
   * thùng — và khách có bảng giá riêng thì giá bảng của họ cũng khác.
   * So thẳng hai con số ấy là nhuộm vàng mọi dòng bán theo thùng.
   * Giá trên đơn là thứ khách đã đồng ý, nên lệch khỏi nó mới đáng hỏi.
   */
  const priceOff = (r: Row): boolean => {
    if (priceWarnPct <= 0 || r.unitPrice <= 0) return false
    const diff = Math.abs(r.price - r.unitPrice)
    return diff > (r.unitPrice * priceWarnPct) / 100
  }

  const shortRows = rows.filter((r) => r.qty > 0 && shortageOf(r, r.qty) > 0)
  const overRows = rows.filter((r) => r.orderLineId && r.qty > r.remainingQty)

  const setQty = (key: string, v: number) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, qty: Math.max(0, v) } : r)))
  const setPrice = (key: string, v: number) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, price: Math.max(0, v) } : r)))

  const submit = async () => {
    if (!orderId || picked.length === 0) return
    setSaving(true)
    try {
      const r = await postInvoice(supabase, {
        orderId,
        lines: draft,
        notes: notes.trim() || null,
      })
      const w = invoiceWarnings(r)
      toast({ title: `Đã xuất hóa đơn ${r.invoiceCode ?? ""}`.trim() })
      if (w) {
        // ⚠ Cảnh báo đi TOAST RIÊNG. Nhét vào description của toast thành
        //   công là để nó đọc như một lời chúc mừng có chú thích.
        toast({ title: "Xuất thiếu hàng", description: w, variant: "destructive" })
      }
      onPosted(r)
    } catch (e) {
      toast({ title: "Không xuất được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!orderId} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Xuất hàng — đơn {orderCode}</DialogTitle>
          <DialogDescription>
            Sửa số lượng và giá thoải mái. Phần chưa xuất vẫn nằm lại trên đơn để
            xuất đợt sau.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Đơn không có dòng hàng nào.
          </p>
        ) : (
          <>
            <div className="max-h-[50vh] overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Mặt hàng</th>
                    <th className="px-3 py-2 text-right">Đặt / đã xuất</th>
                    <th className="px-3 py-2 text-right">Tồn kho</th>
                    <th className="px-3 py-2 text-right">SL xuất</th>
                    <th className="px-3 py-2 text-right">Đơn giá</th>
                    <th className="px-3 py-2 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const short = r.qty > 0 ? shortageOf(r, r.qty) : 0
                    const over = !!r.orderLineId && r.qty > r.remainingQty
                    return (
                      <tr key={r.key} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.productName}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.sku ? `${r.sku} · ` : ""}{r.unitName}
                            {r.isExchange && (
                              <Badge variant="secondary" className="ml-1.5">Hàng đổi</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                          {r.orderLineId ? `${r.orderedQty} / ${r.invoicedQty}` : "—"}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums text-xs ${
                            short > 0 ? "text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          {r.availableBase}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            step="any"
                            min={0}
                            value={r.qty}
                            onChange={(e) => setQty(r.key, Number(e.target.value))}
                            className={`h-8 w-24 text-right tabular-nums ${
                              over ? "border-amber-300" : ""
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <MoneyInput
                            value={r.price}
                            onChange={(v) => setPrice(r.key, v)}
                            showSuffix={false}
                            className="w-32"
                            inputClassName={`h-8 text-right tabular-nums ${
                              priceOff(r) ? "border-amber-300" : ""
                            }`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(r.qty * r.price)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/*
              ⚠ VẤN ĐỀ VÀ THÔNG TIN TÁCH RIÊNG. Gộp "thiếu hàng" với "giá
                lệch" vào một dòng vàng thì người đọc bỏ qua cả hai.
            */}
            {shortRows.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {shortRows.length} dòng vượt tồn kho bán. Vẫn xuất được nếu đơn vị
                  cho phép bán âm — tồn sẽ âm cho tới khi nhập bù.
                </span>
              </p>
            )}
            {overRows.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {overRows.length} dòng xuất nhiều hơn phần còn lại của đơn. Được
                  phép, nhưng kiểm lại xem có gõ nhầm không.
                </span>
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label
                  htmlFor="inv-note"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Ghi chú hóa đơn
                </Label>
                <Textarea
                  id="inv-note"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ví dụ: giao đợt 1, còn lại giao tuần sau"
                />
              </div>
              <dl className="self-end space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tiền hàng</dt>
                  <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Thuế GTGT</dt>
                  <dd className="tabular-nums">{formatCurrency(totals.vat)}</dd>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <dt>Tổng cộng</dt>
                  <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
                </div>
              </dl>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button
            onClick={submit}
            disabled={saving || loading || picked.length === 0}
            title={picked.length === 0 ? "Nhập số lượng cho ít nhất một dòng" : undefined}
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <PackageCheck className="mr-1.5 h-4 w-4" />
            )}
            Xuất {picked.length} dòng · {formatCurrency(totals.total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
