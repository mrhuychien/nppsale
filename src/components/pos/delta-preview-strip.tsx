"use client"

/**
 * DẢI XEM TRƯỚC DELTA — cuối cột trái các màn sửa chứng từ đã ghi sổ.
 * Spec §7.2.
 *
 * ⚠ ĐÂY LÀ THỨ DUY NHẤT ĐỨNG GIỮA NGƯỜI DÙNG VÀ MỘT BÚT TOÁN KHO. Màn
 * sửa chứng từ đã ghi sổ mở TOÀN QUYỀN — đổi khách, đổi lô, đổi giá,
 * thêm/xoá dòng. Bấm lưu là hoàn tác bút toán cũ rồi ghi lại theo số
 * mới. Dải này nói trước "kho sẽ đổi thế nào, công nợ sẽ đổi thế nào"
 * để người bấm không phải đoán.
 *
 * ⚠ CHƯA CÓ SỐ THÌ NÓI "ĐANG TÍNH…", ĐỪNG VẼ SỐ 0. Spec §7.2 chốt
 * nguyên văn: *"Nếu chưa có endpoint dry-run: render khung với `đang
 * tính…`, ghi TODO, không tự viết RPC"*. Một dải toàn số 0 đọc như
 * "lưu xong chẳng có gì đổi" — đó là câu trả lời nguy hiểm nhất có thể
 * hiện ở đây.
 */

import type { ReactNode } from "react"
import { formatCurrency } from "@/lib/utils"

export interface DeltaCell {
  /** `KHO` · `CÔNG NỢ` · `HĐĐT MISA` · `KHO HÀNG LỖI` · `GIÁ VỐN BQ` */
  label: string
  /** Nội dung đã dựng sẵn, hoặc `null` = chưa tính được. */
  body: ReactNode | null
}

export function DeltaPreviewStrip({
  title = "Thay đổi sẽ ghi",
  subtitle,
  cells,
}: {
  title?: string
  subtitle?: string
  cells: DeltaCell[]
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-4 rounded-xl border border-[#bfdbfe] bg-white px-4 py-3">
      <div className="w-[164px] shrink-0 border-r border-[#e2e8f0] pr-4">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#1e3a8a]">
          {title}
        </div>
        {subtitle && <div className="mt-0.5 text-[11px] text-[#64748b]">{subtitle}</div>}
      </div>
      <div className="grid min-w-0 flex-grow grid-cols-3 gap-4">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#64748b]">
              {c.label}
            </div>
            <div className="n mt-1 text-[11.5px] leading-snug text-[#334155]">
              {/* ⚠ Xem đầu tệp: chưa tính được thì nói thế, đừng vẽ 0. */}
              {c.body ?? <span className="text-[#94a3b8]">đang tính…</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Ô KHO: `SP001754 · L2609  hoàn về +5  trừ lại −3  ròng +2 gói`.
 *
 * ⚠ `+` XANH, `−` ĐỎ, RÒNG XÁM (spec §7.2). Ba con số cùng màu là
 * người đọc phải tự dò xem cái nào là chiều nào — đúng lúc họ đang
 * quyết định có bấm lưu hay không.
 */
export function DeltaStock({
  sku,
  lot,
  parts,
  net,
  unit = "gói",
}: {
  sku: string
  lot?: string | null
  /** Các vế trung gian: `{ label: "hoàn về", value: +5 }`. */
  parts?: Array<{ label: string; value: number }>
  /** Thay đổi ròng. `null` = chưa tính được. */
  net: number | null
  unit?: string
}) {
  return (
    <span>
      <span className="text-[#0f172a]">{sku}</span>
      {lot && <span className="text-[#64748b]"> · {lot}</span>}
      {(parts ?? []).map((p) => (
        <span key={p.label} className={p.value >= 0 ? " text-[#16a34a]" : " text-[#dc2626]"}>
          {"  "}
          {p.label} {p.value >= 0 ? "+" : "−"}
          {Math.abs(p.value)}
        </span>
      ))}
      {net != null && (
        <span className="text-[#64748b]">
          {"  "}ròng {net >= 0 ? "+" : "−"}
          {Math.abs(net)} {unit}
        </span>
      )}
    </span>
  )
}

/** Ô CÔNG NỢ: `1.194.200 → 939.600  giảm 254.600`. */
export function DeltaMoney({
  from,
  to,
  /** `giảm` | `giảm thêm` | `tăng` — nơi gọi tự chọn chữ cho đúng ngữ cảnh. */
  verb = "giảm",
}: {
  from: number
  to: number
  verb?: string
}) {
  const chenh = to - from
  return (
    <span>
      <span className="text-[#64748b]">{formatCurrency(from)}</span>
      <span className="text-[#94a3b8]"> → </span>
      <strong className="text-[#0f172a]">{formatCurrency(to)}</strong>
      {chenh !== 0 && (
        <span className={chenh < 0 ? " text-[#16a34a]" : " text-[#dc2626]"}>
          {"  "}
          {chenh < 0 ? verb : "tăng"} {formatCurrency(Math.abs(chenh))}
        </span>
      )}
    </span>
  )
}
