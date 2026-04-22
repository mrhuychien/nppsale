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
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"
import {
  ArrowLeft,
  Info,
  Plus,
  Trash2,
  ArrowDownToLine,
  ExternalLink,
  ScanBarcode,
} from "lucide-react"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import type { Product, PriceList, ProductUnit, Supplier } from "@/types"

interface LineItem {
  id: string
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: string
  unit_price: string
  vat_rate: number
  batch_code: string
  manufactured_at: string
  expires_at: string
  available_units: string[]
}

function newLine(): LineItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    product_id: "",
    product_name: "",
    sku: "",
    unit_name: "",
    quantity: "",
    unit_price: "",
    vat_rate: 0,
    batch_code: "",
    manufactured_at: "",
    expires_at: "",
    available_units: [],
  }
}

type ProductWithRelations = Product & {
  price_lists?: PriceList[]
  units?: ProductUnit[]
}

export default function StockInPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  const [products, setProducts] = useState<ProductWithRelations[]>([])
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
  const [productSearch, setProductSearch] = useState("")
  const [barcodeOpen, setBarcodeOpen] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const [prodRes, supRes] = await Promise.all([
        supabase
          .from("products")
          .select("*, price_lists(*), units:product_units(*)")
          .eq("status", "active")
          .order("name"),
        supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
      ])
      setProducts((prodRes.data as ProductWithRelations[]) || [])
      // Suppliers might fail silently if migration 006 not yet run - that's OK
      if (supRes.data) setSuppliers(supRes.data as Supplier[])
      setProductsLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const productMap = useMemo(() => {
    const map = new Map<string, ProductWithRelations>()
    products.forEach((p) => map.set(p.id, p))
    return map
  }, [products])

  const summary = useMemo(() => {
    let qtyTotal = 0
    let subtotal = 0
    let vat = 0
    lines.forEach((l) => {
      const qty = parseFloat(l.quantity) || 0
      const price = parseFloat(l.unit_price) || 0
      const lineTotal = qty * price
      qtyTotal += qty
      subtotal += lineTotal
      vat += lineTotal * (l.vat_rate || 0)
    })
    const vatRounded = Math.round(vat)
    const total = subtotal + vatRounded
    return { qtyTotal, subtotal, vat: vatRounded, total }
  }, [lines])

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return []
    const q = productSearch.toLowerCase()
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    )
  }, [productSearch, products])

  // Auto-add empty row when last row is filled
  useEffect(() => {
    if (lines.length === 0) {
      setLines([newLine()])
      return
    }
    const last = lines[lines.length - 1]
    if (last.product_id) {
      setLines((prev) => {
        const tail = prev[prev.length - 1]
        if (tail && tail.product_id) return [...prev, newLine()]
        return prev
      })
    }
  }, [lines])

  if (authLoading || productsLoading) return <Skeleton className="h-96" />

  function getAvailableUnits(product: ProductWithRelations): string[] {
    const units = [product.base_unit]
    ;(product.units || []).forEach((u) => {
      if (!units.includes(u.unit_name)) units.push(u.unit_name)
    })
    return units
  }

  function getDefaultUnitPrice(product: ProductWithRelations, unitName: string): number {
    const match = product.price_lists?.find(
      (pl) => pl.unit_name === unitName && !pl.group_id
    )
    if (match) return match.price
    const anyMatch = product.price_lists?.find((pl) => pl.unit_name === unitName)
    return anyMatch?.price ?? 0
  }

  function addProductLine(productId: string) {
    const product = productMap.get(productId)
    if (!product) return
    const availableUnits = getAvailableUnits(product)
    const unitName = product.base_unit
    const price = getDefaultUnitPrice(product, unitName)
    const newItem: LineItem = {
      id: Math.random().toString(36).slice(2, 10),
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      unit_name: unitName,
      quantity: "1",
      unit_price: price > 0 ? String(price) : "",
      vat_rate: product.vat_rate ?? 0,
      batch_code: "",
      manufactured_at: "",
      expires_at: "",
      available_units: availableUnits,
    }
    setLines((prev) => {
      // Replace last empty line if it exists, else append
      if (prev.length > 0 && !prev[prev.length - 1].product_id) {
        const copy = [...prev]
        copy[copy.length - 1] = newItem
        return copy
      }
      return [...prev, newItem]
    })
    setProductSearch("")
  }

  function processBarcodeResult(code: string) {
    const product = products.find((p) => p.barcode === code || p.sku === code)
    if (product) {
      addProductLine(product.id)
      toast({ title: `Đã thêm: ${product.name}` })
    } else {
      toast({ title: "Không tìm thấy", description: `Mã: ${code}`, variant: "destructive" })
    }
  }

  function updateLine(id: string, patch: Partial<LineItem>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const next = { ...l, ...patch }
        // If unit changed, refresh price suggestion
        if (patch.unit_name && patch.unit_name !== l.unit_name) {
          const product = productMap.get(l.product_id)
          if (product) {
            const newPrice = getDefaultUnitPrice(product, patch.unit_name)
            if (newPrice > 0) next.unit_price = String(newPrice)
          }
        }
        return next
      })
    )
  }

  function removeLine(id: string) {
    setLines((prev) => {
      const filtered = prev.filter((l) => l.id !== id)
      return filtered.length === 0 ? [newLine()] : filtered
    })
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()])
  }

  function discardDraft() {
    setSupplier("")
    setSupplierId("")
    setInvoiceNo("")
    setEntryDate(new Date().toISOString().slice(0, 10))
    setWarehouse("Kho chính")
    setLines([newLine()])
    setProductSearch("")
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
        description: "Mỗi dòng cần sản phẩm và số lượng > 0",
        variant: "destructive",
      })
      return
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

      // Create batches in bulk - auto-generate batch_code if empty
      const batchPayload = validLines.map((l, idx) => {
        const qty = parseFloat(l.quantity) || 0
        const batchCode = l.batch_code.trim() || `LOT-${entryCode}-${idx + 1}`
        // expires_at is NOT NULL in DB - use far-future if user leaves empty
        const expiresAt = l.expires_at || "2099-12-31"
        return {
          org_id: user.org_id,
          product_id: l.product_id,
          batch_code: batchCode,
          manufactured_at: l.manufactured_at || null,
          expires_at: expiresAt,
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
        return {
          entry_id: entry.id,
          product_id: l.product_id,
          batch_id: insertedBatches?.[idx]?.id ?? null,
          unit_name: l.unit_name || productMap.get(l.product_id)?.base_unit || "",
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
        <Card className="lg:col-span-2 rounded-2xl shadow-ambient bg-card">
          <CardHeader>
            <CardTitle className="text-base font-bold">Thông tin chung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Nhà cung cấp
                </Label>
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
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Số hóa đơn
                </Label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="VD: HD-2026-001"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Ngày nhập
                </Label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Kho nhận
                </Label>
                <Input
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  placeholder="Kho chính"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-primary text-white shadow-ambient-md rounded-2xl">
          <CardHeader>
            <CardTitle className="text-white text-base font-bold">Giá trị nhập kho</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm text-white/80">
              <span>Tạm tính</span>
              <span className="font-semibold text-white">
                {formatCurrency(summary.subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm text-white/80">
              <span>Thuế VAT</span>
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
      <Card className="rounded-2xl shadow-ambient bg-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base font-bold">Line Items &amp; Lot Tracking</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Mỗi dòng tạo 1 lô hàng. Mã lô và HSD không bắt buộc - hệ thống sẽ tự sinh mã nếu để trống.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-2 h-4 w-4" /> Thêm dòng trống
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Inline product search - ABOVE table to avoid overflow clipping */}
          <div className="relative flex gap-2">
            <div className="relative flex-1">
            <Input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Tìm nhanh: gõ tên hoặc mã SKU sản phẩm..."
              className="h-10"
            />
            {filteredProducts.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-xl shadow-ambient-md max-h-72 overflow-y-auto">
                {filteredProducts.slice(0, 10).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductLine(p.id)}
                    className="w-full text-left px-4 py-3 hover:bg-surface-low transition-colors flex items-center justify-between gap-3 border-b border-border/20 last:border-0"
                  >
                    <div>
                      <p className="font-semibold text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU: {p.sku} • {p.base_unit}
                      </p>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
                <div className="border-t border-border/50 p-2">
                  <Link
                    href="/products/new"
                    target="_blank"
                    className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-surface-low rounded-lg transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Tạo sản phẩm mới
                    <ExternalLink className="h-3 w-3 ml-auto" />
                  </Link>
                </div>
              </div>
            )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => setBarcodeOpen(true)}
              title="Quét mã vạch"
            >
              <ScanBarcode className="h-5 w-5" />
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-low text-left">
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-10">
                    #
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[200px]">
                    Sản phẩm
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-28">
                    ĐVT
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-20">
                    SL
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-32">
                    Đơn giá
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-20">
                    VAT %
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[280px]">
                    Lô hàng (tùy chọn)
                  </th>
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-32 text-right">
                    Thành tiền
                  </th>
                  <th className="px-3 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lines.map((line, i) => {
                  const qty = parseFloat(line.quantity) || 0
                  const price = parseFloat(line.unit_price) || 0
                  const lineTotal = qty * price
                  const hasProduct = !!line.product_id
                  return (
                    <tr key={line.id} className="hover:bg-surface-low/40 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground font-medium">{i + 1}</td>
                      <td className="px-3 py-2">
                        {hasProduct ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-primary">{line.product_name}</span>
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">
                              SKU: {line.sku}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Tìm sản phẩm ở ô trên để thêm vào dòng này...
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {hasProduct ? (
                          line.available_units.length <= 1 ? (
                            <span className="text-muted-foreground">{line.unit_name}</span>
                          ) : (
                            <Select
                              value={line.unit_name}
                              onValueChange={(v) => updateLine(line.id, { unit_name: v })}
                            >
                              <SelectTrigger className="h-8 w-full min-w-[90px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {line.available_units.map((u) => (
                                  <SelectItem key={u} value={u}>{u}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.id, { quantity: e.target.value })
                          }
                          placeholder="0"
                          className="h-8 text-center"
                          disabled={!hasProduct}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          value={line.unit_price}
                          onChange={(e) =>
                            updateLine(line.id, { unit_price: e.target.value })
                          }
                          placeholder="0"
                          className="h-8"
                          disabled={!hasProduct}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          value={hasProduct ? String(Math.round(line.vat_rate * 1000) / 10) : ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0
                            const clamped = Math.max(0, Math.min(100, v))
                            updateLine(line.id, { vat_rate: clamped / 100 })
                          }}
                          className="h-8 text-center"
                          disabled={!hasProduct}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Mã lô
                            </Label>
                            <Input
                              value={line.batch_code}
                              onChange={(e) =>
                                updateLine(line.id, { batch_code: e.target.value })
                              }
                              placeholder="Tự sinh"
                              className="font-mono text-xs h-8"
                              disabled={!hasProduct}
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
                                updateLine(line.id, { manufactured_at: e.target.value })
                              }
                              className="text-xs h-8"
                              disabled={!hasProduct}
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
                                updateLine(line.id, { expires_at: e.target.value })
                              }
                              className="text-xs h-8"
                              disabled={!hasProduct}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-bold">
                        {formatCurrency(lineTotal)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeLine(line.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Bottom summary strip */}
      <Card className="bg-surface-low rounded-2xl">
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

      <BarcodeScanner open={barcodeOpen} onClose={() => setBarcodeOpen(false)} onScan={processBarcodeResult} />
    </div>
  )
}
