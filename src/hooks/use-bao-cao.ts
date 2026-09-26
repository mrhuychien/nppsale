"use client"

/**
 * Trạng thái chung của một màn Báo cáo tổng hợp: quyền vào trang, trạng thái trên đường dẫn,
 * quyền giá vốn / xuất file, khoá nhân viên của NVBH, đào sâu.
 */
import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useRoleGuard } from "./use-role-guard"
import { duocXuatFile, xemDuocGiaVon, type Module } from "@/lib/permissions"
import { docTrangThai, ghiTrangThai, type BuocDao, type TrangThaiBC } from "@/lib/bao-cao/trang-thai"
import { homNayVN } from "@/lib/bao-cao/ky"

export function useBaoCao(module: Module, macDinh: Partial<TrangThaiBC>) {
  const { user, loading } = useRoleGuard(module)
  const sp = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const md = JSON.stringify(macDinh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const macDinhOn = useMemo(() => macDinh, [md])
  const qs = sp.toString()
  const st = useMemo(() => docTrangThai(new URLSearchParams(qs), macDinhOn), [qs, macDinhOn])

  /** Đổi trạng thái. `push` = thêm một bước lịch sử (đào sâu); còn lại thay tại chỗ. */
  const dat = useCallback(
    (patch: Partial<TrangThaiBC>, cach: "push" | "replace" = "replace") => {
      const q = ghiTrangThai({ ...st, ...patch }, macDinhOn)
      const url = q ? `${path}?${q}` : path
      if (cach === "push") router.push(url, { scroll: false })
      else router.replace(url, { scroll: false })
    },
    [st, macDinhOn, path, router]
  )
  const daoThem = useCallback((b: BuocDao) => dat({ dao: [...st.dao, b] }, "push"), [dat, st.dao])
  const veBuoc = useCallback((i: number) => dat({ dao: st.dao.slice(0, i) }), [dat, st.dao])
  /** Đổi chế độ xem gốc: giữ kỳ và lọc, bỏ các bước đào sâu (spec 2.6). */
  const doiXem = useCallback((xem: string) => dat({ xem, dao: [] }), [dat])

  const role = user?.role
  return {
    user,
    loading,
    st,
    dat,
    daoThem,
    veBuoc,
    doiXem,
    homNay: homNayVN(),
    xemGiaVon: xemDuocGiaVon(role),
    xuatFile: duocXuatFile(role, module),
    /** NVBH chỉ thấy số của chính mình — khoá lọc nhân viên (spec 4, 7). */
    khoaNV: role === "sales" ? user?.id ?? null : null,
    orgId: user?.org_id ?? null,
  }
}

export type BaoCao = ReturnType<typeof useBaoCao>
