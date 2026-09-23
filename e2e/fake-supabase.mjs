/**
 * SUPABASE GIẢ CHO CHỐT BẤM MÀN HÌNH (e2e/).
 *
 * ⚠ VÌ SAO GIẢ, KHÔNG CHẠY SUPABASE THẬT: môi trường chạy chốt không tải
 *   được PostgREST / GoTrue (proxy chặn GitHub releases và CDN của Docker
 *   Hub). Phần SQL, RLS và RPC đã có chốt chạy trên Postgres thật
 *   (/tmp/pgtest, scripts/sql). Chốt e2e nhắm vào chỗ NỐI GIAO DIỆN — nút
 *   bấm có gọi đúng phép tính không, và app gửi xuống máy chủ con số gì —
 *   đúng loại lỗi đã lọt qua 4.000 chốt đơn vị (đổi đơn vị không đổi giá).
 *
 * Nói tập con cú pháp PostgREST đủ cho các màn đang chốt: lọc eq / in / is /
 * ilike, `or=(…)` (nhiều `or` ghép bằng VÀ, như PostgREST),
 * order, limit / Range, Accept object, Prefer count, HEAD; ghi insert /
 * patch / delete vào bộ nhớ; RPC theo bảng xử lý. Mọi yêu cầu được ghi
 * vào `requests` — chốt đọc qua GET /__log.
 */
import http from "node:http"
import crypto from "node:crypto"

export const JWT_SECRET = "e2e-khong-phai-bi-mat-that-0123456789abcdef"

const b64u = (b) => Buffer.from(b).toString("base64url")
export function signJwt(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const p = b64u(JSON.stringify(payload))
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")
  return `${h}.${p}.${s}`
}
export const ANON_KEY = signJwt({ role: "anon", iss: "supabase", iat: 1700000000, exp: 4102444800 })

function parseVal(v) {
  if (v === "null") return null
  if (v === "true") return true
  if (v === "false") return false
  return v
}

/** Một điều kiện lọc PostgREST → hàm kiểm dòng. `null` = không hiểu, bỏ qua (có ghi log). */
function filterFn(col, expr) {
  const neg = expr.startsWith("not.")
  const e = neg ? expr.slice(4) : expr
  const dot = e.indexOf(".")
  const op = e.slice(0, dot)
  let raw = e.slice(dot + 1)
  // Giá trị trong ngoặc kép: `\"` / `\\` là ký tự thật.
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1).replace(/\\(.)/g, "$1")
  const get = (row) => col.split("->>").reduce((o, k) => (o == null ? undefined : o[k]), row)
  let f = null
  if (op === "eq") f = (r) => String(get(r)) === raw
  else if (op === "neq") f = (r) => String(get(r)) !== raw
  else if (op === "is") f = (r) => (get(r) ?? null) === parseVal(raw)
  else if (op === "in") {
    const set = new Set(raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")))
    f = (r) => set.has(String(get(r)))
  } else if (op === "ilike" || op === "like") {
    // PostgREST: `%` (hoặc `*`) là ký tự đại diện; `\%` / `\_` là ký tự thật.
    let mau = ""
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (ch === "\\" && i + 1 < raw.length) { mau += raw[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue }
      if (ch === "%" || ch === "*") mau += ".*"
      else if (ch === "_") mau += "."
      else mau += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
    const re = new RegExp(`^${mau}$`, op === "ilike" ? "is" : "s")
    f = (r) => get(r) != null && re.test(String(get(r)))
  } else if (op === "gt") f = (r) => Number(get(r)) > Number(raw)
  else if (op === "gte") f = (r) => (get(r) ?? "") >= raw
  else if (op === "lt") f = (r) => Number(get(r)) < Number(raw)
  else if (op === "lte") f = (r) => (get(r) ?? "") <= raw
  if (!f) return null
  return neg ? (r) => !f(r) : f
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"])

/** Tách `a.eq.1,b.in.(x,y)` ở dấu phẩy NGOÀI ngoặc. */
function tachOr(v) {
  const out = []
  let sau = 0, dau = 0
  let trongNhay = false
  for (let i = 0; i < v.length; i++) {
    if (trongNhay) {
      if (v[i] === "\\") i++
      else if (v[i] === '"') trongNhay = false
      continue
    }
    if (v[i] === '"') trongNhay = true
    else if (v[i] === "(") sau++
    else if (v[i] === ")") sau--
    else if (v[i] === "," && sau === 0) { out.push(v.slice(dau, i)); dau = i + 1 }
  }
  out.push(v.slice(dau))
  return out.filter(Boolean)
}
/** `or=(a.eq.1,b.ilike.%x%)` → hàm kiểm dòng; điều kiện lạ thì `null` (ghi log). */
function orFn(v) {
  const trong = v.replace(/^\(/, "").replace(/\)$/, "")
  const fs = []
  for (const dk of tachOr(trong)) {
    const i = dk.indexOf(".")
    const f = filterFn(dk.slice(0, i), dk.slice(i + 1))
    if (!f) return null
    fs.push(f)
  }
  return (r) => fs.some((f) => f(r))
}

export function createFakeSupabase({ tables, rpc = {}, users }) {
  const db = structuredClone(tables)
  const requests = []
  let seq = 1
  const newId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
      "access-control-expose-headers": "content-range",
      ...headers,
    })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }

  const userFromAuth = (req) => {
    const tok = (req.headers.authorization || "").replace(/^Bearer /, "")
    try {
      const p = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString())
      return users.find((u) => u.id === p.sub) ?? null
    } catch { return null }
  }

  const session = (u) => {
    const now = Math.floor(Date.now() / 1000)
    const authUser = { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }
    return {
      access_token: signJwt({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now, exp: now + 3600 }),
      token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
      refresh_token: `rt-${u.id}`, user: authUser,
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x")
    let body = ""
    for await (const c of req) body += c
    const json = body ? (() => { try { return JSON.parse(body) } catch { return body } })() : undefined
    if (req.method === "OPTIONS") return send(res, 204)
    if (url.pathname === "/__log") return send(res, 200, requests)
    if (url.pathname === "/__db") return send(res, 200, db)
    const entry = { method: req.method, path: url.pathname, query: url.search, body: json, prefer: req.headers.prefer }
    requests.push(entry)

    // ---- auth ----
    if (url.pathname.startsWith("/auth/v1")) {
      const p = url.pathname.slice(8)
      if (p === "/token") {
        const u = url.searchParams.get("grant_type") === "refresh_token"
          ? users.find((x) => `rt-${x.id}` === json?.refresh_token)
          : users.find((x) => x.email === json?.email && x.password === json?.password)
        if (!u) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" })
        return send(res, 200, session(u))
      }
      if (p === "/user") {
        const u = userFromAuth(req)
        return u ? send(res, 200, session(u).user) : send(res, 401, { msg: "invalid JWT" })
      }
      if (p === "/logout") return send(res, 204)
      return send(res, 200, {})
    }

    // ---- rpc ----
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice(13)
      const h = rpc[fn]
      if (!h) { entry.unhandled = true; return send(res, 200, null) }
      try {
        const out = await h(json ?? {}, { db, newId, user: userFromAuth(req) })
        return send(res, 200, out ?? null)
      } catch (e) {
        return send(res, 400, { code: e.code ?? "P0001", message: String(e.message ?? e) })
      }
    }

    // ---- bảng ----
    if (!url.pathname.startsWith("/rest/v1/")) return send(res, 404, { message: "not found" })
    const table = url.pathname.slice(9)
    if (!db[table]) { db[table] = []; entry.unknownTable = true }
    const rows = db[table]
    const filters = []
    for (const [k, v] of url.searchParams) {
      if (RESERVED.has(k)) continue
      if (k === "or") {
        const f = orFn(v)
        if (f) filters.push(f)
        else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
        continue
      }
      if (k === "and") { entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]; continue }
      const f = filterFn(k, v)
      if (f) filters.push(f)
      else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
    }
    const match = (r) => filters.every((f) => f(r))

    if (req.method === "POST") {
      const input = Array.isArray(json) ? json : [json]
      const upsert = (req.headers.prefer || "").includes("resolution=merge-duplicates")
      const out = input.map((r) => {
        if (upsert && r.id) {
          const i = rows.findIndex((x) => x.id === r.id)
          if (i >= 0) { rows[i] = { ...rows[i], ...r }; return rows[i] }
        }
        const row = { id: newId(), created_at: new Date().toISOString(), ...r }
        rows.push(row)
        return row
      })
      const wantObj = (req.headers.accept || "").includes("vnd.pgrst.object")
      return send(res, 201, wantObj ? out[0] : out)
    }
    if (req.method === "PATCH") {
      const hit = rows.filter(match)
      for (const r of hit) Object.assign(r, json)
      const wantObj = (req.headers.accept || "").includes("vnd.pgrst.object")
      return send(res, 200, wantObj ? hit[0] ?? null : hit)
    }
    if (req.method === "DELETE") {
      const hit = rows.filter(match)
      db[table] = rows.filter((r) => !match(r))
      return send(res, 200, hit)
    }

    let out = rows.filter(match)
    const order = url.searchParams.get("order")
    if (order) {
      const [col, dir] = order.split(",")[0].split(".")
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1))
    }
    const total = out.length
    const range = req.headers.range || req.headers["range"]
    let from = Number(url.searchParams.get("offset") || 0)
    let to = url.searchParams.get("limit") ? from + Number(url.searchParams.get("limit")) - 1 : total - 1
    if (range) { const m = /(\d+)-(\d+)/.exec(range); if (m) { from = +m[1]; to = +m[2] } }
    out = out.slice(from, to + 1)
    const headers = { "content-range": `${total ? from : "*"}-${total ? from + out.length - 1 : ""}/${total}` }
    if (req.method === "HEAD") return send(res, 200, undefined, headers)
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
      if (out.length !== 1) return send(res, 406, { code: "PGRST116", message: `JSON object requested, ${out.length} rows returned` }, headers)
      return send(res, 200, out[0], headers)
    }
    return send(res, 200, out, headers)
  })

  return { server, requests, db }
}
