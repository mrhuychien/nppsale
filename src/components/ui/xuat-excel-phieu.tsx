"use client"

/**
 * NÚT "XUẤT EXCEL" Ở TRANG CHI TIẾT MỘT PHIẾU — chủ nhà 05/10/2026: "xuất excel cho chi tiết 8 loại phiếu".
 * Cùng tệp / cột với nút ở danh sách (`xuatMotPhieu`), cùng ô "Xuất file" của ma trận quyền theo mô-đun.
 */
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { xemDuocGiaVon, type Module } from "@/lib/permissions"
import { xuatMotPhieu, type LoaiPhieuXuat } from "@/lib/xuat-excel/mot-phieu"
import { XuatExcelButton } from "@/components/ui/xuat-excel-button"

/** Mô-đun quyền + tiền tố tên tệp — giống nút ở danh sách của từng loại. */
export const NUT_PHIEU: Record<LoaiPhieuXuat, { module: Module; tenTep: string }> = {
  "tra-ncc": { module: "inventory", tenTep: "tra-hang-ncc" },
  nhap: { module: "inventory", tenTep: "phieu-nhap-hang" },
  "tra-khach": { module: "returns", tenTep: "tra-hang" },
  thu: { module: "receivables", tenTep: "phieu-thu" },
  chi: { module: "reports", tenTep: "chi-phi" },
  kho: { module: "inventory", tenTep: "phieu-kho" },
  don: { module: "orders", tenTep: "don-hang" },
  "hoa-don": { module: "orders", tenTep: "hoa-don-ban" },
}

export function XuatExcelPhieu({
  loai,
  id,
  disabled,
  className,
}: {
  loai: LoaiPhieuXuat
  id: string | null | undefined
  disabled?: boolean
  className?: string
}) {
  const { user } = useAuth()
  const n = NUT_PHIEU[loai]
  return (
    <XuatExcelButton
      module={n.module}
      tenTep={n.tenTep}
      disabled={disabled || !id}
      className={className}
      title="Xuất phiếu này ra Excel — kèm chi tiết từng dòng"
      chuanBi={async () => {
        const kq = await xuatMotPhieu(createClient(), loai, id as string, { giaVon: xemDuocGiaVon(user?.role) })
        return { sheets: kq.sheets, soPhieu: 1, ma: kq.ma }
      }}
    />
  )
}
