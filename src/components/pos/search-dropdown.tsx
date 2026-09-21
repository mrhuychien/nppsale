"use client"

/**
 * DROPDOWN TÌM HÀNG (F3) / TÌM ĐỐI TÁC (F4) — spec §9.
 *
 * ⚠ BẤM VÀO LÀ XỔ LIST NGAY, KHÔNG ĐỢI GÕ. Chủ nhà đã chốt luật này
 * cho toàn app ("bấm vào là phải xổ list rồi, như khi chọn NCC ấy") và
 * nó đảo ngược một luật cũ. Ô rỗng trả về danh sách rỗng là người dùng
 * không biết có gì để chọn, và phải đoán từ khoá.
 *
 * ⚠ `↑` `↓` `Enter` PHẢI CHẠY. Spec §10. Người ngồi bàn giấy gõ liên
 * tục; bắt họ rời bàn phím để bấm chuột từng dòng là bỏ đi cả lý do
 * tồn tại của màn desktop.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { viQueryWords, viSearchKey, viMatchKey } from "@/lib/search"

export interface SearchItem {
  id: string
  /** Dòng chính. */
  title: string
  /** `mã · ĐVT · Tồn N` hoặc `mã · SĐT · tuyến`. */
  meta?: string
  /** Số bên phải: giá, hoặc công nợ. */
  right?: ReactNode
  /** Chữ dùng để tìm, ngoài `title` và `meta`. */
  keywords?: string
  /** Hết hàng / nợ quá hạn — tô đỏ phần `meta`. */
  alert?: boolean
}

export function SearchDropdown({
  open,
  onClose,
  title,
  placeholder,
  items,
  onPick,
  onCreate,
  createLabel,
  emptyHint,
}: {
  open: boolean
  onClose: () => void
  title: string
  placeholder: string
  items: SearchItem[]
  onPick: (item: SearchItem) => void
  onCreate?: () => void
  createLabel?: string
  emptyHint?: string
}) {
  const [q, setQ] = useState("")
  const [i, setI] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ("")
      setI(0)
      /* ⚠ Đưa tiêu điểm vào ô tìm NGAY. Mở dropdown rồi còn phải bấm
         vào ô là thêm một nhịp cho việc làm nhiều nhất trên màn. */
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  /**
   * ⚠ CHỈ MỤC CHUẨN HOÁ MỘT LẦN, không chuẩn hoá lại ở mỗi phím gõ.
   * Danh mục 1.700 mã × 3 trường ở mỗi ký tự là 15–40 ms mỗi phím trên
   * máy yếu — ô tìm "nuốt" chữ. Xem `viSearchKey`.
   */
  const keys = useMemo(
    () => items.map((it) => viSearchKey(it.title, it.meta ?? "", it.keywords ?? "")),
    [items]
  )

  const ketQua = useMemo(() => {
    const words = viQueryWords(q)
    // ⚠ Ô rỗng thì xổ hết — xem đầu tệp.
    if (!words.length) return items.slice(0, 50)
    const out: SearchItem[] = []
    for (let k = 0; k < items.length && out.length < 50; k++) {
      if (viMatchKey(keys[k], words)) out.push(items[k])
    }
    return out
  }, [q, items, keys])

  useEffect(() => { setI(0) }, [q])

  /* Giữ dòng đang chọn trong tầm nhìn khi đi bằng ↑↓. */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [i])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(ketQua.length - 1, v + 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      const it = ketQua[i]
      if (it) { onPick(it); onClose() }
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-[var(--pos-ink)]/10"
      />
      <div
        className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-[14px] border border-[var(--pos-line)] bg-white shadow-[0_10px_30px_rgba(15,23,42,.13)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-[46px] items-center gap-2 border-b border-[var(--pos-line-soft)] px-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--pos-dim)" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            aria-label={title}
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-0 flex-grow text-[13px] text-[var(--pos-ink)] outline-none"
          />
          <span className="n shrink-0 text-[11px] font-bold text-[var(--pos-muted)]">{ketQua.length} kết quả</span>
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {ketQua.length === 0 && (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-[var(--pos-muted)]">
              {emptyHint || "Không tìm thấy gì khớp."}
            </p>
          )}
          {ketQua.map((it, k) => (
            <button
              key={it.id}
              type="button"
              data-i={k}
              onMouseEnter={() => setI(k)}
              onClick={() => { onPick(it); onClose() }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
                k === i ? "border-l-[3px] border-[var(--pos-primary)] bg-[var(--pos-primary-faint)] pl-[11px]" : "border-l-[3px] border-transparent pl-[11px]"
              }`}
            >
              <span className="min-w-0 flex-grow">
                <span className="block truncate text-[13px] font-bold text-[var(--pos-ink)]">{it.title}</span>
                {it.meta && (
                  <span className={`n mt-px block truncate text-[11px] ${it.alert ? "text-[var(--pos-danger)]" : "text-[var(--pos-muted)]"}`}>
                    {it.meta}
                  </span>
                )}
              </span>
              {it.right && <span className="shrink-0 text-right">{it.right}</span>}
            </button>
          ))}
        </div>

        <div className="flex h-[42px] items-center gap-2 border-t border-[var(--pos-line-soft)] px-3.5">
          {onCreate && (
            <button
              type="button"
              onClick={() => { onCreate(); onClose() }}
              className="text-[12px] font-extrabold text-[var(--pos-primary-deep)]"
            >
              + {createLabel || "Thêm mới"}
            </button>
          )}
          <span className="flex-grow" />
          <span className="text-[11px] text-[var(--pos-muted)]">↑↓ chọn · Enter thêm</span>
        </div>
      </div>
    </>
  )
}
