"use client"

import { useCallback, useRef } from "react"

/**
 * Khoá chống gửi trùng cho MỘT lần lập chứng từ (mig 215, `cash_receipts.client_key`).
 *
 * Chủ nhà 28/09/2026 "ok" chống bấm Lưu hai lần: bấm lại / mạng chập chờn gửi lại thì
 * máy chủ thấy cùng khoá và trả lại phiếu đã lập. Lập xong thật thì `doi()` để lần sau
 * là phiếu mới.
 */
export function useKhoaGui() {
  const ref = useRef<string>("")
  if (!ref.current) ref.current = taoKhoa()
  const doi = useCallback(() => { ref.current = taoKhoa() }, [])
  return { lay: () => ref.current, doi }
}

function taoKhoa(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
