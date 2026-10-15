"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChonMocThoiGian } from "@/components/customers/chon-moc-thoi-gian"
import { ArrowRightLeft, CheckCircle2, History, Loader2, Users } from "lucide-react"
import { cn, formatCurrency } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { vnDateKey, vnTime } from "@/lib/orders/status-tone"
import { ngayVN } from "@/lib/xuat-excel/phieu"
import { napTenNguoi } from "@/lib/xuat-excel/nap"
import { CHUA_CO_TUYEN } from "@/lib/customers/tao-khach"
import {
  MOC_MAC_DINH, NHAN_KIEU, NHAN_NGUON, kieuHopLe, nhanLich, nhanSeLa, nhanTuyen, nhanVai, thucHienBanGiao,
  tongDaChon, tuNgayTheoMoc, xemTruocBanGiao,
  type KetQuaBanGiao, type KhachBanGiao, type KieuBanGiao, type MocThoiGian, type NguonBanGiao, type ThamSoBanGiao,
  type TongBanGiao,
} from "@/lib/customers/ban-giao"

type NhanVien = { id: string; full_name: string; is_active: boolean | null }
type Muc = { id: string; ten: string }
type Nhat = {
  id: string; nguon: NguonBanGiao; tu_nv: string | null; den_nv: string | null; kieu: KieuBanGiao
  khach: string[]; ket_qua: Partial<KetQuaBanGiao> | null; tao_boi: string | null; tao_luc: string
}

/** Chip chọn NHIỀU (tuyến, công ty) — không chọn gì = không lọc. */
function ChipNhieu({ muc, chon, onDoi, nhan, testId }: {
  muc: Muc[]; chon: string[]; onDoi: (ds: string[]) => void; nhan: string; testId: string
}) {
  return (
    <div role="group" aria-label={nhan} className="flex flex-wrap gap-1.5" data-testid={testId}>
      {muc.map((m) => {
        const bat = chon.includes(m.id)
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={bat}
            onClick={() => onDoi(bat ? chon.filter((x) => x !== m.id) : [...chon, m.id])}
            className={cn(
              "h-9 rounded-full border px-3 text-xs font-semibold transition-colors",
              bat ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/40"
            )}
          >
            {m.ten}
          </button>
        )
      })}
    </div>
  )
}

/**
 * BÀN GIAO KHÁCH — chủ nhà 15/10/2026: "Gán cho toàn bộ khách hàng của nv A cho nv B (làm chung khách hàng) Hoặc là
 * như kiểu bàn giao lại khách hàng". Chủ NPP / quản lý chọn khách (của một NV / chưa ai phụ trách / mọi khách; lọc tuyến,
 * công ty), NV nhận, kiểu → Xem trước (bỏ chọn từng khách được) → xác nhận. Luật ở máy chủ (`ban_giao_khach`, mig 246).
 */
export default function BanGiaoKhachPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const params = useSearchParams()

  const [nhanVien, setNhanVien] = useState<NhanVien[]>([])
  const [tuyenDm, setTuyenDm] = useState<Array<{ code: string; name: string }>>([])
  const [congTyDm, setCongTyDm] = useState<Muc[]>([])
  const [loiDm, setLoiDm] = useState<string | null>(null)

  const [nguon, setNguon] = useState<NguonBanGiao>("nv")
  const [tuNv, setTuNv] = useState(params.get("nv") ?? "")
  const [denNv, setDenNv] = useState("")
  const [kieu, setKieu] = useState<KieuBanGiao>("chung")
  const [tuyen, setTuyen] = useState<string[]>([])
  const [ncc, setNcc] = useState<string[]>([])
  const [moc, setMoc] = useState<MocThoiGian>(MOC_MAC_DINH)
  const [giaoNoNpp, setGiaoNoNpp] = useState(true)

  const [xt, setXt] = useState<{ khach: KhachBanGiao[]; tong: TongBanGiao } | null>(null)
  const [chon, setChon] = useState<Set<string>>(new Set())
  const [dangXem, setDangXem] = useState(false)
  const [loiXem, setLoiXem] = useState<string | null>(null)
  const [hoi, setHoi] = useState(false)
  const [dangGiao, setDangGiao] = useState(false)
  const [kq, setKq] = useState<{ ket: KetQuaBanGiao; kieu: KieuBanGiao; tenNhan: string; denNv: string; tenGiao: string } | null>(null)
  const [nhat, setNhat] = useState<Nhat[] | null>(null)
  const [tenNguoi, setTenNguoi] = useState<Map<string, string>>(new Map())
  const [loiNhat, setLoiNhat] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let huy = false
    ;(async () => {
      try {
        const [nvRes, tRes, cRes] = await Promise.all([
          supabase.from("users").select("id, full_name, is_active, left_at").eq("role", "sales").order("full_name"),
          supabase.from("sales_routes").select("code, name, sort_order").order("sort_order").order("code"),
          supabase.from("suppliers").select("id, name").order("name"),
        ])
        if (nvRes.error) throw nvRes.error
        if (tRes.error) throw tRes.error
        if (cRes.error) throw cRes.error
        if (huy) return
        setNhanVien(((nvRes.data as Array<NhanVien & { left_at?: string | null }> | null) ?? []).filter((u) => !u.left_at))
        setTuyenDm(((tRes.data as Array<{ code: string; name: string }> | null) ?? []).map((t) => ({ code: t.code, name: t.name })))
        setCongTyDm(((cRes.data as Array<{ id: string; name: string }> | null) ?? []).map((c) => ({ id: c.id, ten: c.name })))
      } catch (e) {
        if (!huy) setLoiDm(errorMessage(e, "Không đọc được nhân viên / tuyến / công ty"))
      }
    })()
    return () => { huy = true }
  }, [user, supabase])

  const napNhat = useCallback(async () => {
    const { data, error } = await supabase
      .from("ban_giao_khach_log")
      .select("id, nguon, tu_nv, den_nv, kieu, khach, ket_qua, tao_boi, tao_luc")
      .order("tao_luc", { ascending: false })
      .limit(10)
    if (error) {
      setLoiNhat(["42P01", "PGRST205"].includes(String(error.code)) ? "Cần chạy migration 246 trên Supabase." : error.message)
      setNhat([])
      return
    }
    const ds = (data as Nhat[] | null) ?? []
    setNhat(ds)
    setLoiNhat(null)
    try {
      setTenNguoi(await napTenNguoi(supabase, ds.flatMap((r) => [r.tu_nv, r.den_nv, r.tao_boi])))
    } catch (e) {
      console.error("[ban-giao] đọc tên người lỗi:", e)
    }
  }, [supabase])

  useEffect(() => { if (user) void napNhat() }, [user, napNhat])

  // Đổi bất kỳ lựa chọn nào → bảng xem trước cũ không còn đúng.
  const khoaThamSo = [nguon, tuNv, denNv, kieu, tuyen.join(","), ncc.join(","), moc, giaoNoNpp].join("|")
  useEffect(() => {
    setXt(null)
    setLoiXem(null)
  }, [khoaThamSo])

  const tenCua = (id: string | null | undefined) =>
    (id && (nhanVien.find((u) => u.id === id)?.full_name ?? tenNguoi.get(id))) || ""

  const thamSo = (): ThamSoBanGiao => ({
    nguon, tuNv: nguon === "nv" ? tuNv : null, denNv, kieu: kieuHopLe(nguon, kieu) ? kieu : "chung",
    tuyen, ncc, tuNgay: ncc.length > 0 ? tuNgayTheoMoc(moc, vnDateKey(new Date())) : null, giaoNoNpp,
  })

  const thieu =
    nguon === "nv" && !tuNv ? "Chọn nhân viên giao khách"
      : !denNv ? "Chọn nhân viên nhận"
        : nguon === "nv" && tuNv === denNv ? "Nhân viên giao và nhận là một người"
          : null

  const xemTruoc = async () => {
    if (thieu) return
    setDangXem(true)
    setLoiXem(null)
    setKq(null)
    try {
      const r = await xemTruocBanGiao(supabase, thamSo())
      setXt(r)
      setChon(new Set(r.khach.map((k) => k.id)))
    } catch (e) {
      setXt(null)
      setLoiXem(errorMessage(e, "Không xem trước được"))
    } finally {
      setDangXem(false)
    }
  }

  const tong = xt ? tongDaChon(xt.khach, chon) : null
  const tenNhan = tenCua(denNv)
  const tenGiao = nguon === "nv" ? tenCua(tuNv) : ""
  const kieuDung: KieuBanGiao = kieuHopLe(nguon, kieu) ? kieu : "chung"

  const giao = async () => {
    if (!xt || !tong || tong.so_khach === 0) return
    setDangGiao(true)
    try {
      const ket = await thucHienBanGiao(supabase, thamSo(), xt.khach.filter((k) => chon.has(k.id)).map((k) => k.id))
      setKq({ ket, kieu: kieuDung, tenNhan, denNv, tenGiao })
      setXt(null)
      setHoi(false)
      toast({ title: `Đã giao ${ket.so_khach} khách cho ${tenNhan}` })
      void napNhat()
    } catch (e) {
      toast({ title: "Không bàn giao được", description: errorMessage(e, "Máy chủ chưa nhận lệnh bàn giao"), variant: "destructive" })
    } finally {
      setDangGiao(false)
    }
  }

  const moTaXacNhan = (() => {
    if (!tong) return ""
    if (kieuDung === "chuyen") {
      return `${tenGiao} thôi phụ trách ${tong.so_khach} khách. `
        + (tong.no_chuyen.so > 0 ? `${tong.no_chuyen.so} khoản nợ chưa thu (${formatCurrency(tong.no_chuyen.tien)}) chuyển sang ${tenNhan}. ` : "Không có nợ chưa thu để chuyển. ")
        + `Doanh số các hoá đơn cũ vẫn của ${tenGiao}.`
        + (tong.no_npp.so > 0 ? ` Kèm ${tong.no_npp.so} khoản nợ NPP đang giữ (${formatCurrency(tong.no_npp.tien)}).` : "")
    }
    return `${tenNhan} được thêm vào ${tong.them_moi} khách${tong.da_co ? ` (${tong.da_co} khách đã có ${tenNhan})` : ""}.`
      + (nguon === "nv" ? ` ${tenGiao} vẫn giữ khách và công nợ.` : "")
      + (tong.lich > 0 ? ` Chép ${tong.lich} lượt đi tuyến.` : "")
      + (tong.no_npp.so > 0 ? ` Kèm ${tong.no_npp.so} khoản nợ NPP đang giữ (${formatCurrency(tong.no_npp.tien)}).` : "")
  })()

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const nvNhan = nhanVien.filter((u) => u.is_active !== false && u.id !== (nguon === "nv" ? tuNv : ""))
  const mucTuyen: Muc[] = [...tuyenDm.map((t) => ({ id: t.code, ten: nhanTuyen(t.code, tuyenDm) })), { id: CHUA_CO_TUYEN, ten: "Chưa có tuyến" }]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bàn giao khách"
        description="Giao khách của một nhân viên cho nhân viên khác — làm chung, hoặc chuyển hẳn kèm công nợ chưa thu. Doanh số hoá đơn cũ không đổi."
      >
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={denNv ? `/customers/hang-da-lay?nv=${denNv}` : "/customers/hang-da-lay"}>
            <Users className="h-4 w-4" /> Danh sách bàn giao
          </Link>
        </Button>
      </PageHeader>

      {loiDm && <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">Không đọc được danh mục: {loiDm}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">1. Khách cần giao</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nguồn khách</Label>
                <div role="radiogroup" aria-label="Nguồn khách" className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(NHAN_NGUON) as NguonBanGiao[]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={nguon === n}
                      data-testid={`nguon-${n}`}
                      onClick={() => setNguon(n)}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors",
                        nguon === n ? "border-primary bg-primary/5 text-primary" : "bg-card hover:bg-muted/40"
                      )}
                    >
                      {NHAN_NGUON[n]}
                    </button>
                  ))}
                </div>
              </div>
              {nguon === "nv" && (
                <div className="space-y-1.5 sm:max-w-sm">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nhân viên giao</Label>
                  <Select value={tuNv || undefined} onValueChange={setTuNv}>
                    <SelectTrigger data-testid="chon-nv-giao" aria-label="Nhân viên giao"><SelectValue placeholder="Chọn nhân viên" /></SelectTrigger>
                    <SelectContent>
                      {nhanVien.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name}{u.is_active === false ? " (đã khoá)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tuyến <span className="normal-case tracking-normal">(không chọn = mọi tuyến)</span></Label>
                <ChipNhieu muc={mucTuyen} chon={tuyen} onDoi={setTuyen} nhan="Lọc theo tuyến" testId="chon-tuyen" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Công ty <span className="normal-case tracking-normal">(khách đã lấy hàng công ty ấy; không chọn = không lọc)</span></Label>
                {congTyDm.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Chưa có nhà cung cấp nào.</p>
                ) : (
                  <ChipNhieu muc={congTyDm} chon={ncc} onDoi={setNcc} nhan="Lọc theo công ty" testId="chon-cong-ty" />
                )}
                {ncc.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">Đã lấy hàng trong</span>
                    <ChonMocThoiGian value={moc} onChange={setMoc} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">2. Giao cho</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5 sm:max-w-sm">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nhân viên nhận</Label>
                <Select value={denNv || undefined} onValueChange={setDenNv}>
                  <SelectTrigger data-testid="chon-nv-nhan" aria-label="Nhân viên nhận"><SelectValue placeholder="Chọn nhân viên" /></SelectTrigger>
                  <SelectContent>
                    {nvNhan.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Kiểu giao</Label>
                <div role="radiogroup" aria-label="Kiểu giao" className="grid gap-2 sm:grid-cols-2">
                  {(["chung", "chuyen"] as KieuBanGiao[]).map((k) => {
                    const duoc = kieuHopLe(nguon, k)
                    return (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kieuDung === k}
                        disabled={!duoc}
                        title={duoc ? undefined : "Chuyển hẳn chỉ làm được với khách của một nhân viên"}
                        data-testid={`kieu-${k}`}
                        onClick={() => setKieu(k)}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          kieuDung === k ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"
                        )}
                      >
                        <p className={cn("text-sm font-bold", kieuDung === k && "text-primary")}>{NHAN_KIEU[k]}</p>
                        <p className="text-xs text-muted-foreground">
                          {k === "chung"
                            ? "Thêm NV nhận vào khách (làm phụ nếu khách đã có NV chính). NV đang phụ trách giữ nguyên, công nợ không đổi."
                            : "NV nhận thay vai của NV giao; NV giao thôi phụ trách. Nợ chưa thu chuyển sang NV nhận — doanh số HĐ cũ vẫn của NV giao."}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={giaoNoNpp} onCheckedChange={(v) => setGiaoNoNpp(v === true)} className="mt-0.5" aria-label="Giao kèm nợ NPP đang giữ" />
                <span>
                  Giao kèm <b>nợ NPP đang giữ</b> (của nhân viên đã nghỉ) khi NV nhận làm phụ trách chính
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={xemTruoc} disabled={!!thieu || dangXem} title={thieu ?? undefined} data-testid="xem-truoc">
                  {dangXem ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Xem trước
                </Button>
                {thieu && <span className="text-xs text-muted-foreground">{thieu}</span>}
              </div>
              {loiXem && <p className="text-sm text-destructive" role="alert" data-testid="loi-xem">{loiXem}</p>}
            </CardContent>
          </Card>

          {xt && (
            <Card data-testid="bang-xem-truoc">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">Xem trước: {xt.khach.length} khách</CardTitle>
                {xt.khach.length > 0 && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-primary"
                    onClick={() => setChon(chon.size === xt.khach.length ? new Set() : new Set(xt.khach.map((k) => k.id)))}
                  >
                    {chon.size === xt.khach.length ? "Bỏ chọn hết" : "Chọn hết"}
                  </button>
                )}
              </CardHeader>
              <CardContent>
                {xt.khach.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground" data-testid="xem-truoc-trong">
                    Không có khách nào khớp. Đổi nguồn / tuyến / công ty rồi xem lại.
                  </p>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="w-10"></TableHead>
                            <TableHead className="text-xs uppercase text-muted-foreground">Cửa hàng</TableHead>
                            <TableHead className="text-xs uppercase text-muted-foreground">Tuyến</TableHead>
                            <TableHead className="text-xs uppercase text-muted-foreground">Phụ trách chính</TableHead>
                            <TableHead className="text-xs uppercase text-muted-foreground">{tenNhan || "NV nhận"} sẽ là</TableHead>
                            {kieuDung === "chuyen" && <TableHead className="text-right text-xs uppercase text-muted-foreground">Nợ chuyển</TableHead>}
                            {nguon === "nv" && <TableHead className="text-xs uppercase text-muted-foreground">Lịch ghé</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {xt.khach.map((k) => (
                            <TableRow key={k.id} data-testid="dong-xem-truoc" className={cn(!chon.has(k.id) && "opacity-50")}>
                              <TableCell>
                                <Checkbox
                                  checked={chon.has(k.id)}
                                  aria-label={`Chọn ${k.store_name}`}
                                  onCheckedChange={(v) => setChon((s) => {
                                    const n = new Set(s)
                                    if (v === true) n.add(k.id)
                                    else n.delete(k.id)
                                    return n
                                  })}
                                />
                              </TableCell>
                              <TableCell>
                                <p className="font-semibold">{k.store_name}</p>
                                <p className="text-xs text-muted-foreground">{[k.phone, k.address].filter(Boolean).join(" · ")}</p>
                              </TableCell>
                              <TableCell className="text-sm">{nhanTuyen(k.channel, tuyenDm)}</TableCell>
                              <TableCell className="text-sm">{k.nv_chinh || <span className="text-muted-foreground">Chưa có</span>}</TableCell>
                              <TableCell>
                                <Badge variant={k.vai_nhan && k.vai_nhan === k.se_la ? "secondary" : k.se_la === "primary" ? "default" : "outline"}>
                                  {nhanSeLa(k)}
                                </Badge>
                                {k.vai_giao && <p className="mt-0.5 text-[11px] text-muted-foreground">{tenGiao}: {nhanVai(k.vai_giao).toLowerCase()}</p>}
                              </TableCell>
                              {kieuDung === "chuyen" && (
                                <TableCell className="text-right tabular-nums text-sm">
                                  {k.no_chuyen && k.no_chuyen.so > 0 ? <>{formatCurrency(k.no_chuyen.tien)}<p className="text-[11px] text-muted-foreground">{k.no_chuyen.so} khoản</p></> : "—"}
                                </TableCell>
                              )}
                              {nguon === "nv" && <TableCell className="text-sm">{k.vai_nhan ? <span className="text-muted-foreground">Giữ lịch của {tenNhan}</span> : nhanLich(k.lich) || "—"}</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ul className="space-y-2 md:hidden">
                      {xt.khach.map((k) => (
                        <li key={k.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-3", !chon.has(k.id) && "opacity-50")}>
                          <Checkbox
                            className="mt-1"
                            checked={chon.has(k.id)}
                            aria-label={`Chọn ${k.store_name}`}
                            onCheckedChange={(v) => setChon((s) => {
                              const n = new Set(s)
                              if (v === true) n.add(k.id)
                              else n.delete(k.id)
                              return n
                            })}
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="truncate text-sm font-semibold">{k.store_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{nhanTuyen(k.channel, tuyenDm)} · {k.nv_chinh || "chưa có NV chính"}</p>
                            <p className="text-xs">
                              {tenNhan || "NV nhận"}: <b>{nhanSeLa(k)}</b>
                              {kieuDung === "chuyen" && k.no_chuyen && k.no_chuyen.so > 0 && <> · nợ chuyển {formatCurrency(k.no_chuyen.tien)}</>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          {tong && (
            <Card data-testid="tom-tat">
              <CardHeader><CardTitle className="text-base">{NHAN_KIEU[kieuDung]} → {tenNhan}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Khách đã chọn</dt><dd className="font-bold tabular-nums" data-testid="tt-so-khach">{tong.so_khach}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Thêm mới cho {tenNhan}</dt><dd className="tabular-nums">{tong.them_moi}</dd></div>
                  {tong.da_co > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Đã có {tenNhan}</dt><dd className="tabular-nums">{tong.da_co}</dd></div>}
                  {tong.len_chinh > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{tenNhan} làm phụ trách chính</dt><dd className="tabular-nums">{tong.len_chinh}</dd></div>}
                  {kieuDung === "chuyen" && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">Nợ chưa thu chuyển sang</dt>
                      <dd className="text-right tabular-nums" data-testid="tt-no-chuyen">{formatCurrency(tong.no_chuyen.tien)}<span className="block text-[11px] text-muted-foreground">{tong.no_chuyen.so} khoản</span></dd></div>
                  )}
                  {tong.no_npp.so > 0 && (
                    <div className="flex justify-between"><dt className="text-muted-foreground">Nợ NPP đang giữ giao kèm</dt>
                      <dd className="text-right tabular-nums">{formatCurrency(tong.no_npp.tien)}<span className="block text-[11px] text-muted-foreground">{tong.no_npp.so} khoản</span></dd></div>
                  )}
                  {nguon === "nv" && <div className="flex justify-between"><dt className="text-muted-foreground">Lượt đi tuyến {kieuDung === "chuyen" ? "chuyển" : "chép"} sang</dt><dd className="tabular-nums">{tong.lich}</dd></div>}
                </dl>
                <Button
                  className="w-full gap-1.5"
                  variant={kieuDung === "chuyen" ? "destructive" : "default"}
                  disabled={tong.so_khach === 0 || dangGiao}
                  onClick={() => setHoi(true)}
                  data-testid="nut-ban-giao"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {kieuDung === "chuyen" ? "Chuyển hẳn" : "Giao"} {tong.so_khach} khách
                </Button>
              </CardContent>
            </Card>
          )}

          {kq && (
            <Card className="border-success/40" data-testid="ket-qua">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <CardTitle className="text-base">Đã giao {kq.ket.so_khach} khách cho {kq.tenNhan}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>Thêm mới {kq.ket.them_moi}{kq.ket.da_co ? ` · đã có ${kq.ket.da_co}` : ""}{kq.ket.len_chinh ? ` · làm chính ${kq.ket.len_chinh}` : ""}</li>
                  {kq.kieu === "chuyen" && <li>{kq.tenGiao} thôi phụ trách {kq.ket.bo_khoi_nv_giao} khách</li>}
                  {kq.kieu === "chuyen" && <li>Nợ chuyển: {kq.ket.no_chuyen.so} khoản · {formatCurrency(kq.ket.no_chuyen.tien)}</li>}
                  {kq.ket.no_npp.so > 0 && <li>Nợ NPP đang giữ: {kq.ket.no_npp.so} khoản · {formatCurrency(kq.ket.no_npp.tien)}</li>}
                  {kq.ket.lich > 0 && <li>Lịch đi tuyến: {kq.ket.lich} lượt</li>}
                </ul>
                {kq.ket.bo_qua > 0 && (
                  <p className="text-amber-600">{kq.ket.bo_qua} khách đã đổi phụ trách trước khi giao — đã bỏ qua.</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/customers/hang-da-lay?nv=${kq.denNv}`}>Danh sách bàn giao của {kq.tenNhan}</Link>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setKq(null)}>Bàn giao tiếp</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <History className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Lần bàn giao gần đây</CardTitle>
            </CardHeader>
            <CardContent>
              {nhat === null ? (
                <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : loiNhat ? (
                <p className="text-sm text-muted-foreground">{loiNhat}</p>
              ) : nhat.length === 0 ? (
                <p className="text-sm text-muted-foreground">Chưa bàn giao lần nào.</p>
              ) : (
                <ul className="space-y-2" data-testid="nhat-ky">
                  {nhat.map((r) => (
                    <li key={r.id} className="rounded-lg border px-3 py-2 text-sm">
                      <p className="font-semibold">
                        {NHAN_KIEU[r.kieu]} · {r.khach.length} khách → {tenCua(r.den_nv) || "?"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.nguon === "nv" ? `Từ ${tenCua(r.tu_nv) || "?"}` : NHAN_NGUON[r.nguon]}
                        {r.kieu === "chuyen" && r.ket_qua?.no_chuyen ? ` · nợ ${formatCurrency(Number(r.ket_qua.no_chuyen.tien) || 0)}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{ngayVN(r.tao_luc)} {vnTime(r.tao_luc)} · {tenCua(r.tao_boi) || "?"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={hoi}
        onOpenChange={setHoi}
        title={kieuDung === "chuyen" ? `Chuyển hẳn ${tong?.so_khach ?? 0} khách cho ${tenNhan}?` : `Giao ${tong?.so_khach ?? 0} khách cho ${tenNhan} (làm chung)?`}
        description={moTaXacNhan}
        confirmLabel={kieuDung === "chuyen" ? "Chuyển hẳn" : "Giao khách"}
        variant={kieuDung === "chuyen" ? "destructive" : "default"}
        loading={dangGiao}
        onConfirm={giao}
      />
    </div>
  )
}
