"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { CustomerDupeFinder } from "@/components/customers/customer-dupe-finder"
import { Skeleton } from "@/components/ui/skeleton"
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
  const [showForm, setShowForm] = useState(false)

  const next = safeNext(params.get("next"))

  if (authLoading || loading) return <Skeleton className="h-96" />

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
        <CustomerForm groups={groups} nextHref={next} />
      ) : (
        <CustomerDupeFinder onConfirmCreateNew={() => setShowForm(true)} />
      )}
    </div>
  )
}
