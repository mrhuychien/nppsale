/**
 * Chủ nhà 27/09/2026: "Viết lại giao diện danh sách trả hàng trên mobile của nhân viên bán hàng theo
 * mẫu" — nhóm ngày "Hôm nay · 26/09", kho gợi ý theo lý do, màu trạng thái, không app bar chồng.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { khoGoiY, nhanNgayTra, ngayNhomTra, nhomTraTheoNgay, toneTra, viTatTen, TAB_TRA_MOBILE } from "@/lib/returns/mobile-list"
import { hidesMobileAppBar } from "@/lib/nav/mobile-chrome"

// 26/09/2026 10:00 giờ VN.
const NOW = new Date("2026-09-26T03:00:00Z")

describe("nhóm ngày theo mẫu", () => {
  it("Hôm nay · dd/MM, Hôm qua · dd/MM, còn lại dd/MM", () => {
    expect(nhanNgayTra("2026-09-26", NOW)).toBe("Hôm nay · 26/09")
    expect(nhanNgayTra("2026-09-25", NOW)).toBe("Hôm qua · 25/09")
    expect(nhanNgayTra("2026-09-24", NOW)).toBe("24/09")
  })
  it("ngày chứng từ trước; không có thì ngày tạo theo GIỜ VN (6h sáng VN = hôm trước theo UTC)", () => {
    expect(ngayNhomTra({ return_date: "2026-09-20", created_at: "2026-09-26T01:00:00Z" })).toBe("2026-09-20")
    expect(ngayNhomTra({ return_date: null, created_at: "2026-09-25T23:30:00Z" })).toBe("2026-09-26")
  })
  it("gom phiếu cùng ngày, cộng tiền của nhóm, giữ thứ tự", () => {
    const g = nhomTraTheoNgay(
      [
        { id: "a", return_date: "2026-09-26", created_at: "", credit_note_amount: 148000 },
        { id: "b", return_date: "2026-09-26", created_at: "", credit_note_amount: 96000 },
        { id: "c", return_date: "2026-09-25", created_at: "", credit_note_amount: null },
      ],
      NOW
    )
    expect(g.map((x) => [x.label, x.items.length, x.total])).toEqual([
      ["Hôm nay · 26/09", 2, 244000],
      ["Hôm qua · 25/09", 1, 0],
    ])
  })
})

describe("kho gợi ý, trạng thái, tab", () => {
  it("hư hỏng / cận hạn / hết hạn → kho cận date; còn lại → kho bán", () => {
    expect(khoGoiY("damaged")).toBe("date")
    expect(khoGoiY("near_expiry")).toBe("date")
    expect(khoGoiY("expired")).toBe("date")
    expect(khoGoiY("wrong_item")).toBe("sale")
    expect(khoGoiY(null)).toBe("sale")
  })
  it("nhãn trạng thái tiếng Việt; tab mở đầu là Chờ xử lý, Tất cả đứng cuối", () => {
    expect(["submitted", "draft", "completed", "cancelled"].map((s) => toneTra(s).label)).toEqual([
      "Chờ xử lý", "Nháp", "Đã nhập kho", "Đã huỷ",
    ])
    expect(TAB_TRA_MOBILE[0].key).toBe("submitted")
    expect(TAB_TRA_MOBILE[TAB_TRA_MOBILE.length - 1].key).toBe("all")
  })
  it("chữ tắt ảnh đại diện", () => {
    expect(viTatTen("Phạm Thị Vĩnh")).toBe("PV")
    expect(viTatTen("Chủ NPP")).toBe("CN")
    expect(viTatTen("")).toBe("?")
  })
})

describe("khung màn", () => {
  it("điện thoại: /returns có đầu trang xanh riêng — ẩn app bar chuẩn", () => {
    expect(hidesMobileAppBar("/returns")).toBe(true)
    expect(hidesMobileAppBar("/returns/abc")).toBe(false)
  })
  it("hoàn thành / huỷ ở ngăn đi qua RPC và theo luật phiếu trả; kiểm quyền returns.approve", () => {
    const s = readFileSync("src/components/returns/mobile-return-sheet.tsx", "utf8")
    expect(s).toMatch(/completeReturn\(/)
    expect(s).toMatch(/cancelReturn\(/)
    expect(s).toMatch(/hanhDongPhieuTra\(/)
    expect(s).not.toMatch(/\.update\(\s*\{\s*status/)
    const p = readFileSync("src/app/(dashboard)/returns/page.tsx", "utf8")
    expect(p).toMatch(/hasPermission\(authUser\.role, "returns", "approve"\)/)
  })
})
