import { describe, it, expect } from "vitest"
import { viNormalize, viIncludes, viMatch, viMatchAllWords } from "@/lib/search"

/**
 * Tìm kiếm tiếng Việt.
 *
 * Đây là lỗi P0 trên bản mobile (MOB-01): nhân viên bán hàng gõ không dấu
 * trên điện thoại thì không tìm được khách hàng nào, tức là thao tác đầu
 * tiên của mỗi đơn hàng đã tắc ngay tại cửa hàng.
 */

describe("viNormalize — bỏ dấu", () => {
  it("bỏ dấu thanh trên nguyên âm", () => {
    expect(viNormalize("Bách Hoá Xanh")).toBe("bach hoa xanh")
    expect(viNormalize("Tuấn")).toBe("tuan")
    expect(viNormalize("Nguyễn Thị Hường")).toBe("nguyen thi huong")
  })

  it("xử lý được chữ đ và Đ — NFD KHÔNG tách được hai chữ này", () => {
    // Đây là chỗ mọi bản "bỏ dấu" viết vội đều sai: đ là ký tự riêng,
    // không phải d + dấu, nên normalize("NFD") không đụng tới.
    expect(viNormalize("Đông")).toBe("dong")
    expect(viNormalize("hàng đông lạnh")).toBe("hang dong lanh")
    expect(viNormalize("ĐẠI ĐOÀN KẾT")).toBe("dai doan ket")
  })

  it("phủ hết các nguyên âm có dấu của tiếng Việt", () => {
    expect(viNormalize("ăâêôơưáàảãạ")).toBe("aaeoouaaaaa")
    expect(viNormalize("ĂÂÊÔƠƯ")).toBe("aaeoou")
    expect(viNormalize("ỹỵỷỳý")).toBe("yyyyy")
  })

  it("hạ chữ thường", () => {
    expect(viNormalize("BÁCH HOÁ")).toBe("bach hoa")
  })

  it("gộp khoảng trắng thừa và cắt hai đầu", () => {
    expect(viNormalize("  Bách   Hoá  ")).toBe("bach hoa")
    expect(viNormalize("A\t\nB")).toBe("a b")
  })

  it("null / undefined / số đều không làm vỡ hàm", () => {
    expect(viNormalize(null)).toBe("")
    expect(viNormalize(undefined)).toBe("")
    expect(viNormalize(123)).toBe("123")
    expect(viNormalize("")).toBe("")
  })

  it("giữ nguyên chữ số và ký tự không dấu", () => {
    expect(viNormalize("Q.8")).toBe("q.8")
    expect(viNormalize("SKU-001843")).toBe("sku-001843")
  })
})

describe("viIncludes — khớp một trường", () => {
  it("gõ KHÔNG DẤU vẫn ra kết quả có dấu", () => {
    // Chính là ca bệnh MOB-01.
    expect(viIncludes("Bách Hoá Xanh Q.8", viNormalize("bach hoa xanh"))).toBe(true)
    expect(viIncludes("Tuấn", viNormalize("tuan"))).toBe(true)
  })

  it("gõ CÓ DẤU vẫn chạy như trước", () => {
    expect(viIncludes("Bách Hoá Xanh Q.8", viNormalize("Bách"))).toBe(true)
    expect(viIncludes("Bách Hoá Xanh Q.8", viNormalize("hoá xanh"))).toBe(true)
  })

  it("không phân biệt hoa thường", () => {
    expect(viIncludes("Bách Hoá Xanh", viNormalize("BÁCH"))).toBe(true)
    expect(viIncludes("bách hoá xanh", viNormalize("BACH"))).toBe(true)
  })

  it("khớp giữa chuỗi, không chỉ đầu chuỗi", () => {
    expect(viIncludes("Cửa hàng Bách Hoá Xanh", viNormalize("bach hoa"))).toBe(true)
  })

  it("chuỗi tìm rỗng thì khớp tất cả", () => {
    expect(viIncludes("bất kỳ", "")).toBe(true)
  })

  it("giá trị null không làm vỡ, chỉ là không khớp", () => {
    // Trước đây `c.phone.includes(q)` ném lỗi khi phone là null.
    expect(viIncludes(null, "abc")).toBe(false)
    expect(viIncludes(undefined, "abc")).toBe(false)
  })

  it("không khớp thì trả false", () => {
    expect(viIncludes("Bách Hoá Xanh", viNormalize("coffee"))).toBe(false)
  })
})

describe("viMatch — khớp bất kỳ trường nào", () => {
  const KH = {
    store_name: "Bách Hoá Xanh Q.8",
    owner_name: "Trần Văn Tuấn",
    phone: "09DEMO000008",
  }
  const m = (q: string) => viMatch(viNormalize(q), KH.store_name, KH.phone, KH.owner_name)

  it("khớp theo tên cửa hàng, không dấu", () => {
    expect(m("bach hoa xanh")).toBe(true)
  })

  it("khớp theo tên chủ cửa hàng, không dấu", () => {
    expect(m("tuan")).toBe(true)
    expect(m("tran van")).toBe(true)
  })

  it("khớp theo SĐT — kể cả mã có chữ HOA (ca bệnh MOB-02)", () => {
    // Lỗi cũ: chuỗi tìm bị lowercase còn phone thì không, nên "09DEMO000008"
    // không bao giờ khớp chính nó.
    expect(m("09DEMO000008")).toBe(true)
    expect(m("09demo000008")).toBe(true)
    expect(m("09DEMO")).toBe(true)
    expect(m("DEMO000008")).toBe(true)
    expect(m("000008")).toBe(true)
  })

  it("SĐT thật dạng số cũng khớp", () => {
    expect(viMatch(viNormalize("0912"), "0912345678")).toBe(true)
  })

  it("chuỗi tìm rỗng thì giữ nguyên toàn bộ danh sách", () => {
    expect(viMatch("", KH.store_name)).toBe(true)
  })

  it("không trường nào khớp thì false", () => {
    expect(m("khong co gi")).toBe(false)
  })

  it("một trường null không ảnh hưởng các trường còn lại", () => {
    expect(viMatch(viNormalize("tuan"), null, "Trần Văn Tuấn", undefined)).toBe(true)
  })
})

describe("viMatchAllWords — gõ rời rạc, thứ tự tuỳ ý", () => {
  const KH = { store_name: "Bách Hoá Xanh Q.8", owner_name: "Trần Văn Tuấn" }
  const m = (q: string) => viMatchAllWords(q, KH.store_name, KH.owner_name)

  it("mọi từ đều phải có mặt", () => {
    expect(m("bach xanh")).toBe(true)
    expect(m("bach coffee")).toBe(false)
  })

  it("thứ tự từ không quan trọng", () => {
    expect(m("xanh bach")).toBe(true)
  })

  it("từ có thể nằm ở các trường KHÁC NHAU", () => {
    // "xanh" ở tên cửa hàng, "tuan" ở tên chủ.
    expect(m("xanh tuan")).toBe(true)
  })

  it("bỏ dấu vẫn đúng", () => {
    expect(m("bach hoa q.8")).toBe(true)
  })

  it("khoảng trắng thừa không tạo từ rỗng làm hỏng kết quả", () => {
    expect(m("  bach    xanh  ")).toBe(true)
  })

  it("chuỗi tìm rỗng thì khớp tất cả", () => {
    expect(m("")).toBe(true)
    expect(m("   ")).toBe(true)
  })
})
