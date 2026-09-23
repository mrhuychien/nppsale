"use client"

import { useEffect, useState } from "react"

/** Khổ máy tính — cùng mốc `lg` (1024px) của Tailwind mà các màn danh sách dùng để tách bố cục. */
export const DESKTOP_QUERY = "(min-width: 1024px)"

export function useIsDesktop(): boolean {
  const [la, setLa] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const doi = () => setLa(mq.matches)
    doi()
    mq.addEventListener("change", doi)
    return () => mq.removeEventListener("change", doi)
  }, [])
  return la
}
