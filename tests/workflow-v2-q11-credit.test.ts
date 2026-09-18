import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  remainingOf,
  creditOf,
  totalRemaining,
  totalCredit,
  netPosition,
  isOverpaid,
} from "../src/lib/receivables/credit"
import {
  cashToCollect,
  explainReceiptError,
  createCashReceipt,
} from "../src/lib/finance/cash-receipt"
import { labelPaymentMethod } from "../src/lib/constants"

/**
 * Q11 — `receivables.paid > amount` LÀ HỢP LỆ.
 *
 * Trước Q11, `_wf2_recompute_receivable` RAISE `OVERPAID_AFTER_CREDIT`
 * khi phần trả vượt phần nợ, nên khách đã thanh toán đủ rồi trả hàng thì
 * phiếu trả KHÔNG hoàn thành được — kẹt vĩnh viễn, không có đường đi tiếp
 * nào ngoài huỷ phiếu thu đã in. Chủ nhà chọn phương án (a): cho ghi số
 * dư có.
 *
 * Đổi một dòng trong RPC thì dễ; chỗ khó là ba hệ quả kéo theo, và cả ba
 * đều ÂM THẦM:
 *   1. mọi phép trừ `amount - paid` không kẹp sẽ in ra SỐ ÂM MÀU ĐỎ —
 *      trông y hệt khoản nợ khẩn cấp, sự thật ngược lại;
 *   2. mọi phép cộng công nợ đã kẹp sẵn (`GREATEST`, `status <> 'paid'`)
 *      sẽ KHAI CAO tổng nợ đúng bằng số dư — kẹp là đúng, nhưng phải NÓI
 *      RA phần bị kẹp;
 *   3. tiền của khách nằm ở một dòng `status = 'paid'` nên không màn nào
 *      hiện nó, và không có đường nào đem nó ra dùng.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const MIG120 = read("supabase/migrations/120_workflow_v2_rpcs.sql")
const MIG119 = read("supabase/migrations/119_workflow_v2.sql")
const AGG = read("supabase/migrations/093_aggregate_functions.sql")
const MIG121 = read("supabase/migrations/121_credit_balance_aggregates.sql")
const NEW_RECEIPT = read("src/app/(dashboard)/finance/cash-receipts/new/page.tsx")

describe("Số dư có: một chỗ khai, mọi màn dùng", () => {
  const row = (amount: number, paid: number) => ({ amount, paid })

  it("nợ thường và dòng dư đọc ra hai con số khác nhau", () => {
    expect(remainingOf(row(1000, 400))).toBe(600)
    expect(creditOf(row(1000, 400))).toBe(0)
    expect(remainingOf(row(1000, 1400))).toBe(0)
    expect(creditOf(row(1000, 1400))).toBe(400)
  })

  /** ⚠ KHÔNG BAO GIỜ ÂM — đó là lý do tồn tại của cả tệp `credit.ts`. */
  it("không hàm nào trả số âm", () => {
    for (const r of [row(1000, 9999), row(0, 500), row(500, 0), row(0, 0)]) {
      expect(remainingOf(r)).toBeGreaterThanOrEqual(0)
      expect(creditOf(r)).toBeGreaterThanOrEqual(0)
    }
  })

  it("null / undefined đọc thành 0, không thành NaN", () => {
    expect(remainingOf({ amount: null, paid: null })).toBe(0)
    expect(creditOf({})).toBe(0)
    expect(totalRemaining([{ amount: undefined, paid: 100 }])).toBe(0)
  })

  /**
   * ⚠ TỔNG NỢ VÀ TỔNG DƯ KHÔNG ĐƯỢC BÙ TRỪ CHÉO. Một tập có 600 nợ và
   * 400 dư thì phải đi đòi 600 — không phải 200. Cộng gộp thành một số
   * duy nhất là bảo nhân viên thu sai.
   */
  it("nợ của dòng này không bị dư của dòng kia trừ bớt", () => {
    const rows = [row(1000, 400), row(1000, 1400)]
    expect(totalRemaining(rows)).toBe(600)
    expect(totalCredit(rows)).toBe(400)
    expect(netPosition(rows)).toBe(200)
  })

  it("netPosition ÂM được, và khi âm thì nói: NPP đang nợ khách", () => {
    expect(netPosition([row(100, 900)])).toBe(-800)
  })

  it("isOverpaid chỉ bật khi thật sự dư, không bật lúc trả vừa đủ", () => {
    expect(isOverpaid(row(1000, 1000))).toBe(false)
    expect(isOverpaid(row(1000, 1000.5))).toBe(true)
  })
})

describe("Con số khách đưa thật", () => {
  /**
   * ⚠ BA NGUỒN ĐẮP VÀO MỘT KHOẢN NỢ, chỉ MỘT trong đó là tiền mặt. Hiện
   * tổng khoản nợ ở ô "Khách đưa" là bảo kế toán thu thừa.
   */
  it("trừ cả phiếu trả cấn trừ lẫn phần rút từ số dư", () => {
    expect(cashToCollect(1_000_000, 0, 0)).toBe(1_000_000)
    expect(cashToCollect(1_000_000, 300_000, 0)).toBe(700_000)
    expect(cashToCollect(1_000_000, 300_000, 200_000)).toBe(500_000)
  })

  /** Không có "khách đưa âm tiền". Trả lại là nghiệp vụ khác. */
  it("không bao giờ âm", () => {
    expect(cashToCollect(100, 300, 500)).toBe(0)
  })

  /**
   * ⚠ KIỂM PAYLOAD THẬT, KHÔNG KIỂM CHỮ TRONG TỆP. Màn hình gửi
   * `use_credit` xuống thư viện là một việc; thư viện gửi tiếp xuống RPC
   * là việc KHÁC. Bỏ đúng một dòng ở `createCashReceipt` là số khách gõ
   * biến mất giữa đường — RPC nhận null, đọc ra 0, lập phiếu thu với số
   * tiền mặt CAO HƠN thực thu, và không có lỗi nào bắn ra.
   */
  it("use_credit đi hết đường từ thư viện xuống RPC", async () => {
    const seen: Array<{ fn: string; args: any }> = []
    const fake = {
      rpc: async (fn: string, args: any) => {
        seen.push({ fn, args })
        return { data: "r-1", error: null }
      },
    } as any

    await createCashReceipt(fake, {
      customer_id: "c-1",
      lines: [{ receivable_id: "rc-1", amount: 500_000 }],
      use_credit: 200_000,
    })
    expect(seen[0].fn).toBe("create_cash_receipt")
    expect(seen[0].args.p.use_credit).toBe(200_000)

    // Bỏ trống = không rút, chứ KHÔNG phải undefined: RPC đọc jsonb, khoá
    // thiếu ra null, và `COALESCE(...,0)` che mất chuyện khoá gõ sai tên.
    seen.length = 0
    await createCashReceipt(fake, { customer_id: "c-1", lines: [] })
    expect(seen[0].args.p.use_credit).toBe(0)
  })

  it("dịch được lý do RPC từ chối phần rút số dư", () => {
    expect(
      explainReceiptError(
        "… CREDIT_BALANCE_TOO_LOW: khách chỉ còn 50000 số dư có, không rút được 200000"
      )
    ).toBe("Không đủ số dư có: khách chỉ còn 50000 số dư có, không rút được 200000")
    expect(explainReceiptError("… CREDIT_EXCEEDS_SELECTED: …")).toBe(
      "Khoản cấn trừ lớn hơn số nợ đã chọn. Chọn thêm khoản nợ, hoặc bỏ bớt phiếu trả."
    )
  })
})

describe("RPC: rút số dư ghi thành bút toán HAI VẾ", () => {
  const i = MIG120.indexOf("CREATE OR REPLACE FUNCTION public.create_cash_receipt")
  const CREATE = MIG120.slice(i, MIG120.indexOf("CREATE OR REPLACE FUNCTION", i + 10))

  it("neo cắt được đúng thân create_cash_receipt", () => {
    expect(i).toBeGreaterThan(0)
    expect(CREATE).toContain("v_use")
  })

  /**
   * ⚠ HAI VẾ, KHÔNG PHẢI MỘT. `void_cash_receipt` đảo phiếu bằng cách
   * duyệt `cash_receipt_lines` và làm `paid = GREATEST(0, paid - l.amount)`.
   * Nếu phần rút chỉ ghi một vế (trừ `paid` ở khoản dư, không ghi dòng),
   * huỷ phiếu sẽ cộng lại phần đắp mà KHÔNG trả lại phần đã rút — tiền
   * của khách bốc hơi, và không lệnh nào báo lỗi.
   */
  it("vế RÚT là một dòng payments ÂM ở khoản đang dư", () => {
    expect(CREATE).toContain("VALUES (src.id, auth.uid(), -v_take, 'credit_applied', now())")
    expect(CREATE).toContain(
      "VALUES (v_receipt, src.id, v_pay, -v_take, 'credit_applied')"
    )
  })

  it("vế ĐẮP là dòng payments DƯƠNG ở khoản được thu", () => {
    expect(CREATE).toContain(
      "VALUES ((v_item->>'receivable_id')::uuid, auth.uid(), v_apply, 'credit_applied', now())"
    )
  })

  /**
   * ⚠ KHÔNG CÓ `CHECK (amount > 0)` TRÊN `payments` — và không được thêm.
   * Vế rút là một dòng âm; thêm ràng buộc đó là khoá chết Q11.
   */
  it("migration 119 dặn rõ đừng thêm CHECK dương cho payments", () => {
    expect(MIG119).toContain("amount > 0")
    expect(MIG119.toLowerCase()).toContain("payments")
  })

  it("'credit_applied' được cả hai ràng buộc cho qua", () => {
    const kind = MIG119.slice(MIG119.indexOf("chk_cash_receipt_lines_kind"))
    expect(kind.slice(0, 300)).toContain("'credit_applied'")
    const method = MIG119.slice(MIG119.indexOf("chk_payments_method_v2"))
    expect(method.slice(0, 300)).toContain("'credit_applied'")
  })

  /** Nguồn rút phải KHOÁ HÀNG, nếu không hai phiếu thu rút cùng một số dư. */
  it("vòng lặp chọn nguồn có FOR UPDATE", () => {
    const j = CREATE.indexOf("AND COALESCE(paid, 0) > COALESCE(amount, 0)")
    expect(j).toBeGreaterThan(0)
    expect(CREATE.slice(j, j + 200)).toContain("FOR UPDATE")
  })

  /** Rút quá phần còn phải trả là sinh số dư mới ở chỗ khác — vô nghĩa. */
  it("chặn rút vượt số dư và vượt phần đã chọn", () => {
    expect(CREATE).toContain("CREDIT_BALANCE_TOO_LOW")
    expect(CREATE).toContain("IF v_use > v_sum_line - v_sum_cred + 0.01 THEN")
  })

  /** Số tiền ghi vào phiếu phải là phần khách đưa THẬT. */
  it("submitted_amount đã trừ cả phần rút số dư", () => {
    expect(CREATE).toContain("v_sum_line - v_sum_cred - v_use")
  })
})

describe("Bản vá hàm tổng hợp phải nằm ở migration MỚI", () => {
  /** ⚠ NEO VÀO ĐỊNH NGHĨA HÀM, không vào lần nhắc tên đầu tiên (tên còn
   *  xuất hiện ở GRANT, COMMENT và cả khối chú thích đầu tệp). */
  const bodyIn = (src: string, fn: string) => {
    const i = src.indexOf(`CREATE FUNCTION public.${fn}(`)
    expect(i, `không tìm thấy định nghĩa ${fn}`).toBeGreaterThan(0)
    const j = src.indexOf("CREATE FUNCTION public.", i + 10)
    return src.slice(i, j > 0 ? j : undefined)
  }

  /**
   * ⚠ ĐÂY LÀ CHỐT QUAN TRỌNG NHẤT CỦA CẢ TỆP, VÀ NÓ NHÌN NGƯỢC.
   *
   * Migration 093 ĐÃ CHẠY trên production. `supabase db push` chỉ chạy
   * migration MỚI, và 093 dùng `CREATE FUNCTION` trần nên chạy lại còn
   * ném "already exists". Vá thẳng vào 093 là bản vá KHÔNG BAO GIỜ tới
   * cơ sở dữ liệu thật — mà `schema_full.sql` (chỉ dùng để cài mới) lại
   * chứa bản đã vá, nên nhìn vào kho mã tưởng đã xong.
   *
   * Tôi đã phạm đúng lỗi này ở lượt trước. Chốt này tồn tại để không ai
   * (kể cả tôi) "dọn dẹp" bằng cách chép phép sửa ngược về 093.
   */
  it("093 KHÔNG được mang phép sửa — nó đã chạy rồi, sửa ở đó là vô hình", () => {
    expect(
      bodyIn(AGG, "receivables_by_rep"),
      "093 đã chạy trên production; phép sửa ở đây không bao giờ chạy"
    ).not.toContain("GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0))")
    expect(bodyIn(AGG, "finance_cash_flow")).not.toContain("return_credit")
  })

  /**
   * ⚠ HAI LỚP CHE CHỒNG LÊN NHAU. `receivables_by_rep` KHÔNG lọc
   * `status <> 'paid'` nên dòng dư lọt thẳng vào và kéo tổng công nợ của
   * nhân viên XUỐNG. Kẹp là đúng; phần bị kẹp được nói ra ở giao diện.
   */
  it("121 kẹp phần dư ở cả hai hàm công nợ", () => {
    for (const fn of ["receivables_by_rep", "receivables_by_customer"]) {
      expect(bodyIn(MIG121, fn), `${fn} chưa kẹp`).toContain(
        "GREATEST(0, COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0))"
      )
    }
  })

  /** Tỉ lệ thu hồi vượt 100% là con số vô nghĩa in ra bảng điều khiển. */
  it("121 chặn trần 100 cho tỉ lệ thu hồi", () => {
    expect(bodyIn(MIG121, "receivables_by_rep")).toContain(
      "THEN LEAST(100, ROUND(SUM(r.paid) / SUM(r.amount) * 100)::integer)"
    )
  })

  /**
   * ⚠ CẤN TRỪ KHÔNG PHẢI TIỀN VÀO KÉT. `return_credit` là dòng DƯƠNG
   * MỘT VẾ — mỗi đồng hàng trả được cấn trừ hiện ra như một đồng tiền
   * mặt thu được. Không lỗi nào bắn ra; chỉ có tiền mặt trên bảng cân
   * đối cao hơn két thật.
   */
  it("121 loại hai phương thức không phải tiền khỏi dòng tiền", () => {
    for (const fn of ["finance_balance_sheet", "finance_cash_flow"]) {
      expect(bodyIn(MIG121, fn), `${fn} còn đếm cấn trừ là tiền`).toContain(
        "AND COALESCE(p.method, '') NOT IN ('return_credit', 'credit_applied')"
      )
    }
  })

  /**
   * ⚠ DANH SÁCH LOẠI TRỪ, KHÔNG PHẢI DANH SÁCH CHO PHÉP. Liệt kê
   * 'cash'/'transfer'/'wallet' thì người thêm phương thức tiền thật mới
   * vào tháng sau sẽ thấy doanh thu tiền mặt hụt đi mà không hiểu vì
   * sao — và sẽ đi tìm ở chỗ khác.
   */
  it("lọc bằng NOT IN, không phải IN", () => {
    for (const fn of ["finance_balance_sheet", "finance_cash_flow"]) {
      expect(bodyIn(MIG121, fn)).not.toContain("p.method IN (")
    }
  })

  /**
   * ⚠ `DROP FUNCTION` XOÁ LUÔN GRANT. Quên cấp lại là bốn màn báo cáo
   * trắng xoá với "permission denied for function", trong khi migration
   * chạy xong không báo gì.
   */
  it("121 cấp lại quyền cho cả bốn hàm vừa DROP", () => {
    for (const fn of [
      "public.receivables_by_rep()",
      "public.receivables_by_customer()",
      "public.finance_balance_sheet(date)",
      "public.finance_cash_flow(date, date)",
    ]) {
      expect(MIG121, `thiếu GRANT cho ${fn}`).toContain(
        `GRANT EXECUTE ON FUNCTION ${fn}`
      )
    }
  })

  /** Migration phải idempotent và nạp lại schema cho PostgREST. */
  it("121 theo đúng khuôn migration của kho", () => {
    expect(MIG121).toContain("NOTIFY pgrst, 'reload schema'")
    for (const fn of [
      "public.receivables_by_rep()",
      "public.receivables_by_customer()",
      "public.finance_balance_sheet(date)",
      "public.finance_cash_flow(date, date)",
    ]) {
      expect(MIG121, `${fn} chưa DROP trước khi CREATE`).toContain(
        `DROP FUNCTION IF EXISTS ${fn}`
      )
    }
  })
})

describe("Màn lập phiếu thu: tiền của khách phải NHÌN THẤY ĐƯỢC", () => {
  /**
   * ⚠ DÒNG DƯ MANG `status = 'paid'`. Danh sách khoản nợ lọc
   * `open/partial/overdue` nên nó KHÔNG nằm trong đó — đúng, vì nó không
   * phải khoản để đi thu. Nhưng thế thì phải có truy vấn RIÊNG, nếu
   * không tiền của khách biến mất khỏi màn.
   */
  it("có truy vấn số dư riêng, KHÔNG lọc trạng thái", () => {
    const j = NEW_RECEIPT.indexOf('fetchAllForAggregate<ReceivableAmounts>')
    expect(j, "chưa có truy vấn số dư riêng").toBeGreaterThan(0)
    const q = NEW_RECEIPT.slice(j, j + 400)
    expect(q).toContain('.select("amount, paid"')
    expect(q).toContain('.eq("customer_id", cid)')
    expect(q, "lọc trạng thái là gạt mất chính dòng dư").not.toContain('.in("status"')
    expect(q).not.toContain('.eq("status"')
  })

  /**
   * ⚠ PostgREST CẮT 1000 DÒNG TRONG IM LẶNG. Một khách lâu năm vượt
   * ngưỡng đó thì số dư hiện ra THIẾU — kế toán rút ít hơn số khách có,
   * không ai báo gì.
   */
  it("truy vấn số dư đi qua fetchAllForAggregate, không select trần", () => {
    expect(NEW_RECEIPT).toContain("fetchAllForAggregate<ReceivableAmounts>")
    expect(NEW_RECEIPT).toContain('.select("amount, paid", { count: "exact" })')
  })

  /**
   * ⚠ NEO VÀO CHÍNH CÂU LỆNH `if`. Chốt cũ chỉ hỏi "tệp có chữ
   * balRes.error không" — bỏ hẳn `balRes.error` khỏi điều kiện rẽ nhánh
   * vẫn xanh, vì chữ đó còn nằm ở dòng `setLoadError` ngay dưới. Đọc hỏng
   * mà nuốt lỗi thì `creditRows` thành mảng rỗng: màn báo khách không có
   * số dư nào, trong khi tiền của họ vẫn ở đó.
   */
  it("đọc hỏng truy vấn số dư thì nói ra, không âm thầm coi như 0", () => {
    expect(NEW_RECEIPT).toContain(
      "if (recRes.error || credRes.error || balRes.error) {"
    )
    expect(NEW_RECEIPT).toContain(
      "setLoadError(errorMessage(recRes.error ?? credRes.error ?? balRes.error))"
    )
  })

  /** Đổi khách mà giữ lại số cũ là rút số dư của người này đắp cho người kia. */
  it("đổi khách thì xoá phần rút đang gõ dở", () => {
    const j = NEW_RECEIPT.indexOf("const loadCustomer")
    expect(NEW_RECEIPT.slice(j, j + 500)).toContain("setUseCredit(0)")
  })

  it("số dư cộng qua totalCredit, không tự trừ tay ở màn", () => {
    expect(NEW_RECEIPT).toContain("totalCredit(creditRows ?? [])")
  })

  /** Hai phép chặn của RPC được nói lại ngay cạnh ô nhập. */
  it("chặn vượt số dư và vượt phần đã chọn ngay ở giao diện", () => {
    expect(NEW_RECEIPT).toContain("const useOverBalance = useCredit > creditBalance + 0.01")
    expect(NEW_RECEIPT).toContain(
      "const useOverSelected = useCredit > linesTotal - creditsTotal + 0.01"
    )
    const save = NEW_RECEIPT.slice(NEW_RECEIPT.indexOf("const canSave ="))
    expect(save.slice(0, 400)).toContain("!useOverBalance")
    expect(save.slice(0, 400)).toContain("!useOverSelected")
  })

  /** Gõ số rồi mà không gửi đi thì RPC không biết gì — phiếu thu sai số. */
  it("use_credit thật sự đi vào payload", () => {
    expect(NEW_RECEIPT).toContain("use_credit: useCredit")
  })

  it("ô Khách đưa đã trừ phần rút", () => {
    expect(NEW_RECEIPT).toContain("cashToCollect(linesTotal, creditsTotal, useCredit)")
  })
})

/**
 * Q13 — ba hệ quả của Q11 mà bản đầu bỏ sót. Cả ba đều KHÔNG bắn lỗi:
 * chúng chỉ làm con số sai đi, hoặc chặn một việc hợp lệ.
 */
describe("Q13 — nhãn phương thức: đọc rộng hơn ghi", () => {
  const CONSTANTS = read("src/lib/constants.ts")
  const TYPES = read("src/types/index.ts")

  /**
   * ⚠ BẢNG NHÃN PHẢI RỘNG HƠN Ô CHỌN. RPC ghi ra hai giá trị mà người
   * dùng không chọn được; thiếu nhãn là chữ `return_credit` in giữa bảng
   * công nợ, nhìn như dữ liệu hỏng.
   */
  it("bảng nhãn có cả hai giá trị do RPC ghi", () => {
    expect(labelPaymentMethod("return_credit")).toBe("Cấn trừ phiếu trả")
    expect(labelPaymentMethod("credit_applied")).toBe("Rút số dư có")
    expect(labelPaymentMethod("cash")).toBe("Tiền mặt")
  })

  /** ⚠ Giá trị lạ trả NGUYÊN VĂN — để trống là xoá thông tin khỏi màn. */
  it("giá trị lạ giữ nguyên, rỗng thì gạch ngang", () => {
    expect(labelPaymentMethod("momo")).toBe("momo")
    expect(labelPaymentMethod(null)).toBe("—")
    expect(labelPaymentMethod("")).toBe("—")
  })

  /**
   * ⚠ Ô CHỌN PHẢI HẸP. Cho `return_credit` lên danh sách chọn là mời kế
   * toán lập một phiếu thu "cấn trừ" rỗng: không gắn phiếu trả nào,
   * không có vế đối ứng, công nợ giảm mà không có gì đỡ lưng.
   */
  it("danh sách CHỌN vẫn chỉ ba giá trị tiền thật", () => {
    const i = CONSTANTS.indexOf("export const PAYMENT_METHODS = [")
    const block = CONSTANTS.slice(i, CONSTANTS.indexOf("] as const", i))
    expect(block).not.toContain("return_credit")
    expect(block).not.toContain("credit_applied")
    expect(block).toContain('"cash"')
  })

  /** Một chỗ khai, mọi màn dùng — bốn bản sao là bốn chỗ phải nhớ sửa. */
  it("không màn nào còn tự khai bảng nhãn riêng", () => {
    for (const f of [
      "src/app/(dashboard)/receivables/[id]/page.tsx",
      "src/app/(dashboard)/receivables/by-rep/[userId]/page.tsx",
      "src/app/(dashboard)/receivables/by-customer/[customerId]/page.tsx",
    ]) {
      expect(read(f), `${f} còn bản sao`).not.toContain(
        "const PAYMENT_METHOD_LABEL: Record<string, string> = {"
      )
      expect(read(f)).toContain('PAYMENT_METHOD_LABEL } from "@/lib/constants"')
    }
  })

  /** Thiếu ở kiểu là ép `as` ở mọi chỗ đọc lên. */
  it("kiểu PaymentMethod có đủ năm giá trị", () => {
    const i = TYPES.indexOf("export type PaymentMethod")
    const block = TYPES.slice(i, i + 200)
    for (const v of ["cash", "transfer", "ewallet", "return_credit", "credit_applied"]) {
      expect(block, `kiểu thiếu '${v}'`).toContain(`"${v}"`)
    }
  })
})
