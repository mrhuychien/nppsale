"use client"

/**
 * BẢNG GIÁ NHẬP HÀNG — chủ nhà 06/10/2026: "Làm thêm phần bảng giá nhập hàng -> lưu giá nhập load lại khi làm đơn,
 * nếu giá có thay đổi thì tự cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)".
 *
 * Mỗi (mặt hàng, đơn vị) một giá. Phiếu nhập HOÀN THÀNH tự ghi giá theo phiếu (mig 234, máy chủ); ở đây xem và sửa
 * tay (RPC `luu_gia_nhap`). Lập phiếu nhập / trả NCC thì giá này điền sẵn vào dòng — trên phiếu vẫn sửa tự do.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import { loadCatalogue } from "@/lib/products/load-catalogue"
import { duocGhiMuaHang } from "@/lib/purchasing/roles"
import {
  dungBangGia, napBangGiaNhap, thayDoiGia, type DongBangGia, type DongGiaNhap, type HangBangGia,
} from "@/lib/purchasing/bang-gia-nhap"
import { viMatchAllWords } from "@/lib/search"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChips } from "@/components/ui/status-chips"
import { CompactSelect } from "@/components/ui/compact-select"
import { CatalogueShortNote } from "@/components/ui/catalogue-short-note"
import { AlertCircle, Loader2, Save, Search, Undo2 } from "lucide-react"

const COT_HANG = "id, name, sku, base_unit, status, cost_price, primary_supplier_id, units:product_units(unit_name, conversion)"
const HIEN_MOI_LAN = 200

type Loc = "all" | "co" | "chua"

export default function PurchasePriceListPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const { toast } = useToast()
  const supabase = createClient()
  const ghiDuoc = duocGhiMuaHang(user?.role)

  const [hang, setHang] = useState<HangBangGia[]>([])
  const [dongGia, setDongGia] = useState<DongGiaNhap[]>([])
  const [ncc, setNcc] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loi, setLoi] = useState<string | null>(null)
  const [thieu, setThieu] = useState(false)
  const [q, setQ] = useState("")
  const [nccId, setNccId] = useState("")
  const [loc, setLoc] = useState<Loc>("all")
  const [soHien, setSoHien] = useState(HIEN_MOI_LAN)
  /** Ô giá đang sửa: khoá (mặt hàng|đơn vị) → chữ trong ô. */
  const [sua, setSua] = useState<Map<string, string>>(new Map())
  const [dangLuu, setDangLuu] = useState(false)

  const nap = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [cat, gia, nccRes] = await Promise.all([
      loadCatalogue<HangBangGia>(supabase, COT_HANG, { orgId: user.org_id }),
      napBangGiaNhap(supabase),
      supabase.from("suppliers").select("id, name").eq("org_id", user.org_id).order("name"),
    ])
    const loiDoc = gia.chuaCo
      ? "Sổ chưa có bảng giá nhập — cần chạy migration 234 trên Supabase."
      : gia.loi
        ? `Không đọc được bảng giá nhập: ${gia.loi}`
        : nccRes.error
          ? `Không đọc được nhà cung cấp: ${nccRes.error.message}`
          : null
    setLoi(loiDoc)
    setThieu(cat.truncated || gia.truncated)
    setHang(cat.rows.filter((p) => p.status !== "inactive"))
    setDongGia(gia.dong)
    setNcc((nccRes.data ?? []) as Array<{ id: string; name: string }>)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.org_id])

  useEffect(() => {
    if (!authLoading) nap()
  }, [authLoading, nap])

  const tenNcc = useMemo(() => new Map(ncc.map((s) => [s.id, s.name])), [ncc])
  const tatCa = useMemo(() => dungBangGia(hang, dongGia, tenNcc), [hang, dongGia, tenNcc])
  const giaCu = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of tatCa) if (r.gia !== null) m.set(r.khoa, r.gia)
    return m
  }, [tatCa])

  const theoNcc = useMemo(
    () => tatCa.filter((r) => (!nccId ? true : nccId === "none" ? !r.nccId : r.nccId === nccId) && viMatchAllWords(q, r.sku, r.ten)),
    [tatCa, nccId, q]
  )
  const dem = useMemo(() => {
    const co = theoNcc.filter((r) => r.gia !== null).length
    return { all: theoNcc.length, co, chua: theoNcc.length - co }
  }, [theoNcc])
  const loc2 = useMemo(
    () => theoNcc.filter((r) => (loc === "co" ? r.gia !== null : loc === "chua" ? r.gia === null : true)),
    [theoNcc, loc]
  )
  useEffect(() => setSoHien(HIEN_MOI_LAN), [q, nccId, loc])

  const thayDoi = useMemo(() => thayDoiGia(sua, giaCu), [sua, giaCu])

  const datO = (k: string, v: string) =>
    setSua((cu) => {
      const m = new Map(cu)
      m.set(k, v)
      return m
    })

  const luu = async () => {
    if (thayDoi.length === 0 || dangLuu) return
    setDangLuu(true)
    try {
      const { data, error } = await supabase.rpc("luu_gia_nhap", { p_dong: thayDoi })
      if (error) throw new Error(error.message)
      const kq = (data ?? {}) as { luu?: number; bo?: number }
      toast({ title: `Đã lưu bảng giá nhập — ${kq.luu ?? 0} giá${kq.bo ? `, bỏ ${kq.bo}` : ""}` })
      setSua(new Map())
      await nap()
    } catch (e) {
      toast({ title: "Không lưu được bảng giá nhập", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDangLuu(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const hien = loc2.slice(0, soHien)
  const nutLuu = ghiDuoc && (
    <div className="flex items-center gap-2">
      {thayDoi.length > 0 && (
        <Button variant="outline" size="sm" onClick={() => setSua(new Map())} disabled={dangLuu}>
          <Undo2 className="mr-1.5 h-4 w-4" /> Bỏ sửa
        </Button>
      )}
      <Button size="sm" onClick={luu} disabled={thayDoi.length === 0 || dangLuu} title={thayDoi.length === 0 ? "Chưa sửa giá nào" : undefined}>
        {dangLuu ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
        Lưu{thayDoi.length > 0 ? ` (${thayDoi.length})` : ""}
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bảng giá nhập"
        description="Giá nhập mỗi mặt hàng theo đơn vị — phiếu nhập hoàn thành tự cập nhật; lập phiếu thì điền sẵn giá này (vẫn sửa được trên phiếu)."
        backHref="/purchasing/receipts"
      >
        {nutLuu}
      </PageHeader>

      {loi && (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {loi}
        </p>
      )}
      {thieu && !loi && <CatalogueShortNote>Danh mục / bảng giá đọc chưa hết — bảng dưới chưa đủ mặt hàng. Tải lại trang.</CatalogueShortNote>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã, tên hàng…" className="pl-9" aria-label="Tìm mặt hàng" />
        </div>
        <CompactSelect
          ariaLabel="Lọc theo nhà cung cấp"
          value={nccId}
          onChange={setNccId}
          emptyLabel="Tất cả NCC"
          options={[{ value: "none", label: "Chưa gán NCC" }, ...ncc.map((s) => ({ value: s.id, label: s.name }))]}
          className="h-10 w-56"
        />
      </div>

      <StatusChips
        active={loc}
        onPick={(k) => setLoc(k as Loc)}
        chips={[
          { key: "all", label: "Tất cả", count: dem.all, accent: "#64748b" },
          { key: "co", label: "Đã có giá", count: dem.co, accent: "#16a34a" },
          { key: "chua", label: "Chưa có giá", count: dem.chua, accent: "#d97706" },
        ]}
      />

      {loading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm" data-testid="bang-gia-nhap">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Mã hàng</th>
                <th className="px-3 py-2 text-left">Tên hàng</th>
                <th className="px-3 py-2 text-left max-md:hidden">NCC</th>
                <th className="px-3 py-2 text-left">ĐVT</th>
                <th className="px-3 py-2 text-right">Giá nhập</th>
                <th className="px-3 py-2 text-left max-md:hidden">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {hien.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {tatCa.length === 0 ? "Chưa có mặt hàng nào." : "Không có mặt hàng nào khớp bộ lọc."}
                  </td>
                </tr>
              ) : (
                hien.map((r) => <DongGia key={r.khoa} r={r} ghiDuoc={ghiDuoc} o={sua.get(r.khoa)} datO={datO} />)
              )}
            </tbody>
          </table>
          {loc2.length > soHien && (
            <div className="border-t p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setSoHien((n) => n + HIEN_MOI_LAN)}>
                Hiện thêm ({loc2.length - soHien} dòng)
              </Button>
            </div>
          )}
        </div>
      )}
      {thayDoi.length > 0 && ghiDuoc && (
        <div className="sticky bottom-3 flex justify-end">{nutLuu}</div>
      )}
    </div>
  )
}

function DongGia({ r, ghiDuoc, o, datO }: { r: DongBangGia; ghiDuoc: boolean; o: string | undefined; datO: (k: string, v: string) => void }) {
  const giaTri = o ?? (r.gia === null ? "" : String(r.gia))
  const daSua = o !== undefined && o.trim() !== (r.gia === null ? "" : String(r.gia))
  return (
    <tr className="border-t" data-testid="dong-gia-nhap" data-khoa={r.khoa}>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.laCoSo ? r.sku || "—" : ""}</td>
      <td className="px-3 py-1.5">{r.laCoSo ? r.ten : <span className="text-muted-foreground">↳ {r.ten}</span>}</td>
      <td className="px-3 py-1.5 text-muted-foreground max-md:hidden">{r.laCoSo ? r.ncc || "—" : ""}</td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        {r.donVi}
        {!r.laCoSo && <span className="text-xs text-muted-foreground"> ×{r.heSo}</span>}
      </td>
      <td className="px-3 py-1.5 text-right">
        {ghiDuoc ? (
          <Input
            type="number"
            step="any"
            min={0}
            inputMode="numeric"
            aria-label={`Giá nhập ${r.ten} theo ${r.donVi}`}
            value={giaTri}
            /* Chưa có giá riêng: hiện giá sẽ gợi ý (quy từ đơn vị khác / giá vốn mặc định) làm chữ mờ. */
            placeholder={r.gia === null && r.goiY > 0 ? `≈ ${formatCurrency(r.goiY)}` : "Chưa có"}
            onChange={(e) => datO(r.khoa, e.target.value)}
            className={`ml-auto h-9 w-32 text-right tabular-nums ${daSua ? "border-amber-400 bg-amber-50" : ""}`}
          />
        ) : (
          <span className="tabular-nums">
            {r.gia !== null ? formatCurrency(r.gia) : r.goiY > 0 ? <span className="text-muted-foreground">≈ {formatCurrency(r.goiY)}</span> : "—"}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground max-md:hidden">
        {r.gia === null ? (
          ""
        ) : (
          <>
            {r.ngay ? formatDate(r.ngay) : ""}
            {r.nguon ? (
              <>
                {" · theo "}
                <Link href={`/purchasing/receipts/${r.nguon.id}`} className="text-primary hover:underline">{r.nguon.ma}</Link>
              </>
            ) : (
              " · sửa tay"
            )}
          </>
        )}
      </td>
    </tr>
  )
}
