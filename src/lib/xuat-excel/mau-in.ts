/**
 * TỆP EXCEL "NHƯ MẪU IN" CỦA MỘT PHIẾU — chủ nhà 05/10/2026: "xuất excel như kiểu mẫu in hoá đơn ấy".
 *
 * Nút Xuất Excel ở trang chi tiết ra MỘT tờ giống tờ in: đầu công ty → tiêu đề, số, ngày → khối đối tác → bảng hàng
 * kẻ ô (STT · Tên hàng · ĐVT · SL · Đ.giá · CK · Thành tiền) → các dòng tổng nằm trong bảng → "Bằng chữ" → ngày →
 * ô ký. Hóa đơn / đơn hàng / phiếu trả khách tính y như tờ in (`SalesInvoice`, `ReturnSlip`); năm loại còn lại
 * (chưa có tờ in riêng) dựng theo cùng khuôn ấy.
 *
 * Ở đây chỉ có phần THUẦN (dữ liệu → ô); đọc sổ ở `./mot-phieu.ts`, ghi tệp ở `./xlsx-dinh-dang.ts`.
 * ⚠ Số là SỐ (âm là âm), không phải chuỗi "−250.000" — Excel còn cộng / lọc được.
 */
import { bangChuCoAm } from "@/lib/utils/number-to-vn-words"
import { dateVN, longDateVN, stampVN } from "@/lib/printing/doc-stamp"
import { grossUpLines, noteBlocksOf, type SalesInvoiceLine, type SalesInvoiceReturnLine } from "@/components/printing/sales-invoice"
import { soAm, type ReturnSlipLine } from "@/components/printing/return-slip"
import { netDueOnInvoice } from "@/lib/orders/invoice-credit"
import type { DoanChu, KieuO, OXlsx, SheetDinhDang } from "./xlsx-dinh-dang"

type Canh = "trai" | "giua" | "phai"

export interface CotMau {
  ten: string
  rong: number
  canh: Canh
}

/** Một ô của bảng hàng. `gop` = số cột ô này chiếm (mặc định 1). */
export interface OMau {
  v: string | number | null
  doan?: DoanChu[]
  gop?: number
  dam?: boolean
  nghieng?: boolean
  canh?: Canh
}

export interface DauCongTy {
  name?: string | null
  address?: string | null
  phone?: string | null
}

export interface MauIn {
  /** Tên sheet. */
  ten: string
  org: DauCongTy
  tieuDe: string
  /** Các dòng dưới tiêu đề (ngày, số…), căn giữa. */
  duoiTieuDe: Array<{ v: string; dam?: boolean }>
  /** Khối đối tác — mỗi phần tử một dòng. */
  thongTin: DoanChu[][]
  cot: CotMau[]
  dong: OMau[][]
  /** Chân trái (theo đơn…, cảnh báo huỷ, người lập). */
  chanTrai?: string | null
  /** "Ngày 05 tháng 10 năm 2026" — chân phải. */
  ngayDai: string
  ky: string[]
}

/** Chia `n` cột thành `k` nhóm gần đều nhau, phần dư dồn vào giữa (ô ký). */
export function chiaNhom(n: number, k: number): number[] {
  const kk = Math.max(1, Math.min(k, n))
  const out = Array<number>(kk).fill(Math.floor(n / kk))
  let du = n - out.reduce((s, x) => s + x, 0)
  if (du % 2 === 1) {
    out[Math.floor((kk - 1) / 2)] += 1
    du -= 1
  }
  for (let i = 0; du > 0; i++) {
    out[i % kk] += 1
    du -= 1
    if (du > 0) {
      out[kk - 1 - (i % kk)] += 1
      du -= 1
    }
  }
  return out
}

const nhan = (t: string, giaTri: string | null | undefined, dam = false): DoanChu[] => [
  { t: `${t}: ` },
  { t: giaTri || "", dam },
]

/** Dựng sheet có định dạng từ một mẫu in. */
export function dungMauIn(m: MauIn): SheetDinhDang {
  const n = m.cot.length
  const dong: SheetDinhDang["dong"] = []
  const gop: SheetDinhDang["gop"] = []
  const ca = (o: OXlsx, cao?: number) => {
    const r = dong.length
    dong.push({ o: [o], cao })
    if (n > 1) gop.push([r, 0, r, n - 1])
  }

  /* Đầu công ty — căn trái như mẫu. */
  ca({ v: (m.org.name || "—").toUpperCase(), k: { dam: true } })
  if (m.org.address) ca({ v: `Địa chỉ: ${m.org.address}` })
  if (m.org.phone) ca({ v: `Điện thoại: ${m.org.phone}` })
  dong.push({ o: [] })

  ca({ v: m.tieuDe, k: { dam: true, co: 16, canh: "giua" } }, 24)
  for (const d of m.duoiTieuDe) ca({ v: d.v, k: { dam: d.dam, canh: "giua" } })
  dong.push({ o: [] })

  for (const d of m.thongTin) ca({ v: null, doan: d, k: { xuong: true } })

  /* Bảng hàng kẻ ô. */
  dong.push({ o: m.cot.map((c) => ({ v: c.ten, k: { dam: true, canh: "giua", vien: true, xuong: true } })) })
  for (const hang of m.dong) {
    const r = dong.length
    const o: Array<OXlsx | null> = []
    let c = 0
    for (const x of hang) {
      const rong = Math.max(1, x.gop ?? 1)
      const k: KieuO = {
        vien: true,
        dam: x.dam,
        nghieng: x.nghieng,
        canh: x.canh ?? (rong > 1 ? "trai" : m.cot[c]?.canh),
        so: typeof x.v === "number",
        xuong: true,
      }
      o[c] = { v: x.v, doan: x.doan, k }
      if (rong > 1) gop.push([r, c, r, c + rong - 1])
      c += rong
    }
    /* Ô thiếu ở cuối dòng vẫn kẻ ô — bảng không bị hở. */
    for (; c < n; c++) o[c] = { v: null, k: { vien: true } }
    dong.push({ o })
  }
  dong.push({ o: [] })

  /* Chân: trái = ghi chú cuối tờ, phải = ngày dài. */
  const trai = Math.max(1, Math.floor(n / 2))
  const rChan = dong.length
  dong.push({
    o: [
      { v: m.chanTrai || "", k: { xuong: true } },
      ...Array<null>(trai - 1).fill(null),
      { v: m.ngayDai, k: { canh: "phai", nghieng: true } },
    ],
  })
  if (trai > 1) gop.push([rChan, 0, rChan, trai - 1])
  if (n - trai > 1) gop.push([rChan, trai, rChan, n - 1])

  /* Ô ký. */
  const nhom = chiaNhom(n, m.ky.length)
  const rKy = dong.length
  const hangKy: Array<OXlsx | null> = []
  const hangGhi: Array<OXlsx | null> = []
  let c0 = 0
  nhom.forEach((w, i) => {
    hangKy[c0] = { v: m.ky[i] ?? "", k: { dam: true, canh: "giua" } }
    hangGhi[c0] = { v: "(Ký, họ tên)", k: { nghieng: true, canh: "giua" } }
    if (w > 1) {
      gop.push([rKy, c0, rKy, c0 + w - 1])
      gop.push([rKy + 1, c0, rKy + 1, c0 + w - 1])
    }
    c0 += w
  })
  dong.push({ o: hangKy }, { o: hangGhi })
  /* Chừa chỗ ký thật. */
  for (let i = 0; i < 4; i++) dong.push({ o: [] })

  const sh: SheetDinhDang = { ten: m.ten, rong: m.cot.map((c) => c.rong), dong, gop, kho: "A5" }
  datCaoDong(sh)
  return sh
}

/** Số dòng chữ một ô cần ở bề rộng `rong` ký tự (xuống dòng tay + tràn). */
export function soDongChu(text: string, rong: number): number {
  const w = Math.max(1, rong * 1.15)
  return text.split("\n").reduce((s, doan) => s + Math.max(1, Math.ceil(doan.length / w)), 0)
}

/**
 * ⚠ Excel KHÔNG tự giãn dòng có ô gộp, và nhiều bản không giãn khi mở tệp — địa chỉ dài / tên hàng hai dòng bị
 *   cắt. Ước số dòng chữ theo bề rộng cột rồi ghi chiều cao dòng.
 */
function datCaoDong(sh: SheetDinhDang) {
  const rongGop = new Map<string, number>()
  for (const [r1, c1, , c2] of sh.gop) {
    let w = 0
    for (let c = c1; c <= c2; c++) w += sh.rong[c] ?? 8
    rongGop.set(`${r1}:${c1}`, w)
  }
  sh.dong.forEach((d, r) => {
    if (d.cao) return
    let nhieu = 1
    d.o.forEach((o, c) => {
      if (!o) return
      const text = o.doan ? o.doan.map((x) => x.t).join("") : o.v == null ? "" : String(o.v)
      if (!text) return
      const w = rongGop.get(`${r}:${c}`) ?? sh.rong[c] ?? 8
      nhieu = Math.max(nhieu, soDongChu(text, w))
    })
    if (nhieu > 1) d.cao = 15 * nhieu
  })
}

/* ============================================================== KHUÔN BÁN HÀNG (hóa đơn / đơn hàng) */

const COT_BAN: CotMau[] = [
  { ten: "STT", rong: 5, canh: "giua" },
  { ten: "Tên hàng và quy cách", rong: 36, canh: "trai" },
  { ten: "ĐVT", rong: 8, canh: "giua" },
  { ten: "SL", rong: 7, canh: "giua" },
  { ten: "Đ.giá", rong: 12, canh: "phai" },
  { ten: "CK", rong: 9, canh: "phai" },
  { ten: "Thành tiền", rong: 14, canh: "phai" },
]

/** Tên hàng + "(mã)" + dòng ghi chú nghiêng — như ô tên hàng của tờ in. */
function oTenHang(ten: string, ma?: string | null, phu?: string | null, tienTo?: string): OMau {
  const doan: DoanChu[] = []
  if (tienTo) doan.push({ t: tienTo, dam: true })
  doan.push({ t: `${ten}${ma ? ` (${ma})` : ""}` })
  if (phu) doan.push({ t: `\n${phu}`, nghieng: true })
  return { v: null, doan }
}

export interface MauBanHang {
  ten: string
  org: DauCongTy
  tieuDe: string
  nhanSo: string
  so: string
  ngay: Date | null
  coGio?: boolean
  khach: string
  diaChi?: string | null
  lienHe?: string | null
  nhanVien?: string | null
  dtNhanVien?: string | null
  lines: SalesInvoiceLine[]
  total: number
  giamDon?: number
  traHang?: number
  dongTra?: SalesInvoiceReturnLine[]
  ghiChu?: { label: string; text: string | null | undefined }[]
  chanTrai?: string | null
}

/** Y như `SalesInvoice` (components/printing/sales-invoice.tsx): cùng `grossUpLines`, cùng ba dòng tổng. */
export function mauBanHang(p: MauBanHang): MauIn {
  const ck = Math.max(0, Math.round(Number(p.giamDon) || 0))
  const tra = Number(p.traHang) || 0
  const { rows, goodsTotal } = grossUpLines(p.lines, p.total, ck)
  const sl = p.lines.reduce((s, l) => s + Number(l.quantity || 0), 0)
  const conPhaiThu = netDueOnInvoice(p.total, tra)
  const dong: OMau[][] = []
  if (p.lines.length === 0) dong.push([{ v: "Hoá đơn chưa có dòng hàng nào.", gop: 7, canh: "giua" }])
  rows.forEach((l, i) =>
    dong.push([
      { v: i + 1 },
      oTenHang(l.name, l.spec, l.note ? `Ghi chú: ${l.note}` : null),
      { v: l.unitName },
      { v: l.quantity },
      { v: Math.round(l.price) },
      { v: l.ck },
      { v: l.amount },
    ])
  )
  ;(p.dongTra ?? []).forEach((l, i) =>
    dong.push([
      { v: rows.length + i + 1 },
      oTenHang(l.name, null, null, l.isExchange ? "(Hàng đổi) " : "(Hàng trả) "),
      { v: l.unitName },
      { v: l.quantity },
      { v: l.unitPrice },
      { v: null },
      /* Hàng đổi ghi chữ "không trừ", không ghi 0 (như tờ in). */
      { v: l.isExchange ? "không trừ" : -Math.round(l.credit) },
    ])
  )
  dong.push([{ v: "Tổng tiền hàng", gop: 3, canh: "giua", dam: true }, { v: sl, dam: true }, { v: null }, { v: null }, { v: goodsTotal, dam: true }])
  dong.push([{ v: "Chiết khấu hóa đơn ( )", gop: 3, canh: "giua", dam: true }, { v: null }, { v: null }, { v: null }, { v: ck > 0 ? -ck : 0, dam: true }])
  dong.push([{ v: "Tổng cộng", gop: 3, canh: "giua", dam: true }, { v: null }, { v: null }, { v: null }, { v: Math.round(p.total), dam: true }])
  if (tra > 0) {
    dong.push([{ v: "Trừ hàng trả", gop: 6, canh: "giua" }, { v: -Math.round(tra) }])
    dong.push([{ v: "Còn phải thu", gop: 6, canh: "giua", dam: true }, { v: Math.round(conPhaiThu), dam: true }])
  }
  for (const g of noteBlocksOf(p.ghiChu ?? [])) dong.push([{ v: null, doan: [{ t: `${g.label}: `, dam: true }, { t: g.text }], gop: 7 }])
  dong.push([{ v: null, gop: 7 }])
  /* Bằng chữ đọc SỐ PHẢI TRẢ (âm đọc "Âm …"). */
  dong.push([{ v: null, doan: [{ t: "Bằng chữ: ", dam: true }, { t: bangChuCoAm(Math.round(conPhaiThu)), nghieng: true }], gop: 7 }])
  return {
    ten: p.ten,
    org: p.org,
    tieuDe: p.tieuDe,
    duoiTieuDe: [
      { v: `Ngày ${p.coGio === false ? dateVN(p.ngay) : stampVN(p.ngay)}`, dam: true },
      { v: `${p.nhanSo}: ${p.so || "—"}` },
    ],
    thongTin: [
      nhan("Khách hàng", p.khach || "—", true),
      nhan("Địa chỉ", p.diaChi),
      nhan("Liên hệ", p.lienHe),
      nhan("Nhân Viên Bán Hàng", `${p.nhanVien || ""}${p.dtNhanVien ? ` - ${p.dtNhanVien}` : ""}`),
    ],
    cot: COT_BAN,
    dong,
    chanTrai: p.chanTrai,
    ngayDai: longDateVN(p.ngay),
    ky: ["Người nhận hàng", "Kế toán", "Người bán"],
  }
}

/* ============================================================== PHIẾU TRẢ HÀNG CỦA KHÁCH */

export interface MauTraKhach {
  org: DauCongTy
  ma?: string | null
  ngay: Date | null
  coGio: boolean
  theo?: string | null
  khach: string
  diaChi?: string | null
  lienHe?: string | null
  nhanVien?: string | null
  nguoiLap?: string | null
  lyDo?: string | null
  tra: ReturnSlipLine[]
  doi: ReturnSlipLine[]
  credit: number
  ghiChu?: string | null
  huy?: boolean
}

/** Y như `ReturnSlip` (components/printing/return-slip.tsx). */
export function mauTraKhach(p: MauTraKhach): MauIn {
  const credit = Math.max(0, Math.round(Number(p.credit) || 0))
  const sl = p.tra.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const dongHang = (l: ReturnSlipLine, i: number, doi: boolean): OMau[] => [
    { v: i + 1 },
    oTenHang(l.name, l.sku, [l.reason, l.note].filter(Boolean).join(" · ") || null),
    { v: l.unitName },
    { v: l.quantity },
    { v: doi ? null : l.unitPrice },
    { v: doi ? "không trừ" : soAm(l.lineTotal) },
  ]
  const dong: OMau[][] = []
  if (p.tra.length === 0) dong.push([{ v: "Không có hàng trả lại.", gop: 6, canh: "giua" }])
  p.tra.forEach((l, i) => dong.push(dongHang(l, i, false)))
  dong.push([{ v: "Tổng trừ công nợ", gop: 3, canh: "giua", dam: true }, { v: sl, dam: true }, { v: null }, { v: soAm(credit), dam: true }])
  if (p.doi.length > 0) {
    dong.push([{ v: "Hàng đổi giao cho khách", gop: 6, dam: true }])
    p.doi.forEach((l, i) => dong.push(dongHang(l, p.tra.length + i, true)))
  }
  if (p.ghiChu?.trim()) dong.push([{ v: null, doan: [{ t: "Ghi chú: ", dam: true }, { t: p.ghiChu.trim() }], gop: 6 }])
  dong.push([{ v: null, doan: [{ t: "Bằng chữ: ", dam: true }, { t: bangChuCoAm(soAm(credit)), nghieng: true }], gop: 6 }])
  const tt: DoanChu[][] = [
    nhan("Khách hàng", p.khach || "—", true),
    nhan("Địa chỉ", p.diaChi),
    nhan("Liên hệ", p.lienHe),
    nhan("Nhân Viên Bán Hàng", p.nhanVien),
  ]
  if (p.lyDo) tt.push(nhan("Lý do trả", p.lyDo))
  const duoi: MauIn["duoiTieuDe"] = []
  if (p.ma) duoi.push({ v: `Số: ${p.ma}`, dam: true })
  duoi.push({ v: `Ngày ${p.coGio ? stampVN(p.ngay) : dateVN(p.ngay)}`, dam: true })
  if (p.theo) duoi.push({ v: `Theo ${p.theo}` })
  return {
    ten: p.ma || "Phiếu trả",
    org: p.org,
    tieuDe: "PHIẾU TRẢ HÀNG",
    duoiTieuDe: duoi,
    thongTin: tt,
    cot: [
      { ten: "STT", rong: 5, canh: "giua" },
      { ten: "Tên hàng trả lại", rong: 40, canh: "trai" },
      { ten: "ĐVT", rong: 8, canh: "giua" },
      { ten: "SL", rong: 7, canh: "giua" },
      { ten: "Đ.giá", rong: 12, canh: "phai" },
      { ten: "Thành tiền", rong: 14, canh: "phai" },
    ],
    dong,
    chanTrai: p.huy ? "⚠ PHIẾU ĐÃ HUỶ — không có giá trị." : p.nguoiLap ? `Người lập: ${p.nguoiLap}` : "",
    ngayDai: longDateVN(p.ngay),
    ky: ["Khách hàng", "Thủ kho", "Người lập phiếu"],
  }
}

/* ============================================================== PHIẾU NHẬP / TRẢ NHÀ CUNG CẤP */

export interface DongHangNcc {
  ten: string
  ma?: string | null
  dvt: string
  sl: number
  gia: number
  ck: number
  thanhTien: number
  ghiChu?: string | null
}

export interface MauNcc {
  loai: "nhap" | "tra"
  org: DauCongTy
  ma: string
  ngay: Date | null
  ncc: string
  maNcc?: string | null
  soHdNcc?: string | null
  kho?: string | null
  lyDo?: string | null
  dong: DongHangNcc[]
  tienHang: number
  vat: number
  giam: number
  tong: number
  ghiChu?: string | null
  nguoiLap?: string | null
  huy?: boolean
}

/** Phiếu nhập hàng / phiếu trả NCC — cùng khuôn bảy cột với hóa đơn bán; dòng tổng theo đầu phiếu. */
export function mauNcc(p: MauNcc): MauIn {
  const nhap = p.loai === "nhap"
  const dong: OMau[][] = []
  if (p.dong.length === 0) dong.push([{ v: "Phiếu chưa có dòng hàng nào.", gop: 7, canh: "giua" }])
  p.dong.forEach((l, i) =>
    dong.push([
      { v: i + 1 },
      oTenHang(l.ten, l.ma, l.ghiChu ? `Ghi chú: ${l.ghiChu}` : null),
      { v: l.dvt },
      { v: l.sl },
      { v: Math.round(l.gia) },
      { v: Math.round(l.ck) },
      { v: Math.round(l.thanhTien) },
    ])
  )
  const tong = (t: string, v: number, dam = false): OMau[] => [{ v: t, gop: 6, canh: "giua", dam }, { v: Math.round(v), dam }]
  dong.push(tong("Tiền hàng (chưa VAT)", p.tienHang, true))
  dong.push(tong("Thuế VAT", p.vat))
  dong.push(tong("Giảm giá", p.giam > 0 ? -p.giam : 0))
  dong.push(tong(nhap ? "Cần trả nhà cung cấp" : "Tổng tiền (giảm công nợ NCC)", p.tong, true))
  if (p.ghiChu?.trim()) dong.push([{ v: null, doan: [{ t: "Ghi chú: ", dam: true }, { t: p.ghiChu.trim() }], gop: 7 }])
  dong.push([{ v: null, doan: [{ t: "Bằng chữ: ", dam: true }, { t: bangChuCoAm(Math.round(p.tong)), nghieng: true }], gop: 7 }])
  const tt: DoanChu[][] = [nhan("Nhà cung cấp", `${p.ncc || "—"}${p.maNcc ? ` (${p.maNcc})` : ""}`, true)]
  if (nhap) tt.push(nhan("Số HĐ NCC", p.soHdNcc))
  tt.push(nhan(nhap ? "Nhập vào kho" : "Xuất từ kho", p.kho))
  if (!nhap) tt.push(nhan("Lý do trả", p.lyDo))
  return {
    ten: p.ma || (nhap ? "Phiếu nhập" : "Phiếu trả NCC"),
    org: p.org,
    tieuDe: nhap ? "PHIẾU NHẬP HÀNG" : "PHIẾU TRẢ HÀNG NHÀ CUNG CẤP",
    duoiTieuDe: [{ v: `Ngày ${dateVN(p.ngay)}`, dam: true }, { v: `Số phiếu: ${p.ma || "—"}` }],
    thongTin: tt,
    cot: COT_BAN,
    dong,
    chanTrai: p.huy ? "⚠ PHIẾU ĐÃ HUỶ — không có giá trị." : p.nguoiLap ? `Người lập: ${p.nguoiLap}` : "",
    ngayDai: longDateVN(p.ngay),
    ky: nhap ? ["Người giao hàng", "Thủ kho", "Người lập phiếu"] : ["Nhà cung cấp", "Thủ kho", "Người lập phiếu"],
  }
}

/* ============================================================== PHIẾU KHO */

export interface DongHangKho {
  ten: string
  ma?: string | null
  dvt: string
  sl: number
  lo?: string | null
  han?: string | null
  /** Giá trị dòng (SL cơ sở × giá vốn) — chỉ khi xem được giá vốn. */
  giaTri?: number | null
  ghiChu?: string | null
}

export interface MauKho {
  org: DauCongTy
  ma: string
  loai: string
  ngay: Date | null
  kho?: string | null
  khoDich?: string | null
  lyDo?: string | null
  trangThai?: string | null
  dong: DongHangKho[]
  giaVon: boolean
  ghiChu?: string | null
  nguoiLap?: string | null
  huy?: boolean
}

export function mauKho(p: MauKho): MauIn {
  const cot: CotMau[] = [
    { ten: "STT", rong: 5, canh: "giua" },
    { ten: "Tên hàng và quy cách", rong: 34, canh: "trai" },
    { ten: "ĐVT", rong: 8, canh: "giua" },
    { ten: "SL", rong: 7, canh: "giua" },
    { ten: "Số lô / HSD", rong: 16, canh: "giua" },
  ]
  /* Giá vốn chỉ cho người xem được giá vốn (`xemDuocGiaVon`). */
  if (p.giaVon) cot.push({ ten: "Đ.giá", rong: 12, canh: "phai" }, { ten: "Thành tiền", rong: 14, canh: "phai" })
  const n = cot.length
  const dong: OMau[][] = []
  if (p.dong.length === 0) dong.push([{ v: "Phiếu chưa có chi tiết sản phẩm.", gop: n, canh: "giua" }])
  p.dong.forEach((l, i) => {
    const hang: OMau[] = [
      { v: i + 1 },
      oTenHang(l.ten, l.ma, l.ghiChu ? `Ghi chú: ${l.ghiChu}` : null),
      { v: l.dvt },
      { v: l.sl },
      { v: [l.lo, l.han].filter(Boolean).join(" · ") || null },
    ]
    if (p.giaVon) {
      const gt = Math.round(Number(l.giaTri) || 0)
      hang.push({ v: l.sl > 0 ? Math.round(gt / l.sl) : 0 }, { v: gt })
    }
    dong.push(hang)
  })
  if (p.giaVon) {
    const tong = Math.round(p.dong.reduce((s, l) => s + (Number(l.giaTri) || 0), 0))
    dong.push([{ v: "Tổng giá trị", gop: n - 1, canh: "giua", dam: true }, { v: tong, dam: true }])
    if (p.ghiChu?.trim()) dong.push([{ v: null, doan: [{ t: "Ghi chú: ", dam: true }, { t: p.ghiChu.trim() }], gop: n }])
    dong.push([{ v: null, doan: [{ t: "Bằng chữ: ", dam: true }, { t: bangChuCoAm(tong), nghieng: true }], gop: n }])
  } else {
    /* ⚠ KHÔNG CỘNG SL các dòng khác đơn vị (CLAUDE.md) — chỉ đếm số dòng hàng. */
    dong.push([{ v: `Tổng: ${p.dong.length} dòng hàng`, gop: n, canh: "giua", dam: true }])
    if (p.ghiChu?.trim()) dong.push([{ v: null, doan: [{ t: "Ghi chú: ", dam: true }, { t: p.ghiChu.trim() }], gop: n }])
  }
  const tt: DoanChu[][] = [nhan("Loại phiếu", p.loai, true), nhan("Kho", p.kho)]
  if (p.khoDich) tt.push(nhan("Kho đích", p.khoDich))
  if (p.lyDo) tt.push(nhan("Lý do", p.lyDo))
  if (p.trangThai) tt.push(nhan("Trạng thái", p.trangThai))
  return {
    ten: p.ma || "Phiếu kho",
    org: p.org,
    tieuDe: `PHIẾU ${p.loai.toUpperCase()}`,
    duoiTieuDe: [{ v: `Ngày ${dateVN(p.ngay)}`, dam: true }, { v: `Số phiếu: ${p.ma || "—"}` }],
    thongTin: tt,
    cot,
    dong,
    chanTrai: p.huy ? "⚠ PHIẾU ĐÃ HUỶ — không có giá trị." : p.nguoiLap ? `Người lập: ${p.nguoiLap}` : "",
    ngayDai: longDateVN(p.ngay),
    ky: ["Người giao", "Thủ kho", "Người lập phiếu"],
  }
}

/* ============================================================== PHIẾU THU / PHIẾU CHI */

export interface DongTien {
  noiDung: string
  ngay?: string | null
  doiTac?: string | null
  soTien: number
}

export interface MauTien {
  loai: "thu" | "chi"
  org: DauCongTy
  ma?: string | null
  ngay: Date | null
  thongTin: Array<[string, string | null | undefined, boolean?]>
  dong: DongTien[]
  /** Số tiền của phiếu (đầu phiếu) — dòng "Tổng cộng" và "Bằng chữ". */
  tong: number
  /** Dòng tổng phụ (Đã nộp…) sau Tổng cộng. */
  tongPhu?: Array<[string, number]>
  ghiChu?: string | null
  nguoiLap?: string | null
  huy?: boolean
}

export function mauTien(p: MauTien): MauIn {
  const thu = p.loai === "thu"
  const cot: CotMau[] = [
    { ten: "STT", rong: 5, canh: "giua" },
    { ten: thu ? "Nội dung thu" : "Nội dung chi", rong: 34, canh: "trai" },
    { ten: thu ? "Ngày HĐ" : "Danh mục", rong: 14, canh: "giua" },
    { ten: thu ? "Khách hàng" : "Hình thức", rong: 22, canh: "trai" },
    { ten: "Số tiền", rong: 15, canh: "phai" },
  ]
  const dong: OMau[][] = []
  if (p.dong.length === 0) dong.push([{ v: "Phiếu chưa có dòng nào.", gop: 5, canh: "giua" }])
  p.dong.forEach((l, i) =>
    dong.push([{ v: i + 1 }, { v: l.noiDung }, { v: l.ngay ?? null }, { v: l.doiTac ?? null }, { v: Math.round(l.soTien) }])
  )
  dong.push([{ v: "Tổng cộng", gop: 4, canh: "giua", dam: true }, { v: Math.round(p.tong), dam: true }])
  for (const [t, v] of p.tongPhu ?? []) dong.push([{ v: t, gop: 4, canh: "giua" }, { v: Math.round(v) }])
  if (p.ghiChu?.trim()) dong.push([{ v: null, doan: [{ t: "Ghi chú: ", dam: true }, { t: p.ghiChu.trim() }], gop: 5 }])
  dong.push([{ v: null, doan: [{ t: "Bằng chữ: ", dam: true }, { t: bangChuCoAm(Math.round(p.tong)), nghieng: true }], gop: 5 }])
  const duoi: MauIn["duoiTieuDe"] = []
  if (p.ma) duoi.push({ v: `Số: ${p.ma}`, dam: true })
  duoi.push({ v: `Ngày ${dateVN(p.ngay)}`, dam: true })
  return {
    ten: p.ma || (thu ? "Phiếu thu" : "Phiếu chi"),
    org: p.org,
    tieuDe: thu ? "PHIẾU THU" : "PHIẾU CHI",
    duoiTieuDe: duoi,
    thongTin: p.thongTin.map(([t, v, dam]) => nhan(t, v, !!dam)),
    cot,
    dong,
    chanTrai: p.huy ? "⚠ PHIẾU ĐÃ HUỶ — không có giá trị." : p.nguoiLap ? `Người lập: ${p.nguoiLap}` : "",
    ngayDai: longDateVN(p.ngay),
    ky: thu ? ["Người nộp tiền", "Người thu tiền", "Kế toán"] : ["Người nhận tiền", "Kế toán", "Người lập phiếu"],
  }
}
