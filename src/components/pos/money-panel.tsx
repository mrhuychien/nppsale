"use client"

/**
 * PANEL TIỀN BÊN PHẢI — spec §6.
 *
 * Cấu trúc chung cho cả 6 chứng từ: `[card đối tác] [card tiền] [hàng
 * nút 46px]`. Các mảnh dưới đây là vật liệu; mỗi màn tự xếp theo bảng
 * trong spec §6 chứ không có một component "panel vạn năng" — sáu
 * chứng từ có sáu danh sách dòng khác nhau, nhồi vào một component là
 * một hàm đầy `if`.
 */

import type { ReactNode } from "react"
import { formatCurrency } from "@/lib/utils"
import { unitLabel, type DiscountInput } from "@/lib/pos/discount"
import { POS_PAY_LABEL, type PosPayMethod } from "@/lib/pos/types"

/** Một dòng tiền thường: nhãn trái, số phải. */
export function MoneyRow({
  label,
  value,
  tone,
  strong,
  prev,
}: {
  label: ReactNode
  value: number | string
  tone?: "muted" | "warn" | "ok"
  strong?: boolean
  /** Số TRƯỚC khi sửa — gạch ngang phía trên. Spec §7. */
  prev?: number | null
}) {
  const mau =
    tone === "warn" ? "text-[#b45309]" : tone === "ok" ? "text-[#16a34a]" : tone === "muted" ? "text-[#64748b]" : "text-[#0f172a]"
  const daDoi = prev != null && typeof value === "number" && prev !== value
  return (
    <div className="flex items-center justify-between py-[5px]">
      <span className={`text-[13px] ${tone === "muted" ? "text-[#64748b]" : "text-[#334155]"}`}>{label}</span>
      <span className="text-right">
        {daDoi && <span className="n block text-[10.5px] text-[#94a3b8] line-through">{formatCurrency(prev)}</span>}
        <span className={`n text-[13.5px] ${strong ? "font-bold" : ""} ${mau}`}>
          {typeof value === "number" ? formatCurrency(value) : value}
        </span>
      </span>
    </div>
  )
}

/**
 * Dòng giảm giá cấp chứng từ: nhãn + input + segmented ₫/% + số đã quy.
 *
 * ⚠ SEGMENTED HAI NÚT, KHÔNG PHẢI POPOVER (spec §5). Popover giấu
 * trạng thái sau một cú bấm: người dùng nhìn `396.400` mà không biết
 * nó ra từ `5%` hay từ một số gõ tay, nên cũng không biết đổi số lượng
 * thì nó có chạy theo không.
 */
export function DocDiscountRow({
  id,
  label,
  discount,
  amount,
  onChange,
}: {
  id: string
  label: string
  discount: DiscountInput
  /** Số đã quy ra đồng — tính ở `posTotals`, đừng tính lại ở đây. */
  amount: number
  onChange: (d: DiscountInput) => void
}) {
  return (
    <div className="flex items-center gap-2 py-[5px]">
      <label htmlFor={id} className="flex-grow text-[13px] text-[#334155]">
        {label}
      </label>
      <input
        id={id}
        className="n h-[30px] w-[74px] rounded-md border border-[#cbd5e1] px-[7px] text-right text-[12.5px] text-[#0f172a]"
        type="text"
        inputMode="decimal"
        value={discount.value === 0 ? "0" : String(discount.value)}
        onChange={(e) =>
          onChange({ value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0, unit: discount.unit })
        }
      />
      <div className="flex shrink-0 gap-0.5 rounded-[7px] bg-[#f1f5f9] p-0.5">
        {(["vnd", "pct"] as const).map((u) => {
          const dang = discount.unit === u
          return (
            <button
              key={u}
              type="button"
              aria-pressed={dang}
              aria-label={`${label} — đơn vị ${u === "vnd" ? "đồng" : "phần trăm"}`}
              /* ⚠ ĐỔI ĐƠN VỊ Ở CẤP CHỨNG TỪ CŨNG GIỮ SỐ TIỀN — cùng luật
                 với cấp dòng. Nơi gọi dùng `switchUnit`, không tự đặt. */
              onClick={() => { if (!dang) onChange({ value: discount.value, unit: u }) }}
              className={`h-[26px] rounded-[5px] text-[11px] ${u === "vnd" ? "w-[38px]" : "w-7"} ${
                dang
                  ? "bg-white font-bold text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                  : "bg-transparent text-[#64748b]"
              }`}
            >
              {u === "vnd" ? "VND" : unitLabel("pct")}
            </button>
          )
        })}
      </div>
      <span className="n w-[84px] text-right text-[13.5px] text-[#0f172a]">{formatCurrency(amount)}</span>
    </div>
  )
}

/** Hộp số lớn — spec §6: label 13.5px/600, số 22–24px/700. */
export function TotalsHero({
  label,
  value,
  tone = "blue",
  sub,
}: {
  label: string
  value: number
  tone?: "blue" | "green"
  sub?: ReactNode
}) {
  const t =
    tone === "green"
      ? { bg: "#f0fdf4", border: "#bbf7d0", fg: "#166534", num: "#16a34a" }
      : { bg: "#eff6ff", border: "#bfdbfe", fg: "#1e3a8a", num: "#1d4ed8" }
  return (
    <div
      className="mt-2.5 rounded-[10px] border px-3.5 py-3"
      style={{ background: t.bg, borderColor: t.border }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold" style={{ color: t.fg }}>
          {label}
        </span>
        <span className="n text-[24px] font-bold" style={{ color: t.num }}>
          {formatCurrency(value)}
        </span>
      </div>
      {sub && <div className="mt-1 text-[11.5px]" style={{ color: t.fg }}>{sub}</div>}
    </div>
  )
}

/**
 * Ba nút phương thức + nút chia nhiều.
 *
 * ⚠ "GHI NỢ HẾT" LÀ MẶC ĐỊNH (spec §6). Bán sỉ thì ghi nợ là chuyện
 * thường ngày; copy mặc định "trả đủ" của POS bán lẻ là mỗi đơn lại
 * phải sửa một lần, và hôm nào quên sửa thì sổ ghi đã thu tiền.
 */
export function PaymentButtons({
  value,
  onChange,
  onSplit,
}: {
  value: PosPayMethod
  onChange: (m: PosPayMethod) => void
  onSplit?: () => void
}) {
  return (
    <div className="mt-2 flex gap-1.5">
      {(["no", "tien-mat", "chuyen-khoan"] as const).map((m) => {
        const dang = value === m
        return (
          <button
            key={m}
            type="button"
            aria-pressed={dang}
            onClick={() => onChange(m)}
            className={`h-8 flex-grow rounded-[7px] border text-[12px] ${
              dang
                ? "border-[#2563eb] bg-[#eff6ff] font-semibold text-[#1d4ed8]"
                : "border-[#cbd5e1] bg-white font-medium text-[#334155]"
            }`}
          >
            {POS_PAY_LABEL[m]}
          </button>
        )
      })}
      <button
        type="button"
        aria-label="Chia nhiều phương thức"
        onClick={onSplit}
        disabled={!onSplit}
        className="h-8 w-8 shrink-0 rounded-[7px] border border-[#cbd5e1] bg-white text-[14px] leading-none text-[#334155] disabled:text-[#cbd5e1]"
      >
        ⋮
      </button>
    </div>
  )
}

/** Chip mệnh giá gợi ý — spec §6. Tắt được ở drawer thiết lập. */
export function CashChips({
  values,
  onPick,
}: {
  values: number[]
  onPick: (v: number) => void
}) {
  if (values.length === 0) return null
  return (
    <div className="mt-1.5 flex gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="n h-7 flex-grow rounded-md border border-[#e2e8f0] bg-[#f8fafc] text-[11.5px] text-[#334155] hover:border-[#cbd5e1]"
        >
          {formatCurrency(v)}
        </button>
      ))}
    </div>
  )
}

/** Hàng nút đáy panel — cao 46px, spec §6. */
export function PanelActions({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 gap-2">{children}</div>
}

export function PanelButton({
  children,
  onClick,
  variant = "ghost",
  width,
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: "primary" | "ghost" | "warn"
  width?: number
  disabled?: boolean
  /** ⚠ Nút mờ PHẢI nói vì sao — xem `QtyStepper`. */
  title?: string
}) {
  const v =
    variant === "primary"
      ? "border-none bg-[#2563eb] text-[14px] font-bold text-white disabled:bg-[#93c5fd]"
      : variant === "warn"
        ? "border border-[#f59e0b] bg-white text-[13px] font-semibold text-[#92400e]"
        : "border border-[#cbd5e1] bg-white text-[13px] font-semibold text-[#334155]"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-[46px] rounded-[10px] ${v} ${width ? "" : "flex-grow"} disabled:cursor-not-allowed`}
      style={width ? { width } : undefined}
    >
      {children}
    </button>
  )
}
