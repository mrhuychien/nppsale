import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { RECEIPT_STATUS, receiptStatusLabel } from "../src/lib/purchasing/receipt-status"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích — chữ trong chú thích không phải là code. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * ⚠ HAI TỆP, VÌ BIỂU MẪU ĐÃ TÁCH LÀM HAI. `FORM` chỉ còn khối "Thông
 * tin chung" riêng của phiếu nhập; ô tìm hàng, bảng chín cột, khối tổng
 * và modal nằm ở `EDITOR`, dùng chung với phiếu trả NCC. Chốt nào nói
 * về phần dùng chung thì phải soi `EDITOR` — để nguyên ở `FORM` là chốt
 * xanh vì đọc phải chuỗi rỗng, chứ không vì hành vi còn đúng.
 */
const FORM = strip(read("src/components/purchasing/purchase-receipt-form.tsx"))
const EDITOR = strip(read("src/components/purchasing/purchasing-lines-editor.tsx"))
const NEW_PAGE = strip(read("src/app/(dashboard)/purchasing/receipts/new/page.tsx"))
const EDIT_PAGE = strip(read("src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx"))
const DETAIL = strip(read("src/app/(dashboard)/purchasing/receipts/[id]/page.tsx"))
const SAVE = strip(read("src/lib/purchasing/save-receipt.ts"))
const LIB = strip(read("src/lib/purchasing/receipt-form.ts"))
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
    const head = EDITOR.slice(EDITOR.indexOf("<thead"), EDITOR.indexOf("</thead>"))
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
      EDITOR.match(/onClick=\{\(\) => setDetailId\(l\.id\)\}/g)?.length,
      "thiếu cú bấm mở modal ở bảng hoặc ở thẻ điện thoại"
    ).toBe(2)
    expect(EDITOR).toContain("<Dialog open={!!detail}")
    const modal = EDITOR.slice(EDITOR.indexOf("<Dialog open={!!detail}"))
    expect(modal, "modal thiếu ô thuế suất").toContain("Thuế GTGT (%)")
    expect(modal, "modal thiếu giá vốn quy đổi").toContain("unitCostOf(detail)")
  })

  it("chọn NCC bằng ô gõ được, không cho gõ tay", () => {
    expect(FORM).toContain("<SearchSelect")
    expect(FORM).toContain("options={supplierOptions}")
    expect(FORM, "đang cho gõ tay tên NCC — phiếu ghi thẳng supplier_id").not.toContain("allowFreeText")
  })

  it("thêm hàng bằng ô tìm rồi chạm, và xoá ô tìm sau khi thêm", () => {
    expect(EDITOR).toContain("searchReturnProducts(products, term, onSlip)")
    const add = EDITOR.slice(EDITOR.indexOf("const addProduct"), EDITOR.indexOf("const toggleDiscountMode"))
    expect(add).toContain("lineFromProduct(p, seqRef.current)")
    expect(add, "thêm xong phải xoá ô tìm").toContain('setTerm("")')
  })

  /** ⚠ Bốn thông tin chủ nhà chốt phải có ở đầu phiếu. */
  it("đầu phiếu có số hoá đơn đầu vào, kho đích, giảm giá và Cần trả NCC", () => {
    expect(FORM).toContain("Số hoá đơn đầu vào")
    expect(FORM).toContain("Kho đích *")
    /* ⚠ Ô GIẢM GIÁ DÙNG CHUNG; "Cần trả NCC" là NHÃN phiếu nhập truyền
       vào phần dùng chung — nên mỗi thứ soi ở đúng tệp của nó. */
    expect(EDITOR).toContain("Giảm giá cả phiếu")
    expect(FORM).toContain('totalLabel="Cần trả NCC"')
  })

  /**
   * ⚠ GIẢM GIÁ TRỪ SAU THUẾ (chủ nhà chốt 20/09/2026). Trên màn, dòng
   * giảm giá phải đứng DƯỚI dòng thuế — thứ tự đọc phải đúng bằng thứ
   * tự trong phép tính, nếu không người dùng tự suy ra quy ước ngược.
   */
  it("dòng giảm giá đứng dưới dòng thuế trong khối tổng", () => {
    /* ⚠ Neo vào CODE, không neo vào chú thích — `strip` đã bỏ chú
       thích nên mốc cũ ("Thanh hành động") trả về -1 và lát cắt rỗng. */
    const totals = EDITOR.slice(EDITOR.indexOf("Tiền hàng"), EDITOR.indexOf("fixed inset-x-0 bottom-0"))
    const vat = totals.indexOf("Thuế GTGT")
    const disc = totals.indexOf("Giảm giá cả phiếu")
    const total = totals.indexOf("{totalLabel}")
    expect(vat).toBeGreaterThan(-1)
    expect(disc, "giảm giá đứng TRÊN thuế — sai thứ tự phép tính").toBeGreaterThan(vat)
    expect(total, "dòng tổng không đứng cuối").toBeGreaterThan(disc)
  })

  /**
   * ⚠ CHÍN CỘT KHÔNG VỪA MÀN 375px. Ép cả bảng vào màn hẹp là người
   * dùng cuộn ngang để gõ một ô số lượng.
   */
  it("bảng chỉ hiện từ lg, điện thoại có bản thẻ riêng", () => {
    expect(EDITOR).toContain("hidden overflow-x-auto rounded-xl border bg-card lg:block")
    expect(EDITOR).toContain("lg:hidden")
  })

  /** ⚠ Số lượng để trống — điền sẵn 1 là để một con số không ai gõ vào phiếu. */
  it("dòng mới để trống số lượng", () => {
    const fn = LIB.slice(LIB.indexOf("export function lineFromProduct"), LIB.indexOf("export function unitPatch"))
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
    it(`${ten} không GHI thẳng vào batches / payables / stock_entries`, () => {
      /**
       * ⚠ CẤM GHI, KHÔNG CẤM ĐỌC — và đây là một lần nới chốt CÓ LÝ DO,
       *   không phải nới cho qua.
       *
       *   Bản đầu cấm luôn chuỗi `.from("batches")`. Nó đỏ ngay khi ô
       *   tìm hàng cần ĐỌC tồn kho để hiện ra (chủ nhà chốt 20/09/2026:
       *   "thêm thông tin ncc, lượng tồn") — một phép đọc hoàn toàn
       *   lành. Thứ nguy hiểm là màn hình tự CỘNG/TRỪ kho hay tự ghi
       *   công nợ ngoài RPC; đọc để hiện thì không.
       *
       * ⚠ BẮT ĐỘNG TỪ GHI ĐI LIỀN SAU `.from(...)`. Gộp khoảng trắng
       *   rồi soi cả cụm, vì `.insert(` đứng riêng thì ở đâu cũng có —
       *   `purchase_invoices` và `purchase_invoice_lines` đều được phép
       *   ghi bình thường.
       */
      const flat = src.replace(/\s+/g, " ")
      for (const t of ["batches", "payables", "stock_entries", "stock_entry_lines"]) {
        for (const verb of ["insert", "update", "delete", "upsert"]) {
          expect(
            flat,
            `${ten} đang tự ${verb} bảng ${t} — kho và công nợ phải đi qua RPC`
          ).not.toContain(`.from("${t}") .${verb}(`)
        }
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

// =====================================================================

/**
 * BỐN VIỆC CHỦ NHÀ BÁO 20/09/2026 SAU KHI DÙNG THỬ PHIẾU NHẬP.
 */
describe("ô tìm hàng: bấm cả dòng, có NCC và tồn kho", () => {
  /**
   * ⚠ CẢ DÒNG LÀ NÚT ("bấm vào dòng là thêm được hàng luôn"). Bản cũ
   * bắt trúng đúng cái nút "Thêm" rộng 70px ở mép phải — trên điện
   * thoại đó là một mục tiêu nhỏ giữa một dòng rộng cả màn, và mọi cú
   * chạm trượt đều không làm gì cả.
   */
  it("cả dòng gợi ý là một nút, không phải riêng nút Thêm", () => {
    /**
     * ⚠ BÁM VÀO BỀ RỘNG CỦA NÚT, KHÔNG BÁM VÀO THỨ TỰ THẺ. Bản đầu đòi
     * `<li key={p.id}> <button` đi liền nhau — nhưng giữa hai thẻ còn
     * một chú thích JSX, mà `strip` bỏ phần `/* *​/` và để lại cặp `{}`.
     * Chốt đỏ vì một dấu ngoặc, không vì hành vi. Thứ thật sự quan
     * trọng: phần bấm được phải RỘNG CẢ DÒNG (`w-full`), chứ không phải
     * một nút nhỏ ở mép phải.
     */
    const flat = EDITOR.replace(/\s+/g, " ")
    expect(flat, "gợi ý không còn là nút bấm cả dòng").toMatch(
      /<button type="button" onClick=\{\(\) => addProduct\(p\)\}[^>]*className="flex w-full/
    )
    expect(flat, "vẫn còn nút Thêm nhỏ ở mép phải").not.toMatch(
      /<Button size="sm" onClick=\{\(\) => addProduct\(p\)\}/
    )
  })

  /**
   * ⚠ NCC ĐỂ BIẾT CÓ ĐANG CHỌN NHẦM HÀNG CỦA NCC KHÁC KHÔNG — một phiếu
   * nhập trộn hai NCC là công nợ ghi sai chỗ.
   */
  it("gợi ý hiện NCC và tồn kho", () => {
    const list = EDITOR.slice(EDITOR.indexOf("{hits.map("), EDITOR.indexOf("{linesTitle}"))
    expect(list, "gợi ý không hiện NCC").toContain("x?.supplierName")
    expect(list, "gợi ý không hiện tồn kho").toContain("x.onHand")
  })

  /** ⚠ Chưa đọc được tồn thì nói là chưa biết — 0 đọc như "hết hàng". */
  it("chưa đọc được tồn thì hiện dấu ba chấm, không hiện 0", () => {
    const list = EDITOR.slice(EDITOR.indexOf("{hits.map("), EDITOR.indexOf("{linesTitle}"))
    expect(list).toContain('x && x.onHand !== null ? formatInt(x.onHand) : "…"')
  })
})

describe("ô giảm giá đổi được tiền / phần trăm", () => {
  it("có nút đổi chế độ, nhãn đúng theo chế độ đang chọn", () => {
    const flat = EDITOR.replace(/\s+/g, " ")
    expect(flat).toContain("onClick={() => toggleDiscountMode(l)}")
    expect(flat).toContain('{l.discount_mode === "percent" ? "%" : "đ"}')
    /* Có ở CẢ bảng lẫn thẻ điện thoại — gỡ một bên thì bên đó kẹt. */
    expect(
      (flat.match(/onClick=\{\(\) => toggleDiscountMode\(l\)\}/g) ?? []).length,
      "thiếu nút đổi chế độ ở bảng hoặc ở thẻ điện thoại"
    ).toBe(2)
  })

  /**
   * ⚠ XOÁ TRẮNG Ô KHI ĐỔI CHẾ ĐỘ. Số 50 ở chế độ tiền là "giảm 50
   * đồng"; giữ nguyên khi sang phần trăm là lặng lẽ biến thành "giảm
   * 50%" — đổi nghĩa một con số đang có mà không ai thấy.
   */
  it("đổi chế độ thì xoá trắng ô", () => {
    const fn = EDITOR.slice(EDITOR.indexOf("const toggleDiscountMode"), EDITOR.indexOf("const pickUnit"))
    expect(fn).toContain('line_discount: ""')
  })

  /**
   * ⚠ Ở CHẾ ĐỘ %, PHẢI HIỆN LUÔN SỐ TIỀN QUY RA. Con số ghi xuống sổ là
   * tiền, không phải phần trăm — không hiện ra thì không đối chiếu được
   * với hoá đơn giấy.
   */
  it("chế độ phần trăm hiện số tiền quy ra", () => {
    expect(EDITOR).toContain("lineDiscountAmountOf(l)")
  })

  /**
   * ⚠ Trần 100 chỉ áp ở chế độ phần trăm — chặn cả chế độ tiền là chặn
   * oan: giảm 200.000 đồng là chuyện bình thường.
   *
   * ⚠ ĐẾM ĐỦ HAI CHỖ. Bản đầu chỉ đòi chuỗi có mặt ĐÂU ĐÓ; nó có mặt
   * hai lần (bảng cho máy tính, thẻ cho điện thoại), nên đổi một bên
   * thành `max={100}` vẫn xanh — và người dùng điện thoại không gõ nổi
   * một khoản giảm quá 100 đồng. Đã thử phá đúng như vậy.
   */
  it("trần 100 chỉ áp cho chế độ phần trăm, ở CẢ hai bản", () => {
    const n = (EDITOR.match(/max=\{l\.discount_mode === "percent" \? 100 : undefined\}/g) ?? []).length
    expect(n, `mới ${n}/2 ô — bản còn lại đang chặn oan chế độ tiền`).toBe(2)
  })
})

describe("bấm vào ô số là chọn hết nội dung", () => {
  /**
   * ⚠ CHỦ NHÀ BÁO: "ô số lượng bấm vào để gõ thì tự xoá trắng (hiện tại
   * cứ phải xoá số 0 đi)". Với người nhập cả phiếu ba mươi dòng, mỗi ô
   * phải bôi đen trước khi gõ là ba mươi lần thừa.
   *
   * ⚠ `onFocus` CHỨ KHÔNG `onClick` — Tab qua ô cũng phải chọn hết.
   */
  it("có hàm chọn hết, gắn bằng onFocus", () => {
    expect(EDITOR).toContain("const selectOnFocus")
    expect(EDITOR).toContain("e.currentTarget.select()")
    expect(EDITOR, "đang dùng onClick — bàn phím Tab sẽ không chọn hết")
      .not.toContain("onClick={selectOnFocus}")
  })

  /**
   * ⚠ ĐẾM ĐỦ MỌI Ô SỐ. Gắn cho một ô rồi quên ô kia là người dùng gặp
   * đúng cái phiền cũ ở nửa số ô — và không hiểu vì sao lúc được lúc
   * không. Sáu ô: số lượng ×2 (bảng + thẻ), đơn giá ×2, giảm giá ×2,
   * thuế suất trong modal, giảm giá đầu phiếu, tiền thuế đầu phiếu.
   */
  it("gắn cho MỌI ô số, không sót ô nào", () => {
    const n = (EDITOR.match(/onFocus=\{selectOnFocus\}/g) ?? []).length
    expect(n, `mới gắn ${n} ô — còn ô số chưa có`).toBe(9)
  })
})

describe("tiền thuế GTGT gõ tay được ở đầu phiếu", () => {
  /**
   * ⚠ CHỦ NHÀ BÁO: "Tiền thuế GTGT chưa nhập được?". Bản đầu chỉ cho gõ
   * THUẾ SUẤT của từng dòng, giấu trong modal — không có chỗ nào gõ SỐ
   * TIỀN thuế như tờ hoá đơn giấy của NCC ghi.
   */
  it("khối tổng có ô nhập tiền thuế, không phải chữ chết", () => {
    const totals = EDITOR.slice(EDITOR.indexOf("Tiền hàng"), EDITOR.indexOf("fixed inset-x-0 bottom-0"))
    expect(totals).toContain('id="pr-vat-total"')
    expect(totals).toContain("onChange={(v) => onChange({ vatOverride: String(v) })}")
    expect(totals, "tiền thuế vẫn chỉ là chữ đọc, không gõ được")
      .not.toContain("<dd className=\"tabular-nums\">{formatCurrency(totals.vat)}</dd>")
  })

  /** ⚠ Để trống thì máy tự cộng — gợi ý bằng placeholder, không ép gõ. */
  it("ô trống thì gợi ý số tự cộng qua placeholder", () => {
    expect(EDITOR).toContain("placeholder={String(Math.round(totals.vatComputed))}")
  })

  /**
   * ⚠ LỆCH VỚI SỐ TỰ CỘNG THÌ NÓI RA. Gõ đè một con số cách xa tổng
   * thuế suất các dòng thường là gõ nhầm ô — im lặng là để một phiếu
   * sai đi thẳng vào công nợ.
   */
  it("gõ lệch số tự cộng thì cảnh báo", () => {
    expect(EDITOR).toContain("totals.vatOverridden && Math.abs(totals.vat - totals.vatComputed) > 1")
    expect(EDITOR).toContain("Tự cộng từ dòng hàng là")
  })

  /**
   * ⚠ Ô TRỐNG → `null`, KHÔNG → 0. Gửi 0 lên là khai "hoá đơn này không
   * có thuế"; để trống là "máy tự cộng". Dùng `||` thay vì so chuỗi
   * rỗng là biến số 0 người dùng cố ý gõ thành ô trống.
   */
  it("hai màn gửi null khi để trống, và giữ số 0 khi gõ 0", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không gửi vat_override`).toContain(
        'vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride)'
      )
    }
    expect(EDIT_PAGE, "nạp lại đang biến số 0 thành ô trống").toContain(
      'vatOverride: h.vat_override == null ? "" : String(h.vat_override)'
    )
  })

  /**
   * ⚠ CỘT LƯU LÀ TIỀN, nên dòng nạp lại LUÔN ở chế độ tiền. Đoán ngược
   * ra phần trăm là bịa — cùng một số tiền ra vô số phần trăm tuỳ giá.
   */
  it("màn sửa nạp dòng về chế độ tiền", () => {
    expect(EDIT_PAGE).toContain('discount_mode: "amount"')
  })
})
