/**
 * TRẠNG THÁI MÀN BÁO CÁO NẰM TRÊN ĐƯỜNG DẪN (spec mục 2.3: "Kỳ, lọc và chế độ xem nằm trên
 * đường dẫn. Gửi link cho người khác là họ thấy đúng như mình").
 *
 * - Đào sâu thêm một bước = `router.push` → nút Quay lại của trình duyệt lùi đúng một bước
 *   (spec mục 2.5). Đổi kỳ / lọc / chế độ xem = `replace`, không làm dài lịch sử.
 */
import { laMaKy, laNgay, type MaKy } from "./ky"
import { LOAI_LOC, type BoLoc, type LoaiLoc } from "./cong"

export type GiaTriBuoc = string | boolean | [string, string]

/** Một bước đào sâu: nhãn trên đường đào sâu, chế độ xem mới, lọc thêm. */
export interface BuocDao {
  l: string
  v: string
  f?: Record<string, GiaTriBuoc>
}

export interface TrangThaiBC {
  ky: MaKy
  ca: string | null
  cb: string | null
  soSanh: boolean
  loc: BoLoc
  xem: string
  nguon: "inv" | "ord"
  dao: BuocDao[]
  /** Ngày của màn Cuối ngày. */
  ngay: string | null
  /** "Tính đến ngày" của Công nợ / Tài sản. */
  den: string | null
  tab: string
  theoThang: boolean
}

export const TRANG_THAI_GOC: TrangThaiBC = {
  ky: "month",
  ca: null,
  cb: null,
  soSanh: true,
  loc: {},
  xem: "",
  nguon: "inv",
  dao: [],
  ngay: null,
  den: null,
  tab: "",
  theoThang: false,
}

const laBuoc = (x: unknown): x is BuocDao =>
  !!x && typeof x === "object" && typeof (x as BuocDao).l === "string" && typeof (x as BuocDao).v === "string"

export function docTrangThai(sp: URLSearchParams, macDinh: Partial<TrangThaiBC> = {}): TrangThaiBC {
  const g = { ...TRANG_THAI_GOC, ...macDinh }
  const ky = sp.get("ky")
  const loc: BoLoc = {}
  for (const k of Object.keys(LOAI_LOC) as LoaiLoc[]) {
    const v = sp.get("l_" + k)
    if (v) loc[k] = v.split(",").filter(Boolean)
  }
  let dao: BuocDao[] = []
  const d = sp.get("dao")
  if (d) {
    try {
      const x = JSON.parse(d)
      if (Array.isArray(x)) dao = x.filter(laBuoc)
    } catch {
      dao = []
    }
  }
  const nguon = sp.get("nguon")
  return {
    ky: laMaKy(ky) ? ky : g.ky,
    ca: laNgay(sp.get("ca")) ? sp.get("ca") : null,
    cb: laNgay(sp.get("cb")) ? sp.get("cb") : null,
    soSanh: sp.get("ss") === "0" ? false : g.soSanh,
    loc: Object.keys(loc).length ? loc : g.loc,
    xem: sp.get("xem") || g.xem,
    nguon: nguon === "ord" ? "ord" : nguon === "inv" ? "inv" : g.nguon,
    dao,
    ngay: laNgay(sp.get("ngay")) ? sp.get("ngay") : g.ngay,
    den: laNgay(sp.get("den")) ? sp.get("den") : g.den,
    tab: sp.get("tab") || g.tab,
    theoThang: sp.get("tt") === "1",
  }
}

/** Chỉ ghi những gì khác mặc định — đường dẫn ngắn. */
export function ghiTrangThai(st: TrangThaiBC, macDinh: Partial<TrangThaiBC> = {}): string {
  const g = { ...TRANG_THAI_GOC, ...macDinh }
  const p = new URLSearchParams()
  if (st.ky !== g.ky) p.set("ky", st.ky)
  if (st.ky === "custom") {
    if (st.ca) p.set("ca", st.ca)
    if (st.cb) p.set("cb", st.cb)
  }
  if (!st.soSanh) p.set("ss", "0")
  for (const k of Object.keys(st.loc) as LoaiLoc[]) {
    const v = st.loc[k]
    if (v && v.length) p.set("l_" + k, v.join(","))
  }
  if (st.xem && st.xem !== g.xem) p.set("xem", st.xem)
  if (st.nguon !== g.nguon) p.set("nguon", st.nguon)
  if (st.dao.length) p.set("dao", JSON.stringify(st.dao))
  if (st.ngay && st.ngay !== g.ngay) p.set("ngay", st.ngay)
  if (st.den && st.den !== g.den) p.set("den", st.den)
  if (st.tab && st.tab !== g.tab) p.set("tab", st.tab)
  if (st.theoThang) p.set("tt", "1")
  return p.toString()
}

export interface HieuLuc {
  /** Lọc sau khi gộp thanh lọc + các bước đào sâu (+ khoá nhân viên). */
  loc: BoLoc
  /** Khoảng ngày do bước đào sâu thời gian đặt — thay kỳ đang chọn. */
  khoang: [string, string] | null
  /** Cờ riêng của bước đào sâu (vd `pending`, `kind`). */
  co: Record<string, GiaTriBuoc>
  /** Chế độ xem đang hiện (bước cuối, hoặc chế độ gốc). */
  xem: string
}

/**
 * Gộp thanh lọc với các bước đào sâu. `khoaNV` (NVBH) ghi đè lọc nhân viên — không bỏ được.
 * ⚠ Mỗi bước đào sâu đặt MỘT giá trị cho loại lọc của nó, đè lên lựa chọn nhiều giá trị ở
 *   thanh lọc (bấm "Tạp hoá Cô Ba" trong danh sách khách là xem riêng Cô Ba).
 */
export function hieuLuc(st: TrangThaiBC, xemGoc: string, khoaNV?: string | null): HieuLuc {
  const loc: BoLoc = {}
  for (const k of Object.keys(st.loc) as LoaiLoc[]) if (st.loc[k]?.length) loc[k] = st.loc[k]!.slice()
  let khoang: [string, string] | null = null
  const co: Record<string, GiaTriBuoc> = {}
  for (const b of st.dao) {
    for (const [k, v] of Object.entries(b.f || {})) {
      if (k === "range" && Array.isArray(v)) khoang = [v[0], v[1]]
      else if (k in LOAI_LOC && typeof v === "string") loc[k as LoaiLoc] = [v]
      else co[k] = v
    }
  }
  if (khoaNV) loc.staff = [khoaNV]
  return { loc, khoang, co, xem: st.dao.length ? st.dao[st.dao.length - 1].v : xemGoc }
}

/** Mặc định của từng màn — màn và đường dẫn tới màn phải dùng chung một bộ. */
export const MAC_DINH_MAN = {
  "/bao-cao": { ky: "month" },
  "/bao-cao/ban-hang": { ky: "month", xem: "time" },
  "/bao-cao/cuoi-ngay": { ky: "today", xem: "tong" },
  "/bao-cao/kho": { ky: "month", xem: "current" },
  "/bao-cao/cong-no": { xem: "customer" },
  "/bao-cao/tai-chinh": { ky: "month", tab: "pl" },
} satisfies Record<string, Partial<TrangThaiBC>>

export type ManBC = keyof typeof MAC_DINH_MAN

/** Đường dẫn mở một màn khác ở đúng chế độ xem / kỳ / bước đào sâu (bấm số ở Tổng quan). */
export function lienKetMan(man: ManBC, st: Partial<TrangThaiBC>): string {
  const md = MAC_DINH_MAN[man] as Partial<TrangThaiBC>
  const q = ghiTrangThai({ ...TRANG_THAI_GOC, ...md, ...st }, md)
  return q ? `${man}?${q}` : man
}
