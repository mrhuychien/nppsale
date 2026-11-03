"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { CustomerDupeFinder } from "@/components/customers/customer-dupe-finder"
import { TaoKhachDienThoai } from "@/components/customers/tao-khach-dien-thoai"
import { TimKhachTruocKhiTao } from "@/components/customers/tim-khach-truoc-khi-tao"
import { Skeleton } from "@/components/ui/skeleton"
import { chuBanDauKhach, sdtTuTimKiem } from "@/lib/customers/tao-khach"
import { Camera } from "lucide-react"

/**
 * ⚠ CHỈ NHẬN ĐƯỜNG DẪN NỘI BỘ. `?next=` đi thẳng vào `router.push`; nhận
 * bừa là một đường dẫn dán từ ngoài đưa người dùng sang nơi khác ngay sau
 * khi họ vừa tạo xong dữ liệu. Chỉ cho đường bắt đầu bằng đúng một dấu
 * `/` — `//kẻ-xấu.example` cũng là một URL tuyệt đối hợp lệ với trình
 * duyệt.
 */
function safeNext(v: string | null): string | undefined {
  if (!v) return undefined
  if (!v.startsWith("/") || v.startsWith("//")) return undefined
  return v
}

export default function NewCustomerPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { groups, loading } = useCustomerGroups()
  const params = useSearchParams()
  const laMay = useKhoMay()
  /* Chủ nhà 01/10/2026: tìm SĐT không ra → tạo khách mới phải gán sẵn số vừa tìm (`?sdt=`).
     ⚠ Chủ nhà 03/11/2026: "tất cả các chỗ tạo khách hàng đều phải qua bước lọc trùng" — `?sdt=` KHÔNG vào thẳng form nữa:
     số điền sẵn ở bước tìm (dò ngay, thấy cả khách NV khác), không trùng mới sang form — số đi theo sang form. */
  const sdtTim = sdtTuTimKiem(params.get("sdt"))
  const [showForm, setShowForm] = useState(false)
  const [sdtDaTim, setSdtDaTim] = useState(sdtTim)
  /** Điện thoại: chữ ở bước tìm khách đã có + chữ mang sang form (null = còn ở bước tìm). */
  const [chuTim, setChuTim] = useState(sdtTim)
  const [mangSang, setMangSang] = useState<{ store_name: string; phone: string } | null>(null)

  const next = safeNext(params.get("next"))

  if (authLoading || loading || laMay === null) return <Skeleton className="h-96" />

  /*
   * Điện thoại — như máy tính: TÌM KHÁCH ĐÃ CÓ trước rồi mới tạo (chủ nhà 14/10/2026: "mất phần tìm khách hàng đã có
   * trước khi tạo rồi"). Tới bằng `?sdt=` thì số điền sẵn ở bước tìm (chủ nhà 03/11/2026 — mọi lối tạo khách đều qua
   * bước lọc trùng). Lùi / Huỷ ở form thì về bước tìm, chữ đã gõ còn nguyên.
   */
  if (laMay === false) {
    /* "Thêm khách khác" sau khi lưu: khách tiếp theo cũng tìm trước rồi mới tạo. */
    const veBuocTim = () => { setMangSang(null); setChuTim("") }
    if (mangSang) {
      return (
        <TaoKhachDienThoai
          groups={groups}
          nextHref={next}
          sdtBanDau={mangSang.phone}
          tenBanDau={mangSang.store_name}
          onHuy={() => setMangSang(null)}
          onThemKhachKhac={veBuocTim}
        />
      )
    }
    return (
      <TimKhachTruocKhiTao
        chu={chuTim}
        onChu={setChuTim}
        onTaoMoi={(q) => setMangSang(chuBanDauKhach(q))}
        backHref={next ?? "/customers"}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Quay lui về đúng chỗ đã bấm +, không phải về danh sách khách. */}
      <PageHeader title="Thêm khách hàng mới" backHref={next ?? "/customers"} />
      {/* Nói trước rằng KHÔNG cần có mặt tại điểm bán mới tạo được: đây
          là cách NVBH thực sự làm (dựng danh sách ở nhà buổi tối), và
          không nói thì họ tưởng phải ra tận nơi mới nhập được. */}
      <p className="flex items-start gap-2 rounded-xl bg-surface-container p-3 text-xs text-on-surface-variant">
        <Camera className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Cứ tạo trước bằng tên, SĐT và địa chỉ. <strong>Ảnh điểm bán và vị trí
          chụp sau</strong> khi tới nơi — mở khách hàng rồi bấm “Chụp ảnh”, vị trí
          lấy tự động. Hệ thống sẽ nhắc lại những điểm bán còn thiếu.
        </span>
      </p>
      {showForm ? (
        <CustomerForm groups={groups} nextHref={next} initialPhone={sdtDaTim} />
      ) : (
        <CustomerDupeFinder
          initialQuery={sdtTim}
          onConfirmCreateNew={(q) => {
            // Ô tìm đang là một SĐT → gán sẵn vào form tạo mới.
            setSdtDaTim(sdtTuTimKiem(q))
            setShowForm(true)
          }}
        />
      )}
    </div>
  )
}
