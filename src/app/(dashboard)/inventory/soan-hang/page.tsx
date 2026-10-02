"use client"

/**
 * KHO VẬN › SOẠN HÀNG — gộp nhiều HÓA ĐƠN thành một lượt nhặt, rồi chia vào rổ theo từng đơn.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng > mở ra chọn danh sách Hoá
 *   đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn tổng."
 * ⚠ CHỦ NHÀ 02/10/2026: "thêm các bộ lọc vào đơn. thêm đánh dấu đơn nào đã soạn vào" · "đã soạn chỉ xuất hiện ở
 *   màn soạn đơn thôi" (mig 224) · "thiết kế màn soạn hàng các tính năng kiểu như giao diện mẫu này" — máy tính:
 *   `SoanHangMayTinh`, điện thoại: `SoanHangDienThoai`, cùng một lượt soạn lưu máy chủ (mig 225, `use-luot-soan`).
 *   Bước cuối "Hoàn tất soạn" đánh dấu hoá đơn đã soạn — KHÔNG trừ kho (kho đã trừ lúc ghi sổ hoá đơn).
 *
 * Đường dẫn: `?luot=<id>` mở lại một lượt (gửi link cho kho / mở trên điện thoại); `?ids=a,b` chọn sẵn hoá đơn.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { Skeleton } from "@/components/ui/skeleton"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { docIds, SOAN_HANG_HREF } from "@/lib/orders/pick-list"
import { duocSoanHang } from "@/lib/orders/luot-soan"
import { useLuotSoan, type HoaDonSoan } from "@/components/soan-hang/use-luot-soan"
import { SoanHangMayTinh } from "@/components/soan-hang/soan-hang-may-tinh"
import { SoanHangDienThoai } from "@/components/soan-hang/soan-hang-dien-thoai"
import { ToInSoanHang } from "@/components/soan-hang/to-in-soan-hang"
import type { Nguoi, Tuyen } from "@/components/soan-hang/chon-hoa-don"

function Trang() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const router = useRouter()
  const params = useSearchParams()
  const mayTinh = useKhoMay()
  const supabase = useMemo(() => createClient(), [])
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)
  const [tuyen, setTuyen] = useState<Tuyen[]>([])
  const [nguoi, setNguoi] = useState<Nguoi[]>([])

  useEffect(() => {
    if (authLoading || !user?.org_id) return
    loadOrgHeader(supabase, user.org_id).then(setOrg).catch(() => {})
    supabase.from("sales_routes").select("id, code, name").order("sort_order").then(({ data, error }) => {
      if (error) console.error("[soan-hang] đọc tuyến lỗi:", error.message)
      setTuyen((data as Tuyen[]) ?? [])
    })
    supabase.from("users").select("id, full_name, role, is_active").order("full_name").then(({ data, error }) => {
      if (error) console.error("[soan-hang] đọc nhân viên lỗi:", error.message)
      setNguoi((data as Nguoi[]) ?? [])
    })
  }, [authLoading, user?.org_id, supabase])

  /** `customers.channel` lưu mã tuyến (sổ cũ có chỗ lưu id / tên) → hiện mã tuyến. */
  const tenTuyen = useCallback(
    (c: string | null | undefined) => {
      if (!c) return ""
      const r = tuyen.find((x) => x.id === c || x.code === c || x.name === c)
      return r ? r.code || r.name : c
    },
    [tuyen]
  )

  const L = useLuotSoan(!authLoading && !!user?.org_id, tenTuyen)

  /* ---- đường dẫn: mở lượt / chọn sẵn hoá đơn (một lần), rồi ghi `?luot=` theo lượt đang mở ---- */
  const daDocUrl = useRef(false)
  useEffect(() => {
    if (authLoading || !user?.org_id || daDocUrl.current) return
    daDocUrl.current = true
    const luot = params.get("luot")
    if (luot) void L.moLuot(luot)
    else {
      const ids = docIds(params.get("ids"))
      if (ids.length)
        void supabase
          .from("sales_invoices")
          .select("id, invoice_code, invoice_date, status, total, sales_user_id, customer:customers(store_name, phone, channel), order:sales_orders(order_code)")
          .in("id", ids)
          .eq("status", "posted")
          .then(({ data }) => {
            const m = new Map(((data as unknown as HoaDonSoan[]) ?? []).map((d) => [d.id, d]))
            L.them(ids.map((id) => m.get(id)).filter((d): d is HoaDonSoan => !!d))
          })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.org_id])
  const luotId = L.luot?.id ?? null
  useEffect(() => {
    if (!daDocUrl.current) return
    const muon = luotId ? `${SOAN_HANG_HREF}?luot=${luotId}` : SOAN_HANG_HREF
    if (params.get("luot") !== luotId || (!luotId && params.get("ids"))) router.replace(muon, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [luotId])

  if (authLoading || mayTinh === null) return <Skeleton className="h-96" />
  const choSoan = duocSoanHang(user?.role)
  const chung = { L, orgId: user?.org_id, tuyen, nguoi, tenTuyen, choDanhDau: choSoan }

  return (
    <>
      {mayTinh ? <SoanHangMayTinh {...chung} /> : <SoanHangDienThoai {...chung} />}
      <ToInSoanHang org={org} ma={L.luot?.ma ?? null} hd={L.hd} rows={L.rows} soMat={L.soMatCuaHd} />
    </>
  )
}

export default function SoanHangPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Trang />
    </Suspense>
  )
}
