import type {
  InvoicePayload,
  MisaConfig,
  MisaPublishResponse,
  MisaTokenResponse,
} from "./types"

/**
 * Layer 1 — MISA meInvoice WebAPI v2 client.
 *
 * Flow đơn giản: login bằng user/pass tài khoản meInvoice thường →
 * đẩy hoá đơn nháp lên web → user vào MISA duyệt + ký thủ công.
 *
 * - getToken(): POST /oauth, body form-encoded grant_type=password,
 *   MST đặt ở header 'taxcode'. Token cache 30 phút.
 * - publishInvoice(): POST /SAInvoice/Insert, Bearer token +
 *   header 'taxcode'.
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
  // WebAPI v2 /oauth trả thẳng { access_token, token_type, expires_in }.
  // Hỗ trợ thêm vị trí wrap để dùng được cả khi MISA đổi format.
  const d = data as Record<string, unknown>
  const candidates = [
    d["access_token"],
    d["accessToken"],
    (d["Data"] as Record<string, unknown> | undefined)?.["access_token"],
    (d["data"] as Record<string, unknown> | undefined)?.["access_token"],
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

  // WebAPI v2 /oauth: body form-encoded, MST ở header 'taxcode'.
  const form = new URLSearchParams()
  form.set("grant_type", "password")
  form.set("username", cfg.username)
  form.set("password", cfg.password)

  const res = await fetch(`${cfg.apiBase}${tokenPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      taxcode: cfg.taxCode,
    },
    body: form.toString(),
  })

  const text = await res.text()
  let data: MisaTokenResponse = {}
  try {
    data = text ? (JSON.parse(text) as MisaTokenResponse) : {}
  } catch {
    // Không phải JSON — log để debug.
  }

  if (!res.ok) {
    throw new Error(`MISA token lỗi ${res.status}: ${extractErrorMessage(data, text)}`)
  }
  const token = extractToken(data)
  if (!token) {
    throw new Error(
      `MISA token: không thấy access_token trong response. Raw: ${text.slice(0, 300)}`
    )
  }

  const expiresIn = (data as Record<string, unknown>)["expires_in"]
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
  // MISA WebAPI v2 response envelope:
  // { success, error, data: "<json string>", newdata: "<json string>",
  //   content: "<json string|null>", dataError, recordsTotal, ... }
  // Khi save OK: data thường chứa JSON string của hoá đơn vừa lưu (RefID, ...).
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const candidates: Array<Record<string, unknown>> = [obj]

  // Parse các field stringified MISA hay dùng.
  for (const k of ["data", "newdata", "content", "Data"]) {
    const v = obj[k]
    if (typeof v === "string" && v) {
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed) && parsed.length) {
          candidates.push(parsed[0] as Record<string, unknown>)
        } else if (parsed && typeof parsed === "object") {
          candidates.push(parsed as Record<string, unknown>)
        }
      } catch { /* không phải JSON — bỏ qua */ }
    } else if (Array.isArray(v) && v.length) {
      candidates.push(v[0] as Record<string, unknown>)
    } else if (v && typeof v === "object") {
      candidates.push(v as Record<string, unknown>)
    }
  }

  const pick = (...keys: string[]): string | null => {
    for (const src of candidates) {
      for (const k of keys) {
        const val = src?.[k]
        if (typeof val === "string" && val) return val
        if (typeof val === "number") return String(val)
      }
    }
    return null
  }
  return {
    lookup: pick("TransactionID", "transactionID", "LookupCode", "lookupCode", "lookup_code", "Code"),
    invNo: pick("RefID", "refID", "InvoiceNumber", "invoiceNumber", "InvNo", "invNo"),
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
        // WebAPI v2 SAInvoice/Insert dùng CompanyTaxCode (PascalCase).
        // Gửi cả 2 dạng để chắc — HTTP header case-insensitive nhưng
        // .NET binding đôi khi nhạy với casing.
        CompanyTaxCode: cfg.taxCode || "",
        taxcode: cfg.taxCode || "",
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

  // Edge case: server trả success:true nhưng data/newdata/content đều rỗng →
  // thường nghĩa là endpoint sai (vd hit api_base sandbox/production lệch
  // tài khoản, hoặc path không khớp WebAPI v2). Báo lỗi rõ để khỏi tưởng OK.
  const dataField = obj["data"]
  const newdataField = obj["newdata"]
  const contentField = obj["content"]
  const isEmpty =
    (dataField === "" || dataField == null) &&
    (newdataField === "" || newdataField == null) &&
    (contentField == null) &&
    !lookup && !invNo
  if (isEmpty) {
    return {
      ok: false,
      raw: data,
      error:
        "MISA trả success nhưng không có dữ liệu hoá đơn (data/newdata/content đều rỗng). " +
        "Thường do: api_base sai (sandbox vs production lệch tài khoản), hoặc tài khoản chưa được cấp quyền API. " +
        "Kiểm tra log einvoice_logs để xem raw response.",
      lookup_code: null,
      inv_no: null,
    }
  }

  return { ok: true, raw: data, lookup_code: lookup, inv_no: invNo }
}
