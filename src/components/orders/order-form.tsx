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
import { Trash2, Plus, ExternalLink, Search, ScanBarcode, X } from "lucide-react"
import Link from "next/link"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import type { Customer, Product, PriceList, ProductUnit } from "@/types"

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
  const [products, setProducts] = useState<(Product & { price_lists?: PriceList[]; units?: ProductUnit[] })[]>([])
  const [customerId, setCustomerId] = useState("")
  const [customerSearch, setCustomerSearch] = useState("")
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [paymentTerms, setPaymentTerms] = useState("COD")
  const [expectedDelivery, setExpectedDelivery] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<OrderLine[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({})
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetch() {
      const [custRes, prodRes, batchRes] = await Promise.all([
        supabase.from("customers").select("*, group:customer_groups(*)").eq("status", "active").order("store_name"),
        supabase.from("products").select("*, price_lists(*), units:product_units(*)").eq("status", "active").order("name"),
        supabase.from("batches").select("product_id, qty_on_hand").gt("qty_on_hand", 0),
      ])
      setCustomers((custRes.data as Customer[]) || [])
      setProducts((prodRes.data as (Product & { price_lists?: PriceList[]; units?: ProductUnit[] })[]) || [])
      const stockMap: Record<string, number> = {}
      for (const b of (batchRes.data as Array<{ product_id: string; qty_on_hand: number }>) || []) {
        stockMap[b.product_id] = (stockMap[b.product_id] || 0) + Number(b.qty_on_hand || 0)
      }
      setStockByProduct(stockMap)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCustomer = customers.find((c) => c.id === customerId)

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true
    const q = customerSearch.toLowerCase()
    return c.store_name.toLowerCase().includes(q) || c.phone.includes(q) || c.owner_name.toLowerCase().includes(q)
  }).slice(0, 8)

  const selectCustomer = (id: string) => {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c) setCustomerSearch(c.store_name)
    setCustomerDropdownOpen(false)
  }

  const [barcodeOpen, setBarcodeOpen] = useState(false)

  const handleBarcodeScan = () => {
    setBarcodeOpen(true)
  }

  const processBarcodeResult = (code: string) => {
    const product = products.find((p) => p.barcode === code || p.sku === code)
    if (product) {
      addLine(product.id)
      toast({ title: `Đã thêm: ${product.name}` })
    } else {
      toast({ title: "Không tìm thấy sản phẩm", description: `Mã: ${code}`, variant: "destructive" })
    }
  }

  const isSalesRole = user?.role === "sales"

  useEffect(() => {
    if (selectedCustomer?.payment_terms) {
      setPaymentTerms(selectedCustomer.payment_terms)
    }
  }, [selectedCustomer])

  const addLine = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const onHand = stockByProduct[productId] ?? 0
    if (onHand <= 0) {
      toast({
        title: "Hết hàng",
        description: `${product.name} không còn tồn kho`,
        variant: "destructive",
      })
      return
    }
    const groupId = selectedCustomer?.group_id
    const price = getUnitPrice(product, product.base_unit, groupId)
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

  const getUnitPrice = (
    product: Product & { price_lists?: PriceList[]; units?: ProductUnit[] },
    unitName: string,
    groupId: string | null | undefined
  ): number => {
    // 1. Try exact match on group + unit
    if (groupId) {
      const groupMatch = product.price_lists?.find(
        (pl) => pl.unit_name === unitName && pl.group_id === groupId
      )
      if (groupMatch) return groupMatch.price
    }
    // 2. Try default price (no group) for this unit
    const defaultMatch = product.price_lists?.find(
      (pl) => pl.unit_name === unitName && !pl.group_id
    )
    if (defaultMatch) return defaultMatch.price

    // 3. Fallback: calculate from base_unit price × conversion
    if (unitName !== product.base_unit) {
      const unitInfo = product.units?.find((u) => u.unit_name === unitName)
      if (unitInfo) {
        const basePrice = getUnitPrice(product, product.base_unit, groupId)
        if (basePrice > 0) return basePrice * unitInfo.conversion
      }
    }
    return 0
  }

  // Convert a line's quantity into base-unit terms for stock comparison.
  const baseQty = (line: OrderLine): number => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return line.quantity
    if (line.unit_name === product.base_unit) return line.quantity
    const u = product.units?.find((x) => x.unit_name === line.unit_name)
    return line.quantity * (u?.conversion || 1)
  }

  // For a given line, return on-hand minus everything already ordered on OTHER
  // lines for the same product (so a split order doesn't accidentally double-count).
  const availableForLine = (line: OrderLine, index: number): number => {
    const onHand = stockByProduct[line.product_id] ?? 0
    const otherQty = lines.reduce((sum, l, i) => {
      if (i === index) return sum
      if (l.product_id !== line.product_id) return sum
      return sum + baseQty(l)
    }, 0)
    return onHand - otherQty
  }

  // Check if a specific line exceeds stock
  const lineOverstock = (line: OrderLine, index: number): boolean => {
    return baseQty(line) > availableForLine(line, index)
  }

  // Aggregated check — true if any product across all lines exceeds on-hand.
  const hasOverstock = (() => {
    const totals: Record<string, number> = {}
    for (const l of lines) {
      totals[l.product_id] = (totals[l.product_id] || 0) + baseQty(l)
    }
    for (const [pid, total] of Object.entries(totals)) {
      if (total > (stockByProduct[pid] ?? 0)) return true
    }
    return false
  })()

  const updateLine = (index: number, field: keyof OrderLine, value: number | string) => {
    const updated = [...lines]
    const line = { ...updated[index], [field]: value } as OrderLine
    // If unit changed, recalculate unit_price
    if (field === "unit_name") {
      const product = products.find((p) => p.id === line.product_id)
      if (product) {
        const groupId = selectedCustomer?.group_id
        const newPrice = getUnitPrice(product, String(value), groupId)
        if (newPrice > 0) {
          line.unit_price = newPrice
        }
      }
    }
    const gross = line.quantity * line.unit_price
    const discountAmount = gross * (line.line_discount_percent / 100)
    line.line_total = gross - discountAmount
    updated[index] = line
    setLines(updated)
  }

  const getAvailableUnits = (line: OrderLine): string[] => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return [line.unit_name]
    const units = [product.base_unit]
    ;(product.units || []).forEach((u) => {
      if (!units.includes(u.unit_name)) units.push(u.unit_name)
    })
    return units
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

    // Block orders that exceed current on-hand stock. Aggregated across
    // lines so two lines for the same SKU can't bypass the check.
    const totalsByProduct: Record<string, number> = {}
    for (const l of lines) {
      totalsByProduct[l.product_id] = (totalsByProduct[l.product_id] || 0) + baseQty(l)
    }
    const overstock: string[] = []
    for (const [productId, total] of Object.entries(totalsByProduct)) {
      const onHand = stockByProduct[productId] ?? 0
      if (total > onHand) {
        const p = products.find((x) => x.id === productId)
        overstock.push(
          `${p?.name || productId}: cần ${total} ${p?.base_unit || ""}, chỉ còn ${onHand}`
        )
      }
    }
    if (overstock.length > 0) {
      toast({
        title: "Số lượng vượt tồn kho",
        description: overstock.join(" • "),
        variant: "destructive",
      })
      return
    }

    setLoading(true)

    try {
      // Evaluate approval rules for this org
      const { evaluateApproval } = await import("@/lib/approval")

      const { data: rulesData } = await supabase
        .from("approval_rules")
        .select("*")
        .eq("org_id", user?.org_id)
        .maybeSingle()

      // Customer debt (open receivables)
      const { data: recData } = await supabase
        .from("receivables")
        .select("amount, paid, due_date, status")
        .eq("customer_id", customerId)
        .neq("status", "paid")

      type RecRow = { amount: number; paid: number; due_date: string | null; status: string }
      const recRows = (recData as RecRow[]) || []
      const customerDebt = recRows.reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)
      const now = Date.now()
      const customerOverdue = recRows
        .filter((r) => r.due_date && new Date(r.due_date).getTime() < now)
        .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)

      // Rep portfolio debt
      let repPortfolioDebt = 0
      if (user?.id) {
        const { data: repDebt } = await supabase
          .from("receivables")
          .select("amount, paid")
          .eq("sales_user_id", user.id)
          .neq("status", "paid")
        repPortfolioDebt = ((repDebt as Array<{ amount: number; paid: number }>) || [])
          .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0)
      }

      const decision = evaluateApproval(rulesData ?? null, {
        orderTotal: total,
        customer: selectedCustomer
          ? { id: selectedCustomer.id, credit_limit: selectedCustomer.credit_limit }
          : null,
        customerDebt,
        customerOverdue,
        repPortfolioDebt,
        role: user?.role || "sales",
      })

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
          status: decision.autoApprove ? "confirmed" : "draft",
          approved_by: decision.autoApprove ? user?.id : null,
          approved_at: decision.autoApprove ? new Date().toISOString() : null,
          approval_reason: decision.autoApprove ? null : decision.reason,
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

      // Fire-and-forget notifications
      if (user?.org_id) {
        const { createNotificationForUsers, fetchApproversForOrg } = await import("@/lib/notifications")
        if (decision.autoApprove) {
          // Notify the sales rep (creator) — only useful if another user placed this on behalf
          // Skip: creator already sees the toast.
        } else {
          const approvers = await fetchApproversForOrg(supabase, user.org_id)
          if (approvers.length > 0) {
            createNotificationForUsers(supabase, {
              orgId: user.org_id,
              userIds: approvers,
              type: "order_pending_approval",
              title: `Đơn ${orderCode} cần duyệt`,
              body: `${selectedCustomer?.store_name || ""} • ${new Intl.NumberFormat("vi-VN").format(total)}₫ — ${decision.reason}`,
              linkUrl: `/orders/${order.id}`,
              metadata: { order_id: order.id, order_code: orderCode, total },
            })
          }
        }
      }

      if (decision.autoApprove) {
        toast({ title: `Đã tạo và tự động duyệt đơn ${orderCode}` })
      } else {
        toast({
          title: `Đã tạo đơn ${orderCode} — chờ duyệt`,
          description: decision.reason,
        })
      }
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
        <Card className="rounded-2xl shadow-sm bg-card">
          <CardHeader>
            <CardTitle className="text-base font-bold">Thông tin khách hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Khách hàng *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value)
                    setCustomerDropdownOpen(true)
                    if (!e.target.value) setCustomerId("")
                  }}
                  onFocus={() => setCustomerDropdownOpen(true)}
                  placeholder="Gõ tên, SĐT hoặc chủ cửa hàng..."
                  className="pl-9 pr-8"
                />
                {customerSearch && (
                  <button
                    type="button"
                    onClick={() => { setCustomerSearch(""); setCustomerId(""); setCustomerDropdownOpen(false) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {customerDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-xl shadow-md max-h-64 overflow-y-auto">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">Không tìm thấy</div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCustomer(c.id)}
                          className={`w-full text-left px-3 py-2.5 hover:bg-muted/30 transition-colors flex items-center justify-between ${
                            c.id === customerId ? "bg-primary/5 text-primary" : ""
                          }`}
                        >
                          <div>
                            <p className="font-medium text-sm">{c.store_name}</p>
                            <p className="text-xs text-muted-foreground">{c.phone} • {c.owner_name}</p>
                          </div>
                          {c.id === customerId && <span className="text-primary text-xs font-bold">✓</span>}
                        </button>
                      ))
                    )}
                    <div className="border-t border-border/30 p-1.5">
                      <Link
                        href="/customers/new"
                        target="_blank"
                        className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-muted/30 rounded-lg"
                      >
                        <Plus className="h-3 w-3" /> Tạo khách hàng mới
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              {selectedCustomer && (
                <Link
                  href={`/customers/${selectedCustomer.id}`}
                  target="_blank"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Xem / Sửa khách hàng <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>

            {selectedCustomer && (
              <div className="rounded-xl bg-muted/30 p-4 space-y-2">
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
        <Card className="rounded-2xl shadow-sm bg-card">
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
        <Card className="rounded-2xl shadow-sm bg-card flex-1">
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
                        className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-muted/30 rounded-lg transition-colors"
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
            {/* Product search + barcode scan */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Tìm tên hoặc mã SKU..."
                  className="pl-9"
                />
              {filteredProducts.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-xl shadow-md max-h-72 overflow-y-auto">
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
                        className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center justify-between gap-3 border-b border-border/20 last:border-0"
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
                      className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-primary hover:bg-muted/30 rounded-lg transition-colors"
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
                onClick={handleBarcodeScan}
                title="Quét mã vạch"
                className="shrink-0 h-10 w-10"
              >
                <ScanBarcode className="h-5 w-5" />
              </Button>
            </div>

            {/* DESKTOP: Table view */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/30 text-left">
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-10">#</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sản phẩm</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28">ĐVT</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-20">SL</th>
                    {!isSalesRole && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28">Đơn giá</th>}
                    {!isSalesRole && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-16">CK %</th>}
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28 text-right">Thành tiền</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {lines.map((line, i) => {
                    const units = getAvailableUnits(line)
                    const product = products.find((p) => p.id === line.product_id)
                    const onHand = stockByProduct[line.product_id] ?? 0
                    const over = lineOverstock(line, i)
                    return (
                      <tr key={i} className={`hover:bg-muted/20 ${over ? "bg-red-50" : ""}`}>
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{line.product_name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">SKU: {line.sku}</span>
                          <div className={`text-[10px] ${over ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
                            Tồn: {onHand} {product?.base_unit}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {units.length <= 1 ? (
                            <span className="text-muted-foreground">{line.unit_name}</span>
                          ) : (
                            <Select value={line.unit_name} onValueChange={(v) => updateLine(i, "unit_name", v)}>
                              <SelectTrigger className="h-8 min-w-[80px]"><SelectValue /></SelectTrigger>
                              <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => updateLine(i, "quantity", parseInt(e.target.value) || 1)}
                            className={`h-8 w-20 text-center ${over ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                          />
                        </td>
                        {!isSalesRole && (
                          <td className="px-3 py-2">
                            <Input type="number" value={line.unit_price} onChange={(e) => updateLine(i, "unit_price", parseInt(e.target.value) || 0)} className="h-8 w-24" />
                          </td>
                        )}
                        {!isSalesRole && (
                          <td className="px-3 py-2">
                            <Input type="number" min={0} max={100} value={line.line_discount_percent} onChange={(e) => updateLine(i, "line_discount_percent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} className="h-8 w-16 text-center" />
                          </td>
                        )}
                        <td className="px-3 py-2 text-right font-bold">{formatCurrency(line.line_total)}</td>
                        <td className="px-3 py-2"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={isSalesRole ? 6 : 8} className="py-8 text-center text-muted-foreground text-sm">Tìm hoặc quét sản phẩm phía trên</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* MOBILE: Card view */}
            <div className="lg:hidden space-y-2">
              {lines.length === 0 && (
                <div className="py-8 text-center text-muted-foreground text-sm">Tìm hoặc quét sản phẩm phía trên</div>
              )}
              {lines.map((line, i) => {
                const units = getAvailableUnits(line)
                const product = products.find((p) => p.id === line.product_id)
                const onHand = stockByProduct[line.product_id] ?? 0
                const over = lineOverstock(line, i)
                return (
                  <div
                    key={i}
                    className={`border rounded-xl p-3 ${over ? "border-red-500 bg-red-50" : "border-border/40 bg-card"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{line.product_name}</p>
                        <p className="text-[10px] text-muted-foreground">SKU: {line.sku}</p>
                        <p className={`text-[10px] ${over ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
                          Tồn: {onHand} {product?.base_unit}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeLine(i)}>
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Unit selector */}
                      {units.length <= 1 ? (
                        <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">{line.unit_name}</span>
                      ) : (
                        <Select value={line.unit_name} onValueChange={(v) => updateLine(i, "unit_name", v)}>
                          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                      {/* Quantity */}
                      <div className="flex items-center gap-1 flex-1">
                        <button type="button" onClick={() => updateLine(i, "quantity", Math.max(1, line.quantity - 1))} className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-lg font-bold">−</button>
                        <Input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => updateLine(i, "quantity", parseInt(e.target.value) || 1)}
                          className={`h-8 text-center flex-1 ${over ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                        />
                        <button type="button" onClick={() => updateLine(i, "quantity", line.quantity + 1)} className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-lg font-bold">+</button>
                      </div>
                      {/* Total */}
                      <span className="text-sm font-bold text-primary shrink-0">{formatCurrency(line.line_total)}</span>
                    </div>
                    {over && (
                      <p className="text-[11px] text-red-600 font-semibold mt-2">
                        Vượt tồn kho ({baseQty(line)} / {onHand} {product?.base_unit})
                      </p>
                    )}
                    {!isSalesRole && (
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
                        <span>Giá: {formatCurrency(line.unit_price)}</span>
                        {line.line_discount_percent > 0 && <span>CK: {line.line_discount_percent}%</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Notes + Summary row */}
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="w-full lg:w-1/2">
            <Card className="rounded-2xl shadow-sm bg-card h-full">
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
            <div className="bg-primary text-white rounded-2xl shadow-md p-6 relative overflow-hidden">
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
                  <span className="text-2xl font-bold tracking-tight">
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
                    disabled={loading || hasOverstock}
                    className="flex-[2] bg-white hover:bg-white/90 text-primary font-bold border-0"
                  >
                    {loading ? "Đang lưu..." : hasOverstock ? "Vượt tồn kho" : "Tạo đơn hàng"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Click-outside to close customer dropdown */}
      {customerDropdownOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setCustomerDropdownOpen(false)} />
      )}

      {/* Barcode scanner (camera + manual) */}
      <BarcodeScanner
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onScan={processBarcodeResult}
      />
    </form>
  )
}
