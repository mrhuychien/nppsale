import { NHAN_HINH_THUC } from "@/lib/suppliers/chi-tiet"
import { formatCurrency } from "@/lib/utils"
import type { DongSoNoNcc, LoaiDongNoNcc } from "./so-no-ncc"

/**
 * SỔ CHI TIẾT CÔNG NỢ MỘT NCC — chủ nhà 08/11/2026: "phần chi tiết công nợ từng ncc chưa có dư nợ sau mỗi giao dịch,
 * kiểm tra xem phần tiền thanh toán cho ncc cũng chưa có trong công nợ".
 *
 * Tab Công nợ cũ chỉ liệt kê KHOẢN NỢ (`payables`): tiền đã trả nằm trong cột "Đã thanh toán" của từng khoản, không thành
 * dòng; không có dư nợ chạy. Sổ này: mỗi GIAO DỊCH một dòng, theo thời gian, kèm dư nợ SAU giao dịch:
 *   · khoản nợ — phiếu nhập (+), nợ đầu kỳ / công nợ lập tay (+), phiếu trả NCC (dòng âm → giảm nợ);
 *   · tiền trả — phiếu chi trả NCC (mig 242) MỘT dòng cả phiếu dù tiền đã chia vào nhiều khoản (gom phần
 *     `payable_payments` theo `supplier_payment_id`); trả thẳng vào một khoản (Ghi trả NCC, mig 167) mỗi lần một dòng.
 * ⚠ KHÔNG ĐẾM HAI LẦN:
 *   · dòng "Trả trước NCC" của phiếu chi (amount 0, paid = phần dư) KHÔNG là dòng sổ — phần dư đã nằm trong số tiền của
 *     dòng phiếu chi (phần tiền của phiếu nằm trên dòng ấy được gom cùng phiếu);
 *   · tiền trả lấy từ `payable_payments` (tiền thật đã ghi), không lấy `payables.paid` rồi cộng thêm phiếu.
 * ⚠ ĐÃ TRẢ MÀ KHÔNG CÓ PHIẾU: `paid` lớn hơn tổng `payable_payments` của khoản (nợ đầu kỳ nhập sẵn `paid`, dữ liệu
 *   cũ — mig 167) → một dòng "Đã thanh toán — không có phiếu chi" ngay sau khoản ấy. Nhờ vậy dư nợ cuối = Σ(amount − paid)
 *   = `tongNoNcc` của cả sổ, không phụ thuộc dữ liệu cũ có đủ phiếu hay không.
 * ⚠ Nợ đầu kỳ đứng ĐẦU sổ dù nhập sau (số dư mang sang là điểm xuất phát), như `_don_tra_truoc_ncc` trừ nó trước.
 */

/** Một lần trả tiền vào MỘT khoản nợ (`payable_payments`). `supplier_payment_id` = phần của phiếu chi NCC (mig 242). */
export interface TraTienNo {
  id: string
  payable_id: string
  amount: number | string | null
  method: string | null
  paid_at: string | null
  supplier_payment_id?: string | null
}

/** Phiếu chi NCC — gắn mã / hình thức cho nhóm phần tiền cùng phiếu. */
export interface PhieuChiNhan {
  id: string
  code: string
  method?: string | null
}

export type LoaiDongSoNcc = "phieu-nhap" | "tra-ncc" | "dau-ky" | "lap-tay" | "phieu-chi" | "tra-tien" | "tra-san"
export type ToneDongSo = "success" | "warning" | "danger" | "secondary"

export interface DongSoChiTietNcc {
  id: string
  loai: LoaiDongSoNcc
  /** Lúc ghi sổ (ISO) — để xếp và hiện ngày. */
  luc: string
  ma: string
  href: string | null
  dienGiai: string
  /** Làm TĂNG nợ phải trả (≥ 0). */
  tang: number
  /** Làm GIẢM nợ phải trả (≥ 0). */
  giam: number
  /** Dư nợ SAU giao dịch này. Âm = NCC đang giữ tiền của mình. */
  duNo: number
  trangThai: { nhan: string; tone: ToneDongSo }
  /** Khoản nợ chưa trả xong: còn bao nhiêu (để biết chứng từ nào còn nợ). */
  conLai?: number
}

/** Diễn giải dòng khoản nợ trong sổ — tên đầy đủ (bảng khoản nợ cũ dùng nhãn ngắn `NHAN_LOAI_NO_NCC`). */
export const DIEN_GIAI_KHOAN: Record<LoaiDongNoNcc, string> = {
  "phieu-nhap": "Phiếu nhập hàng",
  "tra-ncc": "Trả hàng NCC",
  "dau-ky": "Nợ đầu kỳ",
  "lap-tay": "Công nợ lập tay",
  "tra-truoc": "Trả trước NCC",
}

const so = (v: unknown) => Number(v) || 0
const tron = (v: number) => Math.round(v * 100) / 100
const moc = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}
const hinhThuc = (m: string | null | undefined) => (m && NHAN_HINH_THUC[m] ? ` · ${NHAN_HINH_THUC[m]}` : "")

function trangThaiKhoan(r: Pick<DongSoNoNcc, "status" | "amount" | "loai">): DongSoChiTietNcc["trangThai"] {
  if (so(r.amount) < 0) return { nhan: "Trừ vào nợ", tone: "success" }
  if (r.status === "paid") return { nhan: "Đã thanh toán", tone: "success" }
  if (r.status === "overdue") return { nhan: "Quá hạn", tone: "danger" }
  if (r.status === "partial") return { nhan: "Thanh toán một phần", tone: "warning" }
  return { nhan: "Chưa thanh toán", tone: "warning" }
}

type ViecSo = Omit<DongSoChiTietNcc, "duNo"> & { dauKy: boolean; thu: number }

/**
 * Dựng sổ. Trả các dòng MỚI TRƯỚC (như các bảng khác của màn) — `duNo` của mỗi dòng là dư nợ sau dòng ấy theo thứ tự thời
 * gian; `duNoCuoi` = dư nợ hiện tại (bằng `tongNoNcc` của cùng sổ khi dữ liệu đủ).
 */
export function soChiTietNoNcc(
  no: ReadonlyArray<DongSoNoNcc>,
  traTien: ReadonlyArray<TraTienNo>,
  phieuChi: ReadonlyArray<PhieuChiNhan> = []
): { dong: DongSoChiTietNcc[]; duNoCuoi: number } {
  const viec: ViecSo[] = []
  const daTraTheoKhoan = new Map<string, number>()
  for (const t of traTien) daTraTheoKhoan.set(t.payable_id, (daTraTheoKhoan.get(t.payable_id) ?? 0) + so(t.amount))
  const khoan = new Map(no.map((r) => [r.id, r]))

  for (const r of no) {
    const dauKy = r.loai === "dau-ky"
    const amt = so(r.amount)
    /* Dòng trả trước của phiếu chi không phải khoản nợ — tiền của nó đi theo dòng phiếu chi. */
    if (r.loai !== "tra-truoc" && amt !== 0) {
      const conLai = so(r.amount) - so(r.paid)
      viec.push({
        id: `no-${r.id}`, loai: r.loai, luc: r.created_at, ma: r.ma, href: r.href, dienGiai: DIEN_GIAI_KHOAN[r.loai],
        tang: Math.max(amt, 0), giam: Math.max(-amt, 0), trangThai: trangThaiKhoan(r),
        conLai: amt > 0 && r.status !== "paid" && conLai > 0 ? conLai : undefined,
        dauKy, thu: 0,
      })
    }
    const traSan = tron(so(r.paid) - (daTraTheoKhoan.get(r.id) ?? 0))
    if (Math.abs(traSan) >= 0.5) {
      viec.push({
        id: `san-${r.id}`, loai: "tra-san", luc: r.created_at, ma: r.ma, href: `/payables/${r.id}`,
        dienGiai: "Đã thanh toán — không có phiếu chi", tang: Math.max(-traSan, 0), giam: Math.max(traSan, 0),
        trangThai: { nhan: "Đã thanh toán", tone: "success" }, dauKy, thu: 1,
      })
    }
  }

  const tenPhieu = new Map(phieuChi.map((p) => [p.id, p]))
  const theoPhieu = new Map<string, { tien: number; truoc: number; luc: string; method: string | null }>()
  for (const t of traTien) {
    const tien = so(t.amount)
    if (t.supplier_payment_id) {
      const g = theoPhieu.get(t.supplier_payment_id) ?? { tien: 0, truoc: 0, luc: t.paid_at ?? "", method: t.method }
      g.tien += tien
      if (khoan.get(t.payable_id)?.loai === "tra-truoc") g.truoc += tien
      if (t.paid_at && (!g.luc || moc(t.paid_at) < moc(g.luc))) g.luc = t.paid_at
      theoPhieu.set(t.supplier_payment_id, g)
      continue
    }
    const r = khoan.get(t.payable_id)
    viec.push({
      id: `tra-${t.id}`, loai: "tra-tien", luc: t.paid_at ?? "", ma: r?.ma ?? "Trả tiền NCC", href: `/payables/${t.payable_id}`,
      dienGiai: `Trả tiền NCC${hinhThuc(t.method)}`, tang: Math.max(-tien, 0), giam: Math.max(tien, 0),
      trangThai: { nhan: "Đã chi", tone: "success" }, dauKy: false, thu: 2,
    })
  }
  theoPhieu.forEach((g, spId) => {
    const p = tenPhieu.get(spId)
    const truoc = tron(g.truoc)
    viec.push({
      id: `pc-${spId}`, loai: "phieu-chi", luc: g.luc, ma: p?.code ?? "Phiếu chi trả NCC", href: `/finance/phieu-chi-ncc/${spId}`,
      dienGiai: `Phiếu chi trả NCC${hinhThuc(p?.method ?? g.method)}`, tang: Math.max(-g.tien, 0), giam: Math.max(g.tien, 0),
      trangThai: { nhan: truoc > 0 ? `Đã chi · trả trước ${formatCurrency(truoc)}` : "Đã chi", tone: "success" },
      dauKy: false, thu: 2,
    })
  })

  viec.sort((a, b) =>
    Number(b.dauKy) - Number(a.dauKy) || moc(a.luc) - moc(b.luc) || a.thu - b.thu || a.id.localeCompare(b.id)
  )
  let duNo = 0
  const dong: DongSoChiTietNcc[] = viec.map((v) => {
    duNo = tron(duNo + v.tang - v.giam)
    return {
      id: v.id, loai: v.loai, luc: v.luc, ma: v.ma, href: v.href, dienGiai: v.dienGiai,
      tang: v.tang, giam: v.giam, duNo, trangThai: v.trangThai, conLai: v.conLai,
    }
  })
  return { dong: dong.reverse(), duNoCuoi: duNo }
}
