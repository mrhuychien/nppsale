/**
 * ẢNH ĐIỂM BÁN / ẢNH GIAO HÀNG NÉN TRƯỚC KHI TẢI LÊN — chủ nhà 24/10/2026 hỏi "chụp ảnh điểm bán đã resize ảnh trước khi
 * up chưa" rồi chốt "hạ xuống": cạnh dài tối đa 1024 px (từ 1280), JPEG 0,7. Một hàm `prepareImage` dùng chung cho ảnh
 * điểm bán (customer-photo-capture) và ảnh POD (pod-capture-sheet); phép tính kích thước tách ra `kichThuocSauNen`.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { JPEG_QUALITY, MAX_EDGE, kichThuocSauNen } from "@/lib/images/prepare"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("kichThuocSauNen — cạnh dài về 1024, giữ tỷ lệ, không phóng to", () => {
  it("cạnh dài tối đa 1024 px, chất lượng JPEG 0,7", () => {
    expect(MAX_EDGE).toBe(1024)
    expect(JPEG_QUALITY).toBe(0.7)
  })
  it("ảnh ngang 4000×3000 → 1024×768; ảnh dọc 3000×4000 → 768×1024", () => {
    expect(kichThuocSauNen(4000, 3000)).toEqual({ w: 1024, h: 768 })
    expect(kichThuocSauNen(3000, 4000)).toEqual({ w: 768, h: 1024 })
  })
  it("ảnh nhỏ hơn trần giữ nguyên (không phóng to); đúng trần giữ nguyên", () => {
    expect(kichThuocSauNen(800, 600)).toEqual({ w: 800, h: 600 })
    expect(kichThuocSauNen(1024, 1024)).toEqual({ w: 1024, h: 1024 })
  })
  it("làm tròn về số nguyên; trần truyền vào được (ảnh POD cùng luật)", () => {
    expect(kichThuocSauNen(1365, 1023)).toEqual({ w: 1024, h: 767 })
    expect(kichThuocSauNen(2000, 1000, 500)).toEqual({ w: 500, h: 250 })
  })
})

describe("prepareImage dùng kichThuocSauNen; hai màn chụp đều đi qua prepareImage", () => {
  it("canvas lấy kích thước từ kichThuocSauNen, xuất JPEG theo JPEG_QUALITY", () => {
    const PREP = read("src/lib/images/prepare.ts")
    expect(PREP).toContain("const { w, h } = kichThuocSauNen(bitmap.width, bitmap.height)")
    expect(PREP).toContain('canvas.toBlob(res, "image/jpeg", JPEG_QUALITY)')
  })
  it("ảnh điểm bán và ảnh POD đều nén trước khi tải lên", () => {
    expect(read("src/components/customers/customer-photo-capture.tsx")).toContain("const blob = await prepareImage(file, {")
    expect(read("src/components/deliveries/pod-capture-sheet.tsx")).toContain("const blob = await prepareImage(photo)")
    expect(read("CLAUDE.md")).toMatch(/cạnh dài tối\s+đa \*\*1024 px\*\* \(chủ nhà 24\/10\/2026 \*"hạ xuống"\* từ 1280\)/)
  })
})
