"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, generateOrderCode } from "@/lib/utils"
import { PAYMENT_TERMS, CUSTOMER_STATUS_MAP } from "@/lib/constants"
import { Trash2, Plus, ExternalLink, Search, ScanBarcode, X, ShoppingCart, ChevronRight, AlertTriangle, RotateCcw, ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { BarcodeScanner } from "@/components/ui/barcode-scanner"
import {
  userPriceRulesFrom,
  userSalesCeiling,
  validateUserSalesPrice,
  validateUserReturnPrice,
} from "@/lib/pricing"
import { RETURN_REASONS } from "@/lib/constants"
import { getConversionFactor } from "@/lib/inventory/uom"
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
  note: string
}

interface ReturnLineDraft {
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: number
  unit_price: number
  /** VAT (phân số 0-1). line_total = qty × unit_price × (1 + vat_rate). */
  vat_rate: number
  line_total: number
  note: string
  /** True = đổi hàng. Không trừ vào công nợ; vẫn in trên phiếu giao. */
  is_exchange: boolean
}

type ReturnReason = (typeof RETURN_REASONS)[number]["value"]

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

  // Optional "hàng trả lại" companion to this order. The sales rep can record
  // goods the customer is returning at the same visit; on submit we create a
  // returns row + return_lines linked to this order_id, status='pending' so
  // the manager can approve at /returns.
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnLines, setReturnLines] = useState<ReturnLineDraft[]>([])
  const [returnReason, setReturnReason] = useState<ReturnReason>("damaged")
  const [returnNotes, setReturnNotes] = useState("")
  const [returnSearch, setReturnSearch] = useState("")

  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
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
      // Deep-link: /orders/new?customerId=X → preselect khách hàng.
      const cid = searchParams.get("customerId")
      if (cid && (custRes.data as Customer[] | null)?.some((c) => c.id === cid)) {
        setCustomerId(cid)
      }
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
  // Sales rep may only edit price when the org allows it.
  // Manager/owner always see the input (their authority overrides rules).
  // Sales reps cần flag allow_price_edit ở /settings/users/[id] để sửa được giá.
  const userRules = userPriceRulesFrom(user)
  const canEditPrice = !isSalesRole || userRules.allow_price_edit
  // Discount % stays manager-only.
  const canEditDiscount = !isSalesRole

  // Default price for a line according to current price lists + customer group.
  const getLineDefaultPrice = (line: OrderLine): number => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return 0
    return getUnitPrice(product, line.unit_name, selectedCustomer?.group_id)
  }

  // Sales-line price guard — Update #2 v2 §4.6 (per-USER rules).
  // Quy tắc:
  //   1) Đơn bán: giá ≥ giá list (ngăn phá giá).
  //   2) Đơn bán: giá ≤ giá list × (1 + max_increase_pct/100).
  //   Owner & accountant bypass mọi check.
  const getLinePriceWarning = (line: OrderLine): string | null => {
    const userRules = userPriceRulesFrom(user)
    if (userRules.free) return null
    const def = getLineDefaultPrice(line)
    if (def <= 0) return null
    return validateUserSalesPrice(line.unit_price, def, userRules)
  }

  // Round an arbitrary VAT rate (stored as decimal 0-1) to the nearest
  // Vietnamese-standard tier the selector lets users pick: 0, 5, 8, 10%.
  const snapVat = (rate: number): number => {
    const tiers = [0, 0.05, 0.08, 0.1]
    let best = tiers[0]
    let bestDiff = Math.abs(rate - tiers[0])
    for (const t of tiers) {
      const d = Math.abs(rate - t)
      if (d < bestDiff) { best = t; bestDiff = d }
    }
    return best
  }

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
        // Snap to the VN-standard VAT tiers the selector offers
        vat_rate: snapVat(product.vat_rate ?? 0),
        note: "",
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

  // Same conversion but for a return-line draft (hàng đi đổi cũng xuất
  // kho như hàng bán nên cần check tồn).
  const baseQtyReturn = (line: ReturnLineDraft): number => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return line.quantity
    if (line.unit_name === product.base_unit) return line.quantity
    const u = product.units?.find((x) => x.unit_name === line.unit_name)
    return line.quantity * (u?.conversion || 1)
  }

  // Demand per product (base UOM) split by source.
  const saleDemandByProduct = (() => {
    const m: Record<string, number> = {}
    for (const l of lines) {
      m[l.product_id] = (m[l.product_id] || 0) + baseQty(l)
    }
    return m
  })()
  const exchangeDemandByProduct = (() => {
    const m: Record<string, number> = {}
    for (const l of returnLines) {
      if (!l.is_exchange) continue
      m[l.product_id] = (m[l.product_id] || 0) + baseQtyReturn(l)
    }
    return m
  })()

  // For a given sale line, return on-hand minus everything already ordered on
  // OTHER sale lines for the same product. (Hàng đi đổi được tính riêng ở
  // dòng trả-đổi để "blame" rơi vào dòng đổi — phần thêm vào — chứ không
  // làm dòng bán đang hợp lệ bỗng nhiên đỏ.)
  const availableForLine = (line: OrderLine, index: number): number => {
    const onHand = stockByProduct[line.product_id] ?? 0
    const otherSale = lines.reduce((sum, l, i) => {
      if (i === index) return sum
      if (l.product_id !== line.product_id) return sum
      return sum + baseQty(l)
    }, 0)
    return onHand - otherSale
  }

  // Check if a specific sale line exceeds stock
  const lineOverstock = (line: OrderLine, index: number): boolean => {
    return baseQty(line) > availableForLine(line, index)
  }

  // For an exchange return line: on-hand minus ALL sale demand minus OTHER
  // exchange lines for the same product. (Non-exchange returns ADD stock so
  // không cần check.)
  const exchangeAvailableForLine = (line: ReturnLineDraft, index: number): number => {
    const onHand = stockByProduct[line.product_id] ?? 0
    const saleUsed = saleDemandByProduct[line.product_id] || 0
    const otherExchange = returnLines.reduce((sum, l, i) => {
      if (i === index) return sum
      if (!l.is_exchange) return sum
      if (l.product_id !== line.product_id) return sum
      return sum + baseQtyReturn(l)
    }, 0)
    return onHand - saleUsed - otherExchange
  }
  const returnLineOverstock = (line: ReturnLineDraft, index: number): boolean => {
    if (!line.is_exchange) return false
    return baseQtyReturn(line) > exchangeAvailableForLine(line, index)
  }

  // Aggregated check — true if any product's TOTAL demand (sale + exchange)
  // exceeds on-hand. Vd: tồn 10, bán 9, đổi 2 → 11 > 10 → block.
  const hasOverstock = (() => {
    const pids = Array.from(
      new Set<string>([
        ...Object.keys(saleDemandByProduct),
        ...Object.keys(exchangeDemandByProduct),
      ])
    )
    for (const pid of pids) {
      const total =
        (saleDemandByProduct[pid] || 0) + (exchangeDemandByProduct[pid] || 0)
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

  // ---- Return-line helpers (companion to the sale order) ----

  const getReturnLineDefault = (line: ReturnLineDraft): number => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return 0
    return getUnitPrice(product, line.unit_name, selectedCustomer?.group_id)
  }

  // Return-line price guard — Update #2 v2 §4.6 ràng buộc 3:
  // Giá hoàn ≤ giá đã bán SP đó trong đơn gốc tham chiếu. Đây là
  // companion-return form (tạo trong cùng đơn bán) → originalPrice
  // chính là giá vừa nhập trên dòng bán cùng product, fallback giá
  // list nếu không thấy.
  const getReturnLinePriceWarning = (line: ReturnLineDraft): string | null => {
    const userRules = userPriceRulesFrom(user)
    if (userRules.free) return null
    const def = getReturnLineDefault(line)
    if (def <= 0) return null
    const sameSaleLine = lines.find((l) => l.product_id === line.product_id)
    const originalPrice = sameSaleLine ? Number(sameSaleLine.unit_price || def) : def
    return validateUserReturnPrice(line.unit_price, originalPrice, userRules)
  }

  const addReturnLine = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const groupId = selectedCustomer?.group_id
    const price = getUnitPrice(product, product.base_unit, groupId)
    const vatRate = snapVat(product.vat_rate ?? 0)
    setReturnLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        unit_name: product.base_unit,
        quantity: 1,
        unit_price: price,
        vat_rate: vatRate,
        line_total: price * (1 + vatRate),
        note: "",
        is_exchange: false,
      },
    ])
    setReturnSearch("")
  }

  const updateReturnLine = (
    index: number,
    field: keyof ReturnLineDraft,
    value: number | string | boolean
  ) => {
    setReturnLines((prev) => {
      const updated = [...prev]
      const line = { ...updated[index], [field]: value } as ReturnLineDraft
      if (field === "unit_name") {
        const product = products.find((p) => p.id === line.product_id)
        if (product) {
          const groupId = selectedCustomer?.group_id
          const newPrice = getUnitPrice(product, String(value), groupId)
          if (newPrice > 0) line.unit_price = newPrice
        }
      }
      line.line_total =
        Number(line.quantity || 0) *
        Number(line.unit_price || 0) *
        (1 + Number(line.vat_rate || 0))
      updated[index] = line
      return updated
    })
  }

  const removeReturnLine = (index: number) => {
    setReturnLines((prev) => prev.filter((_, i) => i !== index))
  }

  const returnAvailableUnits = (line: ReturnLineDraft): string[] => {
    const product = products.find((p) => p.id === line.product_id)
    if (!product) return [line.unit_name]
    const units = [product.base_unit]
    ;(product.units || []).forEach((u) => {
      if (!units.includes(u.unit_name)) units.push(u.unit_name)
    })
    return units
  }

  const filteredReturnProducts = products.filter((p) => {
    if (!returnSearch.trim()) return false
    const q = returnSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
  })

  // Tổng giá trị trả ĐƯỢC TRỪ vào công nợ — KHÔNG cộng dòng đổi hàng,
  // vì đổi hàng chỉ là vật chất ra/vào, không động đến tiền.
  const returnSubtotal = returnLines.reduce(
    (s, l) =>
      s +
      (l.is_exchange
        ? 0
        : Number(l.quantity || 0) * Number(l.unit_price || 0)),
    0
  )

  const exchangeSubtotal = returnLines.reduce(
    (s, l) =>
      s +
      (l.is_exchange
        ? Number(l.quantity || 0) * Number(l.unit_price || 0)
        : 0),
    0
  )

  const hasReturnPriceViolation =
    isSalesRole && returnLines.some((l) => getReturnLinePriceWarning(l) != null)

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

  // Aggregated price violation across lines (sales role only).
  const hasPriceViolation =
    (isSalesRole && lines.some((l) => getLinePriceWarning(l) != null)) ||
    hasReturnPriceViolation

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
    // sale lines + hàng đi đổi (is_exchange) — cả hai đều xuất kho nên
    // phải tính chung. Vd: tồn 10, bán 9, đổi 2 → 11 > 10 → chặn.
    const totalsByProduct: Record<string, number> = {}
    const exchangeByProduct: Record<string, number> = {}
    for (const l of lines) {
      totalsByProduct[l.product_id] = (totalsByProduct[l.product_id] || 0) + baseQty(l)
    }
    for (const l of returnLines) {
      if (!l.is_exchange) continue
      totalsByProduct[l.product_id] = (totalsByProduct[l.product_id] || 0) + baseQtyReturn(l)
      exchangeByProduct[l.product_id] = (exchangeByProduct[l.product_id] || 0) + baseQtyReturn(l)
    }
    const overstock: string[] = []
    for (const [productId, total] of Object.entries(totalsByProduct)) {
      const onHand = stockByProduct[productId] ?? 0
      if (total > onHand) {
        const p = products.find((x) => x.id === productId)
        const exQty = exchangeByProduct[productId] || 0
        const note = exQty > 0 ? ` (gồm ${exQty} ${p?.base_unit || ""} hàng đi đổi)` : ""
        overstock.push(
          `${p?.name || productId}: cần ${total} ${p?.base_unit || ""}${note}, chỉ còn ${onHand}`
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

    // Sales-rep price floor (when allowed at all). Block submit if any line
    // is below the floor — manager/owner skip this since they have authority.
    if (isSalesRole) {
      const violations: string[] = []
      for (const l of lines) {
        const w = getLinePriceWarning(l)
        if (w) violations.push(`${l.product_name}: ${w}`)
      }
      for (const l of returnLines) {
        const w = getReturnLinePriceWarning(l)
        if (w) violations.push(`Trả ${l.product_name}: ${w}`)
      }
      if (violations.length > 0) {
        toast({
          title: "Giá ngoài giới hạn cho phép",
          description: violations.join(" • "),
          variant: "destructive",
        })
        return
      }
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

      const orderLines = lines.map((l) => {
        const trimmed = l.note?.trim()
        // T-01 — snapshot conversion factor so picking can deduct in base UOM.
        const product = products.find((p) => p.id === l.product_id)
        const conversionFactor = getConversionFactor(
          product,
          product?.units,
          l.unit_name
        )
        return {
          order_id: order.id,
          product_id: l.product_id,
          unit_name: l.unit_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_discount: l.quantity * l.unit_price * (l.line_discount_percent / 100),
          line_total: l.line_total,
          conversion_factor: conversionFactor,
          // Only include `note` when set so DBs without migration 029
          // don't reject the insert.
          ...(trimmed ? { note: trimmed } : {}),
        }
      })

      const { error: linesErr } = await supabase.from("sales_order_lines").insert(orderLines)
      if (linesErr) {
        // Defensive retry — if DB lacks `note` (mig 029) or
        // `conversion_factor` (mig 039), strip those optional columns
        // and retry so the order still saves on un-migrated tenants.
        const msg = (linesErr.message || "").toLowerCase()
        const code = (linesErr as unknown as { code?: string }).code
        const optional =
          msg.includes("note") ||
          msg.includes("conversion_factor") ||
          code === "PGRST204"
        if (!optional) throw linesErr
        const stripped = lines.map((l) => ({
          order_id: order.id,
          product_id: l.product_id,
          unit_name: l.unit_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_discount: l.quantity * l.unit_price * (l.line_discount_percent / 100),
          line_total: l.line_total,
        }))
        const retry = await supabase.from("sales_order_lines").insert(stripped)
        if (retry.error) throw retry.error
      }

      // Companion return record (if the rep filled the "Hàng trả lại" section).
      // The return stays 'pending' so a manager can review at /returns; on
      // approval the helper auto-restocks the goods and nets the credit
      // against this order's receivable.
      if (returnLines.length > 0) {
        const { data: returnRow, error: returnErr } = await supabase
          .from("returns")
          .insert({
            org_id: user?.org_id,
            order_id: order.id,
            customer_id: customerId,
            requested_by: user?.id,
            reason: returnReason,
            status: "pending",
            credit_note_amount: returnSubtotal,
            notes: returnNotes || null,
          })
          .select("id")
          .single()
        if (returnErr) throw returnErr
        const returnId = (returnRow as { id: string }).id
        // ⚠️ Always send is_exchange (even when false) so the Supabase
        // batch insert sees a consistent column set — PostgREST infers
        // ?columns=... from the first row only, so a row WITH
        // is_exchange after rows WITHOUT it would silently lose the
        // value, leaving exchange flags as DEFAULT (false). The optional-
        // missing fallback below catches DBs without the column entirely.
        const returnLineRows = returnLines.map((l) => {
          const trimmed = l.note?.trim()
          const vat = Number(l.vat_rate || 0)
          const gross =
            Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 + vat)
          return {
            return_id: returnId,
            product_id: l.product_id,
            unit_name: l.unit_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            vat_rate: vat,
            line_total: gross,
            is_exchange: !!l.is_exchange,
            ...(trimmed ? { note: trimmed } : {}),
          }
        })
        const { error: rLinesErr } = await supabase
          .from("return_lines")
          .insert(returnLineRows)
        if (rLinesErr) {
          // Defensive fallback: if the DB lacks `is_exchange` (mig 035
          // not yet applied), Postgres rejects the bulk insert with
          // a "column does not exist" 400 because Supabase sends the
          // union of keys via ?columns=... Retry once without the
          // optional columns so existing tenants stay functional.
          const msg = (rLinesErr.message || "").toLowerCase()
          const code = (rLinesErr as unknown as { code?: string }).code
          const optionalMissing =
            msg.includes("is_exchange") ||
            msg.includes("vat_rate") ||
            msg.includes("'note'") ||
            msg.includes('"note"') ||
            code === "PGRST204"
          if (!optionalMissing) throw rLinesErr
          const stripped = returnLines.map((l) => ({
            return_id: returnId,
            product_id: l.product_id,
            unit_name: l.unit_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            line_total:
              Number(l.quantity || 0) *
              Number(l.unit_price || 0) *
              (1 + Number(l.vat_rate || 0)),
          }))
          const retry = await supabase.from("return_lines").insert(stripped)
          if (retry.error) throw retry.error
          // If the rep marked exchange lines but the DB doesn't support it,
          // surface a soft warning (don't block the order — already saved).
          if (returnLines.some((l) => l.is_exchange)) {
            toast({
              title: "Đã lưu đơn — chưa áp dụng đổi hàng",
              description:
                "DB thiếu cột is_exchange (migration 035 chưa chạy). Liên hệ admin để áp dụng.",
              variant: "destructive",
            })
          }
        }
      }

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

  const lineCount = lines.length
  const summaryHasContent = !!customerId && lineCount > 0

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-card-gap pb-24 lg:pb-6">
      {/* Mobile step indicator */}
      <div className="w-full lg:hidden flex items-center gap-2 px-1 pb-1">
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            customerId ? "bg-primary text-on-primary" : "bg-muted text-muted-foreground"
          }`}>
            1
          </span>
          <span className={`text-xs font-semibold ${customerId ? "text-primary" : "text-muted-foreground"}`}>
            Khách hàng
          </span>
        </div>
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            lineCount > 0 ? "bg-primary text-on-primary" : "bg-muted text-muted-foreground"
          }`}>
            2
          </span>
          <span className={`text-xs font-semibold ${lineCount > 0 ? "text-primary" : "text-muted-foreground"}`}>
            Sản phẩm ({lineCount})
          </span>
        </div>
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            summaryHasContent ? "bg-primary text-on-primary" : "bg-muted text-muted-foreground"
          }`}>
            3
          </span>
          <span className={`text-xs font-semibold ${summaryHasContent ? "text-primary" : "text-muted-foreground"}`}>
            Xác nhận
          </span>
        </div>
      </div>

      {/* Stitch layout: 8/12 main + 4/12 sticky summary on xl+ */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-card-gap items-start">
        {/* MAIN COLUMN (8/12) */}
        <div className="xl:col-span-8 flex flex-col gap-card-gap min-w-0">
        {/* Customer info card */}
        <Card className="rounded-xl shadow-card">
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
        <Card className="rounded-xl shadow-card">
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

        {/* Products card */}
        <Card className="rounded-xl shadow-card flex-1">
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
                    {canEditPrice && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-32">Đơn giá</th>}
                    {canEditDiscount && <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-16">CK %</th>}
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-20">VAT</th>
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
                      <tr key={i} className={`hover:bg-muted/20 ${over ? "bg-error-container" : ""}`}>
                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{line.product_name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">SKU: {line.sku}</span>
                          <div className={`text-[10px] ${over ? "text-error font-bold" : "text-muted-foreground"}`}>
                            Tồn: {onHand} {product?.base_unit}
                          </div>
                          <Input
                            value={line.note}
                            onChange={(e) => updateLine(i, "note", e.target.value)}
                            placeholder="Ghi chú dòng (tuỳ chọn)…"
                            className="mt-1 h-7 text-xs"
                          />
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
                            className={`h-8 w-20 text-center ${over ? "border-error/40 focus-visible:ring-error-container0" : ""}`}
                          />
                        </td>
                        {canEditPrice && (() => {
                          const warning = getLinePriceWarning(line)
                          const def = isSalesRole ? getLineDefaultPrice(line) : 0
                          return (
                            <td className="px-3 py-2 align-top">
                              <MoneyInput
                                value={line.unit_price}
                                onChange={(v) => updateLine(i, "unit_price", v)}
                                showSuffix={false}
                                className={`h-8 w-28 ${warning ? "border-error/40 focus-visible:ring-error-container0" : ""}`}
                              />
                              {isSalesRole && def > 0 && (() => {
                                const ceiling = userSalesCeiling(def, userRules)
                                return (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Mặc định: {formatCurrency(def)}
                                    {ceiling > def + 0.5 ? ` • Tối đa: ${formatCurrency(ceiling)}` : ""}
                                  </p>
                                )
                              })()}
                              {warning && (
                                <p className="text-[10px] text-error font-semibold mt-0.5 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> {warning}
                                </p>
                              )}
                            </td>
                          )
                        })()}
                        {canEditDiscount && (
                          <td className="px-3 py-2">
                            <Input type="number" min={0} max={100} value={line.line_discount_percent} onChange={(e) => updateLine(i, "line_discount_percent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} className="h-8 w-16 text-center" />
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <Select
                            value={String(Math.round(line.vat_rate * 100))}
                            onValueChange={(v) => updateLine(i, "vat_rate", parseInt(v) / 100)}
                          >
                            <SelectTrigger className="h-8 w-18"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">0%</SelectItem>
                              <SelectItem value="5">5%</SelectItem>
                              <SelectItem value="8">8%</SelectItem>
                              <SelectItem value="10">10%</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right font-bold">{formatCurrency(line.line_total)}</td>
                        <td className="px-3 py-2"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td
                        colSpan={5 + (canEditPrice ? 1 : 0) + (canEditDiscount ? 1 : 0) + 2}
                        className="py-8 text-center text-muted-foreground text-sm"
                      >
                        Tìm hoặc quét sản phẩm phía trên
                      </td>
                    </tr>
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
                    className={`border rounded-xl p-3 ${over ? "border-error/40 bg-error-container" : "border-border/40 bg-card"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{line.product_name}</p>
                        <p className="text-[10px] text-muted-foreground">SKU: {line.sku}</p>
                        <p className={`text-[10px] ${over ? "text-error font-bold" : "text-muted-foreground"}`}>
                          Tồn: {onHand} {product?.base_unit}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeLine(i)}>
                        <X className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <Input
                      value={line.note}
                      onChange={(e) => updateLine(i, "note", e.target.value)}
                      placeholder="Ghi chú dòng (tuỳ chọn)…"
                      className="mb-2 h-8 text-xs"
                    />

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
                          className={`h-8 text-center flex-1 ${over ? "border-error/40 focus-visible:ring-error-container0" : ""}`}
                        />
                        <button type="button" onClick={() => updateLine(i, "quantity", line.quantity + 1)} className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-lg font-bold">+</button>
                      </div>
                      {/* Total */}
                      <span className="text-sm font-bold text-primary shrink-0">{formatCurrency(line.line_total)}</span>
                    </div>
                    {over && (
                      <p className="text-[11px] text-error font-semibold mt-2">
                        Vượt tồn kho ({baseQty(line)} / {onHand} {product?.base_unit})
                      </p>
                    )}
                    {canEditPrice && (() => {
                      const warning = getLinePriceWarning(line)
                      const def = isSalesRole ? getLineDefaultPrice(line) : 0
                      return (
                        <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                          <div className="flex items-center gap-2">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                              Giá
                            </Label>
                            <MoneyInput
                              value={line.unit_price}
                              onChange={(v) => updateLine(i, "unit_price", v)}
                              showSuffix={false}
                              className={`h-8 ${warning ? "border-error/40 focus-visible:ring-error-container0" : ""}`}
                            />
                          </div>
                          {isSalesRole && def > 0 && (() => {
                            const ceiling = userSalesCeiling(def, userRules)
                            return (
                              <p className="text-[10px] text-muted-foreground">
                                Mặc định {formatCurrency(def)}
                                {ceiling > def + 0.5 ? ` • Tối đa ${formatCurrency(ceiling)}` : ""}
                              </p>
                            )
                          })()}
                          {warning && (
                            <p className="text-[10px] text-error font-semibold flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> {warning}
                            </p>
                          )}
                        </div>
                      )
                    })()}
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
                      {canEditDiscount && line.line_discount_percent > 0 && (
                        <span>CK: {line.line_discount_percent}%</span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase">VAT</span>
                        <Select
                          value={String(Math.round(line.vat_rate * 100))}
                          onValueChange={(v) => updateLine(i, "vat_rate", parseInt(v) / 100)}
                        >
                          <SelectTrigger className="h-7 w-[72px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0%</SelectItem>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="8">8%</SelectItem>
                            <SelectItem value="10">10%</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Hàng trả lại (tuỳ chọn) — companion return tied to this order */}
        <Card className="rounded-xl shadow-card border-l-4 border-l-[#fdb022]">
          <CardHeader>
            <button
              type="button"
              onClick={() => setReturnOpen((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-[#b54708]" />
                <div>
                  <CardTitle className="text-base font-bold">
                    Hàng trả lại {returnLines.length > 0 ? `(${returnLines.length})` : "(tuỳ chọn)"}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ghi nhận hàng khách trả tại lượt giao này. Số tiền sẽ trừ vào số phải thu.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {returnLines.length > 0 && (
                  <Badge variant="warning">−{formatCurrency(returnSubtotal)}</Badge>
                )}
                {returnOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
            </button>
          </CardHeader>
          {returnOpen && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Lý do trả</Label>
                  <Select value={returnReason} onValueChange={(v) => setReturnReason(v as ReturnReason)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RETURN_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ghi chú đơn trả</Label>
                  <Input
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="vd: 5 hộp móp, bán không hết hạn"
                  />
                </div>
              </div>

              {/* Product picker */}
              <div className="relative">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={returnSearch}
                    onChange={(e) => setReturnSearch(e.target.value)}
                    placeholder="Tìm sản phẩm để thêm vào đơn trả..."
                    className="pl-10 h-10"
                  />
                </div>
                {filteredReturnProducts.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-card border rounded-xl shadow-lg max-h-72 overflow-y-auto">
                    {filteredReturnProducts.slice(0, 10).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addReturnLine(p.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-muted/30 flex items-center justify-between border-b border-border/20 last:border-0"
                      >
                        <div>
                          <p className="text-sm font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {p.sku} • {p.base_unit}</p>
                        </div>
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Return lines */}
              {returnLines.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Chưa có sản phẩm trả. Tìm và chọn ở ô trên.
                </p>
              ) : (
                <div className="space-y-2">
                  {returnLines.map((line, i) => {
                    const units = returnAvailableUnits(line)
                    const def = isSalesRole ? getReturnLineDefault(line) : 0
                    const warning = getReturnLinePriceWarning(line)
                    // Per-user rule: giá trả ≤ giá đã bán cùng SP trong đơn này
                    // (fallback giá list nếu chưa thêm dòng bán). Owner/accountant
                    // (free) bỏ qua → không hiển thị trần.
                    const ceilingValue = (() => {
                      if (!isSalesRole || def <= 0 || userRules.free) return null
                      const sameSaleLine = lines.find((l) => l.product_id === line.product_id)
                      return sameSaleLine ? Number(sameSaleLine.unit_price || def) : def
                    })()
                    return (
                      <div key={i} className="rounded-xl border bg-[#fff4ed]/30 p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{line.product_name}</p>
                            <p className="text-[10px] text-muted-foreground">SKU: {line.sku}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => removeReturnLine(i)}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          {units.length <= 1 ? (
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">ĐVT</Label>
                              <div className="h-9 px-3 flex items-center text-sm bg-muted/50 rounded-md">
                                {line.unit_name}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">ĐVT</Label>
                              <Select value={line.unit_name} onValueChange={(v) => updateReturnLine(i, "unit_name", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">SL</Label>
                            <Input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) => updateReturnLine(i, "quantity", parseInt(e.target.value) || 1)}
                              className="h-9 text-center"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Đơn giá</Label>
                            <MoneyInput
                              value={line.unit_price}
                              onChange={(v) => updateReturnLine(i, "unit_price", v)}
                              showSuffix={false}
                              className={`h-9 ${warning ? "border-error/40 focus-visible:ring-error-container0" : ""}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">VAT</Label>
                            <Select
                              value={String(Math.round((line.vat_rate || 0) * 100))}
                              onValueChange={(v) => updateReturnLine(i, "vat_rate", parseInt(v) / 100)}
                            >
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">0%</SelectItem>
                                <SelectItem value="5">5%</SelectItem>
                                <SelectItem value="8">8%</SelectItem>
                                <SelectItem value="10">10%</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Thành tiền</Label>
                            <div className="h-9 px-3 flex items-center justify-end font-bold text-[#b54708]">
                              {formatCurrency(line.line_total)}
                            </div>
                          </div>
                        </div>
                        {isSalesRole && def > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            Mặc định {formatCurrency(def)} {ceilingValue != null ? `• Tối đa ${formatCurrency(ceilingValue)}` : ""}
                          </p>
                        )}
                        {warning && (
                          <p className="text-[10px] text-error font-semibold mt-1.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {warning}
                          </p>
                        )}
                        <label
                          className={`mt-2 flex items-start gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-colors ${
                            line.is_exchange
                              ? returnLineOverstock(line, i)
                                ? "border-error/40 bg-error-container/60"
                                : "border-[#175cd3]/40 bg-[#eff8ff]/60"
                              : "border-border/40 hover:bg-muted/40"
                          }`}
                        >
                          <Checkbox
                            checked={line.is_exchange}
                            onCheckedChange={(v) =>
                              updateReturnLine(i, "is_exchange", v === true)
                            }
                            className="mt-0.5"
                          />
                          <div className="text-xs leading-tight">
                            <p className="font-semibold">Đổi hàng</p>
                            <p className="text-[10px] text-muted-foreground">
                              In trên phiếu giao để lái xe thu hàng. KHÔNG trừ
                              vào công nợ — coi như đổi 1-đổi-1.
                            </p>
                          </div>
                        </label>
                        {line.is_exchange && returnLineOverstock(line, i) && (
                          <p className="text-[10px] text-error font-semibold mt-1.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Không đủ tồn kho để đổi: cần {baseQtyReturn(line)}{" "}
                            {products.find((p) => p.id === line.product_id)?.base_unit || ""}, chỉ
                            còn {Math.max(0, exchangeAvailableForLine(line, i))}{" "}
                            {products.find((p) => p.id === line.product_id)?.base_unit || ""} (đã
                            trừ phần hàng bán ở trên)
                          </p>
                        )}
                        <Input
                          value={line.note}
                          onChange={(e) => updateReturnLine(i, "note", e.target.value)}
                          placeholder="Lý do trả / tình trạng (tuỳ chọn)…"
                          className="mt-2 h-8 text-xs"
                        />
                      </div>
                    )
                  })}
                </div>
              )}

              {returnLines.length > 0 && (
                <div className="space-y-1.5 pt-3 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Trừ công nợ
                    </span>
                    <span className="text-lg font-bold text-[#b54708]">
                      −{formatCurrency(returnSubtotal)}
                    </span>
                  </div>
                  {exchangeSubtotal > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        Đổi hàng (không trừ công nợ)
                      </span>
                      <span className="font-semibold text-[#175cd3]">
                        {formatCurrency(exchangeSubtotal)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Notes card — main column */}
        <Card className="rounded-xl shadow-card">
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
        {/* end MAIN COLUMN */}

        {/* SUMMARY COLUMN (4/12) — sticky on xl+ */}
        <div className="xl:col-span-4 flex flex-col gap-card-gap xl:sticky xl:top-24">
          {/* Order Summary — Stitch primary panel (bold blue) */}
          <div className="bg-primary text-on-primary rounded-xl shadow-card-hover p-6 relative overflow-hidden">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
            <h3 className="text-headline-md font-semibold mb-6 relative">Tổng thanh toán</h3>
            <div className="relative space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-primary-fixed font-medium">Tạm tính</span>
                <span className="font-semibold tabular-data">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-primary-fixed font-medium">Tổng chiết khấu</span>
                <span className="font-semibold tabular-data">-{formatCurrency(total_discount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-primary-fixed font-medium">VAT</span>
                <span className="font-semibold tabular-data">+{formatCurrency(vat)}</span>
              </div>
              <div className="h-px bg-primary-fixed-dim/30" />
              <div className="flex items-end justify-between">
                <span className="text-label-md uppercase text-primary-fixed">
                  Tổng đơn
                </span>
                <span className="text-headline-lg font-bold tracking-tight tabular-data">
                  {formatCurrency(total)}
                </span>
              </div>

              {returnLines.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-primary-fixed font-medium">Trừ hàng trả</span>
                    <span className="font-semibold tabular-data">-{formatCurrency(returnSubtotal)}</span>
                  </div>
                  <div className="h-px bg-primary-fixed-dim/30" />
                  <div className="flex items-end justify-between">
                    <span className="text-label-md uppercase text-primary-fixed">
                      Phải thu
                    </span>
                    <span className="text-headline-lg font-bold tracking-tight tabular-data text-tertiary-fixed-dim">
                      {formatCurrency(Math.max(0, total - returnSubtotal))}
                    </span>
                  </div>
                </>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  className="flex-1 bg-on-primary/15 hover:bg-on-primary/25 text-on-primary border-0 font-semibold"
                  onClick={() => router.back()}
                >
                  Huỷ
                </Button>
                <Button
                  type="submit"
                  disabled={loading || hasOverstock || hasPriceViolation}
                  className="flex-[2] bg-on-primary hover:bg-on-primary/90 text-primary font-semibold border-0"
                >
                  {loading
                    ? "Đang lưu..."
                    : hasOverstock
                      ? "Vượt tồn kho"
                      : hasPriceViolation
                        ? "Giá thấp hơn cho phép"
                        : "Tạo đơn hàng"}
                </Button>
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

      {/* Mobile floating summary dock */}
      {lineCount > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 lg:hidden px-4 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-md rounded-xl bg-surface-container-lowest/95 backdrop-blur-xl p-3 flex items-center justify-between gap-3 shadow-overlay border border-outline-variant/60">
            <div className="pl-2 min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary uppercase tracking-widest">
                <span className="relative inline-flex items-center justify-center">
                  <ShoppingCart className="h-3.5 w-3.5" />
                </span>
                {lineCount} sản phẩm
              </div>
              <p className="text-base font-black leading-tight truncate">
                {formatCurrency(total)}
              </p>
            </div>
            <Button
              type="submit"
              disabled={loading || hasOverstock || hasPriceViolation || !customerId}
              className="h-11 px-5 rounded-full shrink-0 bg-primary text-on-primary font-bold"
            >
              {loading
                ? "Đang lưu..."
                : hasOverstock
                  ? "Vượt tồn"
                  : hasPriceViolation
                    ? "Giá thấp"
                    : !customerId
                      ? "Chọn KH"
                      : "Tiếp tục"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
