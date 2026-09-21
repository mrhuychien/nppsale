"use client"

/**
 * TOPBAR `/pos` — logo · tab chứng từ · icon + người dùng. Spec §2 và §3.
 *
 * ⚠ KHÔNG CÓ Ô TÌM HÀNG Ở ĐÂY NỮA, và đừng đặt lại. Ô ấy đã đi qua ba
 * chỗ, mỗi lần một câu chốt của chủ nhà:
 *   · hai ô (một nút trên header + một `ProductPicker` trên bảng) →
 *     chủ nhà đếm được và bác: *"Bỏ bớt 1 cái thêm hàng. đang có 2 cái"*;
 *   · một ô, trên header (đợt 9);
 *   · một ô, ở CỘT PHẢI — bản thiết kế 21/09/2026, chủ nhà chốt *"2 bên
 *     phải"*. Xem `components/pos/product-search-box.tsx`.
 *
 * Luật bất biến qua cả ba lần: ĐÚNG MỘT ô tìm hàng trong cả `/pos`.
 * Thêm một ô vào đây là quay lại cái đã bị bác.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { ROLE_LABELS } from "@/lib/constants"
import { usePosTabs } from "@/store/pos/tabs"
import { posPrintHref } from "@/lib/pos/tabs"
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
  const router = useRouter()
  const { notice, clearNotice, tabs, activeKey } = usePosTabs()
  const [moThietLap, setMoThietLap] = useState(false)
  const dang = tabs.find((t) => t.key === activeKey)
  const inHref = dang?.docId ? posPrintHref(dang.docType, dang.docId) : null

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
      <div className="flex h-14 shrink-0 items-center gap-5 border-b border-[var(--pos-bar-line)] bg-[var(--pos-bar)] px-5">
        {/*
          ⚠ Ô LOGO GIỮ MÀU XANH KHI THANH ĐÃ TRẮNG. Bản thiết kế
            21/09/2026 chuyển nền thanh sang trắng nhưng để lại đúng một
            mảng xanh ở đây — bỏ nốt nó là thanh trên cùng không còn chỗ
            nào nhận ra đây là app nào.
        */}
        <button
          type="button"
          onClick={() => router.push("/pos")}
          className="flex shrink-0 items-center gap-3 text-left"
          title="Về trang mở chứng từ"
        >
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[var(--pos-primary)] text-[14px] font-extrabold text-white">
            N
          </span>
          <span className="whitespace-nowrap text-[15px] font-extrabold text-[var(--pos-bar-fg)]">
            POS bán hàng
          </span>
        </button>

        <div className="flex-grow" />

        <DocTabs />

        <div className="flex shrink-0 items-center gap-1.5">
          {/*
            ⚠ IN ĐI QUA MẪU IN ĐANG CHẠY, KHÔNG `window.print()` MÀN POS.
              Màn POS không có mẫu in; in thẳng nó là ra một trang toàn
              nút và ô nhập. Chứng từ đã lưu thì có trang in riêng ở
              phần đang chạy — dẫn tới đó. Chưa lưu thì nút mờ và nói
              vì sao.
          */}
          <button
            type="button"
            aria-label="In chứng từ đang mở"
            disabled={!inHref}
            title={inHref ? "Mở trang in" : "Chỉ in được chứng từ đã lưu (đơn hàng, hóa đơn)"}
            onClick={() => { if (inHref) window.open(inHref, "_blank") }}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" />
              <path d="M6 14h12v7H6z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Thiết lập hiển thị"
            onClick={() => setMoThietLap(true)}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
              <circle cx="16" cy="8" r="2" />
              <circle cx="10" cy="16" r="2" />
            </svg>
          </button>
          {/* ⚠ VẠCH NGĂN LÀ MỘT Ô CÓ CHIỀU CAO RIÊNG, không phải `border-l`
              chạy hết chiều cao thanh — bản thiết kế để nó cao 24px, ngắn
              hơn thanh, nên hai bên đọc như hai nhóm chứ không như hai cột. */}
          <span className="mx-1 h-6 w-px shrink-0 bg-[var(--pos-bar-line)]" />
          <div className="flex items-center gap-2">
            {/* ⚠ Avatar trên nền TRẮNG dùng nền xanh nhạt + chữ xanh đậm.
                Bản nền-xanh trước đây dùng chữ trắng; giữ nguyên là một
                ô trắng trên nền trắng. */}
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--pos-primary-soft)] text-[11px] font-extrabold text-[var(--pos-primary-deep)]">
              {viTat(user?.full_name || "")}
            </div>
            <div>
              <div className="whitespace-nowrap text-[13px] font-bold text-[var(--pos-bar-fg)]">
                {user?.full_name || "—"}
              </div>
              {/* ⚠ Nhãn tiếng Việt, không phải mã vai `owner`. */}
              <div className="text-[11px] font-semibold text-[var(--pos-bar-dim)]">
                {user?.role ? ROLE_LABELS[user.role] ?? user.role : ""}
              </div>
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
          className="flex shrink-0 items-center gap-2 border-b border-[var(--pos-primary-border)] bg-[var(--pos-primary-faint)] px-4 py-2 text-[12.5px] font-medium text-[var(--pos-primary-deep)]"
        >
          <span className="flex-grow">{notice}</span>
          <button
            type="button"
            onClick={clearNotice}
            aria-label="Đóng thông báo"
            className="shrink-0 rounded px-2 py-0.5 text-[var(--pos-primary-deep)] hover:bg-[var(--pos-primary-soft)]"
          >
            ×
          </button>
        </div>
      )}

      <DisplaySettingsDrawer open={moThietLap} onClose={() => setMoThietLap(false)} />
    </>
  )
}
