"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import type { SalesOrder } from "@/types"

function generateInvoiceNumber(): string {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "")
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `INV-${dateStr}-${rand}`
}

export default function NewInvoicePage() {
  const { user, loading: authLoading } = useRoleGuard("invoices")
  const [orders, setOrders] = useState<(SalesOrder & { customer?: { store_name: string; address: string; phone: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [orderId, setOrderId] = useState("")
  const [invoiceNumber, setInvoiceNumber] = useState(generateInvoiceNumber())
  const [customerName, setCustomerName] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [customerTaxCode, setCustomerTaxCode] = useState("")
  const [subtotal, setSubtotal] = useState(0)
  const [vat, setVat] = useState(0)
  const [total, setTotal] = useState(0)

  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchOrders() {
      const { data, error: dataErr } = await supabase
        .from("sales_orders")
        .select("id, order_code, subtotal, vat, total, customer:customers(store_name, address, phone)")
        .eq("status", "delivered")
        .order("order_date", { ascending: false })
      if (dataErr) console.error("[invoices/new] truy vấn lỗi:", dataErr.message)
      setOrders((data as unknown as (SalesOrder & { customer?: { store_name: string; address: string; phone: string } })[]) || [])
      setLoading(false)
    }
    fetchOrders()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOrderChange = (selectedOrderId: string) => {
    setOrderId(selectedOrderId)
    const order = orders.find((o) => o.id === selectedOrderId)
    if (order) {
      setCustomerName(order.customer?.store_name || "")
      setCustomerAddress(order.customer?.address || "")
      setSubtotal(order.subtotal)
      setVat(order.vat)
      setTotal(order.total)
    }
  }

  const recalcTotal = (newSubtotal: number, newVat: number) => {
    setSubtotal(newSubtotal)
    setVat(newVat)
    setTotal(newSubtotal + newVat)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerName.trim()) {
      toast({ title: "Vui lòng nhập tên khách hàng", variant: "destructive" })
      return
    }
    setSubmitting(true)

    try {
      const { error } = await supabase.from("invoices").insert({
        org_id: user?.org_id,
        order_id: orderId || null,
        invoice_number: invoiceNumber,
        customer_name: customerName,
        customer_address: customerAddress || null,
        customer_tax_code: customerTaxCode || null,
        subtotal,
        vat,
        total,
        status: "draft",
      })

      if (error) throw error

      toast({ title: `Đã tạo hóa đơn ${invoiceNumber}` })
      router.push("/invoices")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Có lỗi xảy ra"
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Tạo hóa đơn mới" backHref="/invoices" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Đơn hàng</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Chọn đơn hàng đã giao</Label>
              <Select value={orderId} onValueChange={handleOrderChange}>
                <SelectTrigger><SelectValue placeholder="Chọn đơn hàng (không bắt buộc)" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.order_code} - {o.customer?.store_name || "N/A"} - {formatCurrency(o.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Chọn đơn hàng để tự động điền thông tin khách hàng và số tiền</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Thông tin hóa đơn</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Số hóa đơn *</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-YYYYMMDD-XXXX" />
              </div>
              <div className="space-y-2">
                <Label>Mã số thuế</Label>
                <Input value={customerTaxCode} onChange={(e) => setCustomerTaxCode(e.target.value)} placeholder="Nhập mã số thuế" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tên khách hàng *</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nhập tên khách hàng" />
            </div>
            <div className="space-y-2">
              <Label>Địa chỉ</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Nhập địa chỉ khách hàng" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Số tiền</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Tạm tính</Label>
                <Input
                  type="number"
                  value={subtotal}
                  onChange={(e) => recalcTotal(parseFloat(e.target.value) || 0, vat)}
                />
              </div>
              <div className="space-y-2">
                <Label>VAT</Label>
                <Input
                  type="number"
                  value={vat}
                  onChange={(e) => recalcTotal(subtotal, parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tổng cộng</Label>
                <Input type="number" value={total} disabled className="font-bold" />
              </div>
            </div>
            <div className="text-right text-lg font-bold">
              Tổng: {formatCurrency(total)}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>Hủy</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Đang lưu..." : "Tạo hóa đơn"}</Button>
        </div>
      </form>
    </div>
  )
}
