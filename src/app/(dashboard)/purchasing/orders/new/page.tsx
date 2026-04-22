"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, generatePOCode } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { Trash2, Plus, ExternalLink, ScanBarcode } from "lucide-react"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import Link from "next/link"
import type { Supplier, Product, ProductUnit } from "@/types"

interface POLine {
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: number
  unit_price: number
  vat_rate: number
  line_total: number
}

export default function NewPurchaseOrderPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<
    (Product & { units?: ProductUnit[] })[]
  >([])
  const [supplierId, setSupplierId] = useState("")
  const [paymentTerms, setPaymentTerms] = useState("NET30")
  const [expectedDelivery, setExpectedDelivery] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<POLine[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const [suppRes, prodRes] = await Promise.all([
        supabase
          .from("suppliers")
          .select("*")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("products")
          .select("*, units:product_units(*)")
          .eq("status", "active")
          .order("name"),
      ])
      setSuppliers((suppRes.data as Supplier[]) || [])
      setProducts(
        (prodRes.data as (Product & { units?: ProductUnit[] })[]) || []
      )
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSupplier = suppliers.find((s) => s.id === supplierId)

  useEffect(() => {
    if (selectedSupplier?.payment_terms) {
      setPaymentTerms(selectedSupplier.payment_terms)
    }
  }, [selectedSupplier])

  const addLine = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        unit_name: product.base_unit,
        quantity: 1,
        unit_price: 0,
        vat_rate: product.vat_rate ?? 0.1,
        line_total: 0,
      },
    ])
    setProductSearch("")
  }

  const processBarcodeResult = (code: string) => {
    const product = products.find((p) => p.barcode === code || p.sku === code)
    if (product) {
      addLine(product.id)
      toast({ title: `Đã thêm: ${product.name}` })
    } else {
      toast({ title: "Không tìm thấy", description: `Mã: ${code}`, variant: "destructive" })
    }
  }

  const getAvailableUnits = (line: POLine): string[] => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return [line.unit_name]
    const units = [product.base_unit]
    ;(product.units || []).forEach((u) => {
      if (!units.includes(u.unit_name)) units.push(u.unit_name)
    })
    return units
  }

  const updateLine = (
    index: number,
    field: keyof POLine,
    value: number | string
  ) => {
    const updated = [...lines]
    const line = { ...updated[index], [field]: value } as POLine
    line.line_total = line.quantity * line.unit_price
    updated[index] = line
    setLines(updated)
  }

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index))
  }

  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0)
  const vat = Math.round(
    lines.reduce((sum, l) => sum + l.line_total * l.vat_rate, 0)
  )
  const total = subtotal + vat

  const filteredProducts = products.filter((p) => {
    if (!productSearch.trim()) return false
    const q = productSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId || lines.length === 0) {
      toast({
        title: "Vui lòng chọn nhà cung cấp và thêm sản phẩm",
        variant: "destructive",
      })
      return
    }
    setLoading(true)

    try {
      const poCode = generatePOCode()
      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: user?.org_id,
          po_code: poCode,
          supplier_id: supplierId,
          payment_terms: paymentTerms,
          expected_delivery: expectedDelivery || null,
          subtotal,
          vat,
          total,
          notes: notes || null,
          created_by: user?.id,
        })
        .select()
        .single()

      if (poErr) throw poErr

      const poLines = lines.map((l) => ({
        po_id: po.id,
        product_id: l.product_id,
        unit_name: l.unit_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        vat_rate: l.vat_rate,
        line_discount: 0,
        line_total: l.line_total,
      }))

      const { error: linesErr } = await supabase
        .from("purchase_order_lines")
        .insert(poLines)
      if (linesErr) throw linesErr

      toast({ title: `Đã tạo đơn mua hàng ${poCode}` })
      router.push("/purchasing/orders")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo đơn mua hàng" backHref="/purchasing/orders" />

      <form
        onSubmit={handleSubmit}
        className="flex flex-col lg:flex-row gap-6 items-start"
      >
        {/* LEFT COLUMN */}
        <div className="w-full lg:w-[320px] lg:shrink-0 space-y-6">
          {/* Supplier info card */}
          <Card className="rounded-2xl shadow-ambient bg-card">
            <CardHeader>
              <CardTitle className="text-base font-bold">
                Nhà cung cấp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chọn NCC *
                </Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tìm nhà cung cấp..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </SelectItem>
                    ))}
                    <div className="border-t border-border/50 mt-1 pt-1 px-2 pb-1">
                      <Link
                        href="/suppliers/new"
                        target="_blank"
                        className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-surface-low rounded-lg transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Tạo NCC mới
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Link>
                    </div>
                  </SelectContent>
                </Select>
              </div>

              {selectedSupplier && (
                <div className="rounded-xl bg-surface-low p-4 space-y-2">
                  <p className="font-bold text-foreground">
                    {selectedSupplier.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedSupplier.contact_name}
                  </p>
                  {selectedSupplier.phone && (
                    <p className="text-sm text-muted-foreground">
                      {selectedSupplier.phone}
                    </p>
                  )}
                  {selectedSupplier.address && (
                    <p className="text-sm text-muted-foreground">
                      {selectedSupplier.address}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Terms & delivery card */}
          <Card className="rounded-2xl shadow-ambient bg-card">
            <CardHeader>
              <CardTitle className="text-base font-bold">
                Điều khoản &amp; Giao hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Điều khoản thanh toán
                </Label>
                <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn điều khoản" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Ngày giao dự kiến
                </Label>
                <Input
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MAIN COLUMN */}
        <div className="flex-1 w-full space-y-6 min-w-0">
          {/* Products card */}
          <Card className="rounded-2xl shadow-ambient bg-card flex-1">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-bold">
                  Sản phẩm
                </CardTitle>
                <div className="relative w-64">
                  <Select onValueChange={addLine}>
                    <SelectTrigger>
                      <Plus className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Thêm sản phẩm" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.sku} - {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Inline product search */}
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
                        onClick={() => addLine(p.id)}
                        className="w-full text-left px-4 py-3 hover:bg-surface-low transition-colors flex items-center justify-between gap-3 border-b border-border/20 last:border-0"
                      >
                        <div>
                          <p className="font-semibold text-sm">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {p.sku} - {p.base_unit}
                          </p>
                        </div>
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
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
                      <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
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
                      <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-16">
                        VAT %
                      </th>
                      <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-32 text-right">
                        Thành tiền
                      </th>
                      <th className="px-3 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lines.map((line, i) => (
                      <tr
                        key={i}
                        className="hover:bg-surface-low/40 transition-colors"
                      >
                        <td className="px-3 py-2 text-muted-foreground font-medium">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-bold text-primary">
                              {line.product_name}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-medium uppercase">
                              SKU: {line.sku}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            const units = getAvailableUnits(line)
                            if (units.length <= 1) {
                              return (
                                <span className="text-muted-foreground">
                                  {line.unit_name}
                                </span>
                              )
                            }
                            return (
                              <Select
                                value={line.unit_name}
                                onValueChange={(v) =>
                                  updateLine(i, "unit_name", v)
                                }
                              >
                                <SelectTrigger className="h-8 w-full min-w-[90px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {units.map((u) => (
                                    <SelectItem key={u} value={u}>
                                      {u}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(
                                i,
                                "quantity",
                                parseInt(e.target.value) || 1
                              )
                            }
                            className="h-8 text-center"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={line.unit_price}
                            onChange={(e) =>
                              updateLine(
                                i,
                                "unit_price",
                                parseInt(e.target.value) || 0
                              )
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(line.vat_rate * 100)}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0
                              updateLine(
                                i,
                                "vat_rate",
                                Math.max(0, Math.min(100, v)) / 100
                              )
                            }}
                            className="h-8 text-center"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          {formatCurrency(line.line_total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeLine(i)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center text-muted-foreground text-sm"
                        >
                          Chưa có sản phẩm. Tìm bằng ô tìm kiếm phía trên hoặc
                          dùng nút &quot;Thêm sản phẩm&quot;.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Notes + Summary row */}
          <div className="flex flex-col lg:flex-row justify-between gap-6">
            <div className="w-full lg:w-1/2">
              <Card className="rounded-2xl shadow-ambient bg-card h-full">
                <CardHeader>
                  <CardTitle className="text-base font-bold">
                    Ghi chú nội bộ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Yêu cầu đặc biệt, ghi chú cho nhà cung cấp..."
                    rows={6}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="w-full lg:w-80">
              <div className="bg-gradient-primary text-white rounded-2xl shadow-ambient-md p-6 relative overflow-hidden">
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-3xl pointer-events-none" />
                <div className="relative space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80 font-medium">Tạm tính</span>
                    <span className="font-bold">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80 font-medium">VAT</span>
                    <span className="font-bold">+{formatCurrency(vat)}</span>
                  </div>
                  <div className="h-px bg-white/20" />
                  <div className="flex items-end justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-white/80">
                      Tổng cộng
                    </span>
                    <span className="text-3xl font-black tracking-tight">
                      {formatCurrency(total)}
                    </span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      className="flex-1 bg-white/20 hover:bg-white/30 text-white border-0 font-bold"
                      onClick={() => router.back()}
                    >
                      Hủy
                    </Button>
                    <Button
                      type="submit"
                      disabled={loading}
                      className="flex-[2] bg-white hover:bg-white/90 text-primary font-bold border-0"
                    >
                      {loading ? "Đang lưu..." : "Tạo đơn mua"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      <BarcodeScanner open={barcodeOpen} onClose={() => setBarcodeOpen(false)} onScan={processBarcodeResult} />
    </div>
  )
}
