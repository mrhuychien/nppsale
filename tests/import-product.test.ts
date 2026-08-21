import { describe, it, expect } from "vitest"
import {
  parseProductSheet,
  groupRowsForImport,
} from "@/lib/products/import-parse"

/**
 * Đọc file Excel sản phẩm do người dùng tải lên.
 *
 * Vì sao đáng test kỹ: đây là cửa nhận dữ liệu KHÔNG kiểm soát được. Sai
 * một bước là hàng nghìn sản phẩm vào database với giá sai, đơn vị sai,
 * hoặc hệ số quy đổi sai — mà hệ số quy đổi sai thì MỌI phép cộng trừ tồn
 * kho về sau đều sai theo.
 *
 * Phải đọc được hai kiểu file:
 *   • File mẫu của dự án: đơn vị quy đổi nằm ở 2 cột riêng cùng dòng.
 *   • File KiotViet xuất ra: mỗi đơn vị quy đổi là MỘT DÒNG SKU riêng, nối
 *     với sản phẩm gốc qua cột "Mã ĐVT Cơ bản".
 */

/** Dựng mảng 2 chiều như xlsx sheet_to_json{header:1} trả về. */
const sheet = (header: string[], ...rows: unknown[][]) => [header, ...rows]

const BASIC = ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp"]

describe("parseProductSheet — cấu trúc file", () => {
  it("file rỗng hoặc chỉ có header thì báo lỗi cấu trúc", () => {
    expect(parseProductSheet([]).headerError).toBeTruthy()
    expect(parseProductSheet([BASIC]).headerError).toBeTruthy()
  })

  it("thiếu cột Tên sản phẩm thì CHẶN toàn bộ, không nhập một phần", () => {
    const r = parseProductSheet(sheet(["Đơn vị tính", "Nhà cung cấp"], ["hộp", "NCC A"]))
    expect(r.headerError).toContain("Tên sản phẩm")
    expect(r.rows).toEqual([])
  })

  it("thiếu cột Đơn vị tính thì cũng chặn", () => {
    const r = parseProductSheet(sheet(["Tên sản phẩm", "Nhà cung cấp"], ["Sữa", "NCC A"]))
    expect(r.headerError).toContain("Đơn vị tính")
  })

  it("bỏ qua dòng trống hoàn toàn, không đếm là lỗi", () => {
    const r = parseProductSheet(sheet(BASIC, ["Sữa", "hộp", "NCC A"], ["", "", ""], ["Bánh", "gói", "NCC B"]))
    expect(r.rows).toHaveLength(2)
  })

  it("số dòng báo lỗi tính theo dòng THẬT trong file (có header)", () => {
    // Người dùng phải mở đúng dòng đó trong Excel để sửa.
    const r = parseProductSheet(sheet(BASIC, ["Sữa", "hộp", "NCC A"], ["", "gói", "NCC B"]))
    expect(r.rows[1].rowNo).toBe(3)
  })
})

describe("nhận diện tên cột — bỏ dấu, bỏ ngoặc, bỏ dấu sao", () => {
  it("khớp được header có dấu tiếng Việt và dấu sao bắt buộc", () => {
    const r = parseProductSheet(
      sheet(["Tên sản phẩm*", "Đơn vị tính*", "Nhà cung cấp*"], ["Sữa", "hộp", "NCC A"])
    )
    expect(r.headerError).toBeNull()
    expect(r.rows[0].name).toBe("Sữa")
  })

  it("khớp được header viết HOA và có phần trong ngoặc", () => {
    const r = parseProductSheet(
      sheet(["TÊN HÀNG", "ĐVT", "Nhà Cung Cấp", "Thuế VAT (%)"], ["Sữa", "hộp", "NCC A", "10"])
    )
    expect(r.rows[0].name).toBe("Sữa")
    expect(r.rows[0].vat_rate).toBeCloseTo(0.1)
  })

  it('KHÔNG nhầm "Đơn vị quy đổi" thành "Đơn vị tính"', () => {
    // Nhầm ở đây là toàn bộ sản phẩm vào kho với sai đơn vị cơ sở.
    const r = parseProductSheet(
      sheet(
        ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp", "Đơn vị quy đổi", "Hệ số quy đổi"],
        ["Sữa", "hộp", "NCC A", "thùng", "12"]
      )
    )
    expect(r.rows[0].base_unit).toBe("hộp")
    expect(r.rows[0].secondary_unit).toBe("thùng")
  })

  it("cột trùng tên thì lấy cột ĐẦU TIÊN, không ghi đè", () => {
    const r = parseProductSheet(
      sheet(["Tên sản phẩm", "Tên hàng", "Đơn vị tính", "Nhà cung cấp"], ["Đúng", "Sai", "hộp", "NCC A"])
    )
    expect(r.rows[0].name).toBe("Đúng")
  })
})

describe("đọc số tiền và thuế", () => {
  const withPrice = (gia: unknown) =>
    parseProductSheet(
      sheet([...BASIC, "Giá bán"], ["Sữa", "hộp", "NCC A", gia])
    ).rows[0]

  it('định dạng Việt Nam "15.000" ra 15000, không phải 15', () => {
    expect(withPrice("15.000").sell_price).toBe(15000)
  })

  it('có ký hiệu tiền tệ vẫn đọc được', () => {
    expect(withPrice("15.000 ₫").sell_price).toBe(15000)
    expect(withPrice("15,000").sell_price).toBe(15000)
  })

  it("ô là số thì làm tròn", () => {
    expect(withPrice(15000.6).sell_price).toBe(15001)
  })

  it("giá âm không lọt vào database", () => {
    // Ghi lại một điểm KHÔNG NHẤT QUÁN đang có: ô là SỐ -5000 bị ép về 0,
    // còn ô là CHUỖI "-5000" bị bỏ dấu trừ thành 5000. Cả hai đều là dữ
    // liệu rác nên không chặn luồng nhập, nhưng đừng "sửa" một vế mà quên
    // vế kia nếu sau này chuẩn hoá lại.
    expect(withPrice(-5000).sell_price).toBe(0)
    expect(withPrice("-5000").sell_price).toBe(5000)
  })

  it("ô trống ra 0, không thành NaN", () => {
    expect(withPrice("").sell_price).toBe(0)
    expect(Number.isNaN(withPrice("abc").sell_price)).toBe(false)
  })

  const withVat = (v: unknown) =>
    parseProductSheet(sheet([...BASIC, "Thuế VAT"], ["Sữa", "hộp", "NCC A", v])).rows[0].vat_rate

  it('VAT nhận cả "10%", "10" và 0.1 — đều ra 0,1', () => {
    expect(withVat("10%")).toBeCloseTo(0.1)
    expect(withVat("10")).toBeCloseTo(0.1)
    expect(withVat(0.1)).toBeCloseTo(0.1)
  })

  it("VAT dùng dấu phẩy thập phân kiểu Việt Nam", () => {
    expect(withVat("0,08")).toBeCloseTo(0.08)
  })

  it("VAT trống thì mặc định 10%, không phải 0", () => {
    // Mặc định 0 sẽ làm mọi hoá đơn thiếu thuế.
    expect(withVat("")).toBeCloseTo(0.1)
    expect(withVat("linh tinh")).toBeCloseTo(0.1)
  })

  it("VAT 0% được giữ nguyên là 0", () => {
    expect(withVat("0%")).toBe(0)
  })
})

describe("kiểm tra từng dòng", () => {
  it("thiếu tên sản phẩm → báo lỗi dòng đó", () => {
    const r = parseProductSheet(sheet(BASIC, ["", "hộp", "NCC A"]))
    expect(r.rows[0].errors).toContain("Thiếu tên sản phẩm")
  })

  it("dòng gốc thiếu nhà cung cấp → báo lỗi", () => {
    const r = parseProductSheet(sheet(BASIC, ["Sữa", "hộp", ""]))
    expect(r.rows[0].errors).toContain("Thiếu nhà cung cấp")
  })

  it("dòng ĐƠN VỊ QUY ĐỔI (có Mã ĐVT Cơ bản) KHÔNG cần nhà cung cấp", () => {
    // Nó kế thừa NCC của sản phẩm cha. Bắt buộc ở đây là chặn nhầm file
    // KiotViet hợp lệ.
    const r = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa thùng", "thùng", "", "SUA-T", "SUA", "12"]
      )
    )
    expect(r.rows[0].errors).toEqual([])
  })

  it("đơn vị quy đổi mà hệ số <= 0 → báo lỗi", () => {
    // Hệ số 0 sẽ làm mọi phép quy đổi tồn kho ra 0.
    const mk = (he_so: unknown) =>
      parseProductSheet(
        sheet([...BASIC, "Đơn vị quy đổi", "Hệ số quy đổi"], ["Sữa", "hộp", "NCC A", "thùng", he_so])
      ).rows[0]
    expect(mk("0").errors).toContain("Đơn vị quy đổi cần hệ số > 0")
    expect(mk("").errors).toContain("Đơn vị quy đổi cần hệ số > 0")
  })

  it("đơn vị quy đổi trùng đơn vị tính → báo lỗi (không phân biệt hoa thường)", () => {
    const r = parseProductSheet(
      sheet([...BASIC, "Đơn vị quy đổi", "Hệ số quy đổi"], ["Sữa", "Hộp", "NCC A", "hộp", "12"])
    )
    expect(r.rows[0].errors).toContain("Đơn vị quy đổi trùng đơn vị tính")
  })

  it('đơn vị tính trống ở dòng gốc thì mặc định "cái", không chặn', () => {
    const r = parseProductSheet(sheet(BASIC, ["Sữa", "", "NCC A"]))
    expect(r.rows[0].base_unit).toBe("cái")
    expect(r.rows[0].errors).toEqual([])
  })
})

describe("các trường riêng của KiotViet", () => {
  it('"Tồn lớn nhất" = 999999999 nghĩa là không giới hạn → null', () => {
    const r = parseProductSheet(
      sheet([...BASIC, "Tồn lớn nhất"], ["Sữa", "hộp", "NCC A", "999999999"])
    )
    expect(r.rows[0].max_stock).toBeNull()
  })

  it("tồn lớn nhất số thường thì giữ nguyên", () => {
    const r = parseProductSheet(sheet([...BASIC, "Tồn lớn nhất"], ["Sữa", "hộp", "NCC A", "500"]))
    expect(r.rows[0].max_stock).toBe(500)
  })

  it('"Đang kinh doanh" 0/1 map thành trạng thái', () => {
    const st = (v: unknown) =>
      parseProductSheet(sheet([...BASIC, "Đang kinh doanh"], ["Sữa", "hộp", "NCC A", v])).rows[0].status
    expect(st("1")).toBe("active")
    expect(st("0")).toBe("inactive")
    expect(st("")).toBe("active")
    expect(st("Ngừng bán")).toBe("inactive")
  })

  it("bán trực tiếp mặc định là có khi cột trống", () => {
    const r = parseProductSheet(sheet(BASIC, ["Sữa", "hộp", "NCC A"]))
    expect(r.rows[0].direct_sale).toBe(true)
  })
})

describe("groupRowsForImport — gộp dòng đơn vị quy đổi vào sản phẩm gốc", () => {
  /** File KiotViet: 1 dòng gốc + 2 dòng quy đổi trỏ về nó. */
  const kiotviet = () =>
    parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa hộp", "hộp", "NCC A", "SUA", "", ""],
        ["Sữa lốc", "lốc", "", "SUA-L", "SUA", "6"],
        ["Sữa thùng", "thùng", "", "SUA-T", "SUA", "24"]
      )
    ).rows

  it("chỉ dòng gốc thành sản phẩm, dòng quy đổi thành đơn vị", () => {
    const g = groupRowsForImport(kiotviet())
    expect(g.baseRows).toHaveLength(1)
    expect(g.baseRows[0].sku).toBe("SUA")
    expect(g.unitsByParentSku["SUA"]).toEqual([
      { unit_name: "lốc", conversion: 6 },
      { unit_name: "thùng", conversion: 24 },
    ])
  })

  it("dòng quy đổi trỏ tới SKU KHÔNG có trong file → xếp vào mồ côi, không im lặng bỏ", () => {
    // Bỏ im lặng là người dùng mất hàng mà không biết vì sao.
    const rows = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa thùng", "thùng", "", "SUA-T", "KHONG-CO", "24"]
      )
    ).rows
    const g = groupRowsForImport(rows)
    expect(g.baseRows).toHaveLength(0)
    expect(g.orphanedRows).toHaveLength(1)
  })

  it("dòng có LỖI bị loại trước khi gộp", () => {
    const rows = parseProductSheet(
      sheet([...BASIC, "SKU"], ["", "hộp", "NCC A", "LOI"], ["Sữa", "hộp", "NCC A", "SUA"])
    ).rows
    const g = groupRowsForImport(rows)
    expect(g.baseRows.map((r) => r.sku)).toEqual(["SUA"])
  })

  it("hệ số nhỏ hơn 1 bị BÁO LỖI, không lặng lẽ nhập sai", () => {
    // Trước đây "0,167" bị đọc thành 167 (parseMoney xoá dấu thập phân) →
    // đơn vị đó vào kho với hệ số gấp 1000 lần. Nay phải là lỗi rõ ràng.
    const rows = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa hộp", "hộp", "NCC A", "SUA", "", ""],
        ["Sữa lẻ", "lẻ", "", "SUA-X", "SUA", "0,167"]
      )
    ).rows
    expect(rows[1].errors.join(" ")).toContain("nhỏ hơn 1")
    // Dòng lỗi bị loại khỏi phần gộp.
    const g = groupRowsForImport(rows)
    expect(g.unitsByParentSku["SUA"]).toBeUndefined()
  })

  it("trùng tên đơn vị trong cùng sản phẩm thì chỉ giữ một", () => {
    const rows = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa hộp", "hộp", "NCC A", "SUA", "", ""],
        ["Sữa thùng", "Thùng", "", "SUA-T1", "SUA", "24"],
        ["Sữa thùng", "thùng", "", "SUA-T2", "SUA", "12"]
      )
    ).rows
    const g = groupRowsForImport(rows)
    expect(g.unitsByParentSku["SUA"]).toHaveLength(1)
  })

  it("file mẫu (2 cột riêng, không có cột Mã ĐVT Cơ bản) vẫn chạy đúng", () => {
    const rows = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Đơn vị quy đổi", "Hệ số quy đổi"],
        ["Sữa", "hộp", "NCC A", "SUA", "thùng", "24"]
      )
    ).rows
    const g = groupRowsForImport(rows)
    expect(g.baseRows).toHaveLength(1)
    expect(g.unitsByParentSku["SUA"]).toEqual([{ unit_name: "thùng", conversion: 24 }])
    expect(g.orphanedRows).toHaveLength(0)
  })

  it("không có dòng nào thì trả về cấu trúc rỗng, không ném", () => {
    expect(groupRowsForImport([])).toEqual({
      baseRows: [], unitsByParentSku: {}, orphanedRows: [],
    })
  })
})

describe("hệ số quy đổi — đọc đúng dấu thập phân", () => {
  const conv = (raw: unknown) =>
    parseProductSheet(
      sheet([...BASIC, "Đơn vị quy đổi", "Hệ số quy đổi"], ["Sữa", "hộp", "NCC A", "thùng", raw])
    ).rows[0]

  it("số nguyên đọc bình thường", () => {
    expect(conv("12").conversion).toBe(12)
    expect(conv(24).conversion).toBe(24)
  })

  it('"1.688" là 1,688 chứ KHÔNG phải 1688', () => {
    // Đây là lỗi thật đã sửa: parseMoney xoá dấu chấm nên hệ số bị nhân
    // 1000, và mọi phép cộng trừ tồn kho của sản phẩm đó sai theo.
    expect(conv("1.688").conversion).toBeCloseTo(1.688)
    expect(conv(1.688).conversion).toBeCloseTo(1.688)
  })

  it('dấu phẩy thập phân kiểu Việt Nam "1,5" ra 1,5', () => {
    expect(conv("1,5").conversion).toBeCloseTo(1.5)
  })

  it("hệ số >= 1 dạng thập phân được làm tròn khi gộp", () => {
    const rows = parseProductSheet(
      sheet(
        [...BASIC, "SKU", "Mã ĐVT Cơ bản", "Quy đổi"],
        ["Sữa hộp", "hộp", "NCC A", "SUA", "", ""],
        ["Sữa lốc", "lốc", "", "SUA-L", "SUA", "1.688"]
      )
    ).rows
    expect(rows[1].errors).toEqual([])
    const g = groupRowsForImport(rows)
    expect(g.unitsByParentSku["SUA"][0].conversion).toBe(2)
  })
})
