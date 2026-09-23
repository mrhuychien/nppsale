import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { useOnlineStatus } from "../src/hooks/use-online-status"

/**
 * ⚠ LỖI THẬT (23/09/2026): Node ≥ 21 có `navigator` nhưng `onLine` là
 *   `undefined` → hook trả "mất mạng" lúc vẽ ở máy chủ, lệch với trình
 *   duyệt → lỗi hydrate trên mọi trang dashboard. Chốt vẽ ở máy chủ với
 *   đúng hoàn cảnh ấy.
 */
describe("useOnlineStatus vẽ ở máy chủ", () => {
  it("máy chủ có `navigator` mà `onLine` undefined → vẫn 'có mạng'", () => {
    const g = globalThis as { navigator?: unknown }
    const cu = Object.getOwnPropertyDescriptor(globalThis, "navigator")
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Node.js" }, configurable: true })
    try {
      const Thu = () => createElement("span", null, useOnlineStatus() ? "online" : "offline")
      expect(renderToStaticMarkup(createElement(Thu))).toBe("<span>online</span>")
    } finally {
      if (cu) Object.defineProperty(globalThis, "navigator", cu)
      else delete g.navigator
    }
  })
})
