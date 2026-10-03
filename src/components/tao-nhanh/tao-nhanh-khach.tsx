"use client"

/**
 * Tạo nhanh KHÁCH HÀNG tại chỗ (chủ nhà 03/10/2026, Update 3.10: "add luôn khách vừa thêm vào").
 * Máy tính: `CustomerForm` trong hộp thoại. Điện thoại: `TaoKhachDienThoai` phủ kín màn. Chữ đang gõ ở ô
 * tìm vào ô SĐT nếu trông như số, không thì vào tên cửa hàng (`chuBanDauKhach`).
 */
import { useKhoMay } from "@/hooks/use-is-desktop"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { KhungTaoNhanh } from "@/components/ui/khung-tao-nhanh"
import { Skeleton } from "@/components/ui/skeleton"
import { CustomerForm } from "@/components/customers/customer-form"
import { TaoKhachDienThoai } from "@/components/customers/tao-khach-dien-thoai"
import { chuBanDauKhach, type KhachVuaTao } from "@/lib/customers/tao-khach"

export function TaoNhanhKhach({
  open,
  onOpenChange,
  chuBanDau,
  onDaTao,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chữ đang gõ ở ô tìm khách. */
  chuBanDau?: string
  onDaTao: (khach: KhachVuaTao) => void
}) {
  const laMay = useKhoMay()
  const { groups, loading } = useCustomerGroups()
  const dau = chuBanDauKhach(chuBanDau)
  const xong = (k: KhachVuaTao) => {
    onDaTao(k)
    onOpenChange(false)
  }
  const dong = () => onOpenChange(false)

  return (
    <KhungTaoNhanh
      open={open}
      onOpenChange={onOpenChange}
      tieuDe="Thêm khách hàng mới"
      moTa="Tạo xong khách được chọn luôn vào phiếu đang làm."
      tuVeDauDienThoai
      testId="tao-nhanh-khach"
    >
      {!open ? null : loading || laMay === null ? (
        <Skeleton className="h-96" />
      ) : laMay ? (
        <CustomerForm groups={groups} initialName={dau.store_name} initialPhone={dau.phone} onDaTao={xong} onHuy={dong} />
      ) : (
        <TaoKhachDienThoai groups={groups} tenBanDau={dau.store_name} sdtBanDau={dau.phone} onDaTao={xong} onHuy={dong} />
      )}
    </KhungTaoNhanh>
  )
}
