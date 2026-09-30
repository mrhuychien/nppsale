/** Chủ nhà 30/09/2026: "chỉ cần thêm link mở tab chrome hoặc safari độc lập là được vì npp dùng iphone". */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { laThietBiApple, linkTrinhDuyetRieng } from "@/lib/users/mo-trinh-duyet"

describe("mở link QR bằng Safari / Chrome riêng trên iPhone", () => {
  it("dựng đúng đường dẫn mở ứng dụng", () => {
    expect(linkTrinhDuyetRieng("https://npp.sale/qr-login?t=abc")).toEqual({
      safari: "x-safari-https://npp.sale/qr-login?t=abc",
      chrome: "googlechromes://npp.sale/qr-login?t=abc",
    })
    expect(linkTrinhDuyetRieng("http://localhost:3000/qr-login?t=x")?.chrome).toBe("googlechrome://localhost:3000/qr-login?t=x")
    expect(linkTrinhDuyetRieng("khong-phai-link")).toBeNull()
  })
  it("nhận iPhone / iPad (kể cả iPad báo là Mac)", () => {
    expect(laThietBiApple("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true)
    expect(laThietBiApple("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true)
    expect(laThietBiApple("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false)
    expect(laThietBiApple("Mozilla/5.0 (Linux; Android 14)")).toBe(false)
  })
  it("hộp QR dùng hai link đó khi là iPhone", () => {
    const s = readFileSync("src/components/users/qr-login-dialog.tsx", "utf8")
    expect(s).toContain("{apple && linkTrinhDuyetRieng(state.loginUrl) && (")
    expect(s).toContain("linkTrinhDuyetRieng(state.loginUrl)!.safari")
    expect(s).toContain("linkTrinhDuyetRieng(state.loginUrl)!.chrome")
  })
})
