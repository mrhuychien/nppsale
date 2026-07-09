"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Printer } from "lucide-react"
import type { Invoice, SalesOrder, SalesOrderLine } from "@/types"

interface Organization {
  id: string
  name: string
  address?: string | null
  phone?: string | null
  tax_code?: string | null
}

export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  useAuth()
  const { loading: authLoading } = useRoleGuard("invoices")
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [order, setOrder] = useState<SalesOrder | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)

    const { data: inv } = await supabase
      .from("invoices")
      .select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at")
      .eq("id", id)
      .single()

    if (!inv) {
      setLoading(false)
      return
    }

    const invoiceData = inv as Invoice
    setInvoice(invoiceData)

    // Fetch organization
    if (invoiceData.org_id) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id, name, address, phone, tax_code")
        .eq("id", invoiceData.org_id)
        .single()
      if (orgData) setOrg(orgData as Organization)
    }

    // Fetch order lines if linked to an order
    if (invoiceData.order_id) {
      const { data: orderData } = await supabase
        .from("sales_orders")
        .select("id, order_code")
        .eq("id", invoiceData.order_id)
        .single()
      if (orderData) setOrder(orderData as SalesOrder)

      const { data: linesData } = await supabase
        .from("sales_order_lines")
        .select("id, unit_name, quantity, unit_price, line_total, product:products(*)")
        .eq("order_id", invoiceData.order_id)
      if (linesData) setLines(linesData as unknown as SalesOrderLine[])
    }

    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy hóa đơn</div>

  const canPrint = invoice.status === "draft" || invoice.status === "issued"

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="Xuất hóa đơn VAT"
          description={`Hóa đơn ${invoice.invoice_number || ""}`}
          backHref={`/invoices/${id}`}
        >
          {canPrint && (
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" /> Xuất hóa đơn VAT
            </Button>
          )}
        </PageHeader>
      </div>

      {/* Print-friendly invoice layout */}
      <div className="bg-white rounded-lg border border-border/40 p-8 max-w-4xl mx-auto print:border-none print:shadow-none print:p-0 print:max-w-none">
        {/* Company header */}
        <div className="text-center mb-6 border-b border-border/40 pb-4">
          <h1 className="text-xl font-black uppercase tracking-wide">
            {org?.name || "CÔNG TY"}
          </h1>
          {org?.address && (
            <p className="text-sm text-muted-foreground mt-1">{org.address}</p>
          )}
          {org?.phone && (
            <p className="text-sm text-muted-foreground">ĐT: {org.phone}</p>
          )}
          {org?.tax_code && (
            <p className="text-sm text-muted-foreground">MST: {org.tax_code}</p>
          )}
        </div>

        {/* Invoice title */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-black uppercase">Hóa đơn giá trị gia tăng</h2>
          <p className="text-sm text-muted-foreground mt-1">
            (VAT INVOICE)
          </p>
        </div>

        {/* Invoice info */}
        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p>
              <span className="text-muted-foreground">Số hóa đơn:</span>{" "}
              <span className="font-bold font-mono">{invoice.invoice_number || "-"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Ngày:</span>{" "}
              <span className="font-semibold">
                {invoice.issued_at ? formatDate(invoice.issued_at) : formatDate(invoice.created_at)}
              </span>
            </p>
            {order && (
              <p>
                <span className="text-muted-foreground">Đơn hàng:</span>{" "}
                <span className="font-mono">{order.order_code}</span>
              </p>
            )}
          </div>
          <div>
            <p>
              <span className="text-muted-foreground">Trạng thái:</span>{" "}
              <span className="font-semibold">
                {invoice.status === "issued" ? "Đã phát hành" : invoice.status === "cancelled" ? "Đã hủy" : "Nháp"}
              </span>
            </p>
          </div>
        </div>

        {/* Customer info */}
        <div className="mb-6 border border-border/40 rounded-lg p-4 text-sm">
          <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Thông tin người mua
          </h3>
          <p>
            <span className="text-muted-foreground">Tên đơn vị:</span>{" "}
            <span className="font-bold">{invoice.customer_name}</span>
          </p>
          {invoice.customer_address && (
            <p>
              <span className="text-muted-foreground">Địa chỉ:</span>{" "}
              {invoice.customer_address}
            </p>
          )}
          {invoice.customer_tax_code && (
            <p>
              <span className="text-muted-foreground">Mã số thuế:</span>{" "}
              <span className="font-mono font-semibold">{invoice.customer_tax_code}</span>
            </p>
          )}
        </div>

        {/* Line items */}
        <div className="mb-6">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-foreground/20">
                <th className="py-2 text-left font-bold w-12">STT</th>
                <th className="py-2 text-left font-bold">Tên hàng hóa, dịch vụ</th>
                <th className="py-2 text-center font-bold w-20">ĐVT</th>
                <th className="py-2 text-right font-bold w-16">SL</th>
                <th className="py-2 text-right font-bold w-28">Đơn giá</th>
                <th className="py-2 text-right font-bold w-32">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {lines.length > 0 ? (
                lines.map((line, index) => (
                  <tr key={line.id} className="border-b border-border/40">
                    <td className="py-2 text-left">{index + 1}</td>
                    <td className="py-2 text-left font-medium">
                      {line.product?.name || "-"}
                      {line.product?.sku && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({line.product.sku})
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center">{line.unit_name}</td>
                    <td className="py-2 text-right">{line.quantity}</td>
                    <td className="py-2 text-right">{formatCurrency(line.unit_price)}</td>
                    <td className="py-2 text-right font-semibold">{formatCurrency(line.line_total)}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-b border-border/40">
                  <td className="py-2 text-left">1</td>
                  <td className="py-2 text-left font-medium">
                    Theo hóa đơn {invoice.invoice_number}
                  </td>
                  <td className="py-2 text-center">-</td>
                  <td className="py-2 text-right">1</td>
                  <td className="py-2 text-right">{formatCurrency(invoice.subtotal)}</td>
                  <td className="py-2 text-right font-semibold">{formatCurrency(invoice.subtotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mb-8 flex justify-end">
          <div className="w-72 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cộng tiền hàng:</span>
              <span className="font-semibold">{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Thuế GTGT (10%):</span>
              <span className="font-semibold">{formatCurrency(invoice.vat)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-foreground/20 pt-2 text-base">
              <span className="font-bold">Tổng thanh toán:</span>
              <span className="font-black">{formatCurrency(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Signature lines */}
        <div className="grid grid-cols-2 gap-8 text-center text-sm mt-12 pt-4">
          <div>
            <p className="font-bold">Người mua hàng</p>
            <p className="text-xs text-muted-foreground mb-16">(Ký, ghi rõ họ tên)</p>
          </div>
          <div>
            <p className="font-bold">Người bán hàng</p>
            <p className="text-xs text-muted-foreground mb-16">(Ký, đóng dấu, ghi rõ họ tên)</p>
          </div>
        </div>
      </div>
    </div>
  )
}
