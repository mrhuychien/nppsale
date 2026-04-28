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

export const ROLES: Role[] = ["owner", "manager", "accountant", "sales", "warehouse", "driver"]
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
  sales: "Kinh doanh",
  warehouse: "Thủ kho",
  driver: "Tài xế",
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
 */
export const DEFAULT_PERMISSION_MAP: Record<Role, Record<Module, Action[]>> = {
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
    orders: ["read", "create"],
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
  driver: {
    orders: ["read"],
    customers: [],
    inventory: [],
    products: [],
    commissions: [],
    receivables: ["read", "create"],
    deliveries: ["read", "update"],
    promotions: [],
    invoices: [],
    returns: [],
    reports: [],
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
export type PermissionsCache = Record<Role, Record<string, Set<Action>>>

function buildCacheFromMap(map: Record<Role, Record<Module, Action[]>>): PermissionsCache {
  const out = {} as PermissionsCache
  for (const role of ROLES) {
    const m: Record<string, Set<Action>> = {}
    for (const mod of MODULES) {
      m[mod] = new Set(map[role]?.[mod] ?? [])
    }
    out[role] = m
  }
  return out
}

let runtimeCache: PermissionsCache | null = null

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
  role: Role
  module: Module
  action: Action
  allowed: boolean
}[] {
  const out: { role: Role; module: Module; action: Action; allowed: boolean }[] = []
  for (const role of ROLES) {
    for (const mod of MODULES) {
      for (const action of ACTIONS) {
        out.push({
          role,
          module: mod,
          action,
          allowed: DEFAULT_PERMISSION_MAP[role][mod].includes(action),
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
