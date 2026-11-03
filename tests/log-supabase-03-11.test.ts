/**
 * LỖI LỘ RA TỪ LOG SUPABASE CHỦ NHÀ GỬI 03/11/2026 (khách NPP báo chậm 18:07–18:25):
 *   · 13 lần "column sales_invoice_lines.created_at does not exist" — `loadLastPrices` (POS lên đơn) sắp theo cột không
 *     có; lỗi bị nuốt nên "giá gần nhất" chưa bao giờ hiện.
 *   · 101 lần "canceling statement due to statement timeout" (57014) — người dùng thấy nguyên câu tiếng Anh, không biết
 *     lệnh đã ghi hay chưa (kể cả `post_invoice` lúc 16:45).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { loadLastPrices, SO_TO_GIA_GAN_NHAT } from "@/lib/pos/load"
import { errorMessage } from "@/lib/errors"
import { explainInvoiceError, lyDoKiemLaiSauXuat } from "@/lib/orders/post-invoice"

/** Sổ giả: ghi lại mọi phép lọc / sắp của từng bảng; trả dữ liệu theo bảng. */
function sbGia(du: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const goi: Array<{ bang: string; select?: string; loc: Array<[string, string, unknown]>; sap: Array<[string, unknown]>; limit?: number }> = []
  const sb = {
    from(bang: string) {
      const q: (typeof goi)[number] = { bang, loc: [], sap: [] }
      goi.push(q)
      const kq = () => Promise.resolve({ data: du[bang]?.data ?? null, error: du[bang]?.error ?? null })
      const b = {
        select(c: string) { q.select = c; return b },
        eq(k: string, v: unknown) { q.loc.push(["eq", k, v]); return b },
        in(k: string, v: unknown) { q.loc.push(["in", k, v]); return b },
        order(k: string, o: unknown) { q.sap.push([k, o]); return b },
        limit(n: number) { q.limit = n; return b },
        then(ok: (v: unknown) => unknown, hong?: (e: unknown) => unknown) { return kq().then(ok, hong) },
      }
      return b
    },
  }
  return { sb: sb as unknown as SupabaseClient, goi }
}

describe("loadLastPrices — giá bán gần nhất cho một khách", () => {
  it("không đụng cột không có: tờ ghi sổ của khách (ngày HĐ rồi lúc tạo, mới trước) → dòng của các tờ ấy, bỏ hàng đổi", async () => {
    const { sb, goi } = sbGia({
      sales_invoices: { data: [{ id: "hd-moi" }, { id: "hd-cu" }] },
      sales_invoice_lines: {
        data: [
          // Thứ tự trả về KHÔNG theo thời gian — hàm phải tự xếp theo thứ tự tờ.
          { invoice_id: "hd-cu", product_id: "sua", unit_price: 18000, sort_order: 0 },
          { invoice_id: "hd-moi", product_id: "mi", unit_price: 5200, sort_order: 1 },
          { invoice_id: "hd-moi", product_id: "sua", unit_price: 19500, sort_order: 0 },
        ],
      },
    })
    expect(await loadLastPrices(sb, "kh-1")).toEqual({
      sua: { price: 19500, times: 2 },
      mi: { price: 5200, times: 1 },
    })
    const [hd, dong] = goi
    expect(hd).toMatchObject({
      bang: "sales_invoices", select: "id",
      loc: [["eq", "customer_id", "kh-1"], ["eq", "status", "posted"]],
      sap: [["invoice_date", { ascending: false }], ["created_at", { ascending: false }]],
      limit: SO_TO_GIA_GAN_NHAT,
    })
    expect(dong.bang).toBe("sales_invoice_lines")
    expect(dong.select).not.toContain("created_at")
    expect(dong.sap).toEqual([])
    expect(dong.loc).toEqual([["in", "invoice_id", ["hd-moi", "hd-cu"]], ["eq", "is_exchange", false]])
  })

  it("khách chưa có tờ nào → {} và không hỏi dòng; đọc hỏng → {} (chỉ là gợi ý, không chặn lên đơn)", async () => {
    const a = sbGia({ sales_invoices: { data: [] } })
    expect(await loadLastPrices(a.sb, "kh-1")).toEqual({})
    expect(a.goi.map((g) => g.bang)).toEqual(["sales_invoices"])
    expect(await loadLastPrices(sbGia({ sales_invoices: { error: { message: "x" } } }).sb, "kh-1")).toEqual({})
    expect(await loadLastPrices(sbGia({ sales_invoices: { data: [{ id: "h" }] }, sales_invoice_lines: { error: { message: "x" } } }).sb, "kh-1")).toEqual({})
  })

  it("mã nguồn: không còn select / order `created_at` trên sales_invoice_lines", () => {
    const s = readFileSync("src/lib/pos/load.ts", "utf-8")
    const ham = s.slice(s.indexOf("export async function loadLastPrices"), s.indexOf("/* ==", s.indexOf("export async function loadLastPrices")))
    expect(ham).not.toMatch(/sales_invoice_lines[\s\S]*created_at/)
  })
})

describe("57014 — Postgres huỷ câu quá hạn: câu tiếng Việt, nói rõ CHƯA ghi gì", () => {
  const goc = "canceling statement due to statement timeout"
  it("có mã (lỗi PostgREST nguyên gốc) và chỉ có câu chữ (lỗi đã gói lại, mất mã) đều dịch", () => {
    const coMa = errorMessage({ code: "57014", message: goc })
    expect(coMa).toContain("Máy chủ đang quá tải nên tự huỷ lệnh chạy quá 8 giây — lệnh bị huỷ thì CHƯA ghi gì")
    expect(coMa).toContain("(mã 57014)") // nguyên văn vẫn đi kèm
    expect(errorMessage(new Error(explainInvoiceError(goc)))).toContain("lệnh bị huỷ thì CHƯA ghi gì")
  })
  it("Xuất hàng bị huỷ vì quá hạn KHÔNG phải 'chưa biết kết quả' — máy chủ đã huỷ trọn giao dịch, không cần hỏi lại sổ", () => {
    expect(lyDoKiemLaiSauXuat(new Error(explainInvoiceError(goc)))).toBeNull()
  })
})
