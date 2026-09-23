/**
 * Supabase GIẢ mô phỏng đúng ba cái bẫy của PostgREST thật (đợt QA 23/09/2026):
 *
 *   · `db.max_rows = 1000` — mỗi lệnh trả TỐI ĐA 1.000 dòng, 200 OK, không lỗi.
 *     `.limit(5000)` cũng bị cắt về 1.000.
 *   · `.in(col, ids)` quá ~150 id → URL quá dài → cổng API trả lỗi.
 *   · `count: "exact"` trả TỔNG THẬT, không bị trần cắt.
 *
 * ⚠ KHÔNG CÓ `.order()` THÌ TRẢ LỘN XỘN — xáo theo từng lệnh — để một phép
 *   đọc phân trang song song mà quên khoá thứ tự duy nhất thì lặp/sót dòng
 *   giống hệt Postgres thật. Chỉ `.order(... "id")` mới cho thứ tự ổn định.
 */

type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

export const MAX_ROWS = 1000
export const MAX_IN = 150

export interface Call {
  table: string
  filters: string[]
  orders: string[]
  range: [number, number] | null
  limit: number | null
  count: boolean
  head: boolean
}

export function fakePostgrest(
  tables: Tables,
  opts: {
    failOn?: (c: Call) => boolean
    /** Cột duy nhất của từng bảng / RPC (mặc định `id`). */
    unique?: Record<string, string>
  } = {}
) {
  const calls: Call[] = []
  const writes: Array<{ table: string; patch: Row; n: number }> = []
  let seed = 1
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  function build(table: string, rpcRows?: Row[]) {
    const preds: Array<(r: Row) => boolean> = []
    const call: Call = { table, filters: [], orders: [], range: null, limit: null, count: false, head: false }
    let inTooLong = false
    let single: "one" | "maybe" | null = null
    let patch: Row | null = null
    let cols = "*"
    const q: Record<string, unknown> = {
      select(c?: string, o?: { count?: string; head?: boolean }) {
        cols = c ?? "*"
        if (o?.count) call.count = true
        if (o?.head) call.head = true
        return q
      },
      eq(c: string, v: unknown) { call.filters.push(`eq.${c}`); preds.push((r) => r[c] === v); return q },
      neq(c: string, v: unknown) { call.filters.push(`neq.${c}`); preds.push((r) => r[c] !== v); return q },
      gt(c: string, v: never) { preds.push((r) => (r[c] as never) > v); return q },
      gte(c: string, v: never) { preds.push((r) => r[c] != null && (r[c] as never) >= v); return q },
      lt(c: string, v: never) { preds.push((r) => r[c] != null && (r[c] as never) < v); return q },
      lte(c: string, v: never) { preds.push((r) => r[c] != null && (r[c] as never) <= v); return q },
      is(c: string, v: unknown) { preds.push((r) => (r[c] ?? null) === v); return q },
      not(c: string, op: string, v: unknown) {
        if (op === "is") preds.push((r) => (r[c] ?? null) !== v)
        return q
      },
      in(c: string, vs: unknown[]) {
        call.filters.push(`in.${c}`)
        if (vs.length > MAX_IN) inTooLong = true
        const s = new Set(vs)
        preds.push((r) => s.has(r[c]))
        return q
      },
      or() { return q },
      ilike() { return q },
      order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
        call.orders.push(c)
        const asc = o?.ascending !== false
        sorts.push({ c, asc })
        return q
      },
      update(v: Row) { patch = v; return q },
      range(a: number, b: number) { call.range = [a, b]; return q },
      limit(n: number) { call.limit = n; return q },
      maybeSingle() { single = "maybe"; return q },
      single() { single = "one"; return q },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej)
      },
    }
    const sorts: Array<{ c: string; asc: boolean }> = []
    void cols

    function run() {
      calls.push(call)
      if (opts.failOn?.(call)) return { data: null, error: { message: "mạng rớt" }, count: null }
      if (inTooLong) return { data: null, error: { message: "414 URI Too Long" }, count: null }
      if (patch) {
        const p = patch
        const hit = (tables[table] ?? []).filter((r) => preds.every((f) => f(r)))
        hit.forEach((r) => Object.assign(r, p))
        writes.push({ table, patch: p, n: hit.length })
        return { data: null, error: null, count: null }
      }
      let rows = (rpcRows ?? tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
      const total = rows.length
      if (sorts.length === 0) {
        rows = [...rows].sort(() => rand() - 0.5)
      } else {
        // Không có `id` trong khoá sắp xếp → các dòng hoà nhau bị xáo, như Postgres.
        const key = opts.unique?.[table] ?? "id"
        const stable = sorts.some((s) => s.c === key)
        rows = [...rows]
          .map((r) => ({ r, k: stable ? 0 : rand() }))
          .sort((x, y) => {
            for (const s of sorts) {
              const a = x.r[s.c] as never, b = y.r[s.c] as never
              if (a === b) continue
              if (a == null) return 1
              if (b == null) return -1
              return (a < b ? -1 : 1) * (s.asc ? 1 : -1)
            }
            return x.k - y.k
          })
          .map((z) => z.r)
      }
      if (call.head) return { data: null, error: null, count: total }
      let from = 0
      let to = rows.length - 1
      if (call.range) [from, to] = call.range
      if (call.limit != null) to = Math.min(to, from + call.limit - 1)
      to = Math.min(to, from + MAX_ROWS - 1)
      let data: unknown = rows.slice(from, to + 1)
      if (single) data = (data as Row[])[0] ?? null
      return { data, error: null, count: call.count ? total : null }
    }
    return q
  }

  const client = {
    from: (t: string) => build(t),
    rpc: (fn: string, _args?: object, o?: { count?: string; head?: boolean }) => {
      const q = build(`rpc:${fn}`, tables[`rpc:${fn}`] ?? []) as { select: (c?: string, o?: object) => unknown }
      q.select(undefined, o)
      return q
    },
  }
  return { client, calls, writes }
}

/** `n` dòng có `id` duy nhất, sinh bằng `make(i)`. */
export function nRows(n: number, make: (i: number) => Row): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, "0")}`, ...make(i) }))
}
