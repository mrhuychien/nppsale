"use client"

/**
 * THIẾT LẬP HIỂN THỊ CỦA `/pos` — spec §9, drawer thiết lập.
 *
 * ⚠ LƯU THEO NGƯỜI DÙNG, DÙNG CƠ CHẾ SẴN CÓ. Spec chốt "không tạo bảng
 * mới". `localStorage` là đúng chỗ phần còn lại của app đang giữ lựa
 * chọn cá nhân.
 *
 * ⚠ ĐƠN VỊ GIẢM GIÁ Ở ĐÂY CHỈ LÀ GIÁ TRỊ KHỞI TẠO CHO DÒNG MỚI. Spec
 * nói rõ: "Mỗi dòng vẫn tự đổi ₫/% riêng". Đọc nhầm thành "ép mọi dòng
 * về một đơn vị" là mỗi lần đổi thiết lập lại âm thầm đổi khoản giảm
 * của những dòng đã gõ xong.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react"
import type { DiscountUnit } from "@/lib/pos/discount"

const KEY = "npp.pos.settings.v1"

export interface PosSettings {
  /* --- HIỂN THỊ TRONG BẢNG --- */
  colIndex: boolean
  colSku: boolean
  colStock: boolean
  colLot: boolean
  colLineDiscount: boolean
  colVat: boolean
  colImage: boolean
  /** Đơn vị giảm giá MẶC ĐỊNH cho dòng mới — xem chú thích đầu tệp. */
  defaultDiscountUnit: DiscountUnit

  /* --- HỖ TRỢ NHẬP LIỆU --- */
  showLastPrice: boolean
  suggestCash: boolean
  mergeDuplicateLines: boolean
  /** ⚠ Bán sỉ thì ghi nợ là mặc định — spec §6, không copy POS bán lẻ. */
  defaultCreditAll: boolean
  sortBy: "moi-nhat" | "ten" | "ma"
}

/** Mặc định đúng bảng trong spec §9 — `colLot`, `colVat`, `colImage` TẮT. */
export const POS_SETTINGS_DEFAULT: PosSettings = {
  colIndex: true,
  colSku: true,
  colStock: true,
  colLot: false,
  colLineDiscount: true,
  colVat: false,
  colImage: false,
  defaultDiscountUnit: "vnd",
  showLastPrice: true,
  suggestCash: true,
  mergeDuplicateLines: true,
  defaultCreditAll: true,
  sortBy: "moi-nhat",
}

interface Value {
  settings: PosSettings
  ready: boolean
  patch: (p: Partial<PosSettings>) => void
  reset: () => void
}

const Ctx = createContext<Value | null>(null)

export function PosSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PosSettings>(POS_SETTINGS_DEFAULT)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        /**
         * ⚠ TRỘN LÊN MẶC ĐỊNH, KHÔNG THAY THẾ. Bản lưu cũ thiếu khoá
         * mới thì khoá ấy phải rơi về mặc định; thay thẳng là một khoá
         * `undefined` chạy thẳng vào `checked` của toggle.
         */
        setSettings({ ...POS_SETTINGS_DEFAULT, ...(JSON.parse(raw) as Partial<PosSettings>) })
      }
    } catch {
      /* bản lưu hỏng — dùng mặc định */
    }
    setReady(true)
  }, [])

  const daNap = useRef(false)
  useEffect(() => {
    if (!ready) return
    if (!daNap.current) { daNap.current = true; return }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* không lưu được thì thôi */
    }
  }, [settings, ready])

  const patch = useCallback<Value["patch"]>((p) => setSettings((cu) => ({ ...cu, ...p })), [])
  const reset = useCallback(() => setSettings(POS_SETTINGS_DEFAULT), [])

  const value = useMemo<Value>(() => ({ settings, ready, patch, reset }), [settings, ready, patch, reset])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosSettings(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePosSettings phải nằm trong <PosSettingsProvider>")
  return v
}
