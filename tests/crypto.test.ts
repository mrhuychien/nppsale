import { describe, it, expect, beforeEach, afterEach } from "vitest"
import crypto from "node:crypto"

/**
 * Mã hoá thông tin đăng nhập MISA khi lưu vào database (AES-256-GCM).
 *
 * Vì sao đáng test:
 *   • Sai ở đây là mật khẩu MISA của nhà phân phối nằm dạng đọc được trong
 *     database, hoặc ngược lại — không giải mã được nữa và mất khả năng
 *     phát hành hoá đơn.
 *   • GCM có mã xác thực (auth tag). Nếu ai đó "tối ưu" bỏ tag đi thì kẻ
 *     tấn công sửa được ciphertext mà không bị phát hiện. Test dưới đây
 *     khoá tính chất đó lại.
 *
 * Module đọc khoá từ biến môi trường lúc GỌI (không phải lúc import) nên
 * đổi env giữa các test là được.
 */

const OLD_ENV = { ...process.env }

// 32 byte hex — dạng khoá khuyến nghị.
const KEY_HEX = "a".repeat(64)

async function loadCrypto() {
  // Import lại mỗi lần để không dính state cũ.
  return await import("@/lib/crypto")
}

beforeEach(() => {
  process.env = { ...OLD_ENV }
  delete process.env.EINVOICE_ENC_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})
afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe("encryptSecret / decryptSecret — vòng khứ hồi", () => {
  it("mã hoá rồi giải mã ra đúng chuỗi ban đầu", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    const plain = "matkhau-misa-123"
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it("giữ nguyên tiếng Việt có dấu và ký tự đặc biệt", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    const plain = "Mật khẩu #1 — ước@2026 “nháy” 100%"
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it("bản mã KHÔNG chứa bản rõ", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret } = await loadCrypto()
    const plain = "matkhau-sieu-bi-mat"
    const enc = encryptSecret(plain)
    expect(enc).not.toContain(plain)
    // Kể cả sau khi giải base64 cũng không được lộ.
    expect(Buffer.from(enc, "base64").toString("utf8")).not.toContain(plain)
  })

  it("mã hoá CÙNG một chuỗi hai lần cho ra hai bản mã khác nhau", async () => {
    // IV phải ngẫu nhiên mỗi lần. Nếu cố định, hai bản ghi cùng mật khẩu sẽ
    // có ciphertext giống hệt — nhìn database là biết ai trùng mật khẩu ai.
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    const a = encryptSecret("giong-nhau")
    const b = encryptSecret("giong-nhau")
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe("giong-nhau")
    expect(decryptSecret(b)).toBe("giong-nhau")
  })

  it("chuỗi rỗng / null / undefined trả về chuỗi rỗng, không ném", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(encryptSecret("")).toBe("")
    expect(decryptSecret("")).toBe("")
    expect(decryptSecret(null)).toBe("")
    expect(decryptSecret(undefined)).toBe("")
  })
})

describe("chống sửa đổi — auth tag của GCM", () => {
  it("sửa một byte trong bản mã thì giải mã PHẢI ném lỗi", async () => {
    // Đây là điểm khác biệt giữa GCM và các chế độ không xác thực. Nếu test
    // này đỏ, nghĩa là ai đó đã bỏ setAuthTag và dữ liệu có thể bị sửa lén.
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    const buf = Buffer.from(encryptSecret("matkhau"), "base64")
    buf[buf.length - 1] ^= 0xff // lật byte cuối của phần ciphertext
    expect(() => decryptSecret(buf.toString("base64"))).toThrow()
  })

  it("sửa auth tag thì giải mã PHẢI ném lỗi", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    const buf = Buffer.from(encryptSecret("matkhau"), "base64")
    buf[15] ^= 0xff // byte nằm trong vùng tag (12..27)
    expect(() => decryptSecret(buf.toString("base64"))).toThrow()
  })

  it("dữ liệu rác không phải bản mã thì ném, không trả chuỗi rác", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { decryptSecret } = await loadCrypto()
    expect(() => decryptSecret("day-khong-phai-base64-hop-le!!!")).toThrow()
  })
})

describe("chọn khoá", () => {
  it("nhận khoá dạng hex 64 ký tự", async () => {
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(decryptSecret(encryptSecret("x"))).toBe("x")
  })

  it("nhận khoá dạng base64 32 byte", async () => {
    process.env.EINVOICE_ENC_KEY = crypto.randomBytes(32).toString("base64")
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(decryptSecret(encryptSecret("x"))).toBe("x")
  })

  it("chuỗi bất kỳ cũng dùng được (băm về 32 byte)", async () => {
    process.env.EINVOICE_ENC_KEY = "mot-cau-mat-khau-tuy-y"
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(decryptSecret(encryptSecret("x"))).toBe("x")
  })

  it("ĐỔI KHOÁ thì KHÔNG giải mã được dữ liệu cũ", async () => {
    // Ghi lại hành vi này thành test vì nó là bẫy vận hành thật: xoay khoá
    // EINVOICE_ENC_KEY là mất toàn bộ credentials MISA đã lưu.
    // Đã ghi trong BAN_GIAO.md, mục biến môi trường.
    process.env.EINVOICE_ENC_KEY = KEY_HEX
    const { encryptSecret } = await loadCrypto()
    const enc = encryptSecret("matkhau")

    process.env.EINVOICE_ENC_KEY = "b".repeat(64)
    const { decryptSecret } = await loadCrypto()
    expect(() => decryptSecret(enc)).toThrow()
  })

  it("chưa đặt EINVOICE_ENC_KEY thì suy biến sang service role key", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-gia-lap"
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(decryptSecret(encryptSecret("x"))).toBe("x")
  })

  it("không có khoá nào thì ném lỗi RÕ RÀNG, không mã hoá bằng khoá rỗng", async () => {
    const { encryptSecret } = await loadCrypto()
    expect(() => encryptSecret("x")).toThrow(/EINVOICE_ENC_KEY/)
  })

  it("thiếu khoá nhưng chuỗi rỗng thì vẫn không ném (không cần khoá)", async () => {
    const { encryptSecret, decryptSecret } = await loadCrypto()
    expect(encryptSecret("")).toBe("")
    expect(decryptSecret("")).toBe("")
  })
})
