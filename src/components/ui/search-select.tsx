"use client"

/**
 * Ô CHỌN CÓ TÌM KIẾM — gõ để lọc, danh sách xổ xuống ngay dưới.
 *
 * Chủ nhà chốt: chọn NCC ở phiếu nhập kho phải "làm như thông lệ", tức là
 * một ô gõ được kèm danh sách xổ xuống — không phải một `<Select>` liệt
 * kê hết rồi bắt cuộn.
 *
 * ⚠ BỎ DẤU TRƯỚC KHI SO. Người nhập kho gõ "hai ha" để tìm "Hải Hà"; bắt
 * gõ đủ dấu là bắt họ bỏ cuộc và cuộn tay như cũ. Dùng chung
 * `viMatchAllWords` với mọi ô tìm khác trong kho mã.
 *
 * ⚠ CHO PHÉP GIÁ TRỊ TỰ DO, và nơi gọi phải phân biệt được. Phiếu nhập
 * kho có hai đường khác hẳn nhau về TIỀN: chọn một NCC có trong danh mục
 * thì lúc lưu sinh công nợ NCC; gõ tay một cái tên thì không. Gộp hai thứ
 * vào một chuỗi là người dùng không còn cách nào biết mình đang đi đường
 * nào, nên `onPick` trả về `null` cho trường hợp gõ tay.
 *
 * ⚠ BÀN PHÍM PHẢI DÙNG ĐƯỢC. Đây là màn nhập liệu hàng loạt — người ta gõ
 * cả phiếu mà không rời tay khỏi bàn phím. Mũi tên lên/xuống, Enter chọn,
 * Esc đóng.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import { Check, ChevronDown, X } from "lucide-react"

export interface SearchSelectOption {
  id: string
  /** Chữ hiện trong ô sau khi chọn. */
  label: string
  /** Dòng phụ nhỏ dưới nhãn — ví dụ mã NCC, số điện thoại. */
  hint?: string | null
  /** Chữ thêm để tìm mà không hiện ra — ví dụ mã, tên viết tắt. */
  keywords?: string | null
}

export function SearchSelect({
  options,
  valueId,
  freeText,
  onPick,
  placeholder = "Gõ để tìm…",
  emptyHint,
  allowFreeText = false,
  footer,
  disabled,
  id,
  limit = 30,
}: {
  options: SearchSelectOption[]
  /** Mã đang chọn, hoặc "" khi chưa chọn / đang dùng chữ gõ tay. */
  valueId: string
  /** Chữ gõ tay đang giữ (chỉ dùng khi `allowFreeText`). */
  freeText?: string
  /**
   * `option` là mục trong danh sách; `null` nghĩa là người dùng GÕ TAY
   * (kèm `text`). Hai đường này khác nhau về hệ quả, nên tách hẳn.
   */
  onPick: (option: SearchSelectOption | null, text: string) => void
  placeholder?: string
  /** Câu hiện khi không tìm thấy gì và KHÔNG cho gõ tay. */
  emptyHint?: string
  allowFreeText?: boolean
  /** Dải cuối danh sách — ví dụ "Tạo NCC mới". */
  footer?: React.ReactNode
  disabled?: boolean
  id?: string
  limit?: number
}) {
  const picked = options.find((o) => o.id === valueId) ?? null
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState("")
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  /**
   * ⚠ ĐÓNG KHI BẤM RA NGOÀI. Không có nó thì danh sách nằm lại che mất ô
   * tiếp theo, và trên điện thoại không có cách nào đóng.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const results = useMemo(() => {
    const t = term.trim()
    const out: SearchSelectOption[] = []
    for (const o of options) {
      if (t && !viMatchAllWords(t, o.label, o.hint, o.keywords)) continue
      out.push(o)
      if (out.length >= limit) break
    }
    return out
  }, [options, term, limit])

  // Danh sách đổi thì con trỏ phải về đầu, nếu không Enter chọn nhầm mục
  // của lần lọc trước.
  useEffect(() => setActive(0), [term])

  const commitFreeText = (text: string) => {
    onPick(null, text)
    setOpen(false)
  }

  const choose = (o: SearchSelectOption) => {
    onPick(o, o.label)
    setTerm("")
    setOpen(false)
  }

  /** Chữ hiện trong ô khi đang đóng: tên đã chọn, hoặc chữ gõ tay. */
  const closedText = picked?.label ?? (allowFreeText ? freeText ?? "" : "")

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          disabled={disabled}
          value={open ? term : closedText}
          placeholder={placeholder}
          {...SEARCH_FIELD_PROPS}
          className={cn("pr-16", HIDE_NATIVE_CLEAR)}
          onFocus={() => {
            setOpen(true)
            setTerm("")
          }}
          onChange={(e) => {
            setOpen(true)
            setTerm(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === "Enter") {
              e.preventDefault()
              if (results[active]) choose(results[active])
              else if (allowFreeText && term.trim()) commitFreeText(term.trim())
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          onBlur={() => {
            /**
             * ⚠ GÕ TAY PHẢI ĐƯỢC GIỮ KHI RỜI Ô. Không có nhánh này thì
             * người dùng gõ xong tên NCC lạ, bấm sang ô kế, và chữ vừa gõ
             * biến mất — họ gõ lại lần hai rồi mới nhận ra.
             * Hoãn một nhịp để cú bấm vào một mục trong danh sách kịp chạy
             * trước; bấm chuột kích hoạt `blur` trước `click`.
             */
            if (!allowFreeText) return
            const t = term.trim()
            if (!t) return
            setTimeout(() => {
              if (!results.some((o) => o.label === t)) onPick(null, t)
            }, 150)
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {/* Xoá lựa chọn — không có nó thì chọn nhầm là phải tải lại trang. */}
          {(picked || (allowFreeText && freeText)) && !disabled && (
            <button
              type="button"
              aria-label="Bỏ chọn"
              className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-on-surface"
              onClick={() => {
                onPick(null, "")
                setTerm("")
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-xl border bg-card py-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-center text-xs text-muted-foreground">
              {term.trim() && allowFreeText
                ? `Không có trong danh mục — Enter để dùng “${term.trim()}”`
                : emptyHint || "Không tìm thấy"}
            </p>
          ) : (
            results.map((o, i) => (
              <button
                key={o.id}
                type="button"
                /* `onMouseDown` chứ không phải `onClick`: `blur` của ô nhập
                   chạy trước `click` và có thể đóng danh sách trước khi cú
                   bấm tới nơi. */
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(o)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  i === active ? "bg-muted/60" : ""
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.label}</span>
                  {o.hint && (
                    <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                  )}
                </span>
                {o.id === valueId && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))
          )}
          {footer && <div className="mt-1 border-t border-border/50 pt-1">{footer}</div>}
        </div>
      )}
    </div>
  )
}
