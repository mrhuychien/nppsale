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
  salesUsers: FilterOption[]      // role = sales | manager | owner
  allUsers: FilterOption[]        // every active user
  drivers: FilterOption[]
  products: FilterOption[]
  categories: FilterOption[]      // distinct product.category
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
    docDuHoacNem<{ id: string; sku: string; name: string; category: string | null; brand: string | null }>(
      (from, to): Trang =>
        supabase
          .from("products")
          .select("id, sku, name, category, brand", { count: "exact" })
          .eq("org_id", orgId)
          .eq("status", "active")
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
    docDuHoacNem<{ id: string; code: string; name: string }>(
      (from, to): Trang =>
        supabase
          .from("sales_routes")
          .select("id, code, name", { count: "exact" })
          .eq("org_id", orgId)
          .eq("is_active", true)
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

  const products = prodRes.rows.map((p) => ({ id: p.id, label: p.name, hint: p.sku }))

  // Distinct categories + brands from products list
  const catSet = new Set<string>()
  const brandSet = new Set<string>()
  for (const p of prodRes.rows) {
    if (p.category) catSet.add(p.category)
    if (p.brand) brandSet.add(p.brand)
  }
  const categories: FilterOption[] = Array.from(catSet)
    .sort()
    .map((c) => ({ id: c, label: c }))
  const brands: FilterOption[] = Array.from(brandSet)
    .sort()
    .map((b) => ({ id: b, label: b }))

  const activeUsers = userRes.rows.filter((u) => u.is_active)

  return {
    lists: {
      customers: custRes.rows.map((c) => ({
        id: c.id,
        label: c.store_name,
        hint: c.phone || undefined,
      })),
      salesUsers: activeUsers
        .filter((u) => ["sales", "manager", "owner"].includes(u.role))
        .map((u) => ({ id: u.id, label: u.full_name, hint: u.role })),
      allUsers: activeUsers.map((u) => ({
        id: u.id,
        label: u.full_name,
        hint: u.role,
      })),
      drivers: activeUsers
        .filter((u) => u.role === "driver")
        .map((u) => ({ id: u.id, label: u.full_name })),
      products,
      categories,
      brands,
      customerGroups: groupRes.rows.map((g) => ({ id: g.id, label: g.name })),
      routes: routeRes.rows.map((r) => ({ id: r.id, label: r.name, hint: r.code })),
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
  categories: EMPTY,
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

export const SALES_METHOD_OPTIONS: FilterOption[] = [
  { id: "direct", label: "Bán tại quầy" },
  { id: "route", label: "Đi tuyến" },
  { id: "phone", label: "Đặt qua điện thoại" },
  { id: "online", label: "Online / app" },
]
