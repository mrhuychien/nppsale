"use client"

/**
 * Kho key-value tối giản trên IndexedDB (không thêm dependency).
 * Dùng cho dữ liệu offline: hàng chờ đơn (outbox) + cache dữ liệu tham
 * chiếu (khách hàng/sản phẩm). IndexedDB bền qua reload/đóng tab/khởi
 * động lại máy — đảm bảo "không mất đơn".
 *
 * Fallback: nếu môi trường không có IndexedDB (SSR, trình duyệt cũ,
 * chế độ ẩn danh chặn) → mọi thao tác no-op an toàn, không ném lỗi.
 */

const DB_NAME = "nppsale-offline"
const DB_VERSION = 1
const STORE = "kv"

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        console.warn("[idb] open failed:", req.error?.message)
        resolve(null)
      }
    } catch (err) {
      console.warn("[idb] open threw:", err)
      resolve(null)
    }
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const t = db.transaction(STORE, mode)
          const req = run(t.objectStore(STORE))
          req.onsuccess = () => resolve(req.result as T)
          req.onerror = () => {
            console.warn("[idb] tx error:", req.error?.message)
            resolve(null)
          }
        } catch (err) {
          console.warn("[idb] tx threw:", err)
          resolve(null)
        }
      })
  )
}

export function idbGet<T>(key: string): Promise<T | null> {
  return tx<T>("readonly", (s) => s.get(key))
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  await tx("readwrite", (s) => s.put(value as unknown as object, key))
}

export async function idbDel(key: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(key))
}
