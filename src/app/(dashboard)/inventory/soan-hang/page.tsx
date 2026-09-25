"use client"

/**
 * KHO VẬN › SOẠN HÀNG — gộp nhiều HÓA ĐƠN thành một đơn tổng, in cho kho nhặt.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng >
 *   mở ra chọn danh sách Hoá đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn
 *   tổng. Bỏ cái hiện tại trong đơn hàng đi."
 *
 * Chọn hóa đơn: danh sách hóa đơn đã xuất mới nhất hiện sẵn; ô tìm theo mã hóa
 * đơn / mã đơn / tên khách / SĐT; "Thêm tất cả". Lựa chọn nằm trên đường dẫn
 * (`?ids=`) — tải lại hay gửi link cho kho vẫn đúng các hóa đơn ấy.
 *
 * ⚠ CHỈ ĐỌC — kho đã trừ lúc ghi sổ hóa đơn. Xem `lib/orders/pick-list.ts`.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Search, X, ListPlus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { PrintButton } from "@/components/ui/print-button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/utils"
import { loadOrgHeader, EMPTY_ORG_HEADER, type OrgHeader } from "@/lib/org/header"
import {
  chuDonVi, docIds, gopSoanHang, soanHangHref,
  type PickDoc, type PickLine, type ProductUnits,
} from "@/lib/orders/pick-list"

interface HoaDon {
  id: string
  invoice_code: string
  invoice_date: string | null
  status: string
  total: number | null
  customer?: { store_name?: string | null; phone?: string | null } | null
  order?: { order_code?: string | null } | null
}

interface DongHD {
  invoice_id: string
  product_id: string
  unit_name: string
  quantity: number
  conversion_factor: number | null
  is_exchange: boolean | null
  product?: ({ name?: string | null; sku?: string | null } & ProductUnits) | null
}

const COT_HD = "id, invoice_code, invoice_date, status, total, customer:customers(store_name, phone), order:sales_orders(order_code)"
/** Trần kết quả — đủ cho một ngày giao hàng, không kéo cả sổ về. */
const TRAN_TIM = 50

function Trang() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const router = useRouter()
  const params = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [chon, setChon] = useState<HoaDon[]>([])
  const [dong, setDong] = useState<DongHD[]>([])
  const [daDoc, setDaDoc] = useState<Set<string>>(new Set())
  const [loiDong, setLoiDong] = useState<string | null>(null)
  /** Số lượt đọc dòng đang chờ — > 0 là "đang nạp". */
  const [choDoc, setChoDoc] = useState(0)
  const [napDau, setNapDau] = useState(true)
  const [org, setOrg] = useState<OrgHeader>(EMPTY_ORG_HEADER)

  const [q, setQ] = useState("")
  const [caDaHuy, setCaDaHuy] = useState(false)
  const [ketQua, setKetQua] = useState<HoaDon[] | null>(null)
  const [dangTim, setDangTim] = useState(false)
  const [chiTiet, setChiTiet] = useState(true)

  /* ---- nạp hóa đơn từ đường dẫn ---- */
  const idsUrl = params.get("ids")
  useEffect(() => {
    if (authLoading) return
    const ids = docIds(idsUrl)
    let huy = false
    ;(async () => {
      if (ids.length === 0) { setNapDau(false); return }
      const { data, error } = await supabase.from("sales_invoices").select(COT_HD).in("id", ids)
      if (huy) return
      if (error) console.error("[soan-hang] đọc hóa đơn lỗi:", error.message)
      const theoId = new Map(((data as unknown as HoaDon[]) ?? []).map((d) => [d.id, d]))
      setChon(ids.map((id) => theoId.get(id)).filter((d): d is HoaDon => !!d))
      setNapDau(false)
    })()
    return () => { huy = true }
    // Chỉ lần mở màn: sau đó màn tự giữ `chon` và ghi ngược ra đường dẫn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading])

  useEffect(() => {
    if (user?.org_id) loadOrgHeader(supabase, user.org_id).then(setOrg).catch(() => {})
  }, [user?.org_id, supabase])

  const idsChon = chon.map((d) => d.id)
  const khoaChon = idsChon.join(",")
  useEffect(() => {
    if (napDau) return
    if (khoaChon !== docIds(idsUrl).join(",")) router.replace(soanHangHref(idsChon), { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaChon, napDau])

  /* ---- dòng hóa đơn: MỘT truy vấn cho mọi hóa đơn mới chọn, kèm đơn vị quy đổi ---- */
  useEffect(() => {
    const can = idsChon.filter((id) => !daDoc.has(id))
    if (can.length === 0) return
    setDaDoc((s) => new Set([...Array.from(s), ...can]))
    setChoDoc((n) => n + 1)
    supabase
      .from("sales_invoice_lines")
      .select("invoice_id, product_id, unit_name, quantity, conversion_factor, is_exchange, product:products(name, sku, base_unit, units:product_units(unit_name, conversion))")
      .in("invoice_id", can)
      .then(({ data, error }) => {
        if (error) {
          setLoiDong(error.message)
          setDaDoc((s) => { const n = new Set(s); for (const id of can) n.delete(id); return n })
          return
        }
        setLoiDong(null)
        setDong((s) => [...s.filter((l) => !can.includes(l.invoice_id)), ...((data as unknown as DongHD[]) ?? [])])
      })
      .then(() => setChoDoc((n) => n - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khoaChon, supabase])

  /* ---- danh sách / tìm hóa đơn ---- */
  const timRef = useRef(0)
  const tim = useCallback(async (tu: string) => {
    const term = tu.trim()
    const luot = ++timRef.current
    setDangTim(true)
    let qd = supabase
      .from("sales_invoices")
      .select(COT_HD)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(TRAN_TIM)
    qd = caDaHuy ? qd.in("status", ["posted", "cancelled"]) : qd.eq("status", "posted")
    if (term) {
      const like = `%${term.replace(/[%,()]/g, " ")}%`
      const [{ data: kh }, { data: dh }] = await Promise.all([
        supabase.from("customers").select("id").or(`store_name.ilike.${like},phone.ilike.${like},owner_name.ilike.${like}`).limit(200),
        supabase.from("sales_orders").select("id").ilike("order_code", like).limit(200),
      ])
      const idsKh = ((kh as Array<{ id: string }>) ?? []).map((k) => k.id)
      const idsDh = ((dh as Array<{ id: string }>) ?? []).map((k) => k.id)
      const hoac = [`invoice_code.ilike.${like}`]
      if (idsKh.length) hoac.push(`customer_id.in.(${idsKh.join(",")})`)
      if (idsDh.length) hoac.push(`order_id.in.(${idsDh.join(",")})`)
      qd = qd.or(hoac.join(","))
    }
    const { data, error } = await qd
    if (luot !== timRef.current) return
    if (error) console.error("[soan-hang] tìm hóa đơn lỗi:", error.message)
    setKetQua((data as unknown as HoaDon[]) ?? [])
    setDangTim(false)
  }, [supabase, caDaHuy])

  useEffect(() => {
    if (authLoading) return
    const t = setTimeout(() => { void tim(q) }, 250)
    return () => clearTimeout(t)
  }, [q, tim, authLoading])

  const them = (d: HoaDon) => setChon((s) => (s.some((x) => x.id === d.id) ? s : [...s, d]))
  const bo = (id: string) => {
    setChon((s) => s.filter((x) => x.id !== id))
    setDong((s) => s.filter((l) => l.invoice_id !== id))
    setDaDoc((s) => { const n = new Set(s); n.delete(id); return n })
  }
  const chuaChon = (ketQua ?? []).filter((d) => !idsChon.includes(d.id))

  /* ---- đơn tổng ---- */
  const rows = useMemo(() => {
    const sp: Record<string, ProductUnits> = {}
    const theoHD = new Map<string, PickLine[]>()
    for (const l of dong) {
      if (l.product) sp[l.product_id] = { base_unit: l.product.base_unit, units: l.product.units }
      const ds = theoHD.get(l.invoice_id) ?? []
      ds.push({
        productId: l.product_id,
        productName: l.product?.name || "Sản phẩm đã xoá",
        sku: l.product?.sku ?? null,
        unitName: l.unit_name,
        conversionFactor: Number(l.conversion_factor) || 1,
        qty: Number(l.quantity) || 0,
        isExchange: l.is_exchange === true,
      })
      theoHD.set(l.invoice_id, ds)
    }
    const ct = chon
      .filter((d) => theoHD.has(d.id))
      .map((d) => ({ doc: { id: d.id, code: d.invoice_code, customerName: d.customer?.store_name || "Khách lẻ" } as PickDoc, lines: theoHD.get(d.id)! }))
    return gopSoanHang(ct, sp)
  }, [dong, chon])
  const dangNap = choDoc > 0
  const huyTrongChon = chon.filter((d) => d.status === "cancelled")

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <PageHeader
          title="Soạn hàng"
          description="Chọn các hóa đơn cần giao → gộp thành đơn tổng để kho nhặt hàng một lượt, rồi in."
          backHref="/inventory"
        >
          <PrintButton label="In đơn tổng" defaultPaper="A4" disabled={rows.length === 0 || dangNap} />
        </PageHeader>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* ---- chọn hóa đơn ---- */}
          <aside className="space-y-3 self-start lg:sticky lg:top-4">
            <div className="space-y-2.5 rounded-xl border bg-card p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Mã hóa đơn, mã đơn, tên khách, SĐT…"
                  className="pl-9"
                  aria-label="Tìm hóa đơn để gộp"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={caDaHuy} onChange={(e) => setCaDaHuy(e.target.checked)} />
                Hiện cả hóa đơn đã huỷ (mặc định chỉ hóa đơn đã xuất)
              </label>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {dangTim || !ketQua
                      ? "Đang tải…"
                      : `${q.trim() ? "" : "Mới nhất · "}${ketQua.length} hóa đơn${ketQua.length >= TRAN_TIM ? " (hiện 50)" : ""}`}
                  </span>
                  {chuaChon.length > 1 && (
                    <button type="button" className="font-semibold text-primary" onClick={() => chuaChon.forEach(them)}>
                      <ListPlus className="mr-1 inline h-3.5 w-3.5" />
                      Thêm tất cả ({chuaChon.length})
                    </button>
                  )}
                </div>
                <div className="max-h-[420px] space-y-1 overflow-y-auto">
                  {!ketQua ? (
                    <Skeleton className="h-24" />
                  ) : ketQua.length === 0 && !dangTim ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">Không có hóa đơn nào khớp.</p>
                  ) : (
                    ketQua.map((d) => {
                      const da = idsChon.includes(d.id)
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled={da}
                          onClick={() => them(d)}
                          data-testid="ket-qua-hoa-don"
                          className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-xs font-bold">
                              {d.invoice_code}
                              {d.status === "cancelled" && <span className="ml-1 font-sans text-destructive">· đã huỷ</span>}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {d.customer?.store_name || "Khách lẻ"} · {d.invoice_date ? formatDate(d.invoice_date) : "—"}
                              {d.order?.order_code ? ` · ${d.order.order_code}` : ""}
                            </span>
                          </span>
                          {da ? <span className="text-xs text-muted-foreground">Đã chọn</span> : <Plus className="h-4 w-4 text-primary" />}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hóa đơn đã chọn · {chon.length}</p>
                {chon.length > 0 && (
                  <button type="button" className="text-xs font-semibold text-muted-foreground" onClick={() => { setChon([]); setDong([]); setDaDoc(new Set()) }}>
                    Bỏ hết
                  </button>
                )}
              </div>
              {napDau ? (
                <Skeleton className="h-16" />
              ) : chon.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Chưa chọn hóa đơn nào — bấm vào hóa đơn ở danh sách trên.</p>
              ) : (
                <div className="space-y-1" data-testid="hoa-don-da-chon">
                  {chon.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-bold">{d.invoice_code}</span>{" "}
                        <span className="text-xs text-muted-foreground">{d.customer?.store_name || "Khách lẻ"}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(Number(d.total) || 0)}</span>
                      <button type="button" aria-label={`Bỏ ${d.invoice_code}`} onClick={() => bo(d.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* ---- đơn tổng ---- */}
          <div className="space-y-3 lg:col-span-2">
            {loiDong && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                Không đọc được dòng hóa đơn — {loiDong}
              </p>
            )}
            {huyTrongChon.length > 0 && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                Có {huyTrongChon.length} hóa đơn ĐÃ HUỶ trong lựa chọn: {huyTrongChon.map((d) => d.invoice_code).join(", ")}.
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Đơn tổng: {rows.length} mặt hàng · {chon.length} hóa đơn</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chiTiet} onChange={(e) => setChiTiet(e.target.checked)} />
                Hiện / in chi tiết theo hóa đơn
              </label>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <TableHead>Mặt hàng</TableHead>
                    <TableHead className="text-right">Tổng cần nhặt</TableHead>
                    <TableHead>Lấy hàng</TableHead>
                    <TableHead className="text-right">Số HĐ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dangNap && rows.length === 0 ? (
                    <TableRow><TableCell colSpan={4}><Skeleton className="h-10" /></TableCell></TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        {chon.length === 0 ? "Chọn hóa đơn để gộp thành đơn tổng." : "Các hóa đơn đã chọn không có dòng hàng nào."}
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
                                  {d.docCode} · {d.customerName}: {d.qty} {d.unitName}{d.isExchange ? " (hàng đổi)" : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-bold tabular-nums">
                          {chuDonVi([{ unitName: r.baseUnit, qty: r.totalBase }])}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{chuDonVi(r.pick)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.docCount}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>

      {/* ---- tờ in: ĐƠN TỔNG ---- */}
      <div className="print-only a4-doc text-[12px] text-black" data-testid="to-in-soan-hang">
        <p className="font-bold uppercase leading-tight">{org.name || ""}</p>
        {org.address && <p className="leading-tight">Địa chỉ: {org.address}</p>}
        <h1 className="mt-1.5 text-center text-xl font-bold">PHIẾU SOẠN HÀNG (ĐƠN TỔNG)</h1>
        <p className="text-center">
          Ngày {formatDate(new Date().toISOString())} · {chon.length} hóa đơn · {rows.length} mặt hàng
        </p>
        <p className="mt-1 leading-snug">
          <b>Gộp các hóa đơn:</b> {chon.map((d) => `${d.invoice_code} (${d.customer?.store_name || "Khách lẻ"})`).join("; ")}
        </p>
        <table className="mt-1.5 w-full border-collapse">
          <thead>
            <tr className="text-center font-bold">
              <th className="w-8 border border-black px-1">STT</th>
              <th className="border border-black px-1">Tên hàng</th>
              <th className="border border-black px-1">Tổng cần nhặt</th>
              <th className="border border-black px-1">Lấy hàng</th>
              <th className="w-10 border border-black px-1">Số HĐ</th>
              <th className="w-12 border border-black px-1">Đã nhặt</th>
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
                      {r.details.map((d) => `${d.docCode}: ${d.qty} ${d.unitName}${d.isExchange ? " (đổi)" : ""}`).join("; ")}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap border border-black px-1 text-right font-bold">{chuDonVi([{ unitName: r.baseUnit, qty: r.totalBase }])}</td>
                <td className="whitespace-nowrap border border-black px-1">{chuDonVi(r.pick)}</td>
                <td className="border border-black px-1 text-center">{r.docCount}</td>
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
