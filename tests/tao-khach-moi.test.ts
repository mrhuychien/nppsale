/**
 * Chủ nhà 01/10/2026 — màn Thêm khách hàng trên điện thoại: SĐT gán sẵn từ ô tìm · phường xã Hải Phòng sau sáp
 * nhập có tìm · tuyến bắt buộc · khách chưa gán tuyến được nhắc · bấm tạo 2 lần / trùng số → báo "đã có khách
 * hàng", không chuyển trang. Bấm thật: e2e/tao-khach-dien-thoai.spec.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  KhachDaCo, LUA_CHON_PHUONG_XA, chuanHoaSdt, dinhDangSdt, loiKhachMoi, sdtTuTimKiem, taoKhach,
} from "@/lib/customers/tao-khach"
import { WARDS_HAI_PHONG } from "@/lib/constants/wards-hai-phong"
import { lapNhacTuyen, noiDungNhacTuyen } from "@/lib/customers/nhac-tuyen"
import { timXepHang } from "@/lib/search"

vi.mock("@/lib/sell/ref-store", () => ({ lamCuDanhMucBan: () => {} }))
vi.mock("@/lib/cache/nho-nen", () => ({ xoaNhoNen: () => {} }))

describe("SĐT từ ô tìm", () => {
  it("chỉ gán khi ô tìm là số; chuẩn hoá +84 / dấu cách", () => {
    expect(sdtTuTimKiem("0912 345 678")).toBe("0912345678")
    expect(sdtTuTimKiem("+84 912.345.678")).toBe("0912345678")
    expect(sdtTuTimKiem("0912")).toBe("0912")
    expect(sdtTuTimKiem("tạp hoá 09")).toBe("")
    expect(sdtTuTimKiem("Cô Ba")).toBe("")
    expect(sdtTuTimKiem("12")).toBe("")
    expect(chuanHoaSdt("84912345678")).toBe("0912345678")
    expect(dinhDangSdt("0901000001")).toBe("0901 000 001")
  })
})

describe("kiểm form khách mới", () => {
  const du = { store_name: "Tạp hoá Bà Hai", owner_name: "Hai", phone: "0901000001", address: "1 Lê Lợi", ward: "", channel: "T2" }
  it("đủ thì không lỗi; TUYẾN BẮT BUỘC", () => {
    expect(loiKhachMoi(du)).toEqual({})
    expect(loiKhachMoi({ ...du, channel: "" }).channel).toBe("Chọn tuyến bán hàng")
  })
  it("SĐT phải 10 số bắt đầu 0", () => {
    expect(loiKhachMoi({ ...du, phone: "" }).phone).toBe("Nhập số điện thoại")
    expect(loiKhachMoi({ ...du, phone: "091234" }).phone).toMatch(/10 số/)
  })
})

describe("phường / xã Hải Phòng sau sáp nhập", () => {
  it("114 đơn vị: 45 phường · 67 xã · 2 đặc khu, không trùng", () => {
    expect(WARDS_HAI_PHONG.length).toBe(114)
    expect(new Set(WARDS_HAI_PHONG).size).toBe(114)
    expect(WARDS_HAI_PHONG.filter((w) => w.startsWith("Phường ")).length).toBe(45)
    expect(WARDS_HAI_PHONG.filter((w) => w.startsWith("Xã ")).length).toBe(67)
    expect(WARDS_HAI_PHONG.filter((w) => w.startsWith("Đặc khu ")).length).toBe(2)
    // Có cả phần Hải Dương cũ; đơn vị đã bỏ ("Cát Bà") không còn.
    expect(WARDS_HAI_PHONG).toContain("Phường Hải Dương")
    expect(WARDS_HAI_PHONG).toContain("Đặc khu Cát Hải")
    expect(WARDS_HAI_PHONG as readonly string[]).not.toContain("Cát Bà")
  })
  it("tìm không dấu: 'hong bang' ra Phường Hồng Bàng đầu tiên", () => {
    const kq = timXepHang(LUA_CHON_PHUONG_XA, "hong bang", (o) => [o.label, o.keywords]).ketQua
    expect(kq[0]?.id).toBe("Phường Hồng Bàng")
  })
})

/** Supabase giả: rpc search_customer_dupes + insert customers. */
function sbGia(o: { trung?: Array<{ id: string; store_name: string; phone: string }>; loiGhi?: { code: string; message: string } }) {
  const ghi: unknown[] = []
  let goiRpc = 0
  const sb = {
    rpc: async () => { goiRpc++; return { data: goiRpc > 1 && o.loiGhi ? [{ id: "k9", store_name: "Đã có", phone: "0912345678" }] : o.trung ?? [], error: null } },
    from: (t: string) => ({
      insert: (row: unknown) => {
        ghi.push({ t, row })
        return { select: () => ({ single: async () => (o.loiGhi ? { data: null, error: o.loiGhi } : { data: { id: "moi" }, error: null }) }) }
      },
    }),
  }
  return { sb: sb as never, ghi }
}

describe("taoKhach — chống tạo trùng / bấm 2 lần", () => {
  const user = { id: "u1", org_id: "o1", role: "owner" }
  it("trùng số (kể cả khách người khác phụ trách) → KhachDaCo, KHÔNG ghi", async () => {
    const { sb, ghi } = sbGia({ trung: [{ id: "k1", store_name: "Tạp hoá Cô Ba", phone: "0912 345 678" }] })
    await expect(taoKhach(sb, user, { phone: "0912345678" })).rejects.toBeInstanceOf(KhachDaCo)
    expect(ghi).toHaveLength(0)
  })
  it("lần bấm thứ hai lọt qua kiểm trước → ràng buộc UNIQUE (23505) cũng ra KhachDaCo", async () => {
    const { sb } = sbGia({ loiGhi: { code: "23505", message: "duplicate key value violates unique constraint" } })
    const e = await taoKhach(sb, user, { phone: "0912345678" }).catch((x) => x)
    expect(e).toBeInstanceOf(KhachDaCo)
    expect((e as KhachDaCo).message).toContain("Đã có khách hàng dùng số 0912 345 678")
  })
  it("không trùng → ghi SĐT đã chuẩn hoá, kèm org + người tạo", async () => {
    const { sb, ghi } = sbGia({})
    const kq = await taoKhach(sb, user, { phone: "0912 345 678", store_name: "A" })
    expect(kq.id).toBe("moi")
    expect(ghi[0]).toMatchObject({ t: "customers", row: { phone: "0912345678", org_id: "o1", created_by: "u1" } })
  })
})

describe("nhắc khách chưa gán tuyến", () => {
  const now = Date.parse("2026-10-01T01:00:00Z")
  const k = (id: string, x: Partial<{ channel: string | null; reminderSentAt: string | null; repId: string | null }> = {}) =>
    ({ id, storeName: `KH ${id}`, channel: null, reminderSentAt: null, repId: null, ...x })
  it("có tuyến thì thôi; NVBH phụ trách nhận khách của mình; chưa ai phụ trách → chủ NPP / quản lý", () => {
    const p = lapNhacTuyen([k("a", { repId: "nv1" }), k("b", { channel: "T2", repId: "nv1" }), k("c"), k("d", { channel: "  " , repId: "nv2" })], ["chu"], now)
    const theo = Object.fromEntries(p.theoNguoi.map((g) => [g.userId, g.khach.map((x) => x.id)]))
    expect(theo).toEqual({ nv1: ["a"], chu: ["c"], nv2: ["d"] })
  })
  it("hạ nhiệt 3 ngày; mốc hỏng coi như chưa nhắc", () => {
    const p = lapNhacTuyen([
      k("a", { repId: "nv", reminderSentAt: "2026-09-30T00:00:00Z" }),
      k("b", { repId: "nv", reminderSentAt: "2026-09-20T00:00:00Z" }),
      k("c", { repId: "nv", reminderSentAt: "rác" }),
    ], [], now)
    expect(p.hoaNhiet).toBe(1)
    expect(p.theoNguoi[0].khach.map((x) => x.id)).toEqual(["b", "c"])
  })
  it("nội dung thông báo", () => {
    expect(noiDungNhacTuyen([k("1"), k("2"), k("3"), k("4")]).title).toBe("4 khách hàng chưa gán tuyến")
    expect(noiDungNhacTuyen([k("1"), k("2"), k("3"), k("4")]).body).toContain("và 1 khách nữa")
  })
})

describe("nối dây", () => {
  const read = (f: string) => readFileSync(f, "utf8")
  it("điện thoại vào màn mới, SĐT từ ?sdt=; máy tính gán SĐT vào form", () => {
    const s = read("src/app/(dashboard)/customers/new/page.tsx")
    expect(s).toContain('sdtTuTimKiem(params.get("sdt"))')
    expect(s).toContain("<TaoKhachDienThoai groups={groups} nextHref={next} sdtBanDau={sdtTim} />")
    expect(s).toContain("initialPhone={sdtDaTim}")
  })
  it("tìm không ra → nút tạo khách mới kèm số (danh sách khách + chọn khách /sell)", () => {
    expect(read("src/app/(dashboard)/customers/page.tsx")).toContain("`/customers/new?sdt=${sdtTim}`")
    expect(read("src/app/(dashboard)/sell/customer/page.tsx")).toContain("`/customers/new?next=/sell/customer${sdtTim ? `&sdt=${sdtTim}` : \"\"}`")
  })
  it("form máy tính: tuyến bắt buộc, chống bấm 2 lần, tạo qua taoKhach", () => {
    const s = read("src/components/customers/customer-form.tsx")
    expect(s).toContain("if (!form.channel) {")
    expect(s).toContain("if (dangLuu.current) return")
    expect(s).toContain("await taoKhach(supabase, user, payload)")
  })
  it("màn điện thoại: khoá chống bấm 2 lần, trùng số ở lại màn", () => {
    const s = read("src/components/customers/tao-khach-dien-thoai.tsx")
    expect(s).toContain("if (khoa.current) return")
    expect(s).toMatch(/if \(e instanceof KhachDaCo\) \{\s*\/\/[^\n]*\n\s*setTrung\(e\)/)
  })
  it("cron hằng ngày gọi nhắc tuyến; mig 221 thêm loại thông báo + cột hạ nhiệt", () => {
    expect(read("src/app/api/cron/daily/route.ts")).toContain('runJob("customer-route-reminders", routeReminders, req)')
    const m = read("supabase/migrations/221_nhac_khach_chua_tuyen.sql")
    expect(m).toContain("ADD COLUMN IF NOT EXISTS route_reminder_sent_at timestamptz")
    for (const t of ["'customer_photo_missing'", "'return_completed'", "'customer_route_missing'", "'info'"]) expect(m).toContain(t)
    expect(m).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
