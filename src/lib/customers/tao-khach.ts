/**
 * TẠO KHÁCH HÀNG MỚI — phần dùng chung của màn điện thoại và form máy tính.
 *
 * Chủ nhà 01/10/2026 (màn "Thêm khách hàng" trên điện thoại):
 *   - "Tìm số điện thoại không có -> vào tạo khách hàng mới phải gán luôn số điện thoại tìm" → `sdtTuTimKiem`.
 *   - "Tuyến -> trường bắt buộc" → `loiKhachMoi`.
 *   - "Chống bấm tạo khách hàng 2 lần ? -> báo lỗi đã có khách hàng, ko chuyển trang" → `taoKhach` ném
 *     `KhachDaCo` (kiểm trước + bắt lỗi trùng 23505 của ràng buộc UNIQUE(org_id, phone)).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { assignCustomerToCreator, assignNote } from "@/lib/customers/assign-creator"
import { lamCuDanhMucBan } from "@/lib/sell/ref-store"
import { xoaNhoNen } from "@/lib/cache/nho-nen"
import { WARDS_HAI_PHONG } from "@/lib/constants/wards-hai-phong"

/** Chỉ còn chữ số; "+84 912…" / "84912…" quy về "0912…". */
export function chuanHoaSdt(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "")
  if (/^84\d{9}$/.test(d)) return "0" + d.slice(2)
  return d
}

/**
 * Từ khoá ô tìm khách → SĐT để gán sẵn vào khách mới. Chỉ khi từ khoá TOÀN số (cho phép dấu cách, chấm,
 * gạch, "+") và có ít nhất 3 chữ số; gõ tên thì trả "" (không gán bừa vào ô SĐT).
 */
export function sdtTuTimKiem(q: string | null | undefined): string {
  const t = String(q ?? "").trim()
  if (!t || !/^[\d\s.+()-]+$/.test(t)) return ""
  const d = chuanHoaSdt(t)
  return d.length >= 3 ? d.slice(0, 11) : ""
}

/**
 * Chữ đang gõ ở ô tìm khách → ô nào của khách mới được gán sẵn (chủ nhà 03/10/2026: "sang tạo mới có trường
 * đang search đó luôn"). Trông như SĐT (`sdtTuTimKiem`) → ô SĐT; còn lại → tên cửa hàng.
 */
export function chuBanDauKhach(chu: string | null | undefined): { store_name: string; phone: string } {
  const sdt = sdtTuTimKiem(chu)
  return sdt ? { store_name: "", phone: sdt } : { store_name: String(chu ?? "").trim(), phone: "" }
}

/** Khách vừa tạo — đủ cho các ô chọn khách hiện ra và tự chọn (`onDaTao`). */
export interface KhachVuaTao {
  id: string
  store_name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  channel: string | null
}

/** "0901000001" → "0901 000 001" (chỉ để hiện). */
export function dinhDangSdt(d: string): string {
  const s = chuanHoaSdt(d).slice(0, 11)
  const m = s.match(/^(\d{4})(\d{0,3})(\d{0,4})$/)
  return m ? [m[1], m[2], m[3]].filter(Boolean).join(" ") : s
}

/** SĐT di động / cố định VN: 10 số bắt đầu bằng 0. */
export const laSdtHopLe = (d: string) => /^0\d{9}$/.test(chuanHoaSdt(d))

export interface KhachMoiNhap {
  store_name: string
  owner_name: string
  phone: string
  address: string
  ward: string
  channel: string
}

export interface LoiKhachMoi {
  store_name?: string
  owner_name?: string
  phone?: string
  address?: string
  channel?: string
}

/** Lỗi từng ô — rỗng là hợp lệ. Tuyến BẮT BUỘC (chủ nhà 01/10/2026). */
export function loiKhachMoi(f: KhachMoiNhap): LoiKhachMoi {
  const e: LoiKhachMoi = {}
  if (!f.store_name.trim()) e.store_name = "Nhập tên cửa hàng"
  if (!f.owner_name.trim()) e.owner_name = "Nhập tên chủ cửa hàng"
  const d = chuanHoaSdt(f.phone)
  if (!d) e.phone = "Nhập số điện thoại"
  else if (!laSdtHopLe(d)) e.phone = "Số điện thoại gồm 10 số, bắt đầu bằng 0"
  if (!f.address.trim()) e.address = "Nhập địa chỉ hoặc bấm Lấy vị trí hiện tại"
  if (!f.channel.trim()) e.channel = "Chọn tuyến bán hàng"
  return e
}

export const coLoi = (e: LoiKhachMoi) => Object.keys(e).length > 0

/** Giá trị bộ lọc tuyến "Chưa có tuyến" ở danh sách khách (`?tuyen=chua`). */
export const CHUA_CO_TUYEN = "__chua_co_tuyen"

/** Lựa chọn cho ô Phường / xã (tìm không dấu qua `SearchSelect`). */
export const LUA_CHON_PHUONG_XA = WARDS_HAI_PHONG.map((w) => ({
  id: w,
  label: w,
  // Gõ "hong bang" hay "p hong bang" đều ra; tên không có loại ở đầu để xếp hạng theo tên.
  keywords: w.replace(/^(Phường|Xã|Đặc khu)\s+/, ""),
}))

/** Khách đã có số này — báo lỗi tại chỗ, KHÔNG chuyển trang. */
export class KhachDaCo extends Error {
  constructor(
    public readonly sdt: string,
    public readonly khach: { id: string; store_name: string } | null
  ) {
    super(
      khach
        ? `Đã có khách hàng dùng số ${dinhDangSdt(sdt)}: ${khach.store_name}.`
        : `Đã có khách hàng dùng số ${dinhDangSdt(sdt)} (có thể do nhân viên khác phụ trách).`
    )
    this.name = "KhachDaCo"
  }
}

/**
 * Tra khách đã dùng số này. Qua `search_customer_dupes` (thấy cả khách người khác phụ trách) — đọc thẳng
 * bảng thì RLS giấu khách không được phân công và phép kiểm nói "không trùng".
 */
export async function timKhachTrungSdt(
  sb: SupabaseClient,
  sdt: string
): Promise<{ id: string; store_name: string } | null> {
  const d = chuanHoaSdt(sdt)
  if (!laSdtHopLe(d)) return null
  const { data, error } = await sb.rpc("search_customer_dupes", { p_q: d })
  if (error) return null
  const rows = (data as Array<{ id: string; store_name: string; phone: string | null }> | null) ?? []
  return rows.find((r) => chuanHoaSdt(r.phone ?? "") === d) ?? null
}

const laLoiTrung = (e: unknown) => {
  const x = e as { code?: string; message?: string } | null
  return x?.code === "23505" || /duplicate key|customers_org_id_phone/i.test(x?.message ?? "")
}

/**
 * Ghi khách mới + phân công cho người tạo. Trả mã khách và ghi chú phân công (để báo).
 * Ném `KhachDaCo` khi trùng số (kiểm trước, hoặc ràng buộc UNIQUE bắt được — kể cả lần bấm thứ hai).
 */
export async function taoKhach(
  sb: SupabaseClient,
  user: { id?: string | null; org_id?: string | null; role?: string | null } | null | undefined,
  payload: Record<string, unknown>
): Promise<{ id: string | null; ghiChu: string | null; phanCongLoi: boolean }> {
  const sdt = chuanHoaSdt(String(payload.phone ?? ""))
  const trung = await timKhachTrungSdt(sb, sdt)
  if (trung) throw new KhachDaCo(sdt, trung)

  const ghi: Record<string, unknown> = { ...payload, phone: sdt, org_id: user?.org_id }
  if (user?.id) ghi.created_by = user.id
  let res = await sb.from("customers").insert(ghi).select("id").single()
  // Sổ chưa chạy mig 032 (không có created_by) thì ghi lại không có cột ấy.
  if (res.error && ((res.error.message || "").includes("created_by") || res.error.code === "PGRST204")) {
    delete ghi.created_by
    res = await sb.from("customers").insert(ghi).select("id").single()
  }
  if (res.error) {
    if (laLoiTrung(res.error)) throw new KhachDaCo(sdt, await timKhachTrungSdt(sb, sdt))
    throw res.error
  }
  const id = (res.data as { id: string } | null)?.id ?? null
  const kq = id
    ? await assignCustomerToCreator(sb, { customerId: id, role: user?.role ?? undefined })
    : ({ kind: "skipped", reason: "không lấy được mã điểm bán" } as const)
  // Danh mục khách của /sell và ô lọc khách ở các danh sách thấy khách mới ngay.
  lamCuDanhMucBan()
  xoaNhoNen("nen:khach")
  return { id, ghiChu: assignNote(kq), phanCongLoi: kq.kind === "failed" }
}
