import type { PosUnitOption } from "@/lib/pos/types"

/** Ô chọn đơn vị gọn của một dòng POS; chỉ một đơn vị thì hiện chữ, không mời bấm. */
export function PosUnitSelect({
  label,
  value,
  units,
  onChange,
  className = "",
}: {
  label: string
  value: string
  units: readonly PosUnitOption[]
  onChange: (unit: string) => void
  className?: string
}) {
  if (units.length <= 1) {
    return <span className={`text-[11px] font-semibold text-[var(--pos-muted)] ${className}`}>{value}</span>
  }
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-6 rounded-md border border-[var(--pos-edge)] bg-white px-1 text-[11px] font-semibold text-[var(--pos-ink)] ${className}`}
    >
      {units.map((u) => (
        <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>
      ))}
    </select>
  )
}
