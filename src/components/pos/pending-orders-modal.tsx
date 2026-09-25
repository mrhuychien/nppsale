"use client"

/**
 * MODAL "XỬ LÝ ĐẶT HÀNG" — chủ nhà 24/09/2026: "thêm nút Xử lý đặt hàng … bấm
 * vào ra danh sách Đơn hàng ở trạng thái phiếu tạm để tạo hoá đơn (mẫu modal
 * dùng mẫu modal Chọn hoá đơn gốc ở phiếu trả hàng POS)".
 *
 * Cùng khuôn `SourceInvoiceModal`: cột lọc trái, bảng phải, nút ở cuối dòng.
 * Chọn một đơn → màn lập hóa đơn từ đơn (`posNewInvoiceHref`), như nút "Tạo
 * hoá đơn" trên màn đơn hàng.
 *
 * ⚠ MẶC ĐỊNH CHỈ PHIẾU TẠM ('submitted'). Đơn đã xuất một phần vẫn còn hàng
 *   để lập hóa đơn — ô lọc thứ hai cho hiện, mặc định tắt đúng chữ chủ nhà.
 */

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { ORDER_STATUS_MAP } from "@/lib/constants"

interface Row {
  id: string
  order_code: string
  order_date: string
  total: number
  status: string
  customer?: { store_name?: string | null; phone?: string | null } | null
  sales_user?: { full_name?: string | null } | null
}

const COT = "116px 108px minmax(0,1fr) 140px 120px 120px 96px"

export function PendingOrdersModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (orderId: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(false)
  const [q, setQ] = useState("")
  const [gomXuatMotPhan, setGomXuatMotPhan] = useState(false)

  useEffect(() => {
    if (!open) return
    let huy = false
    setDangTai(true)
    setLoi(null)
    ;(async () => {
      const { data, error } = await createClient()
        .from("sales_orders")
        .select(
          "id, order_code, order_date, total, status, " +
            "customer:customers(store_name, phone), " +
            "sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
        )
        .in("status", gomXuatMotPhan ? ["submitted", "partially_invoiced"] : ["submitted"])
        // Cũ nhất trước: đơn chờ lâu nhất được xử lý trước.
        .order("order_date", { ascending: true })
        .order("id")
        .limit(300)
      if (huy) return
      if (error) setLoi(errorMessage(error))
      setRows((data as unknown as Row[]) ?? [])
      setDangTai(false)
    })()
    return () => { huy = true }
  }, [open, gomXuatMotPhan])

  const ketQua = useMemo(
    () => rows.filter((r) => viMatchAllWords(q, r.order_code, r.customer?.store_name, r.customer?.phone, r.sales_user?.full_name)),
    [rows, q]
  )
  const tong = ketQua.reduce((s, r) => s + (Number(r.total) || 0), 0)

  if (!open) return null

  return (
    <>
      <button type="button" aria-label="Đóng" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[var(--pos-ink)]/40" />
      <div
        role="dialog"
        aria-label="Xử lý đặt hàng"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 flex h-[640px] max-h-[calc(100vh-32px)] w-[1080px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,.28)]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--pos-line)] px-5">
          <h2 className="text-[16px] font-bold text-[var(--pos-ink)]">Xử lý đặt hàng — chọn đơn để tạo hóa đơn</h2>
          <button type="button" aria-label="Đóng" onClick={onClose} className="h-8 w-8 rounded-lg text-[18px] leading-none text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)]">×</button>
        </div>

        <div className="flex min-h-0 flex-grow">
          <aside className="w-[286px] shrink-0 overflow-y-auto border-r border-[var(--pos-line)] p-4">
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">Tìm theo</p>
            <input
              type="text"
              aria-label="Tìm đơn hàng"
              placeholder="Mã đơn, khách, SĐT, NV…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--pos-edge)] px-2.5 text-[12.5px]"
            />

            <p className="mb-1.5 mt-4 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">Lọc</p>
            <label className="flex items-start gap-2 py-1.5 text-[12.5px] text-[var(--pos-muted)]">
              <input
                type="checkbox"
                checked={gomXuatMotPhan}
                onChange={(e) => setGomXuatMotPhan(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--pos-primary)]"
              />
              <span>
                Gồm đơn đã xuất một phần
                <span className="mt-px block text-[11px] text-[var(--pos-dim)]">còn hàng chưa lập hóa đơn</span>
              </span>
            </label>

            <button
              type="button"
              onClick={() => { setQ(""); setGomXuatMotPhan(false) }}
              className="mt-3 text-[12px] font-semibold text-[var(--pos-primary)]"
            >
              Xoá tất cả bộ lọc
            </button>
          </aside>

          <div className="flex min-h-0 flex-grow flex-col">
            <div
              className="grid h-[34px] shrink-0 items-center border-b border-[var(--pos-line)] bg-[var(--pos-head)] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--pos-muted)]"
              style={{ gridTemplateColumns: COT, gap: 8 }}
            >
              <div>Mã đơn</div><div>Ngày đặt</div><div>Khách hàng</div>
              <div>Nhân viên bán</div><div>Trạng thái</div>
              <div style={{ textAlign: "right" }}>Tổng cộng</div><div />
            </div>

            <div className="min-h-0 flex-grow overflow-y-auto">
              {loi && <p className="px-4 py-4 text-[13px] font-semibold text-[var(--pos-danger)]">Không tải được — {loi}</p>}
              {!loi && dangTai && <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">Đang tải…</p>}
              {!loi && !dangTai && ketQua.length === 0 && (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">
                  Không có đơn phiếu tạm nào chờ tạo hóa đơn.
                </p>
              )}
              {ketQua.map((r) => (
                <div
                  key={r.id}
                  data-testid="don-cho-xu-ly"
                  className="grid min-h-[48px] items-center border-b border-[var(--pos-line-soft)] px-4"
                  style={{ gridTemplateColumns: COT, gap: 8 }}
                >
                  <div className="n text-[12.5px] font-semibold text-[var(--pos-ink)]">{r.order_code}</div>
                  <div className="n text-[11.5px] text-[var(--pos-muted)]">{formatDate(r.order_date)}</div>
                  <div className="truncate text-[12.5px] text-[var(--pos-ink)]">{r.customer?.store_name || "Khách lẻ"}</div>
                  <div className="truncate text-[12px] text-[var(--pos-muted)]">{r.sales_user?.full_name || "—"}</div>
                  <div className="text-[11.5px] text-[var(--pos-muted)]">
                    {ORDER_STATUS_MAP[r.status]?.label ?? "Phiếu tạm"}
                  </div>
                  <div className="n text-right text-[12.5px] text-[var(--pos-ink)]">{formatCurrency(r.total)}</div>
                  <div className="text-right">
                    <button
                      type="button"
                      aria-label={`Tạo hóa đơn cho ${r.order_code}`}
                      onClick={() => { onPick(r.id); onClose() }}
                      className="h-7 rounded-md bg-[var(--pos-primary)] px-3 text-[12px] font-semibold text-white"
                    >
                      Tạo HĐ
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex h-11 shrink-0 items-center justify-between border-t border-[var(--pos-line)] px-4">
              <span className="n text-[11.5px] text-[var(--pos-muted)]">{ketQua.length} đơn chờ xử lý</span>
              <span className="n text-[12px] font-semibold text-[var(--pos-ink)]">Tổng {formatCurrency(tong)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
