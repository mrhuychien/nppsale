/**
 * CỘNG DỒN của Báo cáo tổng hợp — một khuôn cho mọi màn.
 *
 * Số bán được nạp về thành các DÒNG BÁN (`DongBan`): mỗi dòng hoá đơn đã ghi sổ là một dòng
 * dương, mỗi dòng hàng trả là một dòng âm. Mọi chiều (mặt hàng, khách, nhân viên, kênh…) và
 * mọi kỳ đều cộng từ đúng một bộ dòng này, nên:
 *   Σ theo mặt hàng = Σ theo khách = Σ theo ngày = doanh thu thuần của kỳ.
 *
 * ⚠ TIỀN CỦA DÒNG ĐÃ PHÂN BỔ theo tỉ lệ để Σ dòng của một hoá đơn = `sales_invoices.total`
 *   (doanh thu tính theo HOÁ ĐƠN — chủ nhà 24/09/2026), và Σ dòng của một phiếu trả =
 *   `credit_note_amount` (hàng đổi không tính). Xem `nap-ban-hang.ts`.
 */

import { congSL, type SLTheoDonVi } from "@/lib/analytics/sl-theo-don-vi"

/** Một dòng bán (+) hoặc dòng trả (−). */
export interface DongBan {
  /** Ngày trừ / ghi doanh số — YYYY-MM-DD lịch VN. */
  ngay: string
  /** 1 = bán theo hoá đơn · −1 = hàng trả. */
  loai: 1 | -1
  /** id hoá đơn (bán) hoặc id phiếu trả (trả). */
  ct: string
  /** Hoá đơn của dòng bán (để đếm số HĐ) — rỗng ở dòng trả. */
  hd: string
  kh: string
  nv: string
  /** id mặt hàng; rỗng = phiếu trả không có dòng hàng. */
  sp: string
  /** Tiền dương (dòng trả cũng dương; dấu nằm ở `loai`). */
  tien: number
  /** Giá vốn dương: hàng xuất (bán) hoặc hàng trả đã nhập lại kho (trả). */
  giaVon: number
  /** Số lượng đơn vị cơ sở, dương. */
  sl: number
  /** Giá trị niêm yết của dòng bán (SL dòng × giá niêm yết của đơn vị dòng) — như báo cáo cũ. */
  niemYet?: number
  /** Dòng bán của mặt hàng CHƯA CÓ GIÁ VỐN trong kỳ (giá vốn đang tính = 0 → lãi gộp phồng). */
  thieuGV?: true
}

/** Một dòng đơn đặt (không huỷ) — số HOẠT ĐỘNG, không phải doanh thu. */
export interface DongDat {
  ngay: string
  don: string
  kh: string
  nv: string
  sp: string
  tien: number
  /** Phần tiền của dòng đã xuất hoá đơn (theo SL đã xuất). */
  daXuat: number
  trangThai: string
  nguoiTao: string
}

export interface KhachBC {
  ten: string
  nhom: string
  kenh: string
  tinh: string
  /** Nhân viên phụ trách. */
  nv: string
  hanMuc: number
  /** Số ngày được nợ (NETxx), 0 = COD. */
  hanNo: number
}

export interface SanPhamBC {
  ten: string
  sku: string
  nhom: string
  thuongHieu: string
  ncc: string
  donViCoSo: string
  /** Đơn vị lớn nhất (thùng…) để hiện `4 thùng (96 hộp)`. */
  donViLon: { ten: string; heSo: number } | null
  /** Mọi đơn vị quy đổi (để quy dòng không có hệ số chụp về đơn vị cơ sở). */
  donVi?: { ten: string; heSo: number }[]
  /** Giá bán lẻ (đơn vị cơ sở) + bảng giá CHUNG theo đơn vị — để tính giá trị niêm yết. */
  giaBan?: number
  bangGia?: { ten: string; gia: number }[]
}

/** Danh mục để dịch id → tên và tra chiều của khách / mặt hàng. */
export interface DanhMucBC {
  khach: Map<string, KhachBC>
  sp: Map<string, SanPhamBC>
  nv: Map<string, string>
  nhomKhach: Map<string, string>
  kenh: Map<string, string>
  ncc: Map<string, string>
}

/**
 * Danh mục đưa vào hàm nạp số: có thể là LỜI HỨA — hàm nạp đọc mạng trước, chỉ đợi danh mục lúc
 * tính (chủ nhà 27/09/2026 "rà cách đọc dữ liệu cho nhanh hơn": danh mục và số chạy song song).
 */
export type DanhMucVao = DanhMucBC | PromiseLike<DanhMucBC>

export const danhMucRong = (): DanhMucBC => ({
  khach: new Map(),
  sp: new Map(),
  nv: new Map(),
  nhomKhach: new Map(),
  kenh: new Map(),
  ncc: new Map(),
})

// ---------------------------------------------------------------- lọc

/**
 * ⚠ Không có Thương hiệu / Nhóm khách / Tỉnh / Bảng giá — chủ nhà 27/09/2026 bỏ khỏi mọi báo cáo
 *   (cả lọc lẫn "Xem theo"). Đường dẫn cũ còn `l_brand`… thì bị bỏ qua khi đọc.
 */
export type LoaiLoc =
  | "cust" | "channel" | "staff"
  | "prod" | "pgroup" | "ncc"
  | "ostatus" | "creator" | "pay" | "dstatus"

export interface ThongTinLoc {
  label: string
  short?: string
  unit: string
}

export const LOAI_LOC: Record<LoaiLoc, ThongTinLoc> = {
  cust: { label: "Khách hàng", short: "Khách", unit: "khách" },
  channel: { label: "Kênh / tuyến", short: "Kênh", unit: "kênh" },
  staff: { label: "Nhân viên bán", short: "Nhân viên", unit: "NV" },
  prod: { label: "Mặt hàng", unit: "mặt hàng" },
  pgroup: { label: "Nhóm hàng", unit: "nhóm hàng" },
  ncc: { label: "Nhà cung cấp", short: "NCC", unit: "NCC" },
  ostatus: { label: "Trạng thái đơn", unit: "trạng thái" },
  creator: { label: "Người tạo", unit: "người" },
  pay: { label: "Hình thức thanh toán", short: "Thanh toán", unit: "hình thức" },
  dstatus: { label: "Tình trạng", unit: "tình trạng" },
}

export type BoLoc = Partial<Record<LoaiLoc, string[]>>

/** Giá trị cần so của một bản ghi ở loại lọc `k` — `undefined` = không áp được (bỏ qua). */
export interface CoChieu {
  kh?: string
  nv?: string
  sp?: string
  trangThai?: string
  nguoiTao?: string
  hinhThuc?: string
}

export const CHUA_CO = "(Chưa có)"

export function giaTriChieu(k: LoaiLoc, x: CoChieu, dm: DanhMucBC): string | undefined {
  switch (k) {
    case "cust": return x.kh
    case "staff": return x.nv
    case "prod": return x.sp
    case "channel": return x.kh === undefined ? undefined : dm.khach.get(x.kh)?.kenh || CHUA_CO
    case "pgroup": return x.sp === undefined ? undefined : dm.sp.get(x.sp)?.nhom || CHUA_CO
    case "ncc": return x.sp === undefined ? undefined : dm.sp.get(x.sp)?.ncc || CHUA_CO
    case "ostatus": return x.trangThai
    case "creator": return x.nguoiTao
    case "pay": return x.hinhThuc
    default: return undefined
  }
}

/** Bản ghi có qua bộ lọc không. Loại lọc không áp được cho bản ghi thì bỏ qua. */
export function quaLoc(x: CoChieu, loc: BoLoc, dm: DanhMucBC): boolean {
  for (const k of Object.keys(loc) as LoaiLoc[]) {
    const vs = loc[k]
    if (!vs || !vs.length) continue
    const v = giaTriChieu(k, x, dm)
    if (v === undefined) continue
    if (!vs.includes(v)) return false
  }
  return true
}

// ---------------------------------------------------------------- cộng bán

export interface TongBan {
  rev: number
  ret: number
  net: number
  cost: number
  gp: number
  nInv: number
  nCust: number
  avg: number
}

export function congBan(ls: readonly DongBan[]): TongBan {
  let rev = 0, ret = 0, cost = 0
  const hd = new Set<string>(), kh = new Set<string>()
  for (const l of ls) {
    if (l.loai > 0) {
      rev += l.tien
      cost += l.giaVon
      hd.add(l.hd)
      kh.add(l.kh)
    } else {
      ret += l.tien
      cost -= l.giaVon
    }
  }
  const net = rev - ret
  return { rev, ret, net, cost, gp: net - cost, nInv: hd.size, nCust: kh.size, avg: hd.size ? net / hd.size : 0 }
}

export interface NhomBan extends TongBan {
  k: string
  nProd: number
  /** SL cơ sở bán ra / trả về. ⚠ Cộng lẫn đơn vị khi nhóm nhiều mặt hàng — hiện `qtyDv`. */
  qty: number
  rqty: number
  /** SL theo từng đơn vị cơ sở ("640 hộp · 120 chai") — bán ra / trả về. */
  qtyDv: SLTheoDonVi
  rqtyDv: SLTheoDonVi
  /** Σ giá trị niêm yết của dòng bán; chênh lệch = rev − listed. */
  listed: number
  /** Ngày bán gần nhất. */
  last: string
}

export function gomBan(ls: readonly DongBan[], khoa: (l: DongBan) => string, dm?: DanhMucBC): Map<string, NhomBan> {
  const m = new Map<string, { k: string; ls: DongBan[] }>()
  for (const l of ls) {
    const k = khoa(l)
    let g = m.get(k)
    if (!g) m.set(k, (g = { k, ls: [] }))
    g.ls.push(l)
  }
  const out = new Map<string, NhomBan>()
  for (const { k, ls: gl } of Array.from(m.values())) {
    const t = congBan(gl)
    let qty = 0, rqty = 0, last = "", listed = 0
    const qtyDv: SLTheoDonVi = {}, rqtyDv: SLTheoDonVi = {}
    const sp = new Set<string>()
    for (const l of gl) {
      const dv = dm?.sp.get(l.sp)?.donViCoSo
      if (l.loai > 0) {
        qty += l.sl
        listed += l.niemYet || 0
        congSL(qtyDv, dv, l.sl)
        if (l.sp) sp.add(l.sp)
        if (l.ngay > last) last = l.ngay
      } else {
        rqty += l.sl
        congSL(rqtyDv, dv, l.sl)
      }
    }
    out.set(k, { ...t, k, nProd: sp.size, qty, rqty, last, qtyDv, rqtyDv, listed })
  }
  return out
}

export interface MaThieuGiaVon {
  sp: string
  sku: string
  ten: string
  /** Doanh thu (đã phân bổ) của mã trong các dòng đưa vào. */
  tien: number
  sl: number
}

/**
 * Mã hàng bán ra mà chưa có giá vốn (chủ nhà 27/09/2026: "một số mã hàng chưa có giá vốn, phần
 * Lãi gộp hãy chỉ ra các mã này"). Xếp theo doanh thu giảm dần — mã bán nhiều làm lệch lãi nhiều.
 */
export function maChuaCoGiaVon(ls: readonly DongBan[], dm: DanhMucBC): MaThieuGiaVon[] {
  const m = new Map<string, MaThieuGiaVon>()
  for (const l of ls) {
    if (l.loai < 0 || !l.thieuGV || !l.sp) continue
    let e = m.get(l.sp)
    if (!e) {
      const p = dm.sp.get(l.sp)
      m.set(l.sp, (e = { sp: l.sp, sku: p?.sku || "", ten: p?.ten || "Không rõ mặt hàng", tien: 0, sl: 0 }))
    }
    e.tien += l.tien
    e.sl += l.sl
  }
  return Array.from(m.values()).sort((a, b) => b.tien - a.tien)
}

// ---------------------------------------------------------------- cộng đơn đặt

export interface TongDat {
  n: number
  val: number
  done: number
  not: number
  rate: number
}

export function congDat(ls: readonly DongDat[]): TongDat {
  const d = new Set<string>()
  let val = 0, done = 0
  for (const l of ls) {
    d.add(l.don)
    val += l.tien
    done += l.daXuat
  }
  return { n: d.size, val, done, not: val - done, rate: val ? done / val : 0 }
}

export interface NhomDat extends TongDat {
  k: string
  nCust: number
}

export function gomDat(ls: readonly DongDat[], khoa: (l: DongDat) => string): Map<string, NhomDat> {
  const m = new Map<string, DongDat[]>()
  for (const l of ls) {
    const k = khoa(l)
    const a = m.get(k)
    if (a) a.push(l)
    else m.set(k, [l])
  }
  const out = new Map<string, NhomDat>()
  m.forEach((gl, k) => out.set(k, { ...congDat(gl), k, nCust: new Set(gl.map((l) => l.kh)).size }))
  return out
}

// ---------------------------------------------------------------- số lượng

/** `4 thùng 3 hộp` + dòng phụ `99 hộp` — không cộng lẫn thùng với hộp. */
export function hienSoLuong(sp: SanPhamBC | undefined, slCoSo: number): { t: string; sub: string } {
  const q = Math.round(slCoSo * 100) / 100
  const bu = sp?.donViCoSo || ""
  const coSo = `${new Intl.NumberFormat("vi-VN").format(q)}${bu ? " " + bu : ""}`
  const lon = sp?.donViLon
  if (!lon || lon.heSo <= 1 || Math.abs(q) < lon.heSo) return { t: coSo, sub: "" }
  const dau = Math.sign(q)
  const big = Math.floor(Math.abs(q) / lon.heSo)
  const rem = Math.round((Math.abs(q) - big * lon.heSo) * 100) / 100
  const nf = new Intl.NumberFormat("vi-VN")
  return {
    t: `${dau < 0 ? "-" : ""}${nf.format(big)} ${lon.ten}${rem ? ` ${nf.format(rem)} ${bu}` : ""}`,
    sub: coSo,
  }
}
