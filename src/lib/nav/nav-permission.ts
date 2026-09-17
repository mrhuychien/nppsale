import {
  canAccessFeature,
  canAccessModule,
  hasFeaturePermission,
  hasPermission,
  type Action,
  type Module,
  type Role,
} from "@/lib/permissions"

/**
 * MỘT chỗ duy nhất khai: mỗi đường dẫn trong menu cần quyền gì.
 *
 * VÌ SAO PHẢI GOM LẠI
 *   Trước đây có BA danh sách menu tự khai quyền lấy: ngăn kéo bên trái,
 *   lưới Trang chủ, và thanh dưới màn hình. Ba chỗ đã lệch nhau thật:
 *   ngăn kéo kiểm tới TÍNH NĂNG ("payables", "finance.cash_receipts"),
 *   còn lưới Trang chủ chỉ kiểm tới MÔ-ĐUN ("receivables"). Kết quả là
 *   thu hồi quyền "Công nợ NCC" của một vai trò thì ngăn kéo giấu đi,
 *   nhưng ô trên Trang chủ vẫn còn — người dùng bấm vào rồi mới bị chặn.
 *
 *   Nhìn từ phía người dùng thì đó là hai câu trả lời khác nhau cho cùng
 *   một câu hỏi "tôi có được vào đây không". Gom về một bảng thì không
 *   còn chỗ cho hai câu trả lời.
 */
export interface NavPermission {
  module: Module
  /** Khoá tính năng — kiểm TRƯỚC mô-đun, chi tiết hơn mô-đun. */
  feature?: string
  /**
   * Hành động cần có. Bỏ trống nghĩa là "có bất kỳ quyền nào cũng vào
   * được" — đúng cho trang xem. Trang TẠO MỚI phải ghi rõ `create`.
   */
  action?: Action
  /** Luôn hiện, không phụ thuộc quyền: Trang chủ và Trợ giúp. */
  always?: boolean
}

/**
 * ⚠ Khoá là đường dẫn ĐÍCH DANH, không phải tiền tố. `/orders` và
 * `/orders/new` cần hai quyền khác nhau (xem và tạo), nên so theo tiền tố
 * là mở nhầm.
 */
export const NAV_PERMISSION: Record<string, NavPermission> = {
  // Luôn hiện — không có gì để giấu.
  "/home": { module: "orders", always: true },
  "/help": { module: "settings", always: true },

  // Bán hàng
  //
  // `/sell` là luồng BÁN HÀNG trên điện thoại (tìm hàng → giỏ → gửi đơn).
  // Nó tạo đơn nên đòi đúng quyền TẠO, không phải quyền xem.
  "/sell": { module: "orders", feature: "orders", action: "create" },
  "/orders": { module: "orders", feature: "orders" },
  "/orders/new": { module: "orders", feature: "orders", action: "create" },
  "/customers": { module: "customers", feature: "customers" },
  "/customers/routes": { module: "customers", feature: "customers" },
  "/customers/missing-photos": { module: "customers", feature: "customers" },
  "/sales/visits": { module: "customers", feature: "customers.visits" },
  "/promotions": { module: "promotions", feature: "promotions" },

  // Mua hàng
  "/inventory/stock-in": { module: "inventory", feature: "inventory" },
  "/purchasing/invoices": { module: "inventory", feature: "purchasing.invoices" },
  "/purchase-returns": { module: "inventory", feature: "purchasing.returns" },
  "/suppliers": { module: "inventory", feature: "suppliers" },
  "/payables": { module: "receivables", feature: "payables" },

  // Kho vận
  "/inventory": { module: "inventory", feature: "inventory" },
  "/products": { module: "products", feature: "products" },
  "/deliveries": { module: "deliveries", feature: "deliveries" },
  "/returns": { module: "returns", feature: "returns" },

  // Kế toán
  "/receivables": { module: "receivables", feature: "receivables" },
  "/receivables/collect": { module: "receivables", feature: "receivables" },
  "/receivables/by-customer": { module: "receivables", feature: "receivables.by_customer" },
  "/receivables/by-rep": { module: "receivables", feature: "receivables.by_rep" },
  "/finance/opening-balances": { module: "receivables", feature: "finance.opening_balances" },
  "/finance/cash-receipts": { module: "receivables", feature: "finance.cash_receipts" },
  "/finance/expenses": { module: "settings", feature: "finance.expenses" },
  "/invoices": { module: "invoices", feature: "invoices" },
  "/settings/einvoice": { module: "settings", feature: "einvoice.config" },

  // Nhân sự
  "/hr": { module: "settings", feature: "hr" },
  "/hr/attendance": { module: "settings", feature: "hr" },
  "/hr/bonus-config": { module: "settings", feature: "hr" },
  "/hr/salary-config": { module: "settings", feature: "hr" },
  "/hr/payroll/runs": { module: "settings", feature: "hr" },
  "/commissions": { module: "commissions", feature: "commissions" },
  "/settings/users": { module: "settings", feature: "settings.users" },
  "/settings/users/new": { module: "settings", feature: "settings.users" },
  "/settings/permissions": { module: "settings", feature: "settings.permissions" },

  // Phân tích
  "/analytics/business/overview": { module: "reports", feature: "analytics.business" },
  "/analytics/products/overview": { module: "reports", feature: "analytics.products" },
  "/analytics/customers/overview": { module: "reports", feature: "analytics.customers" },
  "/analytics/performance/receivables": { module: "reports", feature: "analytics.performance" },

  // Báo cáo
  "/reports": { module: "reports" },
  "/dashboard": { module: "reports", feature: "reports.dashboard" },
  "/reports/end-of-day": { module: "reports", feature: "reports.end_of_day" },
  "/reports/sales": { module: "reports", feature: "reports.sales" },
  "/reports/orders": { module: "reports", feature: "reports.orders" },
  "/reports/products": { module: "reports", feature: "reports.products" },
  "/reports/customers": { module: "reports", feature: "reports.customers" },
  "/reports/suppliers": { module: "reports", feature: "reports.suppliers" },
  "/reports/employees": { module: "reports", feature: "reports.employees" },
  "/reports/channels": { module: "reports", feature: "reports.channels" },
  "/reports/finance": { module: "reports", feature: "reports.finance" },

  // Cài đặt
  "/settings": { module: "settings", feature: "settings" },
  "/setup": { module: "settings", feature: "settings.org" },
  "/settings/org": { module: "settings", feature: "settings.org" },
  "/settings/approval-rules": { module: "settings", feature: "settings.approval_rules" },
}

/**
 * Có được thấy mục menu trỏ tới `href` không.
 *
 * ⚠ HAI CỬA ĐÓNG SẴN, cố ý:
 *
 *   1. Chưa biết vai trò (đang tải hồ sơ, hoặc tải hỏng) thì trả `false`.
 *      Bản cũ của lưới Trang chủ làm ngược lại — `if (!role) return TILES`
 *      — nên trong lúc chờ, MỌI người đều thấy MỌI thứ, kể cả Phân quyền
 *      và Nhân sự. Đoán rộng khi chưa biết là cách nhanh nhất để lộ một
 *      màn hình không nên lộ.
 *
 *   2. Đường dẫn chưa khai trong bảng cũng trả `false`. Thêm mục menu mà
 *      quên khai quyền thì mục đó BIẾN MẤT chứ không mở toang — và phép
 *      kiểm bắt được ngay, vì nó đối chiếu từng đường dẫn của cả ba menu
 *      với bảng này.
 */
export function canSeeHref(role: Role | null | undefined, href: string): boolean {
  if (!role) return false
  const p = NAV_PERMISSION[href]
  if (!p) return false
  if (p.always) return true
  if (p.action) {
    return p.feature
      ? hasFeaturePermission(role, p.feature, p.module, p.action)
      : hasPermission(role, p.module, p.action)
  }
  return p.feature
    ? canAccessFeature(role, p.feature, p.module)
    : canAccessModule(role, p.module)
}

/** Lọc một danh sách mục menu bất kỳ, miễn là mục có `href`. */
export function filterByPermission<T extends { href: string }>(
  role: Role | null | undefined,
  items: T[]
): T[] {
  return items.filter((i) => canSeeHref(role, i.href))
}

/**
 * Lọc menu theo nhóm.
 *
 * ⚠ Nhóm không còn mục nào thì BỎ luôn cả nhóm. Để lại tiêu đề "MUA HÀNG"
 * rồi trống trơn bên dưới thì người dùng tưởng menu hỏng, chứ không hiểu
 * là mình không có quyền.
 */
export function filterNavGroups<T extends { href: string }, G extends { items: T[] }>(
  role: Role | null | undefined,
  groups: G[]
): G[] {
  return groups
    .map((g) => ({ ...g, items: filterByPermission(role, g.items) }))
    .filter((g) => g.items.length > 0)
}
