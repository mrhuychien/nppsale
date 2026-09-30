import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  tomTatTonKho, canhBaoLo, sapXepTon, sapXepKeTiep, nhanSapXep,
} from "../src/lib/inventory/kho-hang-mobile"
import {
  slCoSoDong, soLuongPhieu, nhanSoLuong, nhanNgayPhieu, nhomPhieuTheoNgay, trangThaiPhieu,
  dongPhuPhieu, bangTrangThai, tomTatDong, nhanTongSoLuong,
} from "../src/lib/inventory/phieu-kho-mobile"

/* Chủ nhà 30/09/2026: làm lại màn Kho hàng / Phiếu kho / Chi tiết phiếu trên điện thoại. */

describe("Kho hàng điện thoại — thẻ giá trị", () => {
  it("đếm SKU khác nhau và cộng SL CƠ SỞ, bỏ lô hết hàng", () => {
    expect(
      tomTatTonKho([
        { product_id: "a", qty_on_hand: 10 },
        { product_id: "a", qty_on_hand: 5 },
        { product_id: "b", qty_on_hand: "3" },
        { product_id: "c", qty_on_hand: 0 },
      ])
    ).toEqual({ soSku: 2, soDonVi: 18 })
  })

  it("cảnh báo lô: rỗng khi không có gì, ghép hai phần khi có", () => {
    expect(canhBaoLo(0, 0)).toBeNull()
    expect(canhBaoLo(2, 0)).toBe("2 lô sắp hết hạn")
    expect(canhBaoLo(1, 3)).toBe("1 lô sắp hết hạn · 3 lô cần đẩy hàng")
  })
})

describe("Kho hàng điện thoại — sắp xếp tồn", () => {
  const r = (name: string, totalQty: number, totalValue: number) => ({ product: { name }, totalQty, totalValue })
  const ds = [r("bánh", 5, 100), r("Ăn", 50, 10), r("Cà", 5, 900)]

  it("tên theo tiếng Việt (chữ thường không bị xếp sau chữ hoa)", () => {
    expect(sapXepTon(ds, "ten").map((x) => x.product.name)).toEqual(["Ăn", "bánh", "Cà"])
  })
  it("giá trị cao trước; tồn nhiều trước, trùng số thì theo tên", () => {
    expect(sapXepTon(ds, "gia-tri").map((x) => x.product.name)).toEqual(["Cà", "bánh", "Ăn"])
    expect(sapXepTon(ds, "so-luong").map((x) => x.product.name)).toEqual(["Ăn", "bánh", "Cà"])
  })
  it("không đổi mảng gốc; chip vòng qua đủ ba cách", () => {
    sapXepTon(ds, "gia-tri")
    expect(ds[0].product.name).toBe("bánh")
    expect(sapXepKeTiep("ten")).toBe("gia-tri")
    expect(sapXepKeTiep("so-luong")).toBe("ten")
    expect(nhanSapXep("ten")).toBe("Tên A–Z")
  })
})

describe("Phiếu kho điện thoại — số lượng quy về đơn vị cơ sở", () => {
  it("ưu tiên qty_in_base_uom chụp trên dòng, không có thì SL × hệ số", () => {
    expect(slCoSoDong({ quantity: 2, qty_in_base_uom: 48, conversion_factor_snapshot: 24 })).toBe(48)
    expect(slCoSoDong({ quantity: 2, conversion_factor_snapshot: 24 })).toBe(48)
    expect(slCoSoDong({ quantity: 3 })).toBe(3)
  })

  it("nhập +, xuất −, chuyển không dấu, kiểm kê = tổng chênh có dấu", () => {
    const ls = [{ quantity: 2, conversion_factor_snapshot: 24 }, { quantity: 5 }]
    expect(soLuongPhieu("import", ls)).toBe(53)
    expect(soLuongPhieu("export", ls)).toBe(-53)
    expect(soLuongPhieu("transfer", ls)).toBe(53)
    expect(soLuongPhieu("stocktake", [{ quantity: 15 }, { quantity: -3 }])).toBe(12)
    expect(soLuongPhieu("export", [])).toBeNull()
  })

  it("nhãn số lượng như mẫu", () => {
    expect(nhanSoLuong("export", -15)).toBe("−15")
    expect(nhanSoLuong("stocktake", 12)).toBe("+12")
    expect(nhanSoLuong("transfer", 24)).toBe("24")
    expect(nhanSoLuong("import", null)).toBe("—")
    expect(nhanSoLuong("import", 1500)).toBe("+1.500")
  })

  it("tóm tắt chi tiết: đơn vị chỉ ghi khi mọi dòng cùng đơn vị cơ sở", () => {
    const goi = { base_unit: "gói" }
    expect(tomTatDong("export", [
      { product_id: "a", quantity: 5, product: goi },
      { product_id: "b", quantity: 10, product: goi },
    ])).toEqual({ soSku: 2, tong: 15, donVi: "gói" })
    expect(tomTatDong("export", [
      { product_id: "a", quantity: 1, conversion_factor_snapshot: 24, product: { base_unit: "hộp" } },
      { product_id: "b", quantity: 2, product: goi },
    ])).toEqual({ soSku: 2, tong: 26, donVi: "đơn vị" })
    expect(tomTatDong("stocktake", [{ product_id: "a", quantity: -4, product: goi }]).tong).toBe(-4)
    expect(nhanTongSoLuong("export")).toBe("Tổng xuất")
  })
})

describe("Phiếu kho điện thoại — nhóm ngày theo giờ VN", () => {
  // 30/09/2026 10:00 giờ VN
  const now = new Date("2026-09-30T03:00:00Z")

  it("Hôm nay / Hôm qua / Thứ, dd/MM/yyyy", () => {
    expect(nhanNgayPhieu("2026-09-30T01:00:00Z", now)).toBe("Hôm nay")
    // 29/09 20:00 UTC = 30/09 03:00 VN → vẫn "Hôm nay"
    expect(nhanNgayPhieu("2026-09-29T20:00:00Z", now)).toBe("Hôm nay")
    expect(nhanNgayPhieu("2026-09-29T08:00:00Z", now)).toBe("Hôm qua")
    expect(nhanNgayPhieu("2026-09-28T08:00:00Z", now)).toBe("Thứ Hai, 28/09/2026")
    expect(nhanNgayPhieu("2026-09-20T08:00:00Z", now)).toBe("Chủ nhật, 20/09/2026")
  })

  it("giữ thứ tự đầu vào, gom cùng ngày", () => {
    const g = nhomPhieuTheoNgay(
      [
        { id: 1, created_at: "2026-09-30T02:00:00Z" },
        { id: 2, created_at: "2026-09-30T01:00:00Z" },
        { id: 3, created_at: "2026-09-26T09:00:00Z" },
      ],
      now
    )
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ["Hôm nay", [1, 2]],
      ["Thứ Bảy, 26/09/2026", [3]],
    ])
  })
})

describe("Phiếu kho điện thoại — trạng thái, dòng phụ", () => {
  it("Chờ duyệt chỉ cho kiểm kê nháp", () => {
    expect(trangThaiPhieu("stocktake", "draft").label).toBe("Chờ duyệt")
    expect(trangThaiPhieu("import", "draft").label).toBe("Nháp")
    expect(trangThaiPhieu("stocktake", "posted").label).toBe("Đã duyệt")
    expect(trangThaiPhieu("export", "posted").label).toBe("Đã ghi sổ")
    expect(trangThaiPhieu("export", "cancelled").label).toBe("Đã huỷ")
    expect(trangThaiPhieu("export", null).label).toBe("Đã ghi sổ")
  })

  it("chuyển kho ghi tuyến + SKU; phiếu khác ghi chú hoặc số dòng · người tạo", () => {
    expect(dongPhuPhieu({ type: "transfer", warehouse_zone: "date", dest_warehouse_zone: "sale" }, 4, 4))
      .toBe("Kho date → Kho bán · 4 SKU")
    expect(dongPhuPhieu({ type: "stocktake", notes: null, creator: { full_name: "Chủ NPP" } }, 1, 1))
      .toBe("1 dòng · Chủ NPP")
    expect(dongPhuPhieu({ type: "export", notes: "Xuất theo đơn HD-0497" }, null, null)).toBe("Xuất theo đơn HD-0497")
  })

  it("băng trạng thái chi tiết theo loại", () => {
    expect(bangTrangThai("export", "posted")).toEqual({ text: "Đã bàn giao cho lái xe · tồn kho đã trừ", tone: "xanh" })
    expect(bangTrangThai("stocktake", "draft").tone).toBe("vang")
    expect(bangTrangThai("import", "cancelled").tone).toBe("do")
  })
})

describe("ba màn kho dựng bản điện thoại riêng, máy tính giữ nguyên", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
  const KHO = read("src/app/(dashboard)/inventory/page.tsx")
  const DS = read("src/app/(dashboard)/inventory/entries/page.tsx")
  const CT = read("src/app/(dashboard)/inventory/entries/[id]/page.tsx")
  const BANG = read("src/components/inventory/stock-balance-table.tsx")

  it("Kho hàng: bản điện thoại + phần máy tính ẩn dưới lg; bảng tồn chỉ dựng cho khổ đang dùng", () => {
    expect(KHO).toContain("<KhoHangDienThoai")
    expect(KHO).toContain('<div className="space-y-6 max-lg:hidden">')
    expect(KHO).toContain("khoMay === true && <StockBalanceTable />")
    expect(KHO).toContain("khoMay === false ? (dauMuc) => <StockBalanceTable dienThoai dauMuc={dauMuc} />")
    // Bản điện thoại dùng CÙNG `pivot` (đọc đủ) và cùng nút xuất — không đọc riêng.
    expect(BANG).toContain("rows={pivot}")
    expect(BANG).toContain("onClick={handleExport}")
  })

  it("Phiếu kho: màn điện thoại riêng, DocListLayout không còn thẻ / đầu xanh chung", () => {
    expect(DS).toContain("<PhieuKhoDienThoai")
    expect(DS).toContain("cards={null}")
    expect(DS).not.toContain("mobileHead={")
  })

  it("Chi tiết phiếu: bản điện thoại dùng đúng luồng huỷ / xoá / in của trang", () => {
    expect(CT).toContain("<ChiTietPhieuDienThoai")
    expect(CT).toContain("onCancel={() => setCancelOpen(true)}")
    expect(CT).toContain('canCancel={!!canEdit && entry.status !== "cancelled"}')
    expect(CT).toContain("onInPhieu={inPhieuXuat}")
    expect(CT).toContain('<div className="space-y-4 max-lg:hidden">')
  })
})

describe("giờ cập nhật Kho hàng theo giờ VN", () => {
  it("không theo múi giờ của máy", async () => {
    const { readFileSync } = await import("node:fs")
    const s = readFileSync("src/app/(dashboard)/inventory/page.tsx", "utf8")
    const i = s.indexOf("const timeLabel = now.toLocaleTimeString(")
    expect(s.slice(i, s.indexOf("})", i))).toContain('timeZone: "Asia/Ho_Chi_Minh"')
  })
})
