import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "Làm nốt" (đề xuất 1 của đợt tốc độ): POS mở tab mới là tải lại cả ~2.500 mặt hàng + bảng giá
 *   + khách. Nay sản phẩm dùng lại bản lưu trên máy khi khớp ĐỦ số phiên danh mục (mig 209) + người + vai + công ty được
 *   làm; khách + tồn luôn đọc mới. Dính tới GIÁ nên mọi chốt chạy mã thật trên Supabase giả.
 */
const nho = vi.hoisted(() => ({
  ban: null as null | Record<string, unknown>,
  ghi: [] as Array<{ data: { products: unknown[]; customers: unknown[] }; khoa: unknown }>,
}))
vi.mock("@/lib/offline/ref-cache", () => ({
  getCachedOrderRefData: async () => nho.ban,
  cacheOrderRefData: async (data: { products: unknown[]; customers: unknown[] }, khoa: unknown) => {
    nho.ghi.push({ data, khoa })
  },
}))

import { dungLaiSanPham, loadSellRefData, peekCachedSellRefData } from "@/lib/sell/ref-data"
import { sanTaiDanhMuc } from "@/hooks/use-nguoi-tai-danh-muc"
import { laDoiNguoi, xoaNhoTheoNguoi } from "@/lib/cache/theo-nguoi"
import { loadSellRefDataShared, peekSellRefData } from "@/lib/sell/ref-store"
import { nhoNen } from "@/lib/cache/nho-nen"

const CHU = { uid: "u-chu", vai: "owner" }
const NV = { uid: "u-nv", vai: "sales" }
const SP_LUU = [{ id: "sp-luu", status: "active", name: "Bia (bản lưu)" }]

function bang(phien = 7) {
  return {
    customers: nRows(3, () => ({ status: "active", store_name: "Tạp hoá" })),
    products: nRows(4, () => ({ status: "active", name: "Mì gói" })),
    batches: [],
    danh_muc_ban_phien: [{ id: 1, phien }],
    user_suppliers: [
      { user_id: "u-nv", supplier_id: "ncc-b" },
      { user_id: "u-nv", supplier_id: "ncc-a" },
    ],
  }
}
const banLuu = (khoa: Record<string, unknown>) => ({ customers: [], products: SP_LUU, stockByProduct: {}, cachedAt: "2026-10-22T00:00:00Z", ...khoa })
const daHoi = (calls: Array<{ table: string }>, t: string) => calls.some((c) => c.table === t)

beforeEach(() => {
  nho.ban = null
  nho.ghi = []
  /* Node 22 có `navigator` nhưng không có `onLine` — không giả thì loader tưởng mất mạng. */
  vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => vi.unstubAllGlobals())

describe("dungLaiSanPham — khớp ĐỦ mới dùng lại", () => {
  const khoa = { phien: 7, uid: "u", vai: "owner", ncc: "*" }
  const ban = { customers: [], products: [{}], stockByProduct: {}, cachedAt: "x", ...khoa }
  it("khớp đủ → dùng lại", () => expect(dungLaiSanPham(ban, khoa)).toBe(true))
  it.each([
    ["số phiên đã tăng (hàng / giá / đơn vị đổi)", { phien: 8 }],
    ["người khác trên cùng máy", { uid: "v" }],
    ["đổi vai", { vai: "sales" }],
    ["đổi công ty được làm", { ncc: "ncc-a" }],
  ])("%s → tải lại", (_, doi) => expect(dungLaiSanPham(ban, { ...khoa, ...doi })).toBe(false))
  it("bản lưu cũ chưa có khoá / không biết khoá / bản rỗng → tải lại", () => {
    expect(dungLaiSanPham({ customers: [], products: [{}], stockByProduct: {}, cachedAt: "x" }, khoa)).toBe(false)
    expect(dungLaiSanPham(ban, null)).toBe(false)
    expect(dungLaiSanPham({ ...ban, products: [] }, khoa)).toBe(false)
  })
})

describe("loadSellRefData — sản phẩm dùng lại bản lưu, khách + tồn luôn mới", () => {
  it("khớp khoá → KHÔNG hỏi bảng sản phẩm; khách vẫn đọc mới; bản lưu ghi lại kèm khoá", async () => {
    nho.ban = banLuu({ phien: 7, uid: CHU.uid, vai: CHU.vai, ncc: "*" })
    const { client, calls } = fakePostgrest(bang(7))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "products")).toBe(false)
    expect(r.sanPhamNho).toBe(true)
    expect(r.products).toEqual(SP_LUU)
    expect(daHoi(calls, "customers")).toBe(true)
    expect(r.customers).toHaveLength(3)
    expect(nho.ghi.at(-1)?.khoa).toEqual({ phien: 7, uid: CHU.uid, vai: CHU.vai, ncc: "*" })
  })

  it("số phiên đã tăng → tải lại sản phẩm, bản lưu mang số MỚI", async () => {
    nho.ban = banLuu({ phien: 6, uid: CHU.uid, vai: CHU.vai, ncc: "*" })
    const { client, calls } = fakePostgrest(bang(7))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "products")).toBe(true)
    expect(r.sanPhamNho).toBe(false)
    expect(r.products).toHaveLength(4)
    expect(nho.ghi.at(-1)?.khoa).toMatchObject({ phien: 7 })
  })

  it("NVBH: khoá gồm công ty được làm (đã xếp) — đổi phân công là tải lại", async () => {
    /* Máy chủ trả phân công theo thứ tự nào cũng phải ra CÙNG một khoá — thử đủ 6 hoán vị. */
    const ncc = ["ncc-c", "ncc-a", "ncc-b"]
    const hoanVi = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    for (const hv of hoanVi) {
      nho.ban = banLuu({ phien: 7, uid: NV.uid, vai: NV.vai, ncc: "ncc-a,ncc-b,ncc-c" })
      const a = fakePostgrest({ ...bang(7), user_suppliers: hv.map((i) => ({ user_id: NV.uid, supplier_id: ncc[i] })) })
      expect((await loadSellRefData(a.client, NV)).sanPhamNho, hv.join("")).toBe(true)
    }

    nho.ban = banLuu({ phien: 7, uid: NV.uid, vai: NV.vai, ncc: "ncc-a" })
    const b = fakePostgrest(bang(7))
    expect((await loadSellRefData(b.client, NV)).sanPhamNho).toBe(false)
    expect(daHoi(b.calls, "products")).toBe(true)
  })

  it("bản lưu của người khác → không dùng", async () => {
    nho.ban = banLuu({ phien: 7, uid: "u-khac", vai: CHU.vai, ncc: "*" })
    const { client, calls } = fakePostgrest(bang(7))
    expect((await loadSellRefData(client, CHU)).sanPhamNho).toBe(false)
    expect(daHoi(calls, "products")).toBe(true)
  })

  it("không biết người → tải đủ như cũ, bản lưu KHÔNG mang khoá (không dùng lại được)", async () => {
    nho.ban = banLuu({ phien: 7, uid: CHU.uid, vai: CHU.vai, ncc: "*" })
    const { client, calls } = fakePostgrest(bang(7))
    const r = await loadSellRefData(client, null)
    expect(daHoi(calls, "products")).toBe(true)
    expect(r.sanPhamNho).toBe(false)
    expect(nho.ghi.at(-1)?.khoa ?? null).toBeNull()
  })

  it("không đọc được số phiên (sổ chưa chạy 209 / lỗi) → tải lại, không mang khoá", async () => {
    nho.ban = banLuu({ phien: 7, uid: CHU.uid, vai: CHU.vai, ncc: "*" })
    const { client, calls } = fakePostgrest(bang(7), { failOn: (c) => c.table === "danh_muc_ban_phien" })
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "products")).toBe(true)
    expect(r.sanPhamNho).toBe(false)
    expect(nho.ghi.at(-1)?.khoa ?? null).toBeNull()
  })

  /**
   * ⚠ SỐ PHIÊN ĐỌC TRƯỚC SẢN PHẨM. Song song mà câu sản phẩm về trước, giá đổi chen giữa, thì bản cũ mang số MỚI — lần
   *   sau khớp khoá, dùng mãi bản giá cũ. Giữ câu số phiên lại: câu sản phẩm chưa được đi.
   */
  it("câu sản phẩm CHỜ số phiên về rồi mới đi", async () => {
    const { client, calls } = fakePostgrest(bang(7))
    let tha!: () => void
    const giu = new Promise<void>((r) => (tha = r))
    const boc = {
      ...client,
      from(t: string) {
        const q = (client as { from: (t: string) => Record<string, unknown> }).from(t)
        if (t !== "danh_muc_ban_phien") return q
        const goc = q.maybeSingle as () => PromiseLike<unknown>
        q.maybeSingle = () => ({ then: (ok: (v: unknown) => unknown, loi?: (e: unknown) => unknown) => giu.then(() => goc.call(q)).then(ok, loi) })
        return q
      },
    }
    const dang = loadSellRefData(boc, CHU)
    await new Promise((r) => setTimeout(r, 20))
    expect(daHoi(calls, "customers")).toBe(true)
    expect(daHoi(calls, "products")).toBe(false)
    tha()
    const r = await dang
    expect(daHoi(calls, "products")).toBe(true)
    expect(r.products).toHaveLength(4)
  })
})

describe("bản lưu trên máy của người khác không hiện ra", () => {
  it("peekCachedSellRefData: khác người → null; đúng người / chưa biết người → hiện", async () => {
    nho.ban = banLuu({ phien: 7, uid: "u-a", vai: "owner", ncc: "*" })
    expect(await peekCachedSellRefData("u-b")).toBeNull()
    expect((await peekCachedSellRefData("u-a"))?.products).toEqual(SP_LUU)
    expect((await peekCachedSellRefData(null))?.products).toEqual(SP_LUU)
    expect((await peekCachedSellRefData("u-a"))?.phien).toBe(7)
  })
})

describe("sanTaiDanhMuc — lúc nào bắt đầu tải", () => {
  const goc = { matMang: false, dangXacThuc: false, coPhien: true, coHoSo: true, hetCho: false }
  it("có phiên + hồ sơ → tải (kèm người)", () => expect(sanTaiDanhMuc(goc)).toBe(true))
  it("đang xác thực → chờ", () => expect(sanTaiDanhMuc({ ...goc, dangXacThuc: true })).toBe(false))
  it("có phiên, hồ sơ chưa về → chờ; quá hạn chờ → tải (không dùng lại)", () => {
    expect(sanTaiDanhMuc({ ...goc, coHoSo: false })).toBe(false)
    expect(sanTaiDanhMuc({ ...goc, coHoSo: false, hetCho: true })).toBe(true)
  })
  it("không có phiên → tải (để màn nói ra chuyện gì); mất mạng → ngay (bản lưu)", () => {
    expect(sanTaiDanhMuc({ ...goc, coPhien: false, coHoSo: false })).toBe(true)
    expect(sanTaiDanhMuc({ ...goc, matMang: true, dangXacThuc: true, coHoSo: false })).toBe(true)
  })
})

describe("đổi người trên cùng tab → xoá danh mục nhớ trong RAM", () => {
  it("laDoiNguoi: sự kiện phiên đầu / cùng người → không; đăng xuất / người khác → có", () => {
    expect(laDoiNguoi(undefined, "a")).toBe(false)
    expect(laDoiNguoi("a", "a")).toBe(false)
    expect(laDoiNguoi("a", null)).toBe(true)
    expect(laDoiNguoi(null, "b")).toBe(true)
    expect(laDoiNguoi("a", "b")).toBe(true)
  })

  it("xoaNhoTheoNguoi: danh mục bán trong RAM + danh mục nền của ô lọc đều mất", async () => {
    await loadSellRefDataShared(async () => ({ customers: [], products: [], stockByProduct: {}, source: "server", warnings: [] }))
    expect(peekSellRefData()).not.toBeNull()
    const doc = vi.fn(async () => ({ data: [1], error: null }))
    await nhoNen("nen:khach-nhe", doc)
    xoaNhoTheoNguoi()
    expect(peekSellRefData()).toBeNull()
    await nhoNen("nen:khach-nhe", doc)
    expect(doc).toHaveBeenCalledTimes(2)
  })
})
