import type { Role } from "@/lib/permissions"

// Update #2 v2 §1.3 — 4 named permission templates.
//
// Each template is a "starting preset" the owner picks when creating a
// new user. It bundles a role with the per-user capability flags
// (price-edit + attendance bypass) that govern day-to-day behavior.
// The owner can still tweak any field after applying a template.
//
// Templates do NOT touch the role-permission matrix (that lives at
// /settings/permissions and is per-org). Apply a template to a user,
// then if they need extra module access, override at the matrix level.

export type TemplateKey = "sales_basic" | "sales_flex" | "warehouse" | "accountant"

export interface PermissionTemplate {
  key: TemplateKey
  label: string
  description: string
  role: Role
  /** true = NV được sửa giá khi tạo / sửa đơn (mig 027). */
  allow_price_edit: boolean
  /** % cap tăng giá tối đa so với list. 0 = không tăng. */
  price_edit_max_increase_pct: number
  /** Hint text under the template option (UI only). */
  capabilities: string[]
}

export const PERMISSION_TEMPLATES: PermissionTemplate[] = [
  {
    key: "sales_basic",
    label: "NV Bán hàng cơ bản",
    role: "sales",
    description:
      "Sales mới / part-time. Không sửa giá list, chỉ tạo đơn theo giá có sẵn.",
    allow_price_edit: false,
    price_edit_max_increase_pct: 0,
    capabilities: [
      "Tạo / xem đơn của mình",
      "Không được sửa giá list",
      "Bỏ chấm công (lương theo doanh số)",
    ],
  },
  {
    key: "sales_flex",
    label: "NV Bán hàng linh hoạt",
    role: "sales",
    description:
      "Sales chính thức. Được tăng giá tối đa 10% so với list để bán xả / khách lẻ.",
    allow_price_edit: true,
    price_edit_max_increase_pct: 10,
    capabilities: [
      "Tạo / xem đơn của mình",
      "Sửa giá ≥ list, ≤ list × 1.10",
      "Bỏ chấm công (lương theo doanh số)",
    ],
  },
  {
    key: "warehouse",
    label: "NV Kho",
    role: "warehouse",
    description:
      "Thủ kho / xuất kho. Quản lý nhập-xuất, không động đến giá.",
    allow_price_edit: false,
    price_edit_max_increase_pct: 0,
    capabilities: [
      "Nhập / xuất / kiểm kho",
      "Không sửa giá",
      "Chấm công bình thường",
    ],
  },
  {
    key: "accountant",
    label: "Kế toán",
    role: "accountant",
    description:
      "Kế toán nội bộ. Free quyền giá (không bị check), xem mọi báo cáo tài chính.",
    allow_price_edit: true,
    price_edit_max_increase_pct: 0, // free check ignores this anyway
    capabilities: [
      "Xem mọi đơn / công nợ / hóa đơn",
      "Free quyền sửa giá (như owner)",
      "Chấm công bình thường",
    ],
  },
]

export function getTemplate(key: TemplateKey | string): PermissionTemplate | undefined {
  return PERMISSION_TEMPLATES.find((t) => t.key === key)
}
