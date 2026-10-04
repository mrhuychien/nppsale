/**
 * ĐỘI TEST "Danh mục, Quyền & Tạo nhanh" — logic thuần TS.
 *
 * Phủ: ma trận quyền (hasPermission / feature / quyền riêng), cửa vào trang (nav-permission), tạo nhanh
 * (duocTaoNhanh khớp RLS đã đo ở scripts/sql/doi-test/danh-muc-quyen-rls.sql), dòng "+ Tạo mới" (tao-moi),
 * chữ ban đầu (chuBanDauKhach / chuBanDauTuyen), gopVuaTao, taoKhach (chống trùng / bấm hai lần / phân công),
 * lọc khách (loc-nhanh, loc-nhan-vien), tìm kiếm không dấu (timXepHang, viValueKey = khoa_tim SQL),
 * nhân viên nghỉ việc (nghi-viec), và chốt luật mig 166 trên các migration.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import path from "path"
import {
  hasPermission,
  hasFeaturePermission,
  canAccessModule,
  rowsToCache,
  setPermissionsCache,
  setUserOverrides,
  xemDuocGiaVon,
  duocXuatFile,
  locBienThe,
  ROLES,
  type Role,
} from "@/lib/permissions"
import { duocVaoTrang, canEnterHref, canSeeHref, laManLuongCu, mucChaCua } from "@/lib/nav/nav-permission"
import { duocTaoNhanh, NHAN_TAO_NHANH, type LoaiTaoNhanh } from "@/lib/tao-nhanh/quyen"
import { gopVuaTao } from "@/lib/tao-nhanh/vua-tao"
import { nhanTaoMoi, conTroToiDa, dongTaoDangChon } from "@/lib/ui/tao-moi"
import {
  chuBanDauKhach,
  chuanHoaSdt,
  sdtTuTimKiem,
  dinhDangSdt,
  laSdtHopLe,
  loiKhachMoi,
  coLoi,
  taoKhach,
  KhachDaCo,
} from "@/lib/customers/tao-khach"
import { chuBanDauTuyen } from "@/lib/customers/tuyen"
import { chonNv, CHUA_PHAN_CONG } from "@/lib/customers/loc-nhan-vien"
import { locDanhSachMa, catTrangMa, xepTheoMa } from "@/lib/customers/loc-nhanh"
import { timXepHang, viValueKey, viMatchAllWords, viQueryWords, chiMucTim, locXepHang } from "@/lib/search"
import { trangThaiNv, chonDuocNv, tomTatChungTu, xoaHanDuoc, loiNhanVien } from "@/lib/users/nghi-viec"

afterEach(() => {
  setPermissionsCache(null)
  setUserOverrides(null)
})

/* ───────────────────────── 1. Ma trận quyền mặc định ───────────────────────── */
describe("Ma trận quyền mặc định khớp RLS đã đo trên Postgres", () => {
  // RLS (pg_policies, đo ở danh-muc-quyen-rls.sql 3.xx): ai GHI được danh mục nào.
  const RLS_GHI: Record<string, Role[]> = {
    customers: ["owner", "manager", "sales"],
    products: ["owner", "manager"],
  }
  it.each(ROLES)("customers.create của %s trùng RLS INSERT customers", (r) => {
    expect(hasPermission(r, "customers", "create")).toBe(RLS_GHI.customers.includes(r))
  })
  it.each(ROLES)("products.create của %s trùng RLS products (owner/manager)", (r) => {
    expect(hasPermission(r, "products", "create")).toBe(RLS_GHI.products.includes(r))
  })
  it("chủ NPP luôn được, kể cả ô không khai", () => {
    expect(hasPermission("owner", "settings", "approve")).toBe(true)
    expect(hasFeaturePermission("owner", "khong.co.that", "settings", "delete")).toBe(true)
  })
  it("vai đã bỏ (driver) bị từ chối ở mọi ô", () => {
    expect(hasPermission("driver", "orders", "read")).toBe(false)
    expect(canAccessModule("driver", "orders")).toBe(false)
  })
  it("NVBH: chỉ bán hàng — không kho, không sản phẩm, công nợ chỉ XEM (chủ nhà 26/09/2026)", () => {
    expect(canAccessModule("sales", "inventory")).toBe(false)
    expect(canAccessModule("sales", "products")).toBe(false)
    expect(hasPermission("sales", "receivables", "read")).toBe(true)
    expect(hasPermission("sales", "receivables", "create")).toBe(false)
    expect(hasPermission("sales", "settings", "read")).toBe(false)
  })
  it("thủ kho không có khách hàng, có kho tạo / sửa", () => {
    expect(canAccessModule("warehouse", "customers")).toBe(false)
    expect(hasPermission("warehouse", "inventory", "create")).toBe(true)
    expect(hasPermission("warehouse", "returns", "approve")).toBe(true)
  })
  it("quản lý lập phiếu thu được (mig 215), kế toán không tạo khách", () => {
    expect(hasPermission("manager", "receivables", "create")).toBe(true)
    expect(hasPermission("accountant", "customers", "create")).toBe(false)
  })
  it("giá vốn: NVBH không xem, các vai khác xem; quyền riêng đè lên vai", () => {
    expect(xemDuocGiaVon("sales")).toBe(false)
    expect(xemDuocGiaVon("warehouse")).toBe(true)
    expect(xemDuocGiaVon(null)).toBe(false)
    setUserOverrides({ "inventory.cost.read": true })
    expect(xemDuocGiaVon("sales")).toBe(true)
    setUserOverrides({ "inventory.cost.read": false })
    expect(xemDuocGiaVon("manager")).toBe(false)
    expect(xemDuocGiaVon("owner")).toBe(true)
  })
  it("màn con có giá vốn bị lọc khỏi NVBH", () => {
    const ds = [{ key: "overview" }, { key: "profit" }, { key: "employee" }, { key: "stock_value" }]
    expect(locBienThe("sales", ds).map((x) => x.key)).toEqual(["overview"])
    expect(locBienThe("manager", ds)).toHaveLength(4)
  })
  it("xuất file: NVBH không xuất danh sách khách; quyền riêng mở được", () => {
    expect(duocXuatFile("sales", "customers")).toBe(false)
    expect(duocXuatFile("accountant", "customers")).toBe(true)
    setUserOverrides({ "customers.export": true })
    expect(duocXuatFile("sales", "customers")).toBe(true)
  })
  it("rowsToCache: tắt một ô của quản lý, ô khác giữ mặc định", () => {
    setPermissionsCache(rowsToCache([{ role: "manager", module: "customers", action: "create", allowed: false }]))
    expect(hasPermission("manager", "customers", "create")).toBe(false)
    expect(hasPermission("manager", "customers", "update")).toBe(true)
    expect(hasPermission("sales", "customers", "create")).toBe(true)
    setPermissionsCache(null)
    expect(hasPermission("manager", "customers", "create")).toBe(true)
  })
  it("rowsToCache: mở thêm ô cho thủ kho + bỏ qua dòng của vai không tồn tại", () => {
    setPermissionsCache(
      rowsToCache([
        { role: "warehouse", module: "customers", action: "read", allowed: true },
        { role: "driver", module: "orders", action: "read", allowed: true },
      ])
    )
    expect(canAccessModule("warehouse", "customers")).toBe(true)
    expect(hasPermission("driver", "orders", "read")).toBe(false)
  })
})

/* ───────────────────────── 2. Tạo nhanh ───────────────────────── */
describe("duocTaoNhanh — ai thấy dòng '+ Tạo … mới'", () => {
  // Kỳ vọng = quyền ghi thật ở RLS (đo trên Postgres): khách owner/manager/sales; tuyến owner/manager;
  // sản phẩm owner/manager; NCC theo nút ở màn NCC = inventory.create (owner/warehouse — RLS cho cả manager).
  const KY_VONG: Record<LoaiTaoNhanh, Role[]> = {
    khach: ["owner", "manager", "sales"],
    tuyen: ["owner", "manager"],
    "san-pham": ["owner", "manager"],
    ncc: ["owner", "warehouse"],
  }
  for (const loai of Object.keys(KY_VONG) as LoaiTaoNhanh[]) {
    it.each(ROLES)(`${loai} — vai %s`, (r) => {
      expect(duocTaoNhanh(r, loai)).toBe(KY_VONG[loai].includes(r))
    })
  }
  it("chưa có vai → không hiện gì", () => {
    for (const l of Object.keys(KY_VONG) as LoaiTaoNhanh[]) expect(duocTaoNhanh(null, l)).toBe(false)
    expect(duocTaoNhanh(undefined, "khach")).toBe(false)
  })
  it("ma trận tuỳ chỉnh tắt customers.create của NVBH → NVBH không còn dòng tạo khách", () => {
    setPermissionsCache(rowsToCache([{ role: "sales", module: "customers", action: "create", allowed: false }]))
    expect(duocTaoNhanh("sales", "khach")).toBe(false)
    expect(duocTaoNhanh("sales", "tuyen")).toBe(false)
  })
  it("nhãn đủ 4 loại", () => {
    expect(NHAN_TAO_NHANH).toEqual({
      khach: "Tạo khách hàng mới",
      ncc: "Tạo nhà cung cấp mới",
      "san-pham": "Tạo sản phẩm mới",
      tuyen: "Tạo tuyến mới",
    })
  })
})

describe("tao-moi — dòng tạo mới ở ô tìm", () => {
  it("nhãn kèm chữ đang gõ đã trim, rỗng thì chỉ nhãn", () => {
    expect(nhanTaoMoi("Tạo khách hàng mới", "  Cô Ba ")).toBe("Tạo khách hàng mới “Cô Ba”")
    expect(nhanTaoMoi("Tạo khách hàng mới", "   ")).toBe("Tạo khách hàng mới")
  })
  it("con trỏ tối đa: có dòng tạo = soKetQua, không thì soKetQua−1 (không âm)", () => {
    expect(conTroToiDa(3, true)).toBe(3)
    expect(conTroToiDa(3, false)).toBe(2)
    expect(conTroToiDa(0, false)).toBe(0)
    expect(conTroToiDa(0, true)).toBe(0)
  })
  it("Enter trên dòng tạo mới khi con trỏ đứng ở đó", () => {
    const co = { coTaoMoi: true, active: 2, soKetQua: 2, choGoTay: false, chu: "abc", daBamXuong: false }
    expect(dongTaoDangChon(co)).toBe(true)
    expect(dongTaoDangChon({ ...co, active: 1 })).toBe(false)
    expect(dongTaoDangChon({ ...co, coTaoMoi: false })).toBe(false)
  })
  it("ô gõ tự do không kết quả: Enter giữ chữ gõ tay, chỉ bấm ↓ mới chọn dòng tạo", () => {
    const o = { coTaoMoi: true, active: 0, soKetQua: 0, choGoTay: true, chu: "NCC lạ", daBamXuong: false }
    expect(dongTaoDangChon(o)).toBe(false)
    expect(dongTaoDangChon({ ...o, daBamXuong: true })).toBe(true)
    expect(dongTaoDangChon({ ...o, chu: "  " })).toBe(true)
    expect(dongTaoDangChon({ ...o, choGoTay: false })).toBe(true)
  })
})

describe("chuBanDauKhach / chuBanDauTuyen — chữ đang tìm đi vào ô nào", () => {
  it.each([
    ["0912 345 678", { store_name: "", phone: "0912345678" }],
    ["+84 912 345 678", { store_name: "", phone: "0912345678" }],
    ["84912345678", { store_name: "", phone: "0912345678" }],
    ["091", { store_name: "", phone: "091" }],
    ["09", { store_name: "09", phone: "" }],
    ["Cô Ba", { store_name: "Cô Ba", phone: "" }],
    ["Tạp hoá 24h", { store_name: "Tạp hoá 24h", phone: "" }],
    ["  ", { store_name: "", phone: "" }],
    [null, { store_name: "", phone: "" }],
    ["0912.345.678-99", { store_name: "", phone: "09123456789" }],
  ] as const)("%s", (vao, ra) => {
    expect(chuBanDauKhach(vao as string | null)).toEqual(ra)
  })
  it("SĐT quá dài cắt còn 11 số", () => {
    expect(sdtTuTimKiem("0912345678999")).toBe("09123456789")
  })
  it.each([
    ["t5", { code: "T5", name: "" }],
    ["HORECA", { code: "HORECA", name: "" }],
    ["tuyen_a-1", { code: "TUYEN_A-1", name: "" }],
    ["Thứ Năm", { code: "", name: "Thứ Năm" }],
    ["thu nam", { code: "", name: "thu nam" }],
    ["ABCDEFGHIJKLM", { code: "", name: "ABCDEFGHIJKLM" }],
    ["", { code: "", name: "" }],
    [undefined, { code: "", name: "" }],
  ] as const)("tuyến %s", (vao, ra) => {
    expect(chuBanDauTuyen(vao as string | undefined)).toEqual(ra)
  })
})

describe("SĐT + kiểm form khách mới", () => {
  it("chuẩn hoá / định dạng / hợp lệ", () => {
    expect(chuanHoaSdt("+84 (912) 345-678")).toBe("0912345678")
    expect(chuanHoaSdt("")).toBe("")
    expect(dinhDangSdt("0901000001")).toBe("0901 000 001")
    expect(dinhDangSdt("+84901000001")).toBe("0901 000 001")
    expect(laSdtHopLe("0901000001")).toBe(true)
    expect(laSdtHopLe("901000001")).toBe(false)
    expect(laSdtHopLe("09010000011")).toBe(false)
  })
  const du = { store_name: "A", owner_name: "B", phone: "0901000001", address: "C", ward: "", channel: "GT" }
  it("đủ ô → không lỗi", () => {
    expect(coLoi(loiKhachMoi(du))).toBe(false)
  })
  it("tuyến BẮT BUỘC (chủ nhà 01/10/2026)", () => {
    expect(loiKhachMoi({ ...du, channel: "  " })).toEqual({ channel: "Chọn tuyến bán hàng" })
  })
  it("thiếu hết → 5 lỗi; SĐT sai dạng có câu riêng", () => {
    const e = loiKhachMoi({ store_name: "", owner_name: " ", phone: "", address: "", ward: "", channel: "" })
    expect(Object.keys(e).sort()).toEqual(["address", "channel", "owner_name", "phone", "store_name"])
    expect(loiKhachMoi({ ...du, phone: "12345" }).phone).toBe("Số điện thoại gồm 10 số, bắt đầu bằng 0")
  })
})

describe("gopVuaTao — đưa bản ghi vừa tạo vào danh mục của màn đang làm", () => {
  const ds = [{ id: "a", t: 1 }, { id: "b", t: 2 }]
  it("thêm vào cuối, trả MẢNG MỚI (để chỉ mục tìm nhớ theo mảng không cũ)", () => {
    const kq = gopVuaTao(ds, [{ id: "c", t: 3 }])
    expect(kq.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(kq).not.toBe(ds)
    expect(ds).toHaveLength(2)
  })
  it("đã có cùng id → giữ nguyên chính mảng cũ (không nhân đôi khi bấm hai lần)", () => {
    expect(gopVuaTao(ds, [{ id: "a", t: 9 }])).toBe(ds)
    expect(gopVuaTao(ds, [])).toBe(ds)
  })
  it("trộn: chỉ thêm id chưa có", () => {
    expect(gopVuaTao(ds, [{ id: "b", t: 0 }, { id: "d", t: 4 }]).map((x) => x.id)).toEqual(["a", "b", "d"])
  })
  it("tìm ngay ra mã vừa tạo trong danh mục đã có chỉ mục nhớ (nho)", () => {
    const sp = [{ id: "1", sku: "SP001", name: "Sữa hộp" }]
    expect(timXepHang(sp, "nuoc cam", (x) => [x.sku, x.name], { nho: "t-gop" }).ketQua).toHaveLength(0)
    const sau = gopVuaTao(sp, [{ id: "2", sku: "SP002", name: "Nước cam ép" }])
    expect(timXepHang(sau, "nuoc cam", (x) => [x.sku, x.name], { nho: "t-gop" }).ketQua.map((x) => x.id)).toEqual(["2"])
  })
})

/* ───────────────────────── 3. taoKhach với Supabase giả ───────────────────────── */
type Goi = { loai: string; bang?: string; ham?: string; du_lieu?: unknown }
function sbGia(o: {
  trung?: Array<{ id: string; store_name: string; phone: string | null }>
  loiInsert?: Array<{ code?: string; message: string } | null>
  claim?: { data?: unknown; error?: { message: string } | null }
}) {
  const goi: Goi[] = []
  let lanInsert = 0
  const sb = {
    rpc: vi.fn(async (ham: string, args: unknown) => {
      goi.push({ loai: "rpc", ham, du_lieu: args })
      if (ham === "search_customer_dupes") return { data: o.trung ?? [], error: null }
      if (ham === "claim_customer_for_me") return { data: o.claim?.data ?? { status: "claimed", role: "primary" }, error: o.claim?.error ?? null }
      return { data: null, error: { message: "không có hàm" } }
    }),
    from: (bang: string) => ({
      insert: (row: unknown) => {
        goi.push({ loai: "insert", bang, du_lieu: JSON.parse(JSON.stringify(row)) })
        const loi = o.loiInsert?.[lanInsert++] ?? null
        return {
          select: () => ({
            single: async () => (loi ? { data: null, error: loi } : { data: { id: "kh-moi" }, error: null }),
          }),
        }
      },
    }),
  }
  return { sb: sb as unknown as Parameters<typeof taoKhach>[0], goi }
}

describe("taoKhach — tạo khách mới (chống trùng, bấm hai lần, phân công)", () => {
  const nv = { id: "u-dung", org_id: "org-a", role: "sales" }
  const payload = { store_name: "Tạp hoá Cô Ba", owner_name: "Ba", phone: "+84 912 345 678", address: "X", channel: "GT" }

  it("NVBH: ghi SĐT đã chuẩn hoá + org_id + created_by, rồi tự nhận khách (claim)", async () => {
    const { sb, goi } = sbGia({})
    const kq = await taoKhach(sb, nv, payload)
    expect(kq).toEqual({ id: "kh-moi", ghiChu: "Đã phân công cho bạn (phụ trách chính).", phanCongLoi: false })
    const ins = goi.find((g) => g.loai === "insert")!
    expect(ins.bang).toBe("customers")
    expect(ins.du_lieu).toMatchObject({ phone: "0912345678", org_id: "org-a", created_by: "u-dung", store_name: "Tạp hoá Cô Ba" })
    expect(goi.filter((g) => g.ham === "claim_customer_for_me")).toHaveLength(1)
    expect(goi[0]).toMatchObject({ ham: "search_customer_dupes", du_lieu: { p_q: "0912345678" } })
  })
  it("chủ NPP tạo: KHÔNG tự nhận khách (không chiếm ghế phụ trách chính)", async () => {
    const { sb, goi } = sbGia({})
    const kq = await taoKhach(sb, { ...nv, role: "owner" }, payload)
    expect(kq.ghiChu).toBeNull()
    expect(goi.some((g) => g.ham === "claim_customer_for_me")).toBe(false)
  })
  it("đã có khách cùng số (của NV khác) → ném KhachDaCo, KHÔNG ghi", async () => {
    const { sb, goi } = sbGia({ trung: [{ id: "k1", store_name: "Quán cũ", phone: "0912 345 678" }] })
    await expect(taoKhach(sb, nv, payload)).rejects.toBeInstanceOf(KhachDaCo)
    await expect(taoKhach(sb, nv, payload)).rejects.toThrow("Đã có khách hàng dùng số 0912 345 678: Quán cũ.")
    expect(goi.some((g) => g.loai === "insert")).toBe(false)
  })
  it("dò trùng ra khách số GẦN giống (khác số) → không coi là trùng", async () => {
    const { sb } = sbGia({ trung: [{ id: "k1", store_name: "Khác", phone: "0912345679" }] })
    await expect(taoKhach(sb, nv, payload)).resolves.toMatchObject({ id: "kh-moi" })
  })
  it("bấm hai lần (lần hai đụng UNIQUE 23505) → KhachDaCo, không chuyển trang", async () => {
    const { sb } = sbGia({ loiInsert: [{ code: "23505", message: 'duplicate key value violates unique constraint "customers_org_id_phone_key"' }] })
    const e = await taoKhach(sb, nv, payload).catch((x) => x)
    expect(e).toBeInstanceOf(KhachDaCo)
    expect((e as KhachDaCo).sdt).toBe("0912345678")
    expect((e as Error).message).toContain("có thể do nhân viên khác phụ trách")
  })
  it("sổ chưa có cột created_by → ghi lại không có cột ấy", async () => {
    const { sb, goi } = sbGia({ loiInsert: [{ code: "PGRST204", message: "Could not find the 'created_by' column" }] })
    await expect(taoKhach(sb, nv, payload)).resolves.toMatchObject({ id: "kh-moi" })
    const ins = goi.filter((g) => g.loai === "insert")
    expect(ins).toHaveLength(2)
    expect(ins[1].du_lieu).not.toHaveProperty("created_by")
  })
  it("lỗi RLS khác → ném nguyên lỗi (không nuốt)", async () => {
    const { sb } = sbGia({ loiInsert: [{ code: "42501", message: "new row violates row-level security policy" }] })
    await expect(taoKhach(sb, nv, payload)).rejects.toMatchObject({ code: "42501" })
  })
  it("tạo được nhưng phân công hỏng → báo rõ, phanCongLoi = true", async () => {
    const { sb } = sbGia({ claim: { error: { message: "mất mạng" } } })
    const kq = await taoKhach(sb, nv, payload)
    expect(kq.phanCongLoi).toBe(true)
    expect(kq.ghiChu).toContain("CHƯA phân công được cho bạn (mất mạng)")
  })
  it("đã có NV chính → được thêm làm phụ trách phụ", async () => {
    const { sb } = sbGia({ claim: { data: { status: "claimed", role: "secondary" } } })
    expect((await taoKhach(sb, nv, payload)).ghiChu).toContain("điểm bán đã có người phụ trách chính")
  })
})

/* ───────────────────────── 4. Lọc danh sách khách ───────────────────────── */
describe("lọc khách theo NV / thẻ lọc nhanh", () => {
  it("chonNv: không lọc / lọc NV (!inner) / chưa phân công (!left)", () => {
    expect(chonNv(null)).toBe("")
    expect(chonNv("u1")).toBe(", nv_chinh:customer_assignments!inner(user_id)")
    expect(chonNv(CHUA_PHAN_CONG)).toBe(", nv_chinh:customer_assignments!left(user_id)")
  })
  it("locDanhSachMa: không lọc → trả nguyên, không gọi máy chủ", async () => {
    const dung = vi.fn()
    expect(await locDanhSachMa(["a", "b"], false, dung)).toEqual(["a", "b"])
    expect(await locDanhSachMa([], true, dung)).toEqual([])
    expect(dung).not.toHaveBeenCalled()
  })
  it("locDanhSachMa: lọc TRÊN TOÀN BỘ 400 mã (3 lô), giữ thứ tự gốc (nợ giảm dần)", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `k${String(400 - i).padStart(3, "0")}`)
    const khop = new Set(ids.filter((_, i) => i % 7 === 0))
    const lo: number[] = []
    const kq = await locDanhSachMa(ids, true, (l, from, to) => {
      lo.push(l.length)
      const rows = l.filter((x) => khop.has(x)).map((id) => ({ id }))
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length })
    })
    expect(lo.sort((a, b) => b - a)).toEqual([150, 150, 100])
    expect(kq).toEqual(ids.filter((x) => khop.has(x)))
    expect(kq).toHaveLength(58)
  })
  it("locDanhSachMa: máy chủ lỗi → NÉM (không trả danh sách thiếu)", async () => {
    await expect(
      locDanhSachMa(["a"], true, () => Promise.resolve({ data: null, error: { message: "RLS" }, count: null }))
    ).rejects.toThrow("Lọc khách theo thẻ lọc nhanh: RLS")
  })
  it("catTrangMa gồm cả hai đầu; xepTheoMa theo thứ tự mã, mã lạ xuống cuối", () => {
    expect(catTrangMa(["a", "b", "c", "d"], 1, 2)).toEqual(["b", "c"])
    expect(catTrangMa(["a"], 5, 9)).toEqual([])
    expect(xepTheoMa([{ id: "x" }, { id: "c" }, { id: "a" }], ["a", "b", "c"]).map((r) => r.id)).toEqual(["a", "c", "x"])
  })
})

/* ───────────────────────── 5. Tìm kiếm không dấu ───────────────────────── */
describe("tìm không dấu — khoá TS trùng khoa_tim SQL (mig 205, đo ở danh-muc-rpc-nghi-viec.sql §4)", () => {
  it.each([
    ["DH-0123", "dh 0123 dh0123 dh123"],
    ["0912 345 678", "0912 345 678 0912345678 912345678"],
    ["Sữa hộp", "sua hop suahop"],
    ["Đường Đá", "duong da duongda"],
    ["SP-00", "sp 00 sp00 sp0"],
    ["", ""],
    ["Q.8 – Bách Hoá Xanh", "q 8 bach hoa xanh q8bachhoaxanh"],
  ])("viValueKey(%s)", (v, k) => {
    expect(viValueKey(v)).toBe(k)
  })
  const khach = [
    { id: "1", phone: "0901000001", store_name: "Bách Hoá Xanh Q.8", owner_name: "Lan" },
    { id: "2", phone: "0912345678", store_name: "Tạp hoá Hải Đăng", owner_name: "Hải" },
    { id: "3", phone: "0988000003", store_name: "Quán Đức Mạnh", owner_name: "Mạnh" },
    { id: "4", phone: "0977000004", store_name: "Nhà thuốc Đông Á", owner_name: "Đông" },
    { id: "5", phone: "0966000005", store_name: "Hải sản Đăng Khoa", owner_name: "Khoa" },
  ]
  const tim = (q: string) => timXepHang(khach, q, (c) => [c.phone, c.store_name, c.owner_name])
  it("gõ không dấu, hoa thường, đảo thứ tự từ", () => {
    expect(tim("bach hoa xanh").ketQua.map((x) => x.id)).toEqual(["1"])
    expect(tim("XANH q8").ketQua.map((x) => x.id)).toEqual(["1"])
    expect(tim("duc manh").ketQua.map((x) => x.id)).toEqual(["3"])
  })
  it("xếp hạng: khớp đầu TÊN CÙNG trường đứng trước khớp rải các trường", () => {
    // "hai dang": KH2 tên "Tạp hoá Hải Đăng" (cùng trường), KH5 "Hải sản Đăng Khoa" cũng cùng trường nhưng đầu tên.
    const kq = tim("hai dang")
    expect(kq.ketQua.map((x) => x.id).sort()).toEqual(["2", "5"])
    expect(kq.soKhop).toBe(2)
  })
  it("SĐT gõ liền / có cách / bỏ số 0 đầu", () => {
    expect(tim("0912 345 678").ketQua[0].id).toBe("2")
    expect(tim("912345678").ketQua[0].id).toBe("2")
    expect(tim("0912345678").ketQua.map((x) => x.id)).toEqual(["2"])
  })
  it("gõ sai một chữ (từ ≥ 5 chữ) vẫn gợi ý gần đúng, đánh dấu ganDung", () => {
    const kq = tim("thuoc")
    expect(kq.ketQua[0].id).toBe("4")
    const sai = tim("thouc")
    expect(sai.soKhop).toBe(0)
    expect(sai.ganDung).toBeGreaterThanOrEqual(1)
    expect(sai.ketQua.map((x) => x.id)).toContain("4")
  })
  it("số / mã KHÔNG được gần đúng: 0912345679 không ra 0912345678", () => {
    const kq = tim("0912345679")
    expect(kq.ketQua).toEqual([])
    expect(kq.ganDung).toBe(0)
  })
  it("từ ngắn dưới 5 chữ không gần đúng ('banh' không ra 'xanh')", () => {
    expect(tim("banh").ketQua).toEqual([])
  })
  it("chuỗi rỗng / chỉ dấu câu → giữ nguyên thứ tự, có giới hạn", () => {
    expect(tim("").ketQua).toHaveLength(5)
    expect(timXepHang(khach, " -- ", (c) => [c.store_name], { gioiHan: 2 }).ketQua.map((x) => x.id)).toEqual(["1", "2"])
    expect(viQueryWords("HD-0123 hd0123")).toEqual(["hd0123"])
  })
  it("viMatchAllWords trùng kết quả timXepHang (không gần đúng) trên cùng bộ mẫu", () => {
    for (const q of ["hai", "dang khoa", "0977", "q8", "lan xanh", "mạnh"]) {
      const a = khach.filter((c) => viMatchAllWords(q, c.phone, c.store_name, c.owner_name)).map((c) => c.id).sort()
      const b = timXepHang(khach, q, (c) => [c.phone, c.store_name, c.owner_name], { ganDung: false }).ketQua.map((c) => c.id).sort()
      expect(b).toEqual(a)
    }
  })
  it("chỉ mục nhớ theo mảng: mảng mới (gopVuaTao) → chỉ mục mới, không đọc lệch", () => {
    const a = [{ n: "Bia Hà Nội" }]
    const m1 = chiMucTim(a, (x) => [x.n], "t-nho")
    expect(chiMucTim(a, (x) => [x.n], "t-nho")).toBe(m1)
    const b = [...a, { n: "Bia Sài Gòn" }]
    const m2 = chiMucTim(b, (x) => [x.n], "t-nho")
    expect(m2).not.toBe(m1)
    expect(locXepHang(b, m2, "sai gon").ketQua).toEqual([{ n: "Bia Sài Gòn" }])
  })
})

/* ───────────────────────── 6. Nhân viên nghỉ việc ───────────────────────── */
describe("nghỉ việc — trạng thái, ô chọn, câu lỗi", () => {
  it("trạng thái: đã nghỉ đứng trước tạm khoá; is_active NULL = đang hoạt động", () => {
    expect(trangThaiNv({ is_active: true, left_at: null })).toBe("active")
    expect(trangThaiNv({ is_active: null })).toBe("active")
    expect(trangThaiNv({ is_active: false })).toBe("locked")
    expect(trangThaiNv({ is_active: false, left_at: "2026-10-01T17:30:00Z" })).toBe("left")
    expect(trangThaiNv({ is_active: true, left_at: "2026-10-01" })).toBe("left")
  })
  it("ô chọn người: chỉ người đang hoạt động", () => {
    const ds = [
      { id: "a", is_active: true },
      { id: "b", is_active: false },
      { id: "c", is_active: false, left_at: "2026-10-02" },
      { id: "d", is_active: null },
    ]
    expect(ds.filter(chonDuocNv).map((x) => x.id)).toEqual(["a", "d"])
  })
  it("tóm tắt chứng từ: gộp theo bảng (lấy số lớn nhất), xếp giảm dần, cắt bằng …", () => {
    const ct = {
      chi_tiet: [
        { bang: "receivables", cot: "sales_user_id", so: 3 },
        { bang: "sales_invoices", cot: "sales_user_id", so: 2 },
        { bang: "sales_invoices", cot: "posted_by", so: 5 },
        { bang: "sales_orders", cot: "sales_user_id", so: 2 },
        { bang: "bang_moi", cot: "x", so: 1 },
        { bang: "returns", cot: "requested_by", so: 1 },
      ],
    }
    expect(tomTatChungTu(ct)).toBe("5 hóa đơn · 3 công nợ · 2 đơn hàng · 1 chứng từ khác…")
    expect(tomTatChungTu({ chi_tiet: [] })).toBe("")
  })
  it("xoá hẳn chỉ khi tong = 0 (số hoặc chuỗi)", () => {
    expect(xoaHanDuoc({ tong: 0 })).toBe(true)
    expect(xoaHanDuoc({ tong: "0" as unknown as number })).toBe(true)
    expect(xoaHanDuoc({ tong: 7 })).toBe(false)
  })
  it("câu lỗi tiếng Việt cho mã lỗi mig 223", () => {
    expect(loiNhanVien("KHONG_DU_QUYEN: chỉ Chủ NPP")).toBe("Chỉ Chủ NPP được làm việc này.")
    expect(loiNhanVien("TU_NGHI: x")).toBe("Không tự cho mình nghỉ việc được.")
    expect(loiNhanVien("NGHI_CHU_NPP")).toBe("Không cho Chủ NPP nghỉ việc.")
    expect(loiNhanVien("NV_KHONG_HOP_LE: nhân viên đã nghỉ / bị khoá")).toContain("đã nghỉ hoặc đang tạm khoá")
    expect(loiNhanVien("Could not find the function public.cho_nhan_vien_nghi in the schema cache")).toBe(
      "Máy chủ chưa chạy migration 223 (nhân viên nghỉ việc)."
    )
    expect(loiNhanVien(null)).toBe("Lỗi không xác định")
  })
})

/* ───────────────────────── 7. Cửa vào trang ───────────────────────── */
describe("nav-permission — cửa vào trang danh mục", () => {
  it("tạo khách /customers/new: owner/manager/sales vào, kế toán / thủ kho không", () => {
    expect(duocVaoTrang("sales", "/customers/new", "customers")).toBe(true)
    expect(duocVaoTrang("manager", "/customers/new", "customers")).toBe(true)
    expect(duocVaoTrang("accountant", "/customers/new", "customers")).toBe(false)
    expect(duocVaoTrang("warehouse", "/customers/new", "customers")).toBe(false)
  })
  it("NVBH không vào NCC, kể cả /suppliers/<id> (mục cha)", () => {
    expect(mucChaCua("/suppliers/123")).toBe("/suppliers")
    expect(duocVaoTrang("sales", "/suppliers", "inventory")).toBe(false)
    expect(duocVaoTrang("sales", "/suppliers/123", "inventory")).toBe(false)
    // Danh sách / chi tiết NCC là tính năng "suppliers" (BACK_OFFICE: chủ, quản lý, kế toán) — thủ kho không vào,
    // dù thủ kho TẠO được NCC (/suppliers/new + tạo nhanh, theo inventory.create).
    expect(duocVaoTrang("accountant", "/suppliers/123", "inventory")).toBe(true)
    expect(duocVaoTrang("warehouse", "/suppliers/123", "inventory")).toBe(false)
  })
  it("tạo NCC /suppliers/new: thủ kho + chủ; quản lý / kế toán không", () => {
    expect(canEnterHref("warehouse", "/suppliers/new")).toBe(true)
    expect(canEnterHref("manager", "/suppliers/new")).toBe(false)
    expect(canEnterHref("accountant", "/suppliers/new")).toBe(false)
  })
  it("thủ kho không thấy danh sách khách", () => {
    expect(canSeeHref("warehouse", "/customers")).toBe(false)
    expect(canSeeHref("accountant", "/customers")).toBe(true)
  })
  it("phân quyền / người dùng: chỉ đọc settings (NVBH, thủ kho bị chặn)", () => {
    expect(canEnterHref("sales", "/settings/users")).toBe(false)
    expect(canEnterHref("warehouse", "/settings/permissions")).toBe(false)
    expect(duocVaoTrang("sales", "/settings/users/abc", "settings")).toBe(false)
  })
  it("chưa có vai / đường lạ / luồng cũ → đóng", () => {
    expect(canEnterHref(null, "/customers")).toBe(false)
    expect(canEnterHref("owner", "/khong-co-trang")).toBe(false)
    expect(laManLuongCu("/deliveries/x/settle")).toBe(true)
    expect(laManLuongCu("/deliveries-v2")).toBe(false)
    expect(duocVaoTrang("owner", "/deliveries/x", "deliveries")).toBe(false)
  })
  it("quyền riêng: thu hồi customers.create của một NVBH → không vào /customers/new; vẫn xem /customers", () => {
    setUserOverrides({ "customers.create": false })
    expect(duocVaoTrang("sales", "/customers/new", "customers")).toBe(false)
    expect(canEnterHref("sales", "/customers")).toBe(true)
    setUserOverrides({ "customers.read": false })
    expect(canEnterHref("sales", "/customers")).toBe(false)
  })
})

/* ───────────────────────── 8. Luật mig 166 trên các migration ───────────────────────── */
describe("migration: hàm SECURITY DEFINER tạo MỚI phải REVOKE anon (Supabase cấp sẵn EXECUTE cho anon)", () => {
  const thuMuc = path.resolve(__dirname, "../supabase/migrations")
  const tep = fs.readdirSync(thuMuc).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
  const noiDung = new Map(tep.map((f) => [f, fs.readFileSync(path.join(thuMuc, f), "utf8")]))
  // mig 207 thu EXECUTE của anon trên MỌI hàm SECURITY DEFINER có lúc đó; từ sau 207 mỗi hàm mới tự REVOKE.
  const sau207 = tep.filter((f) => Number(f.slice(0, 3)) > 207)
  const cacHam: Array<{ tep: string; ten: string; noiBo: boolean }> = []
  for (const f of sau207) {
    const s = noiDung.get(f)!
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$(\w*)\$/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (!/SECURITY\s+DEFINER/i.test(m[2])) continue
      const ten = m[1]
      const daCo = tep.some((g) => Number(g.slice(0, 3)) < Number(f.slice(0, 3)) && new RegExp(`FUNCTION\\s+(?:public\\.)?${ten}\\s*\\(`, "i").test(noiDung.get(g)!))
      const bo = new RegExp(`DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${ten}\\b`, "i").test(s)
      if (daCo && !bo) continue // CREATE OR REPLACE giữ nguyên ACL cũ
      cacHam.push({ tep: f, ten, noiBo: ten.startsWith("_") || /RETURNS\s+trigger/i.test(m[2]) })
    }
  }
  it("có hàm để soát (chốt không rỗng)", () => {
    expect(cacHam.length).toBeGreaterThan(10)
  })
  it.each(cacHam.map((h) => [h.ten, h.tep, h.noiBo] as const))("%s (%s)", (ten, f, noiBo) => {
    const sauDo = tep.filter((g) => g >= f).map((g) => noiDung.get(g)!).join("\n")
    expect(new RegExp(`REVOKE[^;]*\\b${ten}\\b[^;]*FROM[^;]*\\banon\\b`, "i").test(sauDo)).toBe(true)
    if (noiBo) expect(new RegExp(`REVOKE[^;]*\\b${ten}\\b[^;]*FROM[^;]*\\bauthenticated\\b`, "i").test(sauDo)).toBe(true)
  })
})
