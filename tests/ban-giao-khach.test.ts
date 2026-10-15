/**
 * BÀN GIAO KHÁCH + HÀNG KHÁCH ĐÃ LẤY — chủ nhà 15/10/2026: "Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung khách
 * hàng) Hoặc là như kiểu bàn giao lại khách hàng … dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào mà nv đó làm …
 * thể hiện luôn trên máy của nv". Chốt: cả hai kiểu; toàn bộ / tuyến / công ty; mốc 3 / 6 / 12 tháng / tất cả; chuyển hẳn
 * thì công nợ theo NV nhận, doanh số HĐ cũ vẫn của NV cũ (mig 246).
 * SQL thật: scripts/sql/thu-246-ban-giao-khach.sql. Bấm thật: e2e/ban-giao-khach.spec.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import { canSeeHref } from "@/lib/nav/nav-permission"
import {
  CHUA_GAN_CONG_TY, hangTheoKhach, khopTimKhach, kieuHopLe, lanCuoiCuaKhach, loiBanGiao, napHangDaLay, nhanLich,
  nhanSeLa, nhanTuyen, nhomTheoTuyen, slHienThi, thamSoRpc, thucHienBanGiao, tongDaChon, tuNgayTheoMoc, xemTruocBanGiao,
  xuatDanhSachBanGiao, type HangDaLay, type KhachBanGiao,
} from "@/lib/customers/ban-giao"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
type Sb = Parameters<typeof napHangDaLay>[0]
const sbRpc = (tra: (ham: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async (ham: string, args: Record<string, unknown>) => tra(ham, args))
  return { sb: { rpc } as unknown as Sb, rpc }
}

describe("mốc thời gian 3 / 6 / 12 tháng / tất cả (lịch VN)", () => {
  it("lùi đúng N tháng; 'Tất cả' → không giới hạn", () => {
    expect(tuNgayTheoMoc("3t", "2026-09-30")).toBe("2026-06-30")
    expect(tuNgayTheoMoc("6t", "2026-09-30")).toBe("2026-03-30")
    expect(tuNgayTheoMoc("12t", "2026-09-30")).toBe("2025-09-30")
    expect(tuNgayTheoMoc("tat-ca", "2026-09-30")).toBeNull()
  })
  it("qua năm; ngày cuối tháng kẹp về cuối tháng đích (cả năm nhuận)", () => {
    expect(tuNgayTheoMoc("3t", "2026-01-15")).toBe("2025-10-15")
    expect(tuNgayTheoMoc("3t", "2026-05-31")).toBe("2026-02-28")
    expect(tuNgayTheoMoc("6t", "2026-08-31")).toBe("2026-02-28")
    expect(tuNgayTheoMoc("3t", "2028-05-31")).toBe("2028-02-29")
    expect(tuNgayTheoMoc("12t", "2028-02-29")).toBe("2027-02-28")
  })
  it("ngày hỏng → không lọc", () => {
    expect(tuNgayTheoMoc("3t", "")).toBeNull()
    expect(tuNgayTheoMoc("3t", "30/09/2026")).toBeNull()
  })
})

describe("tham số gửi bàn giao", () => {
  const t = { nguon: "nv" as const, tuNv: "A", denNv: "B", kieu: "chuyen" as const }
  it("lọc rỗng gửi null (máy chủ hiểu là không lọc); mặc định giao kèm nợ NPP", () => {
    expect(thamSoRpc({ ...t, tuyen: [], ncc: [] }, { thucHien: false })).toEqual({
      p_den_nv: "B", p_kieu: "chuyen", p_nguon: "nv", p_tu_nv: "A", p_tuyen: null, p_ncc: null, p_tu_ngay: null,
      p_khach: null, p_giao_no_npp: true, p_thuc_hien: false,
    })
  })
  it("thực hiện gửi đúng các khách đã chọn; nguồn không phải NV thì không gửi NV giao", () => {
    const p = thamSoRpc({ ...t, nguon: "chua_ai", kieu: "chung", tuyen: ["GT"], ncc: ["X"], tuNgay: "2026-03-30", giaoNoNpp: false },
      { khach: ["k1", "k2"], thucHien: true })
    expect(p).toMatchObject({ p_nguon: "chua_ai", p_tu_nv: null, p_tuyen: ["GT"], p_ncc: ["X"], p_tu_ngay: "2026-03-30",
      p_khach: ["k1", "k2"], p_giao_no_npp: false, p_thuc_hien: true })
  })
  it("chuyển hẳn chỉ với nguồn là một NV", () => {
    expect(kieuHopLe("nv", "chuyen")).toBe(true)
    expect(kieuHopLe("chua_ai", "chuyen")).toBe(false)
    expect(kieuHopLe("tat_ca", "chuyen")).toBe(false)
    expect(kieuHopLe("tat_ca", "chung")).toBe(true)
  })
  it("xem trước / thực hiện gọi đúng hàm; lỗi máy chủ đổi ra lời", async () => {
    const { sb, rpc } = sbRpc((_h, a) => a.p_thuc_hien
      ? { data: { so_khach: 2, them_moi: 1, da_co: 1, len_chinh: 1, bo_khoi_nv_giao: 2, lich: 1, no_chuyen: { so: 1, tien: 500000 }, no_npp: { so: 0, tien: 0 }, bo_qua: 0, log_id: "L" }, error: null }
      : { data: { khach: [{ id: "k1", store_name: "Một", se_la: "primary", vai_nhan: null, lich: [0, 3], no_chuyen: { so: 1, tien: "500000" } }], tong: { so_khach: 1 } }, error: null })
    const x = await xemTruocBanGiao(sb, t)
    expect(x.khach[0]).toMatchObject({ id: "k1", se_la: "primary", vai_nhan: null, lich: [0, 3], no_chuyen: { so: 1, tien: 500000 } })
    expect(x.tong.so_khach).toBe(1)
    const k = await thucHienBanGiao(sb, t, ["k1"])
    expect(k).toMatchObject({ so_khach: 2, no_chuyen: { so: 1, tien: 500000 }, log_id: "L" })
    expect(rpc.mock.calls.map((c) => [c[0], c[1].p_thuc_hien, c[1].p_khach])).toEqual([
      ["ban_giao_khach", false, null], ["ban_giao_khach", true, ["k1"]],
    ])
    const loi = sbRpc(() => ({ data: null, error: { code: "P0001", message: "KHONG_CO_KHACH: không còn khách nào khớp" } }))
    await expect(thucHienBanGiao(loi.sb, t, ["k1"])).rejects.toThrow(/bấm Xem trước lại/)
  })
  it("câu lỗi: mã máy chủ → lời; chưa chạy migration → nói rõ", () => {
    expect(loiBanGiao({ message: "KHONG_DU_QUYEN: chỉ Chủ NPP" })).toBe("Chỉ Chủ NPP / Quản lý được bàn giao khách.")
    expect(loiBanGiao({ message: "NV_NHAN_KHONG_HOP_LE: x" })).toBe("Người nhận phải là nhân viên bán hàng đang làm.")
    expect(loiBanGiao({ message: "CHUYEN_CAN_NV_GIAO: x" })).toMatch(/Chuyển hẳn chỉ làm được/)
    expect(loiBanGiao({ code: "PGRST202", message: "Could not find the function public.ban_giao_khach" })).toMatch(/migration 246/)
    expect(loiBanGiao({ message: "mất mạng" })).toBe("mất mạng")
  })
})

describe("bảng xem trước", () => {
  const k = (o: Partial<KhachBanGiao>): KhachBanGiao => ({
    id: "x", store_name: "x", owner_name: null, phone: null, address: null, ward: null, channel: null, status: "active",
    vai_giao: "primary", vai_nhan: null, se_la: "secondary", nv_chinh: null, no_chuyen: null, no_npp: null, lich: null, ...o,
  })
  it("NV nhận sẽ là: chính / phụ / lên chính / đã có", () => {
    expect(nhanSeLa(k({ se_la: "primary" }))).toBe("Chính")
    expect(nhanSeLa(k({ se_la: "secondary" }))).toBe("Phụ")
    expect(nhanSeLa(k({ vai_nhan: "secondary", se_la: "primary" }))).toBe("Lên chính")
    expect(nhanSeLa(k({ vai_nhan: "secondary", se_la: "secondary" }))).toBe("Đã có (phụ)")
    expect(nhanSeLa(k({ vai_nhan: "primary", se_la: "primary" }))).toBe("Đã có (chính)")
  })
  it("tổng chỉ tính khách đang chọn (nợ, lên chính, lịch của khách mới)", () => {
    const ds = [
      k({ id: "a", se_la: "primary", no_chuyen: { so: 2, tien: 300 }, lich: [0, 3] }),
      k({ id: "b", vai_nhan: "secondary", se_la: "primary", no_chuyen: { so: 1, tien: 50 }, no_npp: { so: 1, tien: 9 }, lich: [1] }),
      k({ id: "c", se_la: "secondary", no_chuyen: { so: 4, tien: 999 } }),
    ]
    expect(tongDaChon(ds, new Set(["a", "b"]))).toEqual({
      so_khach: 2, them_moi: 1, da_co: 1, len_chinh: 2, no_chuyen: { so: 3, tien: 350 }, no_npp: { so: 1, tien: 9 }, lich: 2, bo_qua: 0,
    })
    expect(tongDaChon(ds, new Set()).so_khach).toBe(0)
  })
  it("lịch đi tuyến: 0 = Thứ 2 … 6 = Chủ nhật", () => {
    expect(nhanLich([0, 3, 6])).toBe("T2, T5, CN")
    expect(nhanLich(null)).toBe("")
  })
})

const DL: HangDaLay = {
  nv: "B",
  khach: [
    { id: "k1", store_name: "Tạp hoá Một", owner_name: "Chị Một", phone: "0912461001", address: "1 Hàng Bài", ward: "Hoàn Kiếm", channel: "T2", status: "active", nv_chinh: "NV Bình" },
    { id: "k2", store_name: "Đại lý Hai", owner_name: null, phone: "0912461002", address: null, ward: null, channel: "T3", status: "active", nv_chinh: null },
    { id: "k3", store_name: "Quán Ba", owner_name: null, phone: null, address: null, ward: null, channel: null, status: "active", nv_chinh: null },
    { id: "k4", store_name: "Bốn", owner_name: null, phone: null, address: null, ward: null, channel: "LA", status: "active", nv_chinh: null },
  ],
  hang: [
    { k: "k1", p: "sua", di: 48, tra: 1, sl: 47, lan: 2, cuoi: "2026-09-20" },
    { k: "k1", p: "dau", di: 3, tra: 0, sl: 3, lan: 1, cuoi: "2026-09-25" },
    { k: "k1", p: "mi", di: 60, tra: 0, sl: 60, lan: 1, cuoi: "2026-08-01" },
    { k: "k3", p: "sua", di: 0, tra: 2, sl: -2, lan: 0, cuoi: null },
  ],
  sp: [
    { id: "sua", sku: "SUA1", name: "Sữa hộp", base_unit: "hộp", ncc: "X" },
    { id: "dau", sku: "DAU1", name: "Dầu ăn", base_unit: "chai", ncc: null },
    { id: "mi", sku: "MI1", name: "Mì tôm", base_unit: "gói", ncc: "Y" },
  ],
  ncc: [{ id: "X", name: "Vinamilk" }, { id: "Y", name: "Acecook" }],
}
const TUYEN = [{ code: "T2", name: "Thứ hai" }, { code: "T3", name: "Thứ ba" }]

describe("hàng khách đã lấy — gom để hiện", () => {
  it("theo khách, nhiều nhất lên đầu, kèm công ty; hàng chưa gán công ty có nhãn riêng", () => {
    const m = hangTheoKhach(DL)
    expect(m.get("k1")!.map((h) => [h.ten, h.sl, h.congTy])).toEqual([["Mì tôm", 60, "Acecook"], ["Sữa hộp", 47, "Vinamilk"], ["Dầu ăn", 3, "Chưa gán công ty"]])
    expect(m.get("k2")).toBeUndefined()
    expect(lanCuoiCuaKhach(m.get("k1"))).toBe("2026-09-25")
    expect(lanCuoiCuaKhach(m.get("k3"))).toBeNull()
  })
  it("lọc một công ty (cả 'chưa gán công ty')", () => {
    expect(hangTheoKhach(DL, new Set(["X"])).get("k1")!.map((h) => h.ten)).toEqual(["Sữa hộp"])
    expect(hangTheoKhach(DL, new Set([CHUA_GAN_CONG_TY])).get("k1")!.map((h) => h.ten)).toEqual(["Dầu ăn"])
    expect(hangTheoKhach(DL, new Set()).get("k1")).toHaveLength(3)
  })
  it("nhóm theo tuyến đúng thứ tự danh mục; mã lạ sau; 'Chưa có tuyến' cuối", () => {
    expect(nhomTheoTuyen(DL.khach, TUYEN).map((g) => [g.nhan, g.khach.map((k) => k.id)])).toEqual([
      ["T2 — Thứ hai", ["k1"]], ["T3 — Thứ ba", ["k2"]], ["LA", ["k4"]], ["Chưa có tuyến", ["k3"]],
    ])
    expect(nhanTuyen("", TUYEN)).toBe("Chưa có tuyến")
  })
  it("số lượng hiện theo đơn vị cơ sở, giữ phần lẻ", () => {
    expect(slHienThi(47, "hộp")).toBe("47 hộp")
    expect(slHienThi(1.5, "thùng")).toBe("1,5 thùng")
    expect(slHienThi(1000, "gói")).toBe("1.000 gói")
    expect(slHienThi(2, "")).toBe("2")
  })
  it("tìm không dấu theo tên / chủ / địa chỉ; số điện thoại từ 3 chữ số", () => {
    const k = DL.khach[0]
    expect(khopTimKhach(k, "tap hoa")).toBe(true)
    expect(khopTimKhach(k, "HÀNG BÀI")).toBe(true)
    expect(khopTimKhach(k, "chi mot")).toBe(true)
    expect(khopTimKhach(k, "1001")).toBe(true)
    expect(khopTimKhach(k, "09")).toBe(false)
    expect(khopTimKhach(k, "Đại lý")).toBe(false)
    expect(khopTimKhach(k, "  ")).toBe(true)
  })
  it("đọc: chưa chạy mig 246 → null (màn lùi về khối cũ); lỗi khác thì ném; số đọc thành số", async () => {
    const thieu = sbRpc(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.hang_khach_da_lay" } }))
    expect(await napHangDaLay(thieu.sb, { khach: ["k1"] })).toBeNull()
    const hong = sbRpc(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }))
    await expect(napHangDaLay(hong.sb, { khach: ["k1"] })).rejects.toThrow(/timeout/)
    const { sb, rpc } = sbRpc(() => ({ data: { nv: null, khach: [], hang: [{ k: "k1", p: "sua", di: "48.000", tra: "1.000", sl: "47.000", lan: 2, cuoi: "2026-09-20" }], sp: [], ncc: [] }, error: null }))
    const d = await napHangDaLay(sb, { nv: "B", tu: "2026-03-30", tuyen: [] })
    expect(d!.hang[0]).toEqual({ k: "k1", p: "sua", di: 48, tra: 1, sl: 47, lan: 2, cuoi: "2026-09-20" })
    expect(rpc).toHaveBeenCalledWith("hang_khach_da_lay", { p_nv: "B", p_khach: null, p_tu: "2026-03-30", p_tuyen: null })
  })
})

describe("Excel danh sách bàn giao", () => {
  it("mỗi dòng một khách × mặt hàng theo tuyến; khách chưa lấy hàng vẫn có dòng; SL là số; SĐT là chữ", () => {
    const [ct, tt] = xuatDanhSachBanGiao(DL, { tuyen: TUYEN })
    expect(ct.ten).toBe("Hàng đã lấy")
    expect(ct.rows[0]).toEqual(["Tuyến", "Cửa hàng", "Chủ cửa hàng", "SĐT", "Địa chỉ", "Phường/xã", "NV phụ trách chính",
      "Công ty", "Mã hàng", "Tên hàng", "SL đã lấy (đơn vị cơ sở)", "Đơn vị", "Đã trả lại", "Số lần lấy", "Lần lấy cuối"])
    expect(ct.rows[1]).toEqual(["T2 — Thứ hai", "Tạp hoá Một", "Chị Một", "0912461001", "1 Hàng Bài", "Hoàn Kiếm", "NV Bình",
      "Acecook", "MI1", "Mì tôm", 60, "gói", 0, 1, "01/08/2026"])
    expect(ct.rows.slice(1).map((r) => [r[1], r[9]])).toEqual([
      ["Tạp hoá Một", "Mì tôm"], ["Tạp hoá Một", "Sữa hộp"], ["Tạp hoá Một", "Dầu ăn"],
      ["Đại lý Hai", "(chưa lấy hàng trong kỳ)"], ["Bốn", "(chưa lấy hàng trong kỳ)"], ["Quán Ba", "Sữa hộp"],
    ])
    expect(tt.ten).toBe("Khách")
    expect(tt.rows.slice(1).map((r) => [r[1], r[7], r[8]])).toEqual([
      ["Tạp hoá Một", 3, "25/09/2026"], ["Đại lý Hai", 0, ""], ["Bốn", 0, ""], ["Quán Ba", 1, ""],
    ])
  })
  it("theo bộ lọc đang xem: công ty + khách đang hiện", () => {
    const [ct] = xuatDanhSachBanGiao(DL, { tuyen: TUYEN, congTy: new Set(["X"]), khachIds: new Set(["k1", "k2"]) })
    expect(ct.rows.slice(1).map((r) => [r[1], r[9], r[10]])).toEqual([["Tạp hoá Một", "Sữa hộp", 47], ["Đại lý Hai", "(chưa lấy hàng trong kỳ)", ""]])
  })
})

describe("menu + quyền: bàn giao chỉ chủ NPP / quản lý; danh sách hàng đã lấy ai xem khách cũng vào", () => {
  it("canSeeHref", () => {
    expect(canSeeHref("owner", "/customers/ban-giao")).toBe(true)
    expect(canSeeHref("manager", "/customers/ban-giao")).toBe(true)
    expect(canSeeHref("sales", "/customers/ban-giao")).toBe(false)
    expect(canSeeHref("accountant", "/customers/ban-giao")).toBe(false)
    expect(canSeeHref("sales", "/customers/hang-da-lay")).toBe(true)
    expect(canSeeHref("manager", "/customers/hang-da-lay")).toBe(true)
  })
  it("mục menu + ô trang chủ NVBH + khối chi tiết khách (lùi về khối cũ khi chưa chạy 246)", () => {
    const SIDEBAR = read("src/components/layout/sidebar.tsx")
    expect(SIDEBAR).toContain('{ label: "Bàn giao khách", href: "/customers/ban-giao", icon: ArrowRightLeft }')
    expect(SIDEBAR).toContain('{ label: "Hàng khách đã lấy", href: "/customers/hang-da-lay", icon: PackageSearch }')
    const HOME = read("src/app/(dashboard)/home/page.tsx")
    expect(HOME).toContain('{ label: "Hàng khách đã lấy", href: "/customers/hang-da-lay", icon: PackageSearch, color: "orange" }')
    const CT = read("src/app/(dashboard)/customers/[id]/page.tsx")
    expect(CT).toMatch(/<HangDaLayKhach\s+customerId=\{customer\.id\}\s+laNv=\{laNvbh\}\s+fallback=\{\s*<Card>/)
    const KHOI = read("src/components/customers/hang-da-lay-khach.tsx")
    expect(KHOI).toContain("if (d === null) return <>{fallback}</>")
  })
})

describe("mig 246 — đúng khuôn, bản đang chạy", () => {
  const MIG = read("supabase/migrations/246_ban_giao_khach.sql")
  const ham = hamDangChay()
  const lay = (ten: string) => Array.from(ham.entries()).find(([k]) => k.startsWith(`public.${ten}(`))?.[1]
  it("VÌ SAO trích lời chủ nhà; chặn anon; trigger nội bộ không ai gọi; NOTIFY + câu tóm tắt", () => {
    expect(MIG).toContain('chủ nhà 15/10/2026 (chuyển lời một NPP): "Gán cho toàn bộ khách hàng của nv A cho nv B')
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.ban_giao_khach(uuid, text, text, uuid, text[], uuid[], date, uuid[], boolean, boolean) FROM PUBLIC, anon;")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.hang_khach_da_lay(uuid, uuid[], date, text[]) FROM PUBLIC, anon;")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._cong_no_giu_ve_npp() FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG).toMatch(/SELECT\s+\(SELECT count\(\*\) FROM information_schema\.columns[\s\S]+AS rpc_hang_da_lay;\s*$/)
  })
  it("trigger giữ NV nhận khi tính lại nợ vẫn ghi NV giao; HĐ đổi người khác thì theo HĐ; dấu chỉ RPC đổi được", () => {
    const h = lay("_cong_no_giu_ve_npp")
    expect(h?.file).toBe("246_ban_giao_khach.sql")
    expect(h!.than).toMatch(/IF TG_OP = 'UPDATE' THEN\s+NEW\.giao_tu_nv := OLD\.giao_tu_nv;\s+ELSE\s+NEW\.giao_tu_nv := NULL;/)
    expect(h!.than).toMatch(/IF NEW\.sales_user_id IS NOT DISTINCT FROM OLD\.giao_tu_nv THEN\s+NEW\.sales_user_id := OLD\.sales_user_id;/)
    expect(MIG).toContain("BEFORE INSERT OR UPDATE OF sales_user_id, ve_npp_luc, giao_tu_nv ON public.receivables")
  })
  it("chuyển hẳn: nợ CHƯA THU của NV giao → NV nhận kèm dấu; NV giao gỡ khỏi khách; bản đang chạy là mig 246", () => {
    const h = lay("ban_giao_khach")
    expect(h?.file).toBe("246_ban_giao_khach.sql")
    expect(h!.than).toContain("giao_tu_nv = NULLIF(COALESCE(rc.giao_tu_nv, p_tu_nv), p_den_nv)")
    expect(h!.than).toContain("rc.sales_user_id = p_tu_nv AND rc.status <> 'paid'")
    expect(h!.than).toContain("DELETE FROM customer_assignments WHERE user_id = p_tu_nv AND customer_id = ANY (v_ids);")
    expect(h!.than).toContain("public.user_role() NOT IN ('owner', 'manager')")
  })
  it("hàng khách đã lấy: NVBH luôn là chính mình; hàng đổi / phiếu chưa trừ không tính", () => {
    const h = lay("hang_khach_da_lay")
    expect(h?.file).toBe("246_ban_giao_khach.sql")
    expect(h!.than).toContain("v_nv := v_uid;")
    expect(h!.than).toContain("AND NOT l.is_exchange")
    expect(h!.than).toContain("AND NOT rl.is_exchange")
    expect(h!.than).toContain("AND r.revenue_date IS NOT NULL")
  })
  it("sửa HĐ chép dấu bàn giao sang tờ mới (vá reissue_invoice có kiểm số chỗ vá)", () => {
    // Chuỗi nằm trong một hằng SQL ('…') nên nháy đơn viết đôi.
    expect(MIG).toContain("''g'', rc227.giao_tu_nv /* (mig 246) dấu bàn giao nợ */")
    expect(MIG).toContain("giao_tu_nv    = NULLIF(v227->>''g'', '''')::uuid /* (mig 246) */")
    expect(MIG).toContain("IF v_n1 <> 1 OR v_n2 <> 1 THEN")
  })
  it("khám sổ có dòng 85", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 85, 'Mig 246 (Bàn giao khách + hàng khách đã lấy)'")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-246-ban-giao-khach.sql")
describe.skipIf(!BO_THU)("mig 246 trên Postgres thử", () => {
  it("45/45 dòng đạt (luồng thật: đơn → HĐ → trả hàng → bàn giao → sửa HĐ → tính lại nợ)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("45|45|0")
  })
})
