import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import {
  returnCreditOf, searchReturnable, toReturnLine, type ReturnCartLine,
} from "../src/lib/sell/returns"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const NEW = code(read("src/app/(dashboard)/returns/new/page.tsx"))
const MIG035 = read("supabase/migrations/035_return_exchange.sql")

const r = (over: Partial<ReturnCartLine> = {}): ReturnCartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 100_000,
  vatRate: 0,
  isExchange: false,
  note: "",
  ...over,
})

describe("Phiếu trả phải có HÀNG, không chỉ có tiền", () => {
  /**
   * ⚠ LỖI GỐC. Màn lập phiếu trả chỉ có: chọn khách, chọn lý do, và GÕ TAY
   * một con số "Giá trị Credit Note" — không dòng hàng nào. Kho không biết
   * nhận lại cái gì; số tiền trừ công nợ là con số ai đó tự gõ, không đối
   * chiếu được với mặt hàng nào; và màn chi tiết phiếu trả VẪN đọc
   * `return_lines` để hiện bảng hàng nên mọi phiếu tạo từ đây mở ra rỗng.
   */
  it("có ghi dòng hàng xuống return_lines", () => {
    expect(NEW).toContain('.from("return_lines")')
    expect(NEW).toContain("lines.map((l) => ({ return_id: head.id, ...toReturnLine(l) }))")
  })

  /** ⚠ Phiếu 0 dòng vẫn hiện ở danh sách, và không ai biết phải nhận lại gì. */
  it("không cho lưu phiếu rỗng", () => {
    expect(NEW).toContain("lines.length === 0")
    expect(NEW).toContain("Thêm ít nhất một mặt hàng")
  })

  /**
   * ⚠ Không còn ô gõ tay số tiền. Con số đó là thứ sinh ra vấn đề: nó không
   * buộc phải bằng tổng các dòng, và trigger cũng không đụng tới phiếu
   * không có dòng nào.
   */
  it("không còn ô nhập tay giá trị credit note", () => {
    expect(NEW).not.toContain("setCreditAmount")
    expect(NEW).not.toContain("Giá trị Credit Note")
  })

  /** Tiền là TỔNG các dòng, tính bằng chính phép dùng ở luồng bán hàng. */
  it("tiền trừ công nợ tính từ các dòng", () => {
    expect(NEW).toContain("const credit = returnCreditOf(lines)")
    expect(NEW).toContain("credit_note_amount: credit,")
  })

  /**
   * ⚠ Trigger `trg_return_lines_sync_credit` mới là NGƯỜI GIỮ SỔ: nó tính
   * lại `credit_note_amount` từ các dòng KHÔNG đổi-hàng mỗi khi dòng đổi.
   * Ghi sẵn ở màn hình chỉ để phiếu không có khoảnh khắc nào mang số 0.
   */
  it("trigger dưới database vẫn là nơi chốt con số", () => {
    expect(MIG035).toContain("CREATE TRIGGER trg_return_lines_sync_credit")
    expect(MIG035).toContain("AND is_exchange = false")
  })
})

describe("Giá trả bám theo giá ĐÃ BÁN", () => {
  /**
   * ⚠ Khách mua có chiết khấu thì trả lại phải tính đúng số tiền họ đã trả.
   * Lấy giá bảng hôm nay là hoàn cho khách nhiều hơn (hoặc ít hơn) số đã
   * thu — và chênh lệch đó không ai đối chiếu được vì phiếu trả không nói
   * nó bám vào đơn nào.
   */
  it("thêm từ đơn thì lấy đơn giá của đơn", () => {
    const i = NEW.indexOf("const addFromOrder =")
    expect(i, "không tìm thấy addFromOrder").toBeGreaterThan(0)
    const body = NEW.slice(i, NEW.indexOf("\n  }", i))
    expect(body).toContain("price: Number(l.unit_price) || 0")
    expect(body).not.toContain("sell_price")
  })

  /** Trần giá cũng là giá đã bán khi có đơn, chứ không phải giá bảng. */
  it("trần giá lấy theo đơn khi phiếu gắn đơn", () => {
    expect(NEW).toContain(
      "const ceiling = sold ? Number(sold.unit_price) : Number(p?.sell_price ?? 0)"
    )
    expect(NEW).toContain("returnPriceViolation(l, ceiling, priceRules)")
    // ⚠ Trần giá trả = trần giá bán của chính người đó, ở CẢ hai màn lập
    // phiếu trả. Hai màn hai trần là mở đường cho người ta chọn màn dễ hơn.
    expect(NEW).toContain("const priceRules = (() => {")
    expect(NEW).toContain("userPriceRulesFrom(user)")
  })

  /** ⚠ Trả cao hơn giá đã bán là một đường rút tiền — phải CHẶN, không chỉ tô đỏ. */
  it("giá vượt trần thì không lưu được", () => {
    expect(NEW).toContain("priceBad > 0")
    expect(NEW).toContain("Có dòng trả vượt trần giá")
  })

  /**
   * Gắn phiếu vào chứng từ gốc để đối chiếu được, nhưng KHÔNG bắt buộc —
   * khách vẫn trả được hàng mua từ lâu không còn tra ra chứng từ.
   *
   * ⚠ V2B ĐỔI MỐC SANG HÓA ĐƠN. Khách chỉ trả được thứ đã THỰC XUẤT; đơn
   * đặt 100 mà mới giao 40 thì trần trả là 40. Gắn vào đơn là cho phép
   * nhập kho 60 món chưa từng rời kho — và cả trigger (mig 124) lẫn RPC
   * (mig 127) đều đếm theo hóa đơn, nên phiếu gắn sai chỗ sẽ vấp lỗi ở
   * màn Hoàn thành, một chỗ chẳng liên quan gì tới việc người ta vừa làm.
   */
  it("gắn hóa đơn là tuỳ chọn", () => {
    expect(NEW).toContain("invoice_id: invoiceId || null")
    expect(NEW).toContain("Không gắn hóa đơn nào")
  })

  /**
   * ⚠ GHI CẢ HAI KHOÁ NGOẠI. `invoice_id` là mốc thật của v2b, còn
   * `order_id` là thứ mọi báo cáo lịch sử đang đọc — bỏ nó là đứt một
   * nửa sổ.
   */
  it("ghi cả order_id suy ra từ hóa đơn đã chọn", () => {
    expect(NEW).toContain(
      "order_id: invoices.find((i) => i.id === invoiceId)?.order_id ?? null,"
    )
  })

  /**
   * ⚠ CHỈ HÓA ĐƠN CÒN HIỆU LỰC. Hóa đơn đã huỷ đã hoàn hàng về kho rồi;
   * gắn phiếu trả vào nó là nhập kho lần thứ hai cho cùng một lô hàng.
   */
  it("danh sách chọn chỉ có hóa đơn đã xuất", () => {
    expect(NEW).toContain('.from("sales_invoices")')
    expect(NEW).toContain('.eq("status", "posted")')
  })

  /**
   * ⚠ GỢI Ý LẤY TỪ DÒNG HÓA ĐƠN, không từ dòng đơn: đúng số đã giao và
   * đúng giá đã bán của chính chuyến đó. Dòng đơn có thể ghi số lớn hơn
   * thứ đã ra khỏi kho, và giá thì có thể đã bị sửa lúc xuất.
   */
  it("gợi ý hàng lấy từ dòng hóa đơn", () => {
    expect(NEW).toContain('.from("sales_invoice_lines")')
    expect(NEW).not.toContain('.from("sales_order_lines")')
  })
})

describe("Ghi hỏng thì nói ra", () => {
  /** ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. */
  it("đầu phiếu không tạo được thì báo, không đi tiếp", () => {
    expect(NEW).toContain("if (!head?.id) {")
    expect(NEW).toContain("bạn không có quyền trên đơn vị này")
  })

  /**
   * ⚠ ĐẦU PHIẾU GHI ĐƯỢC MÀ DÒNG HÀNG BỊ TỪ CHỐI thì sinh ra đúng thứ vừa
   * đi sửa: một phiếu trả có tiền mà không có hàng.
   */
  it("chèn thiếu dòng hàng thì báo, không nói 'đã tạo'", () => {
    expect(NEW).toContain("if (!inserted || inserted.length !== lines.length) {")
    expect(NEW).toContain("dòng hàng. Mở phiếu ra kiểm tra")
  })

  /** Danh mục đọc hỏng mà hiện rỗng là để người dùng kết luận "chưa có khách nào". */
  it("đọc danh mục hỏng thì hiện lỗi", () => {
    expect(NEW).toContain("setLoadError(custRes.error ?? prodRes.error ?? null)")
    expect(NEW).toContain("Không tải được danh mục")
  })

  /** ⚠ Hơn 1.000 khách là chuyện thường, mà server cắt ở 1.000 dòng và không báo. */
  it("danh mục khách và sản phẩm đều phân trang", () => {
    const uses = NEW.match(/fetchAllForAggregate</g) ?? []
    expect(uses.length, "thiếu phân trang ở khách hoặc ở sản phẩm").toBe(2)
  })

  /** Nút mờ không nói gì là người dùng bấm mãi rồi đi hỏi. */
  it("nút bị khoá thì nói rõ vì sao", () => {
    expect(NEW).toContain("disabled={!!blocked || saving}")
    expect(NEW).toContain("title={blocked ?? undefined}")
    expect(NEW).toContain("{saving ? \"Đang lưu...\" : (blocked ?? \"Tạo phiếu trả\")}")
  })
})

describe("Dùng chung phép tính với luồng bán hàng", () => {
  /**
   * ⚠ Hai màn cùng lập phiếu trả — một trong luồng bán hàng, một độc lập.
   * Chép lại phép tính tiền là mở đường cho hai màn ra hai con số khác nhau
   * cho cùng một rổ hàng.
   */
  it("không tự viết lại phép cộng tiền hay phép dựng dòng", () => {
    expect(NEW).toContain('from "@/lib/sell/returns"')
    expect(NEW).toContain("returnCreditOf")
    expect(NEW).toContain("toReturnLine")
    expect(NEW).toContain("addReturnLine")
  })

  it("phép tính đó vẫn đúng: đổi hàng không trừ tiền, trả tiền có VAT", () => {
    expect(returnCreditOf([r({ qty: 2 }), r({ productId: "p2", isExchange: true, qty: 9 })])).toBe(
      200_000
    )
    expect(returnCreditOf([r({ vatRate: 0.08 })])).toBe(108_000)
  })

  it("dòng ghi xuống DB luôn mang is_exchange", () => {
    expect(Object.keys(toReturnLine(r()))).toContain("is_exchange")
  })
})

// =====================================================================

const DETAIL = code(read("src/app/(dashboard)/returns/[id]/page.tsx"))
const MIG125 = read("supabase/migrations/125_wf2b_invoice_rpcs.sql")

/**
 * Ô CHỌN KHÁCH PHẢI GÕ TÌM ĐƯỢC.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Phần làm đơn trả hàng, list khách hàng xổ
 * xuống chưa tìm kiếm được khách hàng". Danh sách khách ở màn này kéo
 * ĐỦ theo trang — nghĩa là với NPP có hơn một nghìn khách thì một
 * `<Select>` liệt kê hết rồi bắt cuộn không dùng được. Càng sửa cho
 * "đọc đủ" thì cái ô càng dài, và người lập phiếu càng khổ.
 */
describe("chọn khách ở phiếu trả: gõ để tìm", () => {
  it("dùng SearchSelect, không phải Select liệt kê rồi cuộn", () => {
    expect(NEW, "màn phiếu trả không dùng ô chọn có tìm kiếm").toContain("<SearchSelect")
    /* ⚠ SOI ĐÚNG Ô KHÁCH. Màn này còn vài `<Select>` khác (lý do, hóa
       đơn, trả tiền/đổi hàng) và chúng liệt kê vài mục cố định — đòi bỏ
       hết `<Select>` là đòi một thứ không liên quan. */
    expect(
      /<Select[\s\S]{0,600}?\{\s*customers\.map\(/.test(NEW),
      "ô chọn khách vẫn là <Select> liệt kê cả danh sách rồi bắt cuộn"
    ).toBe(false)
  })

  /**
   * ⚠ TÌM ĐƯỢC NGHĨA LÀ TÌM ĐƯỢC BẰNG THỨ NGƯỜI TA NHỚ. Người lập phiếu
   * trả thường chỉ nhớ số điện thoại hoặc tên chủ cửa hàng. Một ô tìm
   * chỉ soi `store_name` thì gõ số điện thoại ra rỗng — vẫn là "chưa
   * tìm kiếm được khách hàng", chỉ khác cách hỏng.
   */
  it("đọc cả tên chủ và số điện thoại để tìm theo", () => {
    expect(NEW).toContain("id, store_name, owner_name, phone")
    const opt = NEW.match(/const customerOptions = useMemo\(([\s\S]{0,600}?)\n  \)/)
    expect(opt, "không dựng được danh sách cho ô tìm").not.toBeNull()
    expect(opt![1], "ô tìm không soi tên chủ cửa hàng").toContain("owner_name")
    expect(opt![1], "ô tìm không soi số điện thoại").toContain("phone")
  })

  /**
   * ⚠ KHÔNG CHO GÕ TỰ DO Ở Ô NÀY. `customer_id` đi thẳng vào công nợ;
   * một cái tên gõ tay không trừ nợ cho ai cả. `SearchSelect` chỉ cho
   * gõ tự do khi nơi gọi bật `allowFreeText`.
   */
  it("không cho gõ tay một khách không có trong sổ", () => {
    const blk = NEW.match(/<SearchSelect[\s\S]{0,700}?\/>/)
    expect(blk, "không đọc được ô chọn khách").not.toBeNull()
    expect(blk![0], "ô chọn khách cho gõ tự do — tên gõ tay không trừ nợ cho ai")
      .not.toContain("allowFreeText")
  })
})

/**
 * PHIẾU TRẢ PHẢI CHỈ RA TỜ HÓA ĐƠN BÁN CỦA NÓ.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "thêm tham chiếu Hoá đơn bán vào đơn trả
 * tự sinh".
 *
 * ⚠ MỐI NỐI ĐÃ CÓ TRONG SỔ TỪ LÂU, CHỈ LÀ KHÔNG AI HIỆN RA.
 * `post_invoice` gắn `returns.invoice_id` ngay lúc xuất hàng (mig 125),
 * nhưng màn chi tiết phiếu trả chỉ đọc `order:sales_orders(order_code)`.
 * Người đối chiếu công nợ nhìn thấy một khoản trừ và một mã ĐƠN — trong
 * khi trần số được trả lại đếm theo HÓA ĐƠN, và một đơn giao nhiều đợt
 * có nhiều hóa đơn. Họ phải tự đoán đợt nào.
 */
describe("phiếu trả chỉ ra hóa đơn bán của nó", () => {
  it("RPC vẫn là chỗ gắn mối nối ấy", () => {
    expect(
      /UPDATE returns SET status = 'submitted', invoice_id = v_inv/.test(MIG125),
      "post_invoice thôi gắn invoice_id — phiếu trả tự sinh mất mốc đối chiếu"
    ).toBe(true)
  })

  it("màn chi tiết đọc hóa đơn, không chỉ đọc đơn", () => {
    expect(DETAIL, "không đọc invoice_id").toContain("invoice_id")
    expect(DETAIL, "không đọc mã hóa đơn").toContain("invoice:sales_invoices(invoice_code")
  })

  /**
   * ⚠ ĐỌC LÊN MÀ KHÔNG VẼ RA THÌ BẰNG KHÔNG — đúng thứ lỗi vừa phải
   * siết lại ở chốt danh mục hôm nay. Mốc là ĐƯỜNG DẪN người dùng bấm
   * được, không phải một cột trong câu truy vấn.
   */
  it("và hiện ra một đường dẫn bấm được tới hóa đơn", () => {
    expect(DETAIL).toContain("Hóa đơn bán")
    expect(
      /href=\{`\/sales-invoices\/\$\{inv\.invoice_id\}`\}/.test(DETAIL),
      "đọc invoice_id lên rồi không dẫn đi đâu cả"
    ).toBe(true)
  })

  /** ⚠ GIỮ CẢ HAI MỐC. Đơn và hóa đơn trả lời hai câu hỏi khác nhau. */
  it("vẫn giữ đường dẫn tới đơn hàng gốc", () => {
    expect(DETAIL).toContain("Đơn hàng gốc")
    expect(DETAIL).toContain("`/orders/${ret.order_id}`")
  })
})

// =====================================================================

/**
 * QUÉT CẢ KHO MÃ — còn ô chọn khách nào bắt cuộn nữa không.
 *
 * ⚠ DANH SÁCH KHÁCH CỦA NPP KHÔNG PHẢI MỘT DANH SÁCH NGẮN. Hễ một
 * `<Select>` liệt kê `customers.map(...)` thì người dùng phải cuộn qua
 * hàng nghìn dòng để tìm một cái tên — và không gõ được chữ nào.
 */
/**
 * ⚠ DANH SÁCH NAY RỖNG (chủ nhà chốt 21/09/2026: "XỬ lý nốt 4 màn bắt
 * cuộn chọn khách"). Bốn màn từng nằm đây — Đơn hàng, Hóa đơn bán, Tuổi
 * nợ, Phiếu thu — nay đều gõ để tìm.
 *
 * ⚠ GIỮ MẢNG LẠI DÙ RỖNG, ĐỪNG XOÁ. Nó là chỗ DUY NHẤT hợp lệ để ghi
 * một màn còn bắt cuộn, và chốt ngay dưới đòi mỗi tên trong đó phải
 * THẬT SỰ còn bắt cuộn — nên không ai nhét được một màn đã sửa vào đây
 * để né. Xoá mảng đi thì lần sau người ta lại nới chính chốt quét.
 */
const CON_NO_CHON_KHACH_PHAI_CUON: string[] = []

function chonKhachPhaiCuon(src: string): boolean {
  return /<Select\b[\s\S]{0,700}?\{\s*customers\.map\(/.test(src)
}

function moiTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) moiTsx(p, acc)
    else if (name.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

describe("không màn nào MỚI bắt cuộn để chọn khách", () => {
  it("chỉ những màn đã ghi nợ mới còn <Select> liệt kê cả danh sách khách", () => {
    const bad: string[] = []
    for (const base of ["src/app", "src/components"]) {
      for (const abs of moiTsx(resolve(ROOT, base))) {
        const rel = abs.slice(ROOT.length + 1)
        if (CON_NO_CHON_KHACH_PHAI_CUON.includes(rel)) continue
        if (chonKhachPhaiCuon(code(readFileSync(abs, "utf-8")))) bad.push(rel)
      }
    }
    expect(
      bad,
      "ô chọn khách là <Select> liệt kê cả danh sách — không gõ tìm được, " +
        "phải cuộn qua hàng nghìn dòng:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  /** ⚠ Sửa màn nào thì xoá tên màn ấy — nếu không cái lỗ vẫn mở. */
  it("mỗi màn trong danh sách nợ đều thật sự còn bắt cuộn", () => {
    for (const rel of CON_NO_CHON_KHACH_PHAI_CUON) {
      expect(
        chonKhachPhaiCuon(code(read(rel))),
        `${rel} đã hết bắt cuộn — xoá tên nó khỏi CON_NO_CHON_KHACH_PHAI_CUON`
      ).toBe(true)
    }
  })

  /**
   * ⚠ PHÉP QUÉT PHẢI NHÌN THẤY GÌ ĐÓ. Biểu thức gõ hỏng thì `bad` rỗng
   * và chốt trên xanh vĩnh viễn — kiểu chốt nói dối đã để lọt vài lỗi
   * hôm nay. Bốn màn trong danh sách nợ là bằng chứng phép quét còn chạy.
   */
  it("phép quét còn nhận ra được mẫu ấy", () => {
    /* ⚠ DANH SÁCH NỢ ĐÃ RỖNG, nên phải thử trên một mẫu DỰNG SẴN — nếu
       không thì phép quét hỏng cũng xanh, đúng kiểu chốt nói dối. */
    const xau = `
      <Select value={customerFilter} onValueChange={setCustomerFilter}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {customers.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.store_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>`
    expect(chonKhachPhaiCuon(xau), "phép quét không còn nhận ra mẫu xấu").toBe(true)
    const tot = `
      <SearchSelect options={customerOptions} valueId={customerFilter}
        onPick={(o) => setCustomerFilter(o?.id ?? "all")} />`
    expect(chonKhachPhaiCuon(tot), "phép quét báo oan ô đã sửa").toBe(false)
  })

  /** ⚠ Và bốn màn ấy thật sự đã dùng ô gõ tìm, không chỉ "hết khớp mẫu". */
  it("bốn màn từng bắt cuộn nay đều gõ để tìm", () => {
    for (const rel of [
      "src/app/(dashboard)/orders/page.tsx",
      "src/app/(dashboard)/sales-invoices/page.tsx",
      "src/app/(dashboard)/receivables/aging/page.tsx",
      "src/app/(dashboard)/finance/cash-receipts/new/page.tsx",
    ]) {
      const src = code(read(rel))
      expect(src, `${rel} không dùng ô chọn có tìm kiếm`).toContain("<SearchSelect")
      /* ⚠ TÌM ĐƯỢC BẰNG THỨ NGƯỜI TA NHỚ — tên chủ và số điện thoại,
         không chỉ tên cửa hàng. */
      expect(src, `${rel} không đọc tên chủ / số điện thoại để tìm`)
        .toContain("id, store_name, owner_name, phone")
    }
  })
})

// =====================================================================

/**
 * Ô TÌM HÀNG Ở PHIẾU TRẢ: BẤM VÀO LÀ XỔ DANH SÁCH.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Đơn trả hàng phần tìm kiếm sản phẩm khi
 * tìm kiếm phải xổ list, rà soát lại xem chuẩn chưa?".
 *
 * ⚠ VÀ ĐÂY LÀ LẦN THỨ BA CÙNG MỘT CHỖ HỎNG. Luật "bấm vào là xổ list"
 * chốt ngày 20/09; bốn màn phiếu đổi theo vì chúng dùng chung
 * `ProductPicker`. Hai màn TỰ VẼ ô tìm riêng bị bỏ sót — màn hóa đơn
 * (sửa sáng 21/09) và màn này. Mỗi ô tìm tự vẽ là một lần nữa phải nhớ,
 * và trí nhớ đã hỏng hai lần rồi. Chốt dưới cùng canh đúng chuyện đó.
 */
describe("ô tìm hàng ở phiếu trả xổ danh sách khi bấm vào", () => {
  it("dùng ProductPicker, không tự vẽ ô tìm", () => {
    expect(NEW, "màn phiếu trả vẫn tự vẽ ô tìm hàng").toContain("<ProductPicker")
  })

  /**
   * ⚠ CHẠY THẬT CÁI LUẬT, ĐỪNG SOI CÁCH VIẾT. Bản đầu của chốt này tìm
   * đúng một chuỗi `if (!term) return []` trong `page.tsx`. Đã thử phá
   * bằng một cách viết khác (`q.trim() ? products : []`) và chốt VẪN
   * XANH — nó canh một cách gõ, không canh một hành vi. Luật nay nằm ở
   * `searchReturnable` và được gọi thẳng ở đây.
   */
  it("ô trống thì xổ danh sách, có trần", () => {
    const cat = [
      { id: "p1", name: "Bánh Đậu Xanh", sku: "S1", barcode: null },
      { id: "p2", name: "Kem Sữa Dừa", sku: "S2", barcode: "8938" },
    ]
    expect(searchReturnable(cat, "", 30).map((p) => p.id)).toEqual(["p1", "p2"])
    expect(searchReturnable(cat, "   ", 30).map((p) => p.id)).toEqual(["p1", "p2"])
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `x${i}`, name: `Bánh ${i}`, sku: `S${i}`, barcode: null,
    }))
    expect(searchReturnable(many, "", 30)).toHaveLength(30)
  })

  /** ⚠ Gõ rời rạc, sai thứ tự, không dấu — cách người bán thật sự gõ. */
  it("gõ rồi thì lọc, bỏ dấu và không cần đúng thứ tự", () => {
    const cat = [
      { id: "p1", name: "Bánh Đậu Xanh", sku: "S1", barcode: null },
      { id: "p2", name: "Kem Sữa Dừa", sku: "S2", barcode: "8938" },
    ]
    expect(searchReturnable(cat, "xanh banh", 30).map((p) => p.id)).toEqual(["p1"])
    expect(searchReturnable(cat, "dua", 30).map((p) => p.id)).toEqual(["p2"])
    expect(searchReturnable(cat, "8938", 30).map((p) => p.id)).toEqual(["p2"])
  })

  /** ⚠ Và màn hình phải GỌI cái luật ấy, không chép lại một bản riêng. */
  it("màn hình gọi luật chung, không tự lọc", () => {
    expect(NEW).toContain("searchReturnable(products, q, PICK_CAP)")
    expect(
      /viMatchAllWords\(/.test(NEW),
      "màn hình vẫn tự lọc — luật lại nằm ở chỗ không chốt nào canh được"
    ).toBe(false)
  })

  it("dùng trần chung PICKER_PEEK như bốn màn phiếu kia", () => {
    expect(NEW).toContain("PICKER_PEEK")
  })
})

/**
 * QUÉT CẢ KHO MÃ — còn ô thêm hàng nào tự vẽ nữa không.
 *
 * ⚠ LUẬT CHUNG, KHÔNG THEO TỪNG MÀN. Sửa riêng phiếu trả thì lần sau
 * một màn khác tự vẽ ô tìm lại lọt đúng như hai lần trước.
 */
const CON_NO_TU_VE_O_TIM_HANG = [
  /**
   * ⚠ MÀN NÀY TÌM Ở MÁY CHỦ, không nạp sẵn cả danh mục — nên nó KHÔNG
   * dùng được `ProductPicker`, và đó là lý do kỹ thuật thật chứ không
   * phải bỏ sót. Nó ĐÃ xổ 15 mã đầu khi ô còn trống, tức hành vi nhìn
   * từ phía người dùng là đúng. Ghi tên ở đây để phép quét không báo
   * oan, kèm chốt riêng bên dưới canh phần hành vi.
   */
  "src/app/(dashboard)/inventory/stocktake-adjust/page.tsx",
]

/*
 * ⚠ `src/components/pos/order-screen.tsx` ĐÃ RỜI DANH SÁCH NÀY.
 *
 * Nó từng được miễn với lý do "ô tìm của màn desktop khác hẳn". Chủ nhà
 * bác lý do ấy (chốt 21/09/2026, đợt 7): *"phần tìm hàng hoá dùng
 * productpicker đã viết sẵn"*. Nay màn đơn hàng của `/pos` dùng đúng
 * component chung, và chốt dưới đây canh điều đó.
 */

/** Màn có ô THÊM HÀNG VÀO PHIẾU (không phải bộ lọc của màn báo cáo). */
function laOThemHang(src: string): boolean {
  return (
    /searchAddable\(|searchReturnProducts\(/.test(src) ||
    /setMatches\(/.test(src) ||
    /addProductLine\(|addFromCatalog\(|addProduct\(/.test(src)
  )
}

describe("không màn nào MỚI tự vẽ ô thêm hàng", () => {
  it("mọi ô thêm hàng đều đi qua ProductPicker", () => {
    const bad: string[] = []
    for (const base of ["src/app", "src/components"]) {
      for (const abs of moiTsx(resolve(ROOT, base))) {
        const rel = abs.slice(ROOT.length + 1)
        if (CON_NO_TU_VE_O_TIM_HANG.includes(rel)) continue
        const src = code(readFileSync(abs, "utf-8"))
        if (!laOThemHang(src)) continue
        /**
         * ⚠ ĐĂNG KÝ VÀO Ô TÌM DÙNG CHUNG CŨNG LÀ ĐẠT. Luật ở đây là
         * "đừng tự vẽ ô tìm", không phải "phải viết đúng chữ
         * ProductPicker". Màn đơn của `/pos` đưa danh mục lên ô tìm
         * trên header (`useRegisterPosProductSearch`) — ô ấy CHÍNH LÀ
         * `ProductPicker`, chỉ vẽ ở khung chứ không vẽ trong màn.
         */
        if (!src.includes("ProductPicker") && !src.includes("useRegisterPosProductSearch")) {
          bad.push(rel)
        }
      }
    }
    expect(
      bad,
      "tự vẽ ô thêm hàng thay vì dùng ProductPicker — lần sau đổi luật " +
        'ô tìm thì màn này lại bị bỏ sót, đúng như đã xảy ra hai lần:\n  ' +
        bad.join("\n  ")
    ).toEqual([])
  })

  /**
   * ⚠ MÀN NGOẠI LỆ VẪN PHẢI XỔ LIST. Được miễn dùng component chung
   * KHÔNG phải được miễn cái luật — nếu không thì danh sách nợ thành
   * cửa sau.
   */
  it("màn tìm ở máy chủ vẫn xổ danh sách khi ô còn trống", () => {
    const src = code(read("src/app/(dashboard)/inventory/stocktake-adjust/page.tsx"))
    expect(
      /q\.length >= 2\s*\?\s*base\.or\(/.test(src),
      "màn kiểm kê thôi xổ danh sách khi ô còn trống"
    ).toBe(true)
  })

  /**
   * ⚠ MÀN ĐƠN HÀNG CỦA `/pos` DÙNG `ProductPicker`. Chủ nhà chốt đợt 7.
   *   Chốt này canh chính cái quyết định ấy — nó dễ bị đảo ngược lại
   *   bằng một câu "màn desktop cần ô tìm riêng", và đó đúng là lý do
   *   nó đã được miễn một lần.
   */
  it("màn đơn hàng /pos đăng ký vào ô tìm dùng chung, không tự vẽ", () => {
    const src = code(read("src/components/pos/order-screen.tsx"))
    /**
     * ⚠ CANH CHỖ GỌI, KHÔNG CANH DÒNG `import`. Bản đầu của chốt này
     * dùng `.toContain("useRegisterPosProductSearch")` — và dòng nhập
     * khẩu ở đầu tệp đã đủ làm nó xanh. Đột biến gỡ SẠCH lời gọi mà
     * chốt vẫn không kêu: màn không còn đưa danh mục lên header, ô tìm
     * trên đó rỗng, và không gì đỏ.
     */
    expect(
      /useRegisterPosProductSearch\(\{/.test(src),
      "màn đơn không GỌI useRegisterPosProductSearch — ô tìm trên header sẽ rỗng"
    ).toBe(true)
    /* ⚠ VÀ KHÔNG TỰ VẼ Ô NÀO NỮA — đợt 9 bỏ cái thứ hai. */
    expect(/<ProductPicker/.test(src), "màn đơn lại tự vẽ ô tìm hàng thứ hai").toBe(false)
    /* Ô tìm KHÁCH vẫn là `SearchDropdown` của POS — chủ nhà chốt giữ
       nguyên. Nên chỉ cấm dùng nó cho HÀNG HÓA. */
    expect(
      /open=\{moTimHang\}/.test(src),
      "ô tìm hàng riêng của POS đã quay lại màn đơn hàng"
    ).toBe(false)
  })

  /**
   * ⚠ VÀ Ô TÌM DÙNG CHUNG ẤY CHÍNH LÀ `ProductPicker`. Không có chốt
   *   này thì sổ đăng ký thành một cửa sau: màn "đăng ký" rồi khung tự
   *   vẽ một ô tìm khác, và cả hai chốt trên vẫn xanh.
   */
  it("ô tìm trên header của /pos là ProductPicker", () => {
    const src = code(read("src/components/pos/pos-top-bar.tsx"))
    expect(src).toContain("<ProductPicker")
    expect(src).toMatch(/id=\{POS_PICKER_ID\}/)
  })

  /**
   * ⚠ CÁC MÀN `/pos` CÒN LẠI VẪN DÙNG `SearchDropdown`, và luật "bấm
   *   vào là xổ list" vẫn phải đúng ở đó. Chủ nhà đã chốt cho toàn app:
   *   "bấm vào là phải xổ list rồi (như khi chọn NCC ấy)". Ô rỗng trả
   *   về danh sách rỗng là người dùng phải đoán từ khoá.
   */
  it("ô tìm hàng của /pos vẫn xổ danh sách khi còn trống", () => {
    const src = code(read("src/components/pos/search-dropdown.tsx"))
    /* Không gõ gì → `words` rỗng → vẫn trả về danh sách, không trả rỗng. */
    expect(
      /if \(!words\.length\) return items/.test(src),
      "ô tìm của /pos thôi xổ danh sách khi ô còn trống"
    ).toBe(true)
    expect(
      /if \(!words\.length\) return \[\]/.test(src),
      "ô tìm của /pos trả danh sách RỖNG khi chưa gõ"
    ).toBe(false)
  })

  /**
   * ⚠ VÀ CẢ `/pos` CHỈ CÓ MỘT Ô TÌM HÀNG. Đây đúng là thứ danh sách nợ
   *   sinh ra để canh: miễn cho một màn rồi màn thứ hai tự vẽ tiếp là
   *   quay lại đúng chỗ cũ.
   */
  it("/pos chỉ có một component ô tìm dùng chung", () => {
    const pham = moiTsx(resolve(ROOT, "src/components/pos"))
      .map((p) => p.slice(ROOT.length + 1))
      .filter((rel) => /search|picker|dropdown/i.test(rel))
    expect(pham).toEqual(["src/components/pos/search-dropdown.tsx"])
  })

  /** ⚠ Phép quét phải còn nhận ra mẫu ấy — nếu không nó xanh vì mù. */
  it("phép quét còn nhìn thấy các ô thêm hàng", () => {
    let thay = 0
    for (const base of ["src/app", "src/components"]) {
      for (const abs of moiTsx(resolve(ROOT, base))) {
        if (laOThemHang(code(readFileSync(abs, "utf-8")))) thay += 1
      }
    }
    expect(thay, "phép quét hỏng — không thấy ô thêm hàng nào").toBeGreaterThanOrEqual(6)
  })
})
