"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ROLE_LABELS } from "@/lib/constants"
import { Users } from "lucide-react"
import type { User } from "@/types"

export default function UsersPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from("users").select("*").order("full_name")
      setUsers((data as User[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Quan ly nguoi dung" description={`${users.length} nguoi dung`} />

      {users.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chua co nguoi dung" description="Tao nguoi dung qua Supabase Auth" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ho ten</TableHead>
              <TableHead>Vai tro</TableHead>
              <TableHead className="hidden sm:table-cell">SĐT</TableHead>
              <TableHead>Trang thai</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell><Badge variant="outline">{ROLE_LABELS[u.role] || u.role}</Badge></TableCell>
                <TableCell className="hidden sm:table-cell">{u.phone || "-"}</TableCell>
                <TableCell>
                  <Badge variant={u.is_active ? "success" : "secondary"}>
                    {u.is_active ? "Hoat dong" : "Vo hieu"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
