import { describe, it, expect } from "vitest"
import { parseCustomerSheet } from "@/lib/customers/import-parse"
import { parseSupplierSheet } from "@/lib/suppliers/import-parse"

/**
 * Đọc file Excel khách hàng và nhà cung cấp do người dùng tải lên.
 *
 * Cùng một cửa dữ liệu không kiểm soát được như file sản phẩm. Riêng ở đây
 * có thêm hai thứ ảnh hưởng tới TIỀN:
 *   • Hạn mức công nợ — nhập sai là hệ thống cho bán nợ quá mức.
 *   • Điều khoản thanh toán — nhập sai là ngày đến hạn sai, kéo theo toàn
 *     bộ phân nhóm tuổi nợ sai.
 */

const sheet = (header: string[], ...rows: unknown[][]) => [header, ...rows]

// ====================================================================
// KHÁCH HÀNG
// ====================================================================

describe("parseCustomerSheet — cấu trúc file", () => {
  it("file rỗng hoặc chỉ có header thì báo lỗi", () => {
    expect(parseCustomerSheet([]).headerError).toBeTruthy()
    expect(parseCustomerSheet([["Tên cửa hàng"]]).headerError).toBeTruthy()
  })

  it("thiếu cột Tên cửa hàng thì CHẶN toàn bộ", () => {
    const r = parseCustomerSheet(sheet(["SĐT"], ["0900000000"]))
    expect(r.headerError).toContain("Tên cửa hàng")
    expect(r.rows).toEqual([])
  })

  it("bỏ qua dòng trống", () => {
    const r = parseCustomerSheet(
      sheet(["Tên cửa hàng"], ["Tạp hoá A"], ["", ""], ["Tạp hoá B"])
    )
    expect(r.rows).toHaveLength(2)
  })

  it("nhận header có dấu và viết tắt", () => {
    const r = parseCustomerSheet(
      sheet(["TÊN KH", "SĐT", "Địa chỉ"], ["Tạp hoá A", "0900000000", "12 Lê Lợi"])
    )
    expect(r.headerError).toBeNull()
    expect(r.rows[0].store_name).toBe("Tạp hoá A")
    expect(r.rows[0].address).toBe("12 Lê Lợi")
  })
})

describe("khách hàng — chống trùng số điện thoại trong cùng file", () => {
  it("SĐT trùng ở dòng sau bị báo lỗi, dòng đầu vẫn hợp lệ", () => {
    // Trùng SĐT là hai bản ghi cho cùng một cửa hàng, công nợ sẽ bị tách đôi.
    const r = parseCustomerSheet(
      sheet(
        ["Tên cửa hàng", "SĐT"],
        ["Tạp hoá A", "0900000000"],
        ["Tạp hoá B", "0900000000"]
      )
    )
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors).toContain("Trùng SĐT trong file")
  })

  it("bỏ qua khoảng trắng khi so trùng", () => {
    const r = parseCustomerSheet(
      sheet(
        ["Tên cửa hàng", "SĐT"],
        ["Tạp hoá A", "090 000 0000"],
        ["Tạp hoá B", "0900000000"]
      )
    )
    expect(r.rows[1].errors).toContain("Trùng SĐT trong file")
  })

  it("nhiều dòng KHÔNG có SĐT thì không coi là trùng nhau", () => {
    const r = parseCustomerSheet(
      sheet(["Tên cửa hàng", "SĐT"], ["Tạp hoá A", ""], ["Tạp hoá B", ""])
    )
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors).toEqual([])
  })

  it("thiếu tên cửa hàng → lỗi dòng", () => {
    const r = parseCustomerSheet(sheet(["Tên cửa hàng", "SĐT"], ["", "0900000000"]))
    expect(r.rows[0].errors).toContain("Thiếu tên cửa hàng")
  })
})

describe("khách hàng — điều khoản thanh toán", () => {
  const terms = (raw: unknown) =>
    parseCustomerSheet(
      sheet(["Tên cửa hàng", "Điều khoản thanh toán"], ["Tạp hoá A", raw])
    ).rows[0].payment_terms

  it("nhận đúng các mã chuẩn", () => {
    expect(terms("NET30")).toBe("NET30")
    expect(terms("net30")).toBe("NET30")
    expect(terms("NET 30")).toBe("NET30")
  })

  it('rút được số ngày từ văn bản tự do "công nợ 30 ngày"', () => {
    expect(terms("Công nợ 30 ngày")).toBe("NET30")
  })

  it("số ngày KHÔNG nằm trong danh sách hợp lệ thì về COD, không bịa ra mốc mới", () => {
    // NET23 không tồn tại trong hệ thống; nhận bừa sẽ làm ngày đến hạn sai.
    expect(terms("23 ngày")).toBe("COD")
  })

  it("trống hoặc không hiểu được thì mặc định COD — an toàn nhất", () => {
    expect(terms("")).toBe("COD")
    expect(terms("linh tinh")).toBe("COD")
    expect(terms("tiền mặt")).toBe("COD")
  })
})

describe("khách hàng — kênh bán", () => {
  const channel = (raw: unknown) =>
    parseCustomerSheet(sheet(["Tên cửa hàng", "Kênh"], ["Tạp hoá A", raw])).rows[0].channel

  it("nhận mã chuẩn", () => {
    expect(channel("GT")).toBe("GT")
    expect(channel("mt")).toBe("MT")
    expect(channel("HORECA")).toBe("HORECA")
  })

  it("suy ra từ mô tả tiếng Việt CÓ DẤU", () => {
    // Lỗi thật đã sửa: hàm so với chuỗi không dấu nhưng chỉ toUpperCase(),
    // nên "Truyền thống" không bao giờ khớp "TRUYEN".
    expect(channel("Truyền thống")).toBe("GT")
    expect(channel("Siêu thị")).toBe("MT")
    expect(channel("Hiện đại")).toBe("MT")
    expect(channel("Nhà hàng")).toBe("HORECA")
    expect(channel("Khách sạn")).toBe("HORECA")
  })

  it("mô tả không dấu vẫn nhận được như trước", () => {
    expect(channel("Truyen thong")).toBe("GT")
    expect(channel("Sieu thi")).toBe("MT")
  })

  it("không nhận ra thì để null, không đoán bừa", () => {
    expect(channel("abc")).toBeNull()
    expect(channel("")).toBeNull()
  })
})

describe("khách hàng — hạn mức công nợ", () => {
  const limit = (raw: unknown) =>
    parseCustomerSheet(
      sheet(["Tên cửa hàng", "Hạn mức công nợ"], ["Tạp hoá A", raw])
    ).rows[0].credit_limit

  it('đọc đúng định dạng Việt Nam "50.000.000"', () => {
    expect(limit("50.000.000")).toBe(50000000)
  })

  it("trống thì bằng 0 (không cho nợ), không phải vô hạn", () => {
    // Mặc định sai chiều ở đây là cho bán nợ không giới hạn.
    expect(limit("")).toBe(0)
    expect(limit("abc")).toBe(0)
  })

  it("số âm bị ép về 0", () => {
    expect(limit(-1000)).toBe(0)
  })
})

describe("khách hàng — các trường xuất hoá đơn", () => {
  it("hình thức thanh toán trống thì mặc định Chuyển khoản", () => {
    const r = parseCustomerSheet(sheet(["Tên cửa hàng"], ["Tạp hoá A"]))
    expect(r.rows[0].payment_method_label).toBe("Chuyển khoản")
  })

  it("mã số thuế và tên đơn vị xuất hoá đơn được giữ nguyên", () => {
    const r = parseCustomerSheet(
      sheet(
        ["Tên cửa hàng", "Mã số thuế", "Tên đơn vị xuất HĐ"],
        ["Tạp hoá A", "0123456789", "Công ty TNHH A"]
      )
    )
    expect(r.rows[0].tax_code).toBe("0123456789")
    expect(r.rows[0].billing_name).toBe("Công ty TNHH A")
  })

  it("trạng thái ngừng hoạt động được nhận đúng", () => {
    const st = (v: unknown) =>
      parseCustomerSheet(sheet(["Tên cửa hàng", "Trạng thái"], ["A", v])).rows[0].status
    expect(st("")).toBe("active")
    expect(st("Ngừng")).toBe("inactive")
    expect(st("0")).toBe("inactive")
  })
})

// ====================================================================
// NHÀ CUNG CẤP
// ====================================================================

describe("parseSupplierSheet", () => {
  it("thiếu cột Tên NCC thì chặn toàn bộ", () => {
    const r = parseSupplierSheet(sheet(["SĐT"], ["0900000000"]))
    expect(r.headerError).toContain("Tên NCC")
    expect(r.rows).toEqual([])
  })

  it("file rỗng thì báo lỗi", () => {
    expect(parseSupplierSheet([]).headerError).toBeTruthy()
  })

  it("thiếu tên NCC → lỗi dòng", () => {
    const r = parseSupplierSheet(sheet(["Tên NCC", "SĐT"], ["", "0900000000"]))
    expect(r.rows[0].errors).toContain("Thiếu tên NCC")
  })

  it("trùng tên NCC trong file bị báo lỗi, KHÔNG phân biệt hoa thường", () => {
    // Trùng NCC là công nợ phải trả bị tách làm hai đầu mối.
    const r = parseSupplierSheet(
      sheet(["Tên NCC"], ["Công ty A"], ["CÔNG TY A"])
    )
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors).toContain("Trùng tên NCC trong file")
  })

  it("nhiều dòng thiếu tên thì không coi là trùng nhau", () => {
    // Phải có cột khác không rỗng, nếu không cả dòng bị coi là dòng trống
    // và bị bỏ qua trước khi tới bước kiểm trùng.
    const r = parseSupplierSheet(
      sheet(["Tên NCC", "SĐT"], ["", "0900000000"], ["", "0911111111"])
    )
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].errors).not.toContain("Trùng tên NCC trong file")
    expect(r.rows[1].errors).not.toContain("Trùng tên NCC trong file")
  })

  it("giữ nguyên thông tin ngân hàng và mã số thuế", () => {
    const r = parseSupplierSheet(
      sheet(
        ["Tên NCC", "Mã số thuế", "Số tài khoản", "Ngân hàng"],
        ["Công ty A", "0123456789", "1234567890", "Vietcombank"]
      )
    )
    expect(r.rows[0].tax_code).toBe("0123456789")
    expect(r.rows[0].bank_account).toBe("1234567890")
    expect(r.rows[0].bank_name).toBe("Vietcombank")
  })

  it("ô trống thành null chứ không phải chuỗi rỗng", () => {
    // Chuỗi rỗng trong database làm mọi kiểm tra `IS NULL` sai.
    const r = parseSupplierSheet(sheet(["Tên NCC", "SĐT"], ["Công ty A", ""]))
    expect(r.rows[0].phone).toBeNull()
    expect(r.rows[0].code).toBeNull()
  })

  it("bỏ qua dòng trống hoàn toàn", () => {
    const r = parseSupplierSheet(sheet(["Tên NCC"], ["Công ty A"], [""], ["Công ty B"]))
    expect(r.rows).toHaveLength(2)
  })

  it("số dòng báo lỗi khớp dòng thật trong Excel", () => {
    const r = parseSupplierSheet(sheet(["Tên NCC"], ["Công ty A"], [""], ["Công ty B"]))
    expect(r.rows[1].rowNo).toBe(4)
  })
})
