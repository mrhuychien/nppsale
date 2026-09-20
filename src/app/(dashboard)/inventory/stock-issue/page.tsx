"use client"

/**
 * PHIẾU XUẤT KHO LẺ — bản đối xứng của phiếu nhập kho.
 *
 * ⚠ CHO VIỆC THƯỜNG NGÀY MÀ TRƯỚC ĐÂY KHÔNG CÓ CHỖ GHI: hàng vỡ, hàng
 * biếu, hàng mẫu, hàng chuyển chi nhánh. Không có phiếu thì mấy việc ấy
 * hoặc không được ghi (tồn trên máy cao hơn tồn thật), hoặc được ghi
 * bằng một phiếu kiểm kê giả — mà kiểm kê thì ghi lệch vào CHI PHÍ HAO
 * HỤT và làm bẩn báo cáo lãi lỗ.
 *
 * ⚠ MÀN NÀY KHÔNG TỰ TRỪ KHO. Nó ghi một phiếu `draft` rồi gọi
 * `post_stock_issue` — FIFO trong đúng một kho, ghi vết lấy lô, một
 * giao dịch. Trừ ở trình duyệt là đúng cái lỗi mà cả module này sinh ra
 * để dọn.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, PackageMinus, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { formatInt } from "@/lib/utils"
import { ProductPicker, PICKER_PEEK } from "@/components/ui/product-picker"
import { searchReturnProducts } from "@/lib/purchasing/return-form"
import {
  baseQtyOf, overIssueProducts, validIssueLines, friendlyIssueError,
  ISSUE_REASONS, ISSUE_ZONES,
  type IssueLine, type IssueProduct,
} from "@/lib/inventory/stock-issue"
import { errorMessage } from "@/lib/errors"

export default function StockIssuePage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const [products, setProducts] = useState<IssueProduct[]>([])
  const [zone, setZone] = useState("sale")
  const [reason, setReason] = useState("damaged")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<IssueLine[]>([])
  const [term, setTerm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!user?.org_id) return
    let cancelled = false
    supabase
      .from("products")
      .select("id, name, sku, barcode, base_unit, units:product_units(*)")
      .eq("org_id", user.org_id)
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error("[stock-issue] nạp danh mục lỗi:", error.message)
          return
        }
        setProducts(((data as unknown) as IssueProduct[]) || [])
      })
    return () => { cancelled = true }
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSlip = useMemo(
    () => new Set(lines.map((l) => l.product_id).filter(Boolean)),
    [lines]
  )
  const hits = useMemo(
    () => searchReturnProducts(products, term, onSlip, PICKER_PEEK),
    [products, term, onSlip]
  )
  const over = useMemo(() => overIssueProducts(lines), [lines])

  const patchLine = (id: string, p: Partial<IssueLine>) =>
    setLines((a) => a.map((l) => (l.id === id ? { ...l, ...p } : l)))

  /**
   * Tra tồn của MỘT mặt hàng trong kho đang chọn.
   *
   * ⚠ CHỈ LÔ CÒN MỞ, và đúng zone. Cộng cả lô đã đóng là báo có hàng ở
   *   chỗ `post_stock_issue` không lấy được, rồi máy chủ trả lỗi cho
   *   một con số màn hình vừa nói là đủ.
   */
  const fetchOnHand = useCallback(async (productId: string, z: string): Promise<number | null> => {
    const { data, error } = await supabase
      .from("batches")
      .select("qty_on_hand")
      .eq("product_id", productId)
      .eq("warehouse_zone", z)
      .eq("status", "available")
    if (error) {
      console.error("[stock-issue] tra tồn lỗi:", error.message)
      return null
    }
    return ((data as Array<{ qty_on_hand: number | null }>) || [])
      .reduce((s, b) => s + Number(b.qty_on_hand ?? 0), 0)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addProduct = async (p: IssueProduct) => {
    seqRef.current += 1
    const line: IssueLine = {
      id: `${p.id}-${seqRef.current}`,
      product_id: p.id,
      product_name: p.name,
      sku: p.sku ?? "",
      note: "",
      base_unit: p.base_unit,
      available_units: p.units ?? [],
      unit_name: p.base_unit,
      conversion_factor: "1",
      quantity: "",
      /* ⚠ CHƯA TRA XONG THÌ `null`, KHÔNG PHẢI 0. Số 0 đọc như "hết
         hàng" và đó là một câu nói dối. */
      on_hand: null,
    }
    setLines((a) => [...a, line])
    setTerm("")
    const n = await fetchOnHand(p.id, zone)
    setLines((a) => a.map((l) => (l.id === line.id ? { ...l, on_hand: n } : l)))
  }

  /**
   * ⚠ ĐỔI KHO THÌ PHẢI TRA LẠI TỒN CỦA MỌI DÒNG. Giữ nguyên số cũ là
   *   hiện tồn của kho KIA — người dùng đọc một con số đúng cho một kho
   *   họ không còn chọn nữa.
   */
  const changeZone = async (z: string) => {
    setZone(z)
    setLines((a) => a.map((l) => ({ ...l, on_hand: null })))
    const fresh = await Promise.all(
      lines.map(async (l) => ({ id: l.id, n: await fetchOnHand(l.product_id, z) }))
    )
    const byId = new Map(fresh.map((f) => [f.id, f.n]))
    setLines((a) => a.map((l) => (byId.has(l.id) ? { ...l, on_hand: byId.get(l.id)! } : l)))
  }

  const pickUnit = (l: IssueLine, unitName: string) => {
    if (unitName === l.base_unit) {
      patchLine(l.id, { unit_name: unitName, conversion_factor: "1" })
      return
    }
    const u = l.available_units.find((x) => x.unit_name === unitName)
    patchLine(l.id, { unit_name: unitName, conversion_factor: u ? String(u.conversion) : "1" })
  }

  const submit = async () => {
    if (!user?.org_id) return
    const valid = validIssueLines(lines)
    if (valid.length === 0) {
      toast({ title: "Chưa có dòng hàng hợp lệ", variant: "destructive" })
      return
    }
    setSubmitting(true)
    try {
      const { data: head, error: hErr } = await supabase
        .from("stock_entries")
        .insert({
          org_id: user.org_id,
          entry_code: `XKL-${Date.now().toString(36).toUpperCase()}`,
          type: "export",
          status: "draft",
          warehouse_zone: zone,
          issue_reason: reason,
          notes: notes.trim() || null,
          created_by: user.id,
        })
        .select("id")
        .single()
      if (hErr || !head) throw new Error(hErr?.message || "Không tạo được phiếu")
      const entryId = (head as { id: string }).id

      const { data: ins, error: lErr } = await supabase
        .from("stock_entry_lines")
        .insert(
          valid.map((l) => ({
            entry_id: entryId,
            product_id: l.product_id,
            unit_name: l.unit_name || l.base_unit,
            // `quantity` là integer — số thật đi vào `qty_in_base_uom`.
            quantity: Math.round(baseQtyOf(l)),
            unit_cost: 0,
            qty_in_base_uom: baseQtyOf(l),
            qty_in_transaction_uom: Number(l.quantity) || 0,
            transaction_uom: l.unit_name || l.base_unit,
            conversion_factor_snapshot: Number(l.conversion_factor) || 1,
            notes: l.note.trim() || null,
          }))
        )
        .select("id")
      if (lErr) throw new Error(lErr.message)
      /* ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Không đếm là
         một phiếu KHÔNG CÓ DÒNG NÀO được báo "đã lưu". */
      if (!ins || ins.length === 0) {
        throw new Error("Không ghi được dòng hàng nào — nhiều khả năng bạn không có quyền lập phiếu xuất kho.")
      }

      const { error: rErr } = await supabase.rpc("post_stock_issue", { p_entry_id: entryId })
      if (rErr) throw new Error(friendlyIssueError(rErr.message))

      toast({ title: "Đã xuất kho", description: `${valid.length} dòng hàng đã trừ khỏi kho.` })
      router.push(`/inventory/stock-card`)
    } catch (e) {
      toast({ title: "Không xuất được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Phiếu xuất kho"
        description="Xuất lẻ không qua đơn hàng — hàng hỏng, hàng biếu, chuyển kho."
        backHref="/inventory"
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Thông tin chung</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Xuất từ kho *</Label>
            <Select value={zone} onValueChange={changeZone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ISSUE_ZONES.map((z) => (
                  <SelectItem key={z.value} value={z.value}>{z.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Trừ theo FIFO (hạn cũ trước) trong đúng kho đã chọn.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Lý do xuất *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ISSUE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="si-notes" className="text-xs uppercase tracking-wider text-muted-foreground">
              Ghi chú
            </Label>
            <Textarea
              id="si-notes" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ví dụ: vỡ 3 thùng khi bốc dỡ chuyến sáng"
            />
          </div>
        </CardContent>
      </Card>

      {/*
        ⚠ BẤM VÀO LÀ XỔ DANH SÁCH (chủ nhà chốt 20/09/2026). Dùng chung
          `ProductPicker` với phiếu nhập hàng, phiếu trả NCC và phiếu
          nhập kho — một ô tìm cho cả bốn màn.
      */}
      <Card>
        <CardContent className="pt-5">
          <ProductPicker
            id="si-find"
            term={term}
            onTermChange={setTerm}
            disabled={products.length === 0 || submitting}
            items={hits.map((p) => ({
              ...p,
              title: p.name,
              subtitle: `${p.sku || "—"} · ${p.base_unit}`,
            }))}
            onPick={(p) => addProduct(p)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Hàng xuất {lines.length > 0 && `(${lines.length} dòng)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Phiếu chưa có mặt hàng nào. Tìm ở ô trên rồi bấm Thêm.
            </p>
          ) : (
            lines.map((l, i) => (
              <div key={l.id} className="rounded-xl border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{i + 1}. {l.sku || "—"}</div>
                    <div className="truncate text-sm font-semibold">{l.product_name}</div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                    title="Bỏ dòng này khỏi phiếu"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">ĐVT</Label>
                    <Select value={l.unit_name} onValueChange={(v) => pickUnit(l, v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={l.base_unit}>{l.base_unit} (cơ sở)</SelectItem>
                        {l.available_units
                          .filter((u) => u.unit_name !== l.base_unit)
                          .map((u) => (
                            <SelectItem key={u.id} value={u.unit_name}>
                              {u.unit_name} (×{u.conversion})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Số lượng *</Label>
                    <Input
                      type="number" step="any" min={0} value={l.quantity}
                      onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                      className="h-9 text-right tabular-nums"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Tồn kho</Label>
                    {/* ⚠ CHƯA TRA XONG THÌ NÓI LÀ CHƯA BIẾT, đừng in 0 —
                        0 đọc như "hết hàng" và đó là một câu nói dối. */}
                    <div className="flex h-9 items-center justify-end text-sm tabular-nums text-muted-foreground">
                      {l.on_hand === null ? "…" : `${formatInt(l.on_hand)} ${l.base_unit}`}
                    </div>
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Quy ra {l.base_unit}</Label>
                    <div className="flex h-9 items-center justify-end text-sm font-semibold tabular-nums">
                      {formatInt(baseQtyOf(l))}
                    </div>
                  </div>
                  <div className="space-y-1 sm:col-span-12">
                    <Label className="text-xs">Ghi chú</Label>
                    <Input
                      value={l.note}
                      onChange={(e) => patchLine(l.id, { note: e.target.value })}
                      placeholder="—" className="h-9"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ⚠ CẢNH BÁO GOM THEO MẶT HÀNG, giống hệt phép gom của
          `post_stock_issue`. Xét từng dòng là màn hình nói "đủ" rồi máy
          chủ trả về lỗi cho cùng một phiếu. */}
      {over.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {over.map((o) => `${o.name}: cần ${formatInt(o.need)}, kho còn ${formatInt(o.onHand)}`).join(" · ")}.
            {" "}Ghi sổ sẽ bị từ chối — giảm số lượng, đổi kho, hoặc nhập bù trước.
          </span>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{lines.length} dòng</div>
            <div className="truncate text-lg font-bold tabular-nums">
              {formatInt(lines.reduce((s, l) => s + baseQtyOf(l), 0))} đơn vị cơ sở
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push("/inventory")} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={submitting || lines.length === 0}>
            {submitting
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <PackageMinus className="mr-1.5 h-4 w-4" />}
            Xuất kho
          </Button>
        </div>
      </div>
    </div>
  )
}
