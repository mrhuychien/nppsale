"use client"

/**
 * IN PHIẾU TRẢ HÀNG — chủ nhà 24/09/2026: "Màn Hóa đơn, Đơn hàng, Trả hàng,
 * in đơn tại chỗ". Khuôn giấy: `ReturnSlip`. `?auto=1` thì bật thẳng hộp
 * thoại in (POS gọi trang này trong khung ẩn — xem `inTaiCho`).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton, moHopThoaiIn } from "@/components/ui/print-button"
import { useLeaveAfterPrint } from "@/hooks/use-leave-after-print"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { Skeleton } from "@/components/ui/skeleton"
import { ReturnSlip, type ReturnSlipLine } from "@/components/printing/return-slip"
import { invoiceAddressOf } from "@/lib/customers/address"
import { mocInPhieuTra } from "@/lib/printing/doc-stamp"
import { RETURN_REASONS } from "@/lib/constants"

interface ReturnRow {
  id: string
  org_id: string
  reason: string | null
  notes: string | null
  credit_note_amount: number | null
  created_at: string | null
  customer?: {
    store_name?: string | null
    billing_name?: string | null
    address?: string | null
    ward?: string | null
    district?: string | null
    province?: string | null
    phone?: string | null
  } | null
  requester?: { full_name?: string | null } | null
  order?: { order_code?: string | null } | null
  invoice?: { invoice_code?: string | null } | null
}

interface LineRow {
  id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number | null
  is_exchange: boolean | null
  note: string | null
  reason: string | null
  product?: { name?: string | null; sku?: string | null } | null
}

const nhanLyDo = (v: string | null | undefined) =>
  v ? RETURN_REASONS.find((r) => r.value === v)?.label || v : null

export default function ReturnPrintPage() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const { loading: authLoading } = useRoleGuard("returns")
  const supabase = createClient()
  const [ret, setRet] = useState<ReturnRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [nvBan, setNvBan] = useState<string | null>(null)
  const [ngayTra, setNgayTra] = useState<string | null>(null)
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [retRes, lineRes, nvRes, ngayRes] = await Promise.all([
      supabase
        .from("returns")
        .select(
          "id, org_id, reason, notes, credit_note_amount, created_at, customer:customers(store_name, billing_name, address, ward, district, province, phone), requester:users!returns_requested_by_fkey(full_name), order:sales_orders(order_code), invoice:sales_invoices(invoice_code)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("return_lines")
        .select("id, unit_name, quantity, unit_price, line_total, is_exchange, note, reason, product:products(name, sku)")
        .eq("return_id", id),
      /* ⚠ Hỏi riêng (mig 160) — cột chưa có thì chỉ thiếu một dòng, không trắng tờ in. */
      supabase.from("returns").select("seller:users!returns_sales_user_id_fkey(full_name)").eq("id", id).maybeSingle(),
      /* Ngày chứng từ (mig 188) — hỏi riêng cùng lý do; chưa có cột thì in ngày lập. */
      supabase.from("returns").select("return_date").eq("id", id).maybeSingle(),
    ])
    if (retRes.error) console.error("[returns/print] truy vấn lỗi:", retRes.error.message)
    if (lineRes.error) console.error("[returns/print] truy vấn lỗi:", lineRes.error.message)
    const row = (retRes.data as unknown as ReturnRow) || null
    setRet(row)
    setLines((lineRes.data as unknown as LineRow[]) || [])
    setNgayTra(ngayRes.error ? null : ((ngayRes.data as { return_date?: string | null } | null)?.return_date ?? null))
    setNvBan(nvRes.error ? null : (nvRes.data as { seller?: { full_name?: string | null } | null } | null)?.seller?.full_name ?? null)
    if (row?.org_id) setOrg(await loadOrgHeader(supabase, row.org_id))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  /* In ngay khi `?auto=1` — chờ dữ liệu, chỉ một lần (xem màn in hóa đơn). */
  const printedRef = useRef(false)
  useEffect(() => {
    if (loading || !ret || printedRef.current) return
    if (params.get("auto") !== "1") return
    printedRef.current = true
    moHopThoaiIn()
  }, [loading, ret, params])

  useLeaveAfterPrint(!loading)

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (!ret) return <PageHeader title="Không tìm thấy phiếu trả" backHref="/returns" />

  const doiDong = (l: LineRow): ReturnSlipLine => ({
    id: l.id,
    name: l.product?.name || "Sản phẩm đã xoá",
    sku: l.product?.sku ?? null,
    unitName: l.unit_name,
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unit_price) || 0,
    lineTotal: Math.max(0, Number(l.line_total) || 0),
    /* Lý do trùng lý do phiếu thì khỏi lặp trên từng dòng. */
    reason: !l.is_exchange && l.reason && l.reason !== ret.reason ? nhanLyDo(l.reason) : null,
    note: l.note,
  })
  const tra = lines.filter((l) => !l.is_exchange).map(doiDong)
  const doi = lines.filter((l) => l.is_exchange).map(doiDong)
  const credit = ret.credit_note_amount ?? tra.reduce((s, l) => s + l.lineTotal, 0)
  const refLabel = ret.invoice?.invoice_code
    ? `HĐ ${ret.invoice.invoice_code}`
    : ret.order?.order_code
      ? `đơn ${ret.order.order_code}`
      : null

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader title="In phiếu trả hàng" backHref={`/returns/${id}`}>
          <PrintButton label="In phiếu trả" />
        </PageHeader>
      </div>
      <div className="rounded-lg border border-border/40 bg-white p-8 print:border-none print:p-0">
        <ReturnSlip
          org={{ name: org.name, address: org.address, phone: org.phone }}
          issuedAt={mocInPhieuTra(ret.created_at, ngayTra).at}
          issuedHasTime={mocInPhieuTra(ret.created_at, ngayTra).hasTime}
          refLabel={refLabel}
          customerName={ret.customer?.billing_name || ret.customer?.store_name || ""}
          customerAddress={invoiceAddressOf(ret.customer ?? {})}
          customerPhone={ret.customer?.phone}
          salesPersonName={nvBan}
          requesterName={ret.requester?.full_name}
          reason={nhanLyDo(ret.reason)}
          returnLines={tra}
          exchangeLines={doi}
          credit={credit}
          notes={ret.notes}
        />
      </div>
    </div>
  )
}
