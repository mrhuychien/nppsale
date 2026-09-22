/**
 * Client Supabase GIẢ đủ cho `createOrderRecords` — cả đường RPC (mig 169)
 * lẫn đường cũ ba lệnh rời. Ghi lại mọi lệnh để chốt đếm được.
 */
export interface FakeOrderDbOpts {
  /** Kết quả của rpc("create_order_with_lines"). */
  rpc?: { data: unknown; error: unknown }
  /** Kết quả lệnh chèn đầu đơn ở đường cũ. */
  insertOrder?: { data: unknown; error: unknown }
  /** Đơn đã có theo client_request_id (nhánh 23505). */
  existing?: { id: string; order_code: string } | null
  /** Số dòng hàng đơn đã có đang mang. */
  existingLineCount?: number
}

export function fakeOrderDb(o: FakeOrderDbOpts) {
  const log: Array<{ op: string; table?: string; payload?: unknown }> = []
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    const self = () => c
    for (const k of ["select", "eq", "order", "limit", "range"]) c[k] = self
    c.single = () => Promise.resolve(result)
    c.maybeSingle = () => Promise.resolve(result)
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return c
  }
  const db = {
    log,
    rpc(fn: string, args: Record<string, unknown>) {
      log.push({ op: "rpc", table: fn, payload: args })
      return Promise.resolve(o.rpc ?? { data: null, error: { code: "PGRST202", message: "Could not find the function public.create_order_with_lines" } })
    },
    from(table: string) {
      return {
        insert(payload: unknown) {
          log.push({ op: "insert", table, payload })
          if (table === "sales_orders") return chain(o.insertOrder ?? { data: null, error: null })
          if (table === "returns") return chain({ data: { id: "ret-1" }, error: null })
          return chain({ data: null, error: null })
        },
        select(_cols: string, opts?: { head?: boolean }) {
          log.push({ op: "select", table })
          if (opts?.head) return chain({ count: o.existingLineCount ?? 0, error: null })
          return chain({ data: o.existing ?? null, error: null })
        },
      }
    },
  }
  return db
}
