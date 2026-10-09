import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cuaSoNap, kyTheoMa } from "@/lib/bao-cao/ky"
import { docDsLoc, docTrangThai, ghiDsLoc, ghiTrangThai, giuBuocKhiDoiLoc, TRANG_THAI_GOC, type BuocDao } from "@/lib/bao-cao/trang-thai"
import { dungDongBan, docNguoiTaoPhieuTra } from "@/lib/bao-cao/nap-ban-hang"
import { dungDongDat, napDonChuaXuat } from "@/lib/bao-cao/nap-don-dat"
import { congTheoNhanVien } from "@/lib/bao-cao/nap-cong-no"
import { congBan, congDat, danhMucRong, gomBan, quaLoc } from "@/lib/bao-cao/cong"
import { fakePostgrest } from "./helpers/fake-postgrest"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * RÀ BỘ LỌC — BÁO CÁO TỔNG HỢP (chủ nhà 09/10/2026: "rà soát lại phần báo cáo xem các bộ lọc có hoạt động không?").
 * Mỗi khối là một lỗi đã thấy: số đổi theo công tắc so sánh, khối phụ bỏ qua lọc, giảm giá đơn không chia theo hàng,
 * "Chưa xuất" treo đơn đã xong, tỷ lệ thu không qua lọc, giá trị lọc có dấu phẩy, đổi lọc mà bước đào sâu vẫn đè…
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8")
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
const sb = (t: Parameters<typeof fakePostgrest>[0]) => fakePostgrest(t).client as unknown as SupabaseClient

describe("cửa sổ nạp: kỳ này và kỳ trước nạp RIÊNG (giá vốn bình quân không trộn hai kỳ)", () => {
  const thang = { a: "2026-09-01", b: "2026-09-30" }

  it("không đào sâu: kỳ này = kỳ đang chọn, kỳ trước = nguyên kỳ so sánh", () => {
    expect(cuaSoNap(thang, null, ["2026-08-02", "2026-08-31"])).toEqual({ nay: ["2026-09-01", "2026-09-30"], truoc: ["2026-08-02", "2026-08-31"] })
    expect(cuaSoNap(thang, null, null)).toEqual({ nay: ["2026-09-01", "2026-09-30"], truoc: null })
  })

  it("đào sâu một tuần giữa tháng: vẫn nạp nguyên tháng (đúng giá vốn của dòng vừa bấm); tuần trước nằm trong tháng → không nạp thêm", () => {
    expect(cuaSoNap(thang, ["2026-09-14", "2026-09-20"], ["2026-09-07", "2026-09-13"])).toEqual({ nay: ["2026-09-01", "2026-09-30"], truoc: null })
  })

  it("đào sâu tuần đầu: kỳ trước chỉ nạp phần nằm ngoài tháng", () => {
    expect(cuaSoNap(thang, ["2026-09-01", "2026-09-06"], ["2026-08-26", "2026-08-31"]).truoc).toEqual(["2026-08-26", "2026-08-31"])
    expect(cuaSoNap(thang, ["2026-09-01", "2026-09-06"], ["2026-08-28", "2026-09-03"]).truoc).toEqual(["2026-08-28", "2026-08-31"])
  })

  it("khoảng đào sâu ra ngoài kỳ (đường dẫn gửi tay): cửa sổ bao cả hai", () => {
    expect(cuaSoNap(thang, ["2026-08-30", "2026-09-02"], null).nay).toEqual(["2026-08-30", "2026-09-30"])
  })

  it("trang Bán hàng / Tổng quan / Cuối ngày nạp theo hai cửa sổ, không còn một cửa sổ từ đầu kỳ trước", () => {
    const bh = boChuThich(doc("src/components/bao-cao/man-ban-hang.tsx"))
    expect(bh).toContain("cuaSoNap(ky, E.khoang, cmp && st.soSanh ? cmp : null)")
    expect(bh).not.toMatch(/const tu = cmp && st\.soSanh \? cmp\[0\] : a/)
    expect(bh).toContain("[...d.ban, ...d.banTruoc].filter((l) => trong(l, cmp[0], cmp[1]) && qua(l))")
    const tq = boChuThich(doc("src/components/bao-cao/man-tong-quan.tsx"))
    expect(tq).toContain("cuaSoNap(ky, null, cmp)")
    expect(tq).not.toContain("cmp ? cmp[0] : a")
    const cn = boChuThich(doc("src/components/bao-cao/man-cuoi-ngay.tsx"))
    expect(cn).toContain("napSoBan(sb, orgId, d, d, dmV)")
    expect(cn).not.toContain("napSoBan(sb, orgId, truoc, d,")
  })
})

describe("kỳ so sánh của Quý này không lấn sang quý này", () => {
  it("30/06 và 30/09: kỳ trước dừng ở cuối quý trước", () => {
    expect(kyTheoMa("quarter", "2026-06-30").cmp).toEqual(["2026-01-01", "2026-03-31"])
    expect(kyTheoMa("quarter", "2026-09-30").cmp).toEqual(["2026-04-01", "2026-06-30"])
    // Giữa quý: cùng độ dài như cũ.
    expect(kyTheoMa("quarter", "2026-09-26").cmp).toEqual(["2026-04-01", "2026-06-27"])
  })
})

describe("giá trị lọc trên đường dẫn — dấu phẩy nằm trong một giá trị", () => {
  it("ghi rồi đọc lại đúng nguyên giá trị", () => {
    const vs = ["Tuyến 1, Quận 3", "50%, 30%", "Tuyến 2"]
    expect(docDsLoc(ghiDsLoc(vs))).toEqual(vs)
    const q = ghiTrangThai({ ...TRANG_THAI_GOC, loc: { channel: vs } })
    expect(docTrangThai(new URLSearchParams(q)).loc.channel).toEqual(vs)
  })
  it("đường dẫn cũ (không thoát) đọc như trước", () => {
    expect(docTrangThai(new URLSearchParams("l_cust=a,b")).loc.cust).toEqual(["a", "b"])
  })
})

describe("đổi ô lọc trên thanh: bỏ bước đào sâu cùng chiều (nó đè lên lọc thanh)", () => {
  const dao: BuocDao[] = [
    { l: "Tuần 07/09", v: "cust", f: { range: ["2026-09-07", "2026-09-13"] } },
    { l: "Cô Ba", v: "prod", f: { cust: "k1" } },
    { l: "Sữa", v: "docs", f: { prod: "p1" } },
  ]
  it("đổi lọc Khách → bỏ từ bước Cô Ba trở đi; đổi lọc chiều khác → giữ nguyên", () => {
    expect(giuBuocKhiDoiLoc(dao, "cust").map((b) => b.l)).toEqual(["Tuần 07/09"])
    expect(giuBuocKhiDoiLoc(dao, "prod").map((b) => b.l)).toEqual(["Tuần 07/09", "Cô Ba"])
    expect(giuBuocKhiDoiLoc(dao, "ncc")).toEqual(dao)
  })
  it("mọi màn có lọc đi qua datLoc của hook", () => {
    for (const m of ["man-ban-hang", "man-cuoi-ngay", "man-cong-no", "man-kho"]) {
      const s = boChuThich(doc(`src/components/bao-cao/${m}.tsx`))
      expect(s, m).toContain("onLoc={bc.datLoc}")
    }
    expect(boChuThich(doc("src/hooks/use-bao-cao.ts"))).toContain("dao: giuBuocKhiDoiLoc(st.dao, k)")
  })
})

describe("giảm giá cả đơn chia theo dòng — lọc mặt hàng ra đúng phần của hàng ấy", () => {
  const dm = danhMucRong()
  dm.sp.set("A", { ten: "A", sku: "A", thuongHieu: "", ncc: "n1", donViCoSo: "hộp", donViLon: null })
  dm.sp.set("B", { ten: "B", sku: "B", thuongHieu: "", ncc: "n2", donViCoSo: "hộp", donViLon: null })
  const { dong } = dungDongBan({
    hoaDon: [{ id: "h1", invoice_code: "HD1", invoice_date: "2026-09-10", order_id: "o1", status: "posted", total: 1_350_000, subtotal: 1_350_000, vat: 0, customer_id: "k1", sales_user_id: "nv", posted_by: "u" }],
    dongHd: [
      { id: "l1", invoice_id: "h1", product_id: "A", unit_name: "hộp", conversion_factor: 1, quantity: 10, unit_price: 100_000, line_total: 1_000_000 },
      { id: "l2", invoice_id: "h1", product_id: "B", unit_name: "hộp", conversion_factor: 1, quantity: 5, unit_price: 100_000, line_total: 500_000 },
    ],
    tra: [],
    dongTra: [],
    giaVonCoSo: new Map(),
    giaVonTra: new Map(),
    nvTra: new Map(),
    dm,
  })
  it("giảm 150.000 chia 100.000 / 50.000; Σ = giảm của HĐ", () => {
    const m = gomBan(dong, (l) => l.sp, dm)
    expect(m.get("A")!.giamDon).toBe(100_000)
    expect(m.get("B")!.giamDon).toBe(50_000)
    expect(gomBan(dong, () => "", dm).get("")!.giamDon).toBe(150_000)
  })
  it("lọc NCC của B: giảm giá đơn = 50.000 (bản cũ: 0 vì cả khoản nằm ở dòng đầu)", () => {
    const qua = dong.filter((l) => quaLoc(l, { ncc: ["n2"] }, dm))
    expect(gomBan(qua, (l) => l.nv, dm).get("nv")!.giamDon).toBe(50_000)
  })
})

describe("màn Bán hàng: khối phụ và danh sách chứng từ cộng từ ĐÚNG các dòng đã qua lọc", () => {
  const s = boChuThich(doc("src/components/bao-cao/man-ban-hang.tsx"))
  it("Hàng trả trong kỳ / Giảm giá trên HĐ từ `cur` — không lọc lại phiếu bằng khách / NV, không cộng nguyên giảm giá HĐ", () => {
    expect(s).toContain("for (const l of cur) if (l.loai < 0) tienTra.set(l.ct, (tienTra.get(l.ct) || 0) + l.tien)")
    expect(s).not.toMatch(/d\.phieuTra\.filter\(\(r\) => r\.ngay >= a && r\.ngay <= b && quaLoc/)
    expect(s).toContain("tongGiam += l.giamDon")
    expect(s).not.toContain("tongGiam += h.giam")
  })
  it("xem Hoá đơn: DT thuần = doanh thu − hàng trả gắn HĐ; phiếu trả không gắn là dòng riêng", () => {
    expect(s).toContain("tien: x.ban - x.tra")
    expect(s).toContain("tien: -tra")
    expect(s).toContain('setCt({ loai: x.loai, id: x.id })')
  })
  it("dòng Tổng cột Công nợ hiện tại = Σ nợ các khách đang có trong bảng", () => {
    expect(s).toContain("const noTong = nhom.reduce((s, x) => s + (x.k ? noKhach.data?.[x.k] ?? 0 : 0), 0)")
    expect(s).not.toContain("Object.values(noKhach.data).reduce")
  })
  it("đường dẫn cũ xem=pgroup / bước đào sâu lạ → về Thời gian, không vỡ trang", () => {
    expect(s).toContain('const view: Xem = E.xem === "docs" || E.xem in CHIEU ? (E.xem as Xem) : "time"')
  })
})

describe("Đơn đặt: 'Chưa xuất' chỉ của đơn còn chờ xuất (Phiếu tạm)", () => {
  const o = (id: string, status: string, total: number, ngay = "2026-09-05") => ({
    id, order_code: id, order_date: ngay, status, total, subtotal: total, discount: 0, vat: 0, customer_id: "k1", sales_user_id: "nv", created_by: "u", payment_terms: "COD",
  })
  const dongDon = [
    { order_id: "xong", product_id: "A", quantity: 10, invoiced_qty: 8, line_total: 1_000_000 },
    { order_id: "cho", product_id: "A", quantity: 5, invoiced_qty: 0, line_total: 500_000 },
    { order_id: "nhap", product_id: "A", quantity: 3, invoiced_qty: 0, line_total: 300_000 },
  ]
  it("đơn Hoàn thành giao thiếu là xong (mig 217); đơn Nháp chưa tới lượt xuất", () => {
    const r = dungDongDat([o("xong", "completed", 1_000_000), o("cho", "submitted", 500_000), o("nhap", "draft", 300_000)], dongDon)
    expect(congDat(r.dong)).toMatchObject({ val: 1_800_000, done: 800_000, not: 500_000 })
  })
  it("ô Tổng quan: chỉ Phiếu tạm mọi ngày, kèm ngày sớm / muộn nhất để mở đúng danh sách", async () => {
    const f = fakePostgrest({
      sales_orders: [
        { ...o("cu", "submitted", 200_000, "2025-12-20"), org_id: "org" },
        { ...o("cho", "submitted", 500_000, "2026-09-06"), org_id: "org" },
        { ...o("xong", "completed", 1_000_000), org_id: "org" },
        { ...o("nhap", "draft", 300_000), org_id: "org" },
        { ...o("le", "partially_invoiced", 400_000), org_id: "org" },
      ],
      sales_order_lines: [
        ...dongDon,
        { order_id: "cu", product_id: "A", quantity: 2, invoiced_qty: 0, line_total: 200_000 },
        { order_id: "le", product_id: "A", quantity: 4, invoiced_qty: 2, line_total: 400_000 },
      ],
    })
    const r = await napDonChuaXuat(f.client as unknown as SupabaseClient, "org")
    expect(r).toMatchObject({ soDon: 2, conLai: 700_000, tu: "2025-12-20", den: "2026-09-06" })
  })
  it("ô Tổng quan mở kỳ từ đơn chờ sớm nhất (không phải Năm nay)", () => {
    const s = boChuThich(doc("src/components/bao-cao/man-tong-quan.tsx"))
    expect(s).toContain('ky: "custom" as const, ca: d.don.tu')
  })
})

describe("Cuối ngày: lọc Người tạo áp cả phiếu trả (`returns.requested_by`)", () => {
  it("đọc người tạo theo lô id", async () => {
    const m = await docNguoiTaoPhieuTra(sb({ returns: [{ id: "r1", requested_by: "u1" }, { id: "r2", requested_by: null }, { id: "r3", requested_by: "u3" }] }), ["r1", "r2"])
    expect(Array.from(m.entries())).toEqual([["r1", "u1"], ["r2", ""]])
  })
  it("dòng trả mang người tạo vào quaLoc; danh sách phiếu trả và thẻ đơn tạo theo cùng bộ lọc", () => {
    const s = boChuThich(doc("src/components/bao-cao/man-cuoi-ngay.tsx"))
    expect(s).toContain('nguoiTao: l.loai > 0 ? hdLap.get(l.hd) || "" : x.traLap.get(l.ct) || ""')
    expect(s).not.toContain("nguoiTao: l.loai > 0 ? hdLap.get(l.hd) || \"\" : undefined")
    expect(s).toContain("for (const l of L) if (l.loai < 0) tienTra.set(l.ct, (tienTra.get(l.ct) || 0) + l.tien)")
    expect(s).toContain('o.status !== "cancelled"))')
    expect(s).toContain("Lọc: {vm.moTaLoc}")
  })
})

describe("Công nợ theo nhân viên: tỷ lệ thu / số ngày thu TB qua lọc, gom theo người phụ trách khách", () => {
  it("congTheoNhanVien: người phụ trách; khách chưa gán thì NV của phiếu; khách không qua lọc thì bỏ", () => {
    const m = new Map([
      ["k1", { tien: 100, nvPhieu: "x" }],
      ["k2", { tien: 50, nvPhieu: "y" }],
      ["k3", { tien: 30, nvPhieu: "z" }],
    ])
    const nvKhach = (kh: string) => ({ k1: "A", k3: "A" } as Record<string, string>)[kh]
    const out = congTheoNhanVien(m, nvKhach, (kh) => kh !== "k3")
    expect(Array.from(out.entries())).toEqual([["A", 100], ["y", 50]])
  })
  it("màn Công nợ dùng bản theo khách, không đọc thẳng map theo NV của phiếu", () => {
    const s = boChuThich(doc("src/components/bao-cao/man-cong-no.tsx"))
    expect(s).toContain("congTheoNhanVien(d.thuThang, nvKhach, qua)")
    expect(s).toContain("congTheoNhanVien(d.ban90, nvKhach, qua)")
    expect(s).not.toContain("d.thuThang.get(nv)")
    expect(s).toContain('const goc = (st.xem in XEM ? st.xem : "customer") as keyof typeof XEM')
  })
})

describe("Tài chính: đào sâu đúng kỳ của bảng, danh sách chi khớp dòng Dòng tiền", () => {
  const s = boChuThich(doc("src/components/bao-cao/man-tai-chinh.tsx"))
  it("Theo tháng: bấm dòng mở kỳ Năm nay (bảng là số năm), không phải kỳ đang ẩn", () => {
    expect(s).toContain("const [ra, rb]: [string, string] = theoThang ? [`${homNay.slice(0, 4)}-01-01`, homNay] : [a, b]")
    expect(s).toContain("range: [ra, rb]")
    expect(s).toContain('theoThang ? { ky: "year", xem: "time" }')
  })
  it("dòng '− Chi phí' của Dòng tiền mở chi ĐÃ TRẢ theo ngày trả, mọi nhóm (như finance_cash_flow)", () => {
    expect(s).toContain('napPhieuChi(sb, orgId, x, y, kind !== "chiPhi", kind === "chi")')
    const t = boChuThich(doc("src/lib/bao-cao/nap-tien.ts"))
    expect(t).toContain('q.eq("is_paid", true).gte("paid_at", vnTu(a)).lte("paid_at", vnDen(b))')
    expect(t).toContain('theoNgayTra || e.category?.bucket !== "cogs"')
  })
})

describe("số và file không lấy của lần lọc / kỳ trước", () => {
  it("useNap: số của khoá cũ không trả ra (đổi kỳ → khung chờ, không cộng số kỳ cũ theo kỳ mới)", () => {
    const s = boChuThich(doc("src/components/bao-cao/dung-chung.ts"))
    expect(s).toContain("data: kq && kq.khoa === khoa ? kq.data : null")
  })
  it("bảng gỡ khỏi màn thì bỏ hàm xuất của nó khỏi xuatRef", () => {
    const s = boChuThich(doc("src/components/bao-cao/bang.tsx"))
    expect(s).toContain("if (refXuat && refXuat.current === hamXuat.current) refXuat.current = null")
    expect(s).toContain("p.xuatRef.current = hamXuat.current = () => {")
  })
})

describe("phép cộng vẫn đúng sau khi tách hai lượt nạp", () => {
  it("congBan trên dòng gộp hai kỳ rồi lọc theo ngày = cộng riêng từng kỳ", () => {
    const l = (ngay: string, tien: number) => ({ ngay, loai: 1 as const, ct: ngay, hd: ngay, kh: "k", nv: "n", sp: "p", tien, giaVon: 0, sl: 1 })
    const nay = [l("2026-09-02", 100), l("2026-09-03", 200)]
    const truoc = [l("2026-08-30", 50)]
    const prev = [...nay, ...truoc].filter((x) => x.ngay >= "2026-08-28" && x.ngay <= "2026-09-02")
    expect(congBan(prev).rev).toBe(150)
  })
})
