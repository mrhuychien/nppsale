"use client"

/**
 * TOPBAR `/pos` — logo · ô tìm hàng (F3) · tab chứng từ · icon + người dùng.
 * Spec §2 và §3.
 */

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { usePosTabs } from "@/store/pos/tabs"
import { DocTabs } from "@/components/pos/doc-tabs"
import { DisplaySettingsDrawer } from "@/components/pos/display-settings-drawer"

/** Chữ cái đầu để làm avatar — hai chữ, đúng như bản thiết kế. */
function viTat(ten: string): string {
  const w = ten.trim().split(/\s+/).filter(Boolean)
  if (w.length === 0) return "?"
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[w.length - 2][0] + w[w.length - 1][0]).toUpperCase()
}

export function PosTopBar() {
  const { user } = useAuth()
  const { notice, clearNotice } = usePosTabs()
  const [moThietLap, setMoThietLap] = useState(false)
  const timRef = useRef<HTMLInputElement>(null)

  /**
   * ⚠ CÂU NHẮC TỰ TẮT SAU 6 GIÂY. Nó nói một việc đã xảy ra rồi ("đã
   * chuyển tới tab 2"), không đòi người dùng làm gì — để nằm mãi là
   * nó che mất câu nhắc tiếp theo.
   */
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 6000)
    return () => clearTimeout(t)
  }, [notice, clearNotice])

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-5 bg-[#0f172a] px-4">
        <div className="w-[150px] shrink-0">
          <div className="truncate text-[13px] font-bold tracking-[0.02em] text-white">
            npp.sale
          </div>
          <div className="mt-px truncate text-[11px] text-[#94a3b8]">
            {user?.full_name || "Đang tải…"}
          </div>
        </div>

        {/* Ô tìm hàng — F3 đưa tiêu điểm về đây, xem `usePosKeys`. */}
        <div className="flex h-9 w-[320px] shrink-0 items-center gap-2 rounded-lg border border-[#334155] bg-[#1e293b] px-2.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={timRef}
            id="pos-tim-hang"
            type="text"
            aria-label="Tìm hàng hóa"
            placeholder="Tìm hàng hóa, mã vạch…"
            className="min-w-0 flex-grow bg-transparent text-[13px] text-[#e2e8f0] outline-none placeholder:text-[#64748b]"
          />
          <span className="n shrink-0 rounded border border-[#475569] bg-[#0f172a] px-1.5 py-0.5 text-[10px] text-[#94a3b8]">
            F3
          </span>
        </div>

        <DocTabs />

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Thiết lập hiển thị"
            onClick={() => setMoThietLap(true)}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] hover:bg-[#1e293b]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
              <circle cx="16" cy="8" r="2" />
              <circle cx="10" cy="16" r="2" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="In phiếu"
            onClick={() => window.print()}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] hover:bg-[#1e293b]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" />
              <path d="M6 14h12v7H6z" />
            </svg>
          </button>
          <div className="ml-1 flex items-center gap-2 border-l border-[#334155] pl-2">
            <div className="text-right">
              <div className="text-[12px] font-semibold text-white">{user?.full_name || "—"}</div>
              <div className="text-[10px] text-[#94a3b8]">{user?.role || ""}</div>
            </div>
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#2563eb] text-[11px] font-bold text-white">
              {viTat(user?.full_name || "")}
            </div>
          </div>
        </div>
      </div>

      {/*
        ⚠ CÂU NHẮC NẰM NGAY DƯỚI TAB, KHÔNG PHẢI TOAST GÓC MÀN. Nó nói
          về một tab vừa được chuyển tới; đặt nó cạnh dãy tab là người
          đọc nhìn thấy cả câu lẫn thứ câu ấy nói tới.
      */}
      {notice && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-[#bfdbfe] bg-[#eff6ff] px-4 py-2 text-[12.5px] font-medium text-[#1e3a8a]"
        >
          <span className="flex-grow">{notice}</span>
          <button
            type="button"
            onClick={clearNotice}
            aria-label="Đóng thông báo"
            className="shrink-0 rounded px-2 py-0.5 text-[#1d4ed8] hover:bg-[#dbeafe]"
          >
            ×
          </button>
        </div>
      )}

      <DisplaySettingsDrawer open={moThietLap} onClose={() => setMoThietLap(false)} />
    </>
  )
}
