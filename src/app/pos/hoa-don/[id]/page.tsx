"use client"

/**
 * MÀN 2 — HÓA ĐƠN BÁN, XEM. Spec §6 mục "Hóa đơn bán (2)".
 *
 * ⚠ BA BẬC CÔNG NỢ, VÀ TỔNG HÓA ĐƠN **KHÔNG** TRỪ HÀNG TRẢ. Spec chốt
 * nguyên văn, và nó trùng khớp với phần nghiệp vụ đang chạy:
 * `_wf2b_recompute_receivable` để `sales_invoices.total` NGUYÊN VẸN và
 * chỉ tính `nợ = tổng hóa đơn − phiếu trả đã tính`. Tờ hóa đơn là
 * chứng từ của lô hàng ĐÃ GIAO; trừ thẳng vào nó là sửa một chứng từ
 * đã phát hành, và lệch với tờ đã gửi cơ quan thuế.
 *
 * ⚠ PHÉP TRỪ ĐI QUA `invoice-credit.ts`, KHÔNG TỰ CỘNG Ở ĐÂY. Đó là
 * chỗ DUY NHẤT trong kho mã trả lời "phiếu này đã trừ chưa", và nó là
 * bản sao của câu SQL trong mig 133. Tự xét ở màn POS là màn hình nói
 * một đằng, sổ ghi một nẻo.
 */

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  creditOnInvoice, netDueOnInvoice, type InvoiceReturnRow,
} from "@/lib/orders/invoice-credit"
import { DocSubHeader } from "@/components/pos/doc-sub-header"
import { LineTableFrame, LineTableHeader, POS_GRID } from "@/components/pos/line-table"
import { MoneyRow, TotalsHero, PanelActions, PanelButton } from "@/components/pos/money-panel"
import { PartnerCard } from "@/components/pos/partner-card"
import { SourceInvoiceModal } from "@/components/pos/source-invoice-modal"

interface Head {
  id: string
  invoice_code: string
  invoice_date: string
  status: string
  subtotal: number
  vat: number
  total: number
  payment_terms: string | null
  due_date: string | null
  customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
}

interface Line {
  id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_total: number
  is_exchange: boolean
  product?: { name?: string | null; sku?: string | null } | null
}

export default function PosInvoicePage() {
  const { id } = useParams<{ id: string }>()
  const [head, setHead] = useState<Head | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [rets, setRets] = useState<InvoiceReturnRow[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [moChonHD, setMoChonHD] = useState(false)

  useEffect(() => {
    if (!id || id === "moi") { setDangTai(false); return }
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [h, l, r] = await Promise.all([
        sb.from("sales_invoices")
          .select("id, invoice_code, invoice_date, status, subtotal, vat, total, payment_terms, due_date, customer:customers(store_name, phone, address)")
          .eq("id", id).maybeSingle(),
        sb.from("sales_invoice_lines")
          .select("id, quantity, unit_name, unit_price, line_total, is_exchange, product:products(name, sku)")
          .eq("invoice_id", id).order("sort_order", { ascending: true }),
        sb.from("returns")
          .select("id, status, credit_note_amount, credit_with_invoice, created_at, reason")
          .eq("invoice_id", id),
      ])
      if (huy) return
      /**
       * ⚠ ĐỌC HỎNG THÌ NÓI RA. `0 dòng` là câu trả lời giống hệt nhau
       * cho "hóa đơn rỗng" và "mất mạng" — chọn giúp người dùng cái
       * nghe xuôi tai hơn là nói dối họ.
       */
      const e = h.error || l.error || r.error
      if (e) setLoi(errorMessage(e))
      setHead((h.data as unknown as Head) ?? null)
      setLines((l.data as unknown as Line[]) ?? [])
      setRets((r.data as unknown as InvoiceReturnRow[]) ?? [])
      setDangTai(false)
    })()
    return () => { huy = true }
  }, [id])

  const credit = creditOnInvoice(rets)
  const netDue = netDueOnInvoice(Number(head?.total || 0), credit)
  const g = POS_GRID.invoiceView

  return (
    <>
      <DocSubHeader
        title="Hóa đơn bán"
        code={head?.invoice_code ?? (dangTai ? "…" : null)}
        badge={head ? { label: head.status === "posted" ? "ĐÃ XUẤT" : "ĐÃ HUỶ", tone: head.status === "posted" ? "xong" : "tam" } : null}
        subtitle={head ? `${formatDate(head.invoice_date)} · ${lines.length} mặt hàng` : undefined}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        <div className="flex min-h-0 w-[1012px] shrink-0 flex-col gap-3">
          <LineTableFrame
            header={
              <LineTableHeader
                grid="invoiceView"
                cells={[
                  { label: "#" }, { label: "Mã hàng" }, { label: "Tên hàng" },
                  { label: "ĐVT" }, { label: "SL", align: "center" },
                  { label: "Đơn giá", align: "right" }, { label: "Giảm", align: "right" },
                  { label: "Đổi", align: "center" }, { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
          >
            {loi && (
              <p className="px-4 py-4 text-[13px] font-semibold text-[#dc2626]">
                Không tải được hóa đơn — {loi}
              </p>
            )}
            {!loi && dangTai && (
              <p className="px-4 py-10 text-center text-[13px] text-[#64748b]">Đang tải…</p>
            )}
            {!loi && !dangTai && lines.length === 0 && (
              <p className="px-4 py-10 text-center text-[13px] text-[#64748b]">
                Hóa đơn này không có dòng hàng nào.
              </p>
            )}
            {lines.map((l, i) => (
              <div
                key={l.id}
                className="grid min-h-[50px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
                style={{ gridTemplateColumns: g.cols, gap: g.gap }}
              >
                <div className="n text-[12px] text-[#94a3b8]">{i + 1}</div>
                <div className="n truncate text-[11.5px] text-[#64748b]">{l.product?.sku ?? "—"}</div>
                <div className="truncate text-[13px] font-semibold text-[#0f172a]">
                  {l.product?.name ?? <span className="italic text-[#94a3b8]">Sản phẩm đã xoá</span>}
                </div>
                <div className="truncate text-[12px] text-[#64748b]">{l.unit_name}</div>
                <div className="n text-center text-[13px] font-semibold">{l.quantity}</div>
                <div className="n text-right text-[13px]">{formatCurrency(l.unit_price)}</div>
                <div className="n text-right text-[12px] text-[#64748b]">—</div>
                <div className="text-center text-[10px] font-bold text-[#1d4ed8]">
                  {l.is_exchange ? "ĐỔI" : ""}
                </div>
                <div className="n text-right text-[13.5px] font-bold">{formatCurrency(l.line_total)}</div>
                <div />
              </div>
            ))}
          </LineTableFrame>
        </div>

        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
          <PartnerCard
            partner={
              head?.customer
                ? {
                    id: "kh",
                    name: head.customer.store_name || "Khách lẻ",
                    meta: [head.customer.phone, head.customer.address].filter(Boolean).join(" · "),
                  }
                : null
            }
            onPick={() => {}}
          />

          <div className="flex min-h-0 flex-grow flex-col rounded-xl border border-[#e2e8f0] bg-white p-3.5">
            <MoneyRow label="Tiền hàng" value={Number(head?.subtotal || 0)} />
            <MoneyRow label="Thuế GTGT" value={Number(head?.vat || 0)} tone="muted" />
            <TotalsHero label="Tổng cộng" value={Number(head?.total || 0)} />

            {/* ⚠ BA BẬC — xem đầu tệp. Tổng hóa đơn ở trên KHÔNG bị trừ. */}
            <div className="mt-3.5 border-t border-[#f1f5f9] pt-3">
              <MoneyRow label="Còn lại hóa đơn" value={Number(head?.total || 0)} />
              {credit > 0 && (
                <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(credit)}`} tone="warn" />
              )}
              <div className="mt-1 border-t border-[#f1f5f9] pt-2">
                <MoneyRow label="Công nợ ròng" value={netDue} strong />
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between border-t border-[#f1f5f9] pt-3">
              <span className="text-[13px] text-[#334155]">Điều khoản TT</span>
              <span className="text-[12.5px] font-medium text-[#0f172a]">{head?.payment_terms || "—"}</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11.5px] text-[#64748b]">Hạn trả</span>
              <span className="n text-[11.5px] text-[#64748b]">
                {head?.due_date ? formatDate(head.due_date) : "—"}
              </span>
            </div>

            <div className="flex-grow" />
          </div>

          <PanelActions>
            <PanelButton width={54}>In</PanelButton>
            <PanelButton width={92} onClick={() => setMoChonHD(true)}>Trả hàng</PanelButton>
            <PanelButton variant="warn" width={80}>
              <Link href={`/pos/hoa-don/${id}/sua`}>Sửa HĐ</Link>
            </PanelButton>
            <PanelButton variant="primary">Phát hành HĐĐT</PanelButton>
          </PanelActions>
        </div>
      </div>

      <SourceInvoiceModal
        open={moChonHD}
        onClose={() => setMoChonHD(false)}
        customerId={null}
        onPick={() => setMoChonHD(false)}
      />
    </>
  )
}
