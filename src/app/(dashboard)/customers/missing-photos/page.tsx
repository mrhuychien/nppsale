"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { Camera, MapPin, Navigation, CheckCircle2, AlertTriangle } from "lucide-react"
import { MAX_PHOTOS } from "@/lib/customers/photos"

/** Trần nạp. Trên trần thì NÓI RA, không cắt im lặng. */
const CAP = 2000

type Row = {
  id: string
  store_name: string
  address: string | null
  phone: string | null
  gps_lat: number | null
  gps_lng: number | null
  photoCount: number
}

type Tab = "all" | "no_photo" | "no_gps"

const TAB_LABEL: Record<Tab, string> = {
  all: "Còn thiếu",
  no_photo: "Chưa có ảnh",
  no_gps: "Chưa có vị trí",
}

/**
 * Danh sách điểm bán còn thiếu ảnh hoặc vị trí.
 *
 * Đây là đích của thông báo nhắc nhở: mở ra là thấy ngay việc cần làm,
 * kèm nút chỉ đường tới nơi. Không có màn này thì thông báo "12 điểm bán
 * chưa có ảnh" chỉ là một lời trách, không phải một việc làm được.
 *
 * RLS tự lọc: NVBH chỉ thấy khách mình phụ trách, nên không cần (và
 * không được) lọc theo người ở đây.
 */
export default function MissingPhotosPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("customers")
  const supabase = createClient()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("all")
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    setError(null)
    // Hai truy vấn rồi ghép ở máy khách, KHÔNG dùng anti-join qua embed:
    // PostgREST không diễn đạt được "khách CHƯA có ảnh nào" một cách
    // chắc chắn, và một embed hiểu sai sẽ trả ra danh sách rỗng trông y
    // như "đã làm xong hết".
    const [custRes, photoRes] = await Promise.all([
      supabase
        .from("customers")
        .select("id, store_name, address, phone, gps_lat, gps_lng")
        .eq("status", "active")
        .order("store_name")
        .limit(CAP),
      supabase.from("customer_photos").select("customer_id").limit(CAP * MAX_PHOTOS),
    ])
    const qErr = [custRes, photoRes].find((r) => r.error)?.error
    if (qErr) {
      setError(qErr.message)
      setRows([])
      setLoading(false)
      return
    }
    const counts = new Map<string, number>()
    for (const p of (photoRes.data || []) as Array<{ customer_id: string }>) {
      counts.set(p.customer_id, (counts.get(p.customer_id) ?? 0) + 1)
    }
    const customers = (custRes.data || []) as Array<Omit<Row, "photoCount">>
    setTruncated(customers.length >= CAP)
    setRows(
      customers
        .map((c) => ({ ...c, photoCount: counts.get(c.id) ?? 0 }))
        .filter((c) => c.photoCount === 0 || c.gps_lat == null || c.gps_lng == null)
    )
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const shown = rows.filter((r) => {
    if (tab === "no_photo") return r.photoCount === 0
    if (tab === "no_gps") return r.gps_lat == null || r.gps_lng == null
    return true
  })

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4 pb-nav lg:pb-0">
      <PageHeader
        title="Điểm bán cần cập nhật"
        description="Tạo danh sách trước, chụp ảnh và lấy vị trí khi tới nơi."
        backHref="/customers"
      />

      <SegmentedScroller
        segments={(["all", "no_photo", "no_gps"] as Tab[]).map((t) => ({
          key: t,
          label: TAB_LABEL[t],
          count: rows.filter((r) =>
            t === "no_photo" ? r.photoCount === 0
              : t === "no_gps" ? r.gps_lat == null || r.gps_lng == null
                : true
          ).length,
        }))}
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
          Danh sách chạm trần {CAP} điểm bán — còn nữa nhưng chưa nạp hết.
        </p>
      )}

      {loading ? (
        <Skeleton className="h-64" />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-tertiary" />}
          title="Không còn điểm bán nào thiếu"
          description="Mọi điểm bán đang hoạt động đều đã có ảnh và vị trí."
        />
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
                  <Button asChild className="h-11 text-[12px]">
                    <Link href={`/customers/${r.id}`}>
                      <Camera className="mr-1 h-3.5 w-3.5" /> Mở để chụp
                    </Link>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
