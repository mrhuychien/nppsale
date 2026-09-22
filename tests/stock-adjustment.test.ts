import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  explainAdjustmentError,
  describeAdjustment,
  postStockAdjustment,
  productsMissingBatch,
} from "../src/lib/inventory/post-adjustment"

/**
 * DUYỆT PHIẾU KIỂM KÊ MÀ KHO KHÔNG ĐỔI.
 *
 * Chủ NPP báo: bấm "Duyệt điều chỉnh", màn hiện "Đã duyệt … Kho đã cập
 * nhật", tồn kho không đổi một con số nào.
 *
 * ⚠ NGUYÊN NHÂN LÀ CÁI BẪY LỚN NHẤT CỦA CẢ KHO NÀY: RLS từ chối = 0
 * dòng, HTTP 200, `error` null. Nút mở cho `owner` + `manager`, nhưng
 * policy của `batches` và `stock_entries` chỉ cho `owner` + `warehouse`
 * ghi. Với `manager`, hai lệnh ghi trôi qua im lặng —
 * `.throwOnError()` chỉ ném khi `error` KHÁC null.
 *
 * ⚠ VÀ TỆ HƠN "KHÔNG ĐỔI GÌ": lệnh ghi `expenses` CHẠY ĐƯỢC (policy đó
 * có cho `manager`). Sổ chi phí có khoản hao hụt, kho không giảm, phiếu
 * vẫn ở "chờ duyệt" — bấm lại là ghi thêm một khoản trùng nữa.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const MIG123 = read("supabase/migrations/123_post_stock_adjustment.sql")
const SCREEN = read("src/app/(dashboard)/inventory/adjustments/page.tsx")
const SCREEN_CODE = code(SCREEN)

describe("Màn duyệt không còn tự ghi vào kho", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT CHÍNH. Mọi lệnh ghi phải nằm trong RPC; còn một lệnh
   * `.update()` lên `batches` từ trình duyệt là cái bẫy im lặng quay
   * lại nguyên vẹn.
   */
  it("không còn lệnh ghi thẳng lên batches / stock_entries / expenses", () => {
    for (const t of ["batches", "stock_entries", "expenses"]) {
      expect(
        SCREEN_CODE.includes(`.from("${t}").update(`) ||
          SCREEN_CODE.includes(`.from("${t}").insert(`),
        `màn còn ghi thẳng vào ${t}`
      ).toBe(false)
    }
    // Vòng lặp đọc-rồi-ghi cũ cũng phải biến mất.
    expect(SCREEN_CODE).not.toContain('.select("qty_on_hand")')
    expect(SCREEN_CODE).not.toContain("qty_on_hand: newQty")
  })

  it("duyệt bằng đúng một lệnh gọi RPC", () => {
    expect(SCREEN).toContain("const r = await postStockAdjustment(supabase, a.id)")
  })

  /**
   * ⚠ BÁO THEO SỐ RPC TRẢ VỀ, KHÔNG THEO SỐ TÍNH SẴN Ở MÀN. `summarize`
   * là thứ người dùng MONG đợi; kết quả RPC là thứ CSDL ĐÃ LÀM. Chính
   * chỗ lệch giữa hai cái đó là lỗi này — in lại `s` ra toast là dựng
   * lại nguyên lời báo dối.
   */
  it("toast thành công dựng từ kết quả RPC", () => {
    expect(SCREEN).toContain("describeAdjustment(r, formatCurrency)")
    const i = SCREEN.indexOf("Đã duyệt ${a.entry_code}")
    const block = SCREEN.slice(i, i + 400)
    expect(block, "toast lại in số tính sẵn ở màn").not.toContain("s.shrinkValue")
  })

  /** Lỗi phải hiện ra, không nuốt vào console. */
  it("lỗi hiện thành toast đỏ, dịch sang tiếng Việt", () => {
    expect(SCREEN).toContain('title: "Không duyệt được"')
    expect(SCREEN).toContain("errorMessage(err)")
  })
})

describe("RPC post_stock_adjustment", () => {
  it("một giao dịch, SECURITY DEFINER, khoá phiếu trước khi đọc", () => {
    expect(MIG123).toContain("SECURITY DEFINER")
    expect(MIG123).toContain("SELECT * INTO e FROM stock_entries WHERE id = p_entry_id FOR UPDATE")
  })

  /**
   * ⚠ IDEMPOTENT. Không có chốt này thì hai lần bấm là cộng tồn hai
   * lần. `FOR UPDATE` ở trên khoá dòng phiếu nên lần bấm thứ hai chờ,
   * rồi đọc được `status` đã đổi.
   */
  it("bấm hai lần không cộng kho hai lần", () => {
    expect(MIG123).toContain("IF e.status = 'posted' THEN")
    expect(MIG123).toContain("ALREADY_POSTED")
  })

  /**
   * ⚠ KHÔNG KẸP ÂM TRONG IM LẶNG. Bản cũ dùng `Math.max(0, …)` nên phần
   * chênh biến mất khi tồn đã đổi từ lúc kiểm đếm. Không ai được báo.
   */
  it("tồn đã đổi từ lúc kiểm đếm thì NÓI RA, không nuốt", () => {
    expect(MIG123).toContain("STOCK_MOVED")
    expect(MIG123).toContain("NOT_ENOUGH_STOCK")
    expect(MIG123).not.toContain("GREATEST(0, COALESCE(qty_on_hand, 0) + l.quantity)")
  })

  /** Sản phẩm chưa có lô nào thì phần thừa phải báo, không bỏ qua. */
  it("thừa mà chưa có lô nào thì báo, không bỏ qua im lặng", () => {
    expect(MIG123).toContain("NO_BATCH")
  })

  /** Mọi lô bị đụng đều phải khoá — hai người duyệt cùng lúc không đè nhau. */
  it("khoá từng lô trước khi sửa", () => {
    const n = (MIG123.match(/FOR UPDATE/g) || []).length
    expect(n, "thiếu FOR UPDATE ở nhánh nào đó").toBeGreaterThanOrEqual(4)
  })

  /** Chi phí hao hụt nằm CÙNG giao dịch với phần trừ kho. */
  it("chi phí và việc đóng dấu phiếu nằm trong cùng RPC", () => {
    expect(MIG123).toContain("INSERT INTO expenses")
    expect(MIG123).toContain("SET status = 'posted', posted_at = now()")
  })

  /**
   * ⚠ `user_has_permission` TRẢ FALSE KHI `role_permissions` CHƯA CÓ
   * DÒNG. Không seed thì sau migration này quản lý bấm Duyệt ra
   * 'FORBIDDEN' — vẫn là nút hiện mà bấm không được, chỉ đổi kiểu hỏng.
   */
  it("mở sẵn ô quyền inventory.approve cho quản lý", () => {
    expect(MIG123).toContain("'manager', 'inventory', 'approve'")
    expect(MIG123).toContain("ON CONFLICT DO NOTHING")
    expect(MIG123).toContain("user_has_permission(auth.uid(), 'inventory.approve')")
  })

  /** Kho là người ĐẾM — không tự duyệt phần chênh của chính mình. */
  it("không mở quyền duyệt cho kho", () => {
    expect(MIG123).not.toContain("'warehouse', 'inventory', 'approve'")
  })

  it("theo đúng khuôn migration của kho", () => {
    expect(MIG123).toContain("NOTIFY pgrst, 'reload schema'")
    expect(MIG123).toContain("DROP FUNCTION IF EXISTS public.post_stock_adjustment(uuid)")
    expect(MIG123).toContain("GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid) TO authenticated")
  })

  /** Dấu vết: phiếu nào đã ghi chi phí mà chưa đóng dấu duyệt. */
  it("đếm và in ra các phiếu đã dính lỗi", () => {
    expect(MIG123).toContain("chưa duyệt nhưng đã có")
    // ⚠ KHÔNG tự xoá chi phí ghi khống — đó là tiền, chủ NPP quyết từng phiếu.
    expect(MIG123).not.toContain("DELETE FROM expenses")
  })
})

describe("Thư viện gọi RPC", () => {
  /**
   * ⚠ `RETURNS TABLE` TRẢ VỀ MỘT MẢNG. Đọc thẳng `data.shrink_value` ra
   * `undefined` và `Number(undefined ?? 0)` ra NaN — con số hao hụt in
   * ra màn thành "NaN" mà không lỗi nào bắn.
   */
  it("đọc đúng dòng đầu của mảng, không ra NaN", async () => {
    const fake = {
      rpc: async () => ({
        data: [
          {
            batches_touched: 3,
            shrink_qty: 5,
            shrink_value: 150000,
            surplus_qty: 0,
            surplus_value: 0,
            expense_id: "x-1",
          },
        ],
        error: null,
      }),
    } as any
    const r = await postStockAdjustment(fake, "e-1")
    expect(r.batchesTouched).toBe(3)
    expect(r.shrinkValue).toBe(150000)
    expect(Number.isNaN(r.surplusValue)).toBe(false)
    expect(r.expenseId).toBe("x-1")
  })

  it("RPC trả rỗng thì ra 0, không ra NaN", async () => {
    const fake = { rpc: async () => ({ data: [], error: null }) } as any
    const r = await postStockAdjustment(fake, "e-1")
    for (const v of [r.batchesTouched, r.shrinkQty, r.shrinkValue, r.surplusQty, r.surplusValue]) {
      expect(Number.isNaN(v)).toBe(false)
      expect(v).toBe(0)
    }
    expect(r.expenseId).toBeNull()
  })

  it("dịch được các mã lỗi của RPC", () => {
    expect(explainAdjustmentError("… ALREADY_POSTED: phiếu KK-01 đã được duyệt lúc 09:12 17/09/2026"))
      .toBe("Phiếu KK-01 đã được duyệt lúc 09:12 17/09/2026")
    expect(explainAdjustmentError("… FORBIDDEN: bạn không có quyền duyệt điều chỉnh kho"))
      .toBe("bạn không có quyền duyệt điều chỉnh kho")
    expect(explainAdjustmentError('… NO_BATCH: "Kem Đậu Xanh" chưa có lô nào để ghi phần thừa. Tạo lô cho sản phẩm này trước.'))
      .toBe('"Kem Đậu Xanh" chưa có lô nào để ghi phần thừa. Tạo lô cho sản phẩm này trước.')
    // ⚠ Lỗi lạ trả NGUYÊN VĂN — đoán sai thì người ta đi sửa nhầm chỗ.
    expect(explainAdjustmentError("một lỗi chưa ai gặp")).toBe("một lỗi chưa ai gặp")
  })

  it("chưa chạy migration thì nói thẳng phải chạy gì", () => {
    expect(
      explainAdjustmentError('function public.post_stock_adjustment(uuid) does not exist')
    ).toContain("migration 123")
  })

  /** Câu mô tả phải nêu SỐ LÔ thật sự đụng — đó là thứ chứng minh kho đã đổi. */
  it("câu mô tả nêu số lô đã cập nhật", () => {
    const fmt = (n: number) => String(n)
    expect(describeAdjustment(
      { batchesTouched: 2, shrinkQty: 5, shrinkValue: 100, surplusQty: 0, surplusValue: 0, expenseId: null },
      fmt
    )).toBe("2 lô đã cập nhật • hao hụt 5 đơn vị (100).")
    expect(describeAdjustment(
      { batchesTouched: 0, shrinkQty: 0, shrinkValue: 0, surplusQty: 0, surplusValue: 0, expenseId: null },
      fmt
    )).toBe("0 lô đã cập nhật.")
  })
})

// =====================================================================

/**
 * LỐI THOÁT CỦA `NO_BATCH` BỊ BỊT.
 *
 * Mig 123 dừng phiếu kiểm kê khi một sản phẩm thừa hàng mà chưa có lô
 * nào — đúng, vì bản cũ nuốt im phần thừa. Nhưng câu nó bảo người dùng
 * làm ("Tạo lô cho sản phẩm này trước") lại KHÔNG ĐI ĐƯỢC:
 *
 *   • Màn tạo lô bắt số lượng ban đầu > 0.
 *   • Nhập đúng số thừa → phiếu kiểm kê cộng thêm lần nữa → kho GẤP ĐÔI.
 *   • Nhập 1 cho qua → kho dư 1, sai âm thầm.
 *
 * Lối đúng duy nhất là lô RỖNG (0) rồi để phiếu ghi phần thừa vào.
 */
describe("NO_BATCH: lối thoát phải đi được", () => {
  const FORM = read("src/app/(dashboard)/inventory/batches/new/page.tsx")

  /**
   * ⚠ TỪ MIG 170 LÔ TẠO Ở MÀN NÀY LUÔN RỖNG — máy chủ từ chối lô có tồn
   *   gửi thẳng từ trình duyệt. Lối thoát của NO_BATCH (tạo lô rỗng rồi để
   *   phiếu kiểm kê ghi phần thừa vào) vẫn đi được; cái bẫy "gõ sẵn số
   *   thừa ở đây rồi phiếu kiểm kê cộng thêm lần nữa" thì không còn cửa.
   */
  it("màn tạo lô nhận số lượng ban đầu = 0", () => {
    expect(FORM).not.toContain("if (qty <= 0)")
    expect(FORM).toContain("const qty = 0")
    expect(FORM).toMatch(/qty_initial: qty,\s*qty_on_hand: qty,/)
  })

  it("màn tạo lô cảnh báo cái bẫy cộng hai lần", () => {
    expect(FORM).toContain("cộng thêm lần nữa")
  })

  it("máy chủ cũng chỉ nhận lô rỗng từ màn hình", () => {
    const dir = resolve(__dirname, "..", "supabase/migrations")
    const M = readFileSync(resolve(dir, readdirSync(dir).find((f) => f.startsWith("170_"))!), "utf-8")
    expect(M).toContain("IF COALESCE(NEW.qty_on_hand, 0) <> 0 OR COALESCE(NEW.qty_initial, 0) <> 0 THEN")
  })
})

describe("soi trước những sản phẩm chưa có lô", () => {
  const PAGE = read("src/app/(dashboard)/inventory/adjustments/page.tsx")
  const line = (o: Partial<Parameters<typeof productsMissingBatch>[0][number]>) => ({
    product_id: "p1",
    batch_id: null,
    quantity: 5,
    product: { name: "Bánh hình kẹo 160g" },
    ...o,
  })

  it("nêu tên sản phẩm thừa hàng mà chưa có lô", () => {
    expect(productsMissingBatch([line({})], new Set())).toEqual([
      { productId: "p1", name: "Bánh hình kẹo 160g" },
    ])
  })

  it("sản phẩm đã có lô thì không nêu", () => {
    expect(productsMissingBatch([line({})], new Set(["p1"]))).toEqual([])
  })

  /** Dòng hao hụt chết bằng NOT_ENOUGH_STOCK, không phải NO_BATCH. */
  it("không nêu dòng hao hụt", () => {
    expect(productsMissingBatch([line({ quantity: -5 })], new Set())).toEqual([])
  })

  /** RPC `CONTINUE WHEN quantity = 0` — ở đây cũng phải bỏ qua. */
  it("không nêu dòng số 0", () => {
    expect(productsMissingBatch([line({ quantity: 0 })], new Set())).toEqual([])
  })

  /** Dòng đã chọn lô đi nhánh khác, cộng thẳng vào lô đó. */
  it("không nêu dòng đã chọn lô", () => {
    expect(productsMissingBatch([line({ batch_id: "b1" })], new Set())).toEqual([])
  })

  it("mỗi sản phẩm chỉ nêu một lần", () => {
    expect(productsMissingBatch([line({}), line({})], new Set())).toHaveLength(1)
  })

  it("nhiều sản phẩm thì nêu hết, không nêu mỗi cái đầu", () => {
    const r = productsMissingBatch(
      [line({}), line({ product_id: "p2", product: { name: "Kem Đậu Xanh" } })],
      new Set()
    )
    expect(r.map((x) => x.name)).toEqual(["Bánh hình kẹo 160g", "Kem Đậu Xanh"])
  })

  it("thiếu tên thì lấy id, không ra rỗng", () => {
    expect(productsMissingBatch([line({ product: null })], new Set())[0].name).toBe("p1")
  })

  it("màn duyệt khoá nút khi còn sản phẩm chưa có lô", () => {
    expect(PAGE).toContain("|| thieuLo.length > 0")
    // ⚠ KHOÁ KÈM LÝ DO. Khoá trơ là người dùng tưởng hỏng.
    expect(PAGE).toContain("Còn ${thieuLo.length} sản phẩm chưa có lô")
  })

  /**
   * ⚠ CHỈ HỎI SẢN PHẨM CẦN HỎI. `.in(\"product_id\", ids)` — không có nó
   * là kéo cả bảng `batches` về trình duyệt cho một câu hỏi có/không.
   */
  it("chỉ hỏi lô của những sản phẩm liên quan", () => {
    expect(PAGE).toContain('.in("product_id", ids)')
  })

  /**
   * ⚠ HỎI HỎNG THÌ IM, ĐỪNG KHOÁ HẾT. Set rỗng = "mọi sản phẩm đều chưa
   * có lô" = khoá sạch nút duyệt vì một lỗi mạng. RPC vẫn là chốt thật.
   */
  it("soi lô lỗi thì coi như đều có lô", () => {
    expect(PAGE).toContain("setProductsWithBatch(new Set(ids))")
  })
})
