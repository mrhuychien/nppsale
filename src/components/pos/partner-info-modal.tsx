"use client"

/**
 * MODAL THÔNG TIN ĐỐI TÁC Ở POS — chủ nhà 21/10/2026: "Phần tạo đơn POS : phần Khách hàng / NCC khi ấn vào hiện modal
 * xem thông tin đầy đủ và sửa các thông tin".
 *
 * Bấm vào thẻ khách / NCC ở mọi màn POS → hộp thoại XEM đủ hồ sơ; "Sửa thông tin" chuyển sang biểu mẫu sửa ĐANG CÓ
 * (`CustomerForm` của hồ sơ khách; `SupplierFields` + `luuHoSoNcc` của chi tiết NCC) — không có form thứ hai để lệch
 * luật (tuyến bắt buộc, chặn trùng SĐT, không gửi lại toạ độ…). Lưu xong ở lại POS, chứng từ đang làm không mất; thẻ +
 * danh mục POS theo ngay qua `onDaLuu`.
 *
 * ⚠ ĐỌC KHI MỞ: danh mục POS chỉ giữ vài cột — hồ sơ đủ, công nợ, người phụ trách đọc lúc mở.
 * ⚠ PHÍM TẮT POS KHÔNG LỌT RA NGOÀI HỘP: sự kiện React nổi qua cổng (portal) lên khung POS — không chặn thì đang gõ
 *   trong hộp mà bấm F9 là gửi luôn đơn đằng sau, F6 là lưu nháp.
 * ⚠ "Mở hồ sơ" mở TAB MỚI — rời tab POS là mất chứng từ đang làm.
 */

import { useEffect, useState, type ReactNode } from "react"
import { ExternalLink, Pencil, Phone } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { errorMessage } from "@/lib/errors"
import { cn, formatCurrency } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import { posKeyOf } from "@/lib/pos/keys"
import { loadCustomerDebt, loadSupplierDebt, type PosSupplier } from "@/lib/pos/load"
import { fullCustomerAddress } from "@/lib/customers/address"
import { buildManagers, managersSummary, type AssignmentRow, type UserRow } from "@/lib/customers/managers"
import { nccFormTu, type NccForm } from "@/lib/suppliers/form"
import { luuHoSoNcc, LoiNhapNcc } from "@/lib/suppliers/luu-ho-so"
import { nhanDieuKhoan, nhanHanMuc, phapLyNcc, CHUA_CAP_NHAT, COT_NCC_CU, COT_NCC_MOI, type NccHoSo } from "@/lib/suppliers/chi-tiet"
import { selectResilient } from "@/lib/supabase/resilient"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { NewTabLink } from "@/components/ui/new-tab-link"
import { CustomerForm } from "@/components/customers/customer-form"
import { SupplierFields } from "@/components/suppliers/supplier-fields"
import type { Customer } from "@/types"

type CheDo = "xem" | "sua"

/** Chặn phím tắt POS (F*, Esc) nổi qua cổng lên khung POS. Esc vẫn đóng hộp — Radix nghe ở `document`, pha bắt. */
const chanPhimPos = (e: React.KeyboardEvent) => {
  if (posKeyOf(e.key)) e.stopPropagation()
}

/** Công nợ: `null` = chưa đọc được (KHÔNG hiện 0); âm = khách / NCC đang dư có. */
function nhanCongNo(no: number | null): ReactNode {
  if (no === null) return <span className="font-normal text-muted-foreground">chưa đọc được</span>
  if (no < 0) return <span className="text-success">Dư có {formatCurrency(-no)}</span>
  return <span className={no > 0 ? "text-error" : undefined}>{formatCurrency(no)}</span>
}

function Muc({ tieuDe, children }: { tieuDe: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tieuDe}</h3>
      <dl className="grid gap-x-6 sm:grid-cols-2">{children}</dl>
    </section>
  )
}

/** Một dòng hồ sơ; trống thì "Chưa cập nhật" màu xám (như màn chi tiết NCC). */
function Dong({ nhan, giaTri, rong }: { nhan: string; giaTri: ReactNode; rong?: boolean }) {
  const trong = giaTri === null || giaTri === undefined || (typeof giaTri === "string" && !giaTri.trim())
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b border-outline-variant/40 py-1.5", rong && "sm:col-span-2")}>
      <dt className="shrink-0 text-[13px] text-muted-foreground">{nhan}</dt>
      <dd className={cn("min-w-0 break-words text-right text-[13px] font-semibold", trong && "font-normal text-muted-foreground")}>
        {trong ? CHUA_CAP_NHAT : giaTri}
      </dd>
    </div>
  )
}

function DangTai() {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-6" />
      <Skeleton className="h-28" />
      <Skeleton className="h-20" />
    </div>
  )
}

function Loi({ chu }: { chu: string }) {
  return <p className="rounded-xl bg-error-container p-3 text-sm font-semibold text-on-error-container">{chu}</p>
}

/* ======================================================================================================== */

type KhachHoSo = Customer & { group?: { id?: string; name?: string | null } | null }

/** Đủ cột hồ sơ khách cho phần xem + `CustomerForm` (biểu mẫu sửa đọc đúng các cột này). */
const COT_KHACH =
  "id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, " +
  "payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, " +
  "billing_email, payment_method_label, group:customer_groups(id, name)"

export function KhachPosModal({
  customerId,
  onClose,
  onDaLuu,
}: {
  /** `null` = đóng. */
  customerId: string | null
  onClose: () => void
  /** Bản đã ghi — màn POS cập nhật thẻ + danh mục (tên, dòng phụ, nhóm giá, hạn mức). */
  onDaLuu: (c: Customer) => void
}) {
  const { user } = useAuth()
  const { groups } = useCustomerGroups()
  const [cheDo, setCheDo] = useState<CheDo>("xem")
  const [row, setRow] = useState<KhachHoSo | null>(null)
  const [no, setNo] = useState<number | null>(null)
  const [phuTrach, setPhuTrach] = useState<string | null>(null)
  const [tuyen, setTuyen] = useState<string | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [lanTai, setLanTai] = useState(0)

  useEffect(() => {
    if (!customerId) return
    setCheDo("xem")
    setRow(null)
    setLoi(null)
  }, [customerId])

  useEffect(() => {
    if (!customerId) return
    let huy = false
    const sb = createClient()
    ;(async () => {
      const [kh, congNo, pc] = await Promise.all([
        sb.from("customers").select(COT_KHACH).eq("id", customerId).maybeSingle(),
        loadCustomerDebt(sb, customerId).catch(() => null),
        sb
          .from("customer_assignments")
          .select("user_id, role, status, user:users(id, full_name, is_active)")
          .eq("customer_id", customerId),
      ])
      if (huy) return
      if (kh.error) {
        setLoi(errorMessage(kh.error))
        return
      }
      if (!kh.data) {
        // RLS từ chối = 0 dòng, không lỗi — "không có" và "không được xem" trông như nhau, nói cả hai.
        setLoi("Không mở được khách này — khách không tồn tại hoặc bạn không có quyền xem.")
        return
      }
      const c = kh.data as unknown as KhachHoSo
      setRow(c)
      setNo(congNo)
      if (pc.error) setPhuTrach(null)
      else {
        const ds = (pc.data ?? []) as unknown as Array<AssignmentRow & { user?: UserRow | null }>
        const users = ds.map((a) => a.user).filter((u): u is UserRow => !!u)
        setPhuTrach(managersSummary(buildManagers(ds, users, [], []), 3))
      }
      const ma = (c.channel ?? "").trim()
      if (!ma) {
        setTuyen(null)
        return
      }
      const rt = await sb.from("sales_routes").select("name").eq("code", ma).maybeSingle()
      if (huy) return
      // Không tra ra tên (hoặc đọc hỏng) thì in NGUYÊN mã — mã lạ là manh mối, "—" thì không.
      const ten = rt.error ? null : (rt.data as { name?: string | null } | null)?.name
      setTuyen(ten ? `${ma} — ${ten}` : ma)
    })()
    return () => { huy = true }
  }, [customerId, lanTai])

  const coQuyenSua = !!user && hasPermission(user.role, "customers", "update")
  const han = Number(row?.credit_limit || 0)
  const tenNhom = row?.group_id ? groups.find((g) => g.id === row.group_id)?.name ?? row.group?.name ?? null : null
  const coToaDo = row?.gps_lat != null && row?.gps_lng != null

  const xongSua = (c: Customer) => {
    // Đổi nhóm thì bỏ bản nhóm NHÚNG cũ (`group` đọc lúc mở) — giữ lại là tên nhóm cũ đi kèm mã nhóm mới.
    const moi = { ...c, group: c.group_id === row?.group_id ? c.group : undefined } as Customer
    setRow((r) => (r ? { ...r, ...moi } : r))
    setCheDo("xem")
    onDaLuu(moi)
    setLanTai((n) => n + 1) // đọc lại bản thật trên máy chủ (nhóm, tuyến) cho phần xem
  }

  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-testid="pos-thong-tin-khach"
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onKeyDown={chanPhimPos}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">
            {cheDo === "sua" ? "Sửa thông tin khách hàng" : row?.store_name || "Thông tin khách hàng"}
          </DialogTitle>
          <DialogDescription className={cn(!row && "sr-only")}>
            {cheDo === "sua" ? row?.store_name : "Khách hàng"}
          </DialogDescription>
        </DialogHeader>

        {loi ? (
          <Loi chu={loi} />
        ) : !row ? (
          <DangTai />
        ) : cheDo === "sua" ? (
          <CustomerForm customer={row} groups={groups} onDaSua={xongSua} onHuy={() => setCheDo("xem")} />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {row.status && <StatusBadge status={row.status} type="customer" />}
              <Badge variant="secondary">{tenNhom ? `Nhóm ${tenNhom}` : "Bảng giá chung"}</Badge>
            </div>

            <Muc tieuDe="Liên hệ">
              <Dong nhan="Chủ quán" giaTri={row.owner_name} />
              <Dong
                nhan="Điện thoại"
                giaTri={
                  row.phone ? (
                    <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                      <Phone className="h-3.5 w-3.5" />
                      {row.phone}
                    </a>
                  ) : null
                }
              />
              <Dong nhan="Địa chỉ" giaTri={fullCustomerAddress(row)} rong />
              <Dong nhan="Tuyến bán hàng" giaTri={tuyen} />
              <Dong
                nhan="Vị trí điểm bán"
                giaTri={
                  coToaDo ? (
                    <a
                      href={`https://www.google.com/maps?q=${row.gps_lat},${row.gps_lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Xem bản đồ <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    "Chưa ghim"
                  )
                }
              />
            </Muc>

            <Muc tieuDe="Bán hàng & công nợ">
              <Dong nhan="Nhóm khách hàng" giaTri={tenNhom ?? "Bảng giá chung"} />
              <Dong
                nhan="Điều khoản thanh toán"
                giaTri={PAYMENT_TERMS.find((t) => t.value === row.payment_terms)?.label ?? row.payment_terms}
              />
              <Dong nhan="Hạn mức công nợ" giaTri={han > 0 ? formatCurrency(han) : "Không hạn mức"} />
              <Dong nhan="Công nợ hiện tại" giaTri={nhanCongNo(no)} />
              {han > 0 && no !== null && (
                <Dong
                  nhan="Còn được nợ"
                  giaTri={<span className={han - no <= 0 ? "text-error" : undefined}>{formatCurrency(Math.max(0, han - no))}</span>}
                />
              )}
              <Dong nhan="Nhân viên phụ trách" giaTri={phuTrach} rong />
            </Muc>

            <Muc tieuDe="Thông tin xuất hóa đơn">
              <Dong nhan="Tên xuất HĐ" giaTri={row.billing_name} />
              <Dong nhan="Mã số thuế" giaTri={row.tax_code} />
              <Dong nhan="Địa chỉ xuất HĐ" giaTri={row.billing_address} rong />
              <Dong nhan="Email nhận HĐ" giaTri={row.billing_email} />
              <Dong nhan="Hình thức thanh toán" giaTri={row.payment_method_label} />
            </Muc>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <NewTabLink href={`/customers/${row.id}`} className="gap-1.5 text-sm font-bold text-primary hover:underline">
                Mở hồ sơ khách hàng <ExternalLink className="h-3.5 w-3.5" />
              </NewTabLink>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Đóng</Button>
                <Button
                  onClick={() => setCheDo("sua")}
                  disabled={!coQuyenSua}
                  title={coQuyenSua ? undefined : "Bạn không có quyền sửa khách hàng"}
                >
                  <Pencil className="mr-1.5 h-4 w-4" /> Sửa thông tin
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ======================================================================================================== */

type NccDayDu = NccHoSo & { is_verified?: boolean | null }

export function NccPosModal({
  supplierId,
  onClose,
  onDaLuu,
}: {
  /** `null` = đóng. */
  supplierId: string | null
  onClose: () => void
  /** Bản đã ghi — màn POS cập nhật thẻ + danh mục NCC. */
  onDaLuu: (s: PosSupplier) => void
}) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [cheDo, setCheDo] = useState<CheDo>("xem")
  const [row, setRow] = useState<NccDayDu | null>(null)
  const [no, setNo] = useState<number | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  const [form, setForm] = useState<NccForm | null>(null)
  const [goc, setGoc] = useState<NccForm | null>(null)
  const [dangLuu, setDangLuu] = useState(false)

  useEffect(() => {
    if (!supplierId) return
    let huy = false
    setCheDo("xem")
    setRow(null)
    setLoi(null)
    const sb = createClient()
    ;(async () => {
      const [ncc, congNo] = await Promise.all([
        // Cùng bộ cột (và đường lùi khi DB chưa chạy mig 232) với màn chi tiết NCC.
        selectResilient<NccDayDu>((sel) => sb.from("suppliers").select(sel).eq("id", supplierId).limit(1), COT_NCC_MOI, COT_NCC_CU),
        loadSupplierDebt(sb, supplierId).catch(() => null),
      ])
      if (huy) return
      if (ncc.error) {
        setLoi(ncc.error)
        return
      }
      if (!ncc.data[0]) {
        setLoi("Không mở được nhà cung cấp này — không tồn tại hoặc bạn không có quyền xem.")
        return
      }
      setRow(ncc.data[0])
      setNo(congNo)
    })()
    return () => { huy = true }
  }, [supplierId])

  const coQuyenSua = !!user && hasPermission(user.role, "inventory", "update")

  const moSua = () => {
    if (!row) return
    const f = nccFormTu(row)
    setGoc(f)
    setForm(f)
    setCheDo("sua")
  }

  const luu = async () => {
    if (!row || !form || !goc || dangLuu) return
    setDangLuu(true)
    try {
      const payload = await luuHoSoNcc(createClient(), row.id, form, goc)
      const moi = { ...row, ...payload } as NccDayDu
      setRow(moi)
      setCheDo("xem")
      toast({ title: "Đã cập nhật nhà cung cấp" })
      onDaLuu({ id: moi.id, name: moi.name, code: moi.code ?? null, phone: moi.phone ?? null, address: moi.address ?? null })
    } catch (err) {
      if (err instanceof LoiNhapNcc) toast({ title: err.message, variant: "destructive" })
      else toast({ title: "Không lưu được nhà cung cấp", description: errorMessage(err), variant: "destructive" })
    } finally {
      setDangLuu(false)
    }
  }

  return (
    <Dialog open={!!supplierId} onOpenChange={(o) => !o && !dangLuu && onClose()}>
      <DialogContent
        data-testid="pos-thong-tin-ncc"
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onKeyDown={chanPhimPos}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">
            {cheDo === "sua" ? "Sửa thông tin nhà cung cấp" : row?.name || "Thông tin nhà cung cấp"}
          </DialogTitle>
          <DialogDescription className={cn(!row && "sr-only")}>
            {cheDo === "sua" ? row?.name : "Nhà cung cấp"}
          </DialogDescription>
        </DialogHeader>

        {loi ? (
          <Loi chu={loi} />
        ) : !row ? (
          <DangTai />
        ) : cheDo === "sua" && form ? (
          <div className="grid gap-4">
            <SupplierFields form={form} onChange={(p) => setForm((f) => (f ? { ...f, ...p } : f))} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCheDo("xem")} disabled={dangLuu}>Huỷ</Button>
              <Button onClick={luu} disabled={dangLuu || !form.name.trim()} title={!form.name.trim() ? "Nhập tên nhà cung cấp" : undefined}>
                {dangLuu ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={row.is_active === false ? "warning" : "success"}>
                {row.is_active === false ? "Ngừng hợp tác" : "Đang hợp tác"}
              </Badge>
              {row.is_verified && <Badge variant="secondary">Đã xác minh</Badge>}
            </div>

            <Muc tieuDe="Thông tin chung">
              <Dong nhan="Mã NCC" giaTri={row.code} />
              <Dong nhan="Danh mục" giaTri={row.category} />
              <Dong nhan="Điều khoản thanh toán" giaTri={nhanDieuKhoan(row.payment_terms)} />
              <Dong nhan="Hạn mức công nợ" giaTri={nhanHanMuc(row.credit_limit)} />
              <Dong nhan="Công nợ phải trả" giaTri={nhanCongNo(no)} />
            </Muc>

            <Muc tieuDe="Liên hệ">
              <Dong nhan="Người liên hệ" giaTri={row.contact_name} />
              <Dong
                nhan="Điện thoại"
                giaTri={
                  row.phone ? (
                    <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                      <Phone className="h-3.5 w-3.5" />
                      {row.phone}
                    </a>
                  ) : null
                }
              />
              <Dong nhan="Email" giaTri={row.email} />
              <Dong nhan="Địa chỉ" giaTri={row.address} rong />
            </Muc>

            <Muc tieuDe="Pháp lý & ngân hàng">
              {phapLyNcc(row).map((t) => (
                <Dong key={t.label} nhan={t.label} giaTri={t.trong ? null : t.value} />
              ))}
            </Muc>

            <Muc tieuDe="Ghi chú">
              <Dong nhan="Ghi chú" giaTri={row.notes} rong />
            </Muc>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <NewTabLink href={`/suppliers/${row.id}`} className="gap-1.5 text-sm font-bold text-primary hover:underline">
                Mở hồ sơ nhà cung cấp <ExternalLink className="h-3.5 w-3.5" />
              </NewTabLink>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Đóng</Button>
                <Button
                  onClick={moSua}
                  disabled={!coQuyenSua}
                  title={coQuyenSua ? undefined : "Bạn không có quyền sửa nhà cung cấp"}
                >
                  <Pencil className="mr-1.5 h-4 w-4" /> Sửa thông tin
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
