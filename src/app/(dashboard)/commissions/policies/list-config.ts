import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const COMMISSION_POLICY_COLUMNS = [
  { key: "type", label: "Loại" },
  { key: "appliesTo", label: "Áp dụng cho" },
  { key: "effective", label: "Hiệu lực" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type CommissionPolicyColumnKey = (typeof COMMISSION_POLICY_COLUMNS)[number]["key"]

export const DEFAULT_COMMISSION_POLICY_COLUMNS: CommissionPolicyColumnKey[] = [
  "type",
  "appliesTo",
  "effective",
  "status",
]
