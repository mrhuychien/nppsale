import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { COOKIE_KHO, chuoiCookieKho, dichPosMayChu, docCookieKho, khoTheoBeNgang } from "@/lib/nav/kho-man"
import { POS_MIN_WIDTH, posTargetFor } from "@/lib/nav/pos-preview"

/**
 * CHỦ NHÀ 03/11/2026: "phần load pos trên máy có cách gì xử lý nhận diện từ đầu là đang trên máy tính để load pos luôn ko".
 * Máy chủ đọc cookie khổ màn và chuyển thẳng lối POS cũ sang POS trước khi dựng màn cũ (đo: 3,0–3,5 s → như mở thẳng POS).
 */
/** `Accept` của một lượt mở trang thật (Chromium). */
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
const moTrang = (path: string, kho: string | null, them: Record<string, string | null> = {}) => {
  const u = new URL(path, "http://x")
  return dichPosMayChu({ method: "GET", pathname: u.pathname, search: u.search, kho, dest: "document", accept: HTML, ...them })
}

describe("khổ màn → cookie", () => {
  it("cùng ngưỡng 1024 px với manDuRong / lg: của Tailwind", () => {
    expect(khoTheoBeNgang(POS_MIN_WIDTH)).toBe("rong")
    expect(khoTheoBeNgang(POS_MIN_WIDTH - 1)).toBe("hep")
    expect(khoTheoBeNgang(390)).toBe("hep")
    expect(khoTheoBeNgang(1920)).toBe("rong")
  })

  it("chuỗi cookie: cả app, một năm, Lax; https thì Secure; đọc lại được giữa các cookie khác", () => {
    expect(chuoiCookieKho("rong", false)).toBe(`${COOKIE_KHO}=rong; Path=/; Max-Age=31536000; SameSite=Lax`)
    expect(chuoiCookieKho("hep", true)).toContain("; Secure")
    expect(docCookieKho("a=1; npp_kho=rong; sb-x-auth-token=y")).toBe("rong")
    expect(docCookieKho("npp_kho=hep")).toBe("hep")
    expect(docCookieKho("npp_kho=la")).toBeNull()
    expect(docCookieKho("x_npp_kho=rong")).toBeNull()
    expect(docCookieKho("")).toBeNull()
  })
})

describe("middleware: máy tính mở lối POS cũ → chuyển thẳng đích POS", () => {
  it("mọi lối vào POS cũ (đúng bộ posTargetFor) đi thẳng sang đích POS", () => {
    for (const [cu, moi] of [
      ["/sales-invoices/new?order=o-1", "/pos/hoa-don/moi?order=o-1"],
      ["/sell", "/pos/don-hang/moi"],
      ["/sell?customerId=k-1", "/pos/don-hang/moi?customerId=k-1"],
      ["/sell/edit/o-2", "/pos/don-hang/o-2/sua"],
      ["/sales-invoices/i-1/edit", "/pos/hoa-don/i-1/sua"],
      ["/returns/new?invoiceId=i-1", "/pos/tra-hang/moi?invoice=i-1"],
      ["/purchasing/receipts/new", "/pos/nhap-hang/moi"],
      ["/purchase-returns/r-1/edit", "/pos/tra-ncc/r-1/sua"],
    ]) {
      expect(moTrang(cu, "rong"), cu).toBe(moi)
      expect(moi).toBe(posTargetFor(cu))
    }
  })

  it("điện thoại / cửa sổ hẹp / máy chưa có cookie → để yên (màn cũ tự lo, không đoán 'rộng' ở máy chủ)", () => {
    expect(moTrang("/sales-invoices/new?order=o-1", "hep")).toBeNull()
    expect(moTrang("/sales-invoices/new?order=o-1", null)).toBeNull()
    expect(moTrang("/sales-invoices/new?order=o-1", "rongg")).toBeNull()
  })

  it("không phải mở trang → để yên: câu RSC / tải trước của Next, tải trước của trình duyệt, khung con, fetch, POST", () => {
    const duong = "/sales-invoices/new?order=o-1"
    expect(moTrang(duong, "rong", { rsc: "1" })).toBeNull()
    expect(moTrang(duong, "rong", { prefetch: "1" })).toBeNull()
    expect(moTrang(duong, "rong", { purpose: "prefetch" })).toBeNull()
    expect(moTrang(duong, "rong", { purpose: "prefetch;prerender" })).toBeNull()
    expect(moTrang(duong, "rong", { dest: "iframe" })).toBeNull()
    expect(moTrang(duong, "rong", { dest: "empty" })).toBeNull()
    // Next GỠ header RSC trước middleware — câu RSC chỉ còn nhận ra qua Accept (fetch: */*) và Sec-Fetch-Dest (empty).
    expect(moTrang(duong, "rong", { accept: "*/*", dest: "empty" })).toBeNull()
    expect(moTrang(duong, "rong", { accept: "*/*", dest: null })).toBeNull()
    expect(moTrang(duong, "rong", { accept: null, dest: null })).toBeNull()
    const u = new URL(duong, "http://x")
    expect(dichPosMayChu({ method: "POST", pathname: u.pathname, search: u.search, kho: "rong", dest: "document", accept: HTML })).toBeNull()
    // Không có Sec-Fetch-Dest (trình duyệt cũ) mà xin text/html vẫn là mở trang.
    expect(dichPosMayChu({ method: "GET", pathname: u.pathname, search: u.search, kho: "rong", accept: HTML })).toBe("/pos/hoa-don/moi?order=o-1")
  })

  it("đường không phải lối POS → để yên (kể cả /sell?mode=return, /sales-invoices/new không kèm đơn, chính /pos)", () => {
    for (const d of ["/orders", "/sell?mode=return", "/sales-invoices/new", "/pos/hoa-don/moi?order=o-1", "/sell/cart"]) {
      expect(moTrang(d, "rong"), d).toBeNull()
    }
  })

  it("middleware gọi dichPosMayChu TRƯỚC updateSession, trả 307; khung gốc gắn GhiKhoMan", () => {
    const mw = readFileSync(resolve(__dirname, "..", "src/middleware.ts"), "utf-8")
    const i = mw.indexOf("dichPosMayChu({")
    const j = mw.indexOf("return await updateSession(request)")
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(mw).toContain("NextResponse.redirect(new URL(dichPos, request.url), 307)")
    expect(readFileSync(resolve(__dirname, "..", "src/app/layout.tsx"), "utf-8")).toContain("<GhiKhoMan />")
  })
})
