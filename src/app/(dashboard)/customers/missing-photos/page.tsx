"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { Camera, MapPin, Navigation, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react"
import { MAX_PHOTOS, linkAnhDiemBan } from "@/lib/customers/photos"
import { truncationWarning } from "@/lib/supabase/aggregate"
import { errorMessage } from "@/lib/errors"
import { canDuyet, demAnhTheoKhach, docDuyetAnh, docKhachDangBan } from "./doc-anh"
import { canApprovePhotos, chuaCoDuyetAnh } from "@/lib/customers/photo-approval"
import {
  TAB_THIEU, chuaCoRpc, docTrangChoDuyet, docTrangThieuAnh, ghepTrang, type DongChoDuyet, type DongThieuAnh, type TabThieu,
} from "./rpc-thieu-anh"

type Row = DongThieuAnh

type Tab = TabThieu | "approval"

const TAB_LABEL: Record<Tab, string> = {
  all: "Còn thiếu",
  no_photo: "Chưa có ảnh",
  no_gps: "Chưa có vị trí",
  approval: "Chờ duyệt",
}

/** Trạng thái duyệt ảnh (mig 244); null = máy chủ chưa có bước duyệt / người xem không có quyền duyệt. */
type Duyet = { approved: Set<string>; pending: Map<string, number> }

/**
 * Danh sách điểm bán còn thiếu ảnh hoặc vị trí.
 *
 * Đây là đích của thông báo nhắc nhở: mở ra là thấy ngay việc cần làm,
 * kèm nút chỉ đường tới nơi. Không có màn này thì thông báo "12 điểm bán
 * chưa có ảnh" chỉ là một lời trách, không phải một việc làm được.
 *
 * RLS tự lọc: NVBH chỉ thấy khách mình phụ trách, nên không cần (và
 * không được) lọc theo người ở đây.
 *
 * ⚠ HAI ĐƯỒNG ĐỌC (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm"): sổ có RPC mig 253 thì máy chủ lọc + đếm + phân
 *   trang, máy chỉ nhận trang đang xem; sổ chưa có thì lùi về cách cũ (kéo cả sổ khách + cả bảng ảnh về lọc trên máy).
 */
export default function MissingPhotosPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("customers")
  const supabase = createClient()

  const [rows, setRows] = useState<Row[]>([])
  /** Đường cũ: mọi điểm bán đang hoạt động (kể cả đã đủ ảnh) — tab "Chờ duyệt" cần cả những điểm bán ấy. */
  const [allRows, setAllRows] = useState<Row[]>([])
  const [duyet, setDuyet] = useState<Duyet | null>(null)
  const canApprove = canApprovePhotos(user?.role)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("all")
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** `true` = đường RPC (máy chủ phân trang); `false` = đường cũ; `null` = chưa biết. */
  const [rpc, setRpc] = useState<boolean | null>(null)
  const cheDo = useRef<"rpc" | "cu" | null>(null)
  /** Tổng số dòng khớp từng tab (đường RPC) — số trên tab + nút Tải thêm. */
  const [tong, setTong] = useState<Partial<Record<Tab, number>>>({})
  const [choDuyetRpc, setChoDuyetRpc] = useState<DongChoDuyet[]>([])
  const [dangThem, setDangThem] = useState(false)

  /* ---------------- Đường cũ: sổ chưa có RPC mig 253 ---------------- */
  const taiCachCu = useCallback(async () => {
    // Hai truy vấn rồi ghép ở máy khách, KHÔNG dùng anti-join qua embed:
    // PostgREST không diễn đạt được "khách CHƯA có ảnh nào" một cách
    // chắc chắn, và một embed hiểu sai sẽ trả ra danh sách rỗng trông y
    // như "đã làm xong hết".
    //
    // ⚠ ĐỌC ĐỦ CẢ HAI BẢNG (xem `doc-anh.ts`) — `.limit(CAP)` cũ bị trần
    //   1.000 dòng cắt, khách đã có ảnh bị đếm 0 ảnh.
    let customers: Array<Omit<Row, "photoCount">> = []
    let counts = new Map<string, number>()
    try {
      const [custRes, photoRes] = await Promise.all([
        docKhachDangBan<Omit<Row, "photoCount">>(supabase, "id, store_name, address, phone, gps_lat, gps_lng", null),
        demAnhTheoKhach(supabase, null),
      ])
      customers = custRes.rows
      counts = photoRes.counts
      // ⚠ Bảng ảnh chạm trần thì "0 ảnh" có thể là SAI — cũng phải nói ra.
      setTruncated(custRes.truncated || photoRes.truncated)
    } catch (err) {
      setError(errorMessage(err))
      setRows([])
      return
    }
    const all = customers.map((c) => ({ ...c, photoCount: counts.get(c.id) ?? 0 }))
    setAllRows(all)
    setRows(all.filter((c) => c.photoCount === 0 || c.gps_lat == null || c.gps_lng == null))
    // Chờ duyệt (mig 244) — chỉ người duyệt. Máy chủ chưa chạy migration thì ẩn tab, không làm hỏng cả màn.
    if (canApprove) {
      try {
        const d = await docDuyetAnh(supabase, null)
        setDuyet({ approved: d.approved, pending: d.pending })
        if (d.truncated) setTruncated(true)
      } catch (err) {
        setDuyet(null)
        if (!chuaCoDuyetAnh(err)) setError(errorMessage(err))
      }
    }
  }, [canApprove]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Đường RPC: trang đầu của tab đang xem + tổng của các tab còn lại (1 dòng mỗi câu) ---------------- */
  const taiRpc = useCallback(async (t: Tab) => {
    if (t === "approval") {
      const [kq, ...dem] = await Promise.all([docTrangChoDuyet(supabase, 0), ...TAB_THIEU.map((k) => docTrangThieuAnh(supabase, k, 0, 1))])
      setChoDuyetRpc(kq.rows)
      setDuyet({ approved: new Set(kq.rows.filter((r) => r.daDuyet).map((r) => r.id)), pending: new Map(kq.rows.map((r) => [r.id, r.soYeuCau])) })
      setTong({ approval: kq.tong ?? 0, all: dem[0].tong ?? 0, no_photo: dem[1].tong ?? 0, no_gps: dem[2].tong ?? 0 })
      return
    }
    const khac = TAB_THIEU.filter((k) => k !== t)
    const [kq, ...conLai] = await Promise.all([
      docTrangThieuAnh(supabase, t, 0),
      ...khac.map((k) => docTrangThieuAnh(supabase, k, 0, 1)),
      canApprove ? docTrangChoDuyet(supabase, 0, 1) : Promise.resolve(null),
    ])
    setRows(kq.rows)
    const tongMoi: Partial<Record<Tab, number>> = { [t]: kq.tong ?? 0 }
    khac.forEach((k, i) => { tongMoi[k] = conLai[i]?.tong ?? 0 })
    const cd = conLai[khac.length]
    if (canApprove && cd) {
      tongMoi.approval = cd.tong ?? 0
      /* Tab Chờ duyệt hiện ra; danh sách của nó đọc khi bấm vào. */
      setDuyet((cu) => cu ?? { approved: new Set(), pending: new Map() })
    }
    setTong(tongMoi)
  }, [canApprove]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (t: Tab) => {
    if (!user?.org_id) return
    /* Đường cũ đã tải đủ một lần — đổi tab chỉ lọc trên máy. */
    if (cheDo.current === "cu") return
    setLoading(true)
    setError(null)
    try {
      await taiRpc(t)
      cheDo.current = "rpc"
      setRpc(true)
    } catch (err) {
      if (cheDo.current === null && chuaCoRpc(err)) {
        cheDo.current = "cu"
        setRpc(false)
        await taiCachCu()
      } else {
        setError(errorMessage(err))
      }
    }
    setLoading(false)
  }, [user?.org_id, taiRpc, taiCachCu])

  useEffect(() => { load(tab) }, [load, tab])

  const choDuyet: Row[] = rpc ? choDuyetRpc : duyet ? canDuyet(allRows, duyet) : []
  const shown: Row[] =
    tab === "approval"
      ? choDuyet
      : rpc
        ? rows
        : rows.filter((r) => {
            if (tab === "no_photo") return r.photoCount === 0
            if (tab === "no_gps") return r.gps_lat == null || r.gps_lng == null
            return true
          })
  const tabs: Tab[] = duyet ? ["all", "no_photo", "no_gps", "approval"] : ["all", "no_photo", "no_gps"]
  const demTab = (t: Tab): number | undefined =>
    rpc
      ? tong[t]
      : t === "approval"
        ? choDuyet.length
        : rows.filter((r) => (t === "no_photo" ? r.photoCount === 0 : t === "no_gps" ? r.gps_lat == null || r.gps_lng == null : true)).length
  /* Còn dòng chưa tải (đường RPC) → nút Tải thêm. */
  const conThem = rpc === true && (tong[tab] ?? 0) > shown.length

  const themTrang = useCallback(async () => {
    setDangThem(true)
    try {
      if (tab === "approval") {
        const kq = await docTrangChoDuyet(supabase, choDuyetRpc.length)
        setChoDuyetRpc((cu) => ghepTrang(cu, kq.rows))
        setDuyet((cu) => ({
          approved: new Set([...Array.from(cu?.approved ?? []), ...kq.rows.filter((r) => r.daDuyet).map((r) => r.id)]),
          pending: new Map([...Array.from(cu?.pending ?? []), ...kq.rows.map((r) => [r.id, r.soYeuCau] as const)]),
        }))
        if (kq.tong != null) setTong((cu) => ({ ...cu, approval: kq.tong ?? 0 }))
      } else {
        const kq = await docTrangThieuAnh(supabase, tab, rows.length)
        setRows((cu) => ghepTrang(cu, kq.rows))
        if (kq.tong != null) setTong((cu) => ({ ...cu, [tab]: kq.tong ?? 0 }))
      }
    } catch (err) {
      setError(errorMessage(err))
    }
    setDangThem(false)
  }, [tab, rows.length, choDuyetRpc.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4 pb-nav lg:pb-0">
      <PageHeader
        title="Điểm bán cần cập nhật"
        description="Tạo danh sách trước, chụp ảnh và lấy vị trí khi tới nơi."
        backHref="/customers"
      />

      <SegmentedScroller
        segments={tabs.map((t) => ({ key: t, label: TAB_LABEL[t], count: demTab(t) }))}
        value={tab}
        onChange={(t) => t && setTab(t as Tab)}
        ariaLabel="Lọc điểm bán còn thiếu"
      />

      {error && (
        <p className="flex items-start gap-1.5 text-sm font-semibold text-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {truncated && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-error">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Danh sách chạm trần nạp — còn nữa nhưng chưa nạp hết. {truncationWarning()}
        </p>
      )}

      {loading ? (
        <Skeleton className="h-64" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-tertiary" />}
          title={tab === "approval" ? "Không có điểm bán nào chờ duyệt" : "Không còn điểm bán nào thiếu"}
          description={
            tab === "approval"
              ? "Ảnh + vị trí của mọi điểm bán đã được duyệt, không có yêu cầu đổi nào đang chờ."
              : "Mọi điểm bán đang hoạt động đều đã có ảnh và vị trí."
          }
        />
      ) : tab === "approval" && duyet ? (
        <div className="space-y-2" data-testid="ds-cho-duyet-anh">
          {shown.map((r) => {
            const soYeuCau = duyet.pending.get(r.id) ?? 0
            const chuaDuyet = !duyet.approved.has(r.id)
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-outline-variant p-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold">{r.store_name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chuaDuyet && <Badge variant="warning">Chưa duyệt ảnh + vị trí</Badge>}
                    {soYeuCau > 0 && <Badge variant="warning">{soYeuCau} yêu cầu đổi chờ duyệt</Badge>}
                    <Badge variant="secondary">{r.photoCount}/{MAX_PHOTOS} ảnh</Badge>
                  </div>
                </div>
                <Button asChild className="h-11 shrink-0 text-[12px]">
                  <Link href={linkAnhDiemBan(r.id)}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Mở để duyệt
                  </Link>
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const noPhoto = r.photoCount === 0
            const noGps = r.gps_lat == null || r.gps_lng == null
            return (
              <div key={r.id} className="rounded-xl border border-outline-variant p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold">{r.store_name}</p>
                    <p className="truncate text-xs text-on-surface-variant">
                      {r.address || "Chưa có địa chỉ"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {noPhoto ? (
                      <Badge variant="warning">Chưa có ảnh</Badge>
                    ) : (
                      <Badge variant="secondary">{r.photoCount}/{MAX_PHOTOS} ảnh</Badge>
                    )}
                    {noGps && <Badge variant="warning">Chưa có vị trí</Badge>}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {/* Chỉ đường CHỈ khi thật sự có toạ độ. Điểm bán chưa
                      ghim mà vẫn hiện nút là dẫn người ta đi lạc. */}
                  {!noGps ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${r.gps_lat},${r.gps_lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap flex h-11 items-center justify-center gap-1 rounded-lg border border-outline-variant text-[12px] font-semibold"
                    >
                      <Navigation className="h-3.5 w-3.5" /> Chỉ đường
                    </a>
                  ) : r.address ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tap flex h-11 items-center justify-center gap-1 rounded-lg border border-dashed border-outline-variant text-[12px] font-semibold"
                    >
                      <MapPin className="h-3.5 w-3.5" /> Theo địa chỉ
                    </a>
                  ) : (
                    <span className="flex h-11 items-center justify-center rounded-lg border border-dashed border-outline-variant text-[12px] text-on-surface-variant">
                      Không có địa chỉ
                    </span>
                  )}
                  {/* Mở thẳng khối ảnh điểm bán, không phải cuộn xuống tìm (chủ nhà 20/10/2026). */}
                  <Button asChild className="h-11 text-[12px]">
                    <Link href={linkAnhDiemBan(r.id)}>
                      <Camera className="mr-1 h-3.5 w-3.5" /> Mở để chụp
                    </Link>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && conThem && (
        <div className="flex flex-col items-center gap-1 pt-1">
          <p className="text-xs text-on-surface-variant">Đã hiển thị {shown.length} / {tong[tab] ?? 0} điểm bán</p>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={themTrang} disabled={dangThem}>
            {dangThem ? "Đang tải…" : `Tải thêm ${Math.min(50, (tong[tab] ?? 0) - shown.length)} điểm bán`}
          </Button>
        </div>
      )}
    </div>
  )
}
