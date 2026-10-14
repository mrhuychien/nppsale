/**
 * TÌM KHÁCH ĐÃ CÓ TRƯỚC KHI TẠO — trên điện thoại (chủ nhà 14/10/2026: "phần tạo khách hàng mới trên điện thoại của
 * nhân viên mất phần tìm khách hàng đã có trước khi tạo rồi"). Luật gốc 06/06/2026: check trùng theo SĐT, địa chỉ, tên;
 * khách đã có (kể cả NV khác phụ trách) thì NV "thêm vào danh sách của tôi" thay vì tạo trùng.
 * Bấm thật: e2e/tim-khach-truoc-khi-tao.spec.ts, e2e/tao-khach-dien-thoai.spec.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  KhachDaCo, cauNhanKhach, khachChoPhieu, nhanKhachVeDanhSach, timKhachTrungSdt,
} from "@/lib/customers/tao-khach"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
type Sb = Parameters<typeof nhanKhachVeDanhSach>[0]
const sbRpc = (tra: (ham: string, args: unknown) => { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async (ham: string, args: unknown) => tra(ham, args))
  return { sb: { rpc } as unknown as Sb, rpc }
}

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
  it("máy tính và điện thoại cùng một đường tìm + một đường nhận khách", () => {
    for (const s of [TIM, MAY]) {
      expect(s).toContain("useDoTrungKhach(")
      expect(s).toContain("nhanKhachVeDanhSach(supabase,")
      expect(s).not.toContain('rpc("search_customer_dupes"')
    }
    expect(read("src/hooks/use-do-trung-khach.ts")).toContain('supabase.rpc("search_customer_dupes", { p_q: tim })')
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
