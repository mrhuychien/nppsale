"use client"

/**
 * IN HÓA ĐƠN BÁN.
 *
 * ⚠ NGUỒN LÀ DÒNG HÓA ĐƠN, KHÔNG PHẢI DÒNG ĐƠN. Đơn xuất làm hai đợt thì
 * in theo đơn là mỗi tờ đều liệt kê toàn bộ hàng của đơn — khách nhận
 * một tờ giấy ghi nhiều hơn thứ thực sự có trên xe.
 *
 * ⚠ MẪU KHÔNG CÓ DÒNG THUẾ (chủ nhà chốt). `total` đã gồm thuế, và
 * `SalesInvoice` tự quy các dòng về giá đã gồm thuế để cột tiền cộng
 * khớp — xem `grossUpLines` trong `components/printing/sales-invoice.tsx`.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton } from "@/components/ui/print-button"
import { Skeleton } from "@/components/ui/skeleton"
import { SalesInvoice, type SalesInvoiceLine } from "@/components/printing/sales-invoice"

interface InvoiceRow {
  id: string
  org_id: string
  invoice_code: string
  invoice_date: string
  status: string
  total: number
  created_at: string | null
  order_id: string
  customer?: {
    store_name?: string | null
    billing_name?: string | null
    billing_address?: string | null
    address?: string | null
    phone?: string | null
  } | null
  sales_user?: { full_name?: string | null; phone?: string | null } | null
  order?: { order_code?: string | null } | null
}

interface LineRow {
  id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  product?: { name?: string | null; sku?: string | null } | null
}

export default function SalesInvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const [inv, setInv] = useState<InvoiceRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [org, setOrg] = useState<{ name?: string | null; address?: string | null; phone?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [invRes, lineRes] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select(
          "id, org_id, invoice_code, invoice_date, status, total, created_at, order_id, customer:customers(store_name, billing_name, billing_address, address, phone), sales_user:users!sales_invoices_sales_user_id_fkey(full_name, phone), order:sales_orders(order_code)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("sales_invoice_lines")
        .select("id, unit_name, quantity, unit_price, line_discount, line_total, product:products(name, sku)")
        .eq("invoice_id", id)
        .order("sort_order", { ascending: true }),
    ])
    if (invRes.error) console.error("[sales-invoices/print] truy vấn lỗi:", invRes.error.message)
    if (lineRes.error) console.error("[sales-invoices/print] truy vấn lỗi:", lineRes.error.message)

    const row = ((invRes.data as unknown) as InvoiceRow) || null
    setInv(row)
    setLines(((lineRes.data as unknown) as LineRow[]) || [])

    if (row?.org_id) {
      const { data: o, error: oErr } = await supabase
        .from("organizations")
        .select("name, address, phone")
        .eq("id", row.org_id)
        .maybeSingle()
      if (oErr) console.error("[sales-invoices/print] truy vấn lỗi:", oErr.message)
      setOrg((o as typeof org) || null)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!inv) {
    return <PageHeader title="Không tìm thấy hóa đơn" backHref="/sales-invoices" />
  }

  const printLines: SalesInvoiceLine[] = lines.map((l) => ({
    id: l.id,
    name: l.product?.name || "—",
    spec: l.product?.sku || null,
    unitName: l.unit_name,
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unit_price) || 0,
    discount: Number(l.line_discount) || 0,
    lineTotal: Number(l.line_total) || 0,
  }))

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="In hóa đơn bán"
          description={`Hóa đơn ${inv.invoice_code}`}
          backHref={`/sales-invoices/${id}`}
        >
          {/*
            ⚠ HÓA ĐƠN ĐÃ HUỶ VẪN IN ĐƯỢC, và có dòng chữ nói rõ. Chặn in
              thì người đang cầm tờ cũ trong tay không có cách nào đối
              chiếu; in ra một tờ trông y như tờ còn hiệu lực thì tệ hơn.
            ⚠ A4, KHÔNG PHẢI A5 MẶC ĐỊNH. Bảy cột ở khổ A5 thì chữ còn 8pt
              và hai cột tiền dính vào nhau.
          */}
          <PrintButton label="In hóa đơn" defaultPaper="A4" />
        </PageHeader>
      </div>

      <div className="rounded-lg border border-border/40 bg-white p-8 print:border-none print:p-0">
        <SalesInvoice
          org={{ name: org?.name, address: org?.address, phone: org?.phone }}
          invoiceNumber={inv.invoice_code}
          issuedAt={inv.invoice_date ? new Date(inv.invoice_date) : null}
          customerName={inv.customer?.billing_name || inv.customer?.store_name || ""}
          customerAddress={inv.customer?.billing_address || inv.customer?.address}
          customerPhone={inv.customer?.phone}
          salesPersonName={inv.sales_user?.full_name}
          salesPersonPhone={inv.sales_user?.phone}
          lines={printLines}
          total={Number(inv.total) || 0}
          footerNote={
            inv.status === "posted"
              ? inv.order?.order_code
                ? `Theo đơn ${inv.order.order_code}`
                : null
              : "⚠ HÓA ĐƠN ĐÃ HUỶ — không có giá trị thanh toán."
          }
        />
      </div>
    </div>
  )
}
