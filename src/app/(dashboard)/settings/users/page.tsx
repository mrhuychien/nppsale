"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { StatusChips } from "@/components/ui/status-chips"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { sapXepTaiCho, type BangSoSanh, type DocSort } from "@/lib/list/sap-xep-may-chu"
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
import { DsNhanVienDienThoai } from "@/components/users/ds-nhan-vien-dien-thoai"
import { LOC_NV_MAC_DINH, chipNhanVien, dongPhuNhanVien, khopLocNv, sapXepNhanVien } from "@/lib/users/mobile-list"
import { laThietBiApple } from "@/lib/users/mo-trinh-duyet"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  USER_COLUMNS,
  DEFAULT_USER_COLUMNS,
  type UserColumnKey,
} from "./list-config"
import { errorMessage } from "@/lib/errors"
import { NHAN_TRANG_THAI_NV, trangThaiNv } from "@/lib/users/nghi-viec"
import { XoaNhanVienDialog } from "@/components/users/xoa-nhan-vien-dialog"

function BadgeTrangThai({ u }: { u: User }) {
  const tt = trangThaiNv(u)
  return (
    <Badge variant={tt === "active" ? "success" : tt === "left" ? "outline" : "secondary"} data-testid="trang-thai-nv">
      {NHAN_TRANG_THAI_NV[tt]}
    </Badge>
  )
}

/**
 * So sánh của các cột xếp được — xếp CẢ danh sách đã lọc rồi mới chia trang (`sapXepTaiCho`).
 * ⚠ Đừng để bảng tự xếp `trang`: đó là xếp trên 20 dòng đang xem.
 */
const SO_SANH_NHAN_VIEN: BangSoSanh<User> = {
  name: (a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "vi"),
}

export default function UsersPage() {
  const { user: currentUser, loading: authLoading } = useRoleGuard("settings")
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [toggleTarget, setToggleTarget] = useState<User | null>(null)
  const [toggling, setToggling] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
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
    /* `left_at` (mig 223) đọc kèm; DB chưa chạy 223 thì đọc lại không có cột — vẫn hiện được danh sách. */
    const moi = await supabase.from("users").select("id, full_name, role, phone, is_active, left_at").order("full_name")
    const { data, error: dataErr } = moi.error
      ? await supabase.from("users").select("id, full_name, role, phone, is_active").order("full_name")
      : moi
    if (dataErr) console.error("[settings/users] truy vấn lỗi:", dataErr.message)
    setUsers(((data as unknown) as User[]) || [])
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
  const nutDangNhap = (u: User, chiIcon = false) =>
    coNutDangNhap && u.is_active && u.id !== currentUser?.id ? (
      <NutDangNhapNhanVien
        userId={u.id}
        userName={u.full_name}
        loginUrl={linkDn[u.id]}
        onTaoMa={(id, url) => setLinkDn((m) => ({ ...m, [id]: url }))}
        chiIcon={chiIcon}
      />
    ) : null

  const handleToggleActive = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      const tt = trangThaiNv(toggleTarget)
      // Nhận lại người đã nghỉ: mở khoá + bỏ dấu nghỉ. Khách / nợ đã về NPP thì NPP tự phân lại.
      const { error } = await supabase
        .from("users")
        .update(tt === "left" ? { is_active: true, left_at: null, left_by: null } : { is_active: tt !== "active" })
        .eq("id", toggleTarget.id)
      if (error) throw error
      toast({
        title: tt === "active" ? "Đã tạm khóa người dùng" : tt === "left" ? "Đã nhận lại nhân viên" : "Đã kích hoạt người dùng",
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
    active: locRows.filter((u) => trangThaiNv(u) === "active").length,
    locked: locRows.filter((u) => trangThaiNv(u) === "locked").length,
    left: locRows.filter((u) => trangThaiNv(u) === "left").length,
  }), [locRows])
  const shown = useMemo(
    () => (status === "all" ? locRows : locRows.filter((u) => trangThaiNv(u) === status)),
    [locRows, status]
  )
  /** Thứ tự người dùng bấm trên tiêu đề — xếp cả `shown` TRƯỚC khi chia trang. */
  const [sort, setSort] = useState<DocSort | null>(null)
  const daXep = useMemo(() => sapXepTaiCho(shown, sort, SO_SANH_NHAN_VIEN), [shown, sort])
  const { pg, trang } = usePhanTrangTaiCho(daXep, JSON.stringify([status, search, sort]))

  /* Điện thoại (thiết kế "ds-nhan-vien"): lọc riêng — mặc định "Đang hoạt động", chip theo vai. Danh sách
     nhân viên ngắn → hiện hết, không phân trang. */
  const [locDt, setLocDt] = useState(LOC_NV_MAC_DINH)
  const chipsDt = useMemo(() => chipNhanVien(locRows, locDt), [locRows, locDt])
  const dsDt = useMemo(() => sapXepNhanVien(locRows.filter((u) => khopLocNv(u, locDt))), [locRows, locDt])

  /** Nút thao tác của MỘT người — dùng chung cho cột Thao tác và ngăn xem nhanh. */
  const thaoTac = (u: User, rong = false) =>
    canManage ? (
      <span className={`flex items-center gap-2 ${rong ? "w-full flex-wrap" : "justify-end"}`} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" className={rong ? "h-11 flex-1" : undefined} onClick={() => setToggleTarget(u)}>
          {trangThaiNv(u) === "active" ? (
            <>
              <Lock className="h-4 w-4 mr-1" /> Tạm khóa
            </>
          ) : (
            <>
              <Unlock className="h-4 w-4 mr-1" /> {trangThaiNv(u) === "left" ? "Nhận lại" : "Kích hoạt"}
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
        {isOwner && u.id !== currentUser?.id && trangThaiNv(u) !== "left" && (
          <Button
            size="sm"
            variant="outline"
            className={`text-destructive hover:bg-destructive/10 ${rong ? "h-11" : ""}`}
            onClick={() => setDeleteTarget(u)}
            aria-label="Xoá / cho nghỉ việc"
            title="Xoá / cho nghỉ việc"
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
        sortable: true,
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
        render: (u) => <BadgeTrangThai u={u} />,
      },
      { k: "action", key: "action", label: "Thao tác", width: "380px", align: "right", render: (u) => thaoTac(u) },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, canManage, isOwner, currentUser?.id, coNutDangNhap, linkDn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const chips = [
    { key: "active", label: "Đang hoạt động", count: counts.active, accent: "#22c55e" },
    { key: "locked", label: "Tạm khóa", count: counts.locked, accent: "#98a2b3" },
    ...(counts.left > 0 || status === "left" ? [{ key: "left", label: "Đã nghỉ", count: counts.left, accent: "#64748b" }] : []),
    { key: "all", label: "Tất cả", count: counts.all, accent: "#181c1e" },
  ]
  const nutTao = isOwner && (
    <Button asChild>
      <Link href="/settings/users/new">
        <Plus className="mr-2 h-4 w-4" /> Tạo nhân viên
      </Link>
    </Button>
  )

  const xem = xemId ? users.find((u) => u.id === xemId) ?? null : null

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Quản lý người dùng" descriptionDesktopOnly description={`${users.length} người dùng`} backHref="/settings">
        {nutTao}
      </PageHeader>

      <StatusChips className="max-lg:hidden" active={status} onPick={setStatus} chips={chips} />


      <DsNhanVienDienThoai
        subtitle={dongPhuNhanVien(users)}
        search={search}
        onSearch={setSearch}
        canCreate={!!isOwner}
        chips={chipsDt}
        loc={locDt}
        onPickLoc={setLocDt}
        items={dsDt}
        loading={loading}
        nutDangNhap={(u) => nutDangNhap(u, true)}
        onOpen={(u) => setXemId(u.id)}
      />

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
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(u) => setXemId(u.id)} sort={sort} onSortChange={setSort} />}
        /* Điện thoại: màn riêng theo thiết kế "ds-nhan-vien" (`DsNhanVienDienThoai`). */
        cards={null}
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.full_name ?? "Người dùng"}
        subtitle={xem ? ROLE_LABELS[xem.role] || xem.role : undefined}
        badge={xem ? <BadgeTrangThai u={xem} /> : null}
        fields={xem ? [
          { label: "Vai trò", value: ROLE_LABELS[xem.role] || xem.role },
          { label: "SĐT", value: xem.phone },
        ] : []}
        actions={xem && canManage ? thaoTac(xem, true) : null}
      />

      <ConfirmDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.is_active ? "Tạm khóa người dùng?" : toggleTarget?.left_at ? "Nhận lại nhân viên?" : "Kích hoạt người dùng?"}
        description={
          toggleTarget?.is_active
            ? `Người dùng "${toggleTarget?.full_name}" sẽ không thể đăng nhập sử dụng hệ thống cho đến khi được kích hoạt lại.`
            : toggleTarget?.left_at
              ? `"${toggleTarget?.full_name}" được đăng nhập lại. Khách và công nợ đã bàn giao về NPP không tự quay lại — phân công lại ở màn khách hàng.`
              : `Người dùng "${toggleTarget?.full_name}" sẽ được phép đăng nhập và sử dụng hệ thống.`
        }
        variant={toggleTarget?.is_active ? "destructive" : "default"}
        confirmLabel={toggleTarget?.is_active ? "Tạm khóa" : toggleTarget?.left_at ? "Nhận lại" : "Kích hoạt"}
        onConfirm={handleToggleActive}
        loading={toggling}
      />

      <XoaNhanVienDialog
        user={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDone={(tb) => {
          toast({ title: tb })
          setDeleteTarget(null)
          setXemId(null)
          fetchUsers()
        }}
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
