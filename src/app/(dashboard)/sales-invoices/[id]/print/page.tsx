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

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton, printWithPaper } from "@/components/ui/print-button"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import {
  creditOnInvoice, showCreditOnPrint, type InvoiceReturnRow,
} from "@/lib/orders/invoice-credit"
import { Skeleton } from "@/components/ui/skeleton"
import { SalesInvoice, type SalesInvoiceLine } from "@/components/printing/sales-invoice"
import { invoiceAddressOf } from "@/lib/customers/address"

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
    // ⚠ PHƯỜNG PHẢI CÓ TRÊN TỜ IN (chủ nhà chốt). "47 Cẩm" không đủ để ai
    //   tìm ra cửa hàng; `invoiceAddressOf` ghép bốn cột lại.
    ward?: string | null
    district?: string | null
    province?: string | null
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
  const params = useSearchParams()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const [inv, setInv] = useState<InvoiceRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [invReturns, setInvReturns] = useState<InvoiceReturnRow[]>([])
  /**
   * ⚠ ĐÃ PHÁT HÀNH HÓA ĐƠN ĐIỆN TỬ THÌ TỜ IN KHÔNG ĐƯỢC ĐỔI SỐ. Nó phải
   *   khớp từng con số với tờ đã gửi cơ quan thuế; thêm dòng trừ là hai
   *   tờ cùng một số hóa đơn mang hai con số khác nhau.
   */
  const [eInvoiceIssued, setEInvoiceIssued] = useState(false)
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [invRes, lineRes, retRes, eRes] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select(
          "id, org_id, invoice_code, invoice_date, status, total, created_at, order_id, customer:customers(store_name, billing_name, billing_address, address, ward, district, province, phone), sales_user:users!sales_invoices_sales_user_id_fkey(full_name, phone), order:sales_orders(order_code)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("sales_invoice_lines")
        .select("id, unit_name, quantity, unit_price, line_discount, line_total, product:products(name, sku)")
        .eq("invoice_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("returns")
        .select("id, status, credit_note_amount, credit_with_invoice")
        .eq("invoice_id", id),
      supabase
        .from("invoices")
        .select("misa_inv_no")
        .eq("sales_invoice_id", id)
        .maybeSingle(),
    ])
    if (invRes.error) console.error("[sales-invoices/print] truy vấn lỗi:", invRes.error.message)
    if (lineRes.error) console.error("[sales-invoices/print] truy vấn lỗi:", lineRes.error.message)

    const row = ((invRes.data as unknown) as InvoiceRow) || null
    setInv(row)
    setLines(((lineRes.data as unknown) as LineRow[]) || [])
    if (retRes.error) console.error("[sales-invoices/print] truy vấn lỗi:", retRes.error.message)
    setInvReturns(((retRes.data as unknown) as InvoiceReturnRow[]) || [])
    setEInvoiceIssued(!!(eRes.data as { misa_inv_no?: string | null } | null)?.misa_inv_no)

    if (row?.org_id) {
      /**
       * ⚠ QUA `loadOrgHeader`, KHÔNG HỎI THẲNG `address`/`phone`. Hai cột
       *   đó KHÔNG TỒN TẠI trên bảng `organizations` — chúng nằm trong
       *   `settings` jsonb. Bản cũ hỏi thẳng nên câu truy vấn lỗi, mã
       *   nguồn nuốt lỗi vào `console.error`, và tờ hóa đơn in ra thiếu
       *   hẳn phần đầu: không tên công ty, không địa chỉ, không điện
       *   thoại. Không toast, không màn đỏ — chỉ một tờ giấy thiếu đi
       *   tới tay khách.
       */
      setOrg(await loadOrgHeader(supabase, row.org_id))
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  /**
   * IN NGAY khi tới từ màn soạn (`?auto=1`).
   *
   * ⚠ CHỜ DỮ LIỆU XONG MỚI IN. Gọi lúc còn `loading` là in ra một trang
   *   toàn khung xương — trình duyệt không đợi React vẽ xong.
   *
   * ⚠ CHỈ MỘT LẦN. `window.print()` khoá luồng cho tới khi người dùng
   *   đóng hộp thoại; render lại sau đó mà không gác thì cửa sổ in bật
   *   lên lần nữa, và người dùng không thoát ra được.
   */
  const printedRef = useRef(false)
  useEffect(() => {
    if (loading || !inv || printedRef.current) return
    if (params.get("auto") !== "1") return
    printedRef.current = true
    printWithPaper("A5")
  }, [loading, inv, params])

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

  /**
   * ⚠ CHỦ NHÀ CHỐT HIỆN TRÊN BẢN IN, nhưng chốt đó dừng ở hóa đơn ĐÃ
   *   PHÁT HÀNH ĐIỆN TỬ: tờ in khi đó phải khớp từng con số với tờ đã
   *   gửi cơ quan thuế.
   */
  const printCredit = showCreditOnPrint({
    credit: creditOnInvoice(invReturns),
    eInvoiceIssued,
  })
    ? creditOnInvoice(invReturns)
    : 0

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
            ⚠ A5 MẶC ĐỊNH (chủ nhà chốt). Trước đây để A4 vì bảy cột ở
              khổ A5 thì chữ rơi xuống 8pt; nhưng giấy A5 mới là thứ nằm
              trong máy in của kho, và nhà phân phối in tờ này mỗi ngày
              vài chục lần. Ai cần A4 thì vẫn chọn được ở dropdown.
          */}
          <PrintButton label="In hóa đơn" defaultPaper="A5" />
        </PageHeader>
      </div>

      <div className="rounded-lg border border-border/40 bg-white p-8 print:border-none print:p-0">
        <SalesInvoice
          org={{ name: org.name, address: org.address, phone: org.phone }}
          invoiceNumber={inv.invoice_code}
          issuedAt={inv.invoice_date ? new Date(inv.invoice_date) : null}
          customerName={inv.customer?.billing_name || inv.customer?.store_name || ""}
          customerAddress={invoiceAddressOf(inv.customer ?? {})}
          customerPhone={inv.customer?.phone}
          salesPersonName={inv.sales_user?.full_name}
          salesPersonPhone={inv.sales_user?.phone}
          lines={printLines}
          total={Number(inv.total) || 0}
          returnCredit={printCredit}
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
