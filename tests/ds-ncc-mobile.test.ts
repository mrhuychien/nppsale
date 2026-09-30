import { describe, it, expect } from "vitest"
import {
  chuCaiDau,
  khoaNhomChuCai,
  khoaTrungTen,
  nhomTheoChuCai,
  timTrungTen,
  nhanTrungTen,
  nhanSoNcc,
  dongPhuNcc,
} from "@/lib/suppliers/mobile-list"

/** Thiết kế "ds-ncc" (chủ nhà 30/09/2026): nhóm chữ cái, trùng tên. */
describe("ds-ncc điện thoại — nhóm theo chữ cái", () => {
  it("ô chữ cái giữ dấu, khoá nhóm bỏ dấu, Đ riêng", () => {
    expect(chuCaiDau(" á châu")).toBe("Á")
    expect(chuCaiDau("Ăn Cùng")).toBe("Ă")
    expect(chuCaiDau("")).toBe("?")
    expect(khoaNhomChuCai("Á Châu")).toBe("A")
    expect(khoaNhomChuCai("Ăn Cùng Bà Tuyết")).toBe("A")
    expect(khoaNhomChuCai("Ân")).toBe("A")
    expect(khoaNhomChuCai("Đông Trùng")).toBe("Đ")
    expect(khoaNhomChuCai("đức minh")).toBe("Đ")
    expect(khoaNhomChuCai("Ơn")).toBe("O")
    expect(khoaNhomChuCai("3A Food")).toBe("#")
    // NFD (chữ gõ tổ hợp) vẫn ra đúng.
    expect(khoaNhomChuCai("Á Châu")).toBe("A")
    expect(chuCaiDau("á Châu")).toBe("Á")
  })

  it("nhóm A gộp Á / Ă, D rồi Đ rồi E, # cuối; trong nhóm xếp tiếng Việt", () => {
    const rows = [
      { name: "E Hưng" },
      { name: "Đông Trùng Hạ Thảo" },
      { name: "Ăn Cùng Bà Tuyết" },
      { name: "Detech Connai" },
      { name: "3A" },
      { name: "An Phát" },
      { name: "Á Châu" },
      { name: "Asianfood" },
      { name: "Bánh Bao" },
    ]
    const g = nhomTheoChuCai(rows)
    expect(g.map((x) => x.chu)).toEqual(["A", "B", "D", "Đ", "E", "#"])
    const a = g[0].items.map((x) => x.name)
    expect(a).toHaveLength(4)
    expect(a).toEqual([...a].sort((x, y) => x!.localeCompare(y!, "vi")))
    expect(a.indexOf("An Phát")).toBeLessThan(a.indexOf("Asianfood"))
  })
})

describe("ds-ncc điện thoại — trùng tên", () => {
  it("so không dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa", () => {
    expect(khoaTrungTen("  Detech   CONNAI ")).toBe(khoaTrungTen("Detech Connai"))
    expect(khoaTrungTen("Đức Minh")).toBe(khoaTrungTen("duc minh"))
    const t = timTrungTen([
      { id: "1", name: "Detech Connai" },
      { id: "2", name: " detech  connai" },
      { id: "3", name: "An Phát" },
      { id: "4", name: "Cầu Vồng" },
      { id: "5", name: "Cau Vong" },
      { id: "6", name: "" },
      { id: "7", name: null },
    ])
    expect(t.nhom).toEqual([
      { ten: "Cầu Vồng", ids: ["4", "5"] },
      { ten: "Detech Connai", ids: ["1", "2"] },
    ])
    expect(t.ids.sort()).toEqual(["1", "2", "4", "5"])
    expect(t.khoa.has(khoaTrungTen("DETECH CONNAI"))).toBe(true)
    expect(t.khoa.has(khoaTrungTen("An Phát"))).toBe(false)
    // Tên rỗng không coi là trùng nhau.
    expect(t.khoa.has("")).toBe(false)
  })

  it("nhãn băng cảnh báo, số đếm, dòng phụ", () => {
    expect(nhanTrungTen(timTrungTen([{ id: "1", name: "A" }]))).toBeNull()
    expect(nhanTrungTen(timTrungTen([{ id: "1", name: "Detech Connai" }, { id: "2", name: "detech connai" }]))).toEqual({
      tieuDe: "1 nhà cung cấp bị trùng tên",
      phu: "Detech Connai",
    })
    expect(nhanSoNcc(1234)).toBe("1.234 nhà cung cấp")
    expect(dongPhuNcc({ code: "NCC1", phone: " 0912 " })).toBe("NCC1 · 0912")
    expect(dongPhuNcc({ code: "NCC1", phone: null })).toBe("NCC1")
  })
})
