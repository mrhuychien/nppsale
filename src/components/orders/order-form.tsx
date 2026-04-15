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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, generateOrderCode } from "@/lib/utils"
import { Trash2 } from "lucide-react"
import type { Customer, Product, PriceList } from "@/types"

interface OrderLine {
  product_id: string
  product_name: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  vat_rate: number
}

export function OrderForm() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<(Product & { price_lists?: PriceList[] })[]>([])
  const [customerId, setCustomerId] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<OrderLine[]>([])
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

  const addLine = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    const groupId = selectedCustomer?.group_id
    const priceEntry = product.price_lists?.find(
      (pl) => pl.unit_name === product.base_unit && (pl.group_id === groupId || !pl.group_id)
    )
    const price = priceEntry?.price || 0
    setLines([...lines, {
      product_id: product.id,
      product_name: product.name,
      unit_name: product.base_unit,
      quantity: 1,
      unit_price: price,
      line_discount: 0,
      line_total: price,
      vat_rate: product.vat_rate ?? 0,
    }])
  }

  const updateLine = (index: number, field: keyof OrderLine, value: number) => {
    const updated = [...lines]
    const line = { ...updated[index], [field]: value }
    line.line_total = (line.quantity * line.unit_price) - line.line_discount
    updated[index] = line
    setLines(updated)
  }

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index))
  }

  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0)
  const vat = Math.round(lines.reduce((sum, l) => sum + l.line_total * l.vat_rate, 0))
  const total = subtotal + vat

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
          order_code: orderCode,
          customer_id: customerId,
          sales_user_id: user?.id,
          payment_terms: selectedCustomer?.payment_terms || "COD",
          subtotal,
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
        line_discount: l.line_discount,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Thông tin đơn hàng</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Khách hàng *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Chọn khách hàng" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.store_name} - {c.phone}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>NV bán hàng</Label>
              <Input value={user?.full_name || ""} disabled />
            </div>
          </div>
          {selectedCustomer && (
            <div className="text-sm text-muted-foreground">
              Điều khoản: {selectedCustomer.payment_terms} | Hạn mức: {formatCurrency(selectedCustomer.credit_limit)}
            </div>
          )}
          <div className="space-y-2">
            <Label>Ghi chú</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú cho đơn hàng..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Sản phẩm ({lines.length})</CardTitle>
            <Select onValueChange={addLine}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Thêm sản phẩm..." /></SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="w-24">SL</TableHead>
                  <TableHead className="w-32">Đơn giá</TableHead>
                  <TableHead className="w-32 text-right">Thành tiền</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, i) => (
                  <TableRow key={i}>
                    <TableCell>{line.product_name}<br /><span className="text-xs text-muted-foreground">{line.unit_name}</span></TableCell>
                    <TableCell>
                      <Input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(i, "quantity", parseInt(e.target.value) || 1)} className="w-20" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={line.unit_price} onChange={(e) => updateLine(i, "unit_price", parseInt(e.target.value) || 0)} className="w-28" />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(line.line_total)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">Chưa có sản phẩm. Chọn từ danh sách phía trên.</p>
          )}

          <div className="mt-4 space-y-1 text-right">
            <p>Tạm tính: <span className="font-medium">{formatCurrency(subtotal)}</span></p>
            <p>VAT: <span className="font-medium">{formatCurrency(vat)}</span></p>
            <p className="text-lg font-bold">Tổng: {formatCurrency(total)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
        <Button type="submit" disabled={loading}>{loading ? "Đang lưu..." : "Tạo đơn hàng"}</Button>
      </div>
    </form>
  )
}
