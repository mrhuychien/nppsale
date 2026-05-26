import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const BATCH_COLUMNS = [
  { key: "batchCode", label: "Mã lô" },
  { key: "zone", label: "Kho" },
  { key: "location", label: "Vị trí" },
  { key: "qtyInitial", label: "Ban đầu" },
  { key: "qtyOnHand", label: "Tồn" },
  { key: "manufacturedAt", label: "NSX" },
  { key: "expiresAt", label: "HSD" },
] as const satisfies readonly ListViewOption<string>[]

export type BatchColumnKey = (typeof BATCH_COLUMNS)[number]["key"]

export const DEFAULT_BATCH_COLUMNS: BatchColumnKey[] = [
  "batchCode",
  "zone",
  "location",
  "qtyInitial",
  "qtyOnHand",
  "manufacturedAt",
  "expiresAt",
]
