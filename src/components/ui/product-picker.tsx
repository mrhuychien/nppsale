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

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  pickerOpenReducer, PICKER_OPEN_INIT, type PickerEvent,
} from "@/lib/ui/picker-open"

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
  renderAside,
  footer,
  hint,
  term,
  onTermChange,
  hideLabel = false,
  closeOnPick = false,
  className,
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
  /**
   * Ô ĐIỀU KHIỂN đứng cạnh mỗi dòng — ví dụ chọn đơn vị bán.
   *
   * ⚠ TÁCH RIÊNG KHỎI `renderMeta`, VÀ VẼ NGOÀI CÁI NÚT. `renderMeta`
   * nằm TRONG `<button>` của dòng: một `<select>` đặt ở đó là HTML sai
   * (nút lồng trong nút) và mọi cú bấm để mở nó đều rơi vào `onPick` —
   * người dùng định chọn "thùng" thì mặt hàng bị thêm luôn theo đơn vị
   * cũ. Khe này là anh em ruột của nút trong cùng một `<li>`, nên bấm
   * vào đây không thêm gì cả.
   */
  renderAside?: (item: T) => React.ReactNode
  /** Dải cuối danh sách — ví dụ "Tạo sản phẩm mới". */
  footer?: React.ReactNode
  /** Dòng nhắc dưới ô — ví dụ "đang lọc theo NCC". */
  hint?: React.ReactNode
  term: string
  onTermChange: (t: string) => void
  /**
   * Ẩn nhãn phía trên ô.
   *
   * ⚠ NHÃN ẨN THÌ `aria-label` PHẢI THAY CHỖ. Bỏ hẳn nhãn là người dùng
   * trình đọc màn hình nghe được một ô nhập không tên. Dùng khi ô nằm
   * trong một thanh chật — thanh trên cùng của `/pos` — chứ không phải
   * để tiết kiệm chỗ ở một biểu mẫu bình thường.
   */
  hideLabel?: boolean
  /**
   * Đóng danh sách sau khi chọn một mã.
   *
   * ⚠ MẶC ĐỊNH `false`, VÀ ĐÓ LÀ HÀNH VI CŨ CỦA MỌI MÀN ĐANG CHẠY —
   * xem `pick()`. Người nhập một phiếu ba mươi dòng thêm liên tiếp, nên
   * đóng lại là mỗi dòng một cú bấm thừa.
   *
   * ⚠ NHƯNG Ô NẰM TRÊN THANH ĐẦU MÀN THÌ NGƯỢC LẠI: danh sách xổ ra đè
   * lên bảng hàng, và người dùng vừa thêm xong cần NHÌN THẤY dòng mình
   * vừa thêm. Chủ nhà chốt đợt 9 cho `/pos`: *"Khi ấn vào thêm hàng
   * xong danh sách phải thu gọn lại"*. Đây là một tuỳ chọn chứ không
   * phải đổi mặc định — đổi mặc định là đổi luôn sáu màn đang chạy mà
   * không ai yêu cầu.
   */
  closeOnPick?: boolean
  /** Lớp CSS của khung ngoài — để nơi gọi đặt bề rộng. */
  className?: string
}) {
  /**
   * ⚠ LUẬT ĐÓNG/MỞ NẰM Ở `@/lib/ui/picker-open`, KHÔNG NẰM Ở ĐÂY. Nó có
   * một cái bẫy chỉ lộ ra khi chạy (chọn xong, tiêu điểm quay về ô, và
   * lượt `focus` ấy mở lại đúng dải vừa đóng) — để trong component là
   * không có cách nào chạy chốt lên nó. Xem đầu tệp ấy.
   */
  const [mo, gui] = useReducer(
    (st: typeof PICKER_OPEN_INIT, e: PickerEvent) => pickerOpenReducer(st, e, { closeOnPick }),
    PICKER_OPEN_INIT
  )
  const open = mo.open
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Bấm ra ngoài thì đóng — nếu không dải gợi ý che mất bảng hàng. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) gui({ t: "outside" })
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // Danh sách đổi thì con trỏ về đầu, nếu không Enter thêm nhầm mặt hàng.
  useEffect(() => { setActive(0) }, [items])

  const shown = useMemo(() => items.slice(0, PICKER_PEEK), [items])

  const pick = useCallback((it: T) => {
    onPick(it)
    onTermChange("")
    /**
     * ⚠ MẶC ĐỊNH KHÔNG ĐÓNG SAU KHI THÊM. Người nhập một phiếu ba mươi
     *   dòng thêm liên tiếp; đóng lại là mỗi dòng một lần bấm thừa. Mã
     *   vừa thêm biến khỏi danh sách (nơi gọi đã loại mã có trên
     *   phiếu), nên danh sách tự nói "đã nhận rồi".
     *
     * ⚠ `closeOnPick` ĐẢO LẠI CHO Ô NẰM TRÊN THANH ĐẦU MÀN — xem chú
     *   thích của prop ấy. Vẫn giữ tiêu điểm trong ô để gõ tiếp mã sau
     *   mà không phải bấm lại.
     */
    /**
     * ⚠ NÓI CHO BỘ LUẬT BIẾT TIÊU ĐIỂM CÓ QUAY LẠI KHÔNG. Bấm chuột vào
     *   một dòng gợi ý đã đẩy tiêu điểm sang cái nút của dòng ấy, nên
     *   lệnh dưới sinh một lượt `focus` mới; bấm `Enter` thì tiêu điểm
     *   vẫn nằm trong ô và KHÔNG có lượt nào. Bật cờ bỏ qua cho trường
     *   hợp thứ hai là nuốt mất lượt Tab kế tiếp của người dùng.
     */
    gui({ t: "pick", refocus: document.activeElement !== inputRef.current })
    inputRef.current?.focus()
  }, [onPick, onTermChange])

  return (
    <div ref={boxRef} className={cn("relative", hideLabel ? "" : "space-y-2", className)}>
      {hideLabel ? null : (
        <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          ref={inputRef}
          value={term}
          onChange={(e) => { onTermChange(e.target.value); gui({ t: "type" }) }}
          /* ⚠ `onFocus` CHỨ KHÔNG CHỈ `onClick` — Tab tới ô cũng phải xổ. */
          onFocus={() => gui({ t: "focus" })}
          onClick={() => gui({ t: "click" })}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              gui({ t: "click" })
              setActive((i) => Math.min(i + 1, shown.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === "Enter") {
              e.preventDefault()
              const it = shown[active]
              if (it) pick(it)
            } else if (e.key === "Escape") {
              gui({ t: "escape" })
            }
          }}
          placeholder={disabled ? "Đang nạp danh mục…" : placeholder}
          disabled={disabled}
          /* ⚠ Nhãn ẩn thì `aria-label` thay chỗ — xem prop `hideLabel`. */
          aria-label={hideLabel ? label : undefined}
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
                <li key={p.id} className="flex items-center">
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
                      "flex min-w-0 flex-1 items-center gap-2 p-2 text-left",
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
                  {renderAside && <span className="shrink-0 pr-2">{renderAside(p)}</span>}
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
