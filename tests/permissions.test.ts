import { describe, it, expect, beforeEach } from "vitest"
import {
  ROLES,
  MODULES,
  ACTIONS,
  DEFAULT_PERMISSION_MAP,
  setPermissionsCache,
  getPermissionsCache,
  hasPermission,
  hasFeaturePermission,
  canAccessFeature,
  canAccessModule,
  getModulesForRole,
  defaultPermissionRows,
  rowsToCache,
} from "@/lib/permissions"

/**
 * Phân quyền phía ứng dụng.
 *
 * ĐỌC KỸ TRƯỚC KHI TIN VÀO TEST NÀY: đây KHÔNG phải hàng rào bảo mật. Hàng
 * rào thật là RLS trong database — ai cũng gọi thẳng API Supabase được. Tầng
 * này chỉ quyết định ẩn/hiện giao diện.
 *
 * Nhưng sai ở đây vẫn tệ theo hai chiều:
 *   • Lỏng → nhân viên thấy menu không thuộc phần việc của mình, bấm vào rồi
 *     nhận lỗi RLS khó hiểu.
 *   • Chặt → người có quyền thật lại không thấy nút, tưởng hệ thống hỏng.
 */

// Cache là biến toàn cục trong module → phải dọn sau mỗi test, nếu không
// test này làm hỏng test kia theo thứ tự chạy.
beforeEach(() => setPermissionsCache(null))

describe("hasPermission — kiểm quyền theo module", () => {
  it("owner luôn được mọi thứ, kể cả khi cache nói ngược lại", () => {
    // Chống tự khoá chính mình: admin lỡ tắt hết quyền vẫn phải vào được.
    const locked = rowsToCache(
      MODULES.flatMap((m) =>
        ACTIONS.map((a) => ({ role: "owner" as const, module: m, action: a, allowed: false }))
      )
    )
    setPermissionsCache(locked)
    for (const m of MODULES) {
      for (const a of ACTIONS) {
        expect(hasPermission("owner", m, a)).toBe(true)
      }
    }
  })

  it("vai trò khác thì theo đúng bảng mặc định", () => {
    expect(hasPermission("sales", "orders", "create")).toBe(true)
    expect(hasPermission("sales", "settings", "update")).toBe(false)
    expect(hasPermission("warehouse", "inventory", "update")).toBe(true)
  })

  it("kế toán KHÔNG được sửa đơn hàng", () => {
    expect(hasPermission("accountant", "orders", "update")).toBe(false)
    expect(hasPermission("accountant", "orders", "read")).toBe(true)
  })

  it("chỉ owner và manager được duyệt đơn", () => {
    const approvers = ROLES.filter((r) => hasPermission(r, "orders", "approve"))
    expect(approvers.sort()).toEqual(["manager", "owner"])
  })

  it("module lạ trả về false chứ không ném lỗi", () => {
    // @ts-expect-error — cố tình truyền module không tồn tại
    expect(hasPermission("sales", "khong-ton-tai", "read")).toBe(false)
  })
})

describe("cache runtime", () => {
  it("chưa nạp gì thì dùng bảng mặc định", () => {
    const cache = getPermissionsCache()
    expect(cache.sales.orders.has("create")).toBe(true)
  })

  it("nạp cache mới thì áp dụng ngay", () => {
    setPermissionsCache(
      rowsToCache([{ role: "sales", module: "orders", action: "create", allowed: false }])
    )
    expect(hasPermission("sales", "orders", "create")).toBe(false)
  })

  it("truyền null (đăng xuất) thì quay về mặc định", () => {
    setPermissionsCache(
      rowsToCache([{ role: "sales", module: "orders", action: "create", allowed: false }])
    )
    expect(hasPermission("sales", "orders", "create")).toBe(false)
    setPermissionsCache(null)
    expect(hasPermission("sales", "orders", "create")).toBe(true)
  })
})

describe("rowsToCache — ghép override lên bảng mặc định", () => {
  it("quyền KHÔNG có trong danh sách override thì giữ nguyên mặc định", () => {
    // Đây là điểm dễ hiểu nhầm nhất: danh sách override là phần CHÊNH LỆCH,
    // không phải toàn bộ quyền. Nếu ai đó đổi thành "chỉ những gì có trong
    // danh sách mới được phép", mọi vai trò sẽ mất sạch quyền.
    const cache = rowsToCache([
      { role: "sales", module: "orders", action: "delete", allowed: true },
    ])
    setPermissionsCache(cache)
    expect(hasPermission("sales", "orders", "delete")).toBe(true) // vừa cấp
    expect(hasPermission("sales", "orders", "create")).toBe(true) // giữ mặc định
    expect(hasPermission("sales", "customers", "read")).toBe(true) // giữ mặc định
  })

  it("allowed = false thì gỡ quyền mặc định", () => {
    setPermissionsCache(
      rowsToCache([{ role: "warehouse", module: "inventory", action: "update", allowed: false }])
    )
    expect(hasPermission("warehouse", "inventory", "update")).toBe(false)
  })

  it("vai trò lạ trong danh sách bị bỏ qua, không làm vỡ cache", () => {
    const cache = rowsToCache([
      { role: "khong-co" as never, module: "orders", action: "read", allowed: true },
      { role: "sales", module: "orders", action: "delete", allowed: true },
    ])
    setPermissionsCache(cache)
    expect(hasPermission("sales", "orders", "delete")).toBe(true)
  })

  it("dòng override sau ghi đè dòng trước", () => {
    setPermissionsCache(
      rowsToCache([
        { role: "sales", module: "orders", action: "delete", allowed: true },
        { role: "sales", module: "orders", action: "delete", allowed: false },
      ])
    )
    expect(hasPermission("sales", "orders", "delete")).toBe(false)
  })
})

describe("quyền theo tính năng — hasFeaturePermission", () => {
  it("không có cấu hình riêng thì THỪA KẾ module cha", () => {
    expect(hasFeaturePermission("sales", "customers.analytics", "customers", "read")).toBe(
      hasPermission("sales", "customers", "read")
    )
  })

  it("có cấu hình riêng thì cấu hình riêng THẮNG module cha", () => {
    setPermissionsCache(
      rowsToCache([
        { role: "sales", module: "customers.analytics", action: "read", allowed: false },
      ])
    )
    // Vẫn xem được khách hàng...
    expect(hasPermission("sales", "customers", "read")).toBe(true)
    // ...nhưng không xem được phần phân tích.
    expect(hasFeaturePermission("sales", "customers.analytics", "customers", "read")).toBe(false)
  })

  it("cấu hình riêng có thể MỞ RỘNG hơn module cha", () => {
    // Mặc định tài xế không đụng gì tới sản phẩm.
    setPermissionsCache(
      rowsToCache([
        { role: "driver", module: "products.stock-lookup", action: "read", allowed: true },
      ])
    )
    expect(hasPermission("driver", "products", "read")).toBe(false)
    expect(hasFeaturePermission("driver", "products.stock-lookup", "products", "read")).toBe(true)
  })

  it("owner bỏ qua mọi cấu hình tính năng", () => {
    setPermissionsCache(
      rowsToCache([
        { role: "owner", module: "customers.analytics", action: "read", allowed: false },
      ])
    )
    expect(hasFeaturePermission("owner", "customers.analytics", "customers", "read")).toBe(true)
  })
})

describe("canAccessFeature — chỉ hỏi 'có vào được không', không hỏi hành động nào", () => {
  it("còn ÍT NHẤT một hành động là vào được", () => {
    setPermissionsCache(
      rowsToCache([
        // Gỡ hết trừ 'read'.
        ...ACTIONS.filter((a) => a !== "read").map((a) => ({
          role: "sales" as const, module: "customers.analytics", action: a, allowed: false,
        })),
        { role: "sales", module: "customers.analytics", action: "read", allowed: true },
      ])
    )
    expect(canAccessFeature("sales", "customers.analytics", "customers")).toBe(true)
  })

  it("gỡ sạch mọi hành động thì KHÔNG vào được", () => {
    setPermissionsCache(
      rowsToCache(
        ACTIONS.map((a) => ({
          role: "sales" as const, module: "customers.analytics", action: a, allowed: false,
        }))
      )
    )
    expect(canAccessFeature("sales", "customers.analytics", "customers")).toBe(false)
  })

  it("không cấu hình riêng thì hỏi sang module cha", () => {
    expect(canAccessFeature("sales", "customers.gi-do", "customers")).toBe(
      canAccessModule("sales", "customers")
    )
  })
})

describe("canAccessModule / getModulesForRole — dựng menu", () => {
  it("owner thấy mọi module", () => {
    expect(getModulesForRole("owner").sort()).toEqual([...MODULES].sort())
  })

  it("mọi vai trò đều thấy ít nhất một module — không ai đăng nhập vào màn hình trống", () => {
    for (const role of ROLES) {
      expect(getModulesForRole(role).length, `vai trò ${role} không có module nào`).toBeGreaterThan(0)
    }
  })

  it("gỡ hết quyền của một module thì module đó biến khỏi menu", () => {
    setPermissionsCache(
      rowsToCache(
        ACTIONS.map((a) => ({
          role: "sales" as const, module: "promotions", action: a, allowed: false,
        }))
      )
    )
    expect(canAccessModule("sales", "promotions")).toBe(false)
    expect(getModulesForRole("sales")).not.toContain("promotions")
  })
})

describe("defaultPermissionRows — dữ liệu mồi cho màn hình phân quyền", () => {
  it("sinh đủ tổ hợp vai trò × module × hành động", () => {
    expect(defaultPermissionRows()).toHaveLength(
      ROLES.length * MODULES.length * ACTIONS.length
    )
  })

  it("cờ allowed khớp với bảng mặc định", () => {
    const rows = defaultPermissionRows()
    for (const r of rows) {
      expect(r.allowed).toBe(DEFAULT_PERMISSION_MAP[r.role][r.module].includes(r.action))
    }
  })

  it("nạp lại chính nó thì không đổi gì — phép thử khứ hồi", () => {
    // Mở màn hình phân quyền rồi bấm Lưu mà không sửa gì thì quyền phải y nguyên.
    setPermissionsCache(rowsToCache(defaultPermissionRows()))
    for (const role of ROLES) {
      for (const m of MODULES) {
        for (const a of ACTIONS) {
          expect(
            hasPermission(role, m, a),
            `${role}/${m}/${a} đổi sau khi lưu lại y nguyên`
          ).toBe(role === "owner" ? true : DEFAULT_PERMISSION_MAP[role][m].includes(a))
        }
      }
    }
  })
})

describe("bảng quyền mặc định — các bất biến nghiệp vụ", () => {
  it("mọi vai trò đều khai báo đủ mọi module (không sót ô nào)", () => {
    for (const role of ROLES) {
      for (const m of MODULES) {
        expect(
          Array.isArray(DEFAULT_PERMISSION_MAP[role]?.[m]),
          `thiếu ô ${role}/${m} — hasPermission sẽ trả false âm thầm`
        ).toBe(true)
      }
    }
  })

  it("không vai trò nào ngoài owner được xoá dữ liệu tiền", () => {
    for (const role of ROLES.filter((r) => r !== "owner")) {
      expect(hasPermission(role, "receivables", "delete"), `${role} xoá được công nợ`).toBe(false)
      expect(hasPermission(role, "invoices", "delete"), `${role} xoá được hoá đơn`).toBe(false)
    }
  })

  it("chỉ owner được sửa cấu hình hệ thống", () => {
    const canEditSettings = ROLES.filter((r) => hasPermission(r, "settings", "update"))
    expect(canEditSettings).toEqual(["owner"])
  })
})
