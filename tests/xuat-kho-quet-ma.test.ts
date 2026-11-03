import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ketQuaQuetXuat } from "@/lib/inventory/stock-issue"
import { findByCode } from "@/lib/sell/scan"

/**
 * CHỦ NHÀ 03/11/2026: "có sửa luôn đi em" — quét mã vạch ở Xuất kho phải ra hàng.
 * Màn xuất kho đang dùng là Phiếu xuất kho (`/inventory/stock-issue`) — nay có nút quét (bộ quét chung, camera + nhập tay).
 * Màn cũ `/inventory/stock-out` (tra `p.sku === code`, mã vạch thật không bao giờ ra) đã chặn từ 22/09/2026, không dùng.
 */

const SP = [
  { id: "sua", sku: "SUA1", barcode: "8930000000011", name: "Sữa hộp" },
  { id: "mi", sku: "MI1", barcode: "8930000000028", name: "Mì tôm" },
  { id: "keo", sku: "8930000000011X", barcode: null, name: "Kẹo" },
]
const TRONG = new Set<string>()

describe("quét mã ở phiếu xuất kho", () => {
  it("mã VẠCH tra ra hàng (không chỉ SKU) — kèm ký tự xuống dòng máy quét gửi, khác hoa thường ở SKU", () => {
    expect(ketQuaQuetXuat(SP, TRONG, "8930000000011")).toEqual({ loai: "them", sp: SP[0] })
    expect(ketQuaQuetXuat(SP, TRONG, " 8930000000028\r\n")).toEqual({ loai: "them", sp: SP[1] })
    expect(ketQuaQuetXuat(SP, TRONG, "mi1")).toEqual({ loai: "them", sp: SP[1] })
  })

  it("hàng ĐÃ trên phiếu → báo đã có, không thêm dòng thứ hai", () => {
    expect(ketQuaQuetXuat(SP, new Set(["sua"]), "8930000000011")).toEqual({ loai: "da-co", sp: SP[0] })
  })

  it("mã không có trong danh mục / mã rỗng → không tìm thấy (kèm mã đã chuẩn hoá để báo lại)", () => {
    expect(ketQuaQuetXuat(SP, TRONG, " 123\n")).toEqual({ loai: "khong-thay", ma: "123" })
    expect(ketQuaQuetXuat(SP, TRONG, "")).toEqual({ loai: "khong-thay", ma: "" })
  })

  it("findByCode nhận mọi kiểu sản phẩm có mã vạch / SKU (một luật cho bán hàng + kho), mã vạch ưu tiên hơn SKU", () => {
    const lech = [
      { id: "a", sku: "999", barcode: "888", ton: 1 },
      { id: "b", sku: "111", barcode: "999", ton: 2 },
    ]
    expect(findByCode(lech, "999")?.id).toBe("b")
    expect(findByCode(lech, "999")?.ton).toBe(2) // giữ nguyên kiểu của nơi gọi
  })

  it("màn Phiếu xuất kho nối nút quét vào bộ quét chung và đi qua ketQuaQuetXuat — không tự so `sku === code`", () => {
    const man = readFileSync(resolve(__dirname, "..", "src/app/(dashboard)/inventory/stock-issue/page.tsx"), "utf-8")
    expect(man).toMatch(/<BarcodeScanner[\s\S]*?onScan=\{nhanMaQuet\}/)
    expect(man).toMatch(/ketQuaQuetXuat\(products, onSlip, raw\)/)
    expect(man).not.toMatch(/sku === code/)
  })
})
