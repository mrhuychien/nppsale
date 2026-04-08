export type Role = "owner" | "manager" | "accountant" | "sales" | "warehouse" | "driver"
export type Module = "orders" | "customers" | "inventory" | "products" | "commissions" | "receivables" | "deliveries" | "promotions" | "invoices" | "returns" | "reports" | "settings"
export type Action = "read" | "create" | "update" | "delete" | "approve"

const PERMISSION_MAP: Record<Role, Record<Module, Action[]>> = {
  owner: {
    orders: ["read", "create", "update", "delete", "approve"],
    customers: ["read", "create", "update", "delete"],
    inventory: ["read", "create", "update", "delete"],
    products: ["read", "create", "update", "delete"],
    commissions: ["read", "create", "update", "delete"],
    receivables: ["read", "create", "update", "delete"],
    deliveries: ["read", "create", "update", "delete"],
    promotions: ["read", "create", "update", "delete"],
    invoices: ["read", "create", "update", "delete"],
    returns: ["read", "create", "update", "delete", "approve"],
    reports: ["read"],
    settings: ["read", "create", "update", "delete"],
  },
  manager: {
    orders: ["read", "create", "update", "approve"],
    customers: ["read", "create", "update"],
    inventory: ["read"],
    products: ["read", "create", "update"],
    commissions: ["read"],
    receivables: ["read"],
    deliveries: ["read", "create", "update"],
    promotions: ["read", "create", "update"],
    invoices: ["read"],
    returns: ["read", "approve"],
    reports: ["read"],
    settings: ["read"],
  },
  accountant: {
    orders: ["read"],
    customers: ["read"],
    inventory: ["read"],
    products: ["read"],
    commissions: ["read", "update"],
    receivables: ["read", "create", "update"],
    deliveries: ["read"],
    promotions: ["read"],
    invoices: ["read", "create", "update"],
    returns: ["read"],
    reports: ["read"],
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
    inventory: ["read", "create", "update"],
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

export function hasPermission(role: Role, module: Module, action: Action): boolean {
  return PERMISSION_MAP[role]?.[module]?.includes(action) ?? false
}

export function getModulesForRole(role: Role): Module[] {
  return Object.entries(PERMISSION_MAP[role])
    .filter(([, actions]) => actions.length > 0)
    .map(([module]) => module as Module)
}

export function canAccessModule(role: Role, module: Module): boolean {
  return (PERMISSION_MAP[role]?.[module]?.length ?? 0) > 0
}
