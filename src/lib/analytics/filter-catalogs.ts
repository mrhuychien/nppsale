"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { FilterOption } from "@/components/analytics/report-shell"

// Shared hook to load DB-backed catalogs used by report filters.
// Each catalog returns FilterOption[] — { id, label, hint } — ready
// to drop into <FilterSearchSelect>.
//
// Loaded ONCE per orgId; if the orgId changes, refetched. Empty arrays
// while loading.

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
}

const EMPTY: FilterOption[] = []

export function useFilterCatalogs(orgId: string | null | undefined): Catalogs {
  const [catalogs, setCatalogs] = useState<Catalogs>({
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
    loading: true,
  })
  const supabase = createClient()

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const [
        custRes,
        userRes,
        prodRes,
        groupRes,
        routeRes,
        suppRes,
      ] = await Promise.all([
        supabase
          .from("customers")
          .select("id, store_name, phone")
          .eq("org_id", orgId)
          .order("store_name"),
        supabase
          .from("users")
          .select("id, full_name, role, is_active")
          .eq("org_id", orgId)
          .order("full_name"),
        supabase
          .from("products")
          .select("id, sku, name, category, brand")
          .eq("org_id", orgId)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("customer_groups")
          .select("id, name")
          .eq("org_id", orgId)
          .order("name"),
        supabase
          .from("sales_routes")
          .select("id, code, name")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("org_id", orgId)
          .order("name"),
      ])
      const qErr = ([custRes, userRes, prodRes, groupRes, routeRes, suppRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[analytics/filter-catalogs] truy vấn lỗi:", qErr.message)
      if (cancelled) return

      const products =
        ((prodRes.data as Array<{
          id: string
          sku: string
          name: string
          category: string | null
          brand: string | null
        }>) || []).map((p) => ({ id: p.id, label: p.name, hint: p.sku }))

      // Distinct categories + brands from products list
      const catSet = new Set<string>()
      const brandSet = new Set<string>()
      for (const p of (prodRes.data as Array<{ category: string | null; brand: string | null }>) || []) {
        if (p.category) catSet.add(p.category)
        if (p.brand) brandSet.add(p.brand)
      }
      const categories: FilterOption[] = Array.from(catSet)
        .sort()
        .map((c) => ({ id: c, label: c }))
      const brands: FilterOption[] = Array.from(brandSet)
        .sort()
        .map((b) => ({ id: b, label: b }))

      const allUsersRaw =
        (userRes.data as Array<{
          id: string
          full_name: string
          role: string
          is_active: boolean
        }>) || []
      const activeUsers = allUsersRaw.filter((u) => u.is_active)

      setCatalogs({
        customers:
          ((custRes.data as Array<{ id: string; store_name: string; phone: string | null }>) || []).map((c) => ({
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
        customerGroups:
          ((groupRes.data as Array<{ id: string; name: string }>) || []).map((g) => ({
            id: g.id,
            label: g.name,
          })),
        routes:
          ((routeRes.data as Array<{ id: string; code: string; name: string }>) || []).map((r) => ({
            id: r.id,
            label: r.name,
            hint: r.code,
          })),
        suppliers:
          ((suppRes.data as Array<{ id: string; name: string }>) || []).map((s) => ({
            id: s.id,
            label: s.name,
          })),
        loading: false,
      })
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
  { id: "draft", label: "Mới tạo / Nháp" },
  { id: "confirmed", label: "Đã duyệt" },
  { id: "picking", label: "Đang xuất kho" },
  { id: "delivering", label: "Đang giao" },
  { id: "delivered", label: "Đã giao" },
  { id: "cancelled", label: "Đã huỷ" },
]

export const SALES_METHOD_OPTIONS: FilterOption[] = [
  { id: "direct", label: "Bán tại quầy" },
  { id: "route", label: "Đi tuyến" },
  { id: "phone", label: "Đặt qua điện thoại" },
  { id: "online", label: "Online / app" },
]
