"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { HopLoiTai } from "@/components/ui/hop-loi-tai"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { XuatExcelButton } from "@/components/ui/xuat-excel-button"
import { ChonMocThoiGian } from "@/components/customers/chon-moc-thoi-gian"
import { ArrowRightLeft, ChevronDown, ChevronUp, MapPin, PackageSearch, Phone, Search } from "lucide-react"
import { errorMessage } from "@/lib/errors"
import { canSeeHref } from "@/lib/nav/nav-permission"
import { vnDateKey } from "@/lib/orders/status-tone"
import { ngayVN } from "@/lib/xuat-excel/phieu"
import { CHUA_CO_TUYEN } from "@/lib/customers/tao-khach"
import {
  CHUA_GAN_CONG_TY, MOC_MAC_DINH, MOC_THOI_GIAN, NHAN_CHUA_GAN_CONG_TY, hangTheoKhach, khopTimKhach, laMoc,
  lanCuoiCuaKhach, napHangDaLay, nhomTheoTuyen, slHienThi, tuNgayTheoMoc, xuatDanhSachBanGiao,
  type DongHang, type HangDaLay, type MocThoiGian,
} from "@/lib/customers/ban-giao"

type NhanVien = { id: string; full_name: string }
type Tuyen = { code: string; name: string }

/** Số khách vẽ mỗi lượt — NV phụ trách vài trăm khách, vẽ hết một lúc là điện thoại khựng. */
const MOI_LUOT = 40
/** Số mặt hàng hiện sẵn trên một thẻ khách; còn lại bấm "xem thêm". */
const HANG_GON = 5

/**
 * HÀNG KHÁCH ĐÃ LẤY — "danh sách bàn giao" (chủ nhà 15/10/2026: "dskh tuyến đó, đã lấy hàng gì, số lượng, hàng cty nào
 * mà nv đó làm … thể hiện luôn trên máy của nv"). NVBH: khách mình đang phụ trách, chỉ hàng công ty mình làm (máy chủ
 * tự giới hạn — mig 246). Chủ / quản lý / kế toán: chọn NV để xem đúng danh sách NV ấy thấy, và xuất Excel.
 */
export default function HangKhachDaLayPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const params = useSearchParams()
  const laNv = user?.role === "sales"
  const xemNguoiKhac = !!user && ["owner", "manager", "accountant"].includes(user.role)

  const [nv, setNv] = useState<string>(params.get("nv") ?? "")
  const [moc, setMoc] = useState<MocThoiGian>(laMoc(params.get("moc")) ? (params.get("moc") as MocThoiGian) : MOC_MAC_DINH)
  const [homNay, setHomNay] = useState("")
  const [nhanVien, setNhanVien] = useState<NhanVien[]>([])
  const [tuyenDm, setTuyenDm] = useState<Tuyen[]>([])
  /** undefined = đang đọc; null = máy chủ chưa chạy mig 246. */
  const [d, setD] = useState<HangDaLay | null | undefined>(undefined)
  const [loi, setLoi] = useState<string | null>(null)
  const [lan, setLan] = useState(0)
  const [locTuyen, setLocTuyen] = useState<string | null>(null)
  const [locCongTy, setLocCongTy] = useState<string | null>(null)
  const [tim, setTim] = useState("")
  const [soHien, setSoHien] = useState(MOI_LUOT)
  const [moRong, setMoRong] = useState<Set<string>>(new Set())

  useEffect(() => setHomNay(vnDateKey(new Date())), [])

  // Danh mục tuyến (nhãn + thứ tự) và NV bán hàng để chọn (chủ / quản lý / kế toán).
  useEffect(() => {
    if (!user) return
    let huy = false
    ;(async () => {
      const { data, error } = await supabase.from("sales_routes").select("code, name, sort_order").order("sort_order").order("code")
      if (error) console.error("[hang-da-lay] đọc tuyến lỗi:", error.message)
      if (!huy) setTuyenDm(((data as Tuyen[] | null) ?? []).map((t) => ({ code: t.code, name: t.name })))
      if (!xemNguoiKhac) return
      const nvRes = await supabase.from("users").select("id, full_name, left_at").eq("role", "sales").order("full_name")
      if (nvRes.error) console.error("[hang-da-lay] đọc nhân viên lỗi:", nvRes.error.message)
      const ds = ((nvRes.data as Array<NhanVien & { left_at?: string | null }> | null) ?? []).filter((u) => !u.left_at)
      if (!huy) setNhanVien(ds.map((u) => ({ id: u.id, full_name: u.full_name })))
    })()
    return () => { huy = true }
  }, [user, xemNguoiKhac, supabase])

  const tuNgay = homNay ? tuNgayTheoMoc(moc, homNay) : null
  const canDoc = !!user && !!homNay && (laNv || (xemNguoiKhac && !!nv))

  useEffect(() => {
    if (!canDoc) {
      setD(undefined)
      return
    }
    let huy = false
    setD(undefined)
    setLoi(null)
    napHangDaLay(supabase, { nv: laNv ? null : nv, tu: tuNgay })
      .then((x) => { if (!huy) setD(x) })
      .catch((e) => { if (!huy) setLoi(errorMessage(e)) })
    return () => { huy = true }
  }, [canDoc, laNv, nv, tuNgay, supabase, lan])

  // Đổi NV / mốc → ghi vào địa chỉ (liên kết "Xem danh sách bàn giao của B" mở đúng chỗ) và về đầu danh sách.
  const doiNv = (id: string) => {
    setNv(id)
    setSoHien(MOI_LUOT)
    setLocTuyen(null)
    setLocCongTy(null)
    router.replace(`/customers/hang-da-lay?nv=${id}${moc !== MOC_MAC_DINH ? `&moc=${moc}` : ""}`)
  }
  const doiMoc = (m: MocThoiGian) => {
    setMoc(m)
    setSoHien(MOI_LUOT)
    if (xemNguoiKhac && nv) router.replace(`/customers/hang-da-lay?nv=${nv}${m !== MOC_MAC_DINH ? `&moc=${m}` : ""}`)
  }

  const congTyLoc = useMemo(() => (locCongTy ? new Set([locCongTy]) : null), [locCongTy])
  const hang = useMemo(() => (d ? hangTheoKhach(d, congTyLoc) : new Map<string, DongHang[]>()), [d, congTyLoc])

  const khachLoc = useMemo(() => {
    if (!d) return []
    return d.khach.filter((k) => {
      if (locTuyen && ((k.channel ?? "").trim() || CHUA_CO_TUYEN) !== locTuyen) return false
      // Đang lọc một công ty: chỉ khách có lấy hàng công ty ấy.
      if (locCongTy && !(hang.get(k.id)?.length)) return false
      return khopTimKhach(k, tim)
    })
  }, [d, locTuyen, locCongTy, tim, hang])

  const nhom = useMemo(() => nhomTheoTuyen(khachLoc.slice(0, soHien), tuyenDm), [khachLoc, soHien, tuyenDm])

  const chipTuyen = useMemo(() => {
    if (!d) return []
    const dem = new Map<string, number>()
    for (const k of d.khach) {
      const c = (k.channel ?? "").trim() || CHUA_CO_TUYEN
      dem.set(c, (dem.get(c) ?? 0) + 1)
    }
    return nhomTheoTuyen(d.khach, tuyenDm).map((g) => ({ key: g.code, label: g.nhan, count: dem.get(g.code) ?? 0 }))
  }, [d, tuyenDm])

  const chipCongTy = useMemo(() => {
    if (!d) return []
    const out = d.ncc.map((n) => ({ key: n.id, label: n.name }))
    if (d.sp.some((s) => !s.ncc)) out.push({ key: CHUA_GAN_CONG_TY, label: NHAN_CHUA_GAN_CONG_TY })
    return out
  }, [d])

  const coHang = khachLoc.filter((k) => (hang.get(k.id)?.length ?? 0) > 0).length
  const tenNv = nhanVien.find((u) => u.id === nv)?.full_name ?? ""
  const nhanMoc = MOC_THOI_GIAN.find((m) => m.key === moc)?.nhan.toLowerCase() ?? ""
  const congTyNv = d?.nv ? d.ncc.map((n) => n.name).join(", ") : ""

  const xuat = useCallback(async () => {
    if (!d) throw new Error("Chưa có danh sách để xuất")
    return {
      sheets: xuatDanhSachBanGiao(d, { tuyen: tuyenDm, congTy: congTyLoc, khachIds: new Set(khachLoc.map((k) => k.id)) }),
      soPhieu: khachLoc.length,
    }
  }, [d, tuyenDm, congTyLoc, khachLoc])

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const moTa = laNv
    ? congTyNv
      ? `Khách bạn đang phụ trách · hàng các công ty bạn làm: ${congTyNv}`
      : "Khách bạn đang phụ trách và hàng họ đã lấy"
    : "Danh sách bàn giao theo tuyến: khách của nhân viên, đã lấy hàng gì, bao nhiêu — chỉ hàng các công ty nhân viên ấy làm"

  return (
    <div className="space-y-4">
      <PageHeader title="Hàng khách đã lấy" description={moTa}>
        {xemNguoiKhac && (
          <XuatExcelButton
            module="customers"
            tenTep={`danh-sach-ban-giao${tenNv ? "-" + tenNv.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() : ""}`}
            donVi="khách"
            disabled={!d || khachLoc.length === 0}
            title="Xuất danh sách đang xem: mỗi dòng một khách × mặt hàng, kèm tuyến, công ty, số lượng"
            chuanBi={xuat}
          />
        )}
        {canSeeHref(user?.role, "/customers/ban-giao") && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href={nv ? `/customers/ban-giao?nv=${nv}` : "/customers/ban-giao"}>
              <ArrowRightLeft className="h-4 w-4" /> Bàn giao khách
            </Link>
          </Button>
        )}
      </PageHeader>

      {xemNguoiKhac && (
        <Card>
          <CardContent className="grid gap-3 pt-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Khách của nhân viên</Label>
              <Select value={nv || undefined} onValueChange={doiNv}>
                <SelectTrigger data-testid="chon-nv" aria-label="Chọn nhân viên">
                  <SelectValue placeholder="Chọn nhân viên bán hàng" />
                </SelectTrigger>
                <SelectContent>
                  {nhanVien.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {d?.nv && (
              <p className="text-xs text-muted-foreground" data-testid="cong-ty-nv">
                {congTyNv ? `Công ty ${tenNv || "nhân viên"} làm: ${congTyNv}` : `${tenNv || "Nhân viên"} chưa được gán công ty nào — chỉ hiện hàng chưa gán công ty`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {xemNguoiKhac && !nv ? (
        <EmptyState
          icon={<PackageSearch className="h-10 w-10 text-muted-foreground/60" />}
          title="Chọn nhân viên để xem danh sách"
          description="Danh sách gồm các khách nhân viên đang phụ trách theo từng tuyến, hàng họ đã lấy và số lượng — đúng như nhân viên thấy trên điện thoại."
        />
      ) : d === null ? (
        <HopLoiTai tieuDe="Chưa có danh sách hàng khách đã lấy" loi="Máy chủ chưa có chức năng này — cần chạy migration 246 trên Supabase." />
      ) : loi ? (
        <HopLoiTai tieuDe="Không đọc được hàng khách đã lấy" loi={loi} onRetry={() => setLan((x) => x + 1)} />
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ChonMocThoiGian value={moc} onChange={doiMoc} />
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={tim}
                  onChange={(e) => { setTim(e.target.value); setSoHien(MOI_LUOT) }}
                  placeholder="Tìm tên, SĐT, địa chỉ…"
                  className="pl-9"
                  aria-label="Tìm khách trong danh sách"
                  data-testid="tim-khach"
                />
              </div>
            </div>
            {chipTuyen.length > 1 && (
              <SegmentedScroller ariaLabel="Lọc theo tuyến" segments={chipTuyen} value={locTuyen}
                onChange={(k) => { setLocTuyen(k); setSoHien(MOI_LUOT) }} />
            )}
            {chipCongTy.length > 1 && (
              <SegmentedScroller ariaLabel="Lọc theo công ty" segments={chipCongTy} value={locCongTy}
                onChange={(k) => { setLocCongTy(k); setSoHien(MOI_LUOT) }} />
            )}
          </div>

          {d === undefined ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
            </div>
          ) : d.khach.length === 0 ? (
            <EmptyState
              icon={<PackageSearch className="h-10 w-10 text-muted-foreground/60" />}
              title={laNv ? "Bạn chưa phụ trách khách nào" : "Nhân viên này chưa phụ trách khách nào"}
              description={laNv ? "Nhận khách về danh sách ở màn Khách hàng, hoặc nhờ quản lý bàn giao khách cho bạn." : "Dùng Bàn giao khách để giao khách cho nhân viên này."}
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground tabular-nums" data-testid="tong-khach">
                {khachLoc.length} khách · {coHang} khách có lấy hàng{moc === "tat-ca" ? "" : ` trong ${nhanMoc} qua`}
              </p>
              {khachLoc.length === 0 ? (
                <p className="rounded-xl border bg-card py-8 text-center text-sm text-muted-foreground">Không có khách khớp bộ lọc</p>
              ) : (
                nhom.map((g) => (
                  <section key={g.code} className="space-y-2" data-testid="nhom-tuyen">
                    <h2 className="text-sm font-bold text-on-surface">
                      {g.nhan} <span className="font-semibold text-muted-foreground">· {g.khach.length} khách</span>
                    </h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {g.khach.map((k) => {
                        const ds = hang.get(k.id) ?? []
                        const mo = moRong.has(k.id)
                        const hien = mo ? ds : ds.slice(0, HANG_GON)
                        const cuoi = lanCuoiCuaKhach(ds)
                        return (
                          <Card key={k.id} className="overflow-hidden" data-testid="the-khach">
                            <CardContent className="space-y-2 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <Link href={`/customers/${k.id}`} className="block truncate text-sm font-bold text-primary hover:underline">
                                    {k.store_name}
                                  </Link>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {[k.owner_name, k.phone].filter(Boolean).join(" · ")}
                                  </p>
                                  {(k.address || k.ward) && (
                                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                      <MapPin className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{[k.address, k.ward].filter(Boolean).join(", ")}</span>
                                    </p>
                                  )}
                                </div>
                                {k.phone && (
                                  <a href={`tel:${k.phone}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-primary" aria-label={`Gọi ${k.store_name}`}>
                                    <Phone className="h-4 w-4" />
                                  </a>
                                )}
                              </div>
                              {!laNv && k.nv_chinh && (
                                <p className="text-[11px] text-muted-foreground">Phụ trách chính: {k.nv_chinh}</p>
                              )}
                              {ds.length === 0 ? (
                                <p className="rounded-lg bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground" data-testid="chua-lay">
                                  {moc === "tat-ca" ? "Chưa lấy hàng" : `Chưa lấy hàng trong ${nhanMoc} qua`}
                                </p>
                              ) : (
                                <ul className="divide-y rounded-lg border">
                                  {hien.map((h) => (
                                    <li key={h.productId} className="flex items-center gap-2 px-2 py-1.5" data-testid="dong-hang">
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-medium">{h.ten}</p>
                                        <p className="truncate text-[11px] text-muted-foreground">{h.congTy} · {h.lan} lần</p>
                                      </div>
                                      <span className="shrink-0 text-right text-[13px] font-bold tabular-nums">{slHienThi(h.sl, h.donVi)}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span>{cuoi ? `Lần lấy cuối ${ngayVN(cuoi)}` : ""}</span>
                                {ds.length > HANG_GON && (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-0.5 font-semibold text-primary"
                                    onClick={() => setMoRong((s) => {
                                      const n = new Set(s)
                                      if (n.has(k.id)) n.delete(k.id)
                                      else n.add(k.id)
                                      return n
                                    })}
                                  >
                                    {mo ? <>Thu gọn <ChevronUp className="h-3 w-3" /></> : <>+{ds.length - HANG_GON} mặt hàng <ChevronDown className="h-3 w-3" /></>}
                                  </button>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  </section>
                ))
              )}
              {khachLoc.length > soHien && (
                <Button variant="outline" className="h-11 w-full" onClick={() => setSoHien((n) => n + MOI_LUOT)}>
                  Xem thêm {Math.min(MOI_LUOT, khachLoc.length - soHien)} khách ({soHien}/{khachLoc.length})
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
