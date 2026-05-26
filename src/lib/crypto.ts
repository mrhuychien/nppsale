import crypto from "node:crypto"

/**
 * AES-256-GCM encrypt/decrypt cho secret at rest (vd MISA credentials).
 * SERVER-SIDE ONLY.
 *
 * Key lấy từ env EINVOICE_ENC_KEY (khuyến nghị: 32 byte ngẫu nhiên,
 * base64 hoặc hex). Nếu chưa set, fallback derive từ
 * SUPABASE_SERVICE_ROLE_KEY (kém lý tưởng — rotate key sẽ mất khả năng
 * giải mã — nhưng tránh blocker khi chưa cấu hình). Luôn cảnh báo set
 * EINVOICE_ENC_KEY cho production.
 *
 * Format ciphertext: base64( iv(12) || authTag(16) || ciphertext ).
 */

function getKey(): Buffer {
  const raw = process.env.EINVOICE_ENC_KEY?.trim()
  if (raw) {
    // Cho phép hex (64) hoặc base64; fallback: hash về 32 byte.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex")
    const b64 = Buffer.from(raw, "base64")
    if (b64.length === 32) return b64
    return crypto.createHash("sha256").update(raw).digest()
  }
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!fallback) {
    throw new Error(
      "Thiếu EINVOICE_ENC_KEY để mã hoá credentials hoá đơn điện tử. Đặt EINVOICE_ENC_KEY (32 byte)."
    )
  }
  return crypto.createHash("sha256").update(`einvoice:${fallback}`).digest()
}

export function encryptSecret(plain: string): string {
  if (!plain) return ""
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return ""
  const key = getKey()
  const buf = Buffer.from(payload, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}
