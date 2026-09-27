"use client"

/**
 * CHÍNH SÁCH HOA HỒNG — danh sách.
 *
 * ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn
 *   bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): dải trạng thái,
 *   một thẻ gồm thanh công cụ · lưới · phân trang, thẻ trên điện thoại, bấm dòng mở xem nhanh.
 */

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { viMatchAllWords } from "@/lib/search"
import { formatDate } from "@/lib/utils"
import { COMMISSION_TYPES } from "@/lib/constants"
import { Settings2, Plus } from "lucide-react"
import type { CommissionPolicy } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  COMMISSION_POLICY_COLUMNS,
  DEFAULT_COMMISSION_POLICY_COLUMNS,
  type CommissionPolicyColumnKey,
} from "./list-config"

export default function CommissionPoliciesPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("commissions")
  const [policies, setPolicies] = useState<CommissionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const [xemId, setXemId] = useState<string | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "commission-policies",
    DEFAULT_COMMISSION_POLICY_COLUMNS,
    [],
    COMMISSION_POLICY_COLUMNS,
    []
  )

  useEffect(() => {
    async function fetch() {
      const { data, error: dataErr } = await supabase.from("commission_policies").select("id, org_id, name, type, tiers, applies_to, effective_from, effective_to, is_active, created_at").order("created_at", { ascending: false })
      if (dataErr) console.error("[commissions/policies] truy vấn lỗi:", dataErr.message)
      setPolicies((data as CommissionPolicy[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getTypeLabel = (type: string) => COMMISSION_TYPES.find((t) => t.value === type)?.label || type
  const apDung = (p: CommissionPolicy) => (p.applies_to === "all" ? "Tất cả" : p.applies_to)
  const hieuLuc = (p: CommissionPolicy) =>
    `${p.effective_from ? formatDate(p.effective_from) : "-"} - ${p.effective_to ? formatDate(p.effective_to) : "∞"}`

  const locRows = useMemo(() => {
    const t = search.trim()
    return t ? policies.filter((p) => viMatchAllWords(t, p.name, getTypeLabel(p.type))) : policies
  }, [policies, search]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(
    () => (status === "all" ? locRows : locRows.filter((p) => (status === "active") === !!p.is_active)),
    [locRows, status]
  )
  const { pg, trang } = usePhanTrangTaiCho(shown, JSON.stringify([status, search]))

  const columns = useMemo(() => {
    const cols: Array<DocColumn<CommissionPolicy> & { k?: CommissionPolicyColumnKey }> = [
      {
        key: "name", label: "Tên chính sách", width: "minmax(240px,2fr)",
        sort: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "vi"),
        render: (p) => <DocCodeLink href={`/commissions/policies/${p.id}`}>{p.name}</DocCodeLink>,
      },
      { k: "type", key: "type", label: "Loại", width: "180px", render: (p) => <DocCellText>{getTypeLabel(p.type)}</DocCellText> },
      { k: "appliesTo", key: "appliesTo", label: "Áp dụng cho", width: "150px", render: (p) => <DocCellText muted>{apDung(p)}</DocCellText> },
      { k: "effective", key: "effective", label: "Hiệu lực", width: "200px", render: (p) => <DocCellText muted>{hieuLuc(p)}</DocCellText> },
      {
        k: "status", key: "status", label: "Trạng thái", width: "140px",
        render: (p) => <Badge variant={p.is_active ? "success" : "secondary"}>{p.is_active ? "Đang áp dụng" : "Ngừng"}</Badge>,
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? policies.find((p) => p.id === xemId) ?? null : null

  return (
    <div className="space-y-4">
      <PageHeader title="Chính sách hoa hồng" descriptionDesktopOnly description={`${policies.length} chính sách`} backHref="/commissions">
        {user && hasPermission(user.role, "commissions", "create") && (
          <Button onClick={() => router.push("/commissions/policies/new")}><Plus className="mr-2 h-4 w-4" /> Tạo chính sách</Button>
        )}
      </PageHeader>

      <StatusChips
        active={status}
        onPick={setStatus}
        chips={[
          { key: "active", label: "Đang áp dụng", count: locRows.filter((p) => p.is_active).length, accent: "#22c55e" },
          { key: "inactive", label: "Ngừng", count: locRows.filter((p) => !p.is_active).length, accent: "#98a2b3" },
          { key: "all", label: "Tất cả", count: locRows.length, accent: "#181c1e" },
        ]}
      />

      <MobileFilterBar value={search} onChange={setSearch} placeholder="Tìm tên chính sách…" activeCount={0} open={false} onOpenChange={() => {}} />

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm tên chính sách…" />
            <XoaLocButton show={!!search} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={<ColumnPicker available={COMMISSION_POLICY_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />}
        totals={null}
        loading={loading}
        isEmpty={shown.length === 0}
        empty={<EmptyState icon={<Settings2 className="h-8 w-8 text-muted-foreground" />} title={policies.length === 0 ? "Chưa có chính sách hoa hồng" : "Không có chính sách khớp"} />}
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(p) => setXemId(p.id)} />}
        cards={
          <DocCardList
            items={trang}
            onOpen={(p) => setXemId(p.id)}
            card={(p) => ({
              accent: p.is_active ? "#22c55e" : "#98a2b3",
              title: p.name,
              total: "",
              meta: `Hiệu lực: ${hieuLuc(p)}`,
              payment: apDung(p),
              summary: getTypeLabel(p.type),
              badge: p.is_active ? null : { label: "Ngừng", bg: "#eef1f5", fg: "#565a67" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.name ?? "Chính sách"}
        subtitle={xem ? hieuLuc(xem) : undefined}
        badge={xem ? <Badge variant={xem.is_active ? "success" : "secondary"}>{xem.is_active ? "Đang áp dụng" : "Ngừng"}</Badge> : null}
        fields={xem ? [
          { label: "Loại", value: getTypeLabel(xem.type) },
          { label: "Áp dụng cho", value: apDung(xem) },
          { label: "Hiệu lực", value: hieuLuc(xem), wide: true },
        ] : []}
        detailHref={xem ? `/commissions/policies/${xem.id}` : undefined}
      />
    </div>
  )
}
