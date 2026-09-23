"use client"

/**
 * HÓA ĐƠN BÁN — chi tiết.
 *
 * ⚠ HÓA ĐƠN KHÔNG SỬA TẠI CHỖ. Nút "Sửa hóa đơn" mở đúng dialog Xuất
 * hàng ở chế độ lập lại: `reissue_invoice` huỷ bản cũ rồi lập bản mới
 * trong MỘT giao dịch, kho hoàn về đúng lô đã lấy rồi mới trừ lại theo
 * số mới. Sửa tại chỗ thì phải tính chênh lệch kho — và đó chính là thứ
 * workflow v2b sinh ra để bỏ đi.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowRight, FileText, Pencil, Printer, Receipt, Undo2, XCircle,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { errorMessage } from "@/lib/errors"
import { PageHeader } from "@/components/ui/page-header"
import {
  DetailHero, StatusPill, DetailColumns, DetailCard, DetailRow, DetailTimeline,
  DetailCustomerCard, type TimelineStep,
} from "@/components/detail/detail-chrome"
import { CustomerQuickView } from "@/components/customers/customer-quick-view"
import { InvoiceMoneySummary } from "@/components/orders/invoice-money-summary"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cancelInvoice } from "@/lib/orders/post-invoice"
import { ensureEInvoiceRow, publishEInvoice } from "@/lib/einvoice/publish"
import { formatCurrency, formatDate } from "@/lib/utils"
import { INVOICE_STATUS_MAP } from "@/lib/constants"
import { type InvoiceReturnRow } from "@/lib/orders/invoice-credit"

interface InvoiceRow {
  id: string
  org_id: string
  invoice_code: string
  invoice_date: string
  status: string
  subtotal: number
  vat: number
  total: number
  payment_terms: string | null
  due_date: string | null
  notes: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  stock_entry_id: string | null
  replaced_from: string | null
  replaced_by: string | null
  order_id: string
  customer_id: string
  sales_user?: { full_name?: string | null } | null
  customer?: {
    store_name?: string | null
    billing_name?: string | null
    billing_address?: string | null
    address?: string | null
    tax_code?: string | null
    phone?: string | null
  } | null
  /**
   * ⚠ GHI CHÚ CHUNG CỦA ĐƠN ĐỌC THẲNG TỪ ĐƠN. `post_invoice` chỉ lưu ghi
   * chú người dùng gõ lúc xuất (`sales_invoices.notes`); ghi chú của đơn
   * ở lại `sales_orders.notes`. Đọc thẳng từ đó thì mọi hóa đơn CŨ cũng
   * hiện ra — chép sang lúc xuất chỉ cứu được hóa đơn lập từ nay về sau.
   */
  order?: { order_code?: string | null; notes?: string | null } | null
}

interface LineRow {
  id: string
  order_line_id: string | null
  product_id: string
  unit_name: string
  conversion_factor: number
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  vat_rate: number
  is_exchange: boolean
  note: string | null
  product?: { name?: string | null; sku?: string | null } | null
}

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("orders")
  const supabase = createClient()
  const { toast } = useToast()

  const [inv, setInv] = useState<InvoiceRow | null>(null)
  /** Mã khách đang mở trong modal xem nhanh — `null` là đóng. */
  const [quickCustomer, setQuickCustomer] = useState<string | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [eInvoice, setEInvoice] = useState<{ id: string; misa_inv_no: string | null; misa_status: string | null } | null>(null)
  /** Phiếu trả gắn hóa đơn này — nguồn của khoản trừ. */
  const [invReturns, setInvReturns] = useState<InvoiceReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [invRes, lineRes, eRes, retRes] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select(
          "id, org_id, invoice_code, invoice_date, status, subtotal, vat, total, payment_terms, due_date, notes, cancel_reason, cancelled_at, stock_entry_id, replaced_from, replaced_by, order_id, customer_id, customer:customers(store_name, billing_name, billing_address, address, tax_code, phone), sales_user:users!sales_invoices_sales_user_id_fkey(full_name), order:sales_orders(order_code, notes)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("sales_invoice_lines")
        .select(
          "id, order_line_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_discount, line_total, vat_rate, is_exchange, note, product:products(name, sku)"
        )
        .eq("invoice_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("invoices")
        .select("id, misa_inv_no, misa_status")
        .eq("sales_invoice_id", id)
        /* ⚠ `sales_invoice_id` KHÔNG UNIQUE — hai lượt phát hành chạy đua
           sinh hai dòng, và `.maybeSingle()` trên hai dòng là PGRST116 →
           màn báo "chưa có hoá đơn điện tử". Lấy tờ ĐÃ CÓ SỐ trước, rồi
           tờ mới nhất. */
        .order("misa_inv_no", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      /**
       * ⚠ NẠP CẢ PHIẾU CHƯA HOÀN THÀNH, rồi lọc ở phép cộng. Hỏi thẳng
       *   `status = 'completed'` thì màn không biết là có phiếu đang chờ
       *   — mà đó đúng là thứ người xem cần thấy trước khi đi đòi tiền.
       */
      supabase
        .from("returns")
        .select("id, status, credit_note_amount, credit_with_invoice, created_at, reason")
        .eq("invoice_id", id)
        .order("created_at", { ascending: true }),
    ])
    const err = invRes.error || lineRes.error || eRes.error || retRes.error
    if (err) console.error("[sales-invoices/id] truy vấn lỗi:", err.message)
    setInv(((invRes.data as unknown) as InvoiceRow) || null)
    setLines(((lineRes.data as unknown) as LineRow[]) || [])
    setEInvoice(((eRes.data as unknown) as typeof eInvoice) || null)
    setInvReturns(((retRes.data as unknown) as InvoiceReturnRow[]) || [])
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
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!inv) {
    return (
      <div className="space-y-4">
        <PageHeader title="Không tìm thấy hóa đơn" backHref="/sales-invoices" />
      </div>
    )
  }

  const canManage = !!user && hasPermission(user.role, "orders", "approve")
  const posted = inv.status === "posted"
  /**
   * ⚠ HOÁ ĐƠN ĐIỆN TỬ ĐÃ PHÁT HÀNH LÀ MỘT KHOÁ CỨNG. RPC `cancel_invoice`
   * cũng chặn (`LOCKED_EINVOICE`); mờ nút ở đây để người dùng không bấm
   * rồi nhận một mã lỗi, chứ không phải để thay chỗ chặn.
   */
  const eInvoiceIssued = !!eInvoice?.misa_inv_no
  const publish = async () => {
    setPublishing(true)
    try {
      const eid = await ensureEInvoiceRow(supabase, {
        id: inv.id,
        org_id: inv.org_id,
        order_id: inv.order_id,
        invoice_code: inv.invoice_code,
        status: inv.status,
        subtotal: inv.subtotal,
        vat: inv.vat,
        total: inv.total,
        customer: inv.customer,
      })
      const r = await publishEInvoice(eid)
      toast({
        title: r.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${r.invNo ? `Số HĐ: ${r.invNo} · ` : ""}Mã tra cứu: ${r.lookupCode || "—"}${r.sandbox ? " (sandbox)" : ""}`,
      })
      fetchData()
    } catch (e) {
      toast({ title: "Không phát hành được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setPublishing(false)
    }
  }


  const statusLabel = INVOICE_STATUS_MAP[inv.status]?.label ?? inv.status
  /**
   * ⚠ HAI TRẠNG THÁI, HAI MÀU — không dùng chung một tông xám. Hóa đơn
   * đã huỷ nằm cạnh một hóa đơn còn hiệu lực trong danh sách; nhìn giống
   * nhau là người tra sổ đọc nhầm tờ.
   */
  const statusTone = posted
    ? { bg: "#e7f6ec", fg: "#036b45", accent: "#12b76a" }
    : { bg: "#fdeceb", fg: "#8f231c", accent: "#f04438" }

  const summaryLine = [
    `Xuất ${formatDate(inv.invoice_date)}`,
    `${lines.length} mặt hàng`,
    inv.customer?.store_name || null,
    inv.sales_user?.full_name ? `NVBH ${inv.sales_user.full_name}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  /**
   * ⚠ TIẾN TRÌNH NÓI THẬT, kể cả khi bước sau chưa xảy ra. Vẽ mốc chưa
   * tới giống mốc đã xong là người đọc tưởng hóa đơn đã phát hành thuế —
   * và đó là loại hiểu nhầm kéo theo một cuộc gọi cho kế toán.
   */
  const timeline: TimelineStep[] = [
    {
      label: "Lập hóa đơn",
      detail: `${formatDate(inv.invoice_date)}${inv.order?.order_code ? ` · theo đơn ${inv.order.order_code}` : ""}`,
      state: "done",
    },
    {
      label: "Xuất kho",
      detail: inv.stock_entry_id
        ? "Đã trừ tồn theo phiếu xuất"
        : "Không có phiếu xuất — dữ liệu chuyển đổi, tồn chưa từng bị trừ",
      state: inv.stock_entry_id ? "done" : "todo",
    },
    {
      label: "Hoá đơn điện tử",
      detail: eInvoice?.misa_inv_no
        ? `Đã phát hành · ${eInvoice.misa_inv_no}`
        : eInvoice
          ? "Đã tạo bản nháp, chưa phát hành"
          : "Chưa phát hành",
      state: eInvoice?.misa_inv_no ? "done" : posted ? "current" : "todo",
    },
    ...(posted
      ? []
      : [
          {
            label: "Đã huỷ",
            detail: inv.cancelled_at ? formatDate(inv.cancelled_at) : "—",
            state: "done" as const,
          },
        ]),
  ]

  const actionButtons = (
    <>
        <Button variant="outline" asChild>
          <Link href={`/sales-invoices/${inv.id}/print`}>
            <Printer className="mr-1.5 h-4 w-4" /> In hóa đơn
          </Link>
        </Button>
        {/*
          TRẢ HÀNG CỦA CHÍNH HÓA ĐƠN NÀY — lối vào thứ hai của phiếu trả
          độc lập (chủ nhà chốt), dành cho ca "giao rồi khách không nhận
          hết".

          ⚠ CHỈ HÓA ĐƠN CÒN HIỆU LỰC. Hóa đơn đã huỷ đã hoàn hàng về kho
            rồi; gắn phiếu trả vào nó là nhập kho lần thứ hai —
            `complete_return` cũng từ chối bằng `INVOICE_NOT_POSTED`. Hiện
            nút ở đó là mời người dùng đi vào một màn sẽ bị chặn.
        */}
        {posted && (
          <Button variant="outline" asChild>
            <Link
              href={`/returns/new?invoiceId=${inv.id}${
                inv.customer_id ? `&customerId=${inv.customer_id}` : ""
              }`}
            >
              <Undo2 className="mr-1.5 h-4 w-4" /> Trả hàng
            </Link>
          </Button>
        )}
        {canManage && posted && (
          <>
            <Button
              variant="outline"
              asChild={!eInvoiceIssued}
              disabled={eInvoiceIssued}
              title={
                eInvoiceIssued
                  ? "Đã phát hành hoá đơn điện tử — không sửa được nữa"
                  : undefined
              }
            >
              {eInvoiceIssued ? (
                <>
                  <Pencil className="mr-1.5 h-4 w-4" /> Sửa hóa đơn
                </>
              ) : (
                <Link href={`/sales-invoices/${inv.id}/edit`}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Sửa hóa đơn
                </Link>
              )}
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive"
              onClick={() => setCancelOpen(true)}
              disabled={eInvoiceIssued}
              title={
                eInvoiceIssued
                  ? "Đã phát hành hoá đơn điện tử — không huỷ được nữa"
                  : undefined
              }
            >
              <XCircle className="mr-1.5 h-4 w-4" /> Huỷ hóa đơn
            </Button>
          </>
        )}
        {canManage && posted && !eInvoiceIssued && (
          <Button onClick={publish} disabled={publishing}>
            <FileText className="mr-1.5 h-4 w-4" />
            {publishing ? "Đang phát hành…" : "Phát hành HĐ điện tử"}
          </Button>
        )}
    </>
  )

  return (
    <div className="space-y-5">
      {/* ⚠ ĐƯỜNG VỀ PHẢI CÒN. Mẫu vẽ nó ở thanh trên cùng, mà thanh đó là
          khung ứng dụng chung — ở đây giữ một liên kết nhỏ, nếu không thì
          mở hóa đơn từ đâu cũng thành ngõ cụt. */}
      <Link
        href="/sales-invoices"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface"
      >
        ← Hóa đơn bán
      </Link>

      <DetailHero
        code={inv.invoice_code}
        status={
          <>
            <StatusPill label={statusLabel} tone={statusTone} />
            {inv.replaced_from && <Badge variant="secondary">Bản lập lại</Badge>}
            {inv.replaced_by && <Badge variant="outline">Đã bị thay</Badge>}
          </>
        }
        summary={summaryLine}
        actions={actionButtons}
      />

      {/*
        ⚠ HÓA ĐƠN ĐÃ HUỶ PHẢI NÓI RA VÌ SAO VÀ THAY BẰNG CÁI GÌ. Để trống
          thì người tra sổ sáu tháng sau thấy một chứng từ bị huỷ không
          rõ lý do, cạnh một phiếu nhập hoàn kho không ai giải thích.
      */}
      {!posted && (
        <div className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-bold text-destructive">
            Hóa đơn đã huỷ{inv.cancelled_at ? ` ngày ${formatDate(inv.cancelled_at)}` : ""}
          </p>
          {inv.cancel_reason && (
            <p className="text-xs text-destructive/90">{inv.cancel_reason}</p>
          )}
          {inv.replaced_by && (
            <Link
              href={`/sales-invoices/${inv.replaced_by}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Xem bản thay thế <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}

      <DetailColumns
        main={
          <>
            {/* Khối khách hàng theo mẫu — chữ cái đầu, tên, liên hệ, rồi
                các ô số liệu. Hóa đơn không có hạn mức nên ô đó nhường
                chỗ cho mã số thuế; vẽ một ô rỗng có nhãn là tệ hơn. */}
            <DetailCustomerCard
              onNameClick={inv.customer_id ? () => setQuickCustomer(inv.customer_id) : null}
              name={inv.customer?.billing_name || inv.customer?.store_name || "Khách lẻ"}
              contact={[inv.customer?.phone, inv.customer?.billing_address || inv.customer?.address]
                .filter(Boolean)
                .join(" · ")}
              stats={[
                { label: "Hình thức", value: inv.payment_terms || "—" },
                { label: "Hạn trả", value: inv.due_date ? formatDate(inv.due_date) : "—" },
                ...(inv.customer?.tax_code
                  ? [{ label: "Mã số thuế", value: inv.customer.tax_code }]
                  : []),
              ]}
            />

          {/* Bảng dòng hàng theo mẫu: tiêu đề thẻ có kèm "N dòng", và
              dưới tên hàng là dòng phụ "SKU · SL × đơn giá". */}
          <DetailCard
            title="Mặt hàng"
            aside={`${lines.length} dòng`}
            bodyClassName="p-0"
          >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-low text-[11px] uppercase tracking-[0.07em] text-on-surface-variant">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Mặt hàng</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Số lượng</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Đơn giá</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Thuế</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr className="border-t">
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      Hóa đơn không có dòng nào.
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.id} className="border-t border-outline-variant/30">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-on-surface">{l.product?.name || "—"}</div>
                        {/* ⚠ DÒNG PHỤ NÓI ĐỦ PHÉP TÍNH, đúng như mẫu: mã ·
                            số lượng × đơn giá. Người đối chiếu không phải
                            nhìn sang ba cột khác để cộng nhẩm. */}
                        <div className="text-xs text-on-surface-variant">
                          {l.product?.sku ? `${l.product.sku} · ` : ""}
                          {l.quantity} {l.unit_name} × {formatCurrency(l.unit_price)}
                          {l.is_exchange && (
                            <Badge variant="secondary" className="ml-1.5">Hàng đổi</Badge>
                          )}
                        </div>
                        {/* ⚠ GHI CHÚ TỪNG MẶT HÀNG (chủ nhà chốt
                            20/09/2026). Nó đã được lưu từ đầu — `note`
                            đi từ dòng đơn qua `post_invoice` vào
                            `sales_invoice_lines.note` — và câu truy vấn
                            đã kéo về, chỉ là chưa chỗ nào in ra. Một ghi
                            chú đã nhập mà màn hình không hiện thì người
                            bán tưởng mình quên nhập và nhập lại. */}
                        {l.note && (
                          <div className="mt-0.5 whitespace-pre-wrap text-xs italic text-on-surface-variant [overflow-wrap:anywhere]">
                            Ghi chú: {l.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {l.quantity} {l.unit_name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(l.unit_price)}
                      </td>
                      {/*
                        ⚠ THUẾ SUẤT LÀ SNAPSHOT LÚC XUẤT, không tra lại
                          bảng sản phẩm. Hai hóa đơn của cùng một đơn có
                          thể mang thuế suất khác nhau — đúng về kế toán,
                          nhưng phải hiện ra thì mới không bị tưởng là lỗi.
                      */}
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-on-surface-variant">
                        {Math.round(Number(l.vat_rate || 0) * 100)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {formatCurrency(l.line_total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </DetailCard>

          {/* ⚠ HAI GHI CHÚ LÀ HAI THỨ KHÁC NHAU, và phải ghi rõ của ai:
              ghi chú ĐƠN là lời người bán dặn lúc đặt hàng, ghi chú HÓA
              ĐƠN là lời người xuất kho dặn lúc giao. Gộp làm một là mất
              mất ai nói câu nào. Trùng chữ thì chỉ hiện khối đầu. */}
          {[
            { label: "Ghi chú đơn hàng", text: (inv.order?.notes ?? "").trim() },
            { label: "Ghi chú hóa đơn", text: (inv.notes ?? "").trim() },
          ]
            .filter((n, i, all) => n.text !== "" && all.findIndex((x) => x.text === n.text) === i)
            .map((n) => (
              <DetailCard
                key={n.label}
                title={n.label}
                bodyClassName="whitespace-pre-wrap px-4 py-3.5 text-sm [overflow-wrap:anywhere]"
              >
                {n.text}
              </DetailCard>
            ))}
          </>
        }
        rail={
          <>
          {/* ⚠ CÙNG MỘT KHỐI VỚI NGĂN XEM NHANH — xem
              `InvoiceMoneySummary`. Hai chỗ tự cộng là hai con số cho
              cùng một tờ hóa đơn. */}
          <DetailCard title="Cộng tiền">
            <InvoiceMoneySummary
              invoice={{ total: inv.total, subtotal: inv.subtotal, vat: inv.vat }}
              returns={invReturns}
            />
          </DetailCard>

          <DetailCard title="Thanh toán">
            <DetailRow label="Hình thức" value={inv.payment_terms || "—"} />
            <DetailRow label="Hạn trả" value={inv.due_date ? formatDate(inv.due_date) : "—"} />
          </DetailCard>

          <DetailCard title="Tiến trình">
            <DetailTimeline steps={timeline} />
          </DetailCard>

          <DetailCard title="Chứng từ liên quan" bodyClassName="space-y-2 px-4 py-3.5 text-sm">
              <Link
                href={`/orders/${inv.order_id}`}
                className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5 hover:bg-muted/50"
              >
                <span>Đơn đặt hàng</span>
                <span className="font-mono text-xs">{inv.order?.order_code || "—"}</span>
              </Link>
              {/*
                ⚠ PHIẾU XUẤT RỖNG KHÔNG PHẢI LỖI HIỂN THỊ. Hóa đơn tạo bởi
                  backfill của migration 124 cho những đơn cũ không có
                  phiếu xuất đã ghi sổ — tồn kho chưa bao giờ bị trừ cho
                  chúng. Nói ra thay vì để một ô trống.
              */}
              {inv.stock_entry_id ? (
                <Link
                  href={`/inventory/${inv.stock_entry_id}`}
                  className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5 hover:bg-muted/50"
                >
                  <span>Phiếu xuất kho</span>
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                </Link>
              ) : (
                <p className="rounded-lg bg-[#fff4ed] p-2.5 text-xs text-[#b54708]">
                  Không có phiếu xuất kho — hóa đơn này do chuyển đổi dữ liệu cũ tạo ra,
                  tồn kho chưa từng bị trừ cho nó.
                </p>
              )}
              {eInvoice && (
                <Link
                  href={`/invoices/${eInvoice.id}`}
                  className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5 hover:bg-muted/50"
                >
                  <span>Hoá đơn điện tử</span>
                  <span className="font-mono text-xs">{eInvoice.misa_inv_no || "chưa phát hành"}</span>
                </Link>
              )}
              {inv.replaced_from && (
                <Link
                  href={`/sales-invoices/${inv.replaced_from}`}
                  className="flex items-center justify-between rounded-lg bg-muted/30 p-2.5 hover:bg-muted/50"
                >
                  <span>Thay cho hóa đơn</span>
                  <Undo2 className="h-4 w-4 text-muted-foreground" />
                </Link>
              )}
          </DetailCard>
          </>
        }
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(o) => !cancelling && setCancelOpen(o)}
        title={`Huỷ hóa đơn ${inv.invoice_code}?`}
        description="Hàng hoàn về đúng các lô đã lấy, công nợ của hóa đơn này bị xoá, và đơn quay lại trạng thái tương ứng. Không hoàn tác được."
        confirmLabel="Huỷ hóa đơn"
        variant="destructive"
        loading={cancelling}
        onConfirm={async () => {
          setCancelling(true)
          try {
            await cancelInvoice(supabase, inv.id, cancelReason.trim())
            toast({ title: `Đã huỷ hóa đơn ${inv.invoice_code}` })
            setCancelOpen(false)
            fetchData()
          } catch (e) {
            toast({ title: "Không huỷ được", description: errorMessage(e), variant: "destructive" })
          } finally {
            setCancelling(false)
          }
        }}
      >
        <div>
          <Label
            htmlFor="cancel-reason"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Lý do (bắt buộc)
          </Label>
          <Textarea
            id="cancel-reason"
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Ví dụ: giao nhầm hàng, khách trả lại toàn bộ"
          />
        </div>
      </ConfirmDialog>

      {/* Modal thông tin khách — mở từ tên khách ở đầu trang. */}
      <CustomerQuickView
        customerId={quickCustomer}
        onClose={() => setQuickCustomer(null)}
      />
    </div>
  )
}
