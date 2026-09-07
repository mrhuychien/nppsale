import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { classifyAuthFailure, isSupabaseAuthCookie } from "../src/lib/supabase/auth-failure"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Quét theo dòng — xem ghi chú ở tests/mobile-actions-lines.test.ts. */
const strip = (s: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of s.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}

describe("Phân loại lỗi kiểm phiên", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI ĐO ĐƯỢC TRÊN PRODUCTION. Vercel runtime errors, route
   * /middleware, 2 lần / 1 người:
   *   AuthApiError: Invalid Refresh Token: Refresh Token Not Found
   *   { __isAuthError: true, status: 400, code: 'refresh_token_not_found' }
   *
   * Trước đây mọi lỗi đều bị coi như "mạng chập chờn", nên middleware TIN
   * cookie `sb-*-auth-token` và cho qua — người dùng vào trang cần đăng
   * nhập mà không có phiên.
   */
  it("refresh token không còn là DỨT KHOÁT, không phải trục trặc mạng", () => {
    const real = Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), {
      __isAuthError: true,
      status: 400,
      code: "refresh_token_not_found",
    })
    expect(classifyAuthFailure(real)).toBe("definitive")
  })

  it("các mã 'phiên đã mất' khác cũng dứt khoát", () => {
    for (const code of [
      "refresh_token_already_used",
      "session_not_found",
      "session_expired",
      "user_not_found",
      "bad_jwt",
    ]) {
      expect(classifyAuthFailure({ __isAuthError: true, status: 400, code }), code).toBe(
        "definitive"
      )
    }
  })

  it("401/403 từ Supabase Auth là dứt khoát", () => {
    expect(classifyAuthFailure({ __isAuthError: true, status: 401 })).toBe("definitive")
    expect(classifyAuthFailure({ __isAuthError: true, status: 403 })).toBe("definitive")
  })

  /**
   * ⚠ Vế NGƯỢC LẠI cũng phải giữ. Timeout 8s của chính middleware ném
   * AbortError; coi nó là dứt khoát là đăng xuất oan một người đang bán
   * hàng chỉ vì sóng yếu.
   */
  it("timeout / mạng hỏng chỉ là TẠM THỜI", () => {
    expect(classifyAuthFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      "transient"
    )
    expect(classifyAuthFailure(new TypeError("fetch failed"))).toBe("transient")
    expect(classifyAuthFailure({ __isAuthError: true, status: 500 })).toBe("transient")
    expect(classifyAuthFailure({ __isAuthError: true, status: 503 })).toBe("transient")
  })

  /** Không chắc thì GIỮ phiên — mặc định phải nghiêng về phía an toàn. */
  it("thứ lạ / rỗng thì coi là tạm thời", () => {
    expect(classifyAuthFailure(null)).toBe("transient")
    expect(classifyAuthFailure(undefined)).toBe("transient")
    expect(classifyAuthFailure("hỏng")).toBe("transient")
    expect(classifyAuthFailure({})).toBe("transient")
  })

  /**
   * ⚠ `status` chỉ đáng tin khi lỗi ĐÚNG LÀ của Supabase Auth. Một object
   * bất kỳ mang `status: 401` (ví dụ lỗi fetch tới dịch vụ khác lọt vào)
   * không đủ để đăng xuất người dùng.
   */
  it("status 401 mà không phải lỗi Supabase Auth thì không tính", () => {
    expect(classifyAuthFailure({ status: 401 })).toBe("transient")
    expect(classifyAuthFailure({ __isAuthError: "yes", status: 401 })).toBe("transient")
  })
})

describe("Nhận diện cookie phiên", () => {
  it("bắt đúng cookie sb-*-auth-token, kể cả bản bị chẻ nhiều mảnh", () => {
    expect(isSupabaseAuthCookie("sb-abcdef-auth-token")).toBe(true)
    // Cookie lớn bị Supabase chẻ thành .0 / .1 — mẫu cũ dùng endsWith nên
    // bỏ sót đúng những phiên NẶNG nhất, và dọn cookie sót là dọn hụt.
    expect(isSupabaseAuthCookie("sb-abcdef-auth-token.0")).toBe(true)
    expect(isSupabaseAuthCookie("sb-abcdef-auth-token.1")).toBe(true)
  })

  it("không đụng cookie khác", () => {
    expect(isSupabaseAuthCookie("sb-abcdef-auth-token-code-verifier")).toBe(true)
    expect(isSupabaseAuthCookie("session")).toBe(false)
    expect(isSupabaseAuthCookie("sb-provider-token")).toBe(false)
    expect(isSupabaseAuthCookie("theme")).toBe(false)
  })
})

describe("Middleware dùng đúng phân loại đó", () => {
  const M = strip(read("src/lib/supabase/middleware.ts"))

  it("chỉ tin cookie khi lỗi là TẠM THỜI", () => {
    expect(M).toContain('authFailure === "transient" && hasAuthCookie')
    // Không còn cờ gộp chung "hỏng là hỏng" nữa.
    expect(M).not.toContain("authCheckFailed")
  })

  /** Không xoá thì lần vào sau vẫn rơi đúng vào nhánh cũ. */
  it("phiên mất dứt khoát thì XOÁ cookie chết khi đẩy về /login", () => {
    expect(M).toContain('authFailure === "definitive"')
    expect(M).toContain("redirect.cookies.delete(c.name)")
  })

  /** supabase-js có lúc ném, có lúc trả `error` — phải bắt cả hai. */
  it("bắt cả lỗi ném ra lẫn lỗi trả về trong kết quả", () => {
    expect(M).toContain("catch (err)")
    expect(M).toContain("if (error) authFailure = classifyAuthFailure(error)")
  })

  /** Phân loại nằm ở một chỗ, không route nào tự đoán lại. */
  it("không tự phân loại lại trong middleware", () => {
    expect(M).toContain('from "./auth-failure"')
    expect(M).not.toContain("refresh_token_not_found")
  })
})
