/**
 * Chủ nhà 01/10/2026: "Sửa mẫu in hoá đơn. Thời gian trên phiếu là ngày giờ tạo chứ ko phải ngày giờ in".
 * Mẫu in đã lấy giờ TẠO (`docStampAt(created_at)`); giờ IN là đầu trang / chân trang của TRÌNH DUYỆT, in vào
 * lề `@page`. Lề = 0 thì trình duyệt không còn chỗ in; lề thật là đệm 8mm của <body>, lặp trên mỗi tờ.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { docStampAt, stampVN } from "@/lib/printing/doc-stamp"

const CSS = readFileSync("src/app/globals.css", "utf8")

describe("tờ in không mang giờ bấm in", () => {
  it("lề @page = 0 (không chỗ cho đầu trang / chân trang của trình duyệt), đệm 8mm lặp mỗi tờ", () => {
    expect(CSS.match(/@page\s*\{[^}]*\}/g)).toEqual(["@page { margin: 0; }"])
    expect(CSS).toContain("body { padding: 8mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }")
  })
  it("mốc giãn chữ theo khổ dời theo vùng in mới (A5 148 < 204 ≤ A4 210 < 293 ≤ A3 297)", () => {
    expect(CSS).toContain("@media print and (min-width: 204mm) {")
    expect(CSS).toContain("@media print and (min-width: 293mm) {")
    expect(CSS).not.toMatch(/min-width: (185|275)mm/)
  })
  it("giờ trên phiếu là giờ sửa cuối / giờ tạo hoá đơn (giờ VN), không phải lúc in", () => {
    const { at } = docStampAt("2026-09-30T01:05:00Z", "2026-09-30")
    expect(stampVN(at)).toBe("30/09/2026 08:05")
    const HD = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
    expect(HD).toContain("issuedAt={docStampAt(gioSuaCuoi(gioSua, inv.created_at), inv.invoice_date).at}")
  })
})
