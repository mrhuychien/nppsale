"use client"

import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton } from "@/components/ui/print-button"
import { useLeaveAfterPrint } from "@/hooks/use-leave-after-print"
import { SalesInvoice, type SalesInvoiceLine } from "@/components/printing/sales-invoice"
import type { Invoice, SalesOrder, SalesOrderLine } from "@/types"

/** Đơn hàng kèm hai thứ mẫu in cần: SĐT khách và người bán hàng. */
interface OrderForPrint extends Omit<SalesOrder, "customer" | "sales_user"> {
  customer?: { phone?: string | null } | null
  sales_user?: { full_name?: string | null; phone?: string | null } | null
}

export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>()
  useAuth()
  const { loading: authLoading } = useRoleGuard("invoices")
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [order, setOrder] = useState<OrderForPrint | null>(null)
  const [lines, setLines] = useState<SalesOrderLine[]>([])
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  /**
   * ⚠ IN XONG LÀ RỜI MÀN IN (chủ nhà chốt 20/09/2026) — xem
   *   `useLeaveAfterPrint`. Màn này không tự in, nhưng vẫn là một chỗ đi
   *   qua: bỏ người dùng lại trên tờ giấy đã in là bắt họ tự nghĩ ra
   *   đường về.
   */
  useLeaveAfterPrint(!loading)

  const fetchData = useCallback(async () => {
    setLoading(true)

    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id, org_id, order_id, sales_invoice_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at")
      .eq("id", id)
      .single()
    if (invErr) console.error("[id/print] truy vấn lỗi:", invErr.message)

    if (!inv) {
      setLoading(false)
      return
    }

    const invoiceData = inv as Invoice
    setInvoice(invoiceData)

    // Fetch organization
    if (invoiceData.org_id) {
      /**
       * ⚠ QUA `loadOrgHeader`. `address`/`phone`/`tax_code` KHÔNG phải
       *   cột của `organizations` — chúng nằm trong `settings` jsonb.
       *   Hỏi thẳng thì câu truy vấn lỗi, lỗi bị nuốt vào console, và tờ
       *   in ra thiếu hẳn phần đầu mà không có dấu hiệu nào trên màn.
       */
      setOrg(await loadOrgHeader(supabase, invoiceData.org_id))
    }

    // Fetch order lines if linked to an order
    if (invoiceData.order_id) {
      const { data: orderData, error: orderDataErr } = await supabase
        .from("sales_orders")
        .select("id, order_code, customer:customers(phone), sales_user:users!sales_orders_sales_user_id_fkey(full_name, phone)")
        .eq("id", invoiceData.order_id)
        .single()
      if (orderDataErr) console.error("[id/print] truy vấn lỗi:", orderDataErr.message)
      if (orderData) setOrder((orderData as unknown) as OrderForPrint)

      /**
       * ⚠ DÒNG HÀNG ĐỌC TỪ HÓA ĐƠN BÁN KHI CÓ (workflow v2b). Một đơn có
       *   thể xuất làm hai đợt, mỗi đợt một hoá đơn điện tử. Đọc theo ĐƠN
       *   thì cả hai tờ in ra đều liệt kê toàn bộ hàng của đơn, và tờ
       *   khách cầm ghi nhiều hơn thứ thực sự có trên xe.
       *
       * ⚠ NHÁNH ĐỌC THEO ĐƠN GIỮ LẠI cho hoá đơn điện tử lập trước v2b —
       *   chúng chỉ có `order_id`. Bỏ đi là mọi hoá đơn cũ in ra bảng
       *   trắng.
       */
      if (invoiceData.sales_invoice_id) {
        const { data: siLines, error: siErr } = await supabase
          .from("sales_invoice_lines")
          .select("id, unit_name, quantity, unit_price, line_discount, line_total, product:products(*)")
          .eq("invoice_id", invoiceData.sales_invoice_id)
          .order("sort_order", { ascending: true })
        if (siErr) console.error("[id/print] truy vấn lỗi:", siErr.message)
        if (siLines) setLines(siLines as unknown as SalesOrderLine[])
      } else {
        const { data: linesData, error: linesDataErr } = await supabase
          .from("sales_order_lines")
          .select("id, unit_name, quantity, unit_price, line_discount, line_total, product:products(*)")
          .eq("order_id", invoiceData.order_id)
        if (linesDataErr) console.error("[id/print] truy vấn lỗi:", linesDataErr.message)
        if (linesData) setLines(linesData as unknown as SalesOrderLine[])
      }
    }

    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!invoice) return <div className="text-center py-12 text-muted-foreground">Không tìm thấy hóa đơn</div>

  const canPrint = invoice.status === "draft" || invoice.status === "issued"

  /**
   * Dòng hàng cho mẫu in.
   *
   * ⚠ HOÁ ĐƠN KHÔNG NỐI ĐƠN THÌ VẪN PHẢI IN ĐƯỢC. Khi `order_id` trống
   * (hoá đơn nhập tay), `lines` rỗng — dựng một dòng gộp từ `subtotal`
   * thay vì in ra một bảng trắng.
   */
  const printLines: SalesInvoiceLine[] =
    lines.length > 0
      ? lines.map((l) => ({
          id: l.id,
          name: l.product?.name || "—",
          spec: l.product?.sku || null,
          unitName: l.unit_name,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unit_price) || 0,
          discount: Number(l.line_discount) || 0,
          lineTotal: Number(l.line_total) || 0,
        }))
      : [
          {
            id: "tong",
            name: `Theo hóa đơn ${invoice.invoice_number || ""}`.trim(),
            spec: order?.order_code ? `đơn ${order.order_code}` : null,
            unitName: "—",
            quantity: 1,
            unitPrice: Number(invoice.subtotal) || 0,
            discount: 0,
            lineTotal: Number(invoice.subtotal) || 0,
          },
        ]

  const issuedAt = invoice.issued_at
    ? new Date(invoice.issued_at)
    : invoice.created_at
      ? new Date(invoice.created_at)
      : null

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="In hóa đơn bán hàng"
          description={`Hóa đơn ${invoice.invoice_number || ""}`}
          backHref={`/invoices/${id}`}
        >
          {/* ⚠ A4, KHÔNG PHẢI A5 MẶC ĐỊNH. Bảy cột ở khổ A5 thì chữ còn
              8pt và hai cột tiền dính vào nhau. */}
          {canPrint && <PrintButton label="In hóa đơn" defaultPaper="A4" />}
        </PageHeader>
      </div>

      <div className="rounded-lg border border-border/40 bg-white p-8 print:border-none print:p-0">
        <SalesInvoice
          org={{ name: org.name, address: org.address, phone: org.phone }}
          invoiceNumber={invoice.invoice_number || ""}
          issuedAt={issuedAt}
          customerName={invoice.customer_name}
          customerAddress={invoice.customer_address}
          customerPhone={order?.customer?.phone}
          salesPersonName={order?.sales_user?.full_name}
          salesPersonPhone={order?.sales_user?.phone}
          lines={printLines}
          /* ⚠ Chỉ truyền `total`. Mẫu không có dòng thuế (chủ NPP chốt),
             và `total` đã gồm thuế — mẫu in tự quy các dòng về giá đã
             gồm thuế để cột tiền cộng khớp. Xem `sales-invoice.tsx`. */
          total={Number(invoice.total) || 0}
        />
      </div>
    </div>
  )
}
