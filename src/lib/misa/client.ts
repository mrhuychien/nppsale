import type {
  InvoicePayload,
  MisaConfig,
  MisaPublishResponse,
  MisaTokenResponse,
} from "./types"

/**
 * Layer 1 — MISA meInvoice client.
 *
 * Trách nhiệm: nói chuyện với MISA API. KHÔNG biết schema npp.sale.
 * - getToken(): cache in-memory TTL 30 phút, refresh khi hết hạn.
 * - publishInvoice(): retry 1 lần khi token expired (401/403/"token").
 *
 * LƯU Ý: endpoint path MISA chưa public hoàn toàn — các path dưới đây
 * là giá trị mặc định hợp lý; verify bằng sandbox (doc Step 6) rồi
 * chỉnh TOKEN_PATH / PUBLISH_PATH cho khớp tài liệu MISA của bạn.
 */

const TOKEN_PATH = "/auth/token"
const PUBLISH_PATH = "/api/v1/invoices"
const TOKEN_TTL_MS = 30 * 60 * 1000

interface CachedToken {
  token: string
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

function cacheKey(cfg: MisaConfig): string {
  return `${cfg.apiBase}|${cfg.taxCode}|${cfg.username}`
}

function extractToken(data: MisaTokenResponse): string | null {
  // MISA trả token ở nhiều field tuỳ phiên bản — thử lần lượt.
  const d = data as Record<string, unknown>
  const candidates = [
    data.access_token,
    data.token,
    d["accessToken"],
    (d["Data"] as Record<string, unknown> | undefined)?.["access_token"],
    (d["data"] as Record<string, unknown> | undefined)?.["token"],
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c
  }
  return null
}

export async function getToken(cfg: MisaConfig, force = false): Promise<string> {
  const key = cacheKey(cfg)
  const now = Date.now()
  if (!force) {
    const cached = tokenCache.get(key)
    if (cached && cached.expiresAt > now) return cached.token
  }

  const res = await fetch(`${cfg.apiBase}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: cfg.companyId ?? undefined,
      taxCode: cfg.taxCode,
      userName: cfg.username,
      password: cfg.password,
    }),
  })

  const text = await res.text()
  let data: MisaTokenResponse = {}
  try {
    data = text ? (JSON.parse(text) as MisaTokenResponse) : {}
  } catch {
    data = { raw: text } as MisaTokenResponse
  }

  if (!res.ok) {
    throw new Error(`MISA token lỗi ${res.status}: ${text.slice(0, 300)}`)
  }
  const token = extractToken(data)
  if (!token) {
    throw new Error(
      `MISA token: không tìm thấy access_token trong response (verify schema). Raw: ${text.slice(0, 300)}`
    )
  }

  const ttl =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? Math.min(data.expires_in * 1000, TOKEN_TTL_MS)
      : TOKEN_TTL_MS
  tokenCache.set(key, { token, expiresAt: now + ttl - 60_000 })
  return token
}

function looksLikeAuthError(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true
  const lower = body.toLowerCase()
  return lower.includes("token") || lower.includes("expired") || lower.includes("unauthorized")
}

function extractPublishResult(data: unknown): { lookup: string | null; invNo: string | null } {
  // Verify thật (doc Step 6). Thử các field MISA hay dùng.
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const inner = (obj["Data"] ?? obj["data"] ?? obj) as Record<string, unknown>
  const pick = (...keys: string[]): string | null => {
    for (const src of [obj, inner]) {
      for (const k of keys) {
        const v = src?.[k]
        if (typeof v === "string" && v) return v
        if (typeof v === "number") return String(v)
      }
    }
    return null
  }
  return {
    lookup: pick("lookupCode", "LookupCode", "lookup_code", "Code", "code", "transactionID"),
    invNo: pick("invNo", "InvNo", "invoiceNumber", "InvoiceNumber", "invoice_no", "InvoiceNo"),
  }
}

export async function publishInvoice(
  cfg: MisaConfig,
  payload: InvoicePayload
): Promise<MisaPublishResponse> {
  const doCall = async (token: string) => {
    const res = await fetch(`${cfg.apiBase}${PUBLISH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    return { res, text }
  }

  let token = await getToken(cfg)
  let { res, text } = await doCall(token)

  // Retry 1 lần khi token có vẻ hết hạn.
  if (!res.ok && looksLikeAuthError(res.status, text)) {
    token = await getToken(cfg, true)
    ;({ res, text } = await doCall(token))
  }

  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    return {
      ok: false,
      raw: data,
      error: `MISA publish lỗi ${res.status}: ${text.slice(0, 500)}`,
      lookup_code: null,
      inv_no: null,
    }
  }

  const { lookup, invNo } = extractPublishResult(data)
  return { ok: true, raw: data, lookup_code: lookup, inv_no: invNo }
}
