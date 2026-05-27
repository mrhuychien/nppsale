import type {
  InvoicePayload,
  MisaConfig,
  MisaPublishResponse,
  MisaTemplate,
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

/**
 * Trích các định danh tenant MISA từ response /oauth (doc LAYTOKEN).
 * Response có CompanyID, OrganizationUnitID, UserID, IsInvoiceWithCode.
 */
export function extractTenantIds(data: unknown): {
  companyId: string | null
  orgUnitId: string | null
  userId: string | null
  isInvoiceWithCode: boolean | null
} {
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const candidates: Array<Record<string, unknown>> = [obj]
  for (const k of ["Data", "data"]) {
    const v = obj[k]
    if (v && typeof v === "object") candidates.push(v as Record<string, unknown>)
    else if (typeof v === "string" && v) {
      try {
        const parsed = JSON.parse(v)
        if (parsed && typeof parsed === "object") candidates.push(parsed as Record<string, unknown>)
      } catch { /* not json */ }
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
  // IsInvoiceWithCode được MISA trả về string "True"/"False" (case-insensitive).
  const pickBool = (...keys: string[]): boolean | null => {
    for (const src of candidates) {
      for (const k of keys) {
        const val = src?.[k]
        if (typeof val === "boolean") return val
        if (typeof val === "string") {
          const lower = val.toLowerCase().trim()
          if (lower === "true") return true
          if (lower === "false") return false
        }
      }
    }
    return null
  }
  return {
    companyId: pick("CompanyID", "companyID", "companyId", "company_id"),
    orgUnitId: pick("OrganizationUnitID", "organizationUnitID", "organizationUnitId", "OrgUnitID"),
    userId: pick("UserID", "userID", "userId", "user_id"),
    isInvoiceWithCode: pickBool("IsInvoiceWithCode", "isInvoiceWithCode"),
  }
}

/**
 * Gọi LAYMAU `POST /v3common/template` (hoặc /v3common/code/template).
 * Trả về danh sách mẫu HD active để user/code chọn 1.
 */
export async function getInvoiceTemplates(
  cfg: MisaConfig,
  typeInvoice = 0
): Promise<MisaTemplate[]> {
  const token = await getToken(cfg)
  const path = cfg.isInvoiceWithCode ? "/v3common/code/template" : "/v3common/template"
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      TaxCode: cfg.taxCode,
      taxcode: cfg.taxCode,
    },
    body: JSON.stringify({
      TypeInvoice: typeInvoice,
      TaxCode: cfg.taxCode,
      UserName: cfg.username,
      Password: cfg.password,
    }),
  })
  const text = await res.text()
  let obj: Record<string, unknown> = {}
  try { obj = text ? JSON.parse(text) : {} } catch { /* */ }
  if (!res.ok) {
    throw new Error(`Lấy mẫu HD lỗi ${res.status}: ${extractErrorMessage(obj, text)}`)
  }
  if (obj["success"] === false || obj["Success"] === false) {
    throw new Error(`Lấy mẫu HD thất bại: ${extractErrorMessage(obj, text)}`)
  }
  const dataStr = obj["data"] ?? obj["Data"]
  if (typeof dataStr !== "string" || !dataStr) return []
  try {
    const arr = JSON.parse(dataStr)
    return Array.isArray(arr) ? (arr as MisaTemplate[]) : []
  } catch {
    return []
  }
}

/**
 * GET /v3sainvoice/?refID=... (hoặc /v3sainvoice/code/?refID=...)
 * — lấy thông tin hoá đơn hiện tại trên MISA (InvNo, PublishStatus, TransactionID...).
 */
export async function getInvoiceByRefId(
  cfg: MisaConfig,
  refId: string
): Promise<Record<string, unknown> | null> {
  const token = await getToken(cfg)
  const segment = cfg.isInvoiceWithCode ? "code/" : ""
  const url = `${cfg.apiBase}/v3sainvoice/${segment}?refID=${encodeURIComponent(refId)}`
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      TaxCode: cfg.taxCode,
      taxcode: cfg.taxCode,
      "Content-Type": "application/json",
    },
  })
  const text = await res.text()
  let obj: Record<string, unknown> = {}
  try { obj = text ? JSON.parse(text) : {} } catch { /* */ }
  if (!res.ok) {
    throw new Error(`Lấy HD lỗi ${res.status}: ${extractErrorMessage(obj, text)}`)
  }
  if (obj["success"] === false || obj["Success"] === false) {
    throw new Error(`Lấy HD thất bại: ${extractErrorMessage(obj, text)}`)
  }
  const dataStr = obj["data"] ?? obj["Data"]
  if (typeof dataStr !== "string" || !dataStr) return null
  try { return JSON.parse(dataStr) as Record<string, unknown> } catch { return null }
}

/**
 * Gọi /oauth + trả response thô để caller tự extract IDs.
 * Dùng cho luồng "Test connection & auto-fill IDs" ở Settings.
 */
export async function getTokenWithRawResponse(cfg: MisaConfig): Promise<{
  token: string
  raw: unknown
}> {
  const token = await getToken(cfg, true)
  // getToken cache token; gọi lại để bắt raw — nhưng getToken không expose raw.
  // Workaround: tự gọi 1 lần để lấy raw, không cache.
  const tokenPath = (cfg.tokenPath || "").trim()
  const form = new URLSearchParams()
  form.set("grant_type", "password")
  form.set("username", cfg.username)
  form.set("password", cfg.password)
  const res = await fetch(`${cfg.apiBase}${tokenPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      TaxCode: cfg.taxCode,
      taxcode: cfg.taxCode,
      CompanyTaxCode: cfg.taxCode,
    },
    body: form.toString(),
  })
  const text = await res.text()
  let raw: unknown = {}
  try { raw = text ? JSON.parse(text) : {} } catch { raw = { _raw: text } }
  return { token, raw }
}

function extractErrorMessage(data: unknown, rawText: string): string {
  const d = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  // MISA /oauth lỗi thường có dạng: { error, error_description, status }
  // (chuẩn OAuth2). Ưu tiên error_description vì có message tiếng Việt.
  const oauthErr = d["error_description"] || d["error"]
  if (typeof oauthErr === "string" && oauthErr) {
    const code = typeof d["error"] === "string" && d["error"] !== oauthErr ? ` (${d["error"]})` : ""
    return `${oauthErr}${code}`
  }
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
      // MISA WebAPI v2 header MST: gửi cả 3 case để chắc — HTTP header
      // case-insensitive nhưng .NET binding hay sensitive.
      TaxCode: cfg.taxCode,
      taxcode: cfg.taxCode,
      CompanyTaxCode: cfg.taxCode,
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

  // MISA đôi khi trả HTTP 200 nhưng body có {error, error_description, status:401}.
  // Bắt cả 2 case: HTTP fail + business fail trong body.
  const dataObj = data as Record<string, unknown>
  const hasOAuthError = typeof dataObj["error"] === "string" && dataObj["error"]
  if (!res.ok || hasOAuthError) {
    const inferStatus = typeof dataObj["status"] === "number" ? dataObj["status"] : res.status
    throw new Error(`MISA token lỗi ${inferStatus}: ${extractErrorMessage(data, text)}`)
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

function extractPublishResult(data: unknown): {
  lookup: string | null
  invNo: string | null
  innerSuccess: boolean | null
  innerError: string | null
} {
  // /v3sainvoice response (doc):
  // { success, data: "{\"<refId>\":{\"Data\":\"<innerJSON>\",
  //     \"ErrorMessage\":null,\"ErrorCode\":[],\"Success\":true,\"EntityState\":0}}", ... }
  // → outer.data là chuỗi JSON, parse ra map refId→{Data, Success, ErrorMessage}.
  const obj = (typeof data === "object" && data ? data : {}) as Record<string, unknown>
  const candidates: Array<Record<string, unknown>> = [obj]
  let innerSuccess: boolean | null = null
  let innerError: string | null = null

  const tryParseAndCollect = (raw: unknown) => {
    if (typeof raw !== "string" || !raw) return
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        candidates.push(parsed[0] as Record<string, unknown>)
      } else if (parsed && typeof parsed === "object") {
        const map = parsed as Record<string, unknown>
        // Map refId → result. Lấy entry đầu tiên.
        for (const v of Object.values(map)) {
          if (v && typeof v === "object") {
            const entry = v as Record<string, unknown>
            candidates.push(entry)
            if (typeof entry["Success"] === "boolean") innerSuccess = entry["Success"] as boolean
            if (typeof entry["ErrorMessage"] === "string" && entry["ErrorMessage"]) {
              innerError = entry["ErrorMessage"] as string
            }
            const errCode = entry["ErrorCode"]
            if (Array.isArray(errCode) && errCode.length) {
              innerError = (innerError ? innerError + " · " : "") + JSON.stringify(errCode)
            }
            // Data bên trong là 1 chuỗi JSON nữa của HĐ đã lưu — parse tiếp.
            tryParseAndCollect(entry["Data"])
          }
        }
      }
    } catch { /* không phải JSON — bỏ qua */ }
  }

  for (const k of ["data", "newdata", "content", "Data"]) {
    tryParseAndCollect(obj[k])
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
    lookup: pick("TransactionID", "transactionID", "LookupCode", "lookupCode", "lookup_code"),
    invNo: pick("InvNo", "invNo", "InvoiceNumber", "RefID", "refID"),
    innerSuccess,
    innerError,
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
        // MISA WebAPI v2 SAInvoice/Insert: header MST.
        // Gửi cả 3 casing để cover .NET binding (HTTP header
        // case-insensitive nhưng MISA binding có thể sensitive).
        TaxCode: cfg.taxCode || "",
        taxcode: cfg.taxCode || "",
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

  const { lookup, invNo, innerSuccess, innerError } = extractPublishResult(data)

  // Nested success/error từ trong data: refId → {Success, ErrorMessage}.
  if (innerSuccess === false) {
    return {
      ok: false,
      raw: data,
      error: `MISA từ chối hoá đơn: ${innerError || extractErrorMessage(data, text)}`,
      lookup_code: null,
      inv_no: null,
    }
  }

  // Edge case: success:true ở outer + không có dữ liệu hoá đơn trả về →
  // thường do endpoint sai (sandbox vs production lệch) hoặc path không khớp.
  const dataField = obj["data"]
  const newdataField = obj["newdata"]
  const contentField = obj["content"]
  const isEmpty =
    (dataField === "" || dataField == null) &&
    (newdataField === "" || newdataField == null) &&
    (contentField == null) &&
    !lookup && !invNo && innerSuccess !== true
  if (isEmpty) {
    return {
      ok: false,
      raw: data,
      error:
        "MISA trả success nhưng không có dữ liệu hoá đơn. " +
        "Thường do: api_base sai (sandbox vs production lệch tài khoản), hoặc path không trùng (/v3sainvoice vs /v3sainvoice/Code).",
      lookup_code: null,
      inv_no: null,
    }
  }

  return { ok: true, raw: data, lookup_code: lookup, inv_no: invNo }
}
