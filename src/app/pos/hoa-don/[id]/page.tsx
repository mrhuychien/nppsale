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
 *
 * ⚠ "CÒN LẠI HÓA ĐƠN" LÀ TỔNG TRỪ TIỀN ĐÃ THU. Bản đầu ghi nó bằng
 * tổng — bậc hai và bậc một trùng nhau, và người đọc không biết khách
 * đã trả đồng nào chưa. Đọc `cash_receipt_lines` như màn 7 đang đọc.
 *
 * ⚠ NÚT NÀO CHƯA LÀM ĐƯỢC Ở ĐÂY THÌ DẪN TỚI CHỖ LÀM ĐƯỢC, không để
 * một nút bấm vào không có gì xảy ra. In → trang in của phần đang
 * chạy; Phát hành HĐĐT → màn hóa đơn của phần đang chạy (nơi nút phát
 * hành thật đang nằm); Trả hàng → mở phiếu trả mới nạp sẵn tờ này.
 */

import { Suspense, useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  creditOnInvoice, netDueOnInvoice, type InvoiceReturnRow,
} from "@/lib/orders/invoice-credit"
import { posPrintHref } from "@/lib/pos/tabs"
import { usePosDocLabel } from "@/store/pos/tabs"
import { DocSubHeader } from "@/components/pos/doc-sub-header"
import { LineTableFrame, LineTableHeader, POS_GRID } from "@/components/pos/line-table"
import { MoneyRow, TotalsHero, PanelActions, PanelButton } from "@/components/pos/money-panel"
import { PartnerCard } from "@/components/pos/partner-card"
import { InvoiceScreen } from "@/components/pos/invoice-screen"
import { DocPeople } from "@/components/pos/doc-people"
import { assignDocSeller } from "@/lib/pos/save"
import { useToast } from "@/hooks/use-toast"

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
  customer_id: string
  posted_by?: string | null
  sales_user_id?: string | null
  customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
}

interface Line {
  id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_discount: number | null
  line_total: number
  is_exchange: boolean
  product?: { name?: string | null; sku?: string | null } | null
}

/**
 * `/pos/hoa-don/moi?order=<id>` — XUẤT HÀNG: lập hóa đơn từ đơn (chủ nhà chốt
 * 23/09/2026 "Màn xuất hàng → POS"). Mọi mã khác là XEM một tờ đã có.
 *
 * ⚠ `useSearchParams` bọc trong `<Suspense>` — Next 14 đòi thế cho trang client.
 */
function XuatHang() {
  const q = useSearchParams()
  return <InvoiceScreen orderId={q.get("order")} />
}

export default function PosInvoicePage() {
  const { id } = useParams<{ id: string }>()
  if (id === "moi") {
    return (
      <Suspense fallback={null}>
        <XuatHang />
      </Suspense>
    )
  }
  return <XemHoaDon id={id} />
}

function XemHoaDon({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [dangGan, setDangGan] = useState(false)
  const [head, setHead] = useState<Head | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [rets, setRets] = useState<InvoiceReturnRow[]>([])
  /** Đã thu — `null` là chưa đọc được, và bậc hai hiện "chưa xác định". */
  const [daThu, setDaThu] = useState<number | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)

  usePosDocLabel("INV", id, head?.invoice_code ?? null)

  useEffect(() => {
    if (!id || id === "moi") { setDangTai(false); return }
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [h, l, r, p] = await Promise.all([
        sb.from("sales_invoices")
          .select("id, invoice_code, invoice_date, status, subtotal, vat, total, payment_terms, due_date, customer_id, posted_by, sales_user_id, customer:customers(store_name, phone, address)")
          .eq("id", id).maybeSingle(),
        sb.from("sales_invoice_lines")
          .select("id, quantity, unit_name, unit_price, line_discount, line_total, is_exchange, product:products(name, sku)")
          .eq("invoice_id", id).order("sort_order", { ascending: true }),
        sb.from("returns")
          .select("id, status, credit_note_amount, credit_with_invoice, created_at, reason")
          .eq("invoice_id", id),
        sb.from("cash_receipt_lines")
          .select("amount, receipt:cash_receipts(status)")
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
      if (!p.error) {
        const rows = (p.data as unknown as Array<{ amount: number; receipt?: { status?: string } | null }>) ?? []
        setDaThu(rows.filter((x) => x.receipt?.status !== "voided").reduce((s, x) => s + (Number(x.amount) || 0), 0))
      }
      setDangTai(false)
    })()
    return () => { huy = true }
  }, [id])

  const credit = creditOnInvoice(rets)
  const tong = Number(head?.total || 0)
  const conLai = daThu == null ? null : Math.max(0, tong - daThu)
  const netDue = conLai == null ? null : netDueOnInvoice(conLai, credit)
  const g = POS_GRID.invoiceView
  const daHuy = head?.status === "cancelled"

  return (
    <>
      <DocSubHeader
        title="Hóa đơn bán"
        code={head?.invoice_code ?? (dangTai ? "…" : null)}
        badge={head ? { label: daHuy ? "ĐÃ HUỶ" : "ĐÃ XUẤT", tone: daHuy ? "tam" : "xong" } : null}
        subtitle={head ? `${formatDate(head.invoice_date)} · ${lines.length} mặt hàng` : undefined}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/* ⚠ `min-w-0 flex-1`, không cứng 1012px — xem `OrderScreen`. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
              <p className="px-4 py-4 text-[13px] font-semibold text-[var(--pos-danger)]">
                Không tải được hóa đơn — {loi}
              </p>
            )}
            {!loi && dangTai && (
              <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">Đang tải…</p>
            )}
            {!loi && !dangTai && lines.length === 0 && (
              <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">
                Hóa đơn này không có dòng hàng nào.
              </p>
            )}
            {lines.map((l, i) => (
              <div
                key={l.id}
                className="grid min-h-[50px] items-center border-b border-[var(--pos-line-soft)] px-4 py-1.5"
                style={{ gridTemplateColumns: g.cols, gap: g.gap }}
              >
                <div className="n text-[12px] text-[var(--pos-dim)]">{i + 1}</div>
                <div className="n truncate text-[11.5px] text-[var(--pos-muted)]">{l.product?.sku ?? "—"}</div>
                <div className="truncate text-[13px] font-semibold text-[var(--pos-ink)]">
                  {l.product?.name ?? <span className="italic text-[var(--pos-dim)]">Sản phẩm đã xoá</span>}
                </div>
                <div className="truncate text-[12px] text-[var(--pos-muted)]">{l.unit_name}</div>
                <div className="n text-center text-[13px] font-semibold">{l.quantity}</div>
                <div className="n text-right text-[13px]">{formatCurrency(l.unit_price)}</div>
                {/* ⚠ Giảm theo dòng CÓ cột thật — bản đầu vẽ "—" cho mọi dòng. */}
                <div className="n text-right text-[12px] text-[var(--pos-muted)]">
                  {Number(l.line_discount) > 0 ? formatCurrency(Number(l.line_discount)) : "—"}
                </div>
                <div className="text-center text-[10px] font-bold text-[var(--pos-primary-deep)]">
                  {l.is_exchange ? "ĐỔI" : ""}
                </div>
                <div className="n text-right text-[13.5px] font-bold">{formatCurrency(l.line_total)}</div>
                <div />
              </div>
            ))}
          </LineTableFrame>
        </div>

        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
          {/* ⚠ Xem hóa đơn thì không đổi khách — card chỉ đọc, không vẽ nút. */}
          <PartnerCard
            readOnly
            partner={
              head?.customer
                ? {
                    id: head.customer_id,
                    name: head.customer.store_name || "Khách lẻ",
                    meta: [head.customer.phone, head.customer.address].filter(Boolean).join(" · "),
                  }
                : null
            }
          />
          <DocPeople
            createdById={head?.posted_by}
            assignedId={head?.sales_user_id}
            busy={dangGan}
            onAssign={
              head?.status === "posted"
                ? async (uid) => {
                    setDangGan(true)
                    try {
                      await assignDocSeller(createClient(), "invoice", id, uid)
                      setHead((h) => (h ? { ...h, sales_user_id: uid } : h))
                      toast({ title: "Đã gán lại người phụ trách hóa đơn" })
                    } catch (e) {
                      toast({ title: "Chưa gán được", description: errorMessage(e), variant: "destructive" })
                    } finally {
                      setDangGan(false)
                    }
                  }
                : undefined
            }
          />

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[var(--pos-line)] bg-white p-3.5">
            <MoneyRow label="Tiền hàng" value={Number(head?.subtotal || 0)} />
            <MoneyRow label="Thuế GTGT" value={Number(head?.vat || 0)} tone="muted" />
            <TotalsHero label="Tổng cộng" value={tong} />

            {/* ⚠ BA BẬC — xem đầu tệp. Tổng hóa đơn ở trên KHÔNG bị trừ. */}
            <div className="mt-3.5 border-t border-[var(--pos-line-soft)] pt-3">
              {daThu != null && daThu > 0 && (
                <MoneyRow label="Đã thu" value={`− ${formatCurrency(daThu)}`} tone="ok" />
              )}
              <MoneyRow label="Còn lại hóa đơn" value={conLai == null ? "chưa xác định" : conLai} />
              {credit > 0 && (
                <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(credit)}`} tone="warn" />
              )}
              <div className="mt-1 border-t border-[var(--pos-line-soft)] pt-2">
                <MoneyRow label="Công nợ ròng" value={netDue == null ? "chưa xác định" : netDue} strong />
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between border-t border-[var(--pos-line-soft)] pt-3">
              <span className="text-[13px] text-[var(--pos-muted)]">Điều khoản TT</span>
              <span className="text-[12.5px] font-medium text-[var(--pos-ink)]">{head?.payment_terms || "—"}</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11.5px] text-[var(--pos-muted)]">Hạn trả</span>
              <span className="n text-[11.5px] text-[var(--pos-muted)]">
                {head?.due_date ? formatDate(head.due_date) : "—"}
              </span>
            </div>

            <div className="flex-grow" />

            {daHuy && (
              <p className="mt-3 text-[11.5px] leading-snug text-[var(--pos-warn)]">
                Hóa đơn đã huỷ — không sửa, không trả hàng, không phát hành được nữa.
              </p>
            )}
          </div>

          <PanelActions>
            <PanelButton
              width={54}
              disabled={!head}
              title="Mở trang in hóa đơn"
              onClick={() => { const h = posPrintHref("INV", id); if (h) window.open(h, "_blank") }}
            >
              In
            </PanelButton>
            <PanelButton
              width={92}
              disabled={!head || daHuy}
              title={daHuy ? "Hóa đơn đã huỷ" : "Lập phiếu trả hàng nạp sẵn tờ này"}
              onClick={() => router.push(`/pos/tra-hang/moi?invoice=${id}`)}
            >
              Trả hàng
            </PanelButton>
            <PanelButton
              variant="warn"
              width={80}
              disabled={!head || daHuy}
              title={daHuy ? "Hóa đơn đã huỷ" : "Huỷ tờ này và lập tờ mới"}
              onClick={() => router.push(`/pos/hoa-don/${id}/sua`)}
            >
              Sửa HĐ
            </PanelButton>
            {/*
              ⚠ PHÁT HÀNH HĐĐT CHƯA CÓ TRÊN MÀN POS — nút thật nằm ở màn
                hóa đơn của phần đang chạy (`/sales-invoices/[id]`). Dẫn
                tới đó thay vì một nút bấm vào không có gì xảy ra.
            */}
            <PanelButton
              variant="primary"
              disabled={!head || daHuy}
              title="Mở màn hóa đơn để phát hành hóa đơn điện tử"
              onClick={() => window.open(`/sales-invoices/${id}`, "_blank")}
            >
              Phát hành HĐĐT ↗
            </PanelButton>
          </PanelActions>
        </div>
      </div>
    </>
  )
}
