"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { viMatchAllWords } from "@/lib/search"
import Link from "@/components/ui/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { ROLE_LABELS } from "@/lib/constants"
import { Users, Pencil, Lock, Unlock, Plus, Trash2, QrCode } from "lucide-react"
import type { User } from "@/types"
import { QrLoginDialog } from "@/components/users/qr-login-dialog"
import { NutDangNhapNhanVien } from "@/components/users/nut-dang-nhap-nhan-vien"
import { laThietBiApple } from "@/lib/users/mo-trinh-duyet"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  USER_COLUMNS,
  DEFAULT_USER_COLUMNS,
  type UserColumnKey,
} from "./list-config"
import { errorMessage } from "@/lib/errors"

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useRoleGuard("settings")
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [toggleTarget, setToggleTarget] = useState<User | null>(null)
  const [toggling, setToggling] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [qrTarget, setQrTarget] = useState<User | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("settings-users", DEFAULT_USER_COLUMNS, [], USER_COLUMNS, [])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error: dataErr } = await supabase.from("users").select("id, full_name, role, phone, is_active").order("full_name")
    if (dataErr) console.error("[settings/users] truy vấn lỗi:", dataErr.message)
    setUsers((data as User[]) || [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const canManage = currentUser && hasPermission(currentUser.role, "settings", "update")
  const isOwner = currentUser?.role === "owner"

  /* Nút "Đăng nhập" cạnh tên (chủ nhà 30/09/2026) — chỉ Chủ NPP, chỉ trên iPhone / iPad: mở Safari riêng
     nên app ở màn hình chính giữ phiên. Máy khác mở tab là đổi phiên cả trình duyệt → không hiện. */
  const [apple, setApple] = useState(false)
  useEffect(() => {
    setApple(laThietBiApple(navigator.userAgent, navigator.maxTouchPoints || 0))
  }, [])
  const [linkDn, setLinkDn] = useState<Record<string, string>>({})
  const coNutDangNhap = isOwner && apple
  useEffect(() => {
    if (!coNutDangNhap) return
    fetch("/api/admin/users/qr-links")
      .then((r) => r.json())
      .then((d) => d.links && setLinkDn(d.links))
      .catch((e) => console.error("[settings/users] link đăng nhập:", e))
  }, [coNutDangNhap])
  const nutDangNhap = (u: User, lon = false) =>
    coNutDangNhap && u.is_active && u.id !== currentUser?.id ? (
      <NutDangNhapNhanVien
        userId={u.id}
        userName={u.full_name}
        loginUrl={linkDn[u.id]}
        onTaoMa={(id, url) => setLinkDn((m) => ({ ...m, [id]: url }))}
        lon={lon}
      />
    ) : null

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Xóa thất bại")
      toast({ title: `Đã xóa người dùng ${deleteTarget.full_name}` })
      setDeleteTarget(null)
      fetchUsers()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleActive = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      const { error } = await supabase
        .from("users")
        .update({ is_active: !toggleTarget.is_active })
        .eq("id", toggleTarget.id)
      if (error) throw error
      toast({
        title: toggleTarget.is_active ? "Đã tạm khóa người dùng" : "Đã kích hoạt người dùng",
      })
      setToggleTarget(null)
      fetchUsers()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: errorMessage(err),
        variant: "destructive",
      })
    } finally {
      setToggling(false)
    }
  }

  /* Khuôn danh sách chung (chủ nhà 27/09/2026): dải trạng thái, ô tìm, lưới, thẻ, xem nhanh. */
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const [xemId, setXemId] = useState<string | null>(null)
  const locRows = useMemo(() => {
    const t = search.trim()
    return t ? users.filter((u) => viMatchAllWords(t, u.full_name, u.phone, ROLE_LABELS[u.role])) : users
  }, [users, search])
  const counts = useMemo(() => ({
    all: locRows.length,
    active: locRows.filter((u) => u.is_active).length,
    locked: locRows.filter((u) => !u.is_active).length,
  }), [locRows])
  const shown = useMemo(
    () => (status === "all" ? locRows : locRows.filter((u) => (status === "active") === !!u.is_active)),
    [locRows, status]
  )
  const { pg, trang } = usePhanTrangTaiCho(shown, JSON.stringify([status, search]))

  /** Nút thao tác của MỘT người — dùng chung cho cột Thao tác và ngăn xem nhanh. */
  const thaoTac = (u: User, rong = false) =>
    canManage ? (
      <span className={`flex items-center gap-2 ${rong ? "w-full flex-wrap" : "justify-end"}`} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" className={rong ? "h-11 flex-1" : undefined} onClick={() => setToggleTarget(u)}>
          {u.is_active ? (
            <>
              <Lock className="h-4 w-4 mr-1" /> Tạm khóa
            </>
          ) : (
            <>
              <Unlock className="h-4 w-4 mr-1" /> Kích hoạt
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" className={rong ? "h-11 flex-1" : undefined} onClick={() => router.push(`/settings/users/${u.id}`)}>
          <Pencil className="h-4 w-4 mr-1" /> Chỉnh sửa
        </Button>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            className={`text-primary hover:bg-primary/10 ${rong ? "h-11" : ""}`}
            onClick={() => setQrTarget(u)}
            title="Mã QR đăng nhập"
            aria-label="Mã QR đăng nhập"
          >
            <QrCode className="h-4 w-4" />
          </Button>
        )}
        {isOwner && u.id !== currentUser?.id && (
          <Button
            size="sm"
            variant="outline"
            className={`text-destructive hover:bg-destructive/10 ${rong ? "h-11" : ""}`}
            onClick={() => setDeleteTarget(u)}
            aria-label="Xoá người dùng"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">-</span>
    )

  const columns = useMemo(() => {
    const cols: Array<DocColumn<User> & { k?: UserColumnKey }> = [
      {
        key: "name", label: "Họ tên", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi"),
        render: (u) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold">{u.full_name}</span>
            {nutDangNhap(u)}
          </span>
        ),
      },
      { k: "role", key: "role", label: "Vai trò", width: "150px", render: (u) => <Badge variant="outline">{ROLE_LABELS[u.role] || u.role}</Badge> },
      { k: "phone", key: "phone", label: "SĐT", width: "140px", render: (u) => <DocCellText muted>{u.phone}</DocCellText> },
      {
        k: "status", key: "status", label: "Trạng thái", width: "140px",
        render: (u) => <Badge variant={u.is_active ? "success" : "secondary"}>{u.is_active ? "Đang hoạt động" : "Tạm khóa"}</Badge>,
      },
      { k: "action", key: "action", label: "Thao tác", width: "380px", align: "right", render: (u) => thaoTac(u) },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, canManage, isOwner, currentUser?.id, coNutDangNhap, linkDn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? users.find((u) => u.id === xemId) ?? null : null

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý người dùng" descriptionDesktopOnly description={`${users.length} người dùng`} backHref="/settings">
        {isOwner && (
          <Button asChild>
            <Link href="/settings/users/new">
              <Plus className="mr-2 h-4 w-4" /> Tạo nhân viên
            </Link>
          </Button>
        )}
      </PageHeader>

      <StatusChips
        active={status}
        onPick={setStatus}
        chips={[
          { key: "active", label: "Đang hoạt động", count: counts.active, accent: "#22c55e" },
          { key: "locked", label: "Tạm khóa", count: counts.locked, accent: "#98a2b3" },
          { key: "all", label: "Tất cả", count: counts.all, accent: "#181c1e" },
        ]}
      />

      {/* Màn không có bộ lọc nào ngoài ô tìm — thanh điện thoại chỉ có ô tìm. */}
      <MobileFilterBar value={search} onChange={setSearch} placeholder="Tìm họ tên, SĐT, vai trò…" activeCount={0} open={false} onOpenChange={() => {}} />


      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm họ tên, SĐT, vai trò…" />
            <XoaLocButton show={!!search} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={<ColumnPicker available={USER_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />}
        totals={null}
        loading={loading}
        isEmpty={shown.length === 0}
        empty={
          <EmptyState
            icon={<Users className="h-8 w-8 text-muted-foreground" />}
            title={users.length === 0 ? "Chưa có người dùng" : "Không có người dùng khớp"}
            description={users.length === 0 ? "Tạo người dùng qua Supabase Auth" : "Thử từ khoá khác."}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(u) => setXemId(u.id)} />}
        cards={
          <DocCardList
            items={trang}
            onOpen={(u) => setXemId(u.id)}
            aside={(u) => nutDangNhap(u, true)}
            card={(u) => ({
              accent: u.is_active ? "#22c55e" : "#98a2b3",
              title: u.full_name,
              total: "",
              meta: [ROLE_LABELS[u.role] || u.role, u.phone ? `SĐT: ${u.phone}` : null].filter(Boolean).join(" · "),
              badge: u.is_active ? null : { label: "Tạm khóa", bg: "#eef1f5", fg: "#565a67" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.full_name ?? "Người dùng"}
        subtitle={xem ? ROLE_LABELS[xem.role] || xem.role : undefined}
        badge={xem ? <Badge variant={xem.is_active ? "success" : "secondary"}>{xem.is_active ? "Đang hoạt động" : "Tạm khóa"}</Badge> : null}
        fields={xem ? [
          { label: "Vai trò", value: ROLE_LABELS[xem.role] || xem.role },
          { label: "SĐT", value: xem.phone },
        ] : []}
        actions={xem && canManage ? thaoTac(xem, true) : null}
      />

      <ConfirmDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.is_active ? "Tạm khóa người dùng?" : "Kích hoạt người dùng?"}
        description={
          toggleTarget?.is_active
            ? `Người dùng "${toggleTarget?.full_name}" sẽ không thể đăng nhập sử dụng hệ thống cho đến khi được kích hoạt lại.`
            : `Người dùng "${toggleTarget?.full_name}" sẽ được phép đăng nhập và sử dụng hệ thống.`
        }
        variant={toggleTarget?.is_active ? "destructive" : "default"}
        confirmLabel={toggleTarget?.is_active ? "Tạm khóa" : "Kích hoạt"}
        onConfirm={handleToggleActive}
        loading={toggling}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Xóa vĩnh viễn người dùng ${deleteTarget?.full_name}?`}
        description="Tài khoản + dữ liệu cá nhân sẽ bị xóa không thể khôi phục. Các bản ghi đã tạo (đơn hàng, phiếu kho...) vẫn giữ nhưng mất tham chiếu tới người tạo."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />

      {qrTarget && (
        <QrLoginDialog
          userId={qrTarget.id}
          userName={qrTarget.full_name}
          open={!!qrTarget}
          onOpenChange={(open) => !open && setQrTarget(null)}
        />
      )}
    </div>
  )
}
