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
}: {
  price: number
  disabled?: boolean
  /** Giá vi phạm (cao hơn trần) — viền đỏ. */
  bad?: boolean
  onChange: (price: number) => void
}) {
  const [text, setText] = useState(String(price))
  // Giá đổi từ nơi khác (đổi đơn vị, sửa trong tấm trượt) thì ô phải theo.
  useEffect(() => setText(String(price)), [price])

  return (
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
      className={cn(
        "h-12 w-full rounded-xl border-[1.5px] px-3 text-right text-[15px] font-extrabold tabular-data outline-none",
        bad ? "border-error text-error" : "border-outline-variant",
        disabled ? "bg-surface-container text-on-surface-variant" : "bg-surface-container-lowest"
      )}
    />
  )
}
