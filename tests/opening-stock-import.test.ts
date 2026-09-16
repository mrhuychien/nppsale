import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  parseProductSheet,
  groupRowsForImport,
  TEMPLATE_HEADERS,
  TEMPLATE_SAMPLE_ROWS,
} from "../src/lib/products/import-parse"
import {
  planOpeningStock,
  buildOpeningEntry,
  openingEntryCode,
  canPostOpeningStock,
  NO_EXPIRY,
} from "../src/lib/products/opening-stock-plan"

const ROOT = resolve(__dirname, "..")
const DIALOG = readFileSync(
  resolve(ROOT, "src/components/products/product-import-dialog.tsx"),
  "utf-8"
)

/** Dựng một sheet tối thiểu: tiêu đề + các dòng. */
const sheet = (headers: string[], ...rows: unknown[][]) => [headers, ...rows]
const BASE = ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp"]

describe("Đọc cột tồn kho đầu kỳ", () => {
  it("nhận các tên cột thông dụng", () => {
    for (const h of [
      "Tồn kho",
      "Tồn",
      "Tồn đầu kỳ",
      "Tồn kho đầu kỳ",
      "Số lượng tồn",
      "SL tồn",
      "Tồn hiện tại",
      "Tồn cuối kỳ",
      "ton kho", // không dấu
      "TỒN KHO", // hoa
    ]) {
      const r = parseProductSheet(sheet([...BASE, h], ["Coca", "lon", "Coca VN", 480]))
      expect(r.rows[0]?.opening_qty, `cột "${h}"`).toBe(480)
    }
  })

  /**
   * ⚠ "Tồn tối thiểu" / "Tồn nhỏ nhất" / "Tồn lớn nhất" là NGƯỠNG cảnh
   * báo, không phải hàng trong kho. Nuốt nhầm chúng thành tồn đầu kỳ là
   * tự dựng ra một kho hàng không có thật.
   */
  it("KHÔNG nhầm ngưỡng tồn thành tồn thật", () => {
    for (const h of ["Tồn tối thiểu", "Tồn nhỏ nhất", "Tồn lớn nhất", "Tồn max", "Tồn min"]) {
      const r = parseProductSheet(sheet([...BASE, h], ["Coca", "lon", "Coca VN", 24]))
      expect(r.rows[0]?.opening_qty, `cột "${h}" không phải tồn đầu kỳ`).toBe(0)
    }
  })

  /**
   * ⚠ "Số lượng" trần quá mơ hồ trong một file danh mục sản phẩm — có thể
   * là quy cách đóng gói, số lượng đặt tối thiểu… Map nhầm là dựng kho ảo
   * mà không có lỗi nào báo ra. Thà không nhận còn hơn nhận bừa.
   */
  it("không nhận cột 'Số lượng' trần", () => {
    const r = parseProductSheet(sheet([...BASE, "Số lượng"], ["Coca", "lon", "Coca VN", 99]))
    expect(r.rows[0]?.opening_qty).toBe(0)
  })

  /**
   * ⚠ Cùng cái bẫy đã ghi ở hệ số quy đổi: `parseMoney` xoá dấu chấm để
   * đọc tiền ("15.000" → 15000). Áp lên số lượng thì "1.5" thành 15 —
   * sai gấp mười, không lỗi nào báo.
   */
  it("đọc đúng số lẻ, không xoá dấu thập phân", () => {
    const r = parseProductSheet(sheet([...BASE, "Tồn kho"], ["Dầu ăn", "lít", "NCC", "1.5"]))
    expect(r.rows[0]?.opening_qty).toBe(1.5)
  })

  it("tồn âm là lỗi, không lặng lẽ thành 0", () => {
    const r = parseProductSheet(sheet([...BASE, "Tồn kho"], ["Coca", "lon", "Coca VN", -5]))
    expect(r.rows[0]?.errors.join(" ")).toContain("âm")
  })

  it("trống, 0 hoặc chữ đều là không có tồn", () => {
    for (const v of ["", 0, "  ", "abc"]) {
      const r = parseProductSheet(sheet([...BASE, "Tồn kho"], ["Coca", "lon", "Coca VN", v]))
      expect(r.rows[0]?.opening_qty, `giá trị ${JSON.stringify(v)}`).toBe(0)
    }
  })

  /** File danh mục thuần, không có cột tồn — vẫn phải nhập được như cũ. */
  it("file không có cột tồn thì mọi dòng tồn 0", () => {
    const r = parseProductSheet(sheet(BASE, ["Coca", "lon", "Coca VN"]))
    expect(r.headerError).toBeNull()
    expect(r.rows[0].opening_qty).toBe(0)
  })
})

describe("Không nhân đôi tồn kho", () => {
  /**
   * ⚠ CHỖ NGUY HIỂM NHẤT của tính năng này. KiotViet xuất mỗi đơn vị quy
   * đổi thành một dòng riêng và lặp lại cột "Tồn kho" trên dòng đó: 20
   * thùng và 480 lon là CÙNG một lô hàng, chỉ đổi cách đếm. Cộng cả hai
   * là kho ảo — mà kho ảo thì bán được đơn rồi không có hàng giao.
   */
  it("bỏ tồn ghi trên dòng đơn vị quy đổi", () => {
    const r = parseProductSheet(
      sheet(
        ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp", "SKU", "Mã ĐVT Cơ bản", "Quy đổi", "Tồn kho"],
        ["Coca 330ml", "lon", "Coca VN", "COCA", "", "", 480],
        ["Coca 330ml", "thùng", "Coca VN", "COCA-T", "COCA", 24, 20]
      )
    )
    const g = groupRowsForImport(r.rows)
    expect(g.baseRows).toHaveLength(1)
    expect(g.baseRows[0].opening_qty).toBe(480)
    // Và phải ĐẾM LẠI số dòng đã bỏ, để màn hình còn nói ra.
    expect(g.droppedOpeningQtyRows).toBe(1)
  })

  it("không có dòng quy đổi nào ghi tồn thì đếm bằng 0", () => {
    const r = parseProductSheet(sheet([...BASE, "Tồn kho"], ["Coca", "lon", "Coca VN", 480]))
    expect(groupRowsForImport(r.rows).droppedOpeningQtyRows).toBe(0)
  })
})

describe("Lập phiếu tồn đầu kỳ", () => {
  const rows = [
    { sku: "A", name: "Coca", opening_qty: 480, cost_price: 6000 },
    { sku: "B", name: "Mì", opening_qty: 1200, cost_price: 3000 },
    { sku: "C", name: "Nước suối", opening_qty: 0, cost_price: 2000 },
  ]
  const ids = { A: "id-a", B: "id-b", C: "id-c" }

  it("chỉ lấy mặt hàng có tồn > 0", () => {
    const p = planOpeningStock(rows, ids)
    expect(p.lines.map((l) => l.sku)).toEqual(["A", "B"])
    expect(p.totalQty).toBe(1680)
    expect(p.totalValue).toBe(480 * 6000 + 1200 * 3000)
  })

  /**
   * ⚠ `idBySku` chỉ chứa sản phẩm VỪA ĐƯỢC TẠO. Dòng có SKU trùng hàng đã
   * có trong hệ thống đã bị bỏ từ trước — dựng phiếu cho nó là cộng tồn
   * đầu kỳ vào một mặt hàng đang có tồn thật, tức tự nhân đôi kho.
   */
  it("bỏ dòng không tra ra sản phẩm, và đếm lại", () => {
    const p = planOpeningStock(rows, { A: "id-a" })
    expect(p.lines.map((l) => l.sku)).toEqual(["A"])
    expect(p.unmatched).toBe(1)
  })

  /** Thiếu giá vốn thì vẫn nhập hàng, nhưng phải kể tên ra. */
  it("kể tên mặt hàng có tồn mà không có giá vốn", () => {
    const p = planOpeningStock(
      [{ sku: "A", name: "Coca", opening_qty: 480, cost_price: 0 }],
      { A: "id-a" }
    )
    expect(p.missingCost).toEqual(["Coca"])
    expect(p.lines[0].costKnown).toBe(false)
    expect(p.lines[0].unitCost).toBe(0)
  })

  it("thư mục rỗng / không có tồn thì không có phiếu nào", () => {
    expect(planOpeningStock([], {}).lines).toHaveLength(0)
    expect(planOpeningStock([rows[2]], ids).lines).toHaveLength(0)
  })
})

describe("Payload ghi xuống", () => {
  const lines = [
    { productId: "id-a", sku: "A", name: "Coca", qty: 480, unitCost: 6000, costKnown: true },
    { productId: "id-b", sku: "B", name: "Mì", qty: 1200, unitCost: 3000, costKnown: true },
  ]
  const make = (entryDate: string) =>
    buildOpeningEntry({
      orgId: "org-1",
      userId: "user-1",
      entryDate,
      now: new Date("2026-09-13T10:00:00+07:00"),
      rand: 0.5,
      lines,
    })

  /**
   * ⚠ Phiếu tồn đầu kỳ phải nằm ở NGÀY CHỐT SỔ, không phải ngày bấm nút.
   * Thẻ kho, báo cáo nhập xuất tồn và giá vốn hàng bán đều gom theo
   * `posted_at`.
   */
  it("ghi vào đúng ngày chốt sổ người dùng chọn", () => {
    const p = make("2025-12-31")
    const vnDate = new Date(p.entry.posted_at).toLocaleDateString("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    })
    expect(vnDate).toBe("2025-12-31")
  })

  it("phiếu là nhập kho đã ghi sổ", () => {
    const p = make("2025-12-31")
    expect(p.entry.type).toBe("import")
    expect(p.entry.status).toBe("posted")
  })

  /** Mã có tiền tố riêng để nhìn danh sách là biết ngay phiếu đầu kỳ. */
  it("mã phiếu phân biệt được với phiếu nhập hằng ngày", () => {
    expect(openingEntryCode("2025-12-31", 0.5)).toMatch(/^DK-20251231-\d{4}$/)
    expect(openingEntryCode("2025-12-31", 0.5)).not.toContain("IN-")
  })

  it("hai lần nhập cùng ngày không ra cùng một mã", () => {
    expect(openingEntryCode("2025-12-31", 0.1)).not.toBe(openingEntryCode("2025-12-31", 0.9))
  })

  /** Số lượng và giá vốn đi thẳng vào lô, không qua phép quy đổi nào. */
  it("mỗi mặt hàng một lô, đúng số lượng và giá vốn", () => {
    const p = make("2025-12-31")
    expect(p.batches).toHaveLength(2)
    expect(p.batches[0]).toMatchObject({
      product_id: "id-a",
      qty_initial: 480,
      qty_on_hand: 480,
      unit_cost: 6000,
    })
    expect(p.batches[1].unit_cost).toBe(3000)
  })

  /**
   * ⚠ File danh mục không có hạn dùng của từng lô. Đoán ra một cái hạn là
   * dựng số liệu chưa từng có — mà hạn dùng lại quyết định lô nào xuất
   * trước (FEFO). Để mốc rất xa nghĩa là "chưa khai".
   */
  it("không bịa hạn dùng cho lô đầu kỳ", () => {
    expect(make("2025-12-31").batches.every((b) => b.expires_at === NO_EXPIRY)).toBe(true)
  })

  /** Mã lô phải gắn với mã phiếu, để dò ngược được lô này từ đâu ra. */
  it("mã lô truy được về phiếu", () => {
    const p = make("2025-12-31")
    expect(p.batches[0].batch_code).toContain(p.entry.entry_code)
  })

  it("ghi chú nói rõ đây là tồn đầu kỳ từ file Excel", () => {
    expect(make("2025-12-31").entry.notes).toContain("Tồn kho đầu kỳ")
  })
})

describe("Quyền ghi phiếu tồn đầu kỳ", () => {
  /**
   * ⚠ Hai quyền KHÔNG trùng nhau: sản phẩm là của owner/manager, kho là
   * của owner/warehouse (RLS mig 002). Giao nhau chỉ còn owner. Không
   * chặn trước thì tài khoản Quản lý nhập xong danh mục sẽ nhận một lỗi
   * RLS không đọc được, và tưởng là đã có tồn.
   */
  it("chỉ chủ NPP mới ghi được", () => {
    expect(canPostOpeningStock("owner")).toBe(true)
    for (const r of ["manager", "warehouse", "sales", "accountant", "", null, undefined]) {
      expect(canPostOpeningStock(r), `vai trò ${r}`).toBe(false)
    }
  })
})

describe("File mẫu", () => {
  it("có cả cột tồn đầu kỳ lẫn giá vốn", () => {
    expect(TEMPLATE_HEADERS).toContain("Tồn kho đầu kỳ")
    expect(TEMPLATE_HEADERS).toContain("Giá vốn")
  })

  /**
   * ⚠ Thêm một cột header mà quên chèn giá trị vào dòng ví dụ là mọi ô
   * phía sau lệch đi một cột — file mẫu tải về sẽ dạy người dùng điền sai.
   */
  it("dòng ví dụ đủ số cột", () => {
    for (const row of TEMPLATE_SAMPLE_ROWS) {
      expect(row).toHaveLength(TEMPLATE_HEADERS.length)
    }
  })

  /** Và file mẫu tải về phải tự đọc lại được chính nó. */
  it("đọc ngược file mẫu ra đúng tồn và giá vốn", () => {
    const r = parseProductSheet([[...TEMPLATE_HEADERS], ...TEMPLATE_SAMPLE_ROWS])
    expect(r.headerError).toBeNull()
    expect(r.rows[0].opening_qty).toBe(480)
    expect(r.rows[0].cost_price).toBe(6000)
    expect(r.rows[1].opening_qty).toBe(1200)
    expect(r.rows[1].cost_price).toBe(3000)
  })
})

describe("Màn nhập sản phẩm có nối đúng", () => {
  it("gọi tới phần lập và ghi phiếu tồn đầu kỳ", () => {
    expect(DIALOG).toContain("planOpeningStock(")
    expect(DIALOG).toContain("buildOpeningEntry(")
  })

  it("có ô chọn ngày chốt sổ, mặc định theo lịch Việt Nam", () => {
    expect(DIALOG).toContain("vnToday(")
    expect(DIALOG).toContain("openingDate")
  })

  it("chặn trước vai trò không ghi được kho", () => {
    expect(DIALOG).toContain("canPostOpeningStock(")
  })

  /**
   * ⚠ Sản phẩm đã nằm trong cơ sở dữ liệu rồi. Để lỗi phiếu kho nổ lên
   * sẽ hiện "Lỗi nhập sản phẩm" trong khi sản phẩm đã nhập xong — người
   * dùng nhập lại lần nữa là trùng SKU toàn bộ.
   */
  it("phiếu kho hỏng không làm hỏng cả lần nhập", () => {
    const fn = DIALOG.slice(
      DIALOG.indexOf("const importOpeningStock"),
      DIALOG.indexOf("const handleImport")
    )
    expect(fn).toContain("try {")
    expect(fn).toContain("CHƯA tạo được phiếu tồn đầu kỳ")
  })

  /** Số dòng quy đổi bị bỏ phải được nói ra, không im lặng. */
  it("nói ra số dòng tồn đã bỏ để không nhân đôi", () => {
    expect(DIALOG).toContain("droppedOpeningQtyRows")
  })
})

describe("Màn nhập không được im lặng nuốt dòng", () => {
  /**
   * ⚠ ĐÂY LÀ LÝ DO LỖI SỐNG ĐƯỢC. 40 sản phẩm (kèm 17 mã quy đổi, kèm
   * 22 triệu tiền hàng) biến mất, mà thông báo cuối vẫn là "Đã nhập N sản
   * phẩm" — không một chữ nào nhắc tới dòng bị loại. Người dùng chỉ phát
   * hiện khi tự dò danh sách.
   */
  it("thông báo nói ra số dòng bị loại vì lỗi", () => {
    expect(DIALOG).toContain("errorRows.length > 0")
    expect(DIALOG).toContain("dòng lỗi — những mã này KHÔNG được tạo")
  })

  /** Có dòng bị loại thì thông báo phải đỏ, không phải màu thành công. */
  it("có dòng bị loại thì thông báo báo đỏ", () => {
    expect(DIALOG).toContain('variant: errorRows.length > 0 ? "destructive" : undefined')
  })

  /** Dòng chỉ thiếu thông tin tuỳ chọn thì vẫn nhập, nhưng phải nhìn thấy. */
  it("phân biệt dòng BỊ BỎ với dòng thiếu thông tin", () => {
    expect(DIALOG).toContain("dòng BỊ BỎ")
    expect(DIALOG).toContain("dòng thiếu thông tin (vẫn nhập)")
    expect(DIALOG).toContain("r.warnings.length > 0")
  })
})
