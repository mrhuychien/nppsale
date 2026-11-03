"use client"

/**
 * XUẤT HÀNG — lập hóa đơn bán mới cho một đơn.
 *
 * Vào bằng `/sales-invoices/new?order=<id>`, từ nút "Xuất hàng" ở màn xem
 * nhanh đơn, danh sách đơn, hoặc chi tiết đơn.
 *
 * ⚠ TRANG NÀY CHỈ ĐI LẤY PHẦN ĐẦU ĐƠN. Dòng hàng do `InvoiceEditor` tự
 * nạp qua `get_invoiceable_lines` — RPC đó mới biết phần nào đã xuất và
 * tồn kho còn bao nhiêu. Đọc thêm ở đây là hai nguồn cho cùng một thứ.
 */

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { InvoiceEditor } from "@/components/orders/invoice-editor"
import { PosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posNewInvoiceHref } from "@/lib/nav/pos-preview"
import { DON_CON_XUAT_DUOC, timHoaDonCuaDon, type HoaDonCuaDon } from "@/lib/orders/post-invoice"

interface OrderHead {
  id: string
  order_code: string
  status: string
  customer?: { group_id?: string | null } | null
}

export default function NewSalesInvoicePage() {
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const params = useSearchParams()
  const orderId = params.get("order")

  const [order, setOrder] = useState<OrderHead | null>(null)
  /** Đơn KHÔNG còn xuất được mà đã có hoá đơn — mở lại màn Xuất hàng của đơn đã xuất (chủ nhà 03/11/2026, khách NPP). */
  const [daCo, setDaCo] = useState<HoaDonCuaDon | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!orderId) {
      setErr("Thiếu mã đơn — mở màn này từ nút Xuất hàng trên một đơn.")
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, order_code, status, customer:customers(group_id)")
        .eq("id", orderId)
        .maybeSingle()
      if (cancelled) return
      if (error) setErr(error.message)
      /**
       * ⚠ KHÔNG TÌM THẤY KHÁC VỚI LỖI TRUY VẤN. RLS từ chối trả về 0
       *   dòng kèm `error` null, nên `data` rỗng mà không báo gì là
       *   trường hợp thường gặp nhất — nói rõ thay vì hiện màn trắng.
       */
      else if (!data) setErr("Không tìm thấy đơn này, hoặc bạn không có quyền xem nó.")
      else {
        const don = (data as unknown) as OrderHead
        /* ⚠ ĐƠN ĐÃ XUẤT RỒI (tải lại lúc đang chờ, mở lại tab cũ): nói rõ + đưa nút In, không dựng màn xuất trống. Đọc hỏng
           thì thôi — dựng màn như cũ, máy chủ vẫn chặn xuất lần hai. */
        if (!DON_CON_XUAT_DUOC.includes(don.status)) {
          const hd = await timHoaDonCuaDon(supabase, don.id).catch(() => null)
          if (cancelled) return
          setDaCo(hd)
        }
        setOrder(don)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, orderId])

  if (authLoading || loading) return <Skeleton className="h-96" />

  if (err || !order) {
    return (
      <div className="space-y-4">
        <PageHeader title="Xuất hàng" backHref="/orders" />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {err || "Không mở được đơn."}
        </div>
        <Link href="/orders" className="text-sm text-primary hover:underline">
          Tới danh sách đơn →
        </Link>
      </div>
    )
  }

  if (daCo) {
    return (
      <div className="space-y-4">
        <PosDesktopRedirect to={posNewInvoiceHref(order.id)} />
        <PageHeader title="Xuất hàng" backHref={`/orders/${order.id}`} />
        <div data-testid="nhac-in-hoa-don" role="status" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p>
            <strong>Đơn {order.order_code} đã xuất hoá đơn {daCo.code}</strong> — tờ có thể <strong>CHƯA được in</strong>.
            Kiểm tra lại; chưa in thì bấm In.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/sales-invoices/${daCo.id}/print?auto=1`}
              className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              In hoá đơn
            </Link>
            <Link
              href={`/sales-invoices/${daCo.id}`}
              className="inline-flex h-10 items-center rounded-lg border bg-card px-4 text-sm font-semibold"
            >
              Xem hoá đơn
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ⚠ Máy tính thì xuất hàng trên màn `/pos` — chủ nhà chốt 23/09/2026
          ("Màn xuất hàng → POS"). Chặn ở CỬA như `/sell` và Sửa hóa đơn:
          mọi nút "Xuất hàng" (chi tiết đơn, danh sách đơn) đều đi qua đây. */}
      <PosDesktopRedirect to={posNewInvoiceHref(order.id)} />
      <InvoiceEditor
        orderId={order.id}
        orderCode={order.order_code}
        priceGroupId={order.customer?.group_id ?? null}
        backHref={`/orders/${order.id}`}
      />
    </>
  )
}
