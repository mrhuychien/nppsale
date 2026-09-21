"use client"

/**
 * BẢNG HÀNG TRẢ / HÀNG ĐỔI KÈM CHỨNG TỪ — spec §4, dải dưới bảng hàng.
 *
 * ⚠ HAI LOẠI DÒNG KHÔNG ĐƯỢC TRỘN, VÀ PHẢI CÓ NHÃN. Dòng TRẢ nhận hàng
 * về và CÓ trừ tiền; dòng ĐỔI lấy hàng mới ra và KHÔNG trừ tiền. Hiện
 * chung một danh sách không nhãn là người đọc cộng nhầm công nợ của
 * khách — đúng luật mà `ReturnSummary` của phần đang chạy đã ghi.
 *
 * ⚠ DÒNG ĐỔI HIỆN SỐ TIỀN GẠCH NGANG + CHỮ "không trừ tiền". Ẩn hẳn số
 * đi thì người lập phiếu không biết món ấy đáng bao nhiêu; để số trần
 * thì họ tưởng nó đang được trừ.
 */

import { useMemo } from "react"
import { formatCurrency } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { lineGross } from "@/lib/pos/discount"
import type { PosLine } from "@/lib/pos/types"
import type { SellProduct } from "@/lib/sell/ref-data"
import { POS_GRID, QtyStepper } from "@/components/pos/line-table"

export function ReturnExchangeTable({
  lines,
  onChange,
  products,
  reason,
  onReason,
  note,
  onNote,
}: {
  lines: PosLine[]
  onChange: (next: PosLine[]) => void
  products: SellProduct[]
  reason?: string
  onReason?: (v: string) => void
  note?: string
  onNote?: (v: string) => void
}) {
  const g = POS_GRID.returnDoc

  const { tienTra, tienDoi } = useMemo(() => {
    let tra = 0
    let doi = 0
    for (const l of lines) {
      const t = lineGross(l.qty, l.price)
      if (l.isExchange) doi += t
      else tra += t
    }
    return { tienTra: tra, tienDoi: doi }
  }, [lines])

  const patch = (key: string, p: Partial<PosLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)))

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
      <div
        className="grid h-[34px] items-center border-b border-[#e2e8f0] bg-[#f8fafc] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#64748b]"
        style={{ gridTemplateColumns: g.cols, gap: g.gap }}
      >
        <div>#</div><div>Loại</div><div>Mã hàng</div><div>Tên hàng</div>
        <div>Lô / HSD</div><div style={{ textAlign: "center" }}>SL</div>
        <div style={{ textAlign: "right" }}>Đơn giá</div>
        <div style={{ textAlign: "center" }}>Trừ tiền</div>
        <div style={{ textAlign: "right" }}>Thành tiền</div><div />
      </div>

      {lines.map((l, i) => {
        const tien = lineGross(l.qty, l.price)
        return (
          <div
            key={l.key}
            className="grid min-h-[52px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
            style={{ gridTemplateColumns: g.cols, gap: g.gap }}
          >
            <div className="n text-[11.5px] text-[#94a3b8]">{i + 1}</div>
            <select
              aria-label={`Loại dòng ${i + 1}`}
              value={l.isExchange ? "doi" : "tra"}
              onChange={(e) => patch(l.key, { isExchange: e.target.value === "doi" })}
              className={`h-7 w-full rounded-md border px-0.5 text-[11px] font-bold ${
                l.isExchange
                  ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
                  : "border-[#fde68a] bg-[#fffbeb] text-[#92400e]"
              }`}
            >
              <option value="tra">TRẢ</option>
              <option value="doi">ĐỔI</option>
            </select>
            <div className="n truncate text-[11px] text-[#64748b]">{l.sku || "—"}</div>
            <select
              aria-label={`Mặt hàng dòng ${i + 1}`}
              value={l.productId}
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value)
                patch(l.key, {
                  productId: e.target.value,
                  sku: p?.sku ?? "",
                  name: p?.name ?? "",
                  unit: p?.base_unit ?? "",
                  price: Number(p?.sell_price) || 0,
                })
              }}
              className="h-7 w-full min-w-0 rounded-md border border-[#cbd5e1] bg-white px-1 text-[12px] text-[#0f172a]"
            >
              <option value="">— chọn mặt hàng —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              aria-label={`Lô hàng dòng ${i + 1}`}
              value={l.lotId ?? ""}
              onChange={(e) => patch(l.key, { lotId: e.target.value || null })}
              className="h-7 w-full rounded-md border border-[#cbd5e1] bg-white px-1 text-[11px] text-[#0f172a]"
            >
              {/* ⚠ CHƯA CÓ DANH SÁCH LÔ THÌ NÓI THẾ, đừng để select rỗng
                  trông như đã chọn xong — xem `docs/pos-todo.md`. */}
              <option value="">chưa chọn lô</option>
              {(l.lots ?? []).map((lo) => (
                <option key={lo.id} value={lo.id}>
                  {lo.code}{lo.expiry ? ` · ${lo.expiry}` : ""}
                </option>
              ))}
            </select>
            <QtyStepper
              compact
              label={`số lượng ${l.isExchange ? "đổi" : "trả"} dòng ${i + 1}`}
              value={l.qty}
              onChange={(v) => patch(l.key, { qty: v })}
            />
            <input
              className="n h-7 w-full rounded-md border border-[#cbd5e1] px-1.5 text-right text-[12px] text-[#0f172a]"
              aria-label={`Đơn giá dòng ${i + 1}`}
              inputMode="numeric"
              value={l.price === 0 ? "0" : String(l.price)}
              onChange={(e) => patch(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            />
            <div className="flex justify-center">
              <input
                type="checkbox"
                aria-label={`Trừ tiền dòng ${i + 1}`}
                checked={!l.isExchange}
                onChange={(e) => patch(l.key, { isExchange: !e.target.checked })}
                className="h-4 w-4 accent-[#2563eb]"
              />
            </div>
            <div className="text-right">
              {l.isExchange ? (
                <>
                  <div className="n text-[12px] text-[#94a3b8] line-through">{formatCurrency(tien)}</div>
                  <div className="text-[9.5px] font-semibold text-[#2563eb]">không trừ tiền</div>
                </>
              ) : (
                <div className="n text-[13px] font-bold text-[#b45309]">{formatCurrency(tien)}</div>
              )}
            </div>
            <button
              type="button"
              aria-label={`Xoá dòng ${l.isExchange ? "đổi" : "trả"} ${i + 1}`}
              onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              className="flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[#f1f5f9]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
              </svg>
            </button>
          </div>
        )
      })}

      <div className="flex h-10 items-center gap-2.5 bg-[#f8fafc] px-4">
        <select
          aria-label="Lý do trả hàng"
          value={reason ?? "damaged"}
          onChange={(e) => onReason?.(e.target.value)}
          disabled={!onReason}
          className="h-7 rounded-md border border-[#cbd5e1] bg-white px-1.5 text-[11.5px] text-[#0f172a] disabled:bg-[#f1f5f9]"
        >
          {/* ⚠ Đúng bộ CHECK của `returns.reason` — xem `ReturnScreen`. */}
          {RETURN_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Ghi chú phiếu trả"
          placeholder="Ghi chú phiếu trả…"
          value={note ?? ""}
          onChange={(e) => onNote?.(e.target.value)}
          disabled={!onNote}
          className="h-7 min-w-0 flex-grow rounded-md border border-[#e2e8f0] bg-white px-2 text-[11.5px] text-[#334155] disabled:bg-[#f1f5f9]"
        />
        <span className="shrink-0 text-[11px] text-[#64748b]">
          Trả trừ công nợ <strong className="n text-[#b45309]">{formatCurrency(tienTra)}</strong>
          {" · "}Đổi không trừ <strong className="n text-[#2563eb]">{formatCurrency(tienDoi)}</strong>
        </span>
      </div>
    </div>
  )
}
