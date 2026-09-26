/**
 * DANH MỤC cho Báo cáo tổng hợp: tên + chiều của khách, mặt hàng, nhân viên.
 *
 * ⚠ ĐỌC CẢ MẶT HÀNG / KHÁCH ĐÃ NGỪNG: hàng ngừng bán vẫn có doanh số trong kỳ cũ — bỏ đi là
 *   dòng bán mất tên.
 * ⚠ KÊNH của khách là chuỗi `customers.channel`, khớp với `sales_routes` theo id / mã / tên
 *   (như `reports/channels`); khách không có kênh là "Bán trực tiếp".
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { danhMucRong, type DanhMucBC } from "./cong"

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

export const KENH_TRUC_TIEP = "Bán trực tiếp"

/** "NET30" → 30 ngày được nợ; COD / trống → 0. */
export const hanNoTheoDieuKhoan = (t: string | null | undefined) => Number(/NET(\d+)/i.exec(t || "")?.[1] || 0)

interface KhachTho {
  id: string
  store_name: string
  group_id: string | null
  channel: string | null
  province: string | null
  payment_terms: string | null
  credit_limit: number | null
}
interface SpTho {
  id: string
  sku: string | null
  name: string
  category: string | null
  brand: string | null
  primary_supplier_id: string | null
  base_unit: string | null
  units?: { unit_name: string; conversion: number | string }[] | null
}

export interface KetQuaDanhMuc {
  dm: DanhMucBC
  thieu: boolean
}

export async function napDanhMuc(sb: SupabaseClient, orgId: string): Promise<KetQuaDanhMuc> {
  const doc = <T,>(bang: string, cot: string, them?: (q: ReturnType<SupabaseClient["from"]>) => unknown) =>
    docDuHoacNem<T>((from, to): Trang => {
      let q = sb.from(bang).select(cot, { count: "exact" })
      if (bang !== "customer_assignments") q = q.eq("org_id", orgId)
      if (them) q = them(q as never) as typeof q
      return q.order("id").range(from, to) as unknown as Trang
    }, `đọc ${bang}`)
  const [kh, sp, nv, nhom, tuyen, ncc, pc] = await Promise.all([
    doc<KhachTho>("customers", "id, store_name, group_id, channel, province, payment_terms, credit_limit"),
    doc<SpTho>("products", "id, sku, name, category, brand, primary_supplier_id, base_unit, units:product_units(unit_name, conversion)"),
    doc<{ id: string; full_name: string }>("users", "id, full_name"),
    doc<{ id: string; name: string }>("customer_groups", "id, name"),
    doc<{ id: string; code: string | null; name: string }>("sales_routes", "id, code, name"),
    doc<{ id: string; name: string }>("suppliers", "id, name"),
    doc<{ customer_id: string; user_id: string; status: string | null }>(
      "customer_assignments",
      "customer_id, user_id, status",
      (q) => (q as unknown as { eq: (a: string, b: string) => unknown }).eq("role", "primary")
    ),
  ])
  const dm = danhMucRong()
  for (const u of nv.rows) dm.nv.set(u.id, u.full_name)
  for (const g of nhom.rows) dm.nhomKhach.set(g.id, g.name)
  for (const s of ncc.rows) dm.ncc.set(s.id, s.name)
  const tenKenh = new Map<string, string>()
  for (const r of tuyen.rows) for (const k of [r.id, r.code, r.name]) if (k) tenKenh.set(k, r.name)
  for (const r of tuyen.rows) dm.kenh.set(r.name, r.name)
  dm.kenh.set(KENH_TRUC_TIEP, KENH_TRUC_TIEP)
  const phuTrach = new Map<string, string>()
  for (const a of pc.rows) if (!a.status || a.status === "active") phuTrach.set(a.customer_id, a.user_id)
  for (const c of kh.rows) {
    const kenh = c.channel ? tenKenh.get(c.channel) || c.channel : KENH_TRUC_TIEP
    if (!dm.kenh.has(kenh)) dm.kenh.set(kenh, kenh)
    dm.khach.set(c.id, {
      ten: c.store_name,
      nhom: c.group_id || "",
      kenh,
      tinh: (c.province || "").trim(),
      nv: phuTrach.get(c.id) || "",
      hanMuc: Number(c.credit_limit || 0),
      hanNo: hanNoTheoDieuKhoan(c.payment_terms),
    })
  }
  for (const p of sp.rows) {
    const donVi = (p.units || [])
      .map((u) => ({ ten: u.unit_name, heSo: Number(u.conversion) }))
      .filter((u) => u.heSo > 0 && u.ten !== p.base_unit)
    const lon = donVi.filter((u) => u.heSo > 1).sort((a, b) => b.heSo - a.heSo)[0]
    dm.sp.set(p.id, {
      ten: p.name,
      sku: p.sku || "",
      nhom: (p.category || "").trim(),
      thuongHieu: (p.brand || "").trim(),
      ncc: p.primary_supplier_id || "",
      donViCoSo: p.base_unit || "",
      donViLon: lon || null,
      donVi,
    })
  }
  const thieu = [kh, sp, nv, nhom, tuyen, ncc, pc].some((r) => r.truncated)
  return { dm, thieu }
}

/** Quy đổi cho `heSoQuyDoi` — dựng từ danh mục (không đọc lại bảng). */
export function quyDoiTuDanhMuc(dm: DanhMucBC, spId: string) {
  const s = dm.sp.get(spId)
  if (!s) return null
  return { base_unit: s.donViCoSo, units: (s.donVi || []).map((u) => ({ unit_name: u.ten, conversion: u.heSo })) }
}
