"use client"

/**
 * Ô TÌM DANH SÁCH THEO MẪU chủ nhà gửi 23/09/2026: một ô tìm, nút bộ lọc ở
 * mép phải; bấm nút thì xổ ra các ô tìm theo từng trường ("Theo mã hóa
 * đơn", "Theo mã, tên hàng", …) cùng hai nút "Mở rộng" và "Tìm kiếm".
 *
 * Ô chính vẫn là ô tìm nhanh như cũ (gõ là lọc). Các ô theo trường chỉ áp
 * khi bấm "Tìm kiếm" (hoặc Enter) — ghép bằng "VÀ", xem
 * `@/lib/search/field-search`. "Mở rộng" mở bộ lọc đầy đủ của màn, nếu có.
 */
import { useEffect, useState } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { soTruongDangTim, type TruongTim } from "@/lib/search/field-search"

export function DocSearchBox({
  value,
  onChange,
  placeholder,
  fields,
  applied,
  onApply,
  onExpand,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  fields: readonly TruongTim[]
  /** Các trường đang áp. */
  applied: Record<string, string>
  onApply: (values: Record<string, string>) => void
  /** Mở bộ lọc đầy đủ của màn — không có thì ẩn nút "Mở rộng". */
  onExpand?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [nhap, setNhap] = useState<Record<string, string>>(applied)
  useEffect(() => { if (open) setNhap(applied) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const soTruong = soTruongDangTim(applied)

  const tim = () => {
    onApply(Object.fromEntries(fields.map((f) => [f.key, (nhap[f.key] ?? "").trim()])))
    setOpen(false)
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="pl-10 pr-11"
              aria-label={placeholder}
            />
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Tìm theo từng trường"
                aria-expanded={open}
                className={cn(
                  "absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md",
                  soTruong > 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {soTruong > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {soTruong}
                  </span>
                )}
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="min-w-[300px] p-0"
          style={{ width: "var(--radix-popper-anchor-width)" }}
        >
          <form
            onSubmit={(e) => { e.preventDefault(); tim() }}
            className="grid gap-2.5 p-4"
          >
            {fields.map((f, i) => (
              <Input
                key={f.key}
                autoFocus={i === 0}
                value={nhap[f.key] ?? ""}
                onChange={(e) => setNhap((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.goiY ?? f.nhan}
                aria-label={f.nhan}
              />
            ))}
            <div className="-mx-4 mt-1.5 flex justify-end gap-2 border-t px-4 pt-3">
              {onExpand && (
                <Button type="button" variant="outline" onClick={() => { setOpen(false); onExpand() }}>
                  Mở rộng
                </Button>
              )}
              <Button type="submit">Tìm kiếm</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {/* Trường đang áp hiện thành nhãn — gỡ từng cái được, không phải mở lại. */}
      {soTruong > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fields.filter((f) => (applied[f.key] ?? "").trim()).map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {f.nhan}: {applied[f.key]}
              <button
                type="button"
                aria-label={`Bỏ ${f.nhan}`}
                onClick={() => onApply({ ...applied, [f.key]: "" })}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Các ô tìm theo trường, không kèm khung xổ — cho tấm lọc trên điện thoại
 * (`MobileFilterBar`), nơi mọi bộ lọc áp ngay khi đổi.
 */
export function DocFieldInputs({
  fields,
  values,
  onChange,
}: {
  fields: readonly TruongTim[]
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tìm theo</p>
      {fields.map((f) => (
        <Input
          key={f.key}
          value={values[f.key] ?? ""}
          onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
          placeholder={f.goiY ?? f.nhan}
          aria-label={f.nhan}
        />
      ))}
    </div>
  )
}
