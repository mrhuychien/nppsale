"use client"

/**
 * Ô THÊM MẶT HÀNG — bấm vào là XỔ DANH SÁCH, gõ để lọc.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Các phần thêm mặt hàng ở các phiếu […]
 * bấm vào là phải xổ list rồi (như khi chọn NCC ấy, bấm vào vừa có ô
 * tìm vừa có xổ list)".
 *
 * ⚠ ĐÂY LÀ MỘT LUẬT BỊ ĐẢO NGƯỢC, VÀ NÓI RA CHO RÕ. Bản cũ cố ý KHÔNG
 * gợi ý gì khi ô còn trống, với lý do đã ghi trong mã: "đổ cả danh mục
 * xuống dưới ô tìm là dựng lại đúng cái danh sách phải cuộn mà ô tìm
 * sinh ra để thay thế". Lý do ấy đúng với một danh mục 1.700 mã — NHƯNG
 * chỉ khi danh sách đổ xuống là TẤT CẢ. Chủ nhà chỉ đích danh `SearchSelect`
 * (ô chọn NCC) làm mẫu, và ô ấy xổ ĐÚNG 30 mục đầu rồi lọc dần khi gõ:
 * đủ để người dùng thấy ngay mình đang ở đâu, không đủ để thành một
 * danh sách phải cuộn. Chốt ở đây canh đúng cái trần ấy.
 *
 * ⚠ VÌ SAO MỘT COMPONENT CHUNG. Trước hôm nay bốn màn có bốn ô tìm
 * khác nhau: phiếu nhập hàng / trả NCC dùng `searchReturnProducts`,
 * phiếu xuất kho cũng vậy nhưng vẽ khác, phiếu nhập kho tự lọc bằng
 * `viIncludes` và tự vẽ, màn kiểm kê thì hỏi thẳng máy chủ. Bốn bản là
 * bốn lần phải nhớ sửa — và đúng vì thế mà yêu cầu "bấm vào xổ list"
 * lẽ ra phải sửa bốn chỗ.
 *
 * ⚠ BÀN PHÍM PHẢI DÙNG ĐƯỢC, giống `SearchSelect`. Đây là màn nhập liệu
 * hàng loạt: mũi tên lên/xuống, Enter thêm, Esc đóng.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Số mục xổ xuống khi ô còn TRỐNG.
 *
 * ⚠ CÓ TRẦN, VÀ TRẦN NÀY LÀ LÝ DO LUẬT CŨ ĐƯỢC ĐẢO. Bỏ trần là đổ cả
 * 1.700 mã xuống — đúng cái danh sách phải cuộn mà ô tìm sinh ra để
 * thay thế, và là điều bản cũ cố ý tránh. Lấy đúng con số của
 * `SearchSelect` để hai ô trên cùng một màn hành xử như nhau.
 */
export const PICKER_PEEK = 30

export interface PickerItem {
  id: string
  /** Dòng chính — tên hàng. */
  title: string
  /** Dòng phụ — mã SKU, đơn vị, NCC… */
  subtitle?: string | null
}

export function ProductPicker<T extends PickerItem>({
  items,
  onPick,
  label = "Thêm mặt hàng",
  placeholder = "Tên hàng, mã SKU hoặc mã vạch…",
  emptyHint = "Không tìm thấy mã nào khớp, hoặc mã đó đã có trên phiếu.",
  disabled,
  id = "pp-find",
  renderMeta,
  footer,
  hint,
  term,
  onTermChange,
}: {
  /** Danh sách ĐÃ lọc theo `term` và đã bỏ mã có trên phiếu. */
  items: T[]
  onPick: (item: T) => void
  label?: string
  placeholder?: string
  emptyHint?: string
  disabled?: boolean
  id?: string
  /** Cột phải của mỗi dòng — tồn kho, giá… */
  renderMeta?: (item: T) => React.ReactNode
  /** Dải cuối danh sách — ví dụ "Tạo sản phẩm mới". */
  footer?: React.ReactNode
  /** Dòng nhắc dưới ô — ví dụ "đang lọc theo NCC". */
  hint?: React.ReactNode
  term: string
  onTermChange: (t: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Bấm ra ngoài thì đóng — nếu không dải gợi ý che mất bảng hàng. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // Danh sách đổi thì con trỏ về đầu, nếu không Enter thêm nhầm mặt hàng.
  useEffect(() => { setActive(0) }, [items])

  const shown = useMemo(() => items.slice(0, PICKER_PEEK), [items])

  const pick = (it: T) => {
    onPick(it)
    onTermChange("")
    /**
     * ⚠ KHÔNG ĐÓNG SAU KHI THÊM. Người nhập một phiếu ba mươi dòng thêm
     *   liên tiếp; đóng lại là mỗi dòng một lần bấm thừa. Mã vừa thêm
     *   biến khỏi danh sách (nơi gọi đã loại mã có trên phiếu), nên
     *   danh sách tự nói "đã nhận rồi".
     */
    inputRef.current?.focus()
  }

  return (
    <div ref={boxRef} className="relative space-y-2">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          ref={inputRef}
          value={term}
          onChange={(e) => { onTermChange(e.target.value); setOpen(true) }}
          /* ⚠ `onFocus` CHỨ KHÔNG CHỈ `onClick` — Tab tới ô cũng phải xổ. */
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(i + 1, shown.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === "Enter") {
              e.preventDefault()
              const it = shown[active]
              if (it) pick(it)
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          placeholder={disabled ? "Đang nạp danh mục…" : placeholder}
          disabled={disabled}
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {hint}

      {open && !disabled && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-card shadow-card-hover">
          {shown.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">{emptyHint}</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto">
              {shown.map((p, i) => (
                <li key={p.id}>
                  {/*
                    ⚠ CẢ DÒNG LÀ NÚT. Một nút nhỏ ở mép phải là mục tiêu
                      bé giữa một dòng rộng cả màn, và mọi cú chạm trượt
                      trên điện thoại đều không làm gì cả.
                  */}
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex w-full items-center gap-2 p-2 text-left",
                      i === active ? "bg-muted/60" : "hover:bg-muted/50"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      {p.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.subtitle}
                        </span>
                      )}
                    </span>
                    {renderMeta?.(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}
