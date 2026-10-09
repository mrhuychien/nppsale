"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { docDuHoacNem } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import type { FilterOption } from "@/components/analytics/report-shell"

// Shared hook to load DB-backed catalogs used by report filters.
// Each catalog returns FilterOption[] — { id, label, hint } — ready
// to drop into <FilterSearchSelect>.
//
// Loaded ONCE per orgId; if the orgId changes, refetched. Empty arrays
// while loading.
//
// ⚠ `error` / `truncated`: danh sách rỗng vì LỖI hay thiếu vì chạm trần
// phải phân biệt được với "không có dữ liệu" — nơi gọi nên nói ra.

interface Catalogs {
  customers: FilterOption[]
  salesUsers: FilterOption[]      // role = sales | manager | owner (cả người đã nghỉ — có nhãn)
  allUsers: FilterOption[]        // mọi người dùng (người đã nghỉ xếp sau, có nhãn)
  drivers: FilterOption[]
  products: FilterOption[]
  brands: FilterOption[]          // distinct product.brand
  customerGroups: FilterOption[]  // bảng giá / nhóm khách
  routes: FilterOption[]          // sales_routes (kênh bán)
  suppliers: FilterOption[]
  loading: boolean
  /** Đọc hỏng — danh sách lọc đang RỖNG vì lỗi, không phải vì không có gì. */
  error: string | null
  /** Chạm trần `AGGREGATE_ROW_CAP` — danh sách lọc đang THIẾU. */
  truncated: boolean
}

export type CatalogLists = Omit<Catalogs, "loading" | "error" | "truncated">

const EMPTY: FilterOption[] = []

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

/**
 * Tối thiểu của Supabase client mà `taiDanhMucLoc` cần — đủ để test chạy
 * bằng một client giả, không phải dựng cả `SupabaseClient`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientToiThieu = { from: (bang: string) => any }

/**
 * Nạp mọi danh mục cho ô lọc báo cáo.
 *
 * ⚠ ĐỌC ĐỦ THEO TRANG. Bản cũ dùng `.select().order("store_name")` trơn —
 *   PostgREST cắt ở 1.000 dòng, nên ô chọn khách / sản phẩm chỉ chạy tới
 *   chừng chữ "M": gõ tên một khách vần "T" là ô tìm im lặng trả rỗng, và
 *   người xem kết luận khách ấy không có doanh số.
 *
 * ⚠ MỐC PHÂN TRANG: CỘT TÊN + `id`. Các trang chạy SONG SONG; chỉ
 *   `.order("store_name")` thì hai khách trùng tên làm trang lặp / sót.
 *   Thêm `id` làm mốc phụ thì thứ tự người dùng thấy không đổi (vẫn theo
 *   tên) mà ranh giới trang thành xác định.
 *
 * ⚠ HỎNG THÌ NÉM. Bản cũ `console.error` rồi dùng `data || []` — ô lọc
 *   rỗng trông y hệt "chưa có dữ liệu".
 *
 * ⚠ GỒM CẢ NHÂN VIÊN ĐÃ NGHỈ, HÀNG NGỪNG BÁN, TUYẾN NGỪNG — có nhãn, xếp sau mục đang hoạt động. Báo cáo xem kỳ cũ:
 *   chỉ liệt kê mục đang hoạt động thì không lọc được doanh số của người đã nghỉ / hàng đã ngừng (rà báo cáo
 *   09/10/2026; Báo cáo tổng hợp đã đọc cả mục ngừng — `nap-danh-muc.ts`).
 */
export async function taiDanhMucLoc(
  supabase: ClientToiThieu,
  orgId: string
): Promise<{ lists: CatalogLists; truncated: boolean }> {
  const [custRes, userRes, prodRes, groupRes, routeRes, suppRes] = await Promise.all([
    docDuHoacNem<{ id: string; store_name: string; phone: string | null }>(
      (from, to): Trang =>
        supabase
          .from("customers")
          .select("id, store_name, phone", { count: "exact" })
          .eq("org_id", orgId)
          .order("store_name")
          .order("id")
          .range(from, to),
      "đọc danh sách khách hàng"
    ),
    docDuHoacNem<{ id: string; full_name: string; role: string; is_active: boolean }>(
      (from, to): Trang =>
        supabase
          .from("users")
          .select("id, full_name, role, is_active", { count: "exact" })
          .eq("org_id", orgId)
          .order("full_name")
          .order("id")
          .range(from, to),
      "đọc danh sách nhân viên"
    ),
    docDuHoacNem<{ id: string; sku: string; name: string; brand: string | null; status: string | null }>(
      (from, to): Trang =>
        supabase
          .from("products")
          .select("id, sku, name, brand, status", { count: "exact" })
          .eq("org_id", orgId)
          .order("name")
          .order("id")
          .range(from, to),
      "đọc danh mục hàng"
    ),
    docDuHoacNem<{ id: string; name: string }>(
      (from, to): Trang =>
        supabase
          .from("customer_groups")
          .select("id, name", { count: "exact" })
          .eq("org_id", orgId)
          .order("name")
          .order("id")
          .range(from, to),
      "đọc nhóm khách hàng"
    ),
    docDuHoacNem<{ id: string; code: string; name: string; is_active: boolean | null }>(
      (from, to): Trang =>
        supabase
          .from("sales_routes")
          .select("id, code, name, is_active", { count: "exact" })
          .eq("org_id", orgId)
          .order("sort_order")
          .order("id")
          .range(from, to),
      "đọc tuyến bán hàng"
    ),
    docDuHoacNem<{ id: string; name: string }>(
      (from, to): Trang =>
        supabase
          .from("suppliers")
          .select("id, name", { count: "exact" })
          .eq("org_id", orgId)
          .order("name")
          .order("id")
          .range(from, to),
      "đọc nhà cung cấp"
    ),
  ])

  // Mục đang hoạt động trước, mục đã ngừng sau (giữ thứ tự đọc trong mỗi nhóm) — có nhãn để không chọn nhầm.
  const truocSau = <T,>(rows: T[], dangDung: (r: T) => boolean) => [...rows.filter(dangDung), ...rows.filter((r) => !dangDung(r))]
  const spDangBan = (p: { status: string | null }) => !p.status || p.status === "active"
  const products = truocSau(prodRes.rows, spDangBan).map((p) => ({
    id: p.id,
    label: p.name,
    hint: p.sku,
    ...(spDangBan(p) ? {} : { ghiChu: "ngừng bán" }),
  }))

  /* Thương hiệu (distinct). ⚠ Không còn danh sách "nhóm hàng / loại hàng" (`products.category`) —
     chủ nhà 03/10/2026 "Bỏ luôn trường nhóm hàng"; lọc hàng theo NCC (`suppliers`). */
  const brandSet = new Set<string>()
  for (const p of prodRes.rows) {
    if (p.brand && spDangBan(p)) brandSet.add(p.brand)
  }
  const brands: FilterOption[] = Array.from(brandSet)
    .sort()
    .map((b) => ({ id: b, label: b }))

  const nguoi = truocSau(userRes.rows, (u) => u.is_active !== false).map((u) => ({
    ...u,
    nghi: u.is_active === false ? { ghiChu: "đã nghỉ" } : {},
  }))

  return {
    lists: {
      customers: custRes.rows.map((c) => ({
        id: c.id,
        label: c.store_name,
        hint: c.phone || undefined,
      })),
      salesUsers: nguoi
        .filter((u) => ["sales", "manager", "owner"].includes(u.role))
        .map((u) => ({ id: u.id, label: u.full_name, hint: u.role, ...u.nghi })),
      allUsers: nguoi.map((u) => ({
        id: u.id,
        label: u.full_name,
        hint: u.role,
        ...u.nghi,
      })),
      drivers: nguoi
        .filter((u) => u.role === "driver")
        .map((u) => ({ id: u.id, label: u.full_name, ...u.nghi })),
      products,
      brands,
      customerGroups: groupRes.rows.map((g) => ({ id: g.id, label: g.name })),
      // ⚠ Nhãn kênh = TÊN tuyến (nơi gọi khớp `customers.channel` theo id / tên / mã) — ghi "ngừng" ở `ghiChu`.
      routes: truocSau(routeRes.rows, (r) => r.is_active !== false).map((r) => ({
        id: r.id,
        label: r.name,
        hint: r.code,
        ...(r.is_active === false ? { ghiChu: "ngừng" } : {}),
      })),
      suppliers: suppRes.rows.map((s) => ({ id: s.id, label: s.name })),
    },
    truncated: [custRes, userRes, prodRes, groupRes, routeRes, suppRes].some((r) => r.truncated),
  }
}

const TRONG: CatalogLists = {
  customers: EMPTY,
  salesUsers: EMPTY,
  allUsers: EMPTY,
  drivers: EMPTY,
  products: EMPTY,
  brands: EMPTY,
  customerGroups: EMPTY,
  routes: EMPTY,
  suppliers: EMPTY,
}

export function useFilterCatalogs(orgId: string | null | undefined): Catalogs {
  const [catalogs, setCatalogs] = useState<Catalogs>({
    ...TRONG,
    loading: true,
    error: null,
    truncated: false,
  })
  const supabase = createClient()

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      try {
        const { lists, truncated } = await taiDanhMucLoc(supabase, orgId)
        if (cancelled) return
        setCatalogs({ ...lists, loading: false, error: null, truncated })
      } catch (e) {
        console.error("[analytics/filter-catalogs] tải lỗi:", e)
        if (cancelled) return
        setCatalogs({
          ...TRONG,
          loading: false,
          error: errorMessage(e, "Không tải được danh mục bộ lọc"),
          truncated: false,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, supabase])

  return catalogs
}

// Static lists that don't need DB
export const PAYMENT_METHOD_OPTIONS: FilterOption[] = [
  { id: "cash", label: "Tiền mặt" },
  { id: "transfer", label: "Chuyển khoản" },
  { id: "ewallet", label: "Ví điện tử" },
]

export const ORDER_STATUS_OPTIONS: FilterOption[] = [
  { id: "draft", label: "Nháp" },
  { id: "submitted", label: "Phiếu tạm" },
  { id: "completed", label: "Hoàn thành" },
  { id: "cancelled", label: "Đã huỷ" },
]
