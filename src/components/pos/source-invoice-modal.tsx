"use client"

/**
 * MÀN 4 — MODAL CHỌN HÓA ĐƠN GỐC ĐỂ TRẢ HÀNG. Spec §9, 1080×640.
 *
 * ⚠ HAI Ô LỌC MẶC ĐỊNH **BẬT**: "Chỉ hóa đơn của khách đang chọn" và
 * "Ẩn HĐ đã trả hết" (spec §9). Mặc định tắt là người lập phiếu phải
 * dò giữa hàng nghìn tờ, và tờ họ cần là tờ của đúng khách đang đứng
 * trên màn.
 *
 * ⚠ CÒN TRẢ ĐƯỢC BẰNG 0 THÌ THAY NÚT `Chọn` BẰNG CHỮ `đã trả hết`.
 * Spec §9. Để nút bấm được trên một tờ không còn gì để trả là mời
 * người dùng đi vào một lỗi ở bước sau.
 */

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { creditOnInvoice, netDueOnInvoice, type InvoiceReturnRow } from "@/lib/orders/invoice-credit"

interface Row {
  id: string
  invoice_code: string
  invoice_date: string
  total: number
  customer_id: string
  customer?: { store_name?: string | null } | null
  sales_user?: { full_name?: string | null } | null
  returns?: InvoiceReturnRow[] | null
}

export function SourceInvoiceModal({
  open,
  onClose,
  customerId,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** Khách đang chọn trên chứng từ — dùng cho ô lọc mặc định. */
  customerId: string | null
  onPick: (invoiceId: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(false)
  const [q, setQ] = useState("")
  const [chiKhachNay, setChiKhachNay] = useState(true)
  const [anDaTraHet, setAnDaTraHet] = useState(true)

  useEffect(() => {
    if (!open) return
    let huy = false
    setDangTai(true)
    setLoi(null)
    ;(async () => {
      /**
       * ⚠ ĐỌC KÈM PHIẾU TRẢ, không đọc riêng rồi ghép ở trình duyệt.
       * Cột "Còn trả được" cần cả hai; đọc hai lượt là có lúc lượt sau
       * hỏng và cột ấy hiện nguyên giá trị hóa đơn — người dùng trả
       * một món đã trả rồi.
       */
      const { data, error } = await createClient()
        .from("sales_invoices")
        .select(
          "id, invoice_code, invoice_date, total, customer_id, " +
            "customer:customers(store_name), " +
            "sales_user:users!sales_invoices_sales_user_id_fkey(full_name), " +
            "returns(id, status, credit_note_amount, credit_with_invoice)"
        )
        .eq("status", "posted")
        .order("invoice_date", { ascending: false })
        .limit(200)
      if (huy) return
      if (error) setLoi(errorMessage(error))
      setRows((data as unknown as Row[]) ?? [])
      setDangTai(false)
    })()
    return () => { huy = true }
  }, [open])

  const ketQua = useMemo(() => {
    return rows
      .filter((r) => (chiKhachNay && customerId ? r.customer_id === customerId : true))
      .map((r) => {
        const daTru = creditOnInvoice(r.returns ?? [])
        return { r, conTra: netDueOnInvoice(Number(r.total || 0), daTru) }
      })
      .filter((x) => (anDaTraHet ? x.conTra > 0 : true))
      .filter((x) =>
        viMatchAllWords(q, x.r.invoice_code, x.r.customer?.store_name, x.r.sales_user?.full_name)
      )
  }, [rows, chiKhachNay, customerId, anDaTraHet, q])

  if (!open) return null

  return (
    <>
      <button type="button" aria-label="Đóng" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[var(--pos-ink)]/40" />
      <div
        role="dialog"
        aria-label="Chọn hóa đơn gốc để trả hàng"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 flex h-[640px] w-[1080px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,.28)]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--pos-line)] px-5">
          <h2 className="text-[16px] font-bold text-[var(--pos-ink)]">Chọn hóa đơn gốc để trả hàng</h2>
          <button type="button" aria-label="Đóng" onClick={onClose} className="h-8 w-8 rounded-lg text-[18px] leading-none text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)]">×</button>
        </div>

        <div className="flex min-h-0 flex-grow">
          <aside className="w-[286px] shrink-0 overflow-y-auto border-r border-[var(--pos-line)] p-4">
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">Tìm theo</p>
            <input
              type="text"
              aria-label="Tìm hóa đơn"
              placeholder="Mã HĐ, khách, SĐT…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--pos-edge)] px-2.5 text-[12.5px]"
            />

            <p className="mb-1.5 mt-4 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">Lọc</p>
            <label className="flex items-start gap-2 py-1.5 text-[12.5px] text-[var(--pos-muted)]">
              <input
                type="checkbox"
                checked={chiKhachNay}
                onChange={(e) => setChiKhachNay(e.target.checked)}
                disabled={!customerId}
                className="mt-0.5 h-4 w-4 accent-[var(--pos-primary)]"
              />
              <span>
                Chỉ hóa đơn của khách đang chọn
                {!customerId && (
                  /* ⚠ Ô mờ PHẢI nói vì sao — xem `QtyStepper`. */
                  <span className="mt-px block text-[11px] text-[var(--pos-dim)]">
                    chưa chọn khách nên chưa lọc được
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-2 py-1.5 text-[12.5px] text-[var(--pos-muted)]">
              <input
                type="checkbox"
                checked={anDaTraHet}
                onChange={(e) => setAnDaTraHet(e.target.checked)}
                className="h-4 w-4 accent-[var(--pos-primary)]"
              />
              Ẩn HĐ đã trả hết
            </label>

            <button
              type="button"
              onClick={() => { setQ(""); setChiKhachNay(false); setAnDaTraHet(false) }}
              className="mt-3 text-[12px] font-semibold text-[var(--pos-primary)]"
            >
              Xoá tất cả bộ lọc
            </button>
          </aside>

          <div className="flex min-h-0 flex-grow flex-col">
            <div
              className="grid h-[34px] shrink-0 items-center border-b border-[var(--pos-line)] bg-[var(--pos-head)] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--pos-muted)]"
              style={{ gridTemplateColumns: "116px 128px minmax(0,1fr) 140px 120px 120px 76px", gap: 8 }}
            >
              <div>Mã hóa đơn</div><div>Thời gian</div><div>Khách hàng</div>
              <div>Nhân viên bán</div>
              <div style={{ textAlign: "right" }}>Còn trả được</div>
              <div style={{ textAlign: "right" }}>Tổng cộng</div><div />
            </div>

            <div className="min-h-0 flex-grow overflow-y-auto">
              {loi && <p className="px-4 py-4 text-[13px] font-semibold text-[var(--pos-danger)]">Không tải được — {loi}</p>}
              {!loi && dangTai && <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">Đang tải…</p>}
              {!loi && !dangTai && ketQua.length === 0 && (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">
                  Không có hóa đơn nào khớp bộ lọc.
                </p>
              )}
              {ketQua.map(({ r, conTra }, i) => (
                <div
                  key={r.id}
                  className={`grid min-h-[48px] items-center border-b border-[var(--pos-line-soft)] px-4 ${i === 0 ? "bg-[var(--pos-primary-faint)]" : ""}`}
                  style={{ gridTemplateColumns: "116px 128px minmax(0,1fr) 140px 120px 120px 76px", gap: 8 }}
                >
                  <div className="n text-[12.5px] font-semibold text-[var(--pos-ink)]">{r.invoice_code}</div>
                  <div className="n text-[11.5px] text-[var(--pos-muted)]">{formatDate(r.invoice_date)}</div>
                  <div className="truncate text-[12.5px] text-[var(--pos-ink)]">{r.customer?.store_name || "Khách lẻ"}</div>
                  <div className="truncate text-[12px] text-[var(--pos-muted)]">{r.sales_user?.full_name || "—"}</div>
                  <div className="n text-right text-[12.5px] font-semibold text-[var(--pos-ok)]">
                    {formatCurrency(conTra)}
                  </div>
                  <div className="n text-right text-[12.5px] text-[var(--pos-ink)]">{formatCurrency(r.total)}</div>
                  <div className="text-right">
                    {conTra > 0 ? (
                      <button
                        type="button"
                        onClick={() => { onPick(r.id); onClose() }}
                        className="h-7 rounded-md bg-[var(--pos-primary)] px-3 text-[12px] font-semibold text-white"
                      >
                        Chọn
                      </button>
                    ) : (
                      <span className="text-[11.5px] text-[var(--pos-dim)]">đã trả hết</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex h-11 shrink-0 items-center justify-between border-t border-[var(--pos-line)] px-4">
              <span className="n text-[11.5px] text-[var(--pos-muted)]">
                {ketQua.length} hóa đơn khớp bộ lọc
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
