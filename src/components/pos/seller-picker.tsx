"use client"

/**
 * Ô GÁN ĐƠN CHO NHÂN VIÊN BÁN HÀNG.
 *
 * ⚠ CHỈ TÊN, KHÔNG THÔNG TIN KÈM. Chủ nhà chốt 22/09/2026, nguyên văn:
 *   "sửa giao diện như hình (chỉ cần tên nhân viên ko cần thông tin
 *   kèm)". Bản vẽ có dòng phụ kiểu "Tuyến Q.8 · Thứ 3 · 4 đơn hôm nay";
 *   chủ nhà bỏ nó đi. Đừng "tiện tay" thêm lại — mỗi dòng phụ ở đây là
 *   một truy vấn nữa cho một việc mỗi đơn làm một lần.
 *
 * ⚠ VÌ SAO KHÔNG DÙNG `<select>` NỮA. Bản trước là `<select>` trần: nó
 *   không có vòng tròn chữ đầu, không có dấu tích ở dòng đang chọn, và
 *   trên Windows nó vẽ theo kiểu của hệ điều hành chứ không theo bản
 *   vẽ. Đây là chỗ DUY NHẤT trong `/pos` quyết định đơn tính doanh số
 *   cho ai, nên nó phải đọc được từ xa.
 *
 * ⚠ "— CHƯA GÁN —" LÀ MỘT LỰA CHỌN THẬT, không phải chỗ trống. Rỗng ở
 *   đây nghĩa là đơn đứng tên người đang đăng nhập (xem mig 153), và
 *   nói ra chứ không để người dùng đoán.
 */

import { useEffect, useRef, useState } from "react"
import { chuCaiDau } from "@/lib/pos/avatar"
import { viMatchAllWords } from "@/lib/search"
import { NGUONG_O_TIM } from "@/components/ui/select"

export interface SellerOption {
  id: string
  full_name: string
}

export function SellerPicker({
  value,
  onChange,
  sellers,
  emptyLabel = "— chưa gán —",
}: {
  value: string
  onChange: (id: string) => void
  sellers: SellerOption[]
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)
  /* Cùng ngưỡng với mọi danh sách thả xuống — xem `NGUONG_O_TIM`. */
  const coTim = sellers.length + 1 >= NGUONG_O_TIM
  const hien = q.trim() ? sellers.filter((u) => viMatchAllWords(q, u.full_name)) : sellers
  useEffect(() => { if (!open) setQ("") }, [open])

  /* Bấm ra ngoài thì đóng — nếu không dải chọn che mất khối tiền. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const dangChon = sellers.find((u) => u.id === value) ?? null
  const ten = dangChon?.full_name || emptyLabel

  return (
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        aria-label="Gán đơn cho nhân viên bán hàng"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}
        className="flex h-[46px] w-full min-w-0 items-center gap-2.5 rounded-[12px] border-[1.5px] border-[var(--pos-edge)] bg-white px-2.5 text-left"
      >
        <Vong ten={dangChon ? ten : "?"} mo={!!dangChon} />
        <span className="min-w-0 flex-grow truncate text-[13.5px] font-bold text-[var(--pos-ink)]">
          {ten}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--pos-dim)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-[12px] border-[1.5px] border-[var(--pos-edge)] bg-white shadow-[0_12px_28px_rgba(15,23,42,.16)]">
          {coTim && (
            <div className="border-b border-[var(--pos-line-soft)] p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}
                placeholder="Tìm nhân viên…"
                aria-label="Tìm nhân viên bán hàng"
                className="h-9 w-full rounded-[9px] border-[1.5px] border-[var(--pos-edge)] px-2.5 text-[13px] font-semibold text-[var(--pos-ink)] outline-none focus:border-[var(--pos-primary)]"
              />
            </div>
          )}
          <ul className="max-h-[260px] overflow-y-auto">
            {/* ⚠ Dòng "chưa gán" đứng đầu, và nó chọn được như mọi dòng
                khác — gán nhầm rồi phải gỡ ra được. */}
            <Dong
              ten={emptyLabel}
              mo={false}
              chon={!dangChon}
              onClick={() => { onChange(""); setOpen(false) }}
            />
            {hien.map((u) => (
              <Dong
                key={u.id}
                ten={u.full_name || "(chưa đặt tên)"}
                mo
                chon={u.id === value}
                onClick={() => { onChange(u.id); setOpen(false) }}
              />
            ))}
            {hien.length === 0 && (
              <li className="px-3 py-3 text-center text-[12.5px] text-[var(--pos-muted)]">Không có nhân viên nào khớp</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function Vong({ ten, mo }: { ten: string; mo: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${
        mo
          ? "bg-[var(--pos-primary-soft)] text-[var(--pos-primary-deep)]"
          : "bg-[var(--pos-line-soft)] text-[var(--pos-dim)]"
      }`}
    >
      {mo ? chuCaiDau(ten, "nguoi") : "—"}
    </span>
  )
}

function Dong({
  ten,
  mo,
  chon,
  onClick,
}: {
  ten: string
  mo: boolean
  chon: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left ${
          chon ? "bg-[var(--pos-primary-faint)]" : "hover:bg-[var(--pos-bg)]"
        }`}
      >
        <Vong ten={ten} mo={mo} />
        <span className="min-w-0 flex-grow truncate text-[13.5px] font-bold text-[var(--pos-ink)]">
          {ten}
        </span>
        {chon && (
          <span className="shrink-0 text-[13px] font-extrabold text-[var(--pos-primary-deep)]">✓</span>
        )}
      </button>
    </li>
  )
}
