import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const USER_COLUMNS = [
  { key: "role", label: "Vai trò" },
  { key: "phone", label: "SĐT" },
  { key: "status", label: "Trạng thái" },
  { key: "action", label: "Thao tác" },
] as const satisfies readonly ListViewOption<string>[]

export type UserColumnKey = (typeof USER_COLUMNS)[number]["key"]

export const DEFAULT_USER_COLUMNS: UserColumnKey[] = [
  "role",
  "phone",
  "status",
  "action",
]
