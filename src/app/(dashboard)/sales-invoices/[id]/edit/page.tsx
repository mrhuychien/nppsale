"use client"

/**
 * SỬA HÓA ĐƠN BÁN — cùng một màn với lúc lập.
 *
 * ⚠ VỀ KỸ THUẬT KHÔNG CÓ "SỬA". `reissue_invoice` huỷ bản cũ rồi lập bản
 * mới trong MỘT giao dịch: kho hoàn về đúng lô đã lấy, rồi trừ lại theo
 * số mới. Màn này vì thế mở ra với đúng các dòng của BẢN CŨ, không phải
 * với "phần còn lại của đơn" — phần còn lại chưa tính tới việc bản cũ
 * sắp được hoàn về.
 */

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { InvoiceEditor } from "@/components/orders/invoice-editor"
import { PosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posEditInvoiceHref } from "@/lib/nav/pos-preview"
import type { ReissueSeedLine } from "@/lib/orders/invoice-editor"

interface LineRow {
  order_line_id: string | null
  product_id: string
  unit_name: string
  conversion_factor: number
  quantity: number
  unit_price: number
  line_discount: number
  vat_rate: number
  is_exchange: boolean
  note: string | null
  product?: { name?: string | null; sku?: string | null } | null
}

interface InvRow {
  id: string
  invoice_code: string
  status: string
  order_id: string
  order?: { order_code?: string | null } | null
  customer?: { group_id?: string | null } | null
}

export default function EditSalesInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()

  const [inv, setInv] = useState<InvRow | null>(null)
  const [seed, setSeed] = useState<ReissueSeedLine[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    ;(async () => {
      const [invRes, lineRes] = await Promise.all([
        supabase
          .from("sales_invoices")
          .select(
            "id, invoice_code, status, order_id, order:sales_orders(order_code), customer:customers(group_id)"
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("sales_invoice_lines")
          .select(
            "order_line_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_discount, vat_rate, is_exchange, note, product:products(name, sku)"
          )
          .eq("invoice_id", id)
          .order("sort_order", { ascending: true }),
      ])
      if (cancelled) return
      const e = invRes.error || lineRes.error
      if (e) setErr(e.message)
      else if (!invRes.data)
        setErr("Không tìm thấy hóa đơn này, hoặc bạn không có quyền xem nó.")
      else {
        const row = (invRes.data as unknown) as InvRow
        /**
         * ⚠ HÓA ĐƠN ĐÃ HUỶ THÌ KHÔNG LẬP LẠI ĐƯỢC. RPC cũng chặn, nhưng
         *   để người dùng soạn xong cả màn rồi mới nhận mã lỗi là phí
         *   công họ — nói ngay từ đầu.
         */
        if (row.status !== "posted") {
          setErr(`Hóa đơn ${row.invoice_code} đang ở trạng thái "${row.status}" — chỉ sửa được hóa đơn đã xuất.`)
        } else {
          setInv(row)
          setSeed(
            (((lineRes.data as unknown) as LineRow[]) || []).map((l) => ({
              orderLineId: l.order_line_id,
              productId: l.product_id,
              unitName: l.unit_name,
              quantity: Number(l.quantity || 0),
              unitPrice: Number(l.unit_price || 0),
              lineDiscount: Number(l.line_discount || 0),
              vatRate: Number(l.vat_rate || 0),
              isExchange: l.is_exchange,
              conversionFactor: Number(l.conversion_factor || 1),
              productName: l.product?.name || "—",
              sku: l.product?.sku || null,
              note: l.note,
            }))
          )
        }
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, id])

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (err || !inv) {
    return (
      <div className="space-y-4">
        <PageHeader title="Sửa hóa đơn" backHref={`/sales-invoices/${id}`} />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {err || "Không mở được hóa đơn."}
        </div>
        <Link href={`/sales-invoices/${id}`} className="text-sm text-primary hover:underline">
          Về chi tiết hóa đơn →
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* ⚠ Máy tính thì sửa hóa đơn trên màn `/pos` — chủ nhà chốt
          22/09/2026 ("Sửa hóa đơn cũng phải ra pos chứ nhỉ"). Xem
          `@/lib/nav/pos-preview` về việc vì sao chặn ở CỬA chứ không
          sửa từng cái nút. */}
      <PosDesktopRedirect to={posEditInvoiceHref(id)} />
      <InvoiceEditor
        orderId={inv.order_id}
        orderCode={inv.order?.order_code || ""}
        priceGroupId={inv.customer?.group_id ?? null}
        reissueOf={{ invoiceId: inv.id, invoiceCode: inv.invoice_code, lines: seed }}
        priceWarnPct={user?.price_edit_max_increase_pct ?? 10}
        backHref={`/sales-invoices/${inv.id}`}
      />
    </>
  )
}
