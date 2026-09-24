"use client"

import { useEffect, useState } from "react"
import { cn, formatCurrency, formatInt } from "@/lib/utils"

/**
 * Ô sửa ĐƠN GIÁ của một dòng hàng trả, nằm THẲNG trên dòng.
 *
 * ⚠ VÌ SAO KHÔNG GIẤU TRONG TẤM TRƯỢT. Bản trước để việc sửa giá sau một
 * cú chạm vào TÊN HÀNG — mà tên hàng trông y hệt chữ thường, không viền,
 * không mũi tên, không nhãn. Người dùng báo hai lần liền "vẫn không sửa
 * được giá": tính năng có, đường vào thì không ai thấy. Ô số lượng ngay
 * cạnh thì hiện rõ, nên giá cũng phải hiện rõ như thế.
 *
 * ⚠ GIỮ CHUỖI RIÊNG, không ép về số sau mỗi phím. Ép thì xoá hết chữ số là
 * ô tự nhảy về 0 và không gõ lại được — lỗi này đã gặp ở ô giá của dòng bán.
 */
export function ReturnPriceInput({
  price,
  disabled,
  bad,
  onChange,
  suffix,
  dim = false,
}: {
  price: number
  disabled?: boolean
  /** Giá vi phạm (cao hơn trần) — viền đỏ. */
  bad?: boolean
  onChange: (price: number) => void
  /** Có thì vẽ kiểu ô gọn của bản thiết kế 1b, kèm chữ đuôi ("đ/hộp"). */
  suffix?: string
  /** Dòng "Đổi hàng": giá không trừ tiền — mờ đi (1b). */
  dim?: boolean
}) {
  const [text, setText] = useState(String(price))
  // Giá đổi từ nơi khác (đổi đơn vị, sửa trong tấm trượt) thì ô phải theo.
  useEffect(() => setText(String(price)), [price])

  const input = (
    <input
      // Hiển thị nhóm nghìn (9.000.000); state vẫn chỉ là chữ số.
      value={text === "" ? "" : formatInt(parseInt(text, 10))}
      disabled={disabled}
      inputMode="numeric"
      aria-label="Đơn giá trả"
      title={disabled ? "Bạn không có quyền sửa giá" : formatCurrency(price)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "")
        setText(digits)
        onChange(digits === "" ? 0 : parseInt(digits, 10))
      }}
      className={
        suffix !== undefined
          ? cn("min-w-0 flex-1 border-0 bg-transparent text-right text-[15px] font-semibold tabular-data outline-none", bad && "text-error")
          : cn(
              "h-12 w-full rounded-xl border-[1.5px] px-3 text-right text-[15px] font-extrabold tabular-data outline-none",
              bad ? "border-error text-error" : "border-outline-variant",
              disabled ? "bg-surface-container text-on-surface-variant" : "bg-surface-container-lowest"
            )
      }
    />
  )
  if (suffix === undefined) return input
  return (
    <div
      className={cn(
        "flex h-10 items-center gap-1 rounded-[10px] px-2.5",
        bad ? "border-[1.5px] border-error" : "border border-border",
        disabled ? "bg-surface-container-low" : "",
        dim ? "opacity-45" : ""
      )}
    >
      {input}
      <span className="shrink-0 text-[12px] text-muted-foreground">{suffix}</span>
    </div>
  )
}
