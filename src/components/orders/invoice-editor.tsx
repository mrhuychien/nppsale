"use client"

/**
 * MÀN SOẠN HÓA ĐƠN BÁN — toàn trang.
 *
 * ⚠ TRƯỚC ĐÂY LÀ MỘT HỘP THOẠI. Chủ nhà chốt đổi sang toàn trang, bố cục
 * như màn tạo đơn: bảng dòng hàng ở giữa, thanh tổng tiền dính đáy, và
 * thêm được mã hàng KHÔNG có trong đơn gốc.
 *
 * ⚠ CHƯA CHẠM CƠ SỞ DỮ LIỆU CHO TỚI NÚT CUỐI. Hóa đơn không có trạng
 * thái nháp — một dòng `sales_invoices` là giấy đã in và kho đã trừ.
 *
 * ⚠ NPP TOÀN QUYỀN SỬA SỐ LƯỢNG VÀ GIÁ. Không có chốt chặn nào ở đây,
 * chỉ cảnh báo vàng. Trần giá của nhân viên bán hàng (`priceViolation` ở
 * màn `/sell`) giữ nguyên và không liên quan tới màn này.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, PackageCheck, Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MoneyInput } from "@/components/ui/money-input"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import {
  invoiceTotals, loadInvoiceableLines, postInvoice, reissueInvoice,
  invoiceWarnings, shortageOf, type PostInvoiceResult,
} from "@/lib/orders/post-invoice"
import {
  seedForNew, seedForReissue, makeAddedRow, withStock, toDraft,
  rowsOverOrdered, searchAddable,
  type EditorRow, type ReissueSeedLine,
} from "@/lib/orders/invoice-editor"
import { sellableUnits, type PricedProduct } from "@/lib/sell/pricing"

interface Props {
  orderId: string
  orderCode: string
  /** Nhóm giá của khách trên đơn — quyết định giá của mã thêm tay. */
  priceGroupId: string | null
  reissueOf?: { invoiceId: string; invoiceCode: string; lines: ReissueSeedLine[] } | null
  priceWarnPct?: number
  /** Nơi quay về khi huỷ hoặc xong. */
  backHref: string
}

export function InvoiceEditor({
  orderId, orderCode, priceGroupId, reissueOf = null, priceWarnPct = 10, backHref,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<EditorRow[]>([])
  const [notes, setNotes] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)

  const [catalog, setCatalog] = useState<PricedProduct[]>([])
  const [term, setTerm] = useState("")
  const [addUnit, setAddUnit] = useState<Record<string, string>>({})
  const seqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadInvoiceableLines(supabase, orderId)
      .then((lines) => {
        if (cancelled) return
        setRows(reissueOf ? seedForReissue(lines, reissueOf.lines) : seedForNew(lines))
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, reissueOf?.invoiceId])

  /**
   * ⚠ DANH MỤC NẠP NỀN, KHÔNG CHẶN MÀN. Người dùng vào đây để xuất phần
   *   còn lại của đơn — việc thường ngày. Bắt họ chờ cả bảng sản phẩm
   *   tải xong mới thấy dòng hàng là bắt chờ cho một tính năng họ có thể
   *   không dùng tới.
   */
  useEffect(() => {
    let cancelled = false
    supabase
      .from("products")
      .select("id, sku, name, base_unit, vat_rate, sell_price, status, price_lists(*), units:product_units(*)")
      .eq("status", "active")
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error("[invoice-editor] nạp danh mục lỗi:", error.message)
          return
        }
        setCatalog(((data as unknown) as PricedProduct[]) || [])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const draft = useMemo(() => toDraft(rows), [rows])
  const totals = useMemo(() => invoiceTotals(draft), [draft])
  const picked = rows.filter((r) => r.qty > 0)

  const onScreen = useMemo(() => new Set(rows.map((r) => r.productId)), [rows])
  const hits = useMemo(
    () => searchAddable(catalog, term, onScreen),
    [catalog, term, onScreen]
  )

  /**
   * ⚠ SO GIÁ VỚI GIÁ TRÊN ĐƠN, KHÔNG VỚI `products.sell_price`.
   * `sell_price` là giá theo đơn vị cơ sở, còn dòng đơn có thể bán theo
   * thùng — so thẳng là nhuộm vàng mọi dòng bán theo thùng.
   */
  const priceOff = (r: EditorRow): boolean => {
    if (priceWarnPct <= 0 || r.unitPrice <= 0) return false
    return Math.abs(r.price - r.unitPrice) > (r.unitPrice * priceWarnPct) / 100
  }

  const shortRows = rows.filter((r) => r.qty > 0 && r.stockKnown && shortageOf(r, r.qty) > 0)
  const overRows = rowsOverOrdered(rows)

  const setQty = (key: string, v: number) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, qty: Math.max(0, v) } : r)))
  const setPrice = (key: string, v: number) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, price: Math.max(0, v) } : r)))
  const dropRow = (key: string) => setRows((p) => p.filter((r) => r.key !== key))

  const addProduct = async (p: PricedProduct) => {
    const unit = addUnit[p.id] || p.base_unit
    seqRef.current += 1
    const row = makeAddedRow(p, unit, priceGroupId, seqRef.current)
    setRows((prev) => [...prev, row])
    setTerm("")

    /**
     * ⚠ HỎI TỒN SAU KHI THÊM, và tới lúc đó mới bật cảnh báo cho dòng
     *   này. Tô vàng "vượt tồn" khi còn chưa hỏi kho là kêu oan — người
     *   dùng học được cách bỏ qua màu vàng, rồi lần nó kêu thật thì không
     *   ai nhìn.
     */
    const { data, error } = await supabase
      .from("batches")
      .select("qty_on_hand")
      .eq("product_id", p.id)
      .eq("warehouse_zone", "sale")
    if (error) {
      console.error("[invoice-editor] tra tồn lỗi:", error.message)
      return
    }
    const sum = ((data as Array<{ qty_on_hand: number | null }>) || []).reduce(
      (a, b) => a + Number(b.qty_on_hand ?? 0), 0
    )
    setRows((prev) => withStock(prev, row.key, sum))
  }

  const submit = async () => {
    if (picked.length === 0) return
    setSaving(true)
    try {
      const r: PostInvoiceResult = reissueOf
        ? await reissueInvoice(supabase, reissueOf.invoiceId, {
            lines: draft, notes: notes.trim() || null,
          })
        : await postInvoice(supabase, {
            orderId, lines: draft, notes: notes.trim() || null,
          })
      const w = invoiceWarnings(r)
      toast({
        title: reissueOf
          ? `Đã lập lại: ${reissueOf.invoiceCode} → ${r.invoiceCode ?? ""}`.trim()
          : `Đã xuất hóa đơn ${r.invoiceCode ?? ""}`.trim(),
      })
      // ⚠ Cảnh báo đi TOAST RIÊNG. Nhét vào description của toast thành
      //   công là để nó đọc như một lời chúc mừng có chú thích.
      if (w) toast({ title: "Xuất thiếu hàng", description: w, variant: "destructive" })
      router.push(r.invoiceId ? `/sales-invoices/${r.invoiceId}` : backHref)
    } catch (e) {
      toast({ title: "Không xuất được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title={reissueOf ? `Sửa hóa đơn ${reissueOf.invoiceCode}` : "Xuất hàng"}
        description={
          reissueOf
            ? "Hóa đơn cũ sẽ bị huỷ và một hóa đơn mới được lập, trong cùng một giao dịch. Kho hoàn về đúng lô đã lấy rồi mới trừ lại theo số mới."
            : "Sửa số lượng và giá thoải mái. Phần chưa xuất vẫn nằm lại trên đơn để xuất đợt sau."
        }
        backHref={backHref}
      >
        <Badge variant="secondary" className="font-mono">{orderCode}</Badge>
      </PageHeader>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Mặt hàng</th>
                  <th className="px-3 py-2 text-right">Đặt / đã xuất</th>
                  <th className="px-3 py-2 text-right">Tồn kho</th>
                  <th className="px-3 py-2 text-right">SL xuất</th>
                  <th className="px-3 py-2 text-right">Đơn giá</th>
                  <th className="px-3 py-2 text-right">Thành tiền</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr className="border-t">
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Đơn không còn dòng nào để xuất. Thêm mã hàng bên dưới nếu cần.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const short = r.qty > 0 && r.stockKnown ? shortageOf(r, r.qty) : 0
                    const over = !!r.orderLineId && r.qty > r.remainingQty
                    return (
                      <tr key={r.key} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.productName}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.sku ? `${r.sku} · ` : ""}{r.unitName}
                            {r.isExchange && <Badge variant="secondary" className="ml-1.5">Hàng đổi</Badge>}
                            {r.addedByHand && <Badge variant="outline" className="ml-1.5">Thêm tay</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                          {r.orderLineId ? `${r.orderedQty} / ${r.invoicedQty}` : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs ${short > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {/* ⚠ CHƯA TRA XONG THÌ NÓI LÀ CHƯA BIẾT, đừng in 0 —
                              0 đọc như "hết hàng" và đó là một câu nói dối. */}
                          {r.stockKnown ? r.availableBase : "…"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number" step="any" min={0} value={r.qty}
                            onChange={(e) => setQty(r.key, Number(e.target.value))}
                            className={`h-9 w-24 text-right tabular-nums ${over ? "border-amber-300" : ""}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <MoneyInput
                            value={r.price} onChange={(v) => setPrice(r.key, v)}
                            showSuffix={false} className="w-32"
                            inputClassName={`h-9 text-right tabular-nums ${priceOff(r) ? "border-amber-300" : ""}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(r.qty * r.price)}
                        </td>
                        <td className="px-2 py-2">
                          {/* ⚠ CHỈ XOÁ ĐƯỢC DÒNG TỰ THÊM. Dòng của đơn phải
                              đặt số lượng 0 — xoá nó khỏi màn là giấu mất
                              phần đơn chưa xuất. */}
                          {r.addedByHand && (
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                              onClick={() => dropRow(r.key)}
                              title="Bỏ dòng thêm tay này"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ⚠ VẤN ĐỀ VÀ THÔNG TIN TÁCH RIÊNG. Gộp "thiếu hàng" với "xuất
              vượt đơn" vào một dòng vàng thì người đọc bỏ qua cả hai. */}
          {shortRows.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {shortRows.length} dòng vượt tồn kho bán. Vẫn xuất được nếu đơn vị cho
                phép bán âm — tồn sẽ âm cho tới khi nhập bù.
              </span>
            </p>
          )}
          {overRows.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {overRows.length} dòng xuất nhiều hơn phần còn lại của đơn. Được phép,
                nhưng kiểm lại xem có gõ nhầm không.
              </span>
            </p>
          )}

          {/* ---------------- Thêm mã hàng ngoài đơn ---------------- */}
          <Card>
            <CardContent className="space-y-3 pt-5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Thêm mã hàng không có trong đơn
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder={catalog.length ? "Tên hàng hoặc mã SKU…" : "Đang nạp danh mục…"}
                  disabled={catalog.length === 0}
                  className="pl-8"
                />
              </div>
              {term.trim() !== "" && hits.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Không tìm thấy mã nào khớp, hoặc mã đó đã có trên hóa đơn.
                </p>
              )}
              {hits.length > 0 && (
                <ul className="divide-y rounded-xl border">
                  {hits.map((p) => {
                    const units = sellableUnits(p)
                    const unit = addUnit[p.id] || p.base_unit
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.sku || "—"}</div>
                        </div>
                        {units.length > 1 && (
                          <Select
                            value={unit}
                            onValueChange={(v) => setAddUnit((s) => ({ ...s, [p.id]: v }))}
                          >
                            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        <Button size="sm" onClick={() => addProduct(p)}>
                          <Plus className="mr-1 h-4 w-4" /> Thêm
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-note" className="text-xs uppercase tracking-wider text-muted-foreground">
                Ghi chú hóa đơn
              </Label>
              <Textarea
                id="inv-note" rows={2} value={notes}
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

          {/* Thanh hành động dính đáy — giống màn giỏ hàng, để ngón tay
              không phải đi tìm nút trên màn dài. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">{picked.length} dòng</div>
                <div className="truncate text-lg font-bold tabular-nums">
                  {formatCurrency(totals.total)}
                </div>
              </div>
              <Button variant="outline" onClick={() => router.push(backHref)} disabled={saving}>
                Huỷ
              </Button>
              <Button
                onClick={submit}
                disabled={saving || picked.length === 0}
                title={picked.length === 0 ? "Nhập số lượng cho ít nhất một dòng" : undefined}
              >
                {saving
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <PackageCheck className="mr-1.5 h-4 w-4" />}
                {reissueOf ? "Lập lại" : "Xuất hàng"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
