import type { Module, Action } from "./permissions"

/**
 * Granular feature keys used for fine-grained per-menu-item permissions.
 *
 * Each feature belongs to a parent Module. When checking permission for
 * a feature, the runtime first looks up the feature-specific overrides
 * (set on the /settings/permissions page), then falls back to the
 * parent module's permission. This means an org that only configures
 * module-level permissions keeps working, while those that want
 * tighter control can grant or revoke individual menu items.
 *
 * Keys follow the pattern `module` or `module.feature` and must match
 * the regex enforced by migration 024.
 */
export type FeatureKey = string

export interface FeatureDef {
  key: FeatureKey
  label: string
  module: Module
  /** Top-level menu group used for grouping in the permission UI. */
  group: string
  /** When true, the feature inherits its defaults from the parent module
   * (no explicit per-feature defaults). All current features inherit. */
  inherits?: boolean
}

export const FEATURE_GROUPS = [
  "Bán hàng",
  "Vận hành",
  "Mua hàng",
  "Kho vận",
  "Kế toán",
  "Nhân sự",
  "Phân tích",
  "Báo cáo",
  "Cài đặt",
] as const

export type FeatureGroup = (typeof FEATURE_GROUPS)[number]

export const FEATURES: FeatureDef[] = [
  // Bán hàng
  { key: "orders", label: "Đơn hàng", module: "orders", group: "Bán hàng" },
  { key: "customers", label: "Khách hàng", module: "customers", group: "Bán hàng" },
  { key: "customers.visits", label: "Lịch sử đi tuyến", module: "customers", group: "Bán hàng", inherits: true },
  { key: "promotions", label: "Khuyến mãi", module: "promotions", group: "Bán hàng" },
  { key: "commissions", label: "Hoa hồng", module: "commissions", group: "Bán hàng" },

  // Vận hành
  { key: "deliveries", label: "Giao hàng", module: "deliveries", group: "Vận hành" },
  { key: "returns", label: "Trả hàng", module: "returns", group: "Vận hành" },

  // Mua hàng
  { key: "purchasing.invoices", label: "Hoá đơn mua hàng (tra cứu)", module: "inventory", group: "Mua hàng", inherits: true },
  { key: "purchasing.returns", label: "Trả hàng NCC", module: "inventory", group: "Mua hàng", inherits: true },
  { key: "suppliers", label: "Nhà cung cấp", module: "inventory", group: "Mua hàng", inherits: true },
  { key: "payables", label: "Công nợ NCC", module: "receivables", group: "Mua hàng", inherits: true },

  // Kho vận
  { key: "inventory", label: "Kho hàng", module: "inventory", group: "Kho vận" },
  { key: "products", label: "Sản phẩm", module: "products", group: "Kho vận" },

  // Kế toán
  { key: "receivables", label: "Công nợ KH", module: "receivables", group: "Kế toán" },
  { key: "receivables.by_customer", label: "Công nợ theo khách hàng", module: "receivables", group: "Kế toán", inherits: true },
  { key: "receivables.by_rep", label: "Công nợ theo nhân viên", module: "receivables", group: "Kế toán", inherits: true },
  { key: "finance.cash_receipts", label: "Phiếu thu", module: "receivables", group: "Kế toán", inherits: true },
  { key: "finance.expenses", label: "Chi phí", module: "settings", group: "Kế toán", inherits: true },
  { key: "invoices", label: "Hóa đơn bán", module: "invoices", group: "Kế toán" },
  { key: "einvoice.config", label: "Cấu hình hoá đơn điện tử (MISA)", module: "settings", group: "Kế toán", inherits: true },

  // Nhân sự
  { key: "hr", label: "Nhân sự", module: "settings", group: "Nhân sự", inherits: true },

  // Phân tích
  { key: "analytics.business", label: "Phân tích kinh doanh", module: "reports", group: "Phân tích", inherits: true },
  { key: "analytics.products", label: "Phân tích hàng hóa", module: "reports", group: "Phân tích", inherits: true },
  { key: "analytics.customers", label: "Phân tích khách hàng (tổng)", module: "reports", group: "Phân tích", inherits: true },
  { key: "analytics.performance", label: "Phân tích hiệu quả", module: "reports", group: "Phân tích", inherits: true },

  // Báo cáo
  { key: "reports.dashboard", label: "Tổng quan", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.end_of_day", label: "Báo cáo cuối ngày", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.sales", label: "Báo cáo bán hàng", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.orders", label: "Báo cáo đặt hàng", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.products", label: "Báo cáo hàng hóa", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.customers", label: "Báo cáo khách hàng", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.suppliers", label: "Báo cáo nhà cung cấp", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.employees", label: "Báo cáo nhân viên", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.channels", label: "Báo cáo kênh bán hàng", module: "reports", group: "Báo cáo", inherits: true },
  { key: "reports.finance", label: "Báo cáo tài chính", module: "reports", group: "Báo cáo", inherits: true },

  // Cài đặt
  { key: "settings", label: "Cài đặt chung", module: "settings", group: "Cài đặt" },
  { key: "settings.users", label: "Người dùng", module: "settings", group: "Cài đặt", inherits: true },
  { key: "settings.permissions", label: "Phân quyền", module: "settings", group: "Cài đặt", inherits: true },
  { key: "settings.org", label: "Tổ chức / NPP", module: "settings", group: "Cài đặt", inherits: true },
  { key: "settings.approval_rules", label: "Duyệt đơn tự động", module: "settings", group: "Cài đặt", inherits: true },
]

const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))

export function getFeature(key: FeatureKey): FeatureDef | undefined {
  return FEATURE_BY_KEY.get(key)
}

export function featuresByGroup(): Record<FeatureGroup, FeatureDef[]> {
  const out = {} as Record<FeatureGroup, FeatureDef[]>
  for (const g of FEATURE_GROUPS) out[g] = []
  for (const f of FEATURES) {
    if (out[f.group as FeatureGroup]) {
      out[f.group as FeatureGroup].push(f)
    }
  }
  return out
}

export type { Action }
