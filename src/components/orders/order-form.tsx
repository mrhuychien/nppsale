"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, generateOrderCode } from "@/lib/utils"
import { PAYMENT_TERMS, CUSTOMER_STATUS_MAP } from "@/lib/constants"
import { Trash2, Plus, ExternalLink } from "lucide-react"
import Link from "next/link"
import type { Customer, Product, PriceList } from "@/types"

interface OrderLine {
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount_percent: number
  line_total: number
  vat_rate: number
}

export function OrderForm() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<(Product & { price_lists?: PriceList[] })[]>([])
  const [customerId, setCustomerId] = useState("")
  const [paymentTerms, setPaymentTerms] = useState("COD")
  const [expectedDelivery, setExpectedDelivery] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<OrderLine[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const [custRes, prodRes] = await Promise.all([
        supabase.from("customers").select("*, group:customer_groups(*)").eq("status", "active").order("store_name"),
        supabase.from("products").select("*, price_lists(*)").eq("status", "active").order("name"),
      ])
      setCustomers((custRes.data as Customer[]) || [])
      setProducts((prodRes.data as (Product & { price_lists?: PriceList[] })[]) || [])
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCustomer = customers.find((c) => c.id === customerId)

  useEffect(() => {
    if (selectedCustomer?.payment_terms) {
      setPaymentTerms(selectedCustomer.payment_terms)
    }
  }, [selectedCustomer])

  const addLine = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const groupId = selectedCustomer?.group_id
    const priceEntry = product.price_lists?.find(
      (pl) => pl.unit_name === product.base_unit && (pl.group_id === groupId || !pl.group_id)
    )
    const price = priceEntry?.price || 0
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        unit_name: product.base_unit,
        quantity: 1,
        unit_price: price,
        line_discount_percent: 0,
        line_total: price,
        vat_rate: product.vat_rate ?? 0,
      },
    ])
    setProductSearch("")
  }

  const updateLine = (index: number, field: keyof OrderLine, value: number) => {
    const updated = [...lines]
    const line = { ...updated[index], [field]: value }
    const gross = line.quantity * line.unit_price
    const discountAmount = gross * (line.line_discount_percent / 100)
    line.line_total = gross - discountAmount
    updated[index] = line
    setLines(updated)
  }

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index))
  }

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)
  const total_discount = lines.reduce(
    (sum, l) => sum + l.quantity * l.unit_price * (l.line_discount_percent / 100),
    0
  )
  const netAfterDiscount = subtotal - total_discount
  const vat = Math.round(
    lines.reduce((sum, l) => sum + l.line_total * l.vat_rate, 0)
  )
  const total = netAfterDiscount + vat

  const filteredProducts = products.filter((p) => {
    if (!productSearch.trim()) return false
    const q = productSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || lines.length === 0) {
      toast({ title: "Vui lòng chọn khách hàng và thêm sản phẩm", variant: "destructive" })
      return
    }
    setLoading(true)

    try {
      const orderCode = generateOrderCode()
      const { data: order, error: orderErr } = await supabase
        .from("sales_orders")
        .insert({
          org_id: user?.org_id,
          order_code: orderCode,
          customer_id: customerId,
          sales_user_id: user?.id,
          payment_terms: paymentTerms || selectedCustomer?.payment_terms || "COD",
          expected_delivery: expectedDelivery || null,
          subtotal: netAfterDiscount,
          vat,
          total,
          notes: notes || null,
        })
        .select()
        .single()

      if (orderErr) throw orderErr

      const orderLines = lines.map((l) => ({
        order_id: order.id,
        product_id: l.product_id,
        unit_name: l.unit_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        line_discount: l.quantity * l.unit_price * (l.line_discount_percent / 100),
        line_total: l.line_total,
      }))

      const { error: linesErr } = await supabase.from("sales_order_lines").insert(orderLines)
      if (linesErr) throw linesErr

      toast({ title: `Đã tạo đơn hàng ${orderCode}` })
      router.push("/orders")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const customerStatusConfig = selectedCustomer
    ? CUSTOMER_STATUS_MAP[selectedCustomer.status] ?? { label: selectedCustomer.status, variant: "outline" as const }
    : null

  return (
    <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row gap-6 items-start">
      {/* LEFT COLUMN */}
      <div className="w-full lg:w-[320px] lg:shrink-0 space-y-6">
        {/* Customer info card */}
        <Card className="rounded-2xl shadow-ambient bg-card">
          <CardHeader>
            <CardTitle className="text-base font-bold">Thông tin khách hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Khách hàng *
              </Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Tìm tên hoặc mã KH..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.store_name} - {c.phone}
                    </SelectItem>
                  ))}
                  <div className="border-t border-border/50 mt-1 pt-1 px-2 pb-1">
                    <Link
                      href="/customers/new"
                      target="_blank"
                      className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-surface-low rounded-lg transition-colors"
                    >
                      <Plus className="h-3 w-3" /> Tạo khách hàng mới
                      <ExternalLink className="h-3 w-3 ml-auto" />
                    </Link>
                  </div>
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <Link
                  href={`/customers/${selectedCustomer.id}`}
                  target="_blank"
                  className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                >
                  Xem / Sửa khách hàng <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>

            {selectedCustomer && (
              <div className="rounded-xl bg-surface-low p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-foreground">{selectedCustomer.store_name}</p>
                  {customerStatusConfig && (
                    <Badge variant={customerStatusConfig.variant}>
                      {customerStatusConfig.label}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                {selectedCustomer.address && (
                  <p className="text-sm text-muted-foreground">{selectedCustomer.address}</p>
                )}
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">Hạn mức công nợ</p>
                  <p className="font-bold text-foreground">
                    {formatCurrency(selectedCustomer.credit_limit)}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Terms & delivery card */}
        <Card className="rounded-2xl shadow-ambient bg-card">
          <CardHeader>
            <CardTitle className="text-base font-bold">Điều khoản &amp; Giao hàng</CardTitle>
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
              <CardTitle className="text-base font-bold">Sản phẩm</CardTitle>
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
                    <div className="border-t border-border/50 mt-1 pt-1 px-2 pb-1">
                      <Link
                        href="/products/new"
                        target="_blank"
                        className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-surface-low rounded-lg transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Tạo sản phẩm mới
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Link>
                    </div>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Inline product search - ABOVE table to avoid overflow clipping */}
            <div className="relative">
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Tìm nhanh: gõ tên hoặc mã SKU sản phẩm..."
                className="h-10"
              />
              {filteredProducts.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-xl shadow-ambient-md max-h-72 overflow-y-auto">
                  {filteredProducts.slice(0, 10).map((p) => {
                    const groupId = selectedCustomer?.group_id
                    const priceEntry = p.price_lists?.find(
                      (pl) => pl.unit_name === p.base_unit && (pl.group_id === groupId || !pl.group_id)
                    )
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addLine(p.id)}
                        className="w-full text-left px-4 py-3 hover:bg-surface-low transition-colors flex items-center justify-between gap-3 border-b border-border/20 last:border-0"
                      >
                        <div>
                          <p className="font-semibold text-sm">{p.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {p.sku} • {p.base_unit}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-primary text-sm">
                            {priceEntry ? formatCurrency(priceEntry.price) : "—"}
                          </p>
                          <Plus className="h-4 w-4 text-muted-foreground ml-auto" />
                        </div>
                      </button>
                    )
                  })}
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
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-20">
                      ĐVT
                    </th>
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-20">
                      SL
                    </th>
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-32">
                      Đơn giá
                    </th>
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-20">
                      CK %
                    </th>
                    <th className="px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground w-32 text-right">
                      Thành tiền
                    </th>
                    <th className="px-3 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {lines.map((line, i) => (
                    <tr key={i} className="hover:bg-surface-low/40 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground font-medium">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="font-bold text-primary">{line.product_name}</span>
                          <span className="text-[10px] text-muted-foreground font-medium uppercase">
                            SKU: {line.sku}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{line.unit_name}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(i, "quantity", parseInt(e.target.value) || 1)
                          }
                          className="h-8 text-center"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={line.unit_price}
                          onChange={(e) =>
                            updateLine(i, "unit_price", parseInt(e.target.value) || 0)
                          }
                          className="h-8"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={line.line_discount_percent}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0
                            const clamped = Math.max(0, Math.min(100, v))
                            updateLine(i, "line_discount_percent", clamped)
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
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-sm">
                        Chưa có sản phẩm. Tìm bằng ô tìm kiếm phía trên hoặc dùng nút &quot;Thêm sản phẩm&quot;.
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
                <CardTitle className="text-base font-bold">Ghi chú nội bộ</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Yêu cầu đặc biệt về đóng gói, thời gian giao, ghi chú kế toán..."
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
                  <span className="text-white/80 font-medium">Tổng chiết khấu</span>
                  <span className="font-bold">-{formatCurrency(total_discount)}</span>
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
                    Lưu nháp
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="flex-[2] bg-white hover:bg-white/90 text-primary font-bold border-0"
                  >
                    {loading ? "Đang lưu..." : "Tạo đơn hàng"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
