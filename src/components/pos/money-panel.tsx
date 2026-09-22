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
    tone === "warn" ? "text-[var(--pos-warn)]" : tone === "ok" ? "text-[var(--pos-ok)]" : tone === "muted" ? "text-[var(--pos-muted)]" : "text-[var(--pos-ink)]"
  const daDoi = prev != null && typeof value === "number" && prev !== value
  return (
    <div className="flex items-center justify-between py-[5px]">
      <span className="text-[13px] font-semibold text-[var(--pos-muted)]">{label}</span>
      <span className="text-right">
        {daDoi && <span className="n block text-[10.5px] text-[var(--pos-dim)] line-through">{formatCurrency(prev)}</span>}
        <span className={`n text-[14px] ${strong ? "font-extrabold" : "font-bold"} ${mau}`}>
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
      <label htmlFor={id} className="flex-grow text-[13px] text-[var(--pos-muted)]">
        {label}
      </label>
      <input
        id={id}
        className="n h-[34px] w-[78px] rounded-[10px] border-[1.5px] border-[var(--pos-edge)] px-2 text-right text-[14px] font-bold text-[var(--pos-ink)]"
        type="text"
        inputMode="decimal"
        value={discount.value === 0 ? "0" : String(discount.value)}
        onChange={(e) =>
          onChange({ value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0, unit: discount.unit })
        }
      />
      <div className="flex shrink-0 gap-0.5 rounded-[7px] bg-[var(--pos-line-soft)] p-0.5">
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
                  ? "bg-white font-bold text-[var(--pos-ink)] shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                  : "bg-transparent text-[var(--pos-muted)]"
              }`}
            >
              {u === "vnd" ? "VND" : unitLabel("pct")}
            </button>
          )
        })}
      </div>
      <span className="n w-[84px] text-right text-[14px] font-bold text-[var(--pos-ink)]">{formatCurrency(amount)}</span>
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
      ? { bg: "var(--pos-ok-soft)", border: "var(--pos-ok-border)", fg: "var(--pos-ok)", num: "var(--pos-ok)" }
      : { bg: "var(--pos-primary-faint)", border: "var(--pos-primary-border)", fg: "var(--pos-primary-deep)", num: "var(--pos-primary-deep)" }
  return (
    <div
      className="mt-2.5 rounded-[12px] border px-3.5 py-3"
      style={{ background: t.bg, borderColor: t.border }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-extrabold" style={{ color: t.fg }}>
          {label}
        </span>
        <span className="n text-[24px] font-extrabold" style={{ color: t.num }}>
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
            className={`h-[34px] flex-grow rounded-[10px] border-[1.5px] text-[12px] font-bold ${
              dang
                ? "border-[var(--pos-primary)] bg-[var(--pos-primary-faint)] font-semibold text-[var(--pos-primary-deep)]"
                : "border-[var(--pos-edge)] bg-white font-medium text-[var(--pos-muted)]"
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
        className="h-[34px] w-[34px] shrink-0 rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white text-[14px] leading-none text-[var(--pos-muted)] disabled:text-[var(--pos-edge)]"
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
          className="n h-[30px] flex-grow rounded-[8px] border-[1.5px] border-[var(--pos-line)] bg-[var(--pos-head)] text-[11.5px] font-bold text-[var(--pos-muted)] hover:border-[var(--pos-edge)]"
        >
          {formatCurrency(v)}
        </button>
      ))}
    </div>
  )
}

/**
 * Hàng nút đáy panel — cao 46px, spec §6.
 *
 * ⚠ HÀNG NÀY PHẢI TÁCH KHỎI NỀN (chủ nhà 22/09/2026: "Hai nút đấy cho
 *   rõ ràng lên hiện tại lẫn luôn vào nền"). Panel nền trắng, nút cũng
 *   nền trắng, viền nhạt — nhìn vào là một mảng trắng không có mép.
 *   Một vạch trên cùng và một nền xám nhạt đủ để mắt biết "đây là chỗ
 *   kết thúc, đây là hai việc cuối cùng phải làm".
 */
export function PanelActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 gap-2 border-t border-[var(--pos-line)] bg-[var(--pos-head)] p-3">
      {children}
    </div>
  )
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
  /**
   * ⚠ NÚT PHỤ TỪNG LÀ TRẮNG-TRÊN-TRẮNG: nền trắng, viền `--pos-line`
   *   mảnh, chữ `--pos-muted` xám — đặt trên panel trắng thì gần như
   *   không thấy. Nay nó có nền riêng, viền 1.5px và chữ đậm màu mực.
   *
   * ⚠ VÀ TRẠNG THÁI MỜ PHẢI ĐỌC RA LÀ MỜ. Bản trước không có kiểu
   *   `disabled` nào cho nút phụ, nên nút tắt trông y hệt nút bật —
   *   người dùng bấm mãi không ăn mà không hiểu vì sao. Nút mờ cũng
   *   PHẢI có `title` nói lý do (xem chỗ gọi).
   */
  const v =
    variant === "primary"
      ? "border-[1.5px] border-[var(--pos-primary-deep)] bg-[var(--pos-primary)] text-[14px] font-extrabold text-white " +
        "disabled:border-[var(--pos-line)] disabled:bg-[var(--pos-line-soft)] disabled:text-[var(--pos-dim)]"
      : variant === "warn"
        ? "border-[1.5px] border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] text-[13.5px] font-bold text-[var(--pos-warn)] " +
          "disabled:border-[var(--pos-line)] disabled:bg-[var(--pos-line-soft)] disabled:text-[var(--pos-dim)]"
        : "border-[1.5px] border-[var(--pos-edge)] bg-white text-[13.5px] font-bold text-[var(--pos-ink)] " +
          "disabled:border-[var(--pos-line)] disabled:bg-[var(--pos-line-soft)] disabled:text-[var(--pos-dim)]"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-[46px] rounded-[12px] ${v} ${width ? "" : "flex-grow"} disabled:cursor-not-allowed`}
      style={width ? { width } : undefined}
    >
      {children}
    </button>
  )
}
