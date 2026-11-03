import { describe, it, expect, vi, afterEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { PostgrestClient } from "@supabase/postgrest-js"
import { loadInvoiceableLines } from "@/lib/orders/post-invoice"
import { fetchCoHetGio, HET_GIO_MS, DAN_CAU_GHI } from "@/lib/supabase/fetch-het-gio"

/**
 * CHỦ NHÀ 03/11/2026: "em rà soát kỹ phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo lỗi quá 10s".
 * Trên đường nạp đơn vào POS (Xuất hàng, sửa đơn) chỉ MỘT câu đọc đi POST: `get_invoiceable_lines`. Bộ hẹn giờ coi POST là
 * câu GHI: máy chủ khựng quá 10 giây là báo hỏng ngay, không thử lại, kèm câu nhầm "thao tác có thể đã được ghi".
 */

describe("nạp dòng đơn vào POS: get_invoiceable_lines gọi bằng GET", () => {
  it("loadInvoiceableLines → rpc(hàm, { p_order_id }, { get: true })", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }))
    await loadInvoiceableLines({ rpc } as unknown as SupabaseClient, "o-1")
    expect(rpc).toHaveBeenCalledWith("get_invoiceable_lines", { p_order_id: "o-1" }, { get: true })
  })

  describe("qua đúng fetch của app (fetchCoHetGio): máy chủ khựng lần đầu", () => {
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    /** Lượt 1 treo tới khi bị huỷ (hết giờ); lượt 2 trả lời ngay. */
    function fetchKhungLanDau() {
      let lan = 0
      const goi: Array<{ method: string; url: string }> = []
      const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        lan += 1
        goi.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(input) })
        if (lan === 1) {
          return new Promise<Response>((_r, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Fetch is aborted", "AbortError")))
          })
        }
        return Promise.resolve(new Response(JSON.stringify([{ order_line_id: "l1", product_id: "p1", ordered_qty: 2 }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      })
      return { fn, goi }
    }

    it("GET: hết 10 giây thì thử lại MỘT lần và nạp được dòng đơn", async () => {
      vi.useFakeTimers()
      const { fn, goi } = fetchKhungLanDau()
      vi.stubGlobal("fetch", fn)
      const sb = new PostgrestClient("https://x/rest/v1", { fetch: fetchCoHetGio }) as unknown as SupabaseClient
      const p = loadInvoiceableLines(sb, "o-1")
      await vi.advanceTimersByTimeAsync(HET_GIO_MS + 50)
      const dong = await p
      expect(dong).toHaveLength(1)
      expect(dong[0]).toMatchObject({ orderLineId: "l1", productId: "p1", orderedQty: 2 })
      expect(goi.map((g) => g.method)).toEqual(["GET", "GET"])
      expect(goi[0].url).toContain("/rpc/get_invoiceable_lines?p_order_id=o-1")
    })

    it("(đối chứng) cùng câu gửi POST như bản cũ: hỏng ngay sau 10 giây, không thử lại, dặn nhầm 'có thể đã được ghi'", async () => {
      vi.useFakeTimers()
      const { fn, goi } = fetchKhungLanDau()
      vi.stubGlobal("fetch", fn)
      const sb = new PostgrestClient("https://x/rest/v1", { fetch: fetchCoHetGio })
      // Trình dựng câu PostgREST chỉ gửi khi được `then` — khởi động trước rồi mới tua đồng hồ.
      const p = sb.rpc("get_invoiceable_lines", { p_order_id: "o-1" }).then((r) => r)
      await vi.advanceTimersByTimeAsync(HET_GIO_MS + 50)
      const { error } = await p
      expect(goi).toHaveLength(1)
      expect(String(error?.message)).toContain(DAN_CAU_GHI)
    })
  })
})
