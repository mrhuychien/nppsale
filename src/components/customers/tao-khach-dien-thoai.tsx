"use client"

/**
 * THÊM KHÁCH HÀNG TRÊN ĐIỆN THOẠI — bản thiết kế chủ nhà gửi 01/10/2026.
 *
 * Đầu trắng (‹ · "Thêm khách hàng" · "Chỉ cần tên, SĐT và địa chỉ") → "Cửa hàng" (tên, chủ, SĐT) → "Địa chỉ
 * và tuyến" (Lấy vị trí hiện tại · số nhà · phường/xã có tìm · tuyến BẮT BUỘC) → thẻ "Xuất hoá đơn VAT" (bật
 * mới hiện MST, tên, địa chỉ, email, hình thức TT) → thẻ "Thiết lập bán hàng" (nhóm, điều khoản, hạn mức) →
 * thanh đáy Huỷ / Lưu khách hàng → "Đã thêm …" (Thêm khách khác · Tạo đơn ngay).
 *
 * Chủ nhà 01/10/2026: SĐT gán sẵn từ ô tìm (`sdtBanDau`) · phường xã Hải Phòng sau sáp nhập · tuyến bắt buộc ·
 * bấm Lưu 2 lần / trùng số → báo "đã có khách hàng" tại chỗ, KHÔNG chuyển trang.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Check, MapPin, Receipt, CreditCard } from "lucide-react"
import Link from "@/components/ui/link"
import { DauTrangTrang } from "@/components/mobile/dau-trang"
import { SearchSelect } from "@/components/ui/search-select"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import { cn, formatCurrency } from "@/lib/utils"
import {
  KhachDaCo, LUA_CHON_PHUONG_XA, chuanHoaSdt, coLoi, dinhDangSdt, laSdtHopLe, loiKhachMoi, taoKhach,
  timKhachTrungSdt, type KhachVuaTao, type LoiKhachMoi,
} from "@/lib/customers/tao-khach"
import { TaoNhanhTuyen } from "@/components/tao-nhanh/tao-nhanh-tuyen"
import { NHAN_TAO_NHANH, duocTaoNhanh } from "@/lib/tao-nhanh/quyen"

const TT = [
  { value: "Chuyển khoản", label: "Chuyển khoản" },
  { value: "Tiền mặt", label: "Tiền mặt" },
  { value: "TM/CK", label: "TM/CK" },
]
const DIEU_KHOAN = [
  { value: "COD", label: "COD" },
  { value: "NET15", label: "Nợ 15 ngày" },
  { value: "NET30", label: "Nợ 30 ngày" },
]

const RONG = {
  store_name: "", owner_name: "", phone: "", address: "", ward: "", channel: "",
  tax_code: "", billing_name: "", billing_address: "", billing_email: "", payment_method_label: "Chuyển khoản",
  group_id: "", payment_terms: "COD", credit_limit: 0,
}
type Form = typeof RONG

function Phan({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-0.5 pb-2 text-[15px] font-bold text-on-surface">{title}</h2>
      <div className="flex flex-col gap-3.5 rounded-2xl border border-outline-variant/60 bg-card p-3.5">{children}</div>
    </section>
  )
}

function O({ nhan, batBuoc, loi, children, phai }: { nhan: string; batBuoc?: boolean; loi?: string; children: React.ReactNode; phai?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-on-surface-variant">
          {nhan} {batBuoc && <span className="text-destructive">*</span>}
        </span>
        {phai}
      </span>
      {children}
      {loi && <span className="text-xs text-destructive">{loi}</span>}
    </div>
  )
}

const oNhap = (loi?: string) =>
  cn(
    "h-11 w-full rounded-xl border bg-card px-3 text-[15px] text-on-surface outline-none focus:border-primary",
    loi ? "border-destructive" : "border-outline-variant/60"
  )

function Doan({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid rounded-xl bg-surface-container-low p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-9 rounded-lg text-[13px] font-semibold", value === o.value ? "bg-card text-primary shadow-sm" : "text-on-surface-variant")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TaoKhachDienThoai({
  groups,
  nextHref,
  sdtBanDau,
  tenBanDau,
  onDaTao,
  onHuy,
}: {
  groups: { id: string; name: string }[]
  /** Tạo xong quay về đây kèm `?picked=` (luồng bán hàng). */
  nextHref?: string
  /** SĐT từ ô tìm khách không ra kết quả (chủ nhà 01/10/2026). */
  sdtBanDau?: string
  /** Tên cửa hàng gán sẵn — chữ đang gõ ở ô tìm khách (khung tạo nhanh, chủ nhà 03/10/2026). */
  tenBanDau?: string
  /** Tạo nhanh tại chỗ: tạo xong trả khách cho nơi gọi, KHÔNG chuyển trang / không hiện màn "Đã thêm". */
  onDaTao?: (khach: KhachVuaTao) => void
  /** Nút Huỷ / lùi khi nằm trong khung tạo nhanh. */
  onHuy?: () => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [f, setF] = useState<Form>({ ...RONG, phone: chuanHoaSdt(sdtBanDau ?? ""), store_name: tenBanDau ?? "" })
  const [vat, setVat] = useState(false)
  const [moBan, setMoBan] = useState(false)
  const [daThu, setDaThu] = useState(false)
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [dangDinhVi, setDangDinhVi] = useState(false)
  const [dangLuu, setDangLuu] = useState(false)
  /** Khoá chống bấm 2 lần — state chưa kịp vẽ lại thì cú bấm thứ hai vẫn lọt qua `disabled`. */
  const khoa = useRef(false)
  const [trung, setTrung] = useState<KhachDaCo | null>(null)
  const [xong, setXong] = useState<{ id: string | null; ten: string; meta: string } | null>(null)
  const [tuyen, setTuyen] = useState<Array<{ code: string; name: string }>>([])
  /** Khung tạo nhanh tuyến đang mở (kèm chữ đã gõ ở ô tìm tuyến). */
  const [taoTuyen, setTaoTuyen] = useState<{ chu: string } | null>(null)
  const coQuyenTuyen = duocTaoNhanh(user?.role, "tuyen")

  useEffect(() => {
    supabase
      .from("sales_routes")
      .select("code, name")
      .eq("is_active", true)
      .order("sort_order")
      .order("code")
      .then(({ data, error }) => {
        if (error) console.error("[tao-khach-dien-thoai] đọc tuyến lỗi:", error.message)
        setTuyen((data as Array<{ code: string; name: string }>) || [])
      })
  }, [supabase])

  // Gõ đủ 10 số là tra trùng ngay — báo trước khi người dùng nhập hết form.
  const sdt = chuanHoaSdt(f.phone)
  useEffect(() => {
    setTrung(null)
    if (!laSdtHopLe(sdt)) return
    let huy = false
    timKhachTrungSdt(supabase, sdt).then((k) => { if (!huy && k) setTrung(new KhachDaCo(sdt, k)) })
    return () => { huy = true }
  }, [sdt, supabase])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))
  const loi: LoiKhachMoi = daThu ? loiKhachMoi(f) : {}
  const loiSdt = trung?.message ?? loi.phone

  const dinhVi = () => {
    if (!navigator.geolocation) {
      toast({ title: "Máy không hỗ trợ định vị", variant: "destructive" })
      return
    }
    setDangDinhVi(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude }); setDangDinhVi(false) },
      (e) => { toast({ title: "Không lấy được vị trí", description: e.message, variant: "destructive" }); setDangDinhVi(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const luu = async () => {
    if (khoa.current) return
    setDaThu(true)
    if (coLoi(loiKhachMoi(f)) || trung) return
    khoa.current = true
    setDangLuu(true)
    try {
      const payload: Record<string, unknown> = {
        store_name: f.store_name.trim(),
        owner_name: f.owner_name.trim(),
        phone: sdt,
        address: f.address.trim(),
        ward: f.ward || null,
        channel: f.channel,
        group_id: f.group_id || null,
        payment_terms: f.payment_terms,
        credit_limit: f.payment_terms === "COD" ? 0 : f.credit_limit,
        status: "active",
        payment_method_label: f.payment_method_label,
        ...(vat
          ? {
              tax_code: f.tax_code.trim() || null,
              billing_name: f.billing_name.trim() || null,
              billing_address: f.billing_address.trim() || null,
              billing_email: f.billing_email.trim() || null,
            }
          : {}),
        ...(gps ? { gps_lat: gps.lat, gps_lng: gps.lng } : {}),
      }
      const kq = await taoKhach(supabase, user, payload)
      if (onDaTao) {
        if (kq.ghiChu) toast({ title: "Đã tạo khách hàng", description: kq.ghiChu, variant: kq.phanCongLoi ? "destructive" : undefined })
        if (kq.id) {
          onDaTao({
            id: kq.id, store_name: f.store_name.trim(), owner_name: f.owner_name.trim() || null, phone: sdt,
            address: f.address.trim() || null, channel: f.channel || null,
          })
        } else {
          toast({ title: "Đã lưu khách nhưng chưa đọc lại được mã", description: "Gõ tìm lại khách trong ô chọn.", variant: "destructive" })
          onHuy?.()
        }
        return
      }
      if (kq.ghiChu || nextHref) toast({ title: "Đã tạo khách hàng", description: kq.ghiChu ?? undefined, variant: kq.phanCongLoi ? "destructive" : undefined })
      if (nextHref && kq.id) {
        router.push(`${nextHref}?picked=${encodeURIComponent(kq.id)}`)
        return
      }
      const r = tuyen.find((t) => t.code === f.channel)
      setXong({ id: kq.id, ten: f.store_name.trim(), meta: [f.owner_name.trim(), dinhDangSdt(sdt), r ? `Tuyến ${r.name || r.code}` : null].filter(Boolean).join(" · ") })
    } catch (e) {
      if (e instanceof KhachDaCo) {
        // Trùng số (kể cả lần bấm thứ hai sau khi lần đầu đã ghi): báo tại chỗ, ở lại màn.
        setTrung(e)
        toast({ title: "Đã có khách hàng", description: e.message, variant: "destructive" })
      } else {
        toast({ title: "Không tạo được khách hàng", description: errorMessage(e), variant: "destructive" })
      }
    } finally {
      khoa.current = false
      setDangLuu(false)
    }
  }

  const tomTatBan = [
    groups.find((g) => g.id === f.group_id)?.name || "Chưa phân nhóm",
    DIEU_KHOAN.find((d) => d.value === f.payment_terms)?.label,
    f.payment_terms !== "COD" && f.credit_limit ? `hạn mức ${formatCurrency(f.credit_limit)}đ` : null,
  ].filter(Boolean).join(" · ")

  if (xong) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-surface-container-low">
        <DauTrangTrang title="Thêm khách hàng" subtitle="Đã lưu" backHref="/customers" />
        <div className="flex flex-col gap-3.5 p-3.5" data-testid="tk-xong">
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-outline-variant/60 bg-card px-4 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#12b76a]/10 text-[#067647]"><Check className="h-6 w-6" /></span>
            <p className="text-base font-bold">Đã thêm {xong.ten}</p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{xong.meta}</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-card px-3.5 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700"><Camera className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Chưa có ảnh điểm bán</p>
              <p className="text-xs text-muted-foreground">Chụp khi tới cửa hàng</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setF({ ...RONG }); setVat(false); setMoBan(false); setDaThu(false); setGps(null); setXong(null) }}
              className="h-12 rounded-[14px] border border-outline-variant/60 bg-card text-sm font-semibold"
            >
              Thêm khách khác
            </button>
            <button
              type="button"
              onClick={() => xong.id && router.push(`/sell/customer?picked=${encodeURIComponent(xong.id)}`)}
              className="h-12 rounded-[14px] bg-primary text-sm font-semibold text-primary-foreground"
            >
              Tạo đơn ngay
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface-container-low">
      <DauTrangTrang title="Thêm khách hàng" subtitle="Chỉ cần tên, SĐT và địa chỉ" backHref={nextHref ?? "/customers"} onBack={onHuy} />
      <div className="flex flex-col gap-5 p-3.5 pb-28">
        <Phan title="Cửa hàng">
          <O nhan="Tên cửa hàng" batBuoc loi={loi.store_name}>
            <input data-testid="tk-shop" value={f.store_name} onChange={(e) => set("store_name", e.target.value)} placeholder="VD: Tạp hoá Bà Hai" className={oNhap(loi.store_name)} />
          </O>
          <O nhan="Tên chủ cửa hàng" batBuoc loi={loi.owner_name}>
            <input data-testid="tk-owner" value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} placeholder="VD: Nguyễn Thị Hai" className={oNhap(loi.owner_name)} />
          </O>
          <O nhan="Số điện thoại" batBuoc loi={loiSdt}>
            <input
              data-testid="tk-phone"
              inputMode="tel"
              value={dinhDangSdt(f.phone)}
              onChange={(e) => set("phone", chuanHoaSdt(e.target.value).slice(0, 10))}
              placeholder="0901 000 001"
              className={oNhap(loiSdt)}
            />
            {trung?.khach && (
              <Link href={`/customers/${trung.khach.id}`} className="text-xs font-semibold text-primary" data-testid="tk-mo-khach-trung">
                Mở khách {trung.khach.store_name} ›
              </Link>
            )}
          </O>
        </Phan>

        <Phan title="Địa chỉ và tuyến">
          <O nhan="Địa chỉ" batBuoc loi={loi.address}>
            <button
              type="button"
              onClick={dinhVi}
              disabled={dangDinhVi}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 text-sm font-semibold text-primary"
            >
              <MapPin className="h-[18px] w-[18px]" />
              {dangDinhVi ? "Đang lấy vị trí…" : gps ? "Đã lấy vị trí · bấm để lấy lại" : "Lấy vị trí hiện tại"}
            </button>
            <input data-testid="tk-street" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Số nhà, tên đường" className={oNhap(loi.address)} />
            <SearchSelect
              id="tk-ward"
              options={LUA_CHON_PHUONG_XA}
              valueId={f.ward}
              onPick={(o) => set("ward", o?.id ?? "")}
              placeholder="Phường / xã (gõ để tìm)"
              emptyHint="Không có phường / xã nào khớp ở Hải Phòng."
              limit={120}
            />
          </O>
          <O
            nhan="Tuyến bán hàng"
            batBuoc
            loi={loi.channel}
            phai={onDaTao ? undefined : <Link href="/customers/routes" className="text-xs font-semibold text-primary">Quản lý tuyến</Link>}
          >
            {tuyen.length === 0 && !coQuyenTuyen ? (
              <p className="text-xs text-muted-foreground">
                Chưa có tuyến nào.{" "}
                {onDaTao ? "Nhờ quản lý thêm tuyến" : <Link href="/customers/routes" className="font-semibold text-primary">Thêm tuyến</Link>} trước khi tạo khách.
              </p>
            ) : (
              <div className={cn("rounded-xl", loi.channel && "ring-1 ring-destructive")}>
                <SearchSelect
                  id="tk-route"
                  options={tuyen.map((t) => ({ id: t.code, label: t.name ? `${t.code} · ${t.name}` : t.code }))}
                  valueId={f.channel}
                  onPick={(o) => set("channel", o?.id ?? "")}
                  placeholder="Chọn tuyến"
                  emptyHint="Không có tuyến nào khớp."
                  limit={100}
                  taoMoi={coQuyenTuyen ? { nhan: NHAN_TAO_NHANH.tuyen, onTao: (chu) => setTaoTuyen({ chu }) } : undefined}
                />
              </div>
            )}
          </O>
        </Phan>

        <div className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
          <button type="button" onClick={() => setVat((v) => !v)} aria-pressed={vat} data-testid="tk-vat" className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-700"><Receipt className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Xuất hoá đơn VAT</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Bật nếu khách cần hoá đơn đỏ</span>
            </span>
            <span className={cn("relative h-[26px] w-11 shrink-0 rounded-full", vat ? "bg-primary" : "bg-gray-400")}>
              <span className={cn("absolute top-[3px] h-5 w-5 rounded-full bg-white shadow", vat ? "right-[3px]" : "left-[3px]")} />
            </span>
          </button>
          {vat && (
            <div className="flex flex-col gap-3.5 border-t border-outline-variant/40 p-3.5">
              <O nhan="Mã số thuế"><input inputMode="numeric" value={f.tax_code} onChange={(e) => set("tax_code", e.target.value)} placeholder="VD: 0102345678" className={oNhap()} /></O>
              <O nhan="Tên trên hoá đơn"><input value={f.billing_name} onChange={(e) => set("billing_name", e.target.value)} placeholder={f.store_name || "Tên trên hoá đơn VAT"} className={oNhap()} /></O>
              <O nhan="Địa chỉ trên hoá đơn"><input value={f.billing_address} onChange={(e) => set("billing_address", e.target.value)} placeholder="Để trống nếu trùng địa chỉ cửa hàng" className={oNhap()} /></O>
              <O nhan="Email nhận hoá đơn"><input inputMode="email" value={f.billing_email} onChange={(e) => set("billing_email", e.target.value)} placeholder="email@congty.vn" className={oNhap()} /></O>
              <O nhan="Hình thức thanh toán"><Doan options={TT} value={f.payment_method_label} onChange={(v) => set("payment_method_label", v)} /></O>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-card">
          <button type="button" onClick={() => setMoBan((v) => !v)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700"><CreditCard className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Thiết lập bán hàng</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tomTatBan}</span>
            </span>
            <span className="text-[13px] font-semibold text-primary">{moBan ? "Thu gọn" : "Sửa"}</span>
          </button>
          {moBan && (
            <div className="flex flex-col gap-3.5 border-t border-outline-variant/40 p-3.5">
              <O nhan="Nhóm khách hàng">
                <SearchSelect
                  id="tk-group"
                  options={groups.map((g) => ({ id: g.id, label: g.name }))}
                  valueId={f.group_id}
                  onPick={(o) => set("group_id", o?.id ?? "")}
                  placeholder="Chưa phân nhóm"
                  emptyHint="Không có nhóm nào khớp."
                />
              </O>
              <O nhan="Điều khoản thanh toán"><Doan options={DIEU_KHOAN} value={f.payment_terms} onChange={(v) => set("payment_terms", v)} /></O>
              {f.payment_terms !== "COD" && (
                <O nhan="Hạn mức công nợ">
                  <div className="flex h-11 items-center gap-1.5 rounded-xl border border-outline-variant/60 px-3">
                    <input
                      inputMode="numeric"
                      value={f.credit_limit ? formatCurrency(f.credit_limit) : ""}
                      onChange={(e) => set("credit_limit", parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
                      placeholder="0"
                      className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    />
                    <span className="text-sm text-muted-foreground">đ</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Để 0 nếu không giới hạn</span>
                </O>
              )}
            </div>
          )}
        </div>

        <p className="flex items-start gap-2 px-0.5 text-xs leading-relaxed text-muted-foreground">
          <Camera className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Ảnh điểm bán chụp sau khi tới nơi. Mở khách hàng rồi bấm &ldquo;Chụp ảnh&rdquo;, vị trí được lấy tự động.</span>
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[96px_1fr] gap-2 border-t border-outline-variant/60 bg-card px-3.5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
        <button type="button" onClick={() => (onHuy ? onHuy() : nextHref ? router.push(nextHref) : router.back())} className="h-[52px] rounded-[14px] border border-outline-variant/60 text-sm font-semibold">
          Huỷ
        </button>
        <button
          type="button"
          data-testid="tk-luu"
          onClick={luu}
          disabled={dangLuu}
          className="h-[52px] rounded-[14px] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {dangLuu ? "Đang lưu…" : "Lưu khách hàng"}
        </button>
      </div>

      <TaoNhanhTuyen
        open={!!taoTuyen}
        onOpenChange={(o) => !o && setTaoTuyen(null)}
        chuBanDau={taoTuyen?.chu}
        onDaTao={(t) => {
          setTuyen((ds) => (ds.some((r) => r.code === t.code) ? ds : [...ds, { code: t.code, name: t.name }]))
          set("channel", t.code)
        }}
      />
    </div>
  )
}
