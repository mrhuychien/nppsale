"use client"

/**
 * BẢNG DÒNG HÀNG — spec §4. Dùng chung cho cả 6 loại chứng từ, khác
 * nhau ở CẤU HÌNH CỘT chứ không phải ở component.
 *
 * ⚠ MỘT BẢNG CHO SÁU CHỨNG TỪ, ĐÚNG LÝ DO CỦA `ReturnSummary`. Sáu
 * bảng riêng là sáu chỗ phải sửa khi đổi một quy tắc giảm giá, và năm
 * trong sáu chỗ ấy sẽ bị quên.
 *
 * ⚠ KHÔNG DÙNG `<table>`. Spec §4 cấp sẵn `grid-template-columns` cho
 * từng loại chứng từ, và mỗi ô chứa control thật (select, stepper,
 * input). Lưới CSS giữ đúng các con số ấy; `<table>` thì trình duyệt
 * tự co giãn cột theo nội dung và mọi chứng từ lệch nhau một ít.
 */

import { useState, type ReactNode } from "react"
import { discountAmount, lineGross, switchUnit, unitAriaLabel, unitLabel } from "@/lib/pos/discount"
import type { PosLine } from "@/lib/pos/types"
import { formatCurrency } from "@/lib/utils"

/** Cấu hình cột theo spec §4 — `grid-template-columns` và `gap`. */
export const POS_GRID = {
  order: { cols: "28px 88px minmax(0,1fr) 76px 96px 100px 92px 116px 28px", gap: 8 },
  invoiceView: { cols: "26px 84px minmax(0,1fr) 62px 66px 92px 92px 48px 104px 26px", gap: 8 },
  invoiceEdit: { cols: "24px 80px minmax(0,1fr) 62px 98px 84px 88px 92px 96px 24px", gap: 7 },
  returnDoc: { cols: "24px 64px 80px minmax(0,1fr) 96px 56px 84px 84px 56px 92px 24px", gap: 7 },
  purchase: { cols: "24px 80px minmax(0,1fr) 56px 92px 84px 96px 92px 108px 24px", gap: 7 },
  supplierReturn: { cols: "24px 80px minmax(0,1fr) 92px 60px 84px 96px 92px 104px 24px", gap: 7 },
} as const

export type PosGridKey = keyof typeof POS_GRID

export function LineTableFrame({
  header,
  children,
  footer,
}: {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    /* ⚠ `min-h-0` — xem `PosShell`. Thiếu nó thì bảng phình theo nội
       dung và đẩy hàng nút ra ngoài màn thay vì tự cuộn. */
    <div className="flex min-h-0 flex-grow flex-col overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
      {header}
      <div className="min-h-0 flex-grow overflow-y-auto">{children}</div>
      {footer}
    </div>
  )
}

export function LineTableHeader({
  grid,
  cells,
  cols,
}: {
  grid: PosGridKey
  cells: Array<{ label: string; align?: "left" | "center" | "right" }>
  /**
   * Đè `grid-template-columns` của `POS_GRID`.
   *
   * ⚠ DÀNH CHO BẢNG CÓ CỘT BẬT/TẮT ĐƯỢC (màn đơn hàng, theo drawer
   * thiết lập). Tắt một cột mà vẫn dùng lưới cứng là để lại một khoảng
   * trống giữa bảng — nơi gọi phải dựng lưới và bộ ô TỪ CÙNG một nguồn,
   * nếu không hai thứ lệch nhau một cột là cả bảng so le.
   */
  cols?: string
}) {
  const g = POS_GRID[grid]
  return (
    <div
      className="grid h-[38px] shrink-0 items-center border-b border-[#e2e8f0] bg-[#f8fafc] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#64748b]"
      style={{ gridTemplateColumns: cols ?? g.cols, gap: g.gap }}
    >
      {cells.map((c, i) => (
        <div
          key={`${c.label}-${i}`}
          style={{ textAlign: c.align ?? "left" }}
        >
          {c.label}
        </div>
      ))}
    </div>
  )
}

/** Ô số lượng — spec §4: stepper `− [n] +`, bấm số để gõ tay. */
export function QtyStepper({
  value,
  onChange,
  label,
  min = 0,
  compact,
}: {
  value: number
  onChange: (v: number) => void
  /** Ví dụ: `số lượng dòng 3` — dùng để dựng `aria-label` cho hai nút. */
  label: string
  /**
   * ⚠ SÀN CỦA MÀN SỬA ĐƠN (spec §7.1). Dòng đã xuất 3 thì không giảm
   * xuống 2 — đó là ghi một đơn nhỏ hơn số hàng đã rời kho.
   */
  min?: number
  compact?: boolean
}) {
  const [dangGo, setDangGo] = useState(false)
  const h = compact ? "h-7" : "h-[30px]"
  const nut = compact ? "h-[26px] w-6 text-[13px]" : "h-7 w-[26px] text-[14px]"
  const chamSan = value <= min

  return (
    <div className={`flex ${h} items-center justify-center overflow-hidden rounded-[7px] border border-[#cbd5e1]`}>
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        disabled={chamSan}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={`${nut} shrink-0 border-none bg-[#f8fafc] text-[#334155] disabled:cursor-not-allowed disabled:text-[#cbd5e1]`}
        /* ⚠ NÓI VÌ SAO MỜ. Nút mờ không giải thích là người dùng bấm
           mãi rồi kết luận màn hình hỏng. */
        title={chamSan && min > 0 ? `Không giảm dưới ${min} — phần đã xuất` : undefined}
      >
        −
      </button>
      {dangGo ? (
        <input
          className="n min-w-0 flex-grow bg-transparent text-center text-[13px] font-semibold text-[#0f172a] outline-none"
          aria-label={label}
          autoFocus
          type="number"
          min={min}
          value={value}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
          onBlur={() => setDangGo(false)}
          onKeyDown={(e) => { if (e.key === "Enter") setDangGo(false) }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDangGo(true)}
          aria-label={`${label} — đang là ${value}, bấm để nhập tay`}
          className="n min-w-0 flex-grow text-center text-[13px] font-semibold text-[#0f172a]"
        >
          {value}
        </button>
      )}
      <button
        type="button"
        aria-label={`Tăng ${label}`}
        onClick={() => onChange(value + 1)}
        className={`${nut} shrink-0 border-none bg-[#f8fafc] text-[#334155]`}
      >
        +
      </button>
    </div>
  )
}

/**
 * Ô GIẢM GIÁ — input + nút lật ₫/% ngay trên dòng. Spec §5.
 *
 * ⚠ NÚT LẬT GIỮ NGUYÊN SỐ TIỀN, chỉ đổi cách nhập. Luật nằm ở
 * `switchUnit`, và nó có chốt chạy thật — đừng tính lại ở đây.
 */
export function DiscountCell({
  line,
  index,
  onChange,
}: {
  line: PosLine
  /** Số thứ tự dòng, 1-based — chỉ để dựng câu `aria-label`. */
  index: number
  onChange: (d: PosLine["discount"]) => void
}) {
  const gross = lineGross(line.qty, line.price)
  const dangPhanTram = line.discount.unit === "pct"
  return (
    <div className="flex items-center gap-1">
      <input
        className={`n h-7 w-0 flex-grow rounded-md border px-[5px] text-right text-[11.5px] ${
          dangPhanTram || line.discount.value > 0
            ? "border-[#2563eb] font-semibold text-[#0f172a]"
            : "border-[#cbd5e1] font-normal text-[#64748b]"
        }`}
        type="text"
        inputMode="decimal"
        aria-label={`Giảm giá dòng ${index}`}
        value={line.discount.value === 0 ? "0" : String(line.discount.value)}
        onChange={(e) =>
          onChange({ value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0, unit: line.discount.unit })
        }
      />
      <button
        type="button"
        aria-label={unitAriaLabel(line.discount.unit, index)}
        onClick={() => onChange(switchUnit(line.discount, gross))}
        className={`h-7 w-[26px] shrink-0 rounded-md border text-[12px] font-bold leading-none ${
          dangPhanTram
            ? "border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]"
            : "border-[#cbd5e1] bg-[#f8fafc] text-[#475569]"
        }`}
      >
        {unitLabel(line.discount.unit)}
      </button>
    </div>
  )
}

/** Thành tiền của dòng, kèm số CŨ gạch ngang khi đang sửa — spec §7. */
export function LineAmountCell({ line }: { line: PosLine }) {
  const g = lineGross(line.qty, line.price)
  const now = g - discountAmount(line.discount, g)
  const truoc = line.prevAmount
  /**
   * ⚠ CHỈ GẠCH KHI SỐ THẬT SỰ ĐỔI. Vẽ số cũ bằng số mới là thêm một
   * dòng nhiễu và làm người đọc đi tìm chỗ khác biệt không có.
   */
  const daDoi = truoc != null && truoc !== now
  return (
    <div className="text-right">
      {daDoi && (
        <div className="n text-[10.5px] text-[#94a3b8] line-through">{formatCurrency(truoc)}</div>
      )}
      <div className="n text-[13.5px] font-bold text-[#0f172a]">{formatCurrency(now)}</div>
    </div>
  )
}

/** Menu ⋮ của dòng — spec §4, đúng 5 mục và `Xoá dòng` màu đỏ. */
export function LineMenu({
  index,
  onNote,
  onLot,
  onLastPrice,
  onDetail,
  onRemove,
}: {
  index: number
  onNote?: () => void
  onLot?: () => void
  onLastPrice?: () => void
  onDetail?: () => void
  onRemove: () => void
}) {
  const [mo, setMo] = useState(false)
  const muc: Array<{ text: string; fn?: () => void; danger?: boolean }> = [
    { text: "Xem giá bán gần nhất", fn: onLastPrice },
    { text: "Ghi chú dòng", fn: onNote },
    { text: "Đổi lô & hạn sử dụng", fn: onLot },
    { text: "Xem chi tiết hàng hóa", fn: onDetail },
    { text: "Xoá dòng", fn: onRemove, danger: true },
  ]
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Thao tác dòng ${index}`}
        aria-expanded={mo}
        onClick={() => setMo((v) => !v)}
        className={`h-6 w-6 rounded-md text-[15px] leading-none ${
          mo ? "bg-[#e2e8f0] text-[#334155]" : "text-[#94a3b8] hover:bg-[#f1f5f9]"
        }`}
      >
        ⋮
      </button>
      {mo && (
        <>
          {/*
            ⚠ LỚP CHẶN LÀ `<button>` PHỦ MÀN, không phải `div`. Bấm ra
              ngoài để đóng là một hành động; `div` thì bàn phím không
              tới được và người dùng bàn phím kẹt trong menu.
          */}
          <button
            type="button"
            aria-label="Đóng menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMo(false)}
          />
          <div className="absolute right-0 top-7 z-20 w-[212px] overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white py-1 shadow-[0_10px_30px_rgba(15,23,42,.13)]">
            {muc.map((m, i) => (
              <div key={m.text}>
                {i === muc.length - 1 && <div className="my-1 h-px bg-[#f1f5f9]" />}
                <button
                  type="button"
                  disabled={!m.fn}
                  onClick={() => { setMo(false); m.fn?.() }}
                  className={`block w-full px-3 py-[7px] text-left text-[12.5px] disabled:cursor-not-allowed disabled:text-[#cbd5e1] ${
                    m.danger ? "text-[#dc2626] hover:bg-[#fef2f2]" : "text-[#334155] hover:bg-[#f8fafc]"
                  }`}
                >
                  {m.text}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * DẢI CẢNH BÁO BÁN ÂM — spec §4.
 *
 * ⚠ CHỈ CẢNH BÁO, KHÔNG CHẶN NÚT. Spec chốt nguyên văn. Nhà phân phối
 * bán trước rồi nhập bù là nghiệp vụ có thật; chặn ở đây là màn hình
 * tự quyết thay chủ.
 */
export function NegativeStockStrip({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <div className="shrink-0 bg-[#fef2f2] px-4 py-2 text-[11.5px] text-[#991b1b]">
      {count} dòng vượt tồn kho bán — tồn sẽ âm cho tới khi nhập bù.
    </div>
  )
}
