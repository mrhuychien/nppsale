"use client"

/**
 * SOẠN HÀNG — GỘP NHIỀU ĐƠN THÀNH TỔNG LƯỢNG HÀNG CẦN XUẤT, IN RA CHO KHO NHẶT.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Cho phép gộp nhiều đơn hàng vào -> lượng hàng tổng cần
 *   xuất. Người dùng chỉ cần chọn đơn hàng cần gộp, máy sẽ tổng hợp và in ra.
 *   (chọn bằng nhiều cách, từ danh sách, từ tìm kiếm mã đơn, khách hàng...)"
 *
 * Ba lối chọn đơn: thanh chọn nhiều ở danh sách đơn (`?ids=`), ô tìm theo mã đơn /
 * tên khách / SĐT ngay trên màn này, và "Thêm tất cả kết quả".
 *
 * ⚠ CHỈ ĐỌC — không ghi sổ, không đổi trạng thái đơn. Xem `lib/orders/pick-list.ts`.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Plus, Search, X, AlertTriangle, ListPlus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton } from "@/components/ui/print-button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import { loadInvoiceableLines, type InvoiceableLine } from "@/lib/orders/post-invoice"
import {
  chuDonVi, docIds, gopSoanHang, soanHangHref, TRANG_THAI_CAN_XUAT,
  type PickOrder, type ProductUnits,
} from "@/lib/orders/pick-list"

interface DonTim {
  id: string
  order_code: string
  status: string
  order_date: string | null
  total: number | null
  customer?: { store_name?: string | null; phone?: string | null } | null
}

const COT_DON = "id, order_code, status, order_date, total, customer:customers(store_name, phone)"
/** Trần kết quả ô tìm — đủ cho một chuyến hàng, không kéo cả sổ về. */
const TRAN_TIM = 50

function Trang() {
  const { user, loading: authLoading } = useRoleGuard("orders")
  const router = useRouter()
  const params = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  /** Đơn đã chọn — THỨ TỰ chọn giữ nguyên, đường dẫn `?ids=` luôn khớp. */
  const [chon, setChon] = useState<DonTim[]>([])
  const [dong, setDong] = useState<Record<string, InvoiceableLine[]>>({})
  const [loiDong, setLoiDong] = useState<Record<string, string>>({})
  const [sanPham, setSanPham] = useState<Record<string, ProductUnits>>({})
  const [napDau, setNapDau] = useState(true)
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)

  const [q, setQ] = useState("")
  const [caDonKhac, setCaDonKhac] = useState(false)
  const [ketQua, setKetQua] = useState<DonTim[] | null>(null)
  const [dangTim, setDangTim] = useState(false)
  const [chiTiet, setChiTiet] = useState(true)

  /* ---- nạp đơn từ đường dẫn (danh sách đơn → "Soạn hàng") ---- */
  const idsUrl = params.get("ids")
  useEffect(() => {
    if (authLoading) return
    const ids = docIds(idsUrl)
    let huy = false
    ;(async () => {
      if (ids.length === 0) { setNapDau(false); return }
      const { data, error } = await supabase.from("sales_orders").select(COT_DON).in("id", ids)
      if (huy) return
      if (error) console.error("[soan-hang] đọc đơn lỗi:", error.message)
      const theoId = new Map(((data as unknown as DonTim[]) ?? []).map((d) => [d.id, d]))
      setChon(ids.map((id) => theoId.get(id)).filter((d): d is DonTim => !!d))
      setNapDau(false)
    })()
    return () => { huy = true }
    // Chỉ lần mở màn: sau đó màn tự giữ `chon` và ghi ngược ra đường dẫn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading])

  useEffect(() => {
    if (user?.org_id) loadOrgHeader(supabase, user.org_id).then(setOrg).catch(() => {})
  }, [user?.org_id, supabase])

  /* ---- ghi lựa chọn ra đường dẫn: tải lại / gửi link vẫn đúng các đơn ấy ---- */
  const idsChon = chon.map((d) => d.id)
  const khoaChon = idsChon.join(",")
  useEffect(() => {
    if (napDau) return
    if (khoaChon !== docIds(idsUrl).join(",")) router.replace(soanHangHref(idsChon), { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaChon, napDau])

  /* ---- dòng còn phải xuất của từng đơn (mỗi đơn đọc một lần) ---- */
  const dangDoc = useRef(new Set<string>())
  useEffect(() => {
    for (const d of chon) {
      if (dong[d.id] || dangDoc.current.has(d.id)) continue
      dangDoc.current.add(d.id)
      loadInvoiceableLines(supabase, d.id)
        .then((ls) => setDong((s) => ({ ...s, [d.id]: ls })))
        .catch((e) => setLoiDong((s) => ({ ...s, [d.id]: errorMessage(e) })))
        .finally(() => dangDoc.current.delete(d.id))
    }
  }, [chon, dong, supabase])

  /* ---- đơn vị của mặt hàng — để tách "3 thùng 5 hộp" ---- */
  const idsSP = useMemo(
    () => Array.from(new Set(Object.values(dong).flat().map((l) => l.productId))).filter((id) => !sanPham[id]),
    [dong, sanPham]
  )
  useEffect(() => {
    if (idsSP.length === 0) return
    let huy = false
    supabase
      .from("products")
      .select("id, base_unit, units:product_units(unit_name, conversion)")
      .in("id", idsSP)
      .then(({ data, error }) => {
        if (huy) return
        if (error) console.error("[soan-hang] đọc đơn vị lỗi:", error.message)
        const m: Record<string, ProductUnits> = {}
        for (const p of (data as unknown as Array<ProductUnits & { id: string }>) ?? []) m[p.id] = p
        /* Mã không đọc được vẫn đánh dấu — không hỏi lại mãi. */
        for (const id of idsSP) if (!m[id]) m[id] = { base_unit: "" }
        setSanPham((s) => ({ ...s, ...m }))
      })
    return () => { huy = true }
  }, [idsSP, supabase])

  /* ---- tìm đơn: mã đơn, tên khách, SĐT ---- */
  const timRef = useRef(0)
  const tim = useCallback(async (tu: string) => {
    const term = tu.trim()
    const luot = ++timRef.current
    if (!term) { setKetQua(null); return }
    setDangTim(true)
    const like = `%${term.replace(/[%,()]/g, " ")}%`
    const { data: kh } = await supabase
      .from("customers")
      .select("id")
      .or(`store_name.ilike.${like},phone.ilike.${like},owner_name.ilike.${like}`)
      .limit(200)
    const idsKh = ((kh as Array<{ id: string }>) ?? []).map((k) => k.id)
    let qd = supabase.from("sales_orders").select(COT_DON).order("created_at", { ascending: false }).limit(TRAN_TIM)
    qd = idsKh.length
      ? qd.or(`order_code.ilike.${like},customer_id.in.(${idsKh.join(",")})`)
      : qd.ilike("order_code", like)
    if (!caDonKhac) qd = qd.in("status", [...TRANG_THAI_CAN_XUAT])
    const { data, error } = await qd
    if (luot !== timRef.current) return
    if (error) console.error("[soan-hang] tìm đơn lỗi:", error.message)
    setKetQua((data as unknown as DonTim[]) ?? [])
    setDangTim(false)
  }, [supabase, caDonKhac])

  useEffect(() => {
    const t = setTimeout(() => { void tim(q) }, 250)
    return () => clearTimeout(t)
  }, [q, tim])

  const them = (d: DonTim) => setChon((s) => (s.some((x) => x.id === d.id) ? s : [...s, d]))
  const bo = (id: string) => {
    setChon((s) => s.filter((x) => x.id !== id))
    setDong(({ [id]: _, ...s }) => { void _; return s })
    setLoiDong(({ [id]: _, ...s }) => { void _; return s })
  }
  const chuaChon = (ketQua ?? []).filter((d) => !idsChon.includes(d.id))

  /* ---- tổng hợp ---- */
  const donGop = chon
    .filter((d) => dong[d.id])
    .map((d) => ({
      order: { id: d.id, code: d.order_code, customerName: d.customer?.store_name || "Khách lẻ" } as PickOrder,
      lines: dong[d.id],
    }))
  const rows = useMemo(() => gopSoanHang(donGop, sanPham), [donGop, sanPham]) // eslint-disable-line react-hooks/exhaustive-deps
  const dangNap = chon.some((d) => !dong[d.id] && !loiDong[d.id])
  const donRong = donGop.filter((d) => !d.lines.some((l) => l.remainingQty > 0))
  const thieu = rows.filter((r) => r.shortBase > 0)
  const homNay = new Date()

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <PageHeader
          title="Soạn hàng"
          description="Gộp nhiều đơn → tổng lượng hàng cần xuất, in cho kho nhặt. Không đổi gì trên đơn."
          backHref="/orders"
        >
          <PrintButton label="In phiếu soạn hàng" defaultPaper="A4" disabled={rows.length === 0 || dangNap} />
        </PageHeader>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* ---- chọn đơn ---- */}
          <aside className="space-y-3 self-start lg:sticky lg:top-4">
            <div className="rounded-xl border bg-card p-3 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm mã đơn, tên khách, SĐT…"
                  className="pl-9"
                  aria-label="Tìm đơn để gộp"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={caDonKhac} onChange={(e) => setCaDonKhac(e.target.checked)} />
                Tìm cả đơn đã xong / đã huỷ (mặc định chỉ Phiếu tạm, Xuất một phần)
              </label>
              {ketQua && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{dangTim ? "Đang tìm…" : `${ketQua.length} đơn${ketQua.length >= TRAN_TIM ? " (hiện 50 đơn mới nhất)" : ""}`}</span>
                    {chuaChon.length > 1 && (
                      <button type="button" className="font-semibold text-primary" onClick={() => chuaChon.forEach(them)}>
                        <ListPlus className="mr-1 inline h-3.5 w-3.5" />
                        Thêm tất cả ({chuaChon.length})
                      </button>
                    )}
                  </div>
                  <div className="max-h-[360px] space-y-1 overflow-y-auto">
                    {ketQua.length === 0 && !dangTim && (
                      <p className="py-3 text-center text-sm text-muted-foreground">Không có đơn nào khớp.</p>
                    )}
                    {ketQua.map((d) => {
                      const da = idsChon.includes(d.id)
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={da}
                          onClick={() => them(d)}
                          data-testid="ket-qua-don"
                          className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-xs font-bold">{d.order_code}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {d.customer?.store_name || "Khách lẻ"} · {d.order_date ? formatDate(d.order_date) : "—"} · {ORDER_STATUS_MAP[d.status]?.label ?? d.status}
                            </span>
                          </span>
                          {da ? <span className="text-xs text-muted-foreground">Đã chọn</span> : <Plus className="h-4 w-4 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {!ketQua && (
                <p className="text-xs text-muted-foreground">
                  Hoặc chọn nhiều đơn ở{" "}
                  <Link href="/orders" className="font-semibold text-primary">danh sách đơn hàng</Link>{" "}
                  rồi bấm <b>Soạn hàng</b>.
                </p>
              )}
            </div>

            <div className="rounded-xl border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Đơn đã chọn · {chon.length}</p>
                {chon.length > 0 && (
                  <button type="button" className="text-xs font-semibold text-muted-foreground" onClick={() => { setChon([]); setDong({}); setLoiDong({}) }}>
                    Bỏ hết
                  </button>
                )}
              </div>
              {napDau ? (
                <Skeleton className="h-16" />
              ) : chon.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Chưa chọn đơn nào — tìm ở ô phía trên.</p>
              ) : (
                <div className="space-y-1" data-testid="don-da-chon">
                  {chon.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-bold">{d.order_code}</span>{" "}
                        <span className="text-xs text-muted-foreground">{d.customer?.store_name || "Khách lẻ"}</span>
                        {loiDong[d.id] && <span className="block text-xs text-destructive">Không đọc được dòng — {loiDong[d.id]}</span>}
                        {dong[d.id] && !dong[d.id].some((l) => l.remainingQty > 0) && (
                          <span className="block text-xs text-amber-600">Đã xuất hết — không còn gì để soạn</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(Number(d.total) || 0)}</span>
                      <button type="button" aria-label={`Bỏ ${d.order_code}`} onClick={() => bo(d.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* ---- tổng hợp ---- */}
          <div className="space-y-3 lg:col-span-2">
            {thieu.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{thieu.length} mặt hàng không đủ tồn kho bán — xem cột Tồn. Vẫn in được; kho báo lại lúc xuất.</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {rows.length} mặt hàng · {donGop.length} đơn{donRong.length ? ` (${donRong.length} đơn đã xuất hết)` : ""}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chiTiet} onChange={(e) => setChiTiet(e.target.checked)} />
                Hiện / in chi tiết theo đơn
              </label>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <TableHead>Mặt hàng</TableHead>
                    <TableHead className="text-right">Tổng cần xuất</TableHead>
                    <TableHead>Lấy hàng</TableHead>
                    <TableHead className="text-right">Số đơn</TableHead>
                    <TableHead className="text-right">Tồn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dangNap && rows.length === 0 ? (
                    <TableRow><TableCell colSpan={5}><Skeleton className="h-10" /></TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        {chon.length === 0 ? "Chọn đơn để xem tổng hàng cần xuất." : "Các đơn đã chọn không còn hàng nào phải xuất."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.productId} data-testid="dong-soan-hang">
                        <TableCell>
                          <span className="font-semibold">{r.name}</span>
                          {r.sku && <span className="ml-1.5 text-xs text-muted-foreground">{r.sku}</span>}
                          {r.hasExchange && <Badge variant="secondary" className="ml-1.5">có hàng đổi</Badge>}
                          {chiTiet && (
                            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                              {r.details.map((d, i) => (
                                <div key={i}>
                                  {d.orderCode} · {d.customerName}: {d.qty} {d.unitName}{d.isExchange ? " (hàng đổi)" : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-bold whitespace-nowrap">
                          {chuDonVi([{ unitName: r.baseUnit, qty: r.totalBase }])}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{chuDonVi(r.pick)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.orderCount}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.shortBase > 0 ? "font-bold text-amber-600" : ""}`}>
                          {r.availableBase == null ? "—" : chuDonVi([{ unitName: r.baseUnit, qty: r.availableBase }])}
                          {r.shortBase > 0 && <span className="block text-xs">thiếu {chuDonVi([{ unitName: r.baseUnit, qty: r.shortBase }])}</span>}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>

      {/* ---- tờ in ---- */}
      <div className="print-only a4-doc text-[12px] text-black" data-testid="to-in-soan-hang">
        <p className="font-bold uppercase leading-tight">{org.name || ""}</p>
        {org.address && <p className="leading-tight">Địa chỉ: {org.address}</p>}
        <h1 className="mt-1.5 text-center text-xl font-bold">PHIẾU SOẠN HÀNG</h1>
        <p className="text-center">
          Ngày {formatDate(homNay.toISOString())} · {donGop.length} đơn · {rows.length} mặt hàng
        </p>
        <p className="mt-1 leading-snug">
          <b>Gộp các đơn:</b>{" "}
          {donGop.map((d) => `${d.order.code} (${d.order.customerName})`).join("; ")}
        </p>
        <table className="mt-1.5 w-full border-collapse">
          <thead>
            <tr className="text-center font-bold">
              <th className="border border-black px-1 w-8">STT</th>
              <th className="border border-black px-1">Tên hàng</th>
              <th className="border border-black px-1">Tổng cần xuất</th>
              <th className="border border-black px-1">Lấy hàng</th>
              <th className="border border-black px-1 w-10">Số đơn</th>
              <th className="border border-black px-1 w-12">Đã nhặt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.productId} className="align-top">
                <td className="border border-black px-1 text-center">{i + 1}</td>
                <td className="border border-black px-1">
                  {r.name}{r.sku ? ` (${r.sku})` : ""}{r.hasExchange ? " — có hàng đổi" : ""}
                  {chiTiet && (
                    <div className="italic">
                      {r.details.map((d) => `${d.orderCode}: ${d.qty} ${d.unitName}${d.isExchange ? " (đổi)" : ""}`).join("; ")}
                    </div>
                  )}
                </td>
                <td className="border border-black px-1 text-right whitespace-nowrap font-bold">{chuDonVi([{ unitName: r.baseUnit, qty: r.totalBase }])}</td>
                <td className="border border-black px-1 whitespace-nowrap">{chuDonVi(r.pick)}</td>
                <td className="border border-black px-1 text-center">{r.orderCount}</td>
                <td className="border border-black px-1"></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 text-center">
          <div><p className="font-bold">Người soạn hàng</p><p className="italic">(Ký, họ tên)</p></div>
          <div><p className="font-bold">Thủ kho</p><p className="italic">(Ký, họ tên)</p></div>
        </div>
      </div>
    </div>
  )
}

export default function SoanHangPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Trang />
    </Suspense>
  )
}
