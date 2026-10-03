/**
 * XUẤT EXCEL CHI TIẾT DÒNG — chủ nhà 02/10/2026: "phần báo cáo xuất excel cần xuất chi tiết các dòng hơn để
 * xử lý thông tin. VD báo cáo bán hàng theo nhân viên -> chi tiết dòng hàng, bán cho ai, giá bao nhiêu...".
 *
 * File Excel = sheet "Tổng hợp" (đúng bảng đang thấy) + sheet "Chi tiết dòng": mỗi dòng hàng của MỌI chứng
 * từ đã qua bộ lọc của màn (kỳ, nhân viên, khách, mặt hàng…), để lọc / pivot trong Excel.
 *
 * Luật số (CLAUDE.md): dòng trả mang dấu ÂM (doanh số thuần = đi − trả); "DT thuần (phân bổ)" là phần của
 * dòng trong `sales_invoices.total` / `credit_note_amount` — Σ cột này = thẻ Doanh thu thuần. SL quy về đơn
 * vị cơ sở ở cột riêng (`DongBan.sl`); SL + đơn giá theo đơn vị của dòng ở cột "SL" / "Đơn giá".
 */
import type { DanhMucBC, DongBan, DongDat } from "./cong"
import type { HoaDonBC, PhieuTraBC } from "./nap-ban-hang"
import type { DonDatBC } from "./nap-don-dat"
import type { KhoanThu, PhieuChi } from "./nap-tien"
import type { NoKhach } from "./nap-cong-no"
import type { BienDong, LoaiBienDong, TonMatHang } from "./nap-kho"

export type O = string | number
export interface SheetXuat {
  ten: string
  rows: O[][]
}

const tron = (n: number) => Math.round(n)
const ten = (m: ReadonlyMap<string, string>, id: string, mac: string) => (id && m.get(id)) || mac

function cotKhach(dm: DanhMucBC, id: string): O[] {
  const k = dm.khach.get(id)
  return [k?.ten || "Khách đã xoá", k?.sdt || "", k?.diaChi || "", k?.kenh || ""]
}
/** Mã · Tên · NCC chính. ⚠ Cột thứ ba từng là "Nhóm hàng" (`products.category`) — chủ nhà 03/10/2026
 *  "Bỏ luôn trường nhóm hàng": hàng nhóm theo Nhà cung cấp. */
function cotHang(dm: DanhMucBC, id: string): O[] {
  const s = dm.sp.get(id)
  return [s?.sku || "", s?.ten || (id ? "Không rõ mặt hàng" : "(phiếu không có dòng hàng)"), s?.ncc ? ten(dm.ncc, s.ncc, "") : ""]
}

/** Sheet "Chi tiết dòng" của Bán hàng theo hoá đơn — bán (dương) + trả (âm). */
export function chiTietBan(p: {
  dong: readonly DongBan[]
  dm: DanhMucBC
  hoaDon: ReadonlyMap<string, HoaDonBC>
  phieuTra: readonly PhieuTraBC[]
  /** NVBH không xem giá vốn → không xuất cột giá vốn / lãi gộp. */
  giaVon: boolean
}): O[][] {
  const { dm } = p
  const tra = new Map(p.phieuTra.map((t) => [t.id, t]))
  const dau: O[] = [
    "Ngày", "Loại", "Số chứng từ", "Hoá đơn gốc", "Lý do trả", "Nhân viên", "Người lập",
    "Khách hàng", "SĐT", "Địa chỉ", "Tuyến",
    "Mã hàng", "Tên hàng", "Nhà cung cấp", "ĐVT", "SL", "Đơn giá", "Giá bảng", "Chênh lệch giá", "Giảm giá dòng",
    "Thành tiền dòng", "Giảm giá đơn", "SL quy đổi", "ĐV cơ sở", "DT thuần (phân bổ)",
    ...(p.giaVon ? ["Giá vốn", "Lãi gộp"] : []),
  ]
  const ds = [...p.dong].sort((a, b) => a.ngay.localeCompare(b.ngay) || a.ct.localeCompare(b.ct))
  const rows: O[][] = [dau]
  for (const l of ds) {
    const d = l.loai
    const h = d > 0 ? p.hoaDon.get(l.ct) : undefined
    const t = d < 0 ? tra.get(l.ct) : undefined
    const g = l.goc
    const sp = dm.sp.get(l.sp)
    const chenh = l.niemYet != null && l.tienTT != null ? l.tienTT - l.niemYet : ""
    rows.push([
      l.ngay,
      d > 0 ? "Bán" : "Trả",
      (h?.ma ?? t?.ma) || "",
      d < 0 ? (t?.hd && p.hoaDon.get(t.hd)?.ma) || "" : "",
      t?.lyDo || "",
      ten(dm.nv, l.nv, "Chưa gán nhân viên"),
      h ? ten(dm.nv, h.nguoiLap, "") : "",
      ...cotKhach(dm, l.kh),
      ...cotHang(dm, l.sp),
      g?.dv || "",
      g ? d * g.sl : "",
      g ? g.donGia : "",
      l.niemYet != null && g && g.sl ? tron(l.niemYet / g.sl) : "",
      chenh === "" ? "" : tron(d * chenh),
      g ? d * tron(g.giam) : "",
      g ? d * tron(g.thanhTien) : "",
      l.giamDon ? tron(l.giamDon) : "",
      d * l.sl,
      sp?.donViCoSo || "",
      d * tron(l.tien),
      ...(p.giaVon ? [d * tron(l.giaVon), d * tron(l.tien - l.giaVon)] : []),
    ])
  }
  return rows
}

/** Sheet "Chi tiết dòng" của Bán hàng theo đơn đặt (số hoạt động, không phải doanh thu). */
export function chiTietDat(p: { dong: readonly DongDat[]; dm: DanhMucBC; don: ReadonlyMap<string, DonDatBC> }): O[][] {
  const { dm } = p
  const rows: O[][] = [[
    "Ngày đặt", "Số đơn", "Trạng thái", "Nhân viên", "Người tạo", "Khách hàng", "SĐT", "Địa chỉ", "Tuyến",
    "Mã hàng", "Tên hàng", "Nhà cung cấp", "ĐVT", "SL", "Đơn giá", "Giảm giá dòng", "Thành tiền dòng",
    "Tiền (phân bổ)", "Đã xuất HĐ", "Chưa xuất",
  ]]
  const ds = [...p.dong].sort((a, b) => a.ngay.localeCompare(b.ngay) || a.don.localeCompare(b.don))
  for (const l of ds) {
    const g = l.goc
    rows.push([
      l.ngay,
      p.don.get(l.don)?.ma || "",
      l.trangThai,
      ten(dm.nv, l.nv, "Chưa gán nhân viên"),
      ten(dm.nv, l.nguoiTao, ""),
      ...cotKhach(dm, l.kh),
      ...cotHang(dm, l.sp),
      g?.dv || "",
      g ? g.sl : "",
      g ? g.donGia : "",
      g ? tron(g.giam) : "",
      g ? tron(g.thanhTien) : "",
      tron(l.tien),
      tron(l.daXuat),
      tron(l.tien - l.daXuat),
    ])
  }
  return rows
}

/** Sheet "Thu tiền": từng khoản thu (khách, hoá đơn, hình thức, người thu). */
export function chiTietThu(ds: readonly KhoanThu[], dm: DanhMucBC): O[][] {
  const rows: O[][] = [["Ngày", "Hình thức", "Số tiền", "Khách hàng", "SĐT", "Hoá đơn", "Nhân viên", "Người thu"]]
  for (const t of [...ds].sort((a, b) => a.ngay.localeCompare(b.ngay))) {
    const k = dm.khach.get(t.kh)
    rows.push([t.ngay, t.hinhThuc, tron(t.tien), k?.ten || "", k?.sdt || "", t.maHd || "", ten(dm.nv, t.nv, ""), ten(dm.nv, t.nguoiThu, "")])
  }
  return rows
}

/** Sheet "Chi": phiếu chi + trả NCC. */
export function chiTietChi(ds: readonly PhieuChi[]): O[][] {
  const rows: O[][] = [["Ngày", "Loại", "Số tham chiếu", "Nhóm / NCC", "Diễn giải", "Số tiền"]]
  for (const c of [...ds].sort((a, b) => a.ngay.localeCompare(b.ngay))) {
    rows.push([c.ngay, c.loai === "ncc" ? "Trả NCC" : "Chi phí", c.ma, c.nhom, c.dien, tron(c.tien)])
  }
  return rows
}

/** Sheet "Chi tiết phiếu nợ": từng khoản nợ còn lại của các khách đang xem (âm = dư có). */
export function chiTietNo(khach: readonly NoKhach[], dm: DanhMucBC): O[][] {
  const rows: O[][] = [[
    "Khách hàng", "SĐT", "Địa chỉ", "Tuyến", "Nhân viên", "Chứng từ", "Ngày", "Hạn thanh toán", "Còn phải thu",
    "Số ngày quá hạn", "Tình trạng",
  ]]
  for (const k of khach) {
    for (const p of [...k.phieu].sort((a, b) => a.ngay.localeCompare(b.ngay))) {
      rows.push([
        ...cotKhach(dm, k.kh),
        ten(dm.nv, p.nv, "Chưa gán nhân viên"),
        p.ma, p.ngay, p.han, tron(p.con),
        p.qua > 0 ? p.qua : 0,
        p.con < 0 ? "Dư có" : p.qua > 0 ? "Quá hạn" : "Trong hạn",
      ])
    }
  }
  return rows
}

const NHAN_BIEN_DONG: Record<LoaiBienDong, string> = { nhap: "Nhập", tra: "Trả về kho", ban: "Xuất bán", khac: "Khác" }

/** Sheet "Tồn theo lô": từng lô còn tồn của các mặt hàng đang xem (SL theo đơn vị cơ sở). */
export function chiTietTonLo(ton: readonly TonMatHang[], dm: DanhMucBC, giaVon: boolean): O[][] {
  const rows: O[][] = [[
    "Mã hàng", "Tên hàng", "Nhà cung cấp", "ĐV cơ sở", "Số lô", "Hạn dùng", "Ngày nhập", "Tồn",
    ...(giaVon ? ["Giá vốn / ĐV cơ sở", "Giá trị tồn"] : []),
  ]]
  for (const t of ton) {
    const s = dm.sp.get(t.sp)
    for (const l of t.lo) {
      rows.push([
        ...cotHang(dm, t.sp), s?.donViCoSo || "", l.ma, l.hsd || "", l.nhap, l.sl,
        ...(giaVon ? [tron(l.gia), tron(l.sl * l.gia)] : []),
      ])
    }
  }
  return rows
}

/** Sheet "Biến động kho": từng dòng phiếu kho trong kỳ (+ vào kho, − ra kho). */
export function chiTietBienDong(ds: readonly BienDong[], dm: DanhMucBC, a: string, b: string, giaVon: boolean): O[][] {
  const rows: O[][] = [["Ngày", "Loại", "Số phiếu", "Mã hàng", "Tên hàng", "Nhà cung cấp", "ĐV cơ sở", "SL", ...(giaVon ? ["Giá vốn", "Giá trị"] : [])]]
  for (const m of ds.filter((x) => x.ngay >= a && x.ngay <= b).sort((x, y) => x.ngay.localeCompare(y.ngay))) {
    rows.push([
      m.ngay, NHAN_BIEN_DONG[m.loai] || m.loai, m.ma, ...cotHang(dm, m.sp), dm.sp.get(m.sp)?.donViCoSo || "", m.sl,
      ...(giaVon ? [tron(m.gia), tron(m.sl * m.gia)] : []),
    ])
  }
  return rows
}
