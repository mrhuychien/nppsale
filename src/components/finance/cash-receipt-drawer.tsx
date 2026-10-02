"use client"

/**
 * XEM NHANH PHIẾU THU TỪ DANH SÁCH — cùng khuôn ngăn xem nhanh đơn / hóa đơn / phiếu trả.
 *
 * ⚠ CHỦ NHÀ 27/09/2026: danh sách phiếu thu theo đúng khuôn đơn / hóa đơn — bấm dòng mở
 *   xem nhanh (giữ bộ lọc, giữ chỗ đang đứng), bấm mã sang chi tiết.
 * ⚠ CHỈ ĐỌC. Xác nhận / huỷ phiếu là việc của trang chi tiết (qua RPC) — nút ở đây mở trang
 *   ấy ở TAB MỚI như ngăn hóa đơn.
 */

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { NewTabLink } from "@/components/ui/new-tab-link"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import {
  CASH_RECEIPT_SOURCE_LABEL, CASH_RECEIPT_STATUS_LABEL, CASH_RECEIPT_STATUS_VARIANT,
} from "@/lib/finance/cash-receipt-list"
import { SoThuTu } from "@/components/mobile/so-thu-tu"

interface DrawerReceipt {
  id: string
  receipt_code: string
  receipt_date: string
  status: string
  source_type: string | null
  expected_amount: number | null
  submitted_amount: number | null
  notes: string | null
  void_reason?: string | null
  collector?: { full_name?: string | null } | null
  creator?: { full_name?: string | null } | null
  receiver?: { full_name?: string | null } | null
}

interface DrawerLine {
  id: string
  amount: number | null
  kind?: string | null
  invoice?: { id?: string | null; invoice_code?: string | null } | null
  receivable?: { customer?: { store_name?: string | null; phone?: string | null } | null } | null
  order?: { order_code?: string | null; customer?: { store_name?: string | null; phone?: string | null } | null } | null
}

const COT =
  "id, receipt_code, receipt_date, status, source_type, expected_amount, submitted_amount, notes, void_reason, " +
  "collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name), " +
  "receiver:users!cash_receipts_received_by_fkey(full_name)"

const COT_DONG =
  "id, amount, kind, invoice:sales_invoices(id, invoice_code), " +
  "receivable:receivables(customer:customers(store_name, phone)), " +
  "order:sales_orders(order_code, customer:customers(store_name, phone))"

const KIND_LABEL: Record<string, string> = {
  payment: "Tiền thu",
  return_credit: "Cấn trừ phiếu trả",
  credit_applied: "Chuyển dư có",
}

export function CashReceiptDrawer({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const [r, setR] = useState<DrawerReceipt | null>(null)
  const [lines, setLines] = useState<DrawerLine[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setR(null)
    setLines([])
    setError(null)
    if (!receiptId) return
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [{ data, error: e }, { data: ls, error: le }] = await Promise.all([
        sb.from("cash_receipts").select(COT).eq("id", receiptId).maybeSingle(),
        sb.from("cash_receipt_lines").select(COT_DONG).eq("receipt_id", receiptId),
      ])
      if (huy) return
      if (e) { setError(errorMessage(e)); return }
      if (!data) { setError("Không tìm thấy phiếu thu."); return }
      if (le) console.error("[cash-receipt-drawer] không đọc được dòng phiếu:", le.message)
      setR((data as unknown) as DrawerReceipt)
      setLines(((ls as unknown) as DrawerLine[]) ?? [])
    })()
    return () => { huy = true }
  }, [receiptId])

  const tien = Number(r?.expected_amount ?? 0)
  const nop = Number(r?.submitted_amount ?? 0)
  const lech = nop - tien

  return (
    <Sheet open={!!receiptId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-[460px] flex-col gap-0 p-0 sm:max-w-[460px]">
        <div className="flex items-center gap-2.5 border-b border-outline-variant/40 py-4 pl-5 pr-14">
          <span className="min-w-0 flex-1">
            <SheetTitle className="block truncate font-mono text-lg font-extrabold text-on-surface">
              {r?.receipt_code ?? "Phiếu thu"}
            </SheetTitle>
            <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
              {r ? formatDate(r.receipt_date) : "…"}
              {r ? ` · ${lines.length} dòng` : ""}
            </span>
          </span>
          {r && (
            <Badge variant={CASH_RECEIPT_STATUS_VARIANT[r.status] ?? "secondary"}>
              {CASH_RECEIPT_STATUS_LABEL[r.status] ?? r.status}
            </Badge>
          )}
        </div>

        <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3.5 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm font-semibold text-error">Không tải được phiếu thu — {error}</p>}
          {!error && !r && (
            <div className="grid gap-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <Cell label="Người thu" main={r.collector?.full_name || "—"} sub={r.creator?.full_name ? `Tạo: ${r.creator.full_name}` : ""} />
                <Cell
                  label="Nguồn"
                  main={CASH_RECEIPT_SOURCE_LABEL[r.source_type ?? ""] ?? r.source_type ?? "—"}
                  sub={r.receiver?.full_name ? `Nhận: ${r.receiver.full_name}` : ""}
                />
              </div>

              {lines.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-outline-variant/40">
                  <div className="bg-surface-container-low px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
                    Khoản thu · {lines.length}
                  </div>
                  {lines.map((l, i) => {
                    const kh = l.receivable?.customer ?? l.order?.customer ?? null
                    return (
                      <div key={l.id} className="flex items-start gap-2.5 border-t border-outline-variant/30 px-3 py-2.5">
                        <SoThuTu n={i + 1} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold leading-snug">
                            {kh?.store_name || "—"}
                          </span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
                            {/* Nhãn khoản nợ là MÃ HÓA ĐƠN; mã đơn chỉ là phụ (CLAUDE.md). */}
                            {l.invoice?.invoice_code || (l.order?.order_code ? `Đơn ${l.order.order_code}` : "Nợ đầu kỳ / dư có")}
                            {l.kind && l.kind !== "payment" ? ` · ${KIND_LABEL[l.kind] ?? l.kind}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-extrabold tabular-data">
                          {formatCurrency(Number(l.amount) || 0)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="grid gap-1.5 rounded-xl bg-surface-container-low px-3 py-3 text-sm">
                <div className="flex justify-between font-extrabold">
                  <span>Số tiền phiếu</span>
                  <span className="tabular-data">{formatCurrency(tien)}</span>
                </div>
                <div className="flex justify-between font-semibold text-on-surface-variant">
                  <span>Đã nộp</span>
                  <span className="tabular-data">{formatCurrency(nop)}</span>
                </div>
                {Math.abs(lech) > 0.5 && (
                  <div className={`flex justify-between font-bold ${lech < 0 ? "text-error" : "text-[#8a5a00]"}`}>
                    <span>{lech < 0 ? "Thiếu" : "Dư"}</span>
                    <span className="tabular-data">{formatCurrency(Math.abs(lech))}</span>
                  </div>
                )}
              </div>

              {r.notes && (
                <div className="rounded-xl bg-surface-container-low px-3 py-2.5 text-[13px] font-semibold leading-snug text-on-surface-variant [overflow-wrap:anywhere]">
                  Ghi chú: <span className="whitespace-pre-wrap text-on-surface">{r.notes}</span>
                </div>
              )}
              {r.status === "voided" && r.void_reason && (
                <div className="rounded-xl bg-[#fdecec] px-3 py-2.5 text-[13px] font-semibold text-[#b00020] [overflow-wrap:anywhere]">
                  Lý do hủy: {r.void_reason}
                </div>
              )}
            </>
          )}
        </div>

        {receiptId && (
          <div className="flex gap-2 border-t border-outline-variant/40 px-5 pb-5 pt-3">
            <NewTabLink
              href={`/finance/cash-receipts/${receiptId}`}
              className="h-11 flex-1 rounded-xl bg-primary text-sm font-extrabold text-on-primary"
            >
              Chi tiết
            </NewTabLink>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Cell({ label, main, sub }: { label: string; main: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface-container-low p-3">
      <span className="block text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">{label}</span>
      <span className="mt-1 block truncate text-sm font-extrabold text-on-surface">{main}</span>
      {sub && <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">{sub}</span>}
    </div>
  )
}
