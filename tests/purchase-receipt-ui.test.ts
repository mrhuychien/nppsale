import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { RECEIPT_STATUS, receiptStatusLabel } from "../src/lib/purchasing/receipt-status"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chữ trong chú thích không phải là code. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const FORM = strip(read("src/components/purchasing/purchase-receipt-form.tsx"))
const NEW_PAGE = strip(read("src/app/(dashboard)/purchasing/receipts/new/page.tsx"))
const EDIT_PAGE = strip(read("src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx"))
const DETAIL = strip(read("src/app/(dashboard)/purchasing/receipts/[id]/page.tsx"))
const SAVE = strip(read("src/lib/purchasing/save-receipt.ts"))
const SIDEBAR = strip(read("src/components/layout/sidebar.tsx"))
const MIG = read("supabase/migrations/065_purchase_invoice_simplified.sql")

// =====================================================================

/**
 * BA TRẠNG THÁI, VÀ MÀN DANH SÁCH PHẢI VỚI TỚI ĐƯỢC CẢ BA.
 *
 * ⚠ BÀI HỌC ĐẮT CỦA KHO MÃ NÀY. Màn danh sách đơn hàng từng có SÁU
 * trạng thái nhưng chỉ BỐN tab, nên đơn `partially_invoiced` biến mất
 * khỏi mọi tab — chủ nhà báo "đơn hoàn thành xong thấy biến mất luôn",
 * và tôi đã kết luận sai một lần trước khi tìm ra. Chốt này đối chiếu
 * danh sách trạng thái của giao diện với CHECK constraint THẬT.
 */
describe("ba trạng thái của phiếu nhập", () => {
  it("danh sách trạng thái khớp CHECK constraint trong migration", () => {
    const m = /CHECK \(status IN \(([^)]+)\)\)/.exec(
      MIG.slice(MIG.indexOf("ADD CONSTRAINT purchase_invoices_status_chk"))
    )
    expect(m, "không tìm thấy CHECK constraint của purchase_invoices.status").toBeTruthy()
    const fromSql = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort()
    expect(fromSql).toEqual([...RECEIPT_STATUS].sort())
  })

  it("mỗi trạng thái có nhãn tiếng Việt riêng", () => {
    const labels = RECEIPT_STATUS.map(receiptStatusLabel)
    expect(new Set(labels).size, "hai trạng thái dùng chung một nhãn").toBe(RECEIPT_STATUS.length)
    expect(labels).toContain("Phiếu tạm")
    expect(labels).toContain("Hoàn thành")
    expect(labels).toContain("Đã huỷ")
  })

  /** ⚠ Mã lạ thì in nguyên mã — giấu đi là giấu luôn manh mối. */
  it("trạng thái lạ in nguyên mã, không nuốt thành dấu gạch", () => {
    expect(receiptStatusLabel("ai_do_them_vao")).toBe("ai_do_them_vao")
    expect(receiptStatusLabel(null)).toBe("—")
  })
})

// =====================================================================

/**
 * BẢNG HÀNG ĐÚNG CHÍN CỘT CHỦ NHÀ CHỐT.
 *
 * ⚠ "STT, Mã hàng, Tên hàng, ghi chú, ĐVT, Số lượng, Đơn giá, giảm giá,
 * thành tiền" — không thiếu cột nào, và không tự thêm cột nào. Mọi thứ
 * khác đi vào modal ("thông tin sản phẩm hiển thị đơn giản, cần nhiều
 * thông tin hơn thì bấm vào ra modal thông tin chi tiết").
 */
describe("biểu mẫu phiếu nhập theo khuôn màn đặt hàng", () => {
  it("bảng hàng có đủ chín cột chủ nhà chốt", () => {
    const head = FORM.slice(FORM.indexOf("<thead"), FORM.indexOf("</thead>"))
    for (const col of ["STT", "Mã hàng", "Tên hàng", "Ghi chú", "ĐVT", "Số lượng", "Đơn giá", "Giảm giá", "Thành tiền"]) {
      expect(head, `bảng hàng thiếu cột "${col}"`).toContain(`>${col}<`)
    }
  })

  /**
   * ⚠ BẤM TÊN HÀNG LÀ RA MODAL. Đây là cửa duy nhất tới những thông tin
   * không vào được chín cột; mất nó thì thuế suất và giá vốn quy đổi
   * không còn chỗ nào sửa hay đối chiếu.
   */
  it("tên hàng bấm được để mở modal chi tiết", () => {
    /**
     * ⚠ KIỂM CẢ HAI BẢN, BẢNG VÀ THẺ. Bản đầu của chốt này chỉ đòi
     * chuỗi `setDetailId(l.id)` có mặt ĐÂU ĐÓ trong file — mà nó có mặt
     * hai lần (bảng cho máy tính, thẻ cho điện thoại). Gỡ cú bấm ở bảng
     * thì chuỗi vẫn còn nhờ bản thẻ, và chốt vẫn xanh trong khi người
     * dùng máy tính không mở nổi modal. Đã thử phá đúng như vậy.
     */
    expect(
      FORM.match(/onClick=\{\(\) => setDetailId\(l\.id\)\}/g)?.length,
      "thiếu cú bấm mở modal ở bảng hoặc ở thẻ điện thoại"
    ).toBe(2)
    expect(FORM).toContain("<Dialog open={!!detail}")
    const modal = FORM.slice(FORM.indexOf("<Dialog open={!!detail}"))
    expect(modal, "modal thiếu ô thuế suất").toContain("Thuế GTGT (%)")
    expect(modal, "modal thiếu giá vốn quy đổi").toContain("unitCostOf(detail)")
  })

  it("chọn NCC bằng ô gõ được, không cho gõ tay", () => {
    expect(FORM).toContain("<SearchSelect")
    expect(FORM).toContain("options={supplierOptions}")
    expect(FORM, "đang cho gõ tay tên NCC — phiếu ghi thẳng supplier_id").not.toContain("allowFreeText")
  })

  it("thêm hàng bằng ô tìm rồi chạm, và xoá ô tìm sau khi thêm", () => {
    expect(FORM).toContain("searchReturnProducts(products, term, onSlip)")
    const add = FORM.slice(FORM.indexOf("const addProduct"), FORM.indexOf("const pickUnit"))
    expect(add).toContain("lineFromProduct(p, seqRef.current)")
    expect(add, "thêm xong phải xoá ô tìm").toContain('setTerm("")')
  })

  /** ⚠ Bốn thông tin chủ nhà chốt phải có ở đầu phiếu. */
  it("đầu phiếu có số hoá đơn đầu vào, kho đích, giảm giá và Cần trả NCC", () => {
    expect(FORM).toContain("Số hoá đơn đầu vào")
    expect(FORM).toContain("Kho đích *")
    expect(FORM).toContain("Giảm giá cả phiếu")
    expect(FORM).toContain("Cần trả NCC")
  })

  /**
   * ⚠ GIẢM GIÁ TRỪ SAU THUẾ (chủ nhà chốt 20/09/2026). Trên màn, dòng
   * giảm giá phải đứng DƯỚI dòng thuế — thứ tự đọc phải đúng bằng thứ
   * tự trong phép tính, nếu không người dùng tự suy ra quy ước ngược.
   */
  it("dòng giảm giá đứng dưới dòng thuế trong khối tổng", () => {
    /* ⚠ Neo vào CODE, không neo vào chú thích — `strip` đã bỏ chú
       thích nên mốc cũ ("Thanh hành động") trả về -1 và lát cắt rỗng. */
    const totals = FORM.slice(FORM.indexOf("Tiền hàng"), FORM.indexOf("fixed inset-x-0 bottom-0"))
    const vat = totals.indexOf("Thuế GTGT")
    const disc = totals.indexOf("Giảm giá cả phiếu")
    const total = totals.indexOf("Cần trả NCC")
    expect(vat).toBeGreaterThan(-1)
    expect(disc, "giảm giá đứng TRÊN thuế — sai thứ tự phép tính").toBeGreaterThan(vat)
    expect(total, "Cần trả NCC không đứng cuối").toBeGreaterThan(disc)
  })

  /**
   * ⚠ CHÍN CỘT KHÔNG VỪA MÀN 375px. Ép cả bảng vào màn hẹp là người
   * dùng cuộn ngang để gõ một ô số lượng.
   */
  it("bảng chỉ hiện từ lg, điện thoại có bản thẻ riêng", () => {
    expect(FORM).toContain("hidden overflow-x-auto rounded-xl border bg-card lg:block")
    expect(FORM).toContain("lg:hidden")
  })

  /** ⚠ Số lượng để trống — điền sẵn 1 là để một con số không ai gõ vào phiếu. */
  it("dòng mới để trống số lượng", () => {
    const fn = FORM.slice(FORM.indexOf("function lineFromProduct"), FORM.indexOf("export function PurchaseReceiptForm"))
    expect(fn).toContain('quantity: ""')
    expect(fn, "thuế suất phải quy đổi từ tỉ lệ sang phần trăm").toContain("ratioToPercent(p.vat_rate)")
  })
})

// =====================================================================

describe("ghi phiếu: màn hình không tự đụng kho hay công nợ", () => {
  /**
   * ⚠ ĐÂY LÀ BẤT BIẾN NẶNG NHẤT CỦA CẢ MODULE. Màn cũ
   * (`/inventory/stock-in`) ghi thẳng `batches` rồi `payables` bằng một
   * vòng lặp từ trình duyệt, không transaction: mạng rớt giữa chừng là
   * kho đã cộng mà công nợ chưa ghi. Ba màn mới KHÔNG được phép làm
   * lại chuyện đó — chúng chỉ ghi chứng từ, còn kho và nợ là việc của
   * RPC.
   */
  for (const [ten, src] of [
    ["màn tạo", NEW_PAGE],
    ["màn sửa", EDIT_PAGE],
    ["màn chi tiết", DETAIL],
    ["lib ghi dòng", SAVE],
  ] as const) {
    it(`${ten} không ghi thẳng vào batches / payables / stock_entries`, () => {
      for (const t of ["batches", "payables", "stock_entries", "stock_entry_lines"]) {
        expect(src, `${ten} đang ghi thẳng bảng ${t}`).not.toContain(`.from("${t}")`)
      }
    })
  }

  it("kho và công nợ chỉ đi qua hai RPC", () => {
    expect(NEW_PAGE).toContain('supabase.rpc("complete_purchase_invoice"')
    expect(DETAIL).toContain("complete_purchase_invoice")
    expect(DETAIL).toContain("cancel_purchase_invoice")
  })

  /**
   * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Chèn dòng hàng mà
   * không `.select()` rồi đếm là một phiếu KHÔNG CÓ DÒNG NÀO được báo
   * "đã lưu".
   */
  it("ghi dòng hàng có select rồi đếm, không tin mỗi error", () => {
    const ins = SAVE.slice(SAVE.indexOf('.from("purchase_invoice_lines")\n    .insert'))
    expect(ins).toContain('.select("id")')
    expect(SAVE).toContain("data.length === 0")
    expect(SAVE).toContain("không có quyền")
  })

  /** ⚠ Cột là TỈ LỆ, ô nhập là PHẦN TRĂM — quên quy đổi là thuế hụt 100 lần. */
  it("thuế suất quy đổi phần trăm → tỉ lệ khi ghi xuống", () => {
    expect(SAVE).toContain("vat_rate: percentToRatio(l.vat_percent)")
    expect(NEW_PAGE).toContain("percentToRatio")
    expect(EDIT_PAGE).toContain("percentToRatio")
  })

  /** STT phải được ghi xuống, nếu không tờ in mỗi lần một thứ tự. */
  it("ghi sort_order 1-based cho từng dòng", () => {
    expect(SAVE).toContain("sort_order: i + 1")
  })
})

// =====================================================================

describe("sửa phiếu đã hoàn thành", () => {
  /**
   * ⚠ CHỈ SOI THÂN HÀM `submit`. Màn này còn một `.from("purchase_invoices")`
   * ở phần NẠP phiếu, đứng trước mọi thứ — bản đầu của chốt dưới bắt
   * nhầm chỗ đó và đỏ vì một lý do không liên quan.
   */
  const SUBMIT = EDIT_PAGE.slice(
    EDIT_PAGE.indexOf("const submit = async"),
    EDIT_PAGE.indexOf("if (authLoading || loading)")
  )
  /**
   * ⚠ HUỶ TRƯỚC RỒI LẬP LẠI, không sửa đè. Sửa đè lên một chứng từ đã
   * vào kho và vào sổ nợ là chứng từ nói một đằng, kho nói một nẻo.
   * Đi đường huỷ thì phép sửa THỪA HƯỞNG mọi chốt chặn của phép huỷ.
   */
  it("phiếu đã hoàn thành thì huỷ trước rồi mới ghi đè", () => {
    const cancelAt = SUBMIT.indexOf('rpc("cancel_purchase_invoice"')
    const updateAt = SUBMIT.indexOf('.from("purchase_invoices")')
    const completeAt = SUBMIT.indexOf('rpc("complete_purchase_invoice"')
    expect(cancelAt, "không huỷ bản cũ trước khi sửa").toBeGreaterThan(0)
    expect(updateAt, "ghi đè TRƯỚC khi huỷ — kho vẫn giữ lô cũ").toBeGreaterThan(cancelAt)
    expect(completeAt).toBeGreaterThan(updateAt)
    expect(EDIT_PAGE).toContain("wasCompleted")
  })

  /**
   * ⚠ HUỶ HỎNG THÌ DỪNG HẲN. Đi tiếp khi kho chưa hoàn về là ghi đè
   * dòng hàng của một phiếu vẫn đang giữ lô cũ trong kho.
   */
  it("huỷ hỏng thì ném lỗi, không đi tiếp", () => {
    const blk = SUBMIT.slice(
      SUBMIT.indexOf("if (wasCompleted)"),
      SUBMIT.indexOf('.from("purchase_invoices")')
    )
    expect(blk).toContain("throw new Error")
  })

  /** Phiếu vừa huỷ phải về `draft` thì RPC hoàn thành mới nhận. */
  it("đưa phiếu về phiếu tạm và xoá dấu huỷ cũ", () => {
    expect(EDIT_PAGE).toContain('status: "draft"')
    expect(EDIT_PAGE).toContain("cancelled_at: null")
    expect(EDIT_PAGE).toContain("cancel_reason: null")
  })

  /**
   * ⚠ BA BƯỚC KHÔNG NẰM TRONG MỘT GIAO DỊCH. Hỏng ở bước cuối thì kho
   * đã hoàn về đúng nhưng phiếu chưa lập lại — phải NÓI RA, nếu không
   * người dùng tưởng mất hàng.
   */
  it("hoàn thành lại hỏng thì nói rõ kho đã hoàn về đúng", () => {
    expect(EDIT_PAGE).toContain("PHIẾU TẠM")
    expect(EDIT_PAGE).toContain("kho đã hoàn về đúng")
  })

  /** ⚠ Dựng dòng từ phiếu đã lưu, không lấy lại giá vốn hôm nay. */
  it("màn sửa dựng dòng từ phiếu đã lưu", () => {
    expect(EDIT_PAGE).toContain("quantity: String(l.quantity)")
    expect(EDIT_PAGE).toContain("unit_price: String(l.unit_price)")
    expect(EDIT_PAGE).toContain("vat_percent: ratioToPercent(l.vat_rate)")
    expect(EDIT_PAGE, "đang dựng lại dòng từ danh mục — đè số người dùng đã gõ")
      .not.toContain("lineFromProduct")
    expect(EDIT_PAGE).toContain('"Sản phẩm đã xoá"')
  })

  it("phiếu đã huỷ thì không mở màn sửa", () => {
    expect(EDIT_PAGE).toContain('status === "cancelled"')
    expect(EDIT_PAGE).toContain("Không sửa được")
  })
})

// =====================================================================

describe("màn chi tiết", () => {
  it("có nút Hoàn thành, nút Huỷ và hỏi lại trước khi huỷ", () => {
    /**
     * ⚠ KIỂM CÁI NÚT, KHÔNG KIỂM CHUỖI. Bản đầu chỉ đòi chuỗi "Huỷ
     * phiếu" có mặt trong file — nhưng tiêu đề hộp xác nhận là "Huỷ
     * phiếu nhập hàng?", nên đổi chữ trên NÚT đi thì chuỗi vẫn còn và
     * chốt vẫn xanh. Đã thử phá đúng như vậy. Nên: bắt cả cú bấm lẫn
     * nhãn đi liền nhau.
     */
    const flat = DETAIL.replace(/\s+/g, " ")
    expect(flat, "mất nút mở hộp xác nhận huỷ").toMatch(
      /onClick=\{\(\) => setAskCancel\(true\)\}[^<]*>[\s\S]{0,120}Huỷ phiếu </
    )
    expect(flat, "mất nút Hoàn thành").toMatch(
      /run\("complete_purchase_invoice"\)[\s\S]{0,200}Hoàn thành </
    )
    expect(DETAIL).toContain("<ConfirmDialog")
  })

  /** ⚠ Lý do huỷ phải hiện ra, nếu không phiếu chết mà không ai biết vì sao. */
  it("hiện lý do huỷ", () => {
    expect(DETAIL).toContain("head.cancel_reason")
  })

  /** ⚠ Cột `vat_rate` là TỈ LỆ — in thẳng kèm % là hiện "0.1%" cho thuế 10%. */
  it("thuế suất quy đổi trước khi in, không in thẳng cột", () => {
    expect(DETAIL).toContain("{ratioToPercent(l.vat_rate)}%")
    expect(DETAIL).not.toContain("{l.vat_rate}%")
  })

  /** Phiếu đã hoàn thành vẫn sửa được (chủ nhà chốt) — nút phải còn. */
  it("phiếu hoàn thành vẫn có đường vào màn sửa", () => {
    expect(DETAIL).toContain("isDone")
    expect(DETAIL).toContain("/edit")
  })
})

// =====================================================================

describe("menu: phiếu nhập kho chuyển sang Kho vận", () => {
  /**
   * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Phiếu nhập kho chuyển hẳn sang phần Kho
   * vận (dùng để nhập kho thông thường)". Đường nhập hàng từ NCC nay là
   * `/purchasing/receipts` và đi qua RPC một giao dịch.
   */
  const group = (name: string) => {
    const i = SIDEBAR.indexOf(`label: "${name}"`)
    expect(i, `không tìm thấy nhóm ${name}`).toBeGreaterThan(-1)
    return SIDEBAR.slice(i, SIDEBAR.indexOf("  {\n    label:", i + 10))
  }

  it("Phiếu nhập kho nằm ở nhóm Kho vận, không còn ở Mua hàng", () => {
    expect(group("Kho vận")).toContain('href: "/inventory/stock-in"')
    expect(group("Mua hàng"), "Phiếu nhập kho vẫn còn ở nhóm Mua hàng")
      .not.toContain('href: "/inventory/stock-in"')
  })

  it("Phiếu nhập hàng nằm ở nhóm Mua hàng và đứng đầu", () => {
    const mua = group("Mua hàng")
    expect(mua).toContain('href: "/purchasing/receipts"')
    expect(
      mua.indexOf('href: "/purchasing/receipts"'),
      "Phiếu nhập hàng không đứng đầu nhóm"
    ).toBeLessThan(mua.indexOf('href: "/purchase-returns"'))
  })
})
