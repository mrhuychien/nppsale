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
import { MoneyInput } from "@/components/ui/money-input"
import { PercentInput } from "@/components/ui/percent-input"
import { vatLabel } from "@/lib/constants"

/**
 * Cấu hình cột theo spec §4 — `grid-template-columns` và `gap`.
 *
 * ⚠ CỘT CUỐI RỘNG 60px VÌ NÓ CHỨA HAI NÚT: `⋮` và `×`. Trước
 *   22/09/2026 cột ấy rộng 24–28px và chỉ có `⋮`, tức muốn xoá một dòng
 *   phải bấm hai lần và đọc một menu năm mục. Chủ nhà chốt: "thêm nút
 *   xóa dòng vào chỉ cần dấu x to chút dễ bấm là được."
 *
 * ⚠ HAI NÚT PHẢI NẰM TRONG MỘT Ô LƯỚI. Đặt chúng thành hai con trực
 *   tiếp của lưới là bảng thừa một cột và MỌI dòng so le với đầu bảng —
 *   xem `LineMenu`, nó tự bọc cả hai.
 */
export const POS_GRID = {
  order: { cols: "28px 88px minmax(0,1fr) 76px 96px 100px 92px 116px 60px", gap: 8 },
  invoiceView: { cols: "26px 84px minmax(0,1fr) 62px 66px 92px 92px 48px 104px 26px", gap: 8 },
  invoiceEdit: { cols: "24px 80px minmax(0,1fr) 62px 98px 84px 88px 92px 96px 60px", gap: 7 },
  returnDoc: { cols: "24px 64px 80px minmax(0,1fr) 96px 56px 84px 84px 56px 92px 24px", gap: 7 },
  purchase: { cols: "24px 80px minmax(0,1fr) 56px 92px 84px 96px 92px 108px 60px", gap: 7 },
  supplierReturn: { cols: "24px 80px minmax(0,1fr) 92px 60px 84px 96px 92px 104px 60px", gap: 7 },
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
    <div className="flex min-h-0 flex-grow flex-col overflow-hidden rounded-[14px] border border-[var(--pos-line)] bg-white">
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
      className="grid h-[42px] shrink-0 items-center border-b border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-3.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--pos-muted)]"
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
  /* ⚠ CỠ THEO BẢN THIẾT KẾ 21/09/2026: ô nhập cao 38px, bo 10px, viền
     1.5px. Chế độ gọn giữ nhỏ hơn một bậc — nó có lý do riêng (xem
     `DisplaySettingsDrawer`), không phải bản chưa chỉnh. */
  const h = compact ? "h-[32px]" : "h-[38px]"
  const nut = compact ? "h-[30px] w-6 text-[15px]" : "h-[36px] w-7 text-[19px]"
  const chamSan = value <= min

  return (
    <div className={`flex ${h} items-center justify-center overflow-hidden rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white`}>
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        disabled={chamSan}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={`${nut} shrink-0 border-0 border-r-[1.5px] border-[var(--pos-line-soft)] bg-white font-bold leading-none text-[var(--pos-primary)] disabled:cursor-not-allowed disabled:text-[var(--pos-edge)]`}
        /* ⚠ NÓI VÌ SAO MỜ. Nút mờ không giải thích là người dùng bấm
           mãi rồi kết luận màn hình hỏng. */
        title={chamSan && min > 0 ? `Không giảm dưới ${min} — phần đã xuất` : undefined}
      >
        −
      </button>
      {dangGo ? (
        <input
          className="n min-w-0 flex-grow bg-transparent text-center text-[15px] font-extrabold text-[var(--pos-ink)] outline-none"
          aria-label={label}
          autoFocus
          type="number"
          min={min}
          value={value}
          /* Bấm vào là CHỌN SẴN số cũ — gõ là thay, không phải xoá 0 trước. */
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
          onBlur={() => setDangGo(false)}
          onKeyDown={(e) => { if (e.key === "Enter") setDangGo(false) }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setDangGo(true)}
          aria-label={`${label} — đang là ${value}, bấm để nhập tay`}
          className="n min-w-0 flex-grow text-center text-[15px] font-extrabold text-[var(--pos-ink)]"
        >
          {value}
        </button>
      )}
      <button
        type="button"
        aria-label={`Tăng ${label}`}
        onClick={() => onChange(value + 1)}
        className={`${nut} shrink-0 border-0 border-l-[1.5px] border-[var(--pos-line-soft)] bg-white font-bold leading-none text-[var(--pos-primary)]`}
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
  const oVien =
    dangPhanTram || line.discount.value > 0
      ? "border-[var(--pos-primary-border)] font-bold text-[var(--pos-ink)]"
      : "border-[var(--pos-edge)] font-normal text-[var(--pos-muted)]"
  return (
    <div className="flex items-center gap-1">
      {/* ⚠ HAI Ô KHÁC NHAU CHO HAI ĐƠN VỊ. Giảm theo đồng thì hiện nhóm
          nghìn (220.000) bằng MoneyInput; giảm theo % thì cần dấu thập phân
          (2.5%) mà MoneyInput lọc mất, nên giữ ô chữ thường. */}
      {dangPhanTram ? (
        <PercentInput
          className={`n h-[34px] w-0 flex-grow rounded-[10px] border-[1.5px] px-2 text-right text-[13px] ${oVien}`}
          aria-label={`Giảm giá dòng ${index}`}
          value={line.discount.value}
          onChange={(v) => onChange({ value: v, unit: line.discount.unit })}
        />
      ) : (
        <MoneyInput
          showSuffix={false}
          className="w-0 flex-grow"
          inputClassName={`n h-[34px] rounded-[10px] border-[1.5px] px-2 py-0 text-right text-[13px] lg:h-[34px] focus-visible:ring-1 focus-visible:ring-offset-0 ${oVien}`}
          aria-label={`Giảm giá dòng ${index}`}
          value={line.discount.value}
          onChange={(v) => onChange({ value: v, unit: line.discount.unit })}
        />
      )}
      <button
        type="button"
        aria-label={unitAriaLabel(line.discount.unit, index)}
        onClick={() => onChange(switchUnit(line.discount, gross))}
        className={`h-[34px] w-[30px] shrink-0 rounded-[10px] border-[1.5px] text-[13px] font-extrabold leading-none ${
          dangPhanTram
            ? "border-[var(--pos-primary)] bg-[var(--pos-primary-faint)] text-[var(--pos-primary-deep)]"
            : "border-[var(--pos-edge)] bg-[var(--pos-head)] text-[var(--pos-muted)]"
        }`}
      >
        {unitLabel(line.discount.unit)}
      </button>
    </div>
  )
}

/**
 * NÚT BẬC THUẾ — bấm một cái nhảy bậc: 0% → 5% → 8% → 10% → 0%.
 *
 * Chủ nhà chốt 22/09/2026: "tạo 1 nút bấm như nút giảm giá, mặc định là
 * 0 bấm vào -> 5 -> 8 -> 10 -> 0".
 *
 * ⚠ MỘT COMPONENT CHO CẢ DÒNG LẪN CẢ ĐƠN. Chủ nhà chốt "Đơn tổng cũng
 *   thiếu VAT (làm tương tự)" — hai nút trông khác nhau cho cùng một
 *   việc là người dùng phải học hai lần.
 *
 * ⚠ 0% VẪN PHẢI SÁNG RÕ, KHÔNG MỜ ĐI. Một nút mờ đọc ra là "chưa dùng
 *   được"; ở đây 0% là một lựa chọn thật và là lựa chọn thường ngày.
 *   Chỉ khác sắc: có thuế thì xanh, không thuế thì trung tính.
 */
export function VatChip({
  rate,
  onNext,
  label,
  ariaLabel,
  mixed = false,
}: {
  /** Thuế suất theo TỈ LỆ (0.08 = 8%). */
  rate: number
  onNext: () => void
  /** Chữ phụ đứng trước con số, ví dụ "VAT". */
  label?: string
  ariaLabel: string
  /** Các dòng đang lệch thuế suất — hiện "—" thay vì một con số sai. */
  mixed?: boolean
}) {
  const coThue = !mixed && (Number(rate) || 0) > 0
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={
        mixed
          ? "Các dòng đang có thuế suất khác nhau — bấm để đưa tất cả về 0%"
          : "Bấm để đổi bậc thuế: 0% → 5% → 8% → 10%"
      }
      onClick={onNext}
      className={`n h-[34px] w-full rounded-[10px] border-[1.5px] px-1 text-[12.5px] font-extrabold leading-none ${
        coThue
          ? "border-[var(--pos-primary)] bg-[var(--pos-primary-faint)] text-[var(--pos-primary-deep)]"
          : "border-[var(--pos-edge)] bg-[var(--pos-head)] text-[var(--pos-muted)]"
      }`}
    >
      {label ? `${label} ` : ""}
      {mixed ? "—" : vatLabel(rate)}
    </button>
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
        <div className="n text-[10.5px] text-[var(--pos-dim)] line-through">{formatCurrency(truoc)}</div>
      )}
      <div className="n text-[14px] font-extrabold text-[var(--pos-ink)]">{formatCurrency(now)}</div>
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
    <div className="relative flex items-center gap-0.5">
      <button
        type="button"
        aria-label={`Thao tác dòng ${index}`}
        aria-expanded={mo}
        onClick={() => setMo((v) => !v)}
        className={`h-6 w-6 shrink-0 rounded-md text-[15px] leading-none ${
          mo ? "bg-[var(--pos-line)] text-[var(--pos-muted)]" : "text-[var(--pos-dim)] hover:bg-[var(--pos-line-soft)]"
        }`}
      >
        ⋮
      </button>
      {/*
        ⚠ XOÁ DÒNG PHẢI LÀ MỘT CÚ BẤM, KHÔNG PHẢI HAI. Chủ nhà chốt
          22/09/2026: "thêm nút xóa dòng vào chỉ cần dấu x to chút dễ
          bấm là được". Xoá một dòng gõ nhầm là việc làm nhiều nhất
          trên màn này; chôn nó dưới `⋮` là bắt đọc một menu năm mục
          mỗi lần.

        ⚠ MỤC "XOÁ DÒNG" TRONG MENU VẪN GIỮ. Bỏ đi là người đã quen tay
          với menu mất đường cũ, mà chẳng được gì — hai lối vào cùng
          một việc không hại ai.

        ⚠ VÙNG BẤM 30px, KHÔNG PHẢI CỠ CHỮ 30px. Một dấu × to mà vùng
          bấm bé thì vẫn khó trúng — đây là thứ chủ nhà vừa kêu.
      */}
      <button
        type="button"
        aria-label={`Xoá dòng ${index}`}
        title={`Xoá dòng ${index}`}
        onClick={onRemove}
        className="h-[30px] w-[30px] shrink-0 rounded-[8px] text-[20px] leading-none text-[var(--pos-dim)] hover:bg-[var(--pos-danger-soft)] hover:text-[var(--pos-danger)]"
      >
        ×
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
          <div className="absolute right-0 top-7 z-20 w-[212px] overflow-hidden rounded-[10px] border border-[var(--pos-line)] bg-white py-1 shadow-[0_10px_30px_rgba(15,23,42,.13)]">
            {muc.map((m, i) => (
              <div key={m.text}>
                {i === muc.length - 1 && <div className="my-1 h-px bg-[var(--pos-line-soft)]" />}
                <button
                  type="button"
                  disabled={!m.fn}
                  onClick={() => { setMo(false); m.fn?.() }}
                  className={`block w-full px-3 py-[7px] text-left text-[12.5px] disabled:cursor-not-allowed disabled:text-[var(--pos-edge)] ${
                    m.danger ? "text-[var(--pos-danger)] hover:bg-[var(--pos-danger-soft)]" : "text-[var(--pos-muted)] hover:bg-[var(--pos-head)]"
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
    <div className="shrink-0 bg-[var(--pos-danger-soft)] px-4 py-2 text-[11.5px] text-[var(--pos-danger)]">
      {count} dòng vượt tồn kho bán — tồn sẽ âm cho tới khi nhập bù.
    </div>
  )
}

/* ==================================================================
 * KHUÔN DÒNG MỚI — chủ nhà chốt 24/09/2026 cho Đơn hàng · Hóa đơn · Trả hàng:
 *   "Bỏ VAT từng dòng, phần giảm giá, cho vào chi tiết dòng, bấm vào mới hiện
 *   lên trên dòng. Nút xoá dòng thành thùng rác ra đầu dòng. Nút chọn đơn vị
 *   tính cho cạnh ô số lượng (bấm vào nhảy lần lượt, không dàn hàng)."
 *
 * ⚠ BA MẢNH DÙNG CHUNG CHO CẢ BA MÀN — ba bản tự vẽ là ba bản lệch nhau.
 * ================================================================== */

/** Đơn vị kế tiếp trong vòng — đơn vị cuối thì quay về đầu. Lạ thì về đầu. */
export function donViKeTiep(ds: readonly string[], dang: string): string {
  if (ds.length === 0) return dang
  const i = ds.indexOf(dang)
  return ds[(i + 1) % ds.length] ?? ds[0]
}

/**
 * NÚT ĐƠN VỊ BẤM-NHẢY — đứng cạnh ô số lượng. Một mặt hàng một đơn vị thì chỉ
 * là nhãn (bấm không có gì để nhảy).
 *
 * ⚠ ĐỔI ĐƠN VỊ LÀ ĐỔI GIÁ — nơi gọi phải đi qua `doiDonVi…` (xem chốt quét
 *   tests/pos-quet-doi-don-vi.test.ts), nút này chỉ báo đơn vị MỚI.
 */
export function UnitCycleButton({
  units,
  value,
  label,
  onChange,
  disabled = false,
}: {
  units: readonly string[]
  value: string
  /** Ví dụ `dòng 3` → aria-label "Đơn vị dòng 3 — đang là hộp, bấm để đổi". */
  label: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const nhieu = units.length > 1
  if (!nhieu) {
    return (
      <span aria-label={`Đơn vị ${label}: ${value}`} className="n inline-flex h-[34px] min-w-[64px] items-center justify-center rounded-[10px] bg-[var(--pos-line-soft)] px-2 text-[12.5px] font-extrabold text-[var(--pos-muted)]">
        {value}
      </span>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Đơn vị ${label} — đang là ${value}, bấm để đổi`}
      title={`Bấm để đổi: ${units.join(" → ")}`}
      onClick={() => onChange(donViKeTiep(units, value))}
      className="n inline-flex h-[34px] min-w-[64px] items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-[var(--pos-primary-border)] bg-[var(--pos-primary-faint)] px-2 text-[12.5px] font-extrabold text-[var(--pos-primary-deep)] disabled:opacity-50"
    >
      {value}
      <span aria-hidden className="text-[10px] opacity-70">⇄</span>
    </button>
  )
}

/** THÙNG RÁC ĐẦU DÒNG — xoá một cú bấm, vùng bấm 30px. */
export function TrashButton({
  label,
  onClick,
  disabled = false,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-[30px] w-[30px] shrink-0 place-items-center justify-self-center rounded-[8px] text-[var(--pos-dim)] hover:bg-[var(--pos-danger-soft)] hover:text-[var(--pos-danger)] disabled:opacity-30"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </svg>
    </button>
  )
}

/**
 * NÚT MỞ / ĐÓNG "CHI TIẾT DÒNG" — cuối dòng. Chấm xanh khi trong chi tiết có
 * giá trị khác mặc định (có giảm giá), để thứ bị giấu không vô hình.
 */
export function LineDetailToggle({
  open,
  onToggle,
  index,
  dot = false,
}: {
  open: boolean
  onToggle: () => void
  index: number
  dot?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={`Chi tiết dòng ${index}`}
      aria-expanded={open}
      title={open ? "Thu gọn chi tiết dòng" : "Mở chi tiết dòng: giảm giá"}
      onClick={onToggle}
      className={`relative grid h-[30px] w-[30px] place-items-center justify-self-center rounded-[8px] text-[14px] font-bold ${
        open ? "bg-[var(--pos-primary-faint)] text-[var(--pos-primary-deep)]" : "text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)]"
      }`}
    >
      <span aria-hidden>{open ? "▴" : "▾"}</span>
      {dot && !open && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--pos-primary)]" />}
    </button>
  )
}

/** Nhãn tóm tắt chi tiết dòng hiện trên dòng khi đang gập — "Giảm 10% · VAT 8%". */
export function tomTatChiTiet(o: { discount?: { value: number; unit: "vnd" | "pct" } | null; vatRate?: number | null }): string | null {
  const phan: string[] = []
  if (o.discount && o.discount.value > 0) {
    phan.push(o.discount.unit === "pct" ? `Giảm ${o.discount.value}%` : `Giảm ${formatCurrency(o.discount.value)}`)
  }
  if ((Number(o.vatRate) || 0) > 0) phan.push(`VAT ${vatLabel(Number(o.vatRate))}`)
  return phan.length ? phan.join(" · ") : null
}

/** Khung chi tiết dòng — một hàng dưới dòng, thụt vào thẳng cột tên hàng. */
export function LineDetailPanel({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-4 py-2.5 pl-[76px]"
    >
      {children}
    </div>
  )
}

/** Một ô trong khung chi tiết: nhãn + điều khiển. */
export function LineDetailField({ label, children, width = 200, hint }: { label: string; children: ReactNode; width?: number; hint?: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--pos-muted)]">
      <span className="shrink-0">{label}</span>
      <span style={{ width }}>{children}</span>
      {/* Ví dụ trần giảm giá của người dùng: "Tối đa 5%". */}
      {hint && <span className="shrink-0 text-[11px] text-[var(--pos-dim)]">{hint}</span>}
    </label>
  )
}
