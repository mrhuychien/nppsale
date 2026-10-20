/**
 * TÌM KHÁCH ĐÃ CÓ TRƯỚC KHI TẠO — trên điện thoại (chủ nhà 14/10/2026: "phần tạo khách hàng mới trên điện thoại của
 * nhân viên mất phần tìm khách hàng đã có trước khi tạo rồi"). Luật gốc 06/06/2026: check trùng theo SĐT, địa chỉ, tên;
 * khách đã có (kể cả NV khác phụ trách) thì NV "thêm vào danh sách của tôi" thay vì tạo trùng.
 * Chủ nhà 15/10/2026: "ở máy tính tao chỉ cho tìm kiếm chính xác, nghĩa là nhập đúng số điện thoại của khách thì khách
 * mới hiện ra" — mig 245 + `sdtTimChinhXac`: tên / địa chỉ / số dở không tìm gì.
 * Bấm thật: e2e/tim-khach-truoc-khi-tao.spec.ts, e2e/tao-khach-dien-thoai.spec.ts. SQL thật: scripts/sql/thu-245-*.sql.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import {
  KhachDaCo, cauNhanKhach, khachChoPhieu, khoaTaoKhachMoi, nhanKhachVeDanhSach, sdtTimChinhXac, timKhachTrungSdt,
} from "@/lib/customers/tao-khach"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
type Sb = Parameters<typeof nhanKhachVeDanhSach>[0]
const sbRpc = (tra: (ham: string, args: unknown) => { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async (ham: string, args: unknown) => tra(ham, args))
  return { sb: { rpc } as unknown as Sb, rpc }
}

describe("chỉ tìm khi nhập ĐÚNG số điện thoại (chủ nhà 15/10/2026)", () => {
  it("số đủ (10–11 chữ số, đầu 0; có cách / chấm / +84) → số đã chuẩn hoá", () => {
    expect(sdtTimChinhXac("0911111111")).toBe("0911111111")
    expect(sdtTimChinhXac(" 0911 111 111 ")).toBe("0911111111")
    expect(sdtTimChinhXac("0911.111.111")).toBe("0911111111")
    expect(sdtTimChinhXac("+84 911 111 111")).toBe("0911111111")
    expect(sdtTimChinhXac("84911111111")).toBe("0911111111")
    expect(sdtTimChinhXac("02253 123 456")).toBe("02253123456")
  })
  it("tên, địa chỉ, số dở, số không đầu 0, quá dài → không tìm", () => {
    for (const q of ["", "   ", "Lê Lợi", "Tạp hoá Cô Ba", "0911", "091111111", "911111111", "1911111111", "091111111122", "0911 111 111 Cô Ba"]) {
      expect(sdtTimChinhXac(q), q).toBe("")
    }
  })
})

/*
 * Chủ nhà 20/10/2026: "khi tìm kiếm ở màn tạo khách hàng này đã có kết quả thì nút tạo khách hàng mới không bấm được để
 * ngăn tạo trùng khi đã có, khi không có kết quả tìm kiếm mới bấm được".
 */
describe("bước tìm: tìm ra khách thì khoá nút Tạo khách hàng mới", () => {
  const SO = "0911111111"
  it("đã có kết quả → khoá (cả khi đang gõ lại / đã nhận khách vào DS)", () => {
    expect(khoaTaoKhachMoi({ chu: "0911 111 111", tim: SO, dangTim: false, soKetQua: 1 })).toBe(true)
    expect(khoaTaoKhachMoi({ chu: "0911 111 111", tim: SO, dangTim: false, soKetQua: 2 })).toBe(true)
    expect(khoaTaoKhachMoi({ chu: "0911 11", tim: SO, dangTim: false, soKetQua: 1 })).toBe(true)
  })
  it("tìm xong KHÔNG ra khách → bấm được (kể cả gõ +84 / có cách)", () => {
    expect(khoaTaoKhachMoi({ chu: "0912 345 678", tim: "0912345678", dangTim: false, soKetQua: 0 })).toBe(false)
    expect(khoaTaoKhachMoi({ chu: "+84 912 345 678", tim: "0912345678", dangTim: false, soKetQua: 0 })).toBe(false)
  })
  it("số đủ mà kết quả chưa về (đang chờ 300ms / đang tìm) → khoá: chưa biết có trùng không", () => {
    expect(khoaTaoKhachMoi({ chu: "0912 345 678", tim: "", dangTim: false, soKetQua: 0 })).toBe(true)
    expect(khoaTaoKhachMoi({ chu: "0912 345 678", tim: "0911111111", dangTim: false, soKetQua: 0 })).toBe(true)
    expect(khoaTaoKhachMoi({ chu: "0912 345 678", tim: "0912345678", dangTim: true, soKetQua: 0 })).toBe(true)
  })
  it("chưa gõ / số chưa đủ / gõ tên → không tìm gì, bấm được (form vẫn chặn trùng số)", () => {
    for (const chu of ["", "0911", "Tạp hoá Cô Ba"]) {
      expect(khoaTaoKhachMoi({ chu, tim: "", dangTim: false, soKetQua: 0 }), chu).toBe(false)
    }
  })
})

describe("nhận khách đã có vào danh sách (claim_customer_for_me)", () => {
  it("gọi đúng RPC; chưa ai phụ trách chính → chính, có rồi → phụ; đã có sẵn → báo đã trong DS", async () => {
    const { sb, rpc } = sbRpc(() => ({ data: { status: "claimed", role: "secondary" }, error: null }))
    const kq = await nhanKhachVeDanhSach(sb, "kh-1")
    expect(rpc).toHaveBeenCalledWith("claim_customer_for_me", { p_customer_id: "kh-1" })
    expect(kq).toEqual({ daCoSan: false, vaiTro: "secondary" })
    expect(cauNhanKhach(kq)).toBe("Đã thêm vào danh sách của bạn (phụ trách phụ)")
    expect(cauNhanKhach({ daCoSan: false, vaiTro: "primary" })).toBe("Đã thêm vào danh sách của bạn (phụ trách chính)")
    const coSan = await nhanKhachVeDanhSach(sbRpc(() => ({ data: { status: "already_assigned", role: "primary" }, error: null })).sb, "kh-1")
    expect(coSan.daCoSan).toBe(true)
    expect(cauNhanKhach(coSan)).toBe("Khách đã trong danh sách của bạn")
  })
  it("RPC lỗi (vd vai không phải NVBH) → ném, không nói đã thêm", async () => {
    const { sb } = sbRpc(() => ({ data: null, error: { message: "ONLY_SALES_CAN_CLAIM" } }))
    await expect(nhanKhachVeDanhSach(sb, "kh-1")).rejects.toMatchObject({ message: "ONLY_SALES_CAN_CLAIM" })
  })
})

describe("dò trùng SĐT mang đủ thông tin để nhận khách", () => {
  it("trả cả phụ trách chính + đã trong DS của tôi chưa; chỉ khớp ĐÚNG số", async () => {
    const dong = { id: "k1", store_name: "Cô Ba", owner_name: "Ba", phone: "0911 111 111", address: "1 Lê Lợi", ward: null, primary_user_name: "NV Khác", has_my_assignment: false }
    const { sb } = sbRpc(() => ({ data: [{ ...dong, id: "k0", phone: "0911111112" }, dong], error: null }))
    const k = await timKhachTrungSdt(sb, "0911111111")
    expect(k).toMatchObject({ id: "k1", primary_user_name: "NV Khác", has_my_assignment: false })
    expect(new KhachDaCo("0911111111", k).message).toBe("Đã có khách hàng dùng số 0911 111 111: Cô Ba.")
  })
  it("khách dò trùng → khách cho ô chọn của phiếu (tạo nhanh: nhận xong chọn luôn)", () => {
    expect(khachChoPhieu({ id: "k1", store_name: "Cô Ba", owner_name: "Ba", phone: "0911111111", address: "1 Lê Lợi" }))
      .toEqual({ id: "k1", store_name: "Cô Ba", owner_name: "Ba", phone: "0911111111", address: "1 Lê Lợi", channel: null })
    expect(khachChoPhieu({ id: "k2", store_name: "X" })).toEqual({ id: "k2", store_name: "X", owner_name: null, phone: null, address: null, channel: null })
  })
})

describe("nối dây", () => {
  const PAGE = read("src/app/(dashboard)/customers/new/page.tsx")
  const TIM = read("src/components/customers/tim-khach-truoc-khi-tao.tsx")
  const FORM = read("src/components/customers/tao-khach-dien-thoai.tsx")
  const MAY = read("src/components/customers/customer-dupe-finder.tsx")

  it("điện thoại: bước TÌM trước; ?sdt= mới vào thẳng form; Huỷ về bước tìm; Thêm khách khác về bước tìm", () => {
    const dt = PAGE.slice(PAGE.indexOf("if (laMay === false) {"), PAGE.indexOf("return (\n    <div className=\"space-y-4\">"))
    expect(dt).toContain("<TimKhachTruocKhiTao")
    expect(dt).toContain("onTaoMoi={(q) => setMangSang(chuBanDauKhach(q))}")
    expect(dt).toContain("onHuy={() => setMangSang(null)}")
    expect((dt.match(/onThemKhachKhac=\{veBuocTim\}/g) ?? []).length).toBe(2)
    expect(PAGE).toContain("const [vaoThangForm, setVaoThangForm] = useState(!!sdtTim)")
    expect(PAGE).not.toContain("if (laMay === false) return <TaoKhachDienThoai")
  })
  it("máy tính và điện thoại cùng một đường tìm + một đường nhận khách; ô nhập kiểu số điện thoại; nhắc nhập đủ số", () => {
    for (const s of [TIM, MAY]) {
      expect(s).toContain("useDoTrungKhach(")
      expect(s).toContain("nhanKhachVeDanhSach(supabase,")
      expect(s).not.toContain('rpc("search_customer_dupes"')
      expect(s).toContain('inputMode="tel"')
      expect(s).toContain("{chuaDuSo && (")
      expect(s).toContain("đúng số điện thoại")
      expect(s).not.toMatch(/địa chỉ hoặc tên/)
    }
    const HOOK = read("src/hooks/use-do-trung-khach.ts")
    // Chỉ gửi đi số ĐỦ, và lọc lại đúng số (sổ chưa chạy mig 245 thì hàm còn khớp từng phần).
    expect(HOOK).toContain("setTim(sdtTimChinhXac(chu))")
    expect(HOOK).toContain('supabase.rpc("search_customer_dupes", { p_q: tim })')
    expect(HOOK).toContain('.filter((k) => chuanHoaSdt(k.phone ?? "") === tim)')
  })
  it("máy tính và điện thoại: nút Tạo khách hàng mới khoá theo `khoaTaoMoi` của đường tìm chung, nói lý do", () => {
    const HOOK = read("src/hooks/use-do-trung-khach.ts")
    expect(HOOK).toContain("const khoaTaoMoi = khoaTaoKhachMoi({ chu, tim, dangTim, soKetQua: ketQua.length })")
    expect(TIM).toContain("disabled={khoaTaoMoi}")
    expect(TIM).toContain("onClick={() => { if (!khoaTaoMoi) onTaoMoi(chu) }}")
    expect(MAY).toContain("disabled={khoaTaoMoi}")
    expect(MAY).toContain("onClick={() => { if (!khoaTaoMoi) onConfirmCreateNew(query) }}")
    for (const s of [TIM, MAY]) expect(s).toContain("Số này đã có khách hàng — không tạo trùng được.")
  })
  it("bước tìm: NVBH chưa nhận thì có nút nhận, không có link Xem (RLS — trang trống)", () => {
    expect(TIM).toContain("{laNv && !cuaToi && (")
    expect(TIM).toContain("{(cuaToi || !laNv) && (")
  })
  it("form: trùng SĐT với khách NV khác → nút nhận thay link Mở khách; tạo nhanh thì nhận xong chọn luôn", () => {
    expect(FORM).toContain('const phaiNhan = !!trung?.khach && user?.role === "sales" && !trung.khach.has_my_assignment')
    expect(FORM).toContain("if (onDaTao) onDaTao(khachChoPhieu(k))")
    expect(FORM).toContain("else setTrung(new KhachDaCo(t.sdt, { ...k, has_my_assignment: true }))")
    expect(FORM).toContain("if (onThemKhachKhac) return onThemKhachKhac()")
  })
})

describe("mig 245: search_customer_dupes chỉ khớp ĐÚNG số", () => {
  const h = hamDangChay().get("public.search_customer_dupes(TEXT)")
  const MIG = read("supabase/migrations/245_tim_khach_trung_dung_so.sql")
  it("bản đang chạy là mig 245: số chưa đủ → không trả gì; so bằng chữ số, 84 → 0; không còn khớp từng phần tim_kd", () => {
    expect(h?.file).toBe("245_tim_khach_trung_dung_so.sql")
    expect(h!.than).toContain("IF v_org IS NULL OR v_so !~ '^0[0-9]{9,10}$' THEN")
    expect(h!.than).toContain("(CASE WHEN s.d ~ '^84[0-9]{9}$' THEN '0' || substr(s.d, 3) ELSE s.d END) = v_so")
    expect(h!.than).not.toContain("tim_kd")
  })
  it("đúng khuôn migration: VÌ SAO trích lời chủ nhà, chặn anon, NOTIFY", () => {
    expect(MIG).toContain("chủ nhà 15/10/2026: \"Tìm kiếm như vậy là sai. ở máy tính tao chỉ cho tìm kiếm chính xác")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public.search_customer_dupes(text) FROM PUBLIC, anon;")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.search_customer_dupes(text) TO authenticated;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-245-tim-khach-dung-so.sql")
describe.skipIf(!BO_THU)("mig 245 trên Postgres thử", () => {
  it("10/10 bước đạt (đúng số ra khách; tên / địa chỉ / số dở / đơn vị khác không ra; anon không gọi được)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("10|10|0")
  })
})
