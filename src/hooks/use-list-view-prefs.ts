"use client"

import { useCallback, useEffect, useRef, useState } from "react"

interface ListViewPrefs<C extends string, F extends string> {
  columns: C[]
  filters: F[]
}

/**
 * Hình dạng thật nằm trong localStorage.
 *
 * `knownColumns` / `knownFilters` = danh mục ĐÃ BIẾT lúc lưu. Không có nó
 * thì không tài nào phân biệt "cột mới thêm sau bản cập nhật" với "cột
 * người dùng cố ý tắt" — hai thứ trông y hệt nhau: đều là key có trong
 * default mà không có trong danh sách đã lưu.
 */
interface StoredPrefs<C extends string, F extends string> extends ListViewPrefs<C, F> {
  knownColumns?: C[]
  knownFilters?: F[]
}

/**
 * Nhận key MỚI xuất hiện trong danh mục kể từ lần lưu gần nhất.
 *
 * Trả về danh sách đã sắp theo thứ tự danh mục. Key nào người dùng đã tắt
 * (có trong `known` mà không có trong `saved`) thì giữ nguyên đã tắt.
 */
export function adoptNewKeys<K extends string>(
  saved: K[],
  known: K[] | undefined,
  catalog: readonly K[]
): K[] {
  // Không có `known` (dữ liệu lưu từ trước bản này): coi những gì đã lưu
  // là toàn bộ hiểu biết cũ. Hệ quả CÓ CHỦ Ý: cột người dùng từng tắt sẽ
  // bật lại ĐÚNG MỘT LẦN. Đổi lại, mọi cột mới thêm về sau đều hiện ra —
  // còn hơn để một tính năng mới vô hình vĩnh viễn với đúng những người
  // dùng nhiều nhất (họ là những người đã chỉnh cột).
  const knownSet = new Set<string>(known ?? saved)
  const fresh = catalog.filter((k) => !knownSet.has(k))
  if (fresh.length === 0) return saved
  const merged = new Set<string>([...saved, ...fresh])
  return catalog.filter((k) => merged.has(k))
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
 * - Khi schema thay đổi: key không còn hợp lệ bị loại bỏ, VÀ key mới
 *   thêm vào danh mục được bật lên (xem adoptNewKeys). Trước đây chú
 *   thích này hứa vế thứ hai nhưng mã không làm — hệ quả là thêm một cột
 *   mới thì đúng những người đã từng chỉnh cột lại không bao giờ thấy nó.
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

  // Khai báo TRƯỚC effect nạp, vì effect gọi nó và đưa nó vào deps —
  // `const` đứng sau sẽ vào vùng chết (TDZ) đúng lúc React đọc mảng
  // deps trong lúc render, và nổ ReferenceError.
  //
  // useCallback deps [storageKey]: hai ref bên trong vốn ổn định nên hàm
  // chỉ đổi khi đổi màn — nhờ vậy effect không chạy lại mỗi render.
  const persist = useCallback((next: ListViewPrefs<C, F>) => {
    if (typeof window === "undefined") return
    try {
      const stored: StoredPrefs<C, F> = {
        ...next,
        knownColumns: [...defaultColsRef.current],
        knownFilters: [...defaultFiltersRef.current],
      }
      window.localStorage.setItem(storageKey, JSON.stringify(stored))
    } catch {
      // Quota / private-mode — bỏ qua.
    }
  }, [storageKey])

  // Load on mount (client only — avoid SSR/localStorage mismatch)
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<StoredPrefs<C, F>>
      const validCols = new Set<string>(defaultColsRef.current)
      const validFilters = new Set<string>(defaultFiltersRef.current)
      const cols = Array.isArray(parsed.columns)
        ? adoptNewKeys(
            parsed.columns.filter((c): c is C => typeof c === "string" && validCols.has(c)) as C[],
            parsed.knownColumns,
            defaultColsRef.current
          )
        : null
      const filters = Array.isArray(parsed.filters)
        ? adoptNewKeys(
            parsed.filters.filter((f): f is F => typeof f === "string" && validFilters.has(f)) as F[],
            parsed.knownFilters,
            defaultFiltersRef.current
          )
        : null
      if (cols || filters) {
        const next = {
          columns: cols ?? [...defaultColsRef.current],
          filters: filters ?? [...defaultFiltersRef.current],
        }
        setPrefs(next)
        // Ghi lại NGAY để đóng dấu danh mục hiện tại vào `known`. Không
        // ghi thì lần sau vẫn coi là "chưa biết" và cột người dùng vừa
        // tắt sẽ bật lại lần nữa.
        persist(next)
      }
    } catch {
      // Corrupt JSON — ignore, dùng default.
    }
  }, [storageKey, persist])

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
