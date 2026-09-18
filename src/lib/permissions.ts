import { FEATURES } from "./permissions-features"

export type Role = "owner" | "manager" | "accountant" | "sales" | "warehouse" | "driver"
export type Module =
  | "orders"
  | "customers"
  | "inventory"
  | "products"
  | "commissions"
  | "receivables"
  | "deliveries"
  | "promotions"
  | "invoices"
  | "returns"
  | "reports"
  | "settings"
export type Action = "read" | "create" | "update" | "delete" | "approve" | "export"

/**
 * Các vai GÁN ĐƯỢC. Dùng để dựng ma trận quyền và ô chọn vai.
 *
 * ⚠ HẸP HƠN KIỂU `Role`, VÀ ĐÓ LÀ CỐ Ý. `driver` đã ngưng dùng (mig 122)
 * nhưng vẫn còn trên các dòng `users` cũ — đó là hồ sơ nhân sự, và
 * `deliveries.driver_id` trỏ vào chúng. Kiểu vẫn phải hiểu giá trị đó để
 * màn Người dùng đọc lên không phải ép `as`; chỉ danh sách này hẹp lại
 * để không ai gán thêm được nữa.
 */
export type AssignableRole = Exclude<Role, "driver">
export const ROLES: AssignableRole[] = ["owner", "manager", "accountant", "sales", "warehouse"]

/** Vai đã ngưng dùng — còn đọc được, không gán mới được. */
export const RETIRED_ROLES: Role[] = ["driver"]
export const MODULES: Module[] = [
  "orders",
  "customers",
  "inventory",
  "products",
  "commissions",
  "receivables",
  "deliveries",
  "promotions",
  "invoices",
  "returns",
  "reports",
  "settings",
]
export const ACTIONS: Action[] = ["read", "create", "update", "delete", "approve", "export"]

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Chủ doanh nghiệp",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "Thủ kho",
  // ⚠ GIỮ NHÃN DÙ VAI ĐÃ BỎ. Màn Cài đặt → Người dùng vẫn liệt kê tài
  //   khoản tài xế cũ (đã khoá); bỏ dòng này là ô "Vai trò" của họ trống
  //   trơn, và người xem không biết đang nhìn cái gì.
  driver: "Tài xế (ngưng dùng)",
}

export const MODULE_LABELS: Record<Module, string> = {
  orders: "Đơn hàng",
  customers: "Khách hàng",
  inventory: "Kho hàng",
  products: "Sản phẩm",
  commissions: "Hoa hồng",
  receivables: "Công nợ",
  deliveries: "Giao hàng",
  promotions: "Khuyến mãi",
  invoices: "Hóa đơn",
  returns: "Trả hàng",
  reports: "Báo cáo & Phân tích",
  settings: "Cài đặt",
}

export const ACTION_LABELS: Record<Action, string> = {
  read: "Xem",
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  approve: "Duyệt",
  export: "Xuất file",
}

/**
 * Built-in default matrix. Used as fallback when an org hasn't customised
 * a particular (role, module, action) cell, and as the seed value when
 * resetting via the UI.
 *
 * ⚠ `Partial` — KHÔNG PHẢI MỌI VAI ĐỀU CÓ HÀNG. Vai `driver` đã ngưng
 * dùng nên không còn hàng nào ở đây, nhưng kiểu `Role` vẫn phải hiểu giá
 * trị đó (các dòng `users` cũ còn mang nó). Tra một vai đã bỏ sẽ ra
 * `undefined` → `hasPermission` trả false ở mọi ô, đúng ý: tài khoản đó
 * đã bị khoá ở mig 122 và không đăng nhập được nữa.
 */
export const DEFAULT_PERMISSION_MAP: Partial<Record<Role, Record<Module, Action[]>>> = {
  owner: {
    orders: ["read", "create", "update", "delete", "approve", "export"],
    customers: ["read", "create", "update", "delete", "export"],
    inventory: ["read", "create", "update", "delete", "export"],
    products: ["read", "create", "update", "delete", "export"],
    commissions: ["read", "create", "update", "delete", "export"],
    receivables: ["read", "create", "update", "delete", "export"],
    deliveries: ["read", "create", "update", "delete", "export"],
    promotions: ["read", "create", "update", "delete"],
    invoices: ["read", "create", "update", "delete", "export"],
    returns: ["read", "create", "update", "delete", "approve", "export"],
    reports: ["read", "export"],
    settings: ["read", "create", "update", "delete"],
  },
  manager: {
    orders: ["read", "create", "update", "approve", "export"],
    customers: ["read", "create", "update", "export"],
    inventory: ["read", "export"],
    products: ["read", "create", "update"],
    commissions: ["read", "export"],
    receivables: ["read", "export"],
    deliveries: ["read", "create", "update"],
    promotions: ["read", "create", "update"],
    invoices: ["read", "export"],
    returns: ["read", "approve"],
    reports: ["read", "export"],
    settings: ["read"],
  },
  accountant: {
    orders: ["read", "export"],
    customers: ["read", "export"],
    inventory: ["read"],
    products: ["read"],
    commissions: ["read", "update", "export"],
    receivables: ["read", "create", "update", "export"],
    deliveries: ["read"],
    promotions: ["read"],
    invoices: ["read", "create", "update", "export"],
    returns: ["read"],
    reports: ["read", "export"],
    settings: ["read"],
  },
  sales: {
    // `update` mở ra để NVBH sửa được đơn của CHÍNH MÌNH sau khi đơn đã
    // duyệt mà chưa lấy hàng. Phạm vi hẹp đó do hai chốt khác giữ, không
    // phải do ô này: `canEditOrder` (src/lib/orders/edit-permission.ts) và
    // chính sách RLS ở migration 115. Ô này chỉ là công tắc tổng.
    orders: ["read", "create", "update"],
    customers: ["read", "create", "update"],
    inventory: ["read"],
    products: ["read"],
    commissions: ["read"],
    receivables: ["read", "create"],
    deliveries: ["read"],
    promotions: ["read"],
    invoices: ["read"],
    returns: ["read", "create"],
    reports: ["read"],
    settings: [],
  },
  warehouse: {
    orders: ["read"],
    customers: [],
    inventory: ["read", "create", "update", "export"],
    products: ["read"],
    commissions: [],
    receivables: [],
    deliveries: ["read", "update"],
    promotions: [],
    invoices: [],
    returns: ["read", "update"],
    reports: ["read"],
    settings: [],
  },
}

/**
 * Compact map structure for runtime checks. Keyed by role -> permission
 * key -> Set<Action>. The permission key can be either a Module name
 * ("orders") OR a feature key ("customers.analytics"). Feature-specific
 * entries override the parent module when present; otherwise the
 * runtime falls back to the module-level entry.
 */
/**
 * ⚠ `Partial` VÌ VAI ĐÃ NGƯNG DÙNG KHÔNG CÓ HÀNG Ở ĐÂY. Tra `driver` ra
 * `undefined`, và `hasPermission` biến nó thành false ở mọi ô — đúng ý:
 * tài khoản đó đã bị khoá ở mig 122.
 */
export type PermissionsCache = Partial<Record<Role, Record<string, Set<Action>>>>

function buildCacheFromMap(
  map: Partial<Record<Role, Record<Module, Action[]>>>
): PermissionsCache {
  const out = {} as PermissionsCache
  for (const role of ROLES) {
    const m: Record<string, Set<Action>> = {}
    for (const mod of MODULES) {
      m[mod] = new Set(map[role]?.[mod] ?? [])
    }
    // ⚠ Tính năng có khai `defaultRoles` thì phải có Ô RIÊNG trong bộ nhớ
    // này, kể cả ô RỖNG. Không có ô thì phép tra rơi về mô-đun cha, và
    // đúng chỗ đó là chỗ "Hoá đơn mua" / "Công nợ NCC" lọt vào màn hình
    // của NVBH chỉ vì họ được đọc kho.
    for (const f of FEATURES) {
      if (!f.defaultRoles) continue
      m[f.key] = f.defaultRoles.includes(role)
        ? new Set(map[role]?.[f.module] ?? [])
        : new Set<Action>()
    }
    out[role] = m
  }
  return out
}

let runtimeCache: PermissionsCache | null = null

/**
 * Quyền TUỲ CHỈNH THEO TỪNG NGƯỜI của người đang đăng nhập.
 *
 * ⚠ BẢNG `user_permission_overrides` TỪNG BỊ GHI MÀ KHÔNG AI ĐỌC. Màn
 * /settings/users/[id]/permissions lưu xuống đó từ lâu, nhưng lúc chạy chỉ
 * có bảng theo VAI TRÒ được nạp — nên quản lý thu hồi quyền của một nhân
 * viên, thấy báo "Đã lưu", rồi nhân viên đó vẫn thấy và vẫn vào được đúng
 * màn vừa bị thu hồi. Không có chỗ nào trong hệ thống nói ra chuyện đó.
 *
 * Khoá là `<feature>.<action>` — đúng dạng màn kia ghi xuống.
 *
 * ⚠ ĐÂY LÀ QUYỀN CỦA MỘT NGƯỜI, KHÔNG PHẢI CỦA MỘT VAI TRÒ. Vì vậy nó
 * KHÔNG được trộn vào `hasPermission(role, …)`: màn phân quyền vẽ ma trận
 * cho MỌI vai trò, và trộn vào đó là hiện quyền riêng của người đang xem
 * như thể đó là mặc định của cả vai trò.
 */
export type UserOverrides = Record<string, boolean>

let userOverrides: UserOverrides | null = null

export function setUserOverrides(map: UserOverrides | null) {
  userOverrides = map
}

export function getUserOverrides(): UserOverrides | null {
  return userOverrides
}

/**
 * Tra quyền tuỳ chỉnh cho một danh sách khoá, ưu tiên khoá CHI TIẾT trước.
 *
 * Trả `null` nghĩa là "không có tuỳ chỉnh" — nơi gọi rơi về quyền vai trò.
 * Đây là điểm khác quan trọng so với `false`: không tuỳ chỉnh KHÔNG có
 * nghĩa là bị cấm.
 */
export function overrideFor(keys: string[], action: Action): boolean | null {
  if (!userOverrides) return null
  for (const k of keys) {
    const v = userOverrides[`${k}.${action}`]
    if (typeof v === "boolean") return v
  }
  return null
}

/**
 * Replace the runtime cache. Called by PermissionsLoader after fetching
 * `role_permissions` from the database. Pass `null` to clear and fall
 * back to DEFAULT_PERMISSION_MAP (e.g. on logout).
 */
export function setPermissionsCache(map: PermissionsCache | null) {
  runtimeCache = map
}

export function getPermissionsCache(): PermissionsCache {
  return runtimeCache ?? buildCacheFromMap(DEFAULT_PERMISSION_MAP)
}

/**
 * True when the role is allowed the action on the module. Owner is
 * always granted every action — protect against admins locking
 * themselves out.
 */
export function hasPermission(role: Role, module: Module, action: Action): boolean {
  if (role === "owner") return true
  const cache = getPermissionsCache()
  return cache[role]?.[module]?.has(action) ?? false
}

/**
 * Like hasPermission but for granular feature keys. Looks up the
 * feature first; if no feature-specific override exists in the cache,
 * falls back to the parent module's entry.
 */
export function hasFeaturePermission(
  role: Role,
  feature: string,
  parentModule: Module,
  action: Action
): boolean {
  if (role === "owner") return true
  const cache = getPermissionsCache()
  const cellForRole = cache[role]
  if (!cellForRole) return false
  const featureSet = cellForRole[feature]
  if (featureSet) return featureSet.has(action)
  return cellForRole[parentModule]?.has(action) ?? false
}

export function canAccessFeature(
  role: Role,
  feature: string,
  parentModule: Module
): boolean {
  if (role === "owner") return true
  const cache = getPermissionsCache()
  const cellForRole = cache[role]
  if (!cellForRole) return false
  const featureSet = cellForRole[feature]
  if (featureSet) return featureSet.size > 0
  return (cellForRole[parentModule]?.size ?? 0) > 0
}

export function getModulesForRole(role: Role): Module[] {
  const cache = getPermissionsCache()
  return MODULES.filter((m) => (cache[role]?.[m]?.size ?? 0) > 0)
}

export function canAccessModule(role: Role, module: Module): boolean {
  if (role === "owner") return true
  const cache = getPermissionsCache()
  return (cache[role]?.[module]?.size ?? 0) > 0
}

/** Build a flat list of permission rows from the default map (for seeding the UI). */
export function defaultPermissionRows(): {
  role: AssignableRole
  module: Module
  action: Action
  allowed: boolean
}[] {
  const out: { role: AssignableRole; module: Module; action: Action; allowed: boolean }[] = []
  for (const role of ROLES) {
    for (const mod of MODULES) {
      for (const action of ACTIONS) {
        out.push({
          role,
          module: mod,
          action,
          allowed: DEFAULT_PERMISSION_MAP[role]?.[mod]?.includes(action) ?? false,
        })
      }
    }
  }
  return out
}

export function rowsToCache(
  rows: { role: Role; module: string; action: Action; allowed: boolean }[]
): PermissionsCache {
  // Start from defaults so that any (role, module, action) NOT present in
  // the override list keeps its built-in value. Feature-specific rows
  // ("customers.analytics") add new keys to the cache that
  // hasFeaturePermission can look up directly.
  const out = buildCacheFromMap(DEFAULT_PERMISSION_MAP)
  for (const r of rows) {
    const cellForRole = out[r.role]
    if (!cellForRole) continue
    if (!cellForRole[r.module]) cellForRole[r.module] = new Set<Action>()
    const set = cellForRole[r.module]
    if (r.allowed) set.add(r.action)
    else set.delete(r.action)
  }
  return out
}
