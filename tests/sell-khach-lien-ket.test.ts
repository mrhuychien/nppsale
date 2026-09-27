/**
 * Chủ nhà 27/09/2026: bấm "Tạo đơn" từ khách vừa tạo / khách Tạm ngưng báo "không tìm thấy".
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { isCachedCatalogFresh, lamCuDanhMucBan } from "@/lib/sell/ref-store"

describe("danh mục /sell trên máy cũ đi khi khách được tạo / sửa", () => {
  const kho = new Map<string, string>()
  beforeEach(() => {
    kho.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => kho.get(k) ?? null,
      setItem: (k: string, v: string) => void kho.set(k, v),
    }
  })
  it("bản IndexedDB lưu TRƯỚC lúc tạo khách thì không còn 'đủ mới'", () => {
    const luu = 1_000_000
    expect(isCachedCatalogFresh(luu, luu + 60_000)).toBe(true)
    lamCuDanhMucBan(luu + 30_000)
    expect(isCachedCatalogFresh(luu, luu + 60_000)).toBe(false)
    // Bản tải lại SAU đó thì dùng được bình thường.
    expect(isCachedCatalogFresh(luu + 40_000, luu + 60_000)).toBe(true)
  })
})

describe("đường dẫn /sell?customerId= hỏi riêng máy chủ khi khách vắng trong danh mục", () => {
  const s = readFileSync("src/components/sell/customer-deeplink.tsx", "utf8")
  it("đọc riêng khách, thêm vào danh mục, nói rõ khách Tạm ngưng / Khoá", () => {
    expect(s).toMatch(/loadOneSellCustomer\(createClient\(\), wanted\)/)
    expect(s).toMatch(/addCustomer\(c\)/)
    expect(s).toMatch(/c\.status !== "active"/)
    expect(s).toContain("CUSTOMER_STATUS_MAP")
  })
  it("tạo / sửa khách xong thì đánh dấu danh mục bán hàng đã cũ", () => {
    expect(readFileSync("src/components/customers/customer-form.tsx", "utf8")).toMatch(/lamCuDanhMucBan\(\)/)
  })
})
