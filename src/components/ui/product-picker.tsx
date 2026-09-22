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
  persistent = false,
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
   * ĐÓNG DẢI GỢI Ý SAU KHI CHỌN.
   *
   * ⚠ MẶC ĐỊNH KHÔNG ĐÓNG, VÀ AI ĐỌC CŨNG NÊN BIẾT VÌ SAO: ô tìm của
   *   `/pos` nằm ở CỘT PHẢI và KHÔNG che gì cả, nên để mở là thao tác
   *   nhanh hơn. Chủ nhà nói thẳng 22/09/2026: *"bên newdesign nó luôn
   *   hiện vì nó ko che màn làm đơn"*.
   *
   * ⚠ NĂM MÀN CHỨNG TỪ THÌ NGƯỢC LẠI và đều truyền cờ này: nhập kho,
   *   xuất khác, phiếu trả, sửa hóa đơn, nhập mua. Ở đó dải gợi ý xổ ra
   *   ĐÈ LÊN biểu mẫu, nên người dùng không thấy dòng mình vừa thêm.
   *   Chủ nhà báo 22/09/2026: *"khi chọn xong product phải ẩn đi vì nó
   *   đang che màn làm đơn, người dùng ko biết sản phẩm đã được thêm
   *   vào list chưa"*.
   *
   * ⚠ CHÚ THÍCH CŨ Ở ĐÂY NÓI VỀ MỘT BỐ CỤC KHÔNG CÒN NỮA — nó bảo cờ
   *   này sinh ra cho "ô nằm trên thanh đầu màn" của `/pos` (đợt 9).
   *   Ô ấy đã dời xuống cột phải từ bản thiết kế 21/09, nên lý do cũ
   *   hết đúng, còn MẶC ĐỊNH thì tình cờ vẫn đúng. Một chú thích đúng
   *   kết quả nhưng sai lý do là thứ dẫn người sau đi nhầm đường.
   */
    closeOnPick?: boolean
  /** Lớp CSS của khung ngoài — để nơi gọi đặt bề rộng. */
  className?: string
  /**
   * DẢI GỢI Ý Ở LẠI SAU KHI CHỌN, và có nút đóng rõ ràng.
   *
   * ⚠ MẶC ĐỊNH TẮT. Năm màn ngoài `/pos` đang dùng component này với
   *   hành vi cũ; bật mặc định là đổi cả năm màn mà không ai yêu cầu.
   *
   * ⚠ CHỦ NHÀ CHỐT 22/09/2026: *"phần tìm, quét mã sản phẩm khi bấm
   *   thêm sản phẩm vào dòng nó không tự mất đi mà luôn ở đó. khi xong
   *   có nút đóng/xong"*. Lý do rất cụ thể: người bán quét một loạt mã
   *   liên tiếp, và dải gợi ý đóng lại sau mỗi lần quét là mỗi mã phải
   *   mở lại ô một lần.
   */
  persistent?: boolean
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
  /*
   * ⚠ CỜ NUỐT MỘT LƯỢT `focus` NAY NẰM TRONG BỘ LUẬT (`skipNextFocus`
   *   của `pickerOpenReducer`), KHÔNG CÒN LÀ MỘT `useRef` Ở ĐÂY.
   *
   *   Lý do vẫn y nguyên và đáng đọc lại: chọn xong phải trả tiêu điểm
   *   về ô, nếu không con trỏ nằm trên một cái nút vừa biến mất; nhưng
   *   `focus()` lại kích `onFocus`, mà `onFocus` thì xổ danh sách — đóng
   *   xong mở lại ngay trong cùng một nhịp, và người dùng thấy danh sách
   *   không bao giờ chịu tắt. Và nó phải là cờ MỘT LẦN: bật lâu thì Tab
   *   vào ô cũng không xổ nữa.
   *
   *   Để trong bộ luật thì chốt CHẠY được đúng chuỗi sự kiện ấy thay vì
   *   đọc một dòng mã — xem `tests/picker-open.test.ts`. Bản `main` giữ
   *   cờ ở đây dưới dạng `useRef`; lúc trộn hai nhánh 22/09/2026 giữ bản
   *   bộ luật, và cái `useRef` thành thừa.
   */

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
          className={persistent ? "pl-8 pr-[88px]" : "pl-8"}
          autoComplete="off"
        />
        {/*
          ⚠ NÚT ĐÓNG NẰM TRONG Ô, KHÔNG NẰM NGOÀI. Bản thiết kế vẽ nó
            lọt trong khung ô nhập ở mép phải; để ra ngoài là ô tìm bị
            đẩy hẹp lại đúng bằng bề ngang cái nút.
        */}
        {persistent && (
          <button
            type="button"
            onClick={() => gui({ t: open ? "escape" : "click" })}
            className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md bg-muted px-2.5 text-xs font-extrabold text-muted-foreground"
          >
            {open ? "▲ Đóng" : "▼ Mở"}
          </button>
        )}
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
          {/*
            ⚠ CHÂN DẢI GỢI Ý CHỈ CÓ Ở CHẾ ĐỘ "Ở LẠI". Dải tự đóng sau
              khi chọn thì một nút "Xong" là thừa — nó đóng một thứ vừa
              tự đóng. Ở chế độ này thì ngược lại: không có nút, người
              dùng không có cách nào đóng ngoài bấm ra ngoài.
          */}
          {persistent && (
            <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-3 py-2">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Bấm để thêm · Esc đóng
              </span>
              <button
                type="button"
                onClick={() => gui({ t: "escape" })}
                className="h-7 rounded-md bg-card px-2.5 text-xs font-extrabold text-primary"
              >
                Xong
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
