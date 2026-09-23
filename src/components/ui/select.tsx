"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"

/**
 * ⚠ Ô TÌM TRONG MỌI DANH SÁCH THẢ XUỐNG (chủ nhà yêu cầu 23/09/2026: "Rà
 *   soát các droplist đều phải kèm ô tìm kiếm"). Đặt ở ĐÂY — thành phần
 *   dùng chung — thì 90 chỗ dùng `<Select>` có ô tìm cùng một lúc, và chỗ
 *   thứ 91 viết sau cũng có luôn.
 *
 * Chỉ hiện khi danh sách có từ `NGUONG_O_TIM` lựa chọn: ô tìm cho danh
 * sách hai dòng "Có / Không" là thêm một bước chứ không bớt.
 */
export const NGUONG_O_TIM = 5
const TimCtx = React.createContext("")

/** Chữ của một lựa chọn — để lọc; lựa chọn có thể là chuỗi hoặc JSX lồng. */
function chuCua(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(chuCua).join(" ")
  if (React.isValidElement(node)) return chuCua((node.props as { children?: React.ReactNode }).children)
  return ""
}

/** Đếm `SelectItem` trong cây con (qua map, Fragment, SelectGroup…). */
function demLuaChon(node: React.ReactNode): number {
  let n = 0
  React.Children.forEach(node, (c) => {
    if (!React.isValidElement(c)) return
    if (c.type === SelectItem) n++
    else n += demLuaChon((c.props as { children?: React.ReactNode }).children)
  })
  return n
}

/**
 * ⚠ BÀN PHÍM ĐIỆN THOẠI KHÔNG ĐƯỢC ĐÓNG DANH SÁCH.
 *
 * Radix Select đóng danh sách mỗi khi cửa sổ đổi kích thước. Trang đặt
 * `interactiveWidget: "resizes-content"` (src/app/layout.tsx), nên trên
 * Android bàn phím bật lên LÀ đổi kích thước cửa sổ: chạm vào ô "Tìm…"
 * là danh sách đóng ngay — ô tìm vô dụng trên đúng loại máy dùng nhiều
 * nhất. Bỏ qua lệnh đóng CHỈ KHI ô tìm đang có tiêu điểm VÀ cửa sổ vừa
 * đổi kích thước; chạm ra ngoài, Escape, chọn một dòng vẫn đóng như cũ.
 * Tìm ra khi rà đợt 23/09/2026; chốt e2e/select-co-o-tim.spec.ts.
 */
let lanDoiCoCuaSo = 0
if (typeof window !== "undefined") {
  // `capture` để chạy TRƯỚC lệnh đóng của Radix cho cùng sự kiện ấy.
  window.addEventListener("resize", () => { lanDoiCoCuaSo = Date.now() }, true)
}
export function laDongDoBanPhim(): boolean {
  if (typeof document === "undefined") return false
  const a = document.activeElement
  // Radix đóng NGAY TẠI sự kiện đổi kích thước — 200 ms là đủ, và cú bấm ra ngoài thật gần như không bao giờ rơi vào đó.
  return !!a && a.hasAttribute("data-o-tim-select") && Date.now() - lanDoiCoCuaSo < 200
}

function Select({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [tuMo, setTuMo] = React.useState(defaultOpen ?? false)
  const dangMo = open ?? tuMo
  const doi = (v: boolean) => {
    if (!v && laDongDoBanPhim()) return
    if (open === undefined) setTuMo(v)
    onOpenChange?.(v)
  }
  return <SelectPrimitive.Root {...props} open={dangMo} onOpenChange={doi} />
}
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton ref={ref} className={cn("flex cursor-default items-center justify-center py-1", className)} {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton ref={ref} className={cn("flex cursor-default items-center justify-center py-1", className)} {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      {/* ⚠ Trạng thái tìm nằm TRONG `Content`: Radix gỡ phần này khi đóng,
          nên mở lại là ô tìm trống và đủ lựa chọn. Đặt ở vỏ ngoài thì chữ
          tìm lần trước còn nguyên. */}
      <KhungTim position={position}>{children}</KhungTim>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

function KhungTim({ children, position }: { children: React.ReactNode; position: string }) {
  const [q, setQ] = React.useState("")
  const coTim = demLuaChon(children) >= NGUONG_O_TIM
  const oTimRef = React.useRef<HTMLInputElement>(null)
  /**
   * ⚠ TRẢ TIÊU ĐIỂM VỀ Ô TÌM SAU KHI RADIX ĐỊNH VỊ XONG. Lúc mở, Radix đưa
   *   tiêu điểm về lựa chọn đang chọn sau bước định vị khung; trả ngay
   *   trong lượt vẽ thì bị giật lại. Hai khung hình là sau bước ấy.
   */
  React.useEffect(() => {
    if (!coTim) return
    /* Máy cảm ứng: đừng tự bật bàn phím che nửa danh sách — chạm vào ô
       tìm mới gõ. Chuột / bàn phím: gõ được ngay. */
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return
    let a = 0, b = 0
    a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => oTimRef.current?.focus())
    })
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b) }
  }, [coTim])
  const khop = coTim && q.trim() ? demKhop(children, q) : null
  return (
    <>
      {coTim && (
        <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
          <input
            ref={oTimRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm…"
            aria-label="Tìm trong danh sách"
            data-o-tim-select=""
            autoComplete="off"
            className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              /* ⚠ Chặn phím nổi lên `Content` — thiếu vế này thì Radix
                 bắt chữ gõ để nhảy tới lựa chọn ("typeahead") và ô tìm
                 không nhận được chữ nào. ↓ / Enter: vào lựa chọn đầu còn
                 hiện. */
              if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault()
                e.currentTarget
                  .closest('[role="listbox"]')
                  ?.querySelector<HTMLElement>('[role="option"]:not([data-disabled]):not([hidden])')
                  ?.focus()
                return
              }
              if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation()
            }}
          />
        </div>
      )}
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn("p-1", position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}
      >
        <TimCtx.Provider value={coTim ? q : ""}>{children}</TimCtx.Provider>
        {khop === 0 && (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">Không có lựa chọn nào khớp</div>
        )}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </>
  )
}

/** Số lựa chọn khớp chữ tìm — để nói "không có lựa chọn nào khớp". */
function demKhop(node: React.ReactNode, q: string): number {
  let n = 0
  React.Children.forEach(node, (c) => {
    if (!React.isValidElement(c)) return
    const p = c.props as { children?: React.ReactNode; textValue?: string; value?: string }
    if (c.type === SelectItem) {
      if (viMatchAllWords(q, p.textValue ?? chuCua(p.children))) n++
    } else n += demKhop(p.children, q)
  })
  return n
}

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => {
  const q = React.useContext(TimCtx)
  /* ⚠ ẨN, KHÔNG GỠ. Gỡ lựa chọn khỏi cây là đổi tập lựa chọn của Radix, và
     Radix chạy lại bước đưa tiêu điểm về lựa chọn đang chọn — ô tìm mất
     tiêu điểm sau mỗi phím (gõ "don" chỉ còn "d"). Ẩn thì tập không đổi;
     phím mũi tên của Radix tự bỏ qua phần tử không nhận tiêu điểm. */
  /* Chỉ khớp CHỮ ĐANG HIỆN — không khớp `value` (hay là uuid: gõ "ba" khớp
     cả đống mã ẩn, lọc không ra gì). */
  const an = !!q.trim() && !viMatchAllWords(q, props.textValue ?? chuCua(children))
  return (
  <SelectPrimitive.Item
    ref={ref}
    hidden={an}
    aria-hidden={an || undefined}
    className={cn(
      an && "hidden",
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
  )
})
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton,
}
