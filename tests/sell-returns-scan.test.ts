import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  addReturnLine,
  patchReturnLine,
  returnCreditOf,
  returnReasonLabel,
  setReturnQty,
  toReturnLine,
  type ReturnCartLine,
} from "../src/lib/sell/returns"
import { findByCode, shouldAcceptScan, SCAN_DEDUPE_MS } from "../src/lib/sell/scan"
import { buildOrderPayload } from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import type { SellProduct } from "../src/lib/sell/ref-data"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const MIG117 = read("supabase/migrations/117_sales_delete_own_draft.sql").replace(/^\s*--.*$/gm, "")
const DRAFTS = code(read("src/app/(dashboard)/sell/drafts/page.tsx"))

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

describe("Hàng trả: đổi hàng KHÔNG trừ tiền", () => {
  /**
   * ⚠ Nhầm hai loại là sai tiền theo CẢ HAI chiều: coi dòng đổi là trả thì
   * bớt tiền hai lần, coi dòng trả là đổi thì khách trả tiền cho hàng đã
   * đưa lại.
   */
  it("chỉ cộng dòng trả tiền", () => {
    const lines = [r({ qty: 2, price: 100_000 }), r({ productId: "p2", qty: 5, isExchange: true })]
    expect(returnCreditOf(lines)).toBe(200_000)
  })

  it("toàn dòng đổi thì không trừ đồng nào", () => {
    expect(returnCreditOf([r({ isExchange: true }), r({ productId: "p2", isExchange: true })])).toBe(0)
  })

  it("tiền trả tính cả VAT — khách đã trả VAT khi mua", () => {
    expect(returnCreditOf([r({ qty: 1, price: 100_000, vatRate: 0.08 })])).toBe(108_000)
  })

  it("trừ vào tổng đơn qua cartTotals", () => {
    const cart: CartLine[] = [
      {
        productId: "p1",
        unit: "thùng",
        qty: 1,
        price: 500_000,
        listPrice: 500_000,
        note: "",
        conversion: 1,
        vatRate: 0,
      },
    ]
    expect(cartTotals(cart, returnCreditOf([r({ qty: 1, price: 100_000 })])).grandTotal).toBe(400_000)
  })
})

describe("Dòng trả — thêm, sửa, xoá", () => {
  it("trùng sản phẩm + đơn vị thì cộng dồn, giữ nguyên chỗ", () => {
    let lines = addReturnLine([], r({ productId: "pA" }))
    lines = addReturnLine(lines, r({ productId: "pB" }))
    lines = addReturnLine(lines, r({ productId: "pA", qty: 3 }))
    expect(lines.map((l) => l.productId)).toEqual(["pB", "pA"])
    expect(lines[1].qty).toBe(4)
  })

  it("số lượng về 0 thì xoá dòng", () => {
    expect(setReturnQty([r(), r({ productId: "pB" })], 0, 0)).toHaveLength(1)
  })

  it("đổi loại trả/đổi chỉ đổi đúng dòng đó", () => {
    const lines = [r({ productId: "pA" }), r({ productId: "pB" })]
    const next = patchReturnLine(lines, 1, { isExchange: true })
    expect(next[0].isExchange).toBe(false)
    expect(next[1].isExchange).toBe(true)
  })

  it("chỉ số sai thì không đụng vào danh sách", () => {
    const lines = [r()]
    expect(setReturnQty(lines, 9, 2)).toBe(lines)
    expect(patchReturnLine(lines, -1, { qty: 5 })).toBe(lines)
  })

  it("nhãn lý do tra được, không tra ra thì trả nguyên giá trị", () => {
    expect(returnReasonLabel("damaged")).toBe("Hư hỏng")
    expect(returnReasonLabel("khac")).toBe("khac")
  })
})

describe("Ghi dòng trả xuống DB", () => {
  /**
   * ⚠ LUÔN gửi `is_exchange`, kể cả khi `false`. PostgREST suy ra danh sách
   * cột từ DÒNG ĐẦU TIÊN của mảng, nên một dòng có cột đó đứng sau các dòng
   * không có sẽ mất giá trị một cách lặng lẽ — mọi dòng đổi thành dòng trả
   * tiền, sai tiền mà không báo gì.
   */
  it("mọi dòng đều có is_exchange", () => {
    for (const line of [r(), r({ isExchange: true })]) {
      expect(Object.keys(toReturnLine(line))).toContain("is_exchange")
    }
  })

  it("thành tiền dòng gồm cả VAT", () => {
    expect(toReturnLine(r({ qty: 2, price: 100_000, vatRate: 0.08 })).line_total).toBe(216_000)
  })

  /**
   * ⚠ Không có dòng trả thì KHÔNG tạo phiếu trả rỗng. Một phiếu 0 dòng vẫn
   * hiện ở màn /returns chờ quản lý duyệt, và không ai biết duyệt cái gì.
   */
  it("giỏ không có hàng trả thì không sinh phiếu trả", () => {
    const base = {
      clientRequestId: "r1",
      orderCode: "DH-1",
      customerId: "c1",
      customerName: "KH",
      paymentTerms: "COD",
      expectedDelivery: null,
      notes: "",
      cart: [] as CartLine[],
      totals: cartTotals([]),
      createdAt: "2026-09-17T00:00:00.000Z",
      returnReason: "damaged",
    }
    expect(buildOrderPayload({ ...base, returnLines: [] }).returns).toBeNull()
    const withReturn = buildOrderPayload({ ...base, returnLines: [r()] })
    expect(withReturn.returns).toEqual({ reason: "damaged", notes: null })
    expect(withReturn.returnLines).toHaveLength(1)
  })
})

describe("Quét mã vạch liên tục", () => {
  /**
   * ⚠ CAMERA BẮN 10 LẦN MỖI GIÂY. Giơ mã vạch trước ống kính một giây rưỡi
   * là MƯỜI LĂM lần "thêm 1" nếu không có cửa chặn — mỗi lần quét ra một
   * số lượng ngẫu nhiên và người dùng không đoán nổi vì sao.
   */
  it("cùng một mã trong cửa sổ chặn thì bỏ qua", () => {
    const last = { code: "8934567000778", at: 1_000 }
    expect(shouldAcceptScan("8934567000778", last, 1_100)).toBe(false)
    expect(shouldAcceptScan("8934567000778", last, 1_000 + SCAN_DEDUPE_MS)).toBe(true)
  })

  /**
   * ⚠ Mã KHÁC thì nhận NGAY. Quét liền hai mặt hàng khác nhau là bình
   * thường; bắt chờ hết cửa sổ là làm chậm đúng việc nó phục vụ.
   */
  it("mã khác thì nhận ngay, không phải chờ", () => {
    expect(shouldAcceptScan("B", { code: "A", at: 1_000 }, 1_001)).toBe(true)
  })

  it("lần quét đầu luôn nhận; mã rỗng thì không", () => {
    expect(shouldAcceptScan("A", null, 0)).toBe(true)
    expect(shouldAcceptScan("   ", null, 0)).toBe(false)
  })

  const products = [
    { id: "p1", sku: "SP000778", barcode: "8934567000778" },
    { id: "p2", sku: "sp000512", barcode: null },
  ] as unknown as SellProduct[]

  /**
   * ⚠ Máy quét hay kèm ký tự xuống dòng, và SKU nhập tay lúc hoa lúc
   * thường — tra trượt làm người dùng tưởng hàng chưa có trong danh mục.
   */
  it("tra được dù thừa khoảng trắng hay khác hoa thường", () => {
    expect(findByCode(products, " 8934567000778\n")?.id).toBe("p1")
    expect(findByCode(products, "SP000512")?.id).toBe("p2")
    expect(findByCode(products, "sp000778")?.id).toBe("p1")
  })

  it("mã vạch ưu tiên hơn SKU", () => {
    const tricky = [
      { id: "a", sku: "111", barcode: "999" },
      { id: "b", sku: "999", barcode: "888" },
    ] as unknown as SellProduct[]
    expect(findByCode(tricky, "999")?.id).toBe("a")
  })

  it("không tra ra thì trả undefined, không trả bừa sản phẩm đầu", () => {
    expect(findByCode(products, "khong-co")).toBeUndefined()
    expect(findByCode(products, "")).toBeUndefined()
  })
})

describe("Xoá đơn tạm", () => {
  /**
   * ⚠ Chính sách xoá cũ (mig 113) chỉ cho owner/manager, nên NVBH bấm Xoá
   * sẽ rơi vào bẫy quen thuộc: RLS từ chối thì 0 dòng, HTTP 200, `error`
   * null — màn hình báo "đã xoá", tải lại thì đơn vẫn nằm đó.
   */
  it("migration mở quyền xoá HẸP: chỉ đơn nháp của chính mình", () => {
    expect(MIG117).toContain("FOR DELETE")
    expect(MIG117).toContain("public.user_role() = 'sales'")
    expect(MIG117).toContain("sales_user_id = auth.uid()")
    expect(MIG117).toContain("status = 'draft'")
    // Không được nới sang đơn đã duyệt.
    expect(MIG117).not.toContain("'confirmed'")
  })

  it("màn Đơn tạm đếm số dòng xoá được, không chỉ kiểm error", () => {
    expect(DRAFTS).toContain('.select("id")')
    expect(DRAFTS).toMatch(/if \(!data \|\| data\.length === 0\)/)
    expect(DRAFTS).toContain("Không xoá được đơn này")
  })

  /** Đọc hỏng mà hiện "chưa có đơn tạm" là nói dối. */
  it("đọc hỏng thì nói ra, không hiện danh sách rỗng", () => {
    expect(DRAFTS).toContain("setLoadError(res.error ?? null)")
    expect(DRAFTS).toContain("Không đọc được danh sách đơn tạm")
  })
})
