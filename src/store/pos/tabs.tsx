"use client"

/**
 * STORE TAB CHỨNG TỪ CỦA `/pos`.
 *
 * ⚠ RIÊNG CỦA `/pos`, KHÔNG DÙNG CHUNG VỚI `/sell`. Spec §12 chốt
 * "Store `/sell` không bị import vào `/pos` và ngược lại". Giỏ của
 * `/sell` là MỘT giỏ cho một NVBH đứng ở quầy; tab của `/pos` là NHIỀU
 * chứng từ mở cùng lúc cho người ngồi văn phòng. Ép chung một store là
 * một trong hai bên phải chịu hình dạng của bên kia.
 *
 * ⚠ KHÔNG THÊM THƯ VIỆN QUẢN LÝ TRẠNG THÁI. Kho mã này không có
 * zustand/redux và Coder Pack cấm thêm lib. Context + `useState` đủ
 * cho một bộ tối đa 8 tab.
 *
 * ⚠ LUẬT NẰM Ở `src/lib/pos/tabs.ts`, KHÔNG NẰM Ở ĐÂY. Chỗ này chỉ nối
 * dây: đọc/ghi state, đẩy URL, gọi toast. Nhét luật vào component là
 * không có cách nào chạy chốt lên nó.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import {
  closeTab as closeTabRule,
  nextNewLabel,
  openTab as openTabRule,
  posHref,
  type PosDocType,
  type PosTab,
} from "@/lib/pos/tabs"

const KEY = "npp.pos.tabs.v1"

interface Value {
  tabs: PosTab[]
  activeKey: string
  /** Đã đọc xong bản lưu chưa — chưa đọc thì đừng vẽ "chưa có tab nào". */
  ready: boolean
  /** Câu cần nói với người dùng; `null` = không có gì. */
  notice: string | null
  clearNotice: () => void
  open: (doc: { docType: PosDocType; docId: string | null; label?: string }) => void
  openNew: (docType: PosDocType) => void
  close: (key: string) => void
  activate: (key: string) => void
  setDirty: (key: string, dirty: boolean) => void
  /** Gắn mã thật cho một tab vừa lưu lần đầu. */
  attach: (key: string, docId: string, label: string) => void
}

const Ctx = createContext<Value | null>(null)

/**
 * ⚠ KHOÁ TAB SINH TỪ BỘ ĐẾM, KHÔNG TỪ `Date.now()`. Hai tab mở trong
 * cùng một mili-giây sẽ trùng khoá, và React sẽ dựng lại nhầm tab.
 */
let dem = 0
const newKey = () => `tab-${++dem}-${Math.random().toString(36).slice(2, 7)}`

export function PosTabsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [tabs, setTabs] = useState<PosTab[]>([])
  const [activeKey, setActiveKey] = useState("")
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * ⚠ KHÔI PHỤC QUA CƠ CHẾ LƯU SẴN CÓ (spec §3 mục 4). `localStorage`
   * là đúng chỗ `/sell` đang lưu giỏ; không dựng thêm cơ chế nào.
   *
   * ⚠ ĐỌC HỎNG THÌ BẮT ĐẦU RỖNG, ĐỪNG NÉM LỖI. Một bản lưu méo mó
   * (đổi phiên bản, người dùng nghịch DevTools) mà làm cả màn trắng
   * thì người dùng không có đường nào tự gỡ.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        const v = JSON.parse(raw) as { tabs?: unknown; activeKey?: unknown }
        const hopLe = Array.isArray(v.tabs)
          ? (v.tabs as PosTab[]).filter(
              (t) => t && typeof t.key === "string" && typeof t.docType === "string"
            )
          : []
        setTabs(hopLe)
        if (typeof v.activeKey === "string" && hopLe.some((t) => t.key === v.activeKey)) {
          setActiveKey(v.activeKey)
        }
      }
    } catch {
      /* bản lưu hỏng — bắt đầu rỗng, xem chú thích trên */
    }
    setReady(true)
  }, [])

  const daNap = useRef(false)
  useEffect(() => {
    if (!ready) return
    // ⚠ Đừng ghi đè bản lưu bằng state rỗng ở lần vẽ đầu.
    if (!daNap.current) { daNap.current = true; return }
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ tabs, activeKey }))
    } catch {
      /* hết chỗ / chế độ riêng tư — không lưu được thì thôi, đừng nổ */
    }
  }, [tabs, activeKey, ready])

  const open = useCallback<Value["open"]>(
    (doc) => {
      setTabs((cu) => {
        const r = openTabRule(
          cu,
          { docType: doc.docType, docId: doc.docId, label: doc.label ?? nextNewLabel(cu, doc.docType) },
          newKey()
        )
        setActiveKey(r.activeKey)
        setNotice(r.notice)
        if (!r.refused) router.push(posHref(doc))
        return r.tabs
      })
    },
    [router]
  )

  const openNew = useCallback<Value["openNew"]>((docType) => open({ docType, docId: null }), [open])

  const close = useCallback<Value["close"]>((key) => {
    setTabs((cu) => {
      const r = closeTabRule(cu, key, activeKeyRef.current)
      setActiveKey(r.activeKey)
      const ke = r.tabs.find((t) => t.key === r.activeKey)
      if (ke) router.push(posHref(ke))
      return r.tabs
    })
  }, [router])

  /* ⚠ `close` đọc `activeKey` qua ref, không qua closure — nếu không
     thì `useCallback` giữ lại giá trị của lần vẽ đầu và đóng tab đang
     đứng lại tính nhầm sang tab khác. */
  const activeKeyRef = useRef(activeKey)
  useEffect(() => { activeKeyRef.current = activeKey }, [activeKey])

  const activate = useCallback<Value["activate"]>(
    (key) => {
      setActiveKey(key)
      setTabs((cu) => {
        const t = cu.find((x) => x.key === key)
        if (t) router.push(posHref(t))
        return cu
      })
    },
    [router]
  )

  const setDirty = useCallback<Value["setDirty"]>((key, dirty) => {
    setTabs((cu) =>
      cu.some((t) => t.key === key && t.dirty === dirty)
        ? cu
        : cu.map((t) => (t.key === key ? { ...t, dirty } : t))
    )
  }, [])

  const attach = useCallback<Value["attach"]>((key, docId, label) => {
    setTabs((cu) => cu.map((t) => (t.key === key ? { ...t, docId, label, dirty: false } : t)))
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  const value = useMemo<Value>(
    () => ({ tabs, activeKey, ready, notice, clearNotice, open, openNew, close, activate, setDirty, attach }),
    [tabs, activeKey, ready, notice, clearNotice, open, openNew, close, activate, setDirty, attach]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosTabs(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosTabs phải nằm trong <PosTabsProvider>")
  return v
}
