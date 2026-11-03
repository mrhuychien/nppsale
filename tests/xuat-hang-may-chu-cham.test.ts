/**
 * XUẤT HÀNG LÚC MÁY CHỦ CHẬM — chủ nhà 03/11/2026 (khách NPP gửi ảnh, 18:07–18:25): "Loát chậm quá" · "Đơn trên a chưa tạo mới
 * bấm vào xuất hàng mà khi loát kém a thoát máy rồi vào lại thì nó đã ra hoàn thành" · "người nào ko quen mà in đơn sẽ rơi vào
 * quên đơn đó". Màn bỏ chờ ở giây 10, báo "Chưa xuất được" — máy chủ vẫn ghi xong, đơn Hoàn thành, tờ không ai in.
 * Bấm thật: e2e/xuat-hang-may-chu-cham.spec.ts.
 */
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  CHO_LAU_MS, DON_CON_XUAT_DUOC, choHoaDonCuaDon, duongTaiHoaDonDaCo, explainInvoiceError, hoaDonThayManXuat,
  kiemLaiSauLoiXuat, lyDoKiemLaiSauXuat, nhanDangGhi, timHoaDonCuaDon,
} from "@/lib/orders/post-invoice"
import { HET_GIO_GHI_MS, HET_GIO_MS, HetGioError } from "@/lib/supabase/fetch-het-gio"

/** Sổ giả cho `sales_invoices`: mỗi lượt đọc trả một phần tử của `luot` (hết thì lặp phần tử cuối). */
function sbGia(luot: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const goi: Array<{ bang: string; select?: string; eq: Array<[string, unknown]>; order?: [string, unknown]; limit?: number }> = []
  let i = 0
  const sb = {
    from(bang: string) {
      const q: (typeof goi)[number] = { bang, eq: [] }
      const b = {
        select(c: string) { q.select = c; return b },
        eq(k: string, v: unknown) { q.eq.push([k, v]); return b },
        order(k: string, o: unknown) { q.order = [k, o]; return b },
        limit(n: number) {
          q.limit = n
          goi.push(q)
          const r = luot[Math.min(i++, luot.length - 1)]
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
        },
      }
      return b
    },
  }
  return { sb: sb as unknown as SupabaseClient, goi }
}

describe("lyDoKiemLaiSauXuat — lỗi nào CHƯA CHẮC là hỏng", () => {
  it("hết giờ chờ câu ghi (lỗi gốc và câu postInvoice ném lại) → 'chua-biet'", () => {
    expect(lyDoKiemLaiSauXuat(new HetGioError(1, true, HET_GIO_GHI_MS))).toBe("chua-biet")
    // postInvoice ném `new Error(explainInvoiceError(error.message))` — câu hết giờ đi qua nguyên vẹn.
    const msg = `AbortError: ${new HetGioError(1, true, HET_GIO_GHI_MS).message}`
    expect(explainInvoiceError(msg)).toBe(msg)
    expect(lyDoKiemLaiSauXuat(new Error(explainInvoiceError(msg)))).toBe("chua-biet")
  })

  it("rớt mạng giữa chừng (Chrome / Safari / Firefox) → 'chua-biet' — câu có thể đã tới máy chủ", () => {
    for (const m of ["TypeError: Failed to fetch", "TypeError: Load failed", "NetworkError when attempting to fetch resource.", "The network connection was lost."]) {
      expect(lyDoKiemLaiSauXuat(new Error(explainInvoiceError(m))), m).toBe("chua-biet")
    }
  })

  it("máy chủ nói đơn không còn xuất được / tờ cũ hết hiệu lực / đã có hoá đơn → 'da-co' (cả câu đã dịch lẫn mã gốc)", () => {
    const chuaDich = [
      "ORDER_NOT_INVOICEABLE: đơn DH-0001 đang ở trạng thái completed, không xuất hàng được",
      "INVOICE_NOT_POSTED: hóa đơn HD-0001 đang ở trạng thái cancelled",
      'duplicate key value violates unique constraint "uq_sales_invoices_mot_don_mot_hd"',
    ]
    for (const m of chuaDich) {
      expect(lyDoKiemLaiSauXuat(new Error(m)), m).toBe("da-co")
      // postInvoice / reissueInvoice ném câu ĐÃ DỊCH — mã bị cắt khỏi câu.
      expect(lyDoKiemLaiSauXuat(new Error(explainInvoiceError(m))), `đã dịch: ${m}`).toBe("da-co")
    }
    expect(explainInvoiceError(chuaDich[0])).not.toContain("ORDER_NOT_INVOICEABLE")
  })

  it("lỗi thật (thiếu tồn, thiếu quyền, chưa có dòng) → null — báo như cũ, không hỏi sổ", () => {
    for (const m of [
      "INSUFFICIENT_STOCK: Sữa hộp thiếu 5 hộp",
      "FORBIDDEN: bạn không có quyền xuất hàng",
      "NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0",
      "LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu, huỷ phiếu thu trước",
    ]) {
      expect(lyDoKiemLaiSauXuat(new Error(explainInvoiceError(m))), m).toBeNull()
    }
    expect(lyDoKiemLaiSauXuat(null)).toBeNull()
  })
})

describe("timHoaDonCuaDon — hoá đơn ĐÃ GHI SỔ của đơn", () => {
  it("đọc đúng bảng / cột / điều kiện, mới nhất trước; bỏ qua tờ đang sửa (Sửa HĐ: tờ cũ còn posted tới khi lập lại xong)", async () => {
    const { sb, goi } = sbGia([{ data: [{ id: "hd-cu", invoice_code: "HD-1" }, { id: "hd-moi", invoice_code: "HD-1-1" }] }])
    expect(await timHoaDonCuaDon(sb, "o-1")).toEqual({ id: "hd-cu", code: "HD-1" })
    expect(await timHoaDonCuaDon(sb, "o-1", "hd-cu")).toEqual({ id: "hd-moi", code: "HD-1-1" })
    expect(goi[0]).toMatchObject({
      bang: "sales_invoices", select: "id, invoice_code",
      eq: [["order_id", "o-1"], ["status", "posted"]], order: ["created_at", { ascending: false }],
    })
  })

  it("không có tờ → null; đọc hỏng → NÉM (nơi gọi quyết)", async () => {
    expect(await timHoaDonCuaDon(sbGia([{ data: [] }]).sb, "o-1")).toBeNull()
    await expect(timHoaDonCuaDon(sbGia([{ error: { message: "mất mạng" } }]).sb, "o-1")).rejects.toThrow("kiểm lại hoá đơn của đơn: mất mạng")
  })
})

describe("choHoaDonCuaDon — chờ tờ hiện ra (máy chủ có thể còn đang ghi lúc trình duyệt bỏ chờ)", () => {
  it("lượt đầu hỏi NGAY, chưa thấy thì hỏi lại sau `cachMs`; thấy thì thôi", async () => {
    const ngu = vi.fn(async () => {})
    const { sb, goi } = sbGia([{ data: [] }, { data: [] }, { data: [{ id: "hd-1", invoice_code: "HD-9" }] }])
    expect(await choHoaDonCuaDon(sb, "o-1", null, { ngu, cachMs: 5000 })).toEqual({ id: "hd-1", code: "HD-9" })
    expect(goi).toHaveLength(3)
    expect(ngu.mock.calls).toEqual([[5000], [5000]])
  })

  it("một lượt đọc hỏng (mạng còn chập chờn) không dừng việc chờ", async () => {
    const { sb } = sbGia([{ error: { message: "Failed to fetch" } }, { data: [{ id: "hd-1", invoice_code: "HD-9" }] }])
    expect(await choHoaDonCuaDon(sb, "o-1", null, { ngu: async () => {} })).toEqual({ id: "hd-1", code: "HD-9" })
  })

  it("hỏi đủ `lan` lượt không thấy → null (màn báo hỏng + dặn bấm lại an toàn)", async () => {
    const ngu = vi.fn(async () => {})
    const { sb, goi } = sbGia([{ data: [] }])
    expect(await choHoaDonCuaDon(sb, "o-1", null, { ngu })).toBeNull()
    expect(goi).toHaveLength(4)
    expect(ngu).toHaveBeenCalledTimes(3)
  })
})

describe("kiemLaiSauLoiXuat — MỘT luật cho mọi đường xuất (POS, điện thoại, Xuất đủ ở danh sách đơn)", () => {
  it("lỗi thật → null, KHÔNG hỏi sổ", async () => {
    const { sb, goi } = sbGia([{ data: [{ id: "hd-1", invoice_code: "HD-9" }] }])
    expect(await kiemLaiSauLoiXuat(sb, "o-1", new Error("Không đủ tồn: Sữa hộp thiếu 5 hộp"))).toBeNull()
    expect(goi).toHaveLength(0)
  })

  it("'chua-biet' → chờ vài lượt tới khi thấy tờ (bỏ qua tờ đang sửa)", async () => {
    const ngu = vi.fn(async () => {})
    const { sb, goi } = sbGia([{ data: [] }, { data: [{ id: "hd-cu", invoice_code: "HD-1" }, { id: "hd-moi", invoice_code: "HD-1-1" }] }])
    expect(await kiemLaiSauLoiXuat(sb, "o-1", new HetGioError(1, true, HET_GIO_GHI_MS), "hd-cu", { ngu })).toEqual({
      lyDo: "chua-biet", hd: { id: "hd-moi", code: "HD-1-1" },
    })
    expect(goi).toHaveLength(2)
    expect(ngu).toHaveBeenCalledTimes(1)
  })

  it("'da-co' → hỏi MỘT lượt (không chờ); đọc hỏng thì hd = null, không ném", async () => {
    const loi = new Error(explainInvoiceError("ORDER_NOT_INVOICEABLE: đơn DH-1 đang ở trạng thái completed, không xuất hàng được"))
    const ngu = vi.fn(async () => {})
    const a = sbGia([{ data: [] }, { data: [{ id: "hd-1", invoice_code: "HD-9" }] }])
    expect(await kiemLaiSauLoiXuat(a.sb, "o-1", loi, null, { ngu })).toEqual({ lyDo: "da-co", hd: null })
    expect(a.goi).toHaveLength(1)
    expect(ngu).not.toHaveBeenCalled()
    const b = sbGia([{ data: [{ id: "hd-1", invoice_code: "HD-9" }] }])
    expect(await kiemLaiSauLoiXuat(b.sb, "o-1", loi)).toEqual({ lyDo: "da-co", hd: { id: "hd-1", code: "HD-9" } })
    const c = sbGia([{ error: { message: "mất mạng" } }])
    expect(await kiemLaiSauLoiXuat(c.sb, "o-1", loi)).toEqual({ lyDo: "da-co", hd: null })
  })
})

describe("mở lại màn Xuất hàng của đơn đã xuất → sang thẳng tờ đã có", () => {
  it("đơn KHÔNG còn xuất được mà có tờ ghi sổ → id tờ; còn xuất được thì luôn dựng màn xuất (máy chủ quyết)", () => {
    expect(hoaDonThayManXuat("completed", [{ id: "hd-1" }])).toBe("hd-1")
    expect(hoaDonThayManXuat("completed", [])).toBeNull()
    for (const s of DON_CON_XUAT_DUOC) expect(hoaDonThayManXuat(s, [{ id: "hd-1" }]), s).toBeNull()
    // Cùng luật `post_invoice` (mig 125): chỉ hai trạng thái này xuất được.
    expect([...DON_CON_XUAT_DUOC].sort()).toEqual(["partially_invoiced", "submitted"])
    expect(duongTaiHoaDonDaCo("hd-1")).toBe("/pos/hoa-don/hd-1?daXuat=1")
  })
})

describe("chữ trên nút lúc đang ghi sổ", () => {
  it("bình thường / chờ lâu / đang kiểm lại sổ", () => {
    expect(nhanDangGhi({ kiemLai: false, choLau: false })).toBe("Đang ghi sổ…")
    expect(nhanDangGhi({ kiemLai: false, choLau: true })).toBe("Máy chủ chậm — đang chờ, đừng tắt máy…")
    expect(nhanDangGhi({ kiemLai: true, choLau: true })).toBe("Đang kiểm lại hoá đơn…")
    // Báo "chậm" trước khi câu đọc thường đã hết giờ — người dùng biết sớm mà chờ.
    expect(CHO_LAU_MS).toBeLessThan(HET_GIO_MS)
  })
})

describe("các đường xuất nối đủ các mảnh (đọc mã nguồn — hành vi bấm thật ở e2e)", () => {
  const pos = readFileSync("src/components/pos/invoice-screen.tsx", "utf-8")
  const dt = readFileSync("src/components/orders/invoice-editor.tsx", "utf-8")
  const ds = readFileSync("src/app/(dashboard)/orders/page.tsx", "utf-8")
  const moi = readFileSync("src/app/(dashboard)/sales-invoices/new/page.tsx", "utf-8")
  it("POS: lỗi chưa chắc → hỏi lại sổ; 'chua-biet' in như thường, 'da-co' mở tờ + nhắc In; mở lại đơn đã xuất → sang tờ", () => {
    expect(pos).toContain("await kiemLaiSauLoiXuat(createClient(), orderId, e, invoiceId ?? null)")
    expect(pos).toContain('if (kq.lyDo === "chua-biet") {')
    expect(pos).toContain("router.replace(duongTaiHoaDonDaCo(hd.id))")
    expect(pos).toContain("router.replace(duongTaiHoaDonDaCo(daCo))")
    expect(pos).toContain("hoaDonThayManXuat(don.status,")
  })
  it("POS + điện thoại đang ghi sổ: hỏi trước khi rời trang, chữ theo `nhanDangGhi`; POS khoá nút Huỷ", () => {
    for (const s of [pos, dt]) {
      expect(s).toContain('window.addEventListener("beforeunload", chan)')
      expect(s).toContain("nhanDangGhi({ kiemLai, choLau })")
    }
    expect(pos).toContain("disabled={dangLuu}")
  })
  it("điện thoại + Xuất đủ ở danh sách đơn đi cùng luật; màn Xuất hàng điện thoại nói rõ đơn đã xuất", () => {
    expect(dt).toContain("await kiemLaiSauLoiXuat(supabase, orderId, e, reissueOf?.invoiceId ?? null)")
    expect(ds).toContain("await kiemLaiSauLoiXuat(supabase, id, e)")
    expect(moi).toContain("DON_CON_XUAT_DUOC.includes(don.status)")
  })
})
