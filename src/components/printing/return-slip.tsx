"use client"

/**
 * PHIẾU TRẢ HÀNG — cùng khuôn giấy với hóa đơn bán (`sales-invoice.tsx`):
 * tiêu đề công ty căn trái, bảng kẻ đủ, cỡ chữ đặt MỘT chỗ ở `.a4-doc`.
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "Màn Hóa đơn, Đơn hàng, Trả hàng, in đơn tại chỗ".
 *   Trước đó phiếu trả chưa có mẫu in nên nút In ở POS Trả hàng bị mờ.
 *
 * ⚠ HÀNG ĐỔI TÁCH BẢNG RIÊNG. Dòng đổi không trừ tiền — chung bảng với dòng
 *   trả là cột tiền có những ô "không trừ" chen giữa, người đọc cộng nhầm.
 *
 * ⚠ LÝ DO / GHI CHÚ TỪNG DÒNG in ngay dưới tên hàng — chúng là lý do kho
 *   nhận lại món ấy, người ký phiếu phải đọc được.
 *
 * ⚠ TIỀN IN SỐ ÂM (chủ nhà 25/09/2026: "Mẫu in phiếu trả hàng cũng in số âm").
 *   Hàng trả là khoản TRỪ vào công nợ của khách — cùng cách hóa đơn in dòng
 *   "(Hàng trả) … −220.000đ". Đơn giá vẫn dương; Thành tiền, Tổng trừ công nợ
 *   và Bằng chữ ("Âm …") mang dấu âm.
 */
import { formatCurrency } from "@/lib/utils"
import { stampVN, longDateVN, dateVN } from "@/lib/printing/doc-stamp"
import { bangChuCoAm } from "@/lib/utils/number-to-vn-words"

export interface ReturnSlipLine {
  id: string
  name: string
  sku?: string | null
  unitName: string
  quantity: number
  unitPrice: number
  lineTotal: number
  /** Nhãn lý do (đã quy ra chữ), rỗng thì không in. */
  reason?: string | null
  note?: string | null
}

export interface ReturnSlipProps {
  org: { name?: string | null; address?: string | null; phone?: string | null }
  issuedAt: Date | null
  /** `false` = chỉ có ngày (phiếu nhập bù ngày khác, mig 188) — in không kèm giờ. */
  issuedHasTime?: boolean
  /** Chứng từ gốc — "HĐ HD-0318-1" / "Đơn DH-0154". */
  refLabel?: string | null
  /** Số phiếu TH-xxxx (mig 193). */
  code?: string | null
  customerName: string
  customerAddress?: string | null
  customerPhone?: string | null
  salesPersonName?: string | null
  requesterName?: string | null
  /** Lý do chung của phiếu (đã quy ra chữ). */
  reason?: string | null
  returnLines: ReturnSlipLine[]
  exchangeLines: ReturnSlipLine[]
  /** Khoản trừ công nợ — `credit_note_amount`, vắng thì Σ dòng trả. */
  credit: number
  notes?: string | null
}

const CELL = "border border-black px-1 py-[2px] align-top leading-tight"

/** Tiền hàng trả in thành số âm (khoản trừ công nợ); 0 vẫn là 0. */
export function soAm(n: number): number {
  const v = Math.abs(Math.round(Number(n) || 0))
  return v === 0 ? 0 : -v
}

function Bang({ lines, exchange, startAt = 0 }: { lines: ReturnSlipLine[]; exchange: boolean; startAt?: number }) {
  return (
    <>
      {lines.map((l, i) => (
        <tr key={l.id}>
          <td className={`${CELL} text-center`}>{startAt + i + 1}</td>
          <td className={`${CELL} [overflow-wrap:anywhere]`}>
            {l.name}
            {l.sku ? ` (${l.sku})` : ""}
            {(l.reason || l.note) && (
              <div className="italic">
                {[l.reason, l.note].filter(Boolean).join(" · ")}
              </div>
            )}
          </td>
          <td className={`${CELL} text-center`}>{l.unitName}</td>
          <td className={`${CELL} text-center tabular-nums`}>{l.quantity}</td>
          <td className={`${CELL} text-right tabular-nums`}>{exchange ? "" : formatCurrency(l.unitPrice)}</td>
          <td className={`${CELL} text-right tabular-nums`}>{exchange ? "không trừ" : formatCurrency(soAm(l.lineTotal))}</td>
        </tr>
      ))}
    </>
  )
}

export function ReturnSlip(p: ReturnSlipProps) {
  const credit = Math.max(0, Math.round(Number(p.credit) || 0))
  const sl = p.returnLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  return (
    <div className="a4-doc mx-auto max-w-3xl bg-white text-[12px] text-black print:max-w-none">
      <div className="mb-1.5">
        <p className="font-bold uppercase leading-tight">{p.org.name || "—"}</p>
        {p.org.address && <p className="leading-tight">Địa chỉ: {p.org.address}</p>}
        {p.org.phone && <p className="leading-tight">Điện thoại: {p.org.phone}</p>}
      </div>

      <div className="mb-1.5 text-center">
        <h1 className="text-xl font-bold leading-tight">PHIẾU TRẢ HÀNG</h1>
        {p.code && <p className="font-bold leading-tight">Số: {p.code}</p>}
        <p className="font-bold leading-tight">Ngày {p.issuedHasTime === false ? dateVN(p.issuedAt) : stampVN(p.issuedAt)}</p>
        {p.refLabel && <p className="leading-tight">Theo {p.refLabel}</p>}
      </div>

      <div className="mb-1 leading-tight">
        <p>
          Khách hàng: <span className="font-bold">{p.customerName || "—"}</span>
        </p>
        <p>Địa chỉ: {p.customerAddress || ""}</p>
        <p>Liên hệ: {p.customerPhone || ""}</p>
        <p>Nhân Viên Bán Hàng: {p.salesPersonName || ""}</p>
        {p.reason && <p>Lý do trả: {p.reason}</p>}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-center font-bold">
            <th className={`${CELL} w-9`}>STT</th>
            <th className={CELL}>Tên hàng trả lại</th>
            <th className={`${CELL} w-12`}>ĐVT</th>
            <th className={`${CELL} w-8`}>SL</th>
            <th className={`${CELL} w-20`}>Đ.giá</th>
            <th className={`${CELL} w-20`}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {p.returnLines.length === 0 ? (
            <tr>
              <td className={`${CELL} text-center`} colSpan={6}>Không có hàng trả lại.</td>
            </tr>
          ) : (
            <Bang lines={p.returnLines} exchange={false} />
          )}
          <tr className="font-bold">
            <td className={`${CELL} text-center`} colSpan={3}>Tổng trừ công nợ</td>
            <td className={`${CELL} text-center tabular-nums`}>{sl}</td>
            <td className={CELL}></td>
            <td className={`${CELL} text-right tabular-nums`}>{formatCurrency(soAm(credit))}</td>
          </tr>
          {p.exchangeLines.length > 0 && (
            <>
              <tr>
                <td className={`${CELL} font-bold`} colSpan={6}>Hàng đổi giao cho khách</td>
              </tr>
              <Bang lines={p.exchangeLines} exchange startAt={p.returnLines.length} />
            </>
          )}
          {p.notes?.trim() && (
            <tr>
              <td className={`${CELL} whitespace-pre-wrap`} colSpan={6}>
                <span className="font-bold">Ghi chú:</span> {p.notes.trim()}
              </td>
            </tr>
          )}
          <tr>
            <td className={CELL} colSpan={6}>
              <span className="font-bold">Bằng chữ:</span>{" "}
              <span className="italic">{bangChuCoAm(soAm(credit))}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-1.5 grid grid-cols-2 items-start gap-4">
        <p className="leading-tight">{p.requesterName ? `Người lập: ${p.requesterName}` : ""}</p>
        <p className="text-right leading-tight">{longDateVN(p.issuedAt)}</p>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-4 text-center">
        {["Khách hàng", "Thủ kho", "Người lập phiếu"].map((role) => (
          <div key={role}>
            <p className="font-bold">{role}</p>
            <p className="italic">(Ký, họ tên)</p>
            <div className="h-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
