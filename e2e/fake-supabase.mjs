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
import { WebSocketServer } from "ws"
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
  // `a->>b` (JSON) và `bang.cot` (lọc theo bảng nhúng, như `customer.channel` của `!inner`).
  const get = (row) => col.split(/->>|\./).reduce((o, k) => (o == null ? undefined : o[k]), row)
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
  /* Cột số so bằng SỐ (PostgREST ép kiểu theo cột); ngày/chuỗi so chuỗi ISO. */
  else if (op === "gte") f = (r) => (laSo(get(r)) && laSo(raw) ? Number(get(r)) >= Number(raw) : (get(r) ?? "") >= raw)
  else if (op === "lt") f = (r) => Number(get(r)) < Number(raw)
  else if (op === "lte") f = (r) => (laSo(get(r)) && laSo(raw) ? Number(get(r)) <= Number(raw) : (get(r) ?? "") <= raw)
  if (!f) return null
  return neg ? (r) => !f(r) : f
}

function laSo(v) {
  return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v))
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
/**
 * Một phần tử logic: `a.eq.1`, `and(…)`, `or(…)` (lồng tuỳ ý, như PostgREST —
 * ô tìm từng từ gửi `and(or(…),or(…))`, mig 205). `null` = không hiểu.
 */
function phanTuFn(dk) {
  for (const [tien, moi] of [["and(", "every"], ["or(", "some"], ["not.and(", "every"], ["not.or(", "some"]]) {
    if (dk.startsWith(tien) && dk.endsWith(")")) {
      const con = tachOr(dk.slice(tien.length, -1)).map(phanTuFn)
      if (con.some((c) => !c)) return null
      const f = (r) => con[moi]((c) => c(r))
      return tien.startsWith("not.") ? (r) => !f(r) : f
    }
  }
  const i = dk.indexOf(".")
  return filterFn(dk.slice(0, i), dk.slice(i + 1))
}

/** `or=(a.eq.1,b.ilike.%x%)` → hàm kiểm dòng; điều kiện lạ thì `null` (ghi log). */
function orFn(v, moi = "some") {
  const trong = v.replace(/^\(/, "").replace(/\)$/, "")
  const fs = []
  for (const dk of tachOr(trong)) {
    const f = phanTuFn(dk)
    if (!f) return null
    fs.push(f)
  }
  return (r) => fs[moi]((f) => f(r))
}

/**
 * Khoá `tim_kd`, chép từ `viValueKey` (src/lib/search.ts) / `khoa_tim()` (mig 205):
 * bảng → cột ghép. Ba bảng đầu là cột thật (mig 177/203), còn lại là cột tính
 * `tim_kd(<bảng>)` của mig 205. ⚠ Chốt tests/tim-chung.test.ts so hàm này với
 * `viValueKey` trên cùng bộ mẫu.
 */
const TIM_KD = {
  products: ["sku", "name", "barcode"],
  customers: ["store_name", "owner_name", "phone", "tax_code", "address", "ward", "district", "province"],
  suppliers: ["name", "code", "phone", "tax_code"],
  sales_orders: ["order_code"],
  sales_invoices: ["invoice_code"],
  returns: ["return_code"],
  stock_entries: ["entry_code"],
  batches: ["batch_code"],
  payables: ["invoice_number"],
  cash_receipts: ["receipt_code", "notes"],
  users: ["full_name", "phone"],
  invoices: ["invoice_number", "customer_name", "misa_inv_no", "misa_invoice_id"],
}
const khongDau = (v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim()
export function khoaTim(v) {
  if (v === null || v === undefined) return ""
  const tu = khongDau(v).split(/[^a-z0-9]+/).filter(Boolean)
  if (!tu.length) return ""
  const lien = tu.join("")
  const out = [tu.join(" ")]
  if (tu.length > 1) out.push(lien)
  const lien0 = tu.map((w) => w.replace(/(^|[a-z])0+(?=[0-9])/g, "$1")).join("")
  if (lien0 !== lien) out.push(lien0)
  return out.join(" ")
}
function ganTimKd(table, row) {
  const cot = TIM_KD[table]
  if (cot && row && typeof row === "object") row.tim_kd = cot.map((c) => khoaTim(row[c])).filter(Boolean).join(" ")
  return row
}

export function createFakeSupabase({ tables, rpc = {}, users }) {
  const db = structuredClone(tables)
  for (const t of Object.keys(TIM_KD)) for (const r of db[t] ?? []) ganTimKd(t, r)
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
    /* Bảng NHÚNG trong select (`alias:bang!inner(...)` / `!left`): lọc `alias.cot` áp lên các dòng nhúng (mảng
       hoặc một đối tượng); `!inner` thì dòng cha phải còn ít nhất một dòng nhúng khớp; `alias=is.null` = phép
       loại (anti-join) như PostgREST — vd khách "Chưa phân công" (customers × customer_assignments). */
    const nhung = new Map()
    for (const m of (url.searchParams.get("select") || "").matchAll(/(\w+):\w+(!inner|!left)?\(/g)) nhung.set(m[1], { inner: m[2] === "!inner", loc: [], rong: null })
    for (const [k, v] of url.searchParams) {
      if (RESERVED.has(k)) continue
      const cham = k.indexOf(".")
      if (cham > 0 && !k.includes("->>") && nhung.has(k.slice(0, cham))) {
        const f = filterFn(k.slice(cham + 1), v)
        if (f) nhung.get(k.slice(0, cham)).loc.push(f)
        else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
        continue
      }
      if (nhung.has(k) && (v === "is.null" || v === "not.is.null")) {
        nhung.get(k).rong = v === "is.null"
        continue
      }
      if (k === "or") {
        const f = orFn(v)
        if (f) filters.push(f)
        else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
        continue
      }
      if (k === "and") {
        const f = orFn(v, "every")
        if (f) filters.push(f)
        else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
        continue
      }
      const f = filterFn(k, v)
      if (f) filters.push(f)
      else entry.ignored = [...(entry.ignored ?? []), `${k}=${v}`]
    }
    const quaNhung = (r) => {
      for (const [alias, n] of nhung) {
        if (!n.loc.length && n.rong === null) continue
        const v = r[alias]
        const ds = (Array.isArray(v) ? v : v == null ? [] : [v]).filter((e) => n.loc.every((f) => f(e)))
        if (n.inner && ds.length === 0) return false
        if (n.rong === true && ds.length > 0) return false
        if (n.rong === false && ds.length === 0) return false
      }
      return true
    }
    const match = (r) => filters.every((f) => f(r)) && quaNhung(r)

    if (req.method === "POST") {
      const input = Array.isArray(json) ? json : [json]
      const upsert = (req.headers.prefer || "").includes("resolution=merge-duplicates")
      const out = input.map((r) => {
        if (upsert && r.id) {
          const i = rows.findIndex((x) => x.id === r.id)
          if (i >= 0) { rows[i] = ganTimKd(table, { ...rows[i], ...r }); return rows[i] }
        }
        const row = ganTimKd(table, { id: newId(), created_at: new Date().toISOString(), ...r })
        rows.push(row)
        return row
      })
      const wantObj = (req.headers.accept || "").includes("vnd.pgrst.object")
      return send(res, 201, wantObj ? out[0] : out)
    }
    if (req.method === "PATCH") {
      const hit = rows.filter(match)
      for (const r of hit) ganTimKd(table, Object.assign(r, json))
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
      /* Xếp theo ĐỦ các khoá như PostgREST (`a.desc.nullslast,b.desc,id.asc`) — chỉ xét khoá đầu thì các dòng
         cùng ngày xếp lộn, danh sách giả khác danh sách thật. Khoá nhúng (`customer(store_name)`) bỏ qua. */
      const khoa = order.split(",").filter((k) => !k.includes("(")).map((k) => {
        const [col, ...mo] = k.split(".")
        const desc = mo.includes("desc")
        return { col, desc, nullsFirst: mo.includes("nullsfirst") ? true : mo.includes("nullslast") ? false : desc }
      })
      out = [...out].sort((a, b) => {
        for (const { col, desc, nullsFirst } of khoa) {
          const x = a[col], y = b[col]
          if (x == null && y == null) continue
          if (x == null) return nullsFirst ? -1 : 1
          if (y == null) return nullsFirst ? 1 : -1
          const c = x > y ? 1 : x < y ? -1 : 0
          if (c) return desc ? -c : c
        }
        return 0
      })
    }
    const total = out.length
    const range = req.headers.range || req.headers["range"]
    let from = Number(url.searchParams.get("offset") || 0)
    let to = url.searchParams.get("limit") ? from + Number(url.searchParams.get("limit")) - 1 : total - 1
    if (range) { const m = /(\d+)-(\d+)/.exec(range); if (m) { from = +m[1]; to = +m[2] } }
    out = out.slice(from, to + 1)
    const headers = { "content-range": `${total ? from : "*"}-${total ? from + out.length - 1 : ""}/${total}` }
    if (req.method === "HEAD") return send(res, 200, undefined, headers)
    /* Đếm theo nhóm `select=status,count()` (mig 206) — gom theo các cột thường trong select. */
    const sel = url.searchParams.get("select") || ""
    if (/(^|,)\s*count\(\)/.test(sel)) {
      const cot = sel.split(",").map((x) => x.trim()).filter((x) => x && !x.includes("(") && !x.includes(":"))
      const nhom = new Map()
      for (const r of rows.filter(match)) {
        const k = JSON.stringify(cot.map((c) => r[c] ?? null))
        const g = nhom.get(k) || { ...Object.fromEntries(cot.map((c) => [c, r[c] ?? null])), count: 0 }
        g.count++
        nhom.set(k, g)
      }
      return send(res, 200, Array.from(nhom.values()))
    }
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
      if (out.length !== 1) return send(res, 406, { code: "PGRST116", message: `JSON object requested, ${out.length} rows returned` }, headers)
      return send(res, 200, out[0], headers)
    }
    return send(res, 200, out, headers)
  })

  /**
   * ⚠ REALTIME GIẢ (Phoenix vsn 2.0.0). Không có nó thì kênh không bao giờ vào trạng thái
   *   "đã join", nên lỗi "cannot add postgres_changes callbacks after subscribe()" (chuông gắn
   *   lại kênh cũ chưa rời xong — trắng màn /dashboard trên production 26/09/2026) không hiện
   *   ra được trong chốt. Rời kênh trả lời trễ như mạng thật.
   */
  const wss = new WebSocketServer({ noServer: true })
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("message", (raw) => {
        let m
        try { m = JSON.parse(String(raw)) } catch { return }
        const [joinRef, ref, topic, event] = m
        const reply = (response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response }]))
        if (event === "phx_join") reply({ postgres_changes: [] })
        else if (event === "phx_leave") setTimeout(() => { if (ws.readyState === 1) reply() }, 800)
        else reply()
      })
    })
  })

  return { server, requests, db }
}
