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
 * Endpoint path đọc từ MisaConfig.tokenPath / publishPath — bắt buộc
 * nhập ở UI Cài đặt theo doc MISA của tenant (Connect API v3 vs Open
 * API v1 vs OEM dùng path khác nhau).
 */

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
  // MISA Integration API: { Success, Data: { access_token, ... }, ErrorCode, Errors }.
  // Thử các vị trí để hỗ trợ cả v3/Connect API.
  const d = data as Record<string, unknown>
  const candidates = [
    (d["Data"] as Record<string, unknown> | undefined)?.["access_token"],
    (d["data"] as Record<string, unknown> | undefined)?.["access_token"],
    d["access_token"],
    d["accessToken"],
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c
  }
  return null
}

function extractErrorMessage(data: unknown, rawText: string): string {
  const d = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const parts = [
    d["ErrorCode"],
    d["DescriptionErrorCode"],
    d["descriptionErrorCode"],
    d["Errors"],
    d["errorMessage"],
    d["message"],
  ].filter((x) => typeof x === "string" && x)
  if (parts.length) return parts.join(" — ")
  return rawText.slice(0, 500)
}

export async function getToken(cfg: MisaConfig, force = false): Promise<string> {
  const tokenPath = (cfg.tokenPath || "").trim()
  if (!tokenPath) {
    throw new Error(
      "Chưa cấu hình 'Endpoint lấy token' (token_path) cho MISA. Vào Cài đặt → Hoá đơn điện tử."
    )
  }
  const key = cacheKey(cfg)
  const now = Date.now()
  if (!force) {
    const cached = tokenCache.get(key)
    if (cached && cached.expiresAt > now) return cached.token
  }

  const res = await fetch(`${cfg.apiBase}${tokenPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appid: cfg.appId ?? "",
      taxcode: cfg.taxCode,
      username: cfg.username,
      password: cfg.password,
    }),
  })

  const text = await res.text()
  let data: MisaTokenResponse = {}
  try {
    data = text ? (JSON.parse(text) as MisaTokenResponse) : {}
  } catch {
    // Response không phải JSON — vẫn để raw để log debug.
  }

  if (!res.ok) {
    throw new Error(`MISA token lỗi ${res.status}: ${extractErrorMessage(data, text)}`)
  }
  // MISA dùng { Success: false, ErrorCode: ... } để báo lỗi nghiệp vụ mặc dù HTTP 200.
  if ((data as Record<string, unknown>)["Success"] === false) {
    throw new Error(`MISA token thất bại: ${extractErrorMessage(data, text)}`)
  }
  const token = extractToken(data)
  if (!token) {
    throw new Error(
      `MISA token: không thấy access_token trong response. Raw: ${text.slice(0, 300)}`
    )
  }

  const expiresIn =
    (data.Data?.expires_in as number | undefined) ?? (data as Record<string, unknown>)["expires_in"]
  const ttl =
    typeof expiresIn === "number" && expiresIn > 0
      ? Math.min(expiresIn * 1000, TOKEN_TTL_MS)
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
  // MISA Integration API response:
  // { success, errorCode, descriptionErrorCode,
  //   createInvoiceResult: [{RefID, TransactionID, ...}],
  //   publishInvoiceResult: [{RefID, InvoiceNumber, InvoiceIssuedDate, ...}] }
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const candidates: Array<Record<string, unknown>> = [obj]
  for (const k of ["Data", "data", "publishInvoiceResult", "createInvoiceResult"]) {
    const v = obj[k]
    if (Array.isArray(v) && v.length) candidates.push(v[0] as Record<string, unknown>)
    else if (v && typeof v === "object") candidates.push(v as Record<string, unknown>)
  }
  const pick = (...keys: string[]): string | null => {
    for (const src of candidates) {
      for (const k of keys) {
        const v = src?.[k]
        if (typeof v === "string" && v) return v
        if (typeof v === "number") return String(v)
      }
    }
    return null
  }
  return {
    lookup: pick("TransactionID", "transactionID", "LookupCode", "lookupCode", "lookup_code", "Code"),
    invNo: pick("InvoiceNumber", "invoiceNumber", "InvNo", "invNo", "invoice_no"),
  }
}

export async function publishInvoice(
  cfg: MisaConfig,
  payload: InvoicePayload
): Promise<MisaPublishResponse> {
  const publishPath = (cfg.publishPath || "").trim()
  if (!publishPath) {
    return {
      ok: false,
      raw: null,
      error:
        "Chưa cấu hình 'Endpoint phát hành' (publish_path) cho MISA. Vào Cài đặt → Hoá đơn điện tử.",
      lookup_code: null,
      inv_no: null,
    }
  }
  const doCall = async (token: string) => {
    const res = await fetch(`${cfg.apiBase}${publishPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // MISA Integration API yêu cầu header CompanyTaxCode.
        CompanyTaxCode: cfg.taxCode || "",
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
      error: `MISA publish lỗi ${res.status}: ${extractErrorMessage(data, text)}`,
      lookup_code: null,
      inv_no: null,
    }
  }

  // Success HTTP 200 nhưng nghiệp vụ có thể fail (Success:false hoặc errorCode).
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const businessFailed =
    obj["Success"] === false ||
    obj["success"] === false ||
    (typeof obj["errorCode"] === "string" && obj["errorCode"] !== "") ||
    (typeof obj["ErrorCode"] === "string" && obj["ErrorCode"] !== "")
  if (businessFailed) {
    return {
      ok: false,
      raw: data,
      error: `MISA publish thất bại: ${extractErrorMessage(data, text)}`,
      lookup_code: null,
      inv_no: null,
    }
  }

  const { lookup, invNo } = extractPublishResult(data)
  return { ok: true, raw: data, lookup_code: lookup, inv_no: invNo }
}
