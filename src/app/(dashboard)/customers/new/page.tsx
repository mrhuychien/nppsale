"use client"

import { useState } from "react"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerForm } from "@/components/customers/customer-form"
import { CustomerDupeFinder } from "@/components/customers/customer-dupe-finder"
import { Skeleton } from "@/components/ui/skeleton"
import { Camera } from "lucide-react"

export default function NewCustomerPage() {
  const { loading: authLoading } = useRoleGuard("customers")
  const { groups, loading } = useCustomerGroups()
  const [showForm, setShowForm] = useState(false)

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Thêm khách hàng mới" backHref="/customers" />
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
        <CustomerForm groups={groups} />
      ) : (
        <CustomerDupeFinder onConfirmCreateNew={() => setShowForm(true)} />
      )}
    </div>
  )
}
