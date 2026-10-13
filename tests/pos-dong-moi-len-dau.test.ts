/**
 * POS: DÒNG MỚI LÊN ĐẦU + KHỐI ĐỔI TRẢ CUỘN — chủ nhà 13/10/2026: "xử lý phần pos : thêm sản phẩm thì sản phẩm xuất hiện
 * đầu danh sách luôn" · "kiểm tra lại phần sửa hóa đơn, khi phần đổi trả dài quá ko có scroll luôn ? kẹt cứng chỉ hiện
 * hàng đổi trả không hiện phiếu đi" — màn sửa hoá đơn, màn đơn và cả màn XEM hoá đơn (khối chứng từ liên quan kèm hàng
 * đổi trả). Bấm thật: e2e/pos-dong-moi-len-dau.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { donLenDau, themLenDau } from "@/lib/pos/them-dong"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("them-dong", () => {
  it("themLenDau: dòng mới lên đầu, không đụng mảng cũ", () => {
    const cu = ["a", "b"]
    expect(themLenDau(cu, "c")).toEqual(["c", "a", "b"])
    expect(cu).toEqual(["a", "b"])
    expect(themLenDau([], "x")).toEqual(["x"])
  })
  it("donLenDau: dòng thứ i (đã sửa) lên đầu, các dòng khác giữ thứ tự; i ngoài khoảng thì giữ nguyên", () => {
    const ds = [{ k: "a", sl: 1 }, { k: "b", sl: 1 }, { k: "c", sl: 3 }]
    expect(donLenDau(ds, 2, (x) => ({ ...x, sl: x.sl + 1 }))).toEqual([{ k: "c", sl: 4 }, { k: "a", sl: 1 }, { k: "b", sl: 1 }])
    expect(donLenDau(ds, 0, (x) => ({ ...x, sl: 9 }))).toEqual([{ k: "a", sl: 9 }, { k: "b", sl: 1 }, { k: "c", sl: 3 }])
    expect(donLenDau(ds, 5, (x) => x)).toEqual(ds)
    expect(donLenDau(ds, -1, (x) => x)).toEqual(ds)
    expect(ds[2].sl).toBe(3)
  })
})

describe("mọi màn POS thêm hàng bằng themLenDau, bảng cuộn tới dòng vừa thêm", () => {
  const MAN = {
    don: read("src/components/pos/order-screen.tsx"),
    hoaDon: read("src/components/pos/invoice-screen.tsx"),
    tra: read("src/components/pos/return-screen.tsx"),
    nhap: read("src/components/pos/purchase-screen.tsx"),
    traNcc: read("src/components/pos/supplier-return-screen.tsx"),
  }
  it("không màn nào còn nối dòng mới xuống cuối", () => {
    for (const [ten, s] of Object.entries(MAN)) {
      expect(s, ten).toContain("themLenDau(")
      expect(s, ten).not.toMatch(/return \[\.\.\.cu, moi\]|set(Lines|RetLines|TraMoi|DoiLines|TraLines)\(\(c(u)?\) => \[\s*\.\.\.c(u)?,/)
    }
    expect(MAN.don).toContain("return donLenDau(cu, i, (l) => ({ ...l, qty: l.qty + 1 }))")
  })
  it("khung bảng nhận key dòng vừa thêm; dòng mang data-dong", () => {
    expect(MAN.don).toContain("dongMoi={lines[0]?.key}")
    expect(MAN.hoaDon).toContain("dongMoi={rows[0]?.key}")
    expect(MAN.nhap).toContain("dongMoi={lines[0]?.key}")
    expect(MAN.traNcc).toContain("dongMoi={lines[0]?.key}")
    expect(MAN.tra).toContain("dongMoi={dongMoi}")
    expect(MAN.tra).toContain("setDongMoi(moi.key)")
    for (const [ten, s] of Object.entries(MAN)) expect(s, ten).toMatch(/data-dong=\{(l|r|a)\.key\}/)
    const bang = read("src/components/pos/line-table.tsx")
    expect(bang).toContain("const cuon = useCuonToiDong<HTMLDivElement>(dongMoi)")
    expect(bang).toContain('dong?.scrollIntoView({ block: "nearest" })')
  })
})

describe("khối hàng đổi trả không đè bảng hàng đi", () => {
  it("hoá đơn + đơn: khối có trần chiều cao, dòng cuộn trong khối, dòng trả mới lên đầu", () => {
    const hd = read("src/components/pos/invoice-screen.tsx")
    const don = read("src/components/pos/order-screen.tsx")
    for (const s of [hd, don]) {
      expect(s).toMatch(/className=\{`flex max-h-\[42vh\] min-h-0 shrink-0 flex-col overflow-hidden rounded-\[14px\] border bg-white/)
      expect(s).toMatch(/data-testid="cuon-hang-tra" className="min-h-0 overflow-y-auto"/)
    }
    expect(hd).toContain("const cuonTra = useCuonToiDong<HTMLDivElement>(traMoi[0]?.key)")
    expect(don).toContain("const cuonTraDon = useCuonToiDong<HTMLDivElement>(retLines[0]?.key)")
    // Hoá đơn: dòng trả MỚI vẽ trước dòng trả cũ.
    expect(hd.indexOf("{traMoi.map((a, i) => {")).toBeLessThan(hd.indexOf("{traCu.map((l, i) => {"))
    expect(hd).toContain("{traMoi.length + i + 1}.</span>{l.name}")
  })
  it("xem hoá đơn + đơn: khối chứng từ liên quan (kèm hàng đổi trả) có trần, tự cuộn", () => {
    const xem = read("src/app/pos/hoa-don/[id]/page.tsx")
    const don = read("src/components/pos/order-screen.tsx")
    expect(xem).toMatch(
      /data-testid="cuon-lien-quan" className="max-h-\[42vh\] min-h-0 shrink-0 overflow-y-auto rounded-xl">\s*<RelatedDocs orderId=\{head\.order_id\} invoiceId=\{id\} pos \/>/
    )
    expect(don).toMatch(
      /data-testid="cuon-lien-quan" className="max-h-\[24vh\] min-h-0 shrink-0 overflow-y-auto rounded-xl">\s*<RelatedDocs orderId=\{orderId\} pos hienHangTra=\{false\} \/>/
    )
    // Không còn chỗ nào vẽ RelatedDocs trần ngay dưới bảng hàng ở POS.
    for (const s of [xem, don]) expect(s.match(/<RelatedDocs /g)).toHaveLength(1)
  })
})
