"use client"

/**
 * GỘP NHÀ CUNG CẤP (chủ nhà 05/10/2026: "Thêm chức năng gộp NCC") — RPC `gop_nha_cung_cap` (mig 232).
 *
 *  · Màn chi tiết: NCC đang xem là NCC BỊ GỘP; chọn NCC giữ lại bằng ô tìm.
 *  · Danh sách (chọn 2+): chọn MỘT NCC giữ lại trong các NCC đã chọn, các NCC còn lại gộp vào nó.
 * Trước khi gộp hiện những gì sẽ chuyển sang (phiếu nhập, phiếu trả, công nợ, mặt hàng, NV phụ trách) — đọc
 * `so_chung_tu_ncc`. Gộp xong đi tới NCC giữ lại.
 */
import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchSelect } from "@/components/ui/search-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, cn } from "@/lib/utils"
import { loiNcc, moTaChungTu, type SoChungTuNcc } from "@/lib/suppliers/chi-tiet"
import { errorMessage } from "@/lib/errors"

export interface NccTom {
  id: string
  name: string
  code: string | null
  is_active?: boolean | null
}

export function MergeSupplierDialog({
  open,
  onOpenChange,
  nguon,
  chonTrongNguon = false,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Màn chi tiết: [NCC đang xem]. Danh sách: các NCC đã chọn (≥ 2). */
  nguon: NccTom[]
  /** true = NCC giữ lại chọn trong `nguon` (danh sách); false = chọn bằng ô tìm trong cả danh mục. */
  chonTrongNguon?: boolean
  onDone: (vaoId: string) => void
}) {
  const supabase = createClient()
  const { toast } = useToast()
  const [tatCa, setTatCa] = useState<NccTom[]>([])
  const [dangTai, setDangTai] = useState(false)
  const [vaoId, setVaoId] = useState("")
  const [so, setSo] = useState<Record<string, SoChungTuNcc | string>>({})
  const [dangGop, setDangGop] = useState(false)

  useEffect(() => {
    if (!open) return
    setVaoId(chonTrongNguon ? nguon[0]?.id ?? "" : "")
    setSo({})
    if (chonTrongNguon) return
    let huy = false
    setDangTai(true)
    fetchAllForAggregate<NccTom>((from, to) =>
      supabase.from("suppliers").select("id, name, code, is_active", { count: "exact" }).order("id").range(from, to)
    ).then((r) => {
      if (huy) return
      if (r.error) toast({ title: "Không tải được danh sách NCC", description: r.error, variant: "destructive" })
      setTatCa(r.rows)
      setDangTai(false)
    })
    return () => { huy = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const biGop = useMemo(() => nguon.filter((n) => n.id !== vaoId), [nguon, vaoId])
  const khoaBiGop = biGop.map((n) => n.id).join(",")

  // Đọc những gì sẽ chuyển sang của từng NCC bị gộp.
  useEffect(() => {
    if (!open || !vaoId) return
    let huy = false
    Promise.all(biGop.map(async (n) => {
      const { data, error } = await supabase.rpc("so_chung_tu_ncc", { p_supplier_id: n.id })
      return [n.id, error ? loiNcc(error.message) : (data as SoChungTuNcc)] as const
    })).then((ds) => { if (!huy) setSo(Object.fromEntries(ds)) })
    return () => { huy = true }
  }, [open, vaoId, khoaBiGop]) // eslint-disable-line react-hooks/exhaustive-deps

  const vao = (chonTrongNguon ? nguon : tatCa).find((n) => n.id === vaoId) ?? null
  const luaChon = useMemo(
    () => tatCa
      .filter((n) => !nguon.some((x) => x.id === n.id))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"))
      .map((n) => ({ id: n.id, label: n.name, hint: [n.code, n.is_active === false ? "Ngừng hợp tác" : ""].filter(Boolean).join(" · "), keywords: n.code })),
    [tatCa, nguon]
  )

  const gop = async () => {
    if (!vao || biGop.length === 0) return
    setDangGop(true)
    let xong = 0
    try {
      for (const n of biGop) {
        const { error } = await supabase.rpc("gop_nha_cung_cap", { p_tu: n.id, p_vao: vao.id })
        if (error) throw new Error(loiNcc(error.message))
        xong++
      }
      toast({ title: `Đã gộp ${xong} nhà cung cấp vào ${vao.name}` })
      onOpenChange(false)
      onDone(vao.id)
    } catch (err) {
      toast({
        title: xong > 0 ? `Đã gộp ${xong}/${biGop.length} NCC rồi dừng` : "Không gộp được",
        description: errorMessage(err),
        variant: "destructive",
      })
      if (xong > 0) onDone(vao.id)
    } finally {
      setDangGop(false)
    }
  }

  const chuaDocXong = biGop.some((n) => so[n.id] === undefined)
  const lyDoKhoa = !vao ? "Chọn nhà cung cấp giữ lại" : biGop.length === 0 ? "Chọn ít nhất hai nhà cung cấp" : null

  return (
    <Dialog open={open} onOpenChange={(o) => !dangGop && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="gop-ncc">
        <DialogHeader>
          <DialogTitle>Gộp nhà cung cấp</DialogTitle>
          <DialogDescription>
            Mọi phiếu nhập, phiếu trả, công nợ, đơn đặt, mặt hàng và nhân viên phụ trách của NCC bị gộp chuyển sang NCC giữ
            lại; ô hồ sơ còn trống được lấy sang. NCC bị gộp sẽ bị xoá. Không hoàn tác được.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {chonTrongNguon ? (
            <div className="space-y-2" role="radiogroup" aria-label="Nhà cung cấp giữ lại">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Giữ lại nhà cung cấp</Label>
              {nguon.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="radio"
                  aria-checked={vaoId === n.id}
                  onClick={() => setVaoId(n.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm",
                    vaoId === n.id ? "border-primary bg-primary/5 font-semibold" : "bg-card hover:bg-muted/40"
                  )}
                >
                  <span className="min-w-0 truncate">{n.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{vaoId === n.id ? "Giữ lại" : n.code}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="gop-ncc-vao" className="text-xs uppercase tracking-wider text-muted-foreground">Gộp vào nhà cung cấp</Label>
              {dangTai ? (
                <Skeleton className="h-11" />
              ) : (
                <SearchSelect
                  id="gop-ncc-vao"
                  options={luaChon}
                  valueId={vaoId}
                  onPick={(o) => setVaoId(o?.id ?? "")}
                  placeholder="Gõ tên / mã NCC giữ lại…"
                  emptyHint="Không có NCC nào khớp"
                />
              )}
              {vao?.is_active === false && (
                <p className="text-xs text-amber-600">NCC này đang Ngừng hợp tác — gộp xong vẫn ẩn khỏi ô chọn NCC.</p>
              )}
            </div>
          )}

          {vao && biGop.length > 0 && (
            <div className="space-y-2" data-testid="gop-ncc-se-chuyen">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Sẽ chuyển sang {vao.name}</p>
              {biGop.map((n) => {
                const s = so[n.id]
                return (
                  <div key={n.id} className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">
                    <p className="font-semibold">{n.name}{n.code ? <span className="font-normal text-muted-foreground"> · {n.code}</span> : null}</p>
                    {s === undefined ? (
                      <Skeleton className="mt-1 h-4 w-2/3" />
                    ) : typeof s === "string" ? (
                      <p className="text-destructive">{s}</p>
                    ) : (
                      <p className="text-muted-foreground">
                        {moTaChungTu(s.chi_tiet) || "Chưa có chứng từ"}
                        {Number(s.nhan_vien) > 0 ? ` · ${s.nhan_vien} NV phụ trách` : ""}
                        {Number(s.so_khoan_no) > 0 ? ` · còn nợ ${formatCurrency(Number(s.con_no) || 0)}` : ""}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11 lg:h-10" onClick={() => onOpenChange(false)} disabled={dangGop}>Huỷ</Button>
          <Button
            className="h-11 lg:h-10"
            onClick={gop}
            disabled={!!lyDoKhoa || dangGop || chuaDocXong}
            title={lyDoKhoa ?? undefined}
            data-testid="gop-ncc-xac-nhan"
          >
            {dangGop ? "Đang gộp..." : vao ? `Gộp vào ${vao.name}` : "Gộp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
