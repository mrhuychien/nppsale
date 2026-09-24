/**
 * BỘ LỌC NÂNG CAO — chọn TRƯỜNG BẤT KỲ, chọn phép so, gõ giá trị.
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "Rà soát lại các màn danh sách … form chung giống danh
 *   sách đơn hàng hiện tại nhưng thêm phần bộ lọc nâng cao (cho chọn trường bất
 *   kỳ để lọc giá trị)".
 *
 * HAI ĐƯỜNG, MỘT LUẬT
 *   · Danh sách lọc ở MÁY CHỦ: `menhDeLoc` dựng mỗi điều kiện thành MỘT mệnh đề
 *     `or=` của PostgREST — đúng hình dạng `useFieldSearch` đã dùng, nên nơi gọi
 *     chỉ việc `for (f of menhDe) q = q.or(f)` (PostgREST ghép các `or=` bằng VÀ).
 *   · Danh sách tải hết rồi lọc ở TRÌNH DUYỆT: `khopLoc` áp đúng các phép ấy lên
 *     từng dòng. Hai hàm đọc chung `TOAN_TU_THEO_KIEU`, chốt kiểm thử so hai bên.
 *
 * ⚠ CHỈ CỘT CỦA CHÍNH BẢNG. Lọc trên bảng nhúng (`customer.store_name`) cần
 *   `!inner` ở câu select, không thì PostgREST vẫn trả dòng mà bỏ trống phần
 *   nhúng. Trường cần tra bảng khác đi qua `useFieldSearch` (tìm theo trường).
 *
 * ⚠ GIÁ TRỊ LUÔN TRONG NGOẶC KÉP (`ilikeDk` cùng luật): người dùng gõ "a,b" hay
 *   "(x)" là cú pháp `or=` vỡ nếu để trần.
 */
import { ilikeDk } from "@/lib/search/list-search"
import { viNormalize } from "@/lib/search"

export type KieuTruong = "text" | "number" | "date" | "enum" | "bool"

export interface TruongLoc {
  key: string
  nhan: string
  /** Cột của chính bảng, ví dụ `total`, `order_date`. */
  cot: string
  kieu: KieuTruong
  /** `enum`: danh sách lựa chọn. */
  luaChon?: ReadonlyArray<{ value: string; label: string }>
  /** `date` trên cột có giờ (timestamptz): "đến ngày D" phải là hết ngày D. */
  coGio?: boolean
}

export type ToanTu = "chua" | "khong_chua" | "bang" | "khac" | "tu" | "den" | "khoang" | "rong" | "co_gia_tri"

export const NHAN_TOAN_TU: Record<ToanTu, string> = {
  chua: "có chứa",
  khong_chua: "không chứa",
  bang: "bằng",
  khac: "khác",
  tu: "≥ (từ)",
  den: "≤ (đến)",
  khoang: "trong khoảng",
  rong: "để trống",
  co_gia_tri: "có giá trị",
}

export const TOAN_TU_THEO_KIEU: Record<KieuTruong, readonly ToanTu[]> = {
  text: ["chua", "khong_chua", "bang", "khac", "rong", "co_gia_tri"],
  number: ["bang", "khac", "tu", "den", "khoang", "rong", "co_gia_tri"],
  date: ["bang", "tu", "den", "khoang", "rong", "co_gia_tri"],
  enum: ["bang", "khac"],
  bool: ["bang"],
}

export interface DieuKienLoc {
  id: string
  truong: string
  toanTu: ToanTu
  giaTri: string
  /** Chỉ dùng cho `khoang` — cận trên. */
  giaTri2?: string
}

const khongCanGiaTri = (t: ToanTu) => t === "rong" || t === "co_gia_tri"

/** Điều kiện đủ để áp chưa — thiếu giá trị thì BỎ QUA, không lọc ra rỗng. */
export function dieuKienDu(d: DieuKienLoc, truong: TruongLoc | undefined): truong is TruongLoc {
  if (!truong || !TOAN_TU_THEO_KIEU[truong.kieu].includes(d.toanTu)) return false
  if (khongCanGiaTri(d.toanTu)) return true
  if (d.giaTri.trim() === "") return false
  if (d.toanTu === "khoang" && (d.giaTri2 ?? "").trim() === "") return false
  if (truong.kieu === "number" && !Number.isFinite(Number(d.giaTri.replace(/\./g, "").replace(",", ".")))) return false
  return true
}

const so = (v: string) => String(Number(v.replace(/\./g, "").replace(",", ".")))
const q = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`
const cuoiNgay = (v: string) => `${v}T23:59:59.999`

/**
 * Mệnh đề `or=` của MỘT điều kiện. `null` = chưa đủ để áp.
 * `khoang` ra một khối `and(...)` — vẫn là một mệnh đề.
 */
export function menhDeMot(d: DieuKienLoc, truong: TruongLoc | undefined): string | null {
  if (!dieuKienDu(d, truong)) return null
  const c = truong.cot
  const v = truong.kieu === "number" ? so(d.giaTri) : d.giaTri.trim()
  const v2 = truong.kieu === "number" ? so(d.giaTri2 ?? "") : (d.giaTri2 ?? "").trim()
  const den = (x: string) => (truong.kieu === "date" && truong.coGio ? cuoiNgay(x) : x)
  switch (d.toanTu) {
    case "chua": return ilikeDk(c, v)
    case "khong_chua": return ilikeDk(c, v).replace(`${c}.ilike.`, `${c}.not.ilike.`)
    case "rong": return `${c}.is.null`
    case "co_gia_tri": return `${c}.not.is.null`
    case "tu": return `${c}.gte.${q(v)}`
    case "den": return `${c}.lte.${q(den(v))}`
    case "khoang": return `and(${c}.gte.${q(v)},${c}.lte.${q(den(v2))})`
    case "bang":
      if (truong.kieu === "date" && truong.coGio) return `and(${c}.gte.${q(v)},${c}.lte.${q(cuoiNgay(v))})`
      if (truong.kieu === "bool") return `${c}.is.${v === "true" ? "true" : "false"}`
      if (truong.kieu === "text") return `${c}.ilike.${q(v.replace(/[\\%_]/g, "\\$&"))}`
      return `${c}.eq.${q(v)}`
    case "khac":
      if (truong.kieu === "text") return `${c}.not.ilike.${q(v.replace(/[\\%_]/g, "\\$&"))}`
      return `${c}.neq.${q(v)}`
  }
}

/** Mọi mệnh đề đủ điều kiện — nơi gọi `.or()` từng cái. */
export function menhDeLoc(truong: readonly TruongLoc[], ds: readonly DieuKienLoc[]): string[] {
  const theoKey = new Map(truong.map((t) => [t.key, t]))
  return ds.map((d) => menhDeMot(d, theoKey.get(d.truong))).filter((x): x is string => !!x)
}

/** Số điều kiện ĐANG áp (đủ giá trị) — cho huy hiệu trên nút lọc. */
export function soDieuKienDangAp(truong: readonly TruongLoc[], ds: readonly DieuKienLoc[]): number {
  return menhDeLoc(truong, ds).length
}

/** Đọc `a.b.c` trên một dòng. */
function doc(row: unknown, cot: string): unknown {
  return cot.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), row)
}

const rongGT = (x: unknown) => x == null || (typeof x === "string" && x.trim() === "")
const chu = (x: unknown) => viNormalize(String(x ?? ""))
const ngay = (x: unknown) => String(x ?? "").slice(0, 10)

/** Lọc ở trình duyệt — CÙNG nghĩa với `menhDeMot`. */
export function khopMot(row: unknown, d: DieuKienLoc, truong: TruongLoc | undefined): boolean {
  if (!dieuKienDu(d, truong)) return true
  const x = doc(row, truong.cot)
  if (d.toanTu === "rong") return rongGT(x)
  if (d.toanTu === "co_gia_tri") return !rongGT(x)
  if (rongGT(x)) return d.toanTu === "khac" || d.toanTu === "khong_chua"
  const v = d.giaTri.trim()
  const v2 = (d.giaTri2 ?? "").trim()
  switch (truong.kieu) {
    case "text": {
      const a = chu(x)
      const b = chu(v)
      if (d.toanTu === "chua") return a.includes(b)
      if (d.toanTu === "khong_chua") return !a.includes(b)
      if (d.toanTu === "bang") return a === b
      if (d.toanTu === "khac") return a !== b
      return true
    }
    case "number": {
      const a = Number(x)
      const b = Number(so(v))
      const b2 = Number(so(v2))
      if (d.toanTu === "bang") return a === b
      if (d.toanTu === "khac") return a !== b
      if (d.toanTu === "tu") return a >= b
      if (d.toanTu === "den") return a <= b
      if (d.toanTu === "khoang") return a >= b && a <= b2
      return true
    }
    case "date": {
      const a = ngay(x)
      if (d.toanTu === "bang") return a === v
      if (d.toanTu === "tu") return a >= v
      if (d.toanTu === "den") return a <= v
      if (d.toanTu === "khoang") return a >= v && a <= v2
      return true
    }
    case "enum":
      return d.toanTu === "bang" ? String(x) === v : String(x) !== v
    case "bool":
      return (x === true) === (v === "true")
  }
}

export function khopLoc(row: unknown, truong: readonly TruongLoc[], ds: readonly DieuKienLoc[]): boolean {
  const theoKey = new Map(truong.map((t) => [t.key, t]))
  return ds.every((d) => khopMot(row, d, theoKey.get(d.truong)))
}

let dem = 0
/** Điều kiện trống cho trường đầu tiên — phép so mặc định theo kiểu. */
export function dieuKienMoi(truong: readonly TruongLoc[], key?: string): DieuKienLoc {
  const t = truong.find((x) => x.key === key) ?? truong[0]
  return { id: `dk${++dem}`, truong: t?.key ?? "", toanTu: t ? TOAN_TU_THEO_KIEU[t.kieu][0] : "chua", giaTri: t?.kieu === "bool" ? "true" : t?.kieu === "enum" ? (t.luaChon?.[0]?.value ?? "") : "" }
}
