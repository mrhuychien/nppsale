"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Tìm đơn hàng trên mobile.
 *
 * Ô tìm kiếm trong app bar trước đây là `hidden md:block`, nên trên điện
 * thoại KHÔNG có đường nào để tìm một mã đơn — NVBH phải cuộn danh sách.
 * Đây là lớp phủ toàn màn thay cho ô đó.
 *
 * Bấm Enter (hoặc nút "Tìm" trên bàn phím ảo, nhờ enterKeyHint) đi tới
 * /orders?q=… — đúng tham số trang danh sách đơn đang đọc.
 */
export function MobileSearchOverlay({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [q, setQ] = useState("")
  const ref = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Bàn phím ảo iOS chỉ bật khi focus xảy ra sau khi phần tử đã vào DOM.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => ref.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Nút Back của Android / Esc phải đóng lớp phủ, không phải rời trang.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const go = () => {
    const term = q.trim()
    if (!term) return
    onClose()
    setQ("")
    router.push(`/orders?q=${encodeURIComponent(term)}`)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-surface md:hidden pt-safe">
      <div className="flex items-center gap-2 p-2 border-b border-outline-variant">
        <Search className="h-5 w-5 shrink-0 text-on-surface-variant ml-2" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          inputMode="search"
          enterKeyHint="search"
          placeholder="Mã đơn, tên khách…"
          aria-label="Tìm đơn hàng"
          className="flex-1 h-11 min-w-0 bg-transparent text-base outline-none placeholder:text-on-surface-variant/60"
        />
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Đóng">
          <X className="h-5 w-5" />
        </Button>
      </div>
      <p className="p-4 text-sm text-on-surface-variant">
        Gõ mã đơn hoặc tên khách rồi bấm Tìm trên bàn phím.
      </p>
    </div>
  )
}
