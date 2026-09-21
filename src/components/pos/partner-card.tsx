"use client"

/**
 * CARD ĐỐI TÁC (khách hàng / NCC) đầu panel phải — spec §6.
 *
 * ⚠ CHƯA CHỌN THÌ VẪN PHẢI CÓ MỘT CHỖ BẤM. Một card rỗng không nút là
 * người dùng nhìn panel mà không biết chọn khách ở đâu — spec §10 cho
 * `F4`, nhưng phím tắt là đường TẮT, không phải đường duy nhất.
 */

import { formatCurrency } from "@/lib/utils"

function viTat(ten: string): string {
  const w = ten.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return "?"
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[w.length - 2][0] + w[w.length - 1][0]).toUpperCase()
}

export interface PosPartner {
  id: string
  name: string
  /** `KH011986 · Đội 2 Dương Quan` */
  meta?: string
  /** Công nợ hiện tại. `null` = chưa đọc được — KHÔNG hiện 0. */
  debt?: number | null
}

export function PartnerCard({
  partner,
  label = "khách hàng",
  hotkey = "F4",
  onPick,
  onClear,
  readOnly,
}: {
  partner: PosPartner | null
  /** `khách hàng` | `nhà cung cấp` — đi vào mọi câu `aria-label`. */
  label?: string
  hotkey?: string
  onPick?: () => void
  onClear?: () => void
  /**
   * ⚠ CHỨNG TỪ KHÔNG ĐỔI ĐƯỢC ĐỐI TÁC THÌ KHÔNG VẼ NÚT "ĐỔI". Hóa đơn
   * đã ghi sổ và `reissue_invoice` không nhận khách mới — một nút
   * "Đổi khách F4" ở đó là mời người dùng làm một việc sẽ không lưu.
   */
  readOnly?: boolean
}) {
  if (!partner) {
    return (
      <div className="shrink-0 rounded-xl border border-dashed border-[#cbd5e1] bg-white p-3.5">
        {readOnly ? (
          <p className="text-center text-[12.5px] text-[#94a3b8]">Chưa có {label}</p>
        ) : (
          <button
            type="button"
            onClick={onPick}
            className="flex w-full items-center justify-center gap-2 text-[13px] font-semibold text-[#2563eb]"
          >
            + Chọn {label} <span className="n text-[11px] opacity-70">{hotkey}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="shrink-0 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#dbeafe] text-[12px] font-bold text-[#1d4ed8]">
          {viTat(partner.name)}
        </div>
        <div className="min-w-0 flex-grow">
          <div className="truncate text-[14px] font-bold text-[#1d4ed8]">{partner.name}</div>
          {partner.meta && <div className="n mt-0.5 truncate text-[11px] text-[#64748b]">{partner.meta}</div>}
          {/*
            ⚠ `null` LÀ "CHƯA ĐỌC ĐƯỢC", KHÔNG PHẢI "KHÔNG NỢ". Vẽ badge
              `Nợ 0` cho một lỗi mạng là nói với người đi đòi tiền rằng
              khách này sạch nợ. Chưa đọc được thì không vẽ badge.
          */}
          {partner.debt != null && (
            <div
              className={`mt-1.5 inline-flex items-center gap-1.5 rounded-[5px] px-[7px] py-[3px] ${
                partner.debt > 0 ? "bg-[#fee2e2]" : "bg-[#f1f5f9]"
              }`}
            >
              <span
                className={`text-[10.5px] font-semibold ${partner.debt > 0 ? "text-[#991b1b]" : "text-[#64748b]"}`}
              >
                Nợ
              </span>
              <span
                className={`n text-[11.5px] font-bold ${partner.debt > 0 ? "text-[#991b1b]" : "text-[#64748b]"}`}
              >
                {formatCurrency(partner.debt)}
              </span>
            </div>
          )}
        </div>
        {!readOnly && (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {onClear && (
            <button
              type="button"
              aria-label={`Bỏ chọn ${label}`}
              onClick={onClear}
              className="h-[22px] w-[22px] rounded text-[15px] leading-none text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#334155]"
            >
              ×
            </button>
          )}
          <button
            type="button"
            onClick={onPick}
            className="h-6 rounded-md border border-[#cbd5e1] bg-white px-2 text-[10.5px] font-semibold text-[#334155] hover:border-[#94a3b8]"
          >
            Đổi {label === "khách hàng" ? "khách" : "NCC"}{" "}
            <span className="n opacity-70">{hotkey}</span>
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
