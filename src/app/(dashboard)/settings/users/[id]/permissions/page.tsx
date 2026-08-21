"use client"

/**
 * T-13 standalone deep-link wrapper. The matrix is also embedded on
 * /settings/users/[id]; this page exists for direct URL access /
 * bookmarks. Both surfaces use the same <PermissionMatrix /> component.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import { PermissionMatrix } from "@/components/settings/permission-matrix"
import { ROLE_LABELS, type Role } from "@/lib/permissions"

interface UserRow {
  id: string
  org_id: string
  full_name: string | null
  email: string
  role: Role
  is_active: boolean
}

export default function UserPermissionsPage() {
  const { id } = useParams<{ id: string }>()
  const { loading: authLoading } = useRoleGuard("settings")

  const [user, setUser] = useState<UserRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const supabase = createClient()
    let cancelled = false
    supabase
      .from("users")
      .select("id, org_id, full_name, email, role, is_active")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error) console.error("[id/permissions] truy vấn lỗi:", error.message)
        if (cancelled) return
        setUser((data as UserRow) || null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!user) {
    return (
      <div className="space-y-3">
        <PageHeader title="Không tìm thấy user" backHref="/settings/users" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Phân quyền: ${user.full_name || user.email}`}
        description={`Vai trò: ${ROLE_LABELS[user.role]}`}
        backHref={`/settings/users/${user.id}`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href={`/settings/users/${user.id}`}>
            <ChevronLeft className="h-4 w-4 mr-1.5" /> Quay lại hồ sơ
          </Link>
        </Button>
      </PageHeader>

      <PermissionMatrix
        userId={user.id}
        userRole={user.role}
        orgId={user.org_id}
      />
    </div>
  )
}
