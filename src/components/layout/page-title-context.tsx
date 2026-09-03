"use client"

import * as React from "react"

/**
 * Đường dẫn để PageHeader "đẩy" tiêu đề trang lên app bar.
 *
 * VÌ SAO CẦN: header.tsx render tiêu đề từ bảng PAGE_TITLES ("Quản lý công
 * nợ"), rồi mỗi trang lại render <PageHeader title="Công nợ của tôi"> ngay
 * bên dưới — hai tiêu đề khác chữ, cùng nghĩa, tốn khoảng 120px chiều cao
 * trên màn hình cao 691px. Sau khi đẩy lên, app bar hiện đúng tiêu đề của
 * trang và PageHeader tự ẩn H1 của nó trên mobile.
 *
 * backHref có BA trạng thái, không phải hai:
 *   undefined → trang không khai báo nút back → app bar hiện hamburger
 *   null      → có nút back, bấm là router.back()
 *   "/orders" → có nút back, bấm là đi tới đường dẫn đó
 * Nên đừng đổi `undefined` thành `null` ở bất kỳ đâu: làm thế là mất nút mở
 * menu trên mọi trang chi tiết.
 */
interface PageTitleState {
  title: string | null
  backHref: string | null | undefined
  setPageTitle: (t: { title: string; backHref?: string | null }) => void
  clearPageTitle: () => void
}

const Ctx = React.createContext<PageTitleState | null>(null)

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = React.useState<string | null>(null)
  const [backHref, setBackHref] = React.useState<string | null | undefined>(undefined)

  const setPageTitle = React.useCallback(
    (t: { title: string; backHref?: string | null }) => {
      setTitle(t.title)
      setBackHref(t.backHref)
    },
    []
  )

  const clearPageTitle = React.useCallback(() => {
    setTitle(null)
    setBackHref(undefined)
  }, [])

  const value = React.useMemo(
    () => ({ title, backHref, setPageTitle, clearPageTitle }),
    [title, backHref, setPageTitle, clearPageTitle]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Bản dùng được ngoài Provider — trả về no-op thay vì ném lỗi.
 *
 * PageHeader được dùng ở cả những trang KHÔNG nằm trong (dashboard) —
 * /login, /setup, trang lỗi — nơi không có Provider. Ném lỗi ở đó là làm
 * trắng màn hình đăng nhập chỉ để phục vụ một tính năng trình bày.
 */
export function usePageTitleOptional(): PageTitleState {
  const ctx = React.useContext(Ctx)
  return ctx ?? NOOP
}

const NOOP: PageTitleState = {
  title: null,
  backHref: undefined,
  setPageTitle: () => {},
  clearPageTitle: () => {},
}

/** Dùng trong app bar — ở đó Provider luôn có, thiếu là lỗi lập trình. */
export function usePageTitle(): PageTitleState {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("usePageTitle phải nằm trong <PageTitleProvider>")
  return ctx
}
