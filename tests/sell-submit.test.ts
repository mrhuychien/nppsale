import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { decideStatus } from "../src/lib/sell/submit"
import { buildOrderPayload, grossBeforeDiscountOf } from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import { DRAFT_APPROVAL_REASON } from "../src/lib/orders/save-gate"
import { DEFAULT_APPROVAL_RULES } from "../src/lib/approval"
import type { ApprovalRules } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SUBMIT = code(read("src/lib/sell/submit.ts"))
const CART_PAGE = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const POS_PAGE = code(read("src/app/(dashboard)/sell/page.tsx"))
const CTX = code(read("src/lib/sell/approval-context.ts"))

const rules = { ...DEFAULT_APPROVAL_RULES } as unknown as ApprovalRules

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 1_000_000,
  listPrice: 1_000_000,
  note: "",
  conversion: 1,
  vatRate: 0,
  ...over,
})

const input = (cart: CartLine[], over: Record<string, unknown> = {}) => ({
  orderTotal: cartTotals(cart).grandTotal,
  subtotal: cartTotals(cart).subtotal,
  grossBeforeDiscount: grossBeforeDiscountOf(cart),
  payload: buildOrderPayload({
    clientRequestId: "r1",
    orderCode: "DH-1",
    customerId: "c1",
    customerName: "KH",
    paymentTerms: "COD",
    expectedDelivery: null,
    notes: "",
    cart,
    totals: cartTotals(cart),
    createdAt: "2026-09-17T00:00:00.000Z",
    returnReason: "damaged",
    returnLines: [],
  }),
  asDraft: false,
  cart,
  customer: { id: "c1", credit_limit: 0 },
  rules,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  role: "sales" as const,
  online: true,
  ...over,
})

describe("Quyết trạng thái đơn khi gửi", () => {
  /**
   * ⚠ WORKFLOW V2: gửi đơn LUÔN ra Phiếu tạm. Bộ quy tắc không còn chặn
   * ai — nó chỉ sinh câu cảnh báo cho nhà phân phối đọc trước khi bấm
   * Xuất hàng.
   */
  it("đơn nhỏ trong ngưỡng: phiếu tạm, không cảnh báo gì", () => {
    const r = decideStatus(input([line({ qty: 1, price: 1_000_000, listPrice: 1_000_000 })]))
    expect(r.status).toBe("submitted")
    expect(r.reason).toBe("")
  })

  it("đơn vượt ngưỡng: vẫn là phiếu tạm, nhưng kèm cảnh báo", () => {
    const r = decideStatus(input([line({ qty: 100, price: 1_000_000, listPrice: 1_000_000 })]))
    expect(r.status).toBe("submitted")
    expect(r.reason.length).toBeGreaterThan(0)
  })

  /**
   * ⚠ Chưa gửi đi thì chưa có gì để duyệt. Chạy quy tắc lúc này chỉ tạo ra
   * một kết quả sẽ cũ mất trước khi ai kịp đọc, vì người dùng còn sửa tiếp.
   */
  it("Lưu tạm KHÔNG chạy quy tắc duyệt", () => {
    const small = [line({ qty: 1, price: 1_000, listPrice: 1_000 })]
    // Cùng bộ dữ liệu này khi gửi thật thì thành phiếu tạm.
    expect(decideStatus(input(small)).status).toBe("submitted")
    const r = decideStatus(input(small, { asDraft: true }))
    expect(r.status).toBe("draft")
    expect(r.reason).toBe(DRAFT_APPROVAL_REASON)
  })

  /**
   * ⚠ LỖ HỔNG PHẢI BỊT. Mọi ngưỡng đều xét tổng SAU chiết khấu. Sửa giá
   * xuống 0 làm đơn trăm triệu tụt xuống dưới ngưỡng và TỰ ĐỘNG DUYỆT —
   * cho không hàng mà không ai được hỏi. Quy tắc chiết khấu sâu chỉ bắt
   * được khi có `grossBeforeDiscount`.
   */
  it("cho không hàng bằng cách sửa giá về 0 thì PHẢI có cảnh báo", () => {
    const freebie = [line({ qty: 100, price: 0, listPrice: 1_000_000 })]
    expect(cartTotals(freebie).grandTotal).toBe(0)
    const r = decideStatus(input(freebie))
    expect(r.status).toBe("submitted")
    // Tổng bằng 0 lọt mọi ngưỡng; chỉ quy tắc chiết khấu sâu bắt được.
    expect(r.reason.length).toBeGreaterThan(0)
  })

  /**
   * ⚠ `approval_reason` để trống nghĩa là "đã duyệt, không có gì vướng".
   * Đơn nháp chưa ai xem nên phải nói rõ vì sao nó còn nằm đó.
   */
  it("đơn nháp có ghi lý do, không để trống", () => {
    expect(DRAFT_APPROVAL_REASON.trim().length).toBeGreaterThan(0)
    expect(DRAFT_APPROVAL_REASON).toContain("nháp")
  })

  /**
   * ⚠ Chiết khấu sâu không còn CHẶN đơn (v2 bỏ bước duyệt), nhưng phải
   * hiện thành cảnh báo. Im lặng ở đây là nhà phân phối bấm Xuất hàng mà
   * không biết đơn này bán dưới giá sàn bao nhiêu.
   */
  it("chiết khấu sâu vẫn phải cảnh báo dù tổng nhỏ", () => {
    const deep = [line({ qty: 10, price: 100_000, listPrice: 1_000_000 })]
    const r = decideStatus(input(deep))
    expect(r.status).toBe("submitted")
    expect(r.reason.length).toBeGreaterThan(0)
  })
})

describe("Một đường ghi duy nhất, có mạng hay không", () => {
  /**
   * ⚠ Không mạng thì gói đơn vào hàng đợi, và chính `createOrderRecords`
   * đẩy nó lên sau. Nhờ vậy đường ngoại tuyến không còn là nhánh ít ai
   * chạy tới — nó là chính đường kia, chỉ hoãn lại.
   */
  it("mất mạng thì xếp hàng, không ghi thẳng", () => {
    expect(SUBMIT).toContain("if (!i.online) {")
    expect(SUBMIT).toContain("await enqueueOrder(payload)")
  })

  it("có mạng thì đi qua createOrderRecords, không tự viết insert", () => {
    expect(SUBMIT).toContain("await createOrderRecords(supabase, payload, ctx)")
    expect(SUBMIT).not.toContain('.insert(')
  })

  /**
   * ⚠ TRẠNG THÁI ĐI CÙNG ĐƠN, kể cả khi đơn nằm trong hàng đợi ngoại
   * tuyến. Bản cũ insert `draft` rồi UPDATE lên trạng thái thật; đơn tạo
   * lúc mất mạng không ai chạy bước UPDATE đó nên nằm mãi ở nháp và nhà
   * phân phối không bao giờ thấy nó.
   */
  it("chỉ MỘT lệnh ghi, trạng thái nằm trong payload", () => {
    expect(SUBMIT).toContain("targetStatus: status")
    expect(SUBMIT).not.toContain('.update(')
    const CREATE = readFileSync(resolve(__dirname, "../src/lib/orders/create.ts"), "utf-8")
    expect(CREATE).toContain('status: payload.targetStatus ?? "draft"')
  })
})

describe("Màn giỏ hàng", () => {
  /**
   * ⚠ Khoá nối phải sinh TRƯỚC khi gửi và BẤT BIẾN. Mạng chập chờn thì cú
   * gửi lặp lại; khoá đó là thứ giữ cho lần thứ hai không thành đơn thứ hai.
   *
   * ⚠ BẢN TRƯỚC CỦA CHỐT NÀY CANH ĐÚNG CÁI LỖI: nó đòi màn gọi
   *   `crypto.randomUUID` ngay trong lúc gửi — tức sinh mã mới MỖI CÚ BẤM,
   *   và bấm lại sau một lần rớt mạng ra đơn thứ hai. Luật mã giữ qua các
   *   lần bấm nằm ở `layMaChongLap` và có chốt chạy ở
   *   `tao-don-mot-giao-dich.test.ts`.
   */
  it("sinh khoá nối trước khi gửi", () => {
    expect(CART_PAGE).toContain("clientRequestId: maChongLap.current.id")
    expect(CART_PAGE).toContain("layMaChongLap(")
  })

  /** Bấm hai lần liên tiếp là hai đơn nếu không khoá nút. */
  /**
   * ⚠ GỘP KHOẢNG TRẮNG TRƯỚC KHI DÒ — đúng cái bẫy mà chốt "hai nút
   *   chặn giá…" ở ngay dưới đã ghi ra. Bản trước dò nguyên văn
   *   `disabled={submitting ||`; 22/09/2026 điều kiện dài thêm một vế
   *   (`donHo`), Prettier xuống dòng sau dấu `{`, và chốt đỏ dù luật
   *   không suy suyển.
   */
  it("khoá nút trong lúc đang gửi", () => {
    const FLAT = CART_PAGE.replace(/\s+/g, " ")
    expect(FLAT).toMatch(/if \( ?submitting \|\|/)
    expect(FLAT).toMatch(/disabled=\{ ?submitting \|\|/)
  })

  /**
   * ⚠ HAI LOẠI VI PHẠM, HAI CÁCH ĐỐI XỬ KHÁC HẲN NHAU — đừng gộp.
   *
   * Giá ngoài hạn mức là THẨM QUYỀN: nhân viên không được bán dưới sàn,
   * hôm nay cũng như tuần sau. Chặn, và nói trên mặt nút vì sao.
   *
   * Vượt tồn là SỐ LIỆU CÓ THỂ ĐÃ CŨ: máy của nhân viên đọc con số tồn từ
   * lần đồng bộ trước, hàng về kho lúc nào họ không biết. Chặn gửi đơn vì
   * con số đó là mất đơn thật vì một thông tin không chắc. Ở đây chỉ CẢNH
   * BÁO; chốt chặn thật là `complete_order` — kho khoá và trừ trong cùng
   * một giao dịch, không ai chen vào giữa được.
   */
  it("giá ngoài hạn mức thì chặn và nói trên nút; vượt tồn thì chỉ cảnh báo", () => {
    expect(CART_PAGE).toContain("hasPriceBad")
    expect(CART_PAGE).toContain('"Giá ngoài hạn mức"')

    // Vượt tồn vẫn phải TÍNH và vẫn phải HIỆN — chỉ là không chặn.
    expect(CART_PAGE).toContain("hasOver")
    expect(CART_PAGE, "mất băng cảnh báo vượt tồn").toContain("{hasOver && (")
    expect(CART_PAGE).toContain("vượt tồn kho")

    // Và không được quay lại thành một nhãn chặn trên mặt nút.
    expect(CART_PAGE, "nút lại báo chặn vì vượt tồn").not.toContain('"Vượt tồn kho"')
  })

  /**
   * ⚠ Lưu tạm KHÔNG chặn theo tồn kho — bản tạm không ra kho hôm nay mà
   * tồn đổi từng giờ. Vẫn chặn theo giá vì thẩm quyền không đổi theo
   * thời gian.
   *
   * ⚠ Lưu tạm cũng KHÔNG đòi phải có hàng. Đó chính là lúc cần lưu tạm
   * nhất — đang đứng ở quầy, ghi được tên khách thì khách bận.
   */
  it("nút Lưu nháp không khoá theo tồn kho và không đòi có hàng, vẫn khoá theo giá", () => {
    /* ⚠ Gộp khoảng trắng trước khi dò — xem chốt "khoá nút trong lúc
       đang gửi" ở trên về lý do. */
    const m = /disabled=\{ ?submitting \|\| !cart\.customerId \|\| hasPriceBad[^}]*\}/.exec(
      CART_PAGE.replace(/\s+/g, " ")
    )
    expect(m, "không tìm thấy nút Lưu tạm").toBeTruthy()
    expect(m![0]).not.toContain("hasOver")
    expect(m![0]).not.toContain("cart.cart.length")
  })

  /**
   * ⚠ LƯU NHÁP KHÔNG ĐƯỢC THÀNH ĐƯỜNG VÒNG. Cái gì nút "Gửi đơn" chặn mà
   * nút "Lưu nháp" cho qua thì đó là cách lách: lưu nháp giá dưới sàn rồi
   * gửi đi — và workflow v2 KHÔNG còn bước duyệt nào kiểm lại giá sàn.
   * Hai nút chỉ được khác nhau ở số dòng hàng.
   */
  it("hai nút chặn giá và chặn thiếu khách như nhau", () => {
    /**
     * ⚠ GỘP KHOẢNG TRẮNG TRƯỚC KHI DÒ. Điều kiện `disabled` dài ra thì
     * Prettier tự xuống dòng, và một luật dò bám vào dấu cách sẽ KHÔNG
     * khớp nữa — chốt hoá xanh vì không tìm thấy gì để kiểm, đúng kiểu
     * chốt nói dối.
     */
    const FLAT = CART_PAGE.replace(/\s+/g, " ")
    const draftBtn = /disabled=\{ ?submitting \|\| !cart\.customerId \|\| hasPriceBad[^}]*\}/.exec(
      FLAT
    )!![0]
    const sendBtn = /disabled=\{ ?submitting \|\| cart\.cart\.length === 0[^}]*\}/.exec(FLAT)
    expect(sendBtn, "không tìm thấy nút Gửi đơn").toBeTruthy()
    for (const b of [draftBtn, sendBtn![0]]) {
      expect(b, `nút không chặn giá sàn: ${b}`).toContain("hasPriceBad")
      expect(b, `nút không đòi có khách: ${b}`).toContain("!cart.customerId")
    }
    // Đơn GỬI ĐI thì phải có hàng.
    expect(sendBtn![0]).toContain("cart.cart.length === 0")
    /**
     * ⚠ VƯỢT PHẦN CÒN ĐẶT ĐƯỢC THÌ **KHÔNG CHẶN** — VÀ LUẬT NÀY ĐÃ LẬT
     * BA LẦN. Ghi cả ba ở đây để không ai lật mù lần thứ tư:
     *
     *   1. Bản đầu: chỉ cảnh báo. Lý do — số tồn trên máy có thể đã cũ
     *      vài giờ, chặn là nhân viên đứng ở quầy mất đơn thật vì một
     *      số liệu không chắc.
     *   2. Chủ nhà chốt "không được lớn hơn tồn − đã đặt" → đổi thành
     *      CHẶN (qua công tắc `allow_oversell`), lý do: phần "đã đặt"
     *      là lời hứa do chính công ty ghi ra nên đọc lại được.
     *   3. Chủ nhà chốt lại 20/09/2026: "cho nhân viên đặt hàng vượt số
     *      tồn và đặt, kèm cảnh báo (để tính được nhu cầu)" → về lại
     *      KHÔNG CHẶN.
     *
     * Lý do thứ ba nặng hơn cả hai lý do trước và không phải về kho:
     * một đơn bị chặn là một NHU CẦU KHÔNG ĐƯỢC GHI LẠI, và nhà phân
     * phối mất luôn con số để biết phải nhập thêm bao nhiêu.
     *
     * ⚠ KHÔNG CÒN ĐỌC `allow_oversell` Ở MÀN NÀY. Công tắc đó trả lời
     * "có được GHI SỔ một phiếu xuất làm tồn âm không" — việc của
     * `post_stock_export`. Trộn hai câu vào một công tắc là bật nó lên
     * để cứu việc ghi nhu cầu rồi vô tình cho phép cả xuất kho âm.
     */
    for (const b of [draftBtn, sendBtn![0]]) {
      expect(b, `nút đang chặn vượt tồn: ${b}`).not.toContain("hasOver")
    }
    expect(FLAT, "màn giỏ không được đọc allow_oversell nữa").not.toContain(
      "org?.allow_oversell"
    )

    /**
     * ⚠ NHƯNG CẢNH BÁO PHẢI CÒN. Bỏ chặn mà bỏ luôn cảnh báo thì nhân
     * viên không biết mình vừa hứa thứ chưa có, và NPP nhận một đơn
     * không ai đánh dấu là thiếu hàng.
     */
    expect(FLAT, "mất băng cảnh báo vượt tồn").toContain("{hasOver && (")
    expect(FLAT).toContain("Vẫn gửi đơn được")
    /**
     * ⚠ GIÁ DÒNG TRẢ cũng là thẩm quyền, không phải chuyện thời điểm — nên
     * CẢ HAI nút đều chặn. Trả cao hơn giá bảng là một đường rút tiền:
     * mua 100k, trả lại 150k, và không quy tắc duyệt nào chạm tới vì đây
     * không phải dòng bán.
     */
    for (const b of [draftBtn, sendBtn![0]]) {
      expect(b, `nút không chặn giá hàng trả: ${b}`).toContain("returnPriceBad > 0")
    }
  })

  /**
   * ⚠ Workflow v2 không có người duyệt, nên màn giỏ KHÔNG được còn chỗ
   * nào gọi báo duyệt. Còn sót là nhân viên nhận thông báo về một bước
   * không tồn tại.
   */
  it("không còn báo cho người duyệt", () => {
    expect(CART_PAGE).not.toContain("notifyApprovers")
    expect(CART_PAGE).not.toContain("send-approval")
  })

  /**
   * ⚠ Đổi khách là đổi bảng giá. Dòng đã có trong giỏ giữ giá cũ — lặng lẽ
   * tính giá của khách trước là báo sai tiền cho khách sau.
   */
  it("nói ra khi dòng đang giữ giá của bảng giá cũ", () => {
    expect(CART_PAGE).toContain("staleList")
    expect(CART_PAGE).toContain("bảng giá cũ")
    // ⚠ Soi ĐÚNG điều kiện vẽ, không chỉ "có nhắc tới ở đâu đó". Thử phá
    // cho thấy đổi điều kiện thành `false` mà hai chốt trên vẫn XANH, vì
    // cả hai chuỗi còn nguyên trong khối không bao giờ chạy.
    expect(CART_PAGE).toContain("{staleCount > 0 && (")
    expect(CART_PAGE).toMatch(/const staleCount = rows\.filter\(\(r\) => r\.staleList\)\.length/)
  })
})

describe("Không nối vào ngõ cụt", () => {
  /**
   * ⚠ Màn quét mã và đơn tạm chưa có. Nút trỏ tới trang 404 còn tệ hơn là
   * chưa có nút — người dùng tưởng tính năng hỏng chứ không tưởng là chưa
   * làm xong.
   */
  it.each([
    ["màn bán hàng", POS_PAGE],
    ["màn giỏ hàng", CART_PAGE],
  ])("%s không trỏ tới màn chưa tồn tại", (_label, src) => {
    // Chỉ lấy ĐƯỜNG DẪN thật (mở đầu bằng dấu nháy), không lấy đường
    // import như "@/components/sell/product-card".
    const links = Array.from(new Set(src.match(/["'`]\/sell\/[a-z-]+/g) ?? []))
    for (const href of links) {
      const dir = href.slice(1).replace("/sell/", "")
      expect(
        existsSync(resolve(ROOT, `src/app/(dashboard)/sell/${dir}/page.tsx`)),
        `${href} chưa có màn`
      ).toBe(true)
    }
  })
})

describe("Đọc hỏng ngữ cảnh thì phải NÓI RA", () => {
  /**
   * ⚠ Công nợ đọc hỏng trả về 0, mà 0 nghĩa là "khách không nợ gì" — đúng
   * cái làm mọi ngưỡng đều lọt. Một lần đọc hỏng không được biến thành
   * một đơn trông sạch sẽ: phải ghi rõ là chưa kiểm được.
   */
  it("cờ hỏng thì đơn mang cảnh báo, không im lặng đi tiếp", () => {
    const small = [line({ qty: 1, price: 1_000, listPrice: 1_000 })]
    expect(decideStatus(input(small)).reason).toBe("")
    const r = decideStatus(input(small, { contextFailed: true }))
    expect(r.status).toBe("submitted")
    expect(r.reason).toContain("Không đọc được")
  })

  /**
   * Ba nơi cần ngữ cảnh duyệt — gửi đơn mới, lưu đơn đang sửa, gửi duyệt một
   * đơn nháp — nên phép đọc gom về `loadApprovalContext`. Cờ hỏng phải bật ở
   * ĐÓ, và màn giỏ phải chuyển tiếp nó đi.
   */
  it("phép đọc ngữ cảnh gắn cờ khi bất kỳ truy vấn nào hỏng", () => {
    expect(CTX).toContain("failed: !!(rulesRes.error || recRes.error || repRes.error)")
  })

  it("màn giỏ hàng chuyển tiếp cờ hỏng vào phép quyết trạng thái", () => {
    expect(CART_PAGE).toContain("contextFailed: ctx.failed,")
    // ⚠ Không đọc được thì phải để EMPTY mang cờ mặc định, đừng bịa số 0
    // ngay tại chỗ gọi — 0 nghĩa là "khách không nợ gì".
    expect(CART_PAGE).toContain("EMPTY_APPROVAL_CONTEXT")
  })
})
