"use client"

import { useEffect, useRef, useState } from "react"

interface ListViewPrefs<C extends string, F extends string> {
  columns: C[]
  filters: F[]
}

interface UseListViewPrefsResult<C extends string, F extends string> {
  columns: C[]
  filters: F[]
  setColumns: (next: C[]) => void
  setFilters: (next: F[]) => void
  resetColumns: () => void
  resetFilters: () => void
}

/**
 * Lưu prefs hiển thị list view (cột bật + filter bật) vào localStorage
 * theo key `list-view:<viewKey>`. Mỗi browser / mỗi user có bộ riêng.
 *
 * - defaultColumns / defaultFilters: dùng làm fallback khi chưa lưu
 *   hoặc khi reset.
 * - Khi schema thay đổi (thêm/bớt key), giá trị không hợp lệ tự bị
 *   loại bỏ; key mới được kế thừa từ default.
 */
export function useListViewPrefs<C extends string, F extends string>(
  viewKey: string,
  defaultColumns: readonly C[],
  defaultFilters: readonly F[]
): UseListViewPrefsResult<C, F> {
  const storageKey = `list-view:${viewKey}`
  const defaultColsRef = useRef(defaultColumns)
  const defaultFiltersRef = useRef(defaultFilters)

  const [prefs, setPrefs] = useState<ListViewPrefs<C, F>>(() => ({
    columns: [...defaultColumns],
    filters: [...defaultFilters],
  }))

  // Load on mount (client only — avoid SSR/localStorage mismatch)
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<ListViewPrefs<C, F>>
      const validCols = new Set<string>(defaultColsRef.current)
      const validFilters = new Set<string>(defaultFiltersRef.current)
      const cols = Array.isArray(parsed.columns)
        ? (parsed.columns.filter((c): c is C => typeof c === "string" && validCols.has(c)) as C[])
        : null
      const filters = Array.isArray(parsed.filters)
        ? (parsed.filters.filter((f): f is F => typeof f === "string" && validFilters.has(f)) as F[])
        : null
      if (cols || filters) {
        setPrefs((prev) => ({
          columns: cols ?? prev.columns,
          filters: filters ?? prev.filters,
        }))
      }
    } catch {
      // Corrupt JSON — ignore, dùng default.
    }
  }, [storageKey])

  const persist = (next: ListViewPrefs<C, F>) => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Quota / private-mode — bỏ qua.
    }
  }

  return {
    columns: prefs.columns,
    filters: prefs.filters,
    setColumns: (next) => {
      setPrefs((prev) => {
        const updated = { ...prev, columns: next }
        persist(updated)
        return updated
      })
    },
    setFilters: (next) => {
      setPrefs((prev) => {
        const updated = { ...prev, filters: next }
        persist(updated)
        return updated
      })
    },
    resetColumns: () => {
      setPrefs((prev) => {
        const updated = { ...prev, columns: [...defaultColsRef.current] }
        persist(updated)
        return updated
      })
    },
    resetFilters: () => {
      setPrefs((prev) => {
        const updated = { ...prev, filters: [...defaultFiltersRef.current] }
        persist(updated)
        return updated
      })
    },
  }
}
