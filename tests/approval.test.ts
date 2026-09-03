import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import {
  evaluateApproval,
  canApproveForLevel,
  DEFAULT_APPROVAL_RULES,
} from "@/lib/approval"
import type { ApprovalRules } from "@/types"

/**
 * Quy tắc duyệt đơn quyết định đơn nào được tự động xác nhận. Sai ở đây
 * = đơn vượt hạn mức lọt qua mà không ai duyệt, hoặc đơn hợp lệ bị chặn.
 */

const rules = (over: Partial<ApprovalRules> = {}): ApprovalRules =>
  ({
    ...DEFAULT_APPROVAL_RULES,
    id: "r1",
    org_id: "o1",
    created_at: "",
    updated_at: "",
    updated_by: null,
    ...over,
  } as ApprovalRules)

const ctx = (over: Partial<Parameters<typeof evaluateApproval>[1]> = {}) => ({
  orderTotal: 1_000_000,
  customer: null,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  role: "sales" as const,
  ...over,
})

describe("evaluateApproval — ngưỡng giá trị đơn", () => {
  it("đơn nhỏ trong mọi ngưỡng thì tự động duyệt", () => {
    const d = evaluateApproval(rules(), ctx({ orderTotal: 1_000_000 }))
    expect(d.autoApprove).toBe(true)
    expect(d.reasons).toHaveLength(0)
    expect(d.expectedApprover).toBeNull()
  })

  it("đơn ĐÚNG BẰNG ngưỡng tự động duyệt thì KHÔNG tự duyệt (dùng >=)", () => {
    // Ca biên quan trọng: 20.000.000 không được tự duyệt.
    const d = evaluateApproval(rules(), ctx({ orderTotal: 20_000_000 }))
    expect(d.autoApprove).toBe(false)
    expect(d.expectedApprover).toBe("manager")
  })

  it("đơn vượt ngưỡng manager thì phải Owner duyệt", () => {
    const d = evaluateApproval(rules(), ctx({ orderTotal: 50_000_000 }))
    expect(d.autoApprove).toBe(false)
    expect(d.expectedApprover).toBe("owner")
  })

  it("dùng quy tắc mặc định khi tổ chức chưa cấu hình (rules = null)", () => {
    expect(evaluateApproval(null, ctx({ orderTotal: 1_000_000 })).autoApprove).toBe(true)
    expect(evaluateApproval(null, ctx({ orderTotal: 999_000_000 })).autoApprove).toBe(false)
  })

  it("khi tắt quy tắc thì mọi đơn đều phải duyệt tay", () => {
    const d = evaluateApproval(rules({ is_active: false }), ctx({ orderTotal: 1 }))
    expect(d.autoApprove).toBe(false)
    expect(d.expectedApprover).toBe("manager")
  })
})

describe("evaluateApproval — công nợ", () => {
  it("ngưỡng công nợ = 0 nghĩa là TẮT kiểm tra, không phải cấm nợ", () => {
    // Ghi nhận hành vi hiện tại: điều kiện là `> 0` mới kiểm.
    const d = evaluateApproval(
      rules({ customer_debt_max: 0 }),
      ctx({ customerDebt: 999_000_000 })
    )
    expect(d.autoApprove).toBe(true)
  })

  it("chặn khi công nợ khách vượt ngưỡng", () => {
    const d = evaluateApproval(
      rules({ customer_debt_max: 10_000_000 }),
      ctx({ customerDebt: 10_000_001 })
    )
    expect(d.autoApprove).toBe(false)
    expect(d.reason).toContain("Công nợ khách hàng")
  })

  it("công nợ đúng bằng ngưỡng thì vẫn cho qua (dùng >)", () => {
    const d = evaluateApproval(
      rules({ customer_debt_max: 10_000_000 }),
      ctx({ customerDebt: 10_000_000 })
    )
    expect(d.autoApprove).toBe(true)
  })

  it("chặn khi công nợ quá hạn vượt ngưỡng", () => {
    const d = evaluateApproval(
      rules({ customer_overdue_max: 1_000_000 }),
      ctx({ customerOverdue: 2_000_000 })
    )
    expect(d.autoApprove).toBe(false)
    expect(d.reason).toContain("quá hạn")
  })

  it("chặn khi tổng công nợ nhân viên phụ trách vượt ngưỡng", () => {
    const d = evaluateApproval(
      rules({ rep_portfolio_debt_max: 50_000_000 }),
      ctx({ repPortfolioDebt: 60_000_000 })
    )
    expect(d.autoApprove).toBe(false)
    expect(d.reason).toContain("nhân viên phụ trách")
  })
})

describe("evaluateApproval — hạn mức tín dụng", () => {
  it("chặn khi đơn mới đẩy dư nợ vượt hạn mức", () => {
    const d = evaluateApproval(
      rules({ enforce_credit_limit: true }),
      ctx({
        orderTotal: 5_000_000,
        customerDebt: 8_000_000,
        customer: { id: "c1", credit_limit: 10_000_000 },
      })
    )
    expect(d.autoApprove).toBe(false)
    expect(d.reason).toContain("hạn mức")
  })

  it("cho qua khi tổng dư nợ dự kiến vẫn trong hạn mức", () => {
    const d = evaluateApproval(
      rules({ enforce_credit_limit: true }),
      ctx({
        orderTotal: 1_000_000,
        customerDebt: 1_000_000,
        customer: { id: "c1", credit_limit: 10_000_000 },
      })
    )
    expect(d.autoApprove).toBe(true)
  })

  it("hạn mức 0 nghĩa là KHÔNG áp hạn mức", () => {
    // Giữ giá trị đơn dưới ngưỡng tự duyệt để cô lập đúng luật hạn mức:
    // nợ hiện tại đã rất lớn nhưng credit_limit = 0 nên không bị chặn.
    const d = evaluateApproval(
      rules({ enforce_credit_limit: true }),
      ctx({
        orderTotal: 1_000_000,
        customerDebt: 900_000_000,
        customer: { id: "c1", credit_limit: 0 },
      })
    )
    expect(d.autoApprove).toBe(true)
  })

  it("bỏ qua kiểm hạn mức khi tắt cờ enforce_credit_limit", () => {
    const d = evaluateApproval(
      rules({ enforce_credit_limit: false }),
      ctx({
        orderTotal: 50_000,
        customerDebt: 99_000_000,
        customer: { id: "c1", credit_limit: 1_000_000 },
      })
    )
    expect(d.autoApprove).toBe(true)
  })
})

describe("evaluateApproval — gộp nhiều lý do", () => {
  it("gom tất cả lý do vi phạm, ưu tiên cấp duyệt cao nhất từ ngưỡng đơn", () => {
    const d = evaluateApproval(
      rules({ customer_debt_max: 1_000_000, manager_approve_max: 50_000_000 }),
      ctx({
        orderTotal: 60_000_000,
        customerDebt: 5_000_000,
        customer: { id: "c1", credit_limit: 1_000_000 },
      })
    )
    expect(d.autoApprove).toBe(false)
    expect(d.reasons.length).toBeGreaterThanOrEqual(2)
    // Ngưỡng đơn quyết định cấp duyệt trước, các lý do sau không hạ cấp.
    expect(d.expectedApprover).toBe("owner")
    expect(d.reason).toContain(" • ")
  })
})

describe("canApproveForLevel — ai được duyệt", () => {
  it("không yêu cầu cấp duyệt thì ai cũng qua", () => {
    expect(canApproveForLevel("sales", null)).toBe(true)
  })

  it("chủ sở hữu duyệt được mọi cấp", () => {
    expect(canApproveForLevel("owner", "owner")).toBe(true)
    expect(canApproveForLevel("owner", "manager")).toBe(true)
  })

  it("quản lý KHÔNG được duyệt đơn cần chủ sở hữu", () => {
    expect(canApproveForLevel("manager", "owner")).toBe(false)
    expect(canApproveForLevel("manager", "manager")).toBe(true)
  })

  it("nhân viên bán hàng không được duyệt", () => {
    expect(canApproveForLevel("sales", "manager")).toBe(false)
    expect(canApproveForLevel("sales", "owner")).toBe(false)
  })
})

describe("NPP-12 — chiết khấu sâu phải cần duyệt", () => {
  /**
   * Mọi quy tắc khác đều xét `orderTotal`, tức số SAU chiết khấu. Chiết
   * khấu 100% làm đơn 720.000đ thành 0đ và `0 >= auto_approve_max` là
   * false, nên đơn TỰ ĐỘNG DUYỆT: hàng ra khỏi kho, không ai duyệt, không
   * cảnh báo. Cho không hàng mà quy tắc theo ngưỡng tiền không bắt được.
   */
  const base = {
    customer: null,
    customerDebt: 0,
    customerOverdue: 0,
    repPortfolioDebt: 0,
    role: "sales" as const,
  }

  it("chiết khấu 100% (đơn về 0đ) KHÔNG được tự động duyệt", () => {
    const d = evaluateApproval(null, {
      ...base,
      orderTotal: 0,
      grossBeforeDiscount: 720_000,
      discountAmount: 720_000,
    })
    expect(d.autoApprove).toBe(false)
    expect(d.expectedApprover).toBe("owner")
    expect(d.reason).toContain("Chiết khấu")
  })

  it("chiết khấu vừa phải vẫn tự động duyệt như cũ", () => {
    const d = evaluateApproval(null, {
      ...base,
      orderTotal: 700_000,
      grossBeforeDiscount: 720_000,
      discountAmount: 20_000, // ~2,8%
    })
    expect(d.autoApprove).toBe(true)
  })

  it("ngưỡng 30% cần Manager, 50% cần Owner", () => {
    const at35 = evaluateApproval(null, {
      ...base, orderTotal: 650_000, grossBeforeDiscount: 1_000_000, discountAmount: 350_000,
    })
    expect(at35.expectedApprover).toBe("manager")
    const at60 = evaluateApproval(null, {
      ...base, orderTotal: 400_000, grossBeforeDiscount: 1_000_000, discountAmount: 600_000,
    })
    expect(at60.expectedApprover).toBe("owner")
  })

  it("KHÔNG suy tỉ lệ từ (gross - orderTotal): VAT che mất chiết khấu thật", () => {
    // Đây là kịch bản mà phép suy bằng hiệu số ra kết quả SAI, và là lý do
    // phải truyền discountAmount riêng.
    //
    //   hàng chưa VAT      1.000.000
    //   chiết khấu 30%      -300.000   → đúng ngưỡng cần Manager duyệt
    //   còn                  700.000
    //   VAT 10%              +70.000
    //   orderTotal           770.000
    //
    //   tỉ lệ đúng   = 300.000 / 1.000.000        = 30%  → cần Manager
    //   suy hiệu số  = (1.000.000 − 770.000)/1tr  = 23%  → TỰ ĐỘNG DUYỆT
    //
    // Tức VAT làm hiệu số nhỏ hơn chiết khấu thật, và đơn lọt qua đúng lúc
    // cần chặn. Bản đầu của test này kiểm ca chiết khấu = 0 nên đột biến
    // đổi sang hiệu số vẫn xanh — đã thử và nó lọt thật.
    const d = evaluateApproval(null, {
      ...base,
      orderTotal: 770_000,
      grossBeforeDiscount: 1_000_000,
      discountAmount: 300_000,
    })
    expect(d.autoApprove).toBe(false)
    expect(d.expectedApprover).toBe("manager")
    expect(d.reason).toContain("30%")
  })

  it("không chiết khấu thì VAT không tự sinh ra cảnh báo", () => {
    const d = evaluateApproval(null, {
      ...base, orderTotal: 1_100_000, grossBeforeDiscount: 1_000_000, discountAmount: 0,
    })
    expect(d.autoApprove).toBe(true)
  })

  it("nơi gọi chưa truyền hai trường mới thì giữ nguyên hành vi cũ", () => {
    const d = evaluateApproval(null, { ...base, orderTotal: 500_000 })
    expect(d.autoApprove).toBe(true)
  })

  it("cả hai nơi gọi đều truyền gross + discount", () => {
    for (const f of [
      "src/components/orders/order-form.tsx",
      "src/app/(dashboard)/orders/[id]/page.tsx",
    ]) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf-8")
      expect(src, `${f} chưa truyền grossBeforeDiscount`).toContain("grossBeforeDiscount:")
      expect(src, `${f} chưa truyền discountAmount`).toContain("discountAmount:")
    }
  })
})
