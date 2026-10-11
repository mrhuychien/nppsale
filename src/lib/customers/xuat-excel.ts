import type { SupabaseClient } from "@supabase/supabase-js"
import { docTheoLoId } from "@/lib/supabase/aggregate"
import { buildManagers, type Manager } from "@/lib/customers/managers"
import { dungBang, ngayVN, tien, type SheetXuat } from "@/lib/xuat-excel/phieu"
import type { TenNguoi } from "@/lib/xuat-excel/cac-man"

/**
 * XUẤT EXCEL DANH SÁCH KHÁCH HÀNG — chủ nhà 11/10/2026: "phần danh sách khách hàng thêm cho tao phần xuất excel chi
 * tiết thông tin".
 *
 * MỌI khách khớp bộ lọc đang xem (không chỉ trang 20 dòng), mỗi khách một dòng, đủ thông tin: liên hệ, địa chỉ,
 * tuyến, nhóm giá, nhân viên phụ trách, công nợ, hạn mức, thông tin xuất hoá đơn, toạ độ, ngày tạo / người tạo.
 * Ở đây chỉ có phần THUẦN (dựng bảng) + đọc phân công; đọc danh sách theo bộ lọc nằm ở màn (`customers/page.tsx`).
 *
 * ⚠ SỐ GHI LÀ SỐ (công nợ, hạn mức, toạ độ) — Excel cộng / lọc được. SĐT là CHỮ (giữ số 0 đầu).
 * ⚠ Công nợ không đọc được (`null`) → ô TRỐNG, không ghi 0: 0 nghĩa là "không nợ". Công nợ âm (dư có) giữ dấu âm.
 */

/** Cột đọc cho tệp xuất — đủ thông tin một khách, kèm tên nhóm giá. */
export const CHON_KHACH_XUAT =
  "id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, billing_email, payment_method_label, group:customer_groups(name)"

export interface KhachXuat {
  id: string
  store_name: string | null
  owner_name: string | null
  phone: string | null
  address: string | null
  province: string | null
  district: string | null
  ward: string | null
  channel: string | null
  credit_limit: number | string | null
  payment_terms: string | null
  status: string | null
  gps_lat: number | string | null
  gps_lng: number | string | null
  created_at: string | null
  created_by: string | null
  billing_name: string | null
  tax_code: string | null
  billing_address: string | null
  billing_email: string | null
  payment_method_label: string | null
  group?: { name?: string | null } | null
}

export const NHAN_TRANG_THAI_KHACH: Record<string, string> = {
  active: "Đang hoạt động",
  suspended: "Tạm ngưng",
  locked: "Đã khoá",
}

/** Người phụ trách một khách: người CHÍNH và những người cùng phụ trách (người đã nghỉ có ghi chú). */
export interface PhuTrachXuat {
  chinh: string
  khac: string
}

const tenNv = (m: Manager) => m.fullName + (m.userInactive ? " (đã nghỉ)" : "")

/** Phân công đang hoạt động → người phụ trách theo khách (cùng luật cột "Phụ trách" của danh sách: `buildManagers`). */
export function phuTrachTheoKhach(
  rows: ReadonlyArray<{ customer_id: string; user_id: string; role: string | null; status: string | null; user?: { id: string; full_name: string; is_active: boolean | null } | null }>
): Map<string, PhuTrachXuat> {
  const theoKhach = new Map<string, typeof rows[number][]>()
  for (const r of rows) {
    const ds = theoKhach.get(r.customer_id)
    if (ds) ds.push(r)
    else theoKhach.set(r.customer_id, [r])
  }
  const out = new Map<string, PhuTrachXuat>()
  for (const [id, ds] of Array.from(theoKhach.entries())) {
    const ms = buildManagers(
      ds.map((r) => ({ user_id: r.user_id, role: r.role, status: r.status })),
      ds.map((r) => r.user).filter((u): u is NonNullable<typeof u> => !!u),
      [],
      []
    )
    out.set(id, {
      chinh: ms.filter((m) => m.isPrimary).map(tenNv).join(", "),
      khac: ms.filter((m) => !m.isPrimary).map(tenNv).join(", "),
    })
  }
  return out
}

/** Đọc phân công ĐANG HOẠT ĐỘNG của các khách (theo lô id — không vượt trần URL / 1.000 dòng). */
export async function napPhuTrachKhach(sb: SupabaseClient, ids: readonly string[]): Promise<Map<string, PhuTrachXuat>> {
  if (ids.length === 0) return new Map()
  const rows = await docTheoLoId<{ customer_id: string; user_id: string; role: string | null; status: string | null; user?: { id: string; full_name: string; is_active: boolean | null } | null }>(
    ids,
    (lo, from, to) =>
      sb.from("customer_assignments")
        .select("id, customer_id, user_id, role, status, user:users(id, full_name, is_active)", { count: "exact" })
        .in("customer_id", lo)
        .eq("status", "active")
        .order("id")
        .range(from, to),
    "phân công khách hàng"
  )
  return phuTrachTheoKhach(rows)
}

/** "T7 — Thứ bảy" theo mã tuyến; mã không có trong danh mục tuyến thì ghi mã. */
export function nhanTuyenXuat(code: string | null | undefined, tuyen: ReadonlyArray<{ code: string; name: string }>): string {
  const c = (code ?? "").trim()
  if (!c) return ""
  const r = tuyen.find((x) => x.code === c)
  return r?.name && r.name.trim() !== c ? `${c} — ${r.name.trim()}` : c
}

const so = (v: unknown): number | "" => {
  if (v === null || v === undefined || v === "") return ""
  const n = Number(v)
  return Number.isFinite(n) ? n : ""
}

/** Một sheet "Khách hàng" — mỗi khách một dòng, đúng thứ tự danh sách đang xem. */
export function xuatKhachHang(
  khach: readonly KhachXuat[],
  ctx: {
    /** Nợ còn lại theo khách (Σ amount − paid, không kẹp âm); `null` = không đọc được → ô trống. */
    no: Readonly<Record<string, number>> | null
    /** Nợ quá hạn theo khách; `null` = không đọc được → ô trống. */
    quaHan: Readonly<Record<string, number>> | null
    phuTrach: ReadonlyMap<string, PhuTrachXuat>
    tenNguoi: TenNguoi
    tuyen: ReadonlyArray<{ code: string; name: string }>
  }
): SheetXuat[] {
  return [{
    ten: "Khách hàng",
    rows: dungBang<KhachXuat>([
      { ten: "Tên cửa hàng", lay: (c) => c.store_name },
      { ten: "Chủ cửa hàng", lay: (c) => c.owner_name },
      { ten: "SĐT", lay: (c) => (c.phone ?? "").trim() },
      { ten: "Địa chỉ", lay: (c) => c.address },
      { ten: "Phường/xã", lay: (c) => c.ward },
      { ten: "Quận/huyện", lay: (c) => c.district },
      { ten: "Tỉnh/TP", lay: (c) => c.province },
      { ten: "Tuyến", lay: (c) => nhanTuyenXuat(c.channel, ctx.tuyen) },
      { ten: "Nhóm giá", lay: (c) => c.group?.name },
      { ten: "NV phụ trách chính", lay: (c) => ctx.phuTrach.get(c.id)?.chinh || "" },
      { ten: "NV cùng phụ trách", lay: (c) => ctx.phuTrach.get(c.id)?.khac || "" },
      { ten: "Công nợ hiện tại", lay: (c) => (ctx.no ? tien(ctx.no[c.id] ?? 0) : "") },
      { ten: "Nợ quá hạn", lay: (c) => (ctx.quaHan ? tien(ctx.quaHan[c.id] ?? 0) : "") },
      { ten: "Hạn mức công nợ", lay: (c) => tien(c.credit_limit) },
      { ten: "Điều khoản thanh toán", lay: (c) => c.payment_terms },
      { ten: "Trạng thái", lay: (c) => NHAN_TRANG_THAI_KHACH[c.status ?? ""] ?? c.status },
      { ten: "Mã số thuế", lay: (c) => c.tax_code },
      { ten: "Tên đơn vị xuất HĐ", lay: (c) => c.billing_name },
      { ten: "Địa chỉ xuất HĐ", lay: (c) => c.billing_address },
      { ten: "Email xuất HĐ", lay: (c) => c.billing_email },
      { ten: "Hình thức thanh toán", lay: (c) => c.payment_method_label },
      { ten: "Vĩ độ", lay: (c) => so(c.gps_lat) },
      { ten: "Kinh độ", lay: (c) => so(c.gps_lng) },
      { ten: "Ngày tạo", lay: (c) => ngayVN(c.created_at) },
      { ten: "Người tạo", lay: (c) => (c.created_by ? ctx.tenNguoi.get(c.created_by) ?? "" : "") },
    ], khach),
  }]
}
