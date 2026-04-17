"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { Plus, Search, Factory, CheckCircle2, Phone, MapPin } from "lucide-react"
import type { Supplier } from "@/types"

export default function SuppliersPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .order("name")
      setSuppliers((data as Supplier[]) || [])
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      (s.code && s.code.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Nhà cung cấp" description={`${suppliers.length} nhà cung cấp`}>
        {user && hasPermission(user.role, "inventory", "create") && (
          <Button
            onClick={() => router.push("/suppliers/new")}
            className="bg-gradient-primary text-white shadow-ambient"
          >
            <Plus className="mr-2 h-4 w-4" /> Tạo mới
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm tên, mã NCC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có nhà cung cấp"
          description="Bắt đầu bằng cách thêm nhà cung cấp đầu tiên"
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã NCC</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead>Danh mục</TableHead>
                  <TableHead>Liên hệ</TableHead>
                  <TableHead>SĐT</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/suppliers/${s.id}`)}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {s.code}
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold">{s.name}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.category || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.contact_name || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.phone || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {s.is_verified && (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Đã xác minh
                          </Badge>
                        )}
                        <Badge variant={s.is_active ? "default" : "danger"}>
                          {s.is_active ? "Hoạt động" : "Ngưng"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/suppliers/${s.id}`)
                        }}
                      >
                        Chi tiết
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/suppliers/${s.id}`)}
              >
                <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${s.is_active ? "bg-primary" : "bg-danger"}`} />
                <div className="p-4 pl-5">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-primary/80 font-mono">{s.code}</p>
                      <h3 className="font-extrabold text-base leading-tight truncate">{s.name}</h3>
                      {s.contact_name && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.contact_name}</p>
                      )}
                      {s.phone && (
                        <div className="flex items-center gap-1 text-muted-foreground mt-1">
                          <Phone className="h-3 w-3 shrink-0" />
                          <p className="text-xs">{s.phone}</p>
                        </div>
                      )}
                      {s.address && (
                        <div className="flex items-center gap-1 text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <p className="text-xs truncate">{s.address}</p>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {s.is_verified && (
                        <Badge variant="success" className="gap-1 whitespace-nowrap">
                          <CheckCircle2 className="h-3 w-3" />
                          Xác minh
                        </Badge>
                      )}
                      <Badge variant={s.is_active ? "default" : "danger"}>
                        {s.is_active ? "Hoạt động" : "Ngưng"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
