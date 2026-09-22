"use client"

/**
 * Ô TÌM ĐỐI TÁC (F4) — CHỌN KHÁCH / CHỌN NCC.
 *
 * ⚠ TÊN `SearchDropdown` LÀ TÊN CŨ, VÀ NÓ ĐANG NÓI SAI. Từ 22/09/2026
 *   component này vẽ một HỘP GIỮA MÀN, không còn là dải xổ dưới ô nữa
 *   (chủ nhà chốt: "Chọn khách hàng -> hiện modal chọn", kèm bản vẽ).
 *   Tên giữ nguyên vì bốn chốt đang neo vào đúng tên ấy để canh việc
 *   "ô tìm khách vẫn là component của POS, không bị thay bằng cái
 *   khác" — đổi tên là phải sửa chốt, mà sửa chốt để chúng xanh lại là
 *   đúng thứ kho mã này cấm. Đọc dòng này trước khi tưởng nó là dropdown.
 *
 * ⚠ CẢ BỐN NƠI GỌI ĐỀU LÀ Ô CHỌN ĐỐI TÁC (khách ở màn đơn và màn phiếu
 *   trả, NCC ở màn nhập hàng và màn trả NCC). Không có nơi nào dùng nó
 *   để tìm HÀNG — ô tìm hàng là `PosProductSearchBox`. Vì vậy đổi sang
 *   hộp giữa màn là đổi đúng một loại việc, không đụng ô tìm hàng.
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
import { chuCaiDau } from "@/lib/pos/avatar"

/**
 * Trần số dòng VẼ RA.
 *
 * ⚠ ĐÂY LÀ TRẦN VẼ, KHÔNG PHẢI SỐ KHỚP. Giữ trần là đúng — một nhà phân
 *   phối có vài nghìn khách, vẽ hết ra là ô tìm khựng ở mỗi phím gõ.
 *   Nhưng xem `soKhop` bên dưới: phải ĐẾM ĐỦ rồi mới cắt, vì con số hiện
 *   lên là lời màn hình nói với người dùng.
 */
const TRAN_VE = 50

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
      /* ⚠ Đưa tiêu điểm vào ô tìm NGAY. Mở hộp rồi còn phải bấm vào ô
         là thêm một nhịp cho việc làm nhiều nhất trên màn. */
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

  /**
   * ĐẾM ĐỦ RỒI MỚI CẮT.
   *
   * ⚠ BẢN TRƯỚC NÓI DỐI, và chủ nhà bắt được: "Sao phần tìm khách hiện
   *   tại có 50 kết quả?". Nó dừng vòng lặp ở mã thứ 50 rồi hiện
   *   `ketQua.length` — nên với tám trăm khách khớp chữ "a", màn hình
   *   vẫn ghi đúng "50 kết quả". Người dùng đọc ra "chỉ có 50 khách tên
   *   a", không tìm thấy khách của mình và kết luận là khách chưa được
   *   tạo — rồi đi tạo trùng.
   *
   * ⚠ ĐẾM HẾT LÀ RẺ, VẼ HẾT MỚI ĐẮT. Vòng lặp so chuỗi trên vài nghìn
   *   mã là vài trăm micro-giây; dựng vài nghìn nút DOM mới là chỗ
   *   khựng. Nên đếm đủ, cắt phần VẼ, và nói ra là đã cắt.
   */
  const { ketQua, soKhop } = useMemo(() => {
    const words = viQueryWords(q)
    if (!words.length) return { ketQua: items.slice(0, TRAN_VE), soKhop: items.length }
    const out: SearchItem[] = []
    let n = 0
    for (let k = 0; k < items.length; k++) {
      if (!viMatchKey(keys[k], words)) continue
      n++
      if (out.length < TRAN_VE) out.push(items[k])
    }
    return { ketQua: out, soKhop: n }
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
    } else if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        className="fixed inset-0 z-[60] cursor-default bg-[var(--pos-ink)]/35"
      />
      {/*
        ⚠ HỘP GIỮA MÀN, `fixed` chứ không `absolute`. Bản trước neo vào
          thẻ đối tác ở cột phải nên dải xổ chỉ rộng bằng cột ấy và bị
          cắt cụt khi cột cuộn. Hộp giữa màn không phụ thuộc vào thẻ nào
          cả — và đó cũng là lý do nó không còn phải nằm trong một thẻ
          `relative`.
      */}
      <div
        role="dialog"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-[61] flex max-h-[min(560px,84vh)] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[18px] border border-[var(--pos-line)] bg-white shadow-[0_24px_60px_rgba(15,23,42,.24)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-4">
          <span className="min-w-0 flex-grow text-[17px] font-extrabold text-[var(--pos-ink)]">
            {title}
          </span>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-full text-[18px] font-bold text-[var(--pos-dim)] hover:bg-[var(--pos-bg)]"
          >
            ×
          </button>
        </div>

        <div className="shrink-0 px-5 pb-3 pt-2">
          <div className="flex h-[42px] items-center gap-2 rounded-[12px] border-[1.5px] border-[var(--pos-edge)] px-3">
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
              className="min-w-0 flex-grow text-[14px] text-[var(--pos-ink)] outline-none"
            />
            {/*
              ⚠ NÓI RÕ ĐANG HIỆN BAO NHIÊU TRONG BAO NHIÊU. Hiện mỗi một
                con số là người dùng không biết mình đang nhìn một phần
                hay toàn bộ — và không biết rằng gõ thêm sẽ ra khác.
            */}
            <span className="n shrink-0 text-[11px] font-bold text-[var(--pos-muted)]">
              {soKhop > ketQua.length
                ? `hiện ${ketQua.length} trong ${soKhop}`
                : `${soKhop} kết quả`}
            </span>
          </div>
          {soKhop > ketQua.length && (
            <p className="mt-1.5 text-[11px] font-semibold text-[var(--pos-muted)]">
              Danh sách chỉ vẽ {TRAN_VE} dòng đầu — gõ thêm để thu hẹp.
            </p>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-grow overflow-y-auto border-t border-[var(--pos-line-soft)]">
          {ketQua.length === 0 && (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--pos-muted)]">
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
              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left ${
                k === i ? "bg-[var(--pos-primary-faint)]" : ""
              }`}
            >
              {/* Vòng tròn chữ đầu — xem `@/lib/pos/avatar` về cách lấy chữ. */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pos-primary-soft)] text-[13px] font-extrabold text-[var(--pos-primary-deep)]">
                {chuCaiDau(it.title)}
              </span>
              <span className="min-w-0 flex-grow">
                <span className="block truncate text-[14px] font-bold text-[var(--pos-ink)]">{it.title}</span>
                {it.meta && (
                  <span className={`n mt-px block truncate text-[12px] ${it.alert ? "text-[var(--pos-danger)]" : "text-[var(--pos-muted)]"}`}>
                    {it.meta}
                  </span>
                )}
              </span>
              {it.right && <span className="shrink-0 text-right">{it.right}</span>}
            </button>
          ))}
        </div>

        <div className="flex h-[46px] shrink-0 items-center gap-2 border-t border-[var(--pos-line-soft)] px-5">
          {onCreate && (
            <button
              type="button"
              onClick={() => { onCreate(); onClose() }}
              className="text-[12.5px] font-extrabold text-[var(--pos-primary-deep)]"
            >
              + {createLabel || "Thêm mới"}
            </button>
          )}
          <span className="flex-grow" />
          <span className="text-[11px] text-[var(--pos-muted)]">↑↓ chọn · Enter chọn · Esc đóng</span>
        </div>
      </div>
    </>
  )
}
