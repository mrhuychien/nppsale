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
 *
 * ⚠ URL LÀ NGUỒN SỰ THẬT THỨ HAI, VÀ STORE PHẢI NGHE NÓ. Bản đầu chỉ
 * viết một chiều (bấm tab → đẩy URL). Người dùng dán thẳng một đường
 * dẫn, hoặc màn lập đơn `replace` URL sang mã thật sau khi lưu — cả hai
 * làm URL đi trước mà tab đứng yên. Xem `parsePosPath` và `dongBoUrl`.
 *
 * ⚠ KHÔNG LÀM VIỆC PHỤ BÊN TRONG HÀM CẬP NHẬT STATE. Bản đầu gọi
 * `router.push` và `setNotice` ngay trong `setTabs((cu) => …)`. React
 * được quyền chạy hàm ấy HAI lần (StrictMode) — và chạy hai lần là đẩy
 * URL hai lần, nháy câu nhắc hai lần. Nay đọc state qua `ref` rồi tính
 * xong mới ghi.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  closeTab as closeTabRule,
  nextNewLabel,
  openTab as openTabRule,
  parsePosPath,
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
  /**
   * Đặt tên cho tab của một chứng từ đã lưu — màn nào đọc được mã thì
   * gọi. Không có tab nào khớp thì thôi.
   */
  label: (docType: PosDocType, docId: string, label: string) => void
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
  const pathname = usePathname()
  const [tabs, setTabs] = useState<PosTab[]>([])
  const [activeKey, setActiveKey] = useState("")
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /* ⚠ Đọc state qua ref — xem đầu tệp. */
  const tabsRef = useRef(tabs)
  const activeKeyRef = useRef(activeKey)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeKeyRef.current = activeKey }, [activeKey])

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
        tabsRef.current = hopLe
        setTabs(hopLe)
        if (typeof v.activeKey === "string" && hopLe.some((t) => t.key === v.activeKey)) {
          activeKeyRef.current = v.activeKey
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

  /** Ghi cả hai state cùng lúc và giữ ref đi trước render. */
  const ghi = useCallback((t: PosTab[], k: string) => {
    tabsRef.current = t
    activeKeyRef.current = k
    setTabs(t)
    setActiveKey(k)
  }, [])

  const open = useCallback<Value["open"]>(
    (doc) => {
      const cu = tabsRef.current
      const r = openTabRule(
        cu,
        { docType: doc.docType, docId: doc.docId, label: doc.label ?? nextNewLabel(cu, doc.docType) },
        newKey()
      )
      ghi(r.tabs, r.activeKey)
      setNotice(r.notice)
      if (!r.refused) router.push(posHref(doc))
    },
    [router, ghi]
  )

  const openNew = useCallback<Value["openNew"]>((docType) => open({ docType, docId: null }), [open])

  const close = useCallback<Value["close"]>(
    (key) => {
      const r = closeTabRule(tabsRef.current, key, activeKeyRef.current)
      ghi(r.tabs, r.activeKey)
      const ke = r.tabs.find((t) => t.key === r.activeKey)
      /* ⚠ Đóng tab cuối cùng thì về trang gốc `/pos` — đứng lại ở URL
         của tab vừa đóng là màn hình vẽ một chứng từ không còn tab. */
      router.push(ke ? posHref(ke) : "/pos")
    },
    [router, ghi]
  )

  const activate = useCallback<Value["activate"]>(
    (key) => {
      const t = tabsRef.current.find((x) => x.key === key)
      if (!t) return
      ghi(tabsRef.current, key)
      router.push(posHref(t))
    },
    [router, ghi]
  )

  const setDirty = useCallback<Value["setDirty"]>((key, dirty) => {
    setTabs((cu) =>
      cu.some((t) => t.key === key && t.dirty === dirty)
        ? cu
        : cu.map((t) => (t.key === key ? { ...t, dirty } : t))
    )
  }, [])

  const label = useCallback<Value["label"]>((docType, docId, ten) => {
    setTabs((cu) =>
      cu.some((t) => t.docType === docType && t.docId === docId && t.label !== ten)
        ? cu.map((t) => (t.docType === docType && t.docId === docId ? { ...t, label: ten } : t))
        : cu
    )
  }, [])

  /**
   * ĐỒNG BỘ TỪ URL VỀ TAB — xem đầu tệp.
   *
   * Ba trường hợp, theo thứ tự:
   *   1. đã có tab của đúng chứng từ này → chỉ kích hoạt, KHÔNG đẩy URL
   *      (đẩy là lặp vô hạn với chính effect này);
   *   2. tab đang đứng là chứng từ MỚI cùng loại → đây là màn vừa lưu
   *      xong và `replace` URL sang mã thật: gắn mã vào tab ấy, giữ tên
   *      tạm cho tới khi màn gọi `label`;
   *   3. không có gì khớp → mở tab mới, tên tạm là mã rút gọn.
   *
   * ⚠ CHỜ `ready`. Chạy trước khi đọc xong bản lưu là mở một tab trùng
   * với tab sắp được khôi phục.
   */
  useEffect(() => {
    if (!ready) return
    const doc = parsePosPath(pathname)
    if (!doc) return
    const cu = tabsRef.current
    const dang = cu.find((t) => t.key === activeKeyRef.current)

    if (doc.docId === null) {
      /* Chứng từ mới: chỉ mở khi tab đang đứng KHÔNG phải một chứng từ
         mới cùng loại — `openNew` đã tạo tab rồi mới đẩy URL. */
      if (dang && dang.docType === doc.docType && dang.docId === null) return
      const r = openTabRule(cu, { ...doc, label: nextNewLabel(cu, doc.docType) }, newKey())
      ghi(r.tabs, r.activeKey)
      if (r.refused) setNotice(r.notice)
      return
    }

    const co = cu.find((t) => t.docType === doc.docType && t.docId === doc.docId)
    if (co) {
      if (co.key !== activeKeyRef.current) ghi(cu, co.key)
      return
    }
    if (dang && dang.docType === doc.docType && dang.docId === null) {
      ghi(
        cu.map((t) => (t.key === dang.key ? { ...t, docId: doc.docId, dirty: false } : t)),
        dang.key
      )
      return
    }
    const r = openTabRule(cu, { ...doc, label: doc.docId.slice(0, 8) + "…" }, newKey())
    ghi(r.tabs, r.activeKey)
    if (r.refused) setNotice(r.notice)
  }, [pathname, ready, ghi])

  const clearNotice = useCallback(() => setNotice(null), [])

  const value = useMemo<Value>(
    () => ({ tabs, activeKey, ready, notice, clearNotice, open, openNew, close, activate, setDirty, label }),
    [tabs, activeKey, ready, notice, clearNotice, open, openNew, close, activate, setDirty, label]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosTabs(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosTabs phải nằm trong <PosTabsProvider>")
  return v
}

/**
 * Màn chứng từ gọi hook này khi đã biết mã thật — tab đổi tên theo.
 *
 * ⚠ CHỈ GỌI KHI CÓ CẢ HAI. `docId` rỗng là chứng từ chưa lưu, chưa có
 * gì để đặt tên; `label` rỗng là chưa đọc xong.
 */
export function usePosDocLabel(docType: PosDocType, docId: string | null | undefined, ten: string | null | undefined) {
  const { label } = usePosTabs()
  useEffect(() => {
    if (docId && ten) label(docType, docId, ten)
  }, [docType, docId, ten, label])
}

/**
 * Báo tab đang đứng là "chưa lưu".
 *
 * ⚠ SO VỚI MỘT MỐC, KHÔNG SO VỚI RỖNG. Màn nạp chứng từ đã lưu lên thì
 * bộ dòng khác rỗng ngay mà chưa ai sửa gì — coi đó là "chưa lưu" là
 * chip cam hiện trên mọi tab vừa mở. Nơi gọi truyền `signature` (chuỗi
 * tóm tắt state) và `baseline` (chữ ký lúc nạp xong / lưu xong).
 */
export function usePosDirty(signature: string, baseline: string | null) {
  const { activeKey, setDirty } = usePosTabs()
  useEffect(() => {
    if (!activeKey) return
    setDirty(activeKey, baseline != null && signature !== baseline)
  }, [activeKey, signature, baseline, setDirty])
}
