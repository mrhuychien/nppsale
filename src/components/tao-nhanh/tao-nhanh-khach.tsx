"use client"

/**
 * Tạo nhanh KHÁCH HÀNG tại chỗ (chủ nhà 03/10/2026, Update 3.10: "add luôn khách vừa thêm vào").
 * Cả hai khổ đi HAI BƯỚC: tìm khách đã có (máy tính `CustomerDupeFinder` trong hộp thoại, điện thoại `TimKhachTruocKhiTao`
 * phủ kín màn) rồi mới form (`CustomerForm` / `TaoKhachDienThoai`). Chữ đang gõ ở ô tìm của phiếu: trông như số → điền
 * sẵn ở bước tìm (dò ngay) và sang ô SĐT; là tên → sang ô tên cửa hàng (`chuBanDauKhach`).
 *
 * ⚠ CHỦ NHÀ 03/11/2026: "tạo đơn hàng trên điện thoại bấm Tạo khách hàng -> vẫn phải qua bước lọc trùng số điện thoại chứ
 *   ko được đến thẳng màn tạo khách hàng" · "em rà soát luôn tất cả các chỗ tạo khách hàng đều phải qua bước lọc trùng nhé".
 *   Ô tìm của phiếu chỉ thấy khách CỦA MÌNH (RLS) — không ra không có nghĩa số ấy chưa có khách: bước tìm dò cả khách NV
 *   khác (`useDoTrungKhach`), tìm ra thì chọn / nhận về rồi chọn luôn, nút tạo mới khoá (`khoaTaoMoi`). Một luật với
 *   `/customers/new`.
 */
import { useState } from "react"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { KhungTaoNhanh } from "@/components/ui/khung-tao-nhanh"
import { Skeleton } from "@/components/ui/skeleton"
import { CustomerForm } from "@/components/customers/customer-form"
import { CustomerDupeFinder } from "@/components/customers/customer-dupe-finder"
import { TaoKhachDienThoai } from "@/components/customers/tao-khach-dien-thoai"
import { TimKhachTruocKhiTao } from "@/components/customers/tim-khach-truoc-khi-tao"
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
        <HaiBuocMayTinh groups={groups} dau={dau} onXong={xong} onDong={dong} />
      ) : (
        <HaiBuocDienThoai groups={groups} dau={dau} onXong={xong} onDong={dong} />
      )}
    </KhungTaoNhanh>
  )
}

/** Mang chữ của bước tìm sang form: số gõ ở bước tìm → ô SĐT; tên đang tìm ở phiếu (nếu có) → ô tên cửa hàng. */
const sangForm = (q: string, dau: { store_name: string; phone: string }) => {
  const m = chuBanDauKhach(q)
  return { store_name: m.store_name || dau.store_name, phone: m.phone }
}

/**
 * Máy tính: bước 1 tìm khách đã có trong hộp thoại, bước 2 `CustomerForm`. "Hủy" ở form là thôi tạo — đóng hộp thoại như
 * trước (máy tính không có nút lùi từng bước; muốn đổi số thì đóng mở lại).
 */
function HaiBuocMayTinh({
  groups,
  dau,
  onXong,
  onDong,
}: {
  groups: { id: string; name: string }[]
  dau: { store_name: string; phone: string }
  onXong: (k: KhachVuaTao) => void
  onDong: () => void
}) {
  const [mangSang, setMangSang] = useState<{ store_name: string; phone: string } | null>(null)
  if (mangSang) {
    return (
      <CustomerForm
        groups={groups}
        initialName={mangSang.store_name}
        initialPhone={mangSang.phone}
        onDaTao={onXong}
        onHuy={onDong}
      />
    )
  }
  return <CustomerDupeFinder initialQuery={dau.phone} onChon={onXong} onConfirmCreateNew={(q) => setMangSang(sangForm(q, dau))} />
}

/**
 * Điện thoại: bước 1 tìm khách đã có (SĐT đang gõ điền sẵn — đủ số là dò ngay), bước 2 form. Lùi ở form về bước tìm,
 * chữ còn nguyên; lùi ở bước tìm là đóng khung. Khung đóng là gỡ hẳn (`!open ? null`) — mở lại bắt đầu từ bước tìm.
 */
function HaiBuocDienThoai({
  groups,
  dau,
  onXong,
  onDong,
}: {
  groups: { id: string; name: string }[]
  dau: { store_name: string; phone: string }
  onXong: (k: KhachVuaTao) => void
  onDong: () => void
}) {
  const [chu, setChu] = useState(dau.phone)
  /** `null` = còn ở bước tìm. */
  const [mangSang, setMangSang] = useState<{ store_name: string; phone: string } | null>(null)

  if (mangSang) {
    return (
      <TaoKhachDienThoai
        groups={groups}
        tenBanDau={mangSang.store_name}
        sdtBanDau={mangSang.phone}
        onDaTao={onXong}
        onHuy={() => setMangSang(null)}
      />
    )
  }
  return (
    <TimKhachTruocKhiTao
      chu={chu}
      onChu={setChu}
      onLui={onDong}
      onChon={onXong}
      onTaoMoi={(q) => setMangSang(sangForm(q, dau))}
    />
  )
}
