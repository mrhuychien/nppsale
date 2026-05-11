"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatCurrency } from "@/lib/utils"
import { Plus, Trash2, CheckCircle2, Save, Package, X, ArrowLeft } from "lucide-react"

interface SupplierOpt { id: string; name: string; code: string | null }
interface ProductOpt {
  id: string
  sku: string
  name: string
  base_unit: string
  units?: { unit_name: string; conversion: number }[]
}

interface LineDraft {
  key: string
  product_id: string
  unit_name: string
  quantity: string
  unit_price: string
  conversion_factor: number
}

function newKey() {
  return Math.random().toString(36).slice(2)
}

export function PurchaseInvoiceForm({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)

  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [products, setProducts] = useState<ProductOpt[]>([])

  // Form state
  const [supplierId, setSupplierId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<LineDraft[]>([])
  const [status, setStatus] = useState<"draft" | "completed" | "cancelled" | null>(null)
  const [linkedStockEntryId, setLinkedStockEntryId] = useState<string | null>(null)
  const [linkedPayableId, setLinkedPayableId] = useState<string | null>(null)
  const [productPickerKey, setProductPickerKey] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState("")

  // Load reference data + (if editing) the invoice.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [supRes, prodRes] = await Promise.all([
        supabase.from("suppliers").select("id, name, code").order("name"),
        supabase
          .from("products")
          .select("id, sku, name, base_unit, units:product_units(unit_name, conversion)")
          .eq("status", "active")
          .order("name"),
      ])
      if (cancelled) return
      setSuppliers((supRes.data as SupplierOpt[]) || [])
      setProducts((prodRes.data as ProductOpt[]) || [])

      if (invoiceId) {
        const [invRes, lineRes] = await Promise.all([
          supabase.from("purchase_invoices").select("*").eq("id", invoiceId).single(),
          supabase.from("purchase_invoice_lines").select("*").eq("invoice_id", invoiceId).order("created_at"),
        ])
        if (cancelled) return
        const inv = invRes.data as {
          supplier_id: string; invoice_number: string | null; invoice_date: string
          notes: string | null; status: "draft" | "completed" | "cancelled"
          stock_entry_id: string | null; payable_id: string | null
        } | null
        if (inv) {
          setSupplierId(inv.supplier_id)
          setInvoiceNumber(inv.invoice_number || "")
          setInvoiceDate(inv.invoice_date)
          setNotes(inv.notes || "")
          setStatus(inv.status)
          setLinkedStockEntryId(inv.stock_entry_id)
          setLinkedPayableId(inv.payable_id)
        }
        const ls = (lineRes.data as Array<{
          product_id: string; unit_name: string; quantity: number; unit_price: number; conversion_factor: number
        }>) || []
        setLines(
          ls.length
            ? ls.map((l) => ({
                key: newKey(),
                product_id: l.product_id,
                unit_name: l.unit_name,
                quantity: String(l.quantity ?? 0),
                unit_price: String(l.unit_price ?? 0),
                conversion_factor: Number(l.conversion_factor ?? 1),
              }))
            : []
        )
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [invoiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isCompleted = status === "completed"
  const readOnly = isCompleted

  // Unit options for a given product (base unit + product_units).
  const unitOptionsFor = (productId: string): { name: string; conversion: number }[] => {
    const p = products.find((x) => x.id === productId)
    if (!p) return [{ name: "", conversion: 1 }]
    const opts = new Map<string, number>()
    opts.set(p.base_unit, 1)
    for (const u of p.units || []) opts.set(u.unit_name, Number(u.conversion || 1))
    return Array.from(opts.entries()).map(([name, conversion]) => ({ name, conversion }))
  }

  const addLine = (productId: string) => {
    const p = products.find((x) => x.id === productId)
    if (!p) return
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        product_id: productId,
        unit_name: p.base_unit,
        quantity: "1",
        unit_price: "0",
        conversion_factor: 1,
      },
    ])
    setProductPickerKey(null)
    setProductSearch("")
  }

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }
  const setLineUnit = (key: string, unitName: string) => {
    const line = lines.find((l) => l.key === key)
    if (!line) return
    const opts = unitOptionsFor(line.product_id)
    const conv = opts.find((o) => o.name === unitName)?.conversion ?? 1
    updateLine(key, { unit_name: unitName, conversion_factor: conv })
  }
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key))

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0),
    [lines]
  )
  const total = subtotal // VAT có thể bổ sung sau; hiện hoá đơn nhập = subtotal

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 50)
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 50)
  }, [products, productSearch])

  const canSave =
    !!supplierId && lines.length > 0 && lines.every((l) => l.product_id && Number(l.quantity) > 0)

  const handleSave = async (): Promise<string | null> => {
    if (!user?.org_id) return null
    if (!canSave) {
      toast({ title: "Thiếu thông tin", description: "Cần chọn NCC và ít nhất 1 dòng hàng có SL > 0.", variant: "destructive" })
      return null
    }
    setSaving(true)
    try {
      let id = invoiceId
      const header = {
        org_id: user.org_id,
        supplier_id: supplierId,
        invoice_number: invoiceNumber.trim() || null,
        invoice_date: invoiceDate,
        subtotal,
        vat: 0,
        total,
        notes: notes.trim() || null,
        status: "draft" as const,
      }
      if (!id) {
        const { data, error } = await supabase
          .from("purchase_invoices")
          .insert({ ...header, created_by: user.id })
          .select("id")
          .single()
        if (error) throw error
        id = (data as { id: string }).id
      } else {
        const { error } = await supabase.from("purchase_invoices").update(header).eq("id", id)
        if (error) throw error
      }
      // Replace lines.
      await supabase.from("purchase_invoice_lines").delete().eq("invoice_id", id!)
      if (lines.length > 0) {
        const rows = lines.map((l) => {
          const qty = Number(l.quantity || 0)
          const price = Number(l.unit_price || 0)
          return {
            invoice_id: id!,
            product_id: l.product_id,
            unit_name: l.unit_name,
            quantity: qty,
            unit_price: price,
            vat_rate: 0,
            conversion_factor: l.conversion_factor || 1,
            line_total: qty * price,
          }
        })
        const { error: lErr } = await supabase.from("purchase_invoice_lines").insert(rows)
        if (lErr) throw lErr
      }
      toast({ title: "Đã lưu hoá đơn nhập (nháp)" })
      return id!
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndStay = async () => {
    const id = await handleSave()
    if (id && !invoiceId) router.replace(`/purchasing/invoices/${id}`)
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      // Lưu trước (đảm bảo lines mới nhất), rồi gọi RPC.
      const id = await handleSave()
      if (!id) { setCompleting(false); return }
      const { error } = await supabase.rpc("complete_purchase_invoice", { p_invoice_id: id })
      if (error) throw error
      toast({ title: "Đã hoàn thành hoá đơn", description: "Đã ghi công nợ NCC + nhập kho." })
      setCompleteOpen(false)
      router.replace(`/purchasing/invoices/${id}`)
      // Reload local state.
      setStatus("completed")
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    } finally {
      setCompleting(false)
    }
  }

  const handleDelete = async () => {
    if (!invoiceId) return
    try {
      const { error } = await supabase.from("purchase_invoices").delete().eq("id", invoiceId)
      if (error) throw error
      toast({ title: "Đã xoá hoá đơn nhập" })
      router.push("/purchasing/invoices")
    } catch (e) {
      toast({ title: "Lỗi", description: (e as Error).message, variant: "destructive" })
    }
  }

  if (loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      {/* Header info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Thông tin hoá đơn</CardTitle>
          {isCompleted && (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              Đã hoàn thành — không thể sửa
            </span>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nhà cung cấp *</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Chọn NCC" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Số hoá đơn</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="VD: HD-001" disabled={readOnly} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ngày hoá đơn</Label>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tuỳ chọn" disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Chi tiết hàng hoá ({lines.length})</CardTitle>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setProductPickerKey("new"); setProductSearch("") }}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Thêm SP
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              Chưa có dòng hàng nào. {!readOnly && "Bấm \"Thêm SP\" để thêm."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 text-left">Sản phẩm</th>
                    <th className="px-3 py-2 text-left w-28">ĐVT</th>
                    <th className="px-3 py-2 text-right w-24">SL</th>
                    <th className="px-3 py-2 text-right w-40">Đơn giá</th>
                    <th className="px-3 py-2 text-right w-32">Thành tiền</th>
                    {!readOnly && <th className="px-3 py-2 w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const p = products.find((x) => x.id === l.product_id)
                    const opts = unitOptionsFor(l.product_id)
                    const lineTotal = Number(l.quantity || 0) * Number(l.unit_price || 0)
                    return (
                      <tr key={l.key} className="border-t">
                        <td className="px-3 py-2">
                          <p className="font-medium">{p?.name || "—"}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{p?.sku || ""}</p>
                        </td>
                        <td className="px-3 py-2">
                          {readOnly ? (
                            <span>{l.unit_name}</span>
                          ) : (
                            <Select value={l.unit_name} onValueChange={(v) => setLineUnit(l.key, v)}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {opts.map((o) => (
                                  <SelectItem key={o.name} value={o.name}>
                                    {o.name}{o.conversion > 1 ? ` (×${o.conversion})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {readOnly ? (
                            <span className="tabular-nums">{Number(l.quantity)}</span>
                          ) : (
                            <Input
                              type="number" min={0} step="any"
                              value={l.quantity}
                              onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                              className="h-8 w-20 text-right tabular-nums"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {readOnly ? (
                            <span className="block text-right tabular-nums">{formatCurrency(Number(l.unit_price))}</span>
                          ) : (
                            <MoneyInput
                              value={l.unit_price}
                              onChange={(v) => updateLine(l.key, { unit_price: String(v) })}
                              showSuffix={false}
                              className="h-8"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {formatCurrency(lineTotal)}
                        </td>
                        {!readOnly && (
                          <td className="px-3 py-2 text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeLine(l.key)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/20 font-bold">
                    <td colSpan={readOnly ? 4 : 4} className="px-3 py-3 text-right">Tổng cộng</td>
                    <td className="px-3 py-3 text-right tabular-nums text-lg text-primary">{formatCurrency(total)}</td>
                    {!readOnly && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked docs when completed */}
      {isCompleted && (
        <Card className="border-emerald-300 bg-emerald-50/40">
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-6 text-sm">
            <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Đã ghi công nợ NCC + nhập kho
            </span>
            {linkedStockEntryId && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/inventory/entries/${linkedStockEntryId}`}>Xem phiếu nhập kho</a>
              </Button>
            )}
            {linkedPayableId && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/payables/${linkedPayableId}`}>Xem công nợ NCC</a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/purchasing/invoices")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Danh sách
        </Button>
        {invoiceId && !isCompleted && (
          <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1.5" /> Xoá
          </Button>
        )}
        {!readOnly && (
          <>
            <Button variant="outline" onClick={handleSaveAndStay} disabled={saving || completing}>
              <Save className="h-4 w-4 mr-1.5" /> {saving ? "Đang lưu…" : invoiceId ? "Lưu thay đổi" : "Lưu nháp"}
            </Button>
            <Button onClick={() => setCompleteOpen(true)} disabled={saving || completing || !canSave}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Hoàn thành
            </Button>
          </>
        )}
      </div>

      {/* Product picker dialog */}
      {productPickerKey && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={() => setProductPickerKey(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b p-3">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                autoFocus
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Tìm tên / SKU…"
                className="h-9"
              />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setProductPickerKey(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ul className="max-h-80 overflow-y-auto p-1">
              {filteredProducts.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Không tìm thấy sản phẩm</li>
              ) : (
                filteredProducts.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addLine(p.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{p.sku}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Xoá hoá đơn nhập?"
        description="Hoá đơn nháp này sẽ bị xoá vĩnh viễn cùng các dòng hàng. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xoá"
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Hoàn thành hoá đơn nhập?"
        description={`Hệ thống sẽ ghi công nợ NCC ${formatCurrency(total)} và nhập kho theo các dòng hàng. Sau khi hoàn thành không thể sửa.`}
        confirmLabel={completing ? "Đang xử lý…" : "Hoàn thành"}
        onConfirm={handleComplete}
        loading={completing}
      />
    </div>
  )
}
