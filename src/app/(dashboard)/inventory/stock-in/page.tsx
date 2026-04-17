"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"
import {
  ArrowLeft,
  Info,
  Plus,
  Trash2,
  Package,
  ArrowDownToLine,
  ExternalLink,
} from "lucide-react"
import type { Product, Supplier } from "@/types"

interface LineItem {
  id: string
  product_id: string
  quantity: string
  unit_price: string
  batch_code: string
  manufactured_at: string
  expires_at: string
}

function newLine(): LineItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    product_id: "",
    quantity: "",
    unit_price: "",
    batch_code: "",
    manufactured_at: "",
    expires_at: "",
  }
}

export default function StockInPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [saving, setSaving] = useState(false)

  const [supplierId, setSupplierId] = useState("")
  const [supplier, setSupplier] = useState("")
  const [invoiceNo, setInvoiceNo] = useState("")
  const [entryDate, setEntryDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  )
  const [warehouse, setWarehouse] = useState("Kho chính")
  const [lines, setLines] = useState<LineItem[]>([newLine()])

  useEffect(() => {
    async function fetch() {
      const [prodRes, supRes] = await Promise.all([
        supabase.from("products").select("*").eq("status", "active").order("name"),
        supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
      ])
      setProducts((prodRes.data as Product[]) || [])
      // Suppliers might fail silently if migration 006 not yet run - that's OK
      if (supRes.data) setSuppliers(supRes.data as Supplier[])
      setProductsLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const productMap = useMemo(() => {
    const map = new Map<string, Product>()
    products.forEach((p) => map.set(p.id, p))
    return map
  }, [products])

  const summary = useMemo(() => {
    let qtyTotal = 0
    let subtotal = 0
    lines.forEach((l) => {
      const qty = parseFloat(l.quantity) || 0
      const price = parseFloat(l.unit_price) || 0
      qtyTotal += qty
      subtotal += qty * price
    })
    const vat = Math.round(subtotal * 0.1)
    const total = subtotal + vat
    return { qtyTotal, subtotal, vat, total }
  }, [lines])

  if (authLoading || productsLoading) return <Skeleton className="h-96" />

  function updateLine(id: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function removeLine(id: string) {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)
    )
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()])
  }

  function discardDraft() {
    setSupplier("")
    setInvoiceNo("")
    setEntryDate(new Date().toISOString().slice(0, 10))
    setWarehouse("Kho chính")
    setLines([newLine()])
    toast({ title: "Đã hủy bản nháp" })
  }

  async function handleSubmit() {
    if (!user?.org_id) {
      toast({ title: "Không xác định được tổ chức", variant: "destructive" })
      return
    }

    const validLines = lines.filter((l) => {
      const qty = parseFloat(l.quantity)
      return l.product_id && qty > 0
    })
    if (validLines.length === 0) {
      toast({
        title: "Cần ít nhất 1 dòng hàng hợp lệ",
        variant: "destructive",
      })
      return
    }
    for (const l of validLines) {
      if (!l.batch_code.trim() || !l.expires_at) {
        toast({
          title: "Thiếu thông tin lô hàng",
          description: "Mỗi dòng cần mã lô và HSD để áp dụng FEFO",
          variant: "destructive",
        })
        return
      }
    }

    setSaving(true)
    try {
      const entryCode = `IN-${entryDate.replace(/-/g, "")}-${Math.floor(
        1000 + Math.random() * 9000
      )}`

      const notesParts: string[] = []
      if (supplier.trim()) notesParts.push(`NCC: ${supplier.trim()}`)
      if (invoiceNo.trim()) notesParts.push(`HĐ: ${invoiceNo.trim()}`)
      if (warehouse.trim()) notesParts.push(`Kho: ${warehouse.trim()}`)
      const notes = notesParts.join(" • ") || null

      const insertPayload: Record<string, unknown> = {
        org_id: user.org_id,
        entry_code: entryCode,
        type: "import",
        created_by: user.id,
        notes,
      }
      if (supplierId) insertPayload.supplier_id = supplierId

      const { data: entry, error: entryErr } = await supabase
        .from("stock_entries")
        .insert(insertPayload)
        .select()
        .single()
      if (entryErr) throw entryErr

      // Create batches in bulk
      const batchPayload = validLines.map((l) => {
        const qty = parseFloat(l.quantity) || 0
        return {
          org_id: user.org_id,
          product_id: l.product_id,
          batch_code: l.batch_code.trim(),
          manufactured_at: l.manufactured_at || null,
          expires_at: l.expires_at,
          qty_initial: qty,
          qty_on_hand: qty,
        }
      })
      const { data: insertedBatches, error: batchErr } = await supabase
        .from("batches")
        .insert(batchPayload)
        .select()
      if (batchErr) throw batchErr

      // Create stock entry lines linked to the new batches (preserve order)
      const entryLines = validLines.map((l, idx) => {
        const qty = parseFloat(l.quantity) || 0
        const product = productMap.get(l.product_id)
        return {
          entry_id: entry.id,
          product_id: l.product_id,
          batch_id: insertedBatches?.[idx]?.id ?? null,
          unit_name: product?.base_unit || "",
          quantity: qty,
        }
      })
      const { error: lineErr } = await supabase
        .from("stock_entry_lines")
        .insert(entryLines)
      if (lineErr) throw lineErr

      toast({ title: `Đã tạo phiếu nhập ${entryCode}` })
      router.push("/inventory")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </Link>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <ArrowDownToLine className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-foreground">
                Nhập kho
              </h1>
              <p className="text-sm text-muted-foreground">
                Tạo phiếu nhập mới
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={discardDraft}
            disabled={saving}
          >
            Hủy bản nháp
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? "Đang lưu..." : "Xác nhận nhập kho"}
          </Button>
        </div>
      </div>

      {/* Bento grid: 2 + 1 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Thông tin chung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nhà cung cấp</Label>
                {suppliers.length > 0 ? (
                  <>
                    <Select
                      value={supplierId || "_manual"}
                      onValueChange={(v) => {
                        if (v === "_manual") {
                          setSupplierId("")
                          setSupplier("")
                          return
                        }
                        setSupplierId(v)
                        const s = suppliers.find((x) => x.id === v)
                        setSupplier(s?.name || "")
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn nhà cung cấp..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_manual">— Nhập tay —</SelectItem>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.code ? `${s.code} - ` : ""}{s.name}
                          </SelectItem>
                        ))}
                        <div className="border-t border-border/50 mt-1 pt-1 px-2 pb-1">
                          <Link
                            href="/suppliers/new"
                            target="_blank"
                            className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-surface-low rounded-lg transition-colors"
                          >
                            <Plus className="h-3 w-3" /> Tạo nhà cung cấp mới
                            <ExternalLink className="h-3 w-3 ml-auto" />
                          </Link>
                        </div>
                      </SelectContent>
                    </Select>
                    {!supplierId && (
                      <Input
                        value={supplier}
                        onChange={(e) => setSupplier(e.target.value)}
                        placeholder="Nhập tên nhà cung cấp tự do"
                        className="mt-2"
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Input
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="Tên nhà cung cấp"
                    />
                    <p className="text-xs text-muted-foreground">
                      Chưa có NCC nào.{" "}
                      <Link href="/suppliers/new" target="_blank" className="text-primary font-semibold underline">
                        Tạo NCC mới
                      </Link>
                    </p>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label>Số hóa đơn</Label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="VD: HD-2026-001"
                />
              </div>
              <div className="space-y-2">
                <Label>Ngày nhập</Label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Kho nhận</Label>
                <Input
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  placeholder="Kho chính"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-primary text-white shadow-ambient-md">
          <CardHeader>
            <CardTitle className="text-white">Giá trị nhập kho</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm text-white/80">
              <span>Tạm tính</span>
              <span className="font-semibold text-white">
                {formatCurrency(summary.subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-white/80">
              <span>Thuế VAT (10%)</span>
              <span className="font-semibold text-white">
                {formatCurrency(summary.vat)}
              </span>
            </div>
            <div className="border-t border-white/20 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">Tổng cộng</span>
                <span className="text-2xl font-black text-white">
                  {formatCurrency(summary.total)}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-white/10 p-3 text-xs text-white/90">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Hệ thống tự áp dụng FEFO (First Expiry First Out) - ưu tiên xuất
                lô hàng có HSD gần nhất trước.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Line Items & Lot Tracking</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Mỗi dòng sẽ tạo 1 lô hàng mới để theo dõi HSD
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Sản phẩm / SKU</TableHead>
                  <TableHead>ĐVT</TableHead>
                  <TableHead className="w-24">SL</TableHead>
                  <TableHead className="w-32">Đơn giá</TableHead>
                  <TableHead className="min-w-[320px]">
                    Thông tin Lô hàng (FEFO)
                  </TableHead>
                  <TableHead className="w-32 text-right">Thành tiền</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const product = productMap.get(line.product_id)
                  const qty = parseFloat(line.quantity) || 0
                  const price = parseFloat(line.unit_price) || 0
                  const subtotal = qty * price
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <Select
                          value={line.product_id}
                          onValueChange={(v) =>
                            updateLine(line.id, { product_id: v })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Chọn sản phẩm" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                <span className="font-mono text-xs text-muted-foreground">
                                  {p.sku}
                                </span>{" "}
                                - {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {product && (
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Package className="h-3 w-3" />
                            <span className="font-mono">{product.sku}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {product?.base_unit || "—"}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.id, { quantity: e.target.value })
                          }
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          value={line.unit_price}
                          onChange={(e) =>
                            updateLine(line.id, { unit_price: e.target.value })
                          }
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Mã lô
                            </Label>
                            <Input
                              value={line.batch_code}
                              onChange={(e) =>
                                updateLine(line.id, {
                                  batch_code: e.target.value,
                                })
                              }
                              placeholder="LOT-001"
                              className="font-mono text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              NSX
                            </Label>
                            <Input
                              type="date"
                              value={line.manufactured_at}
                              onChange={(e) =>
                                updateLine(line.id, {
                                  manufactured_at: e.target.value,
                                })
                              }
                              className="text-xs"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              HSD
                            </Label>
                            <Input
                              type="date"
                              value={line.expires_at}
                              onChange={(e) =>
                                updateLine(line.id, {
                                  expires_at: e.target.value,
                                })
                              }
                              className="text-xs"
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(subtotal)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length <= 1}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bottom summary strip */}
      <Card className="bg-surface-low">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tổng số lượng
              </div>
              <div className="text-2xl font-black text-foreground">
                {summary.qtyTotal}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tạm tính hóa đơn
              </div>
              <div className="text-2xl font-black text-foreground">
                {formatCurrency(summary.subtotal)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={discardDraft} disabled={saving}>
              Hủy bản nháp
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              {saving ? "Đang lưu..." : "Xác nhận nhập kho"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
