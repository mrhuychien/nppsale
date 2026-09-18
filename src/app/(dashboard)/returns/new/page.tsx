"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Search, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { SEARCH_FIELD_PROPS } from "@/lib/ui/search-field"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { viMatchAllWords } from "@/lib/search"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { userPriceRulesFrom } from "@/lib/pricing"
import {
  RETURN_REASONS,
  addReturnLine,
  patchReturnLine,
  returnCreditOf,
  returnPriceViolation,
  setReturnQty,
  toReturnLine,
  type ReturnCartLine,
} from "@/lib/sell/returns"
import type { Customer } from "@/types"

/**
 * Lập phiếu trả hàng.
 *
 * ⚠ BẢN TRƯỚC GHI TIỀN MÀ KHÔNG GHI HÀNG. Màn này chỉ có: chọn khách, chọn
 * lý do, và GÕ TAY một con số "Giá trị Credit Note" — không dòng hàng nào.
 * Hậu quả:
 *   · Kho không biết phải nhận lại cái gì, bao nhiêu.
 *   · Số tiền trừ công nợ khách là con số ai đó tự gõ, không đối chiếu được
 *     với bất kỳ mặt hàng nào.
 *   · Màn chi tiết phiếu trả VẪN đọc `return_lines` để hiện bảng hàng, nên
 *     mọi phiếu tạo từ đây mở ra là một bảng rỗng.
 *   · Trigger `trg_return_lines_sync_credit` (migration 035) tính lại
 *     `credit_note_amount` từ các dòng — phiếu không dòng thì nó không chạy,
 *     và con số gõ tay nằm lại đó vĩnh viễn, không ai kiểm được.
 *
 * Nay phiếu trả có DÒNG HÀNG thật, và tiền là TỔNG của các dòng.
 */

/**
 * Hóa đơn bán của khách — thứ phiếu trả gắn vào từ workflow v2b.
 *
 * ⚠ GẮN VÀO HÓA ĐƠN, KHÔNG GẮN VÀO ĐƠN. Khách chỉ trả được thứ đã THỰC
 * XUẤT; đơn đặt 100 mà mới giao 40 thì trần trả là 40. Gắn vào đơn là
 * cho phép nhập kho 60 món chưa từng rời kho — và cả trigger lẫn RPC đều
 * đếm theo hóa đơn, nên phiếu gắn sai chỗ sẽ vấp lỗi ở màn Hoàn thành,
 * một chỗ chẳng liên quan gì tới việc người ta vừa làm.
 */
interface InvoiceLite {
  id: string
  invoice_code: string
  invoice_date: string
  total: number
  order_id: string
}

interface InvoiceLineLite {
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
}

interface ProductLite {
  id: string
  name: string
  sku: string
  barcode: string | null
  base_unit: string
  vat_rate: number | null
  sell_price: number | null
}

const PICK_CAP = 20

export default function NewReturnPage() {
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("returns")
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()
  /**
   * ⚠ TRẦN GIÁ TRẢ = TRẦN GIÁ BÁN CỦA CHÍNH NGƯỜI ĐÓ — cùng một thẩm quyền
   * về tiền, cùng một con số. Để hai màn lập phiếu trả hai trần khác nhau
   * là mở đường cho người ta chọn màn nào dễ hơn.
   */
  const priceRules = (() => {
    const r = userPriceRulesFrom(user)
    return { maxIncreasePct: Number(r.price_edit_max_increase_pct ?? 0), free: r.free }
  })()

  const [customers, setCustomers] = useState<Pick<Customer, "id" | "store_name">[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * Mở sẵn theo hóa đơn khi tới từ màn Hóa đơn bán.
   *
   * ⚠ ĐỌC MỘT LẦN LÚC DỰNG. Đọc mỗi lần render rồi ghi đè `useState` là
   * người dùng đổi khách xong bị kéo ngược về khách cũ.
   */
  const params = useSearchParams()
  const [customerId, setCustomerId] = useState(() => params.get("customerId") ?? "")
  const [invoiceId, setInvoiceId] = useState(() => params.get("invoiceId") ?? "")
  const [invoices, setInvoices] = useState<InvoiceLite[]>([])
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLineLite[]>([])
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<ReturnCartLine[]>([])
  const [q, setQ] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const [custRes, prodRes] = await Promise.all([
        // ⚠ Phân trang: hơn 1.000 khách là chuyện thường, mà server cắt ở
        // 1.000 dòng và KHÔNG báo — khách nằm sau đó thì không lập được phiếu.
        fetchAllForAggregate<Pick<Customer, "id" | "store_name">>((from, to) =>
          createClient()
            .from("customers")
            .select("id, store_name", { count: "exact" })
            .eq("status", "active")
            .order("store_name")
            .range(from, to)
        ),
        fetchAllForAggregate<ProductLite>((from, to) =>
          createClient()
            .from("products")
            .select("id, name, sku, barcode, base_unit, vat_rate, sell_price", { count: "exact" })
            .eq("status", "active")
            .order("name")
            .range(from, to)
        ),
      ])
      // ⚠ Đọc hỏng mà hiện danh sách rỗng là để người dùng kết luận "chưa
      // có khách nào" rồi đi tạo khách trùng.
      setLoadError(custRes.error ?? prodRes.error ?? null)
      setCustomers(custRes.rows)
      setProducts(prodRes.rows)
    }
    load()
  }, [])

  // Đơn gần đây của khách — để gắn phiếu trả vào đúng đơn đã bán.
  useEffect(() => {
    setInvoiceId("")
    setInvoices([])
    setInvoiceLines([])
    if (!customerId) return
    let cancelled = false
    ;(async () => {
      // ⚠ CHỈ HÓA ĐƠN CÒN HIỆU LỰC. Hóa đơn đã huỷ đã hoàn hàng về kho
      //   rồi; gắn phiếu trả vào nó là nhập kho lần thứ hai.
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_code, invoice_date, total, order_id")
        .eq("customer_id", customerId)
        .eq("status", "posted")
        .order("invoice_date", { ascending: false })
        .limit(20)
      if (cancelled) return
      if (error) {
        console.error("[returns/new] truy vấn hóa đơn lỗi:", error.message)
        return
      }
      const rows = (data as InvoiceLite[]) ?? []
      /**
       * ⚠ HÓA ĐƠN ĐƯỢC CHỈ ĐÍCH DANH PHẢI CÓ MẶT, dù nó cũ hơn 20 tờ gần
       *   nhất. Danh sách trên cắt ở 20; tới đây từ một hóa đơn tháng
       *   trước thì ô chọn hiện trống trơn trong khi bên dưới đã nạp đúng
       *   dòng hàng của nó — người dùng thấy một màn tự mâu thuẫn.
       */
      if (invoiceId && !rows.some((r) => r.id === invoiceId)) {
        const { data: one } = await supabase
          .from("sales_invoices")
          .select("id, invoice_code, invoice_date, total, order_id")
          .eq("id", invoiceId)
          .maybeSingle()
        if (cancelled) return
        if (one) rows.unshift(one as InvoiceLite)
      }
      setInvoices(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [customerId, invoiceId, supabase])

  // Dòng hàng của đơn được chọn — nguồn gợi ý chuẩn nhất cho phiếu trả.
  useEffect(() => {
    setInvoiceLines([])
    if (!invoiceId) return
    let cancelled = false
    ;(async () => {
      // ⚠ GỢI Ý TỪ DÒNG HÓA ĐƠN: đúng số đã giao và đúng giá đã bán của
      //   chính chuyến đó. Dòng đơn có thể ghi số lớn hơn thứ đã ra khỏi
      //   kho, và giá thì có thể đã bị sửa lúc xuất.
      const { data, error } = await supabase
        .from("sales_invoice_lines")
        .select("product_id, unit_name, quantity, unit_price")
        .eq("invoice_id", invoiceId)
        .eq("is_exchange", false)
      if (cancelled) return
      if (error) {
        console.error("[returns/new] truy vấn dòng hóa đơn lỗi:", error.message)
        return
      }
      setInvoiceLines((data as InvoiceLineLite[]) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId, supabase])

  const productById = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p]))
    return (id: string) => m.get(id)
  }, [products])

  /**
   * ⚠ GIÁ LẤY TỪ ĐƠN ĐÃ BÁN, không lấy giá bảng hôm nay. Khách mua có chiết
   * khấu thì trả lại phải tính đúng số tiền họ đã trả — lấy giá hôm nay là
   * hoàn cho khách nhiều hơn (hoặc ít hơn) số đã thu.
   */
  const addFromOrder = (l: InvoiceLineLite) => {
    const p = productById(l.product_id)
    setLines((prev) =>
      addReturnLine(prev, {
        productId: l.product_id,
        unit: l.unit_name,
        qty: 1,
        price: Number(l.unit_price) || 0,
        vatRate: Number(p?.vat_rate ?? 0),
        isExchange: false,
        note: "",
      })
    )
  }

  const addFromCatalog = (p: ProductLite) => {
    setLines((prev) =>
      addReturnLine(prev, {
        productId: p.id,
        unit: p.base_unit,
        qty: 1,
        price: Number(p.sell_price) || 0,
        vatRate: Number(p.vat_rate ?? 0),
        isExchange: false,
        note: "",
      })
    )
  }

  const found = useMemo(() => {
    const term = q.trim()
    if (!term) return []
    return products
      .filter((p) => viMatchAllWords(term, p.name, p.sku, p.barcode ?? ""))
      .slice(0, PICK_CAP)
  }, [q, products])

  const credit = returnCreditOf(lines)
  /** ⚠ Trả CAO hơn giá đã bán / giá bảng là một đường rút tiền. */
  const priceBad = lines.filter((l) => {
    const sold = invoiceLines.find((o) => o.product_id === l.productId && o.unit_name === l.unit)
    const ceiling = sold ? Number(sold.unit_price) : Number(productById(l.productId)?.sell_price ?? 0)
    return returnPriceViolation(l, ceiling, priceRules) !== null
  }).length

  const blocked =
    !customerId
      ? "Chọn khách hàng"
      : !reason
        ? "Chọn lý do trả"
        : lines.length === 0
          ? // ⚠ Phiếu trả 0 dòng vẫn hiện ở danh sách chờ xử lý, và không ai
            // biết phải nhận lại cái gì. Đó chính là lỗi của bản trước.
            "Thêm ít nhất một mặt hàng"
          : priceBad > 0
            ? "Có dòng trả vượt trần giá"
            : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (blocked || saving || !user?.org_id) return
    setSaving(true)
    try {
      const { data: head, error: headErr } = await supabase
        .from("returns")
        .insert({
          org_id: user.org_id,
          customer_id: customerId,
          /**
           * ⚠ GHI CẢ HAI. `invoice_id` là mốc thật của v2b (trần số
           * lượng trả, tính lại công nợ), còn `order_id` là thứ mọi báo
           * cáo lịch sử đang đọc — bỏ nó là đứt một nửa sổ.
           */
          invoice_id: invoiceId || null,
          order_id: invoices.find((i) => i.id === invoiceId)?.order_id ?? null,
          requested_by: user.id,
          reason,
          notes: notes.trim() || null,
          /**
           * ⚠ LẬP PHIẾU RA Ở "PHIẾU TẠM", KHÔNG PHẢI "HOÀN THÀNH".
           *
           * Bản trước ghi thẳng 'completed' vì hồi đó có trigger tự nhập
           * kho khi phiếu trả chuyển trạng thái. Migration 120 đã GỠ
           * trigger ấy — `complete_return` là đường duy nhất còn nhập kho
           * và giảm công nợ. Một phiếu 'completed' không đi qua RPC nghĩa
           * là: hàng khách trả KHÔNG vào tồn, công nợ KHÔNG giảm, và phiếu
           * thì trông như đã xong nên không ai quay lại xử lý nó.
           *
           * Người lập phiếu ghi nhận yêu cầu trả; người có quyền
           * `returns.approve` bấm Hoàn thành và CHỌN kho nhận — hàng còn
           * bán được hay phải để riêng là quyết định của họ, không đoán hộ.
           */
          status: "submitted",
          // Trigger `trg_return_lines_sync_credit` sẽ tính lại từ các dòng;
          // ghi sẵn ở đây để phiếu không có một khoảnh khắc nào mang số 0.
          credit_note_amount: credit,
        })
        .select("id")
        .single()
      if (headErr) throw headErr
      // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi.
      if (!head?.id) {
        throw new Error("Không tạo được phiếu trả — bạn không có quyền trên đơn vị này.")
      }

      const { data: inserted, error: lineErr } = await supabase
        .from("return_lines")
        .insert(lines.map((l) => ({ return_id: head.id, ...toReturnLine(l) })))
        .select("id")
      if (lineErr) throw lineErr
      /**
       * ⚠ ĐẦU PHIẾU GHI ĐƯỢC MÀ DÒNG HÀNG BỊ TỪ CHỐI thì sinh ra đúng thứ
       * vừa đi sửa: một phiếu trả có tiền mà không có hàng. Đếm số dòng
       * chèn được và nói ra, đừng báo "đã tạo".
       */
      if (!inserted || inserted.length !== lines.length) {
        throw new Error(
          `Đã tạo phiếu nhưng chỉ ghi được ${inserted?.length ?? 0}/${lines.length} dòng hàng. Mở phiếu ra kiểm tra trước khi dùng.`
        )
      }

      // ⚠ ĐỪNG HỨA ĐÃ TRỪ CÔNG NỢ. Lúc này chưa trừ gì cả — công nợ và
      // tồn kho chỉ đổi khi ai đó bấm Hoàn thành. Hứa sai ở đây là kế
      // toán đóng sổ với một con số chưa xảy ra.
      toast({
        title: "Đã lập phiếu trả hàng",
        description: `Khoản có ${formatCurrency(credit)} — chờ bấm Hoàn thành để nhập kho và trừ công nợ.`,
      })
      router.push(`/returns/${head.id}`)
    } catch (err: unknown) {
      toast({
        title: "Không tạo được phiếu trả",
        description: errorMessage(err),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Lập phiếu trả hàng" backHref="/returns" />

      {loadError && (
        <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          Không tải được danh mục: {loadError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Khách hàng &amp; lý do</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Khách hàng *
              </Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn khách hàng" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.store_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Lý do *
              </Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn lý do" />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ⚠ Gắn phiếu vào HÓA ĐƠN ĐÃ XUẤT thì mới đối chiếu được:
                hàng này giao ngày nào, giá bao nhiêu, đã thu chưa. Không
                bắt buộc vì khách vẫn trả được hàng mua từ lâu không còn
                tra ra chứng từ. */}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Hóa đơn liên quan
              </Label>
              <Select value={invoiceId || "none"} onValueChange={(v) => setInvoiceId(v === "none" ? "" : v)}>
                <SelectTrigger disabled={!customerId}>
                  <SelectValue placeholder={customerId ? "Không gắn hóa đơn nào" : "Chọn khách trước"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Không gắn hóa đơn nào</SelectItem>
                  {invoices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.invoice_code} · {formatDate(o.invoice_date)} · {formatCurrency(o.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hàng trả *</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Hàng trong đơn đã chọn — đường nhanh nhất và đúng giá nhất. */}
            {invoiceLines.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Hàng trên hóa đơn này
                </p>
                <div className="flex flex-wrap gap-2">
                  {invoiceLines.map((l) => (
                    <Button
                      key={`${l.product_id}|${l.unit_name}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto py-1.5"
                      onClick={() => addFromOrder(l)}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {productById(l.product_id)?.name ?? "—"}
                      <span className="ml-1.5 text-muted-foreground">
                        {l.unit_name} · {formatCurrency(l.unit_price)}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm sản phẩm khác: tên, mã hàng, mã vạch…"
                {...SEARCH_FIELD_PROPS}
                className="pl-10"
              />
            </div>
            {found.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {found.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto py-1.5"
                    onClick={() => addFromCatalog(p)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {p.name}
                    <span className="ml-1.5 text-muted-foreground">{p.sku}</span>
                  </Button>
                ))}
              </div>
            )}

            {lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Chưa có mặt hàng nào. Chọn từ đơn ở trên hoặc tìm trong danh mục.
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const p = productById(l.productId)
                  const sold = invoiceLines.find(
                    (o) => o.product_id === l.productId && o.unit_name === l.unit
                  )
                  const ceiling = sold ? Number(sold.unit_price) : Number(p?.sell_price ?? 0)
                  const bad = returnPriceViolation(l, ceiling, priceRules) !== null
                  return (
                    <div
                      key={`${l.productId}|${l.unit}`}
                      className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p?.name ?? "—"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {p?.sku ?? "—"} · {l.unit}
                          {ceiling > 0 && ` · ${sold ? "giá đã bán" : "giá bảng"} ${formatCurrency(ceiling)}`}
                        </p>
                        {bad && (
                          <p className="mt-0.5 text-xs font-bold text-destructive">
                            Giá trả vượt trần so với {sold ? "giá đã bán" : "giá bảng"}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-20 space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">SL</Label>
                          <Input
                            type="number"
                            min={1}
                            step="any"
                            value={l.qty}
                            onChange={(e) =>
                              setLines((prev) =>
                                patchReturnLine(prev, i, {
                                  qty: Math.max(1, parseFloat(e.target.value) || 1),
                                })
                              )
                            }
                            className="h-9"
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            Đơn giá
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.price}
                            onChange={(e) =>
                              setLines((prev) =>
                                patchReturnLine(prev, i, {
                                  price: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              )
                            }
                            className={cn("h-9 tabular-nums", bad && "border-destructive")}
                          />
                        </div>
                        <div className="w-36 space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">Loại</Label>
                          <Select
                            value={l.isExchange ? "exchange" : "refund"}
                            onValueChange={(v) =>
                              setLines((prev) =>
                                patchReturnLine(prev, i, { isExchange: v === "exchange" })
                              )
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="refund">Trả tiền</SelectItem>
                              <SelectItem value="exchange">Đổi hàng</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 text-destructive"
                          aria-label={`Xoá ${p?.name ?? "dòng"}`}
                          onClick={() => setLines((prev) => setReturnQty(prev, i, 0))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ⚠ Dòng ĐỔI HÀNG không trừ đồng nào — nói ra ngay cạnh số tiền,
                nếu không người lập phiếu tưởng hệ thống tính thiếu. */}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold text-muted-foreground">
                Trừ công nợ khách
                {lines.some((l) => l.isExchange) && (
                  <span className="ml-1.5 text-xs">(dòng đổi hàng không trừ tiền)</span>
                )}
              </span>
              <span className="text-xl font-black tabular-nums">{formatCurrency(credit)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ghi chú</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="VD: hàng móp thùng khi giao, khách báo lúc nhận…"
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Huỷ
          </Button>
          {/* ⚠ Khoá kèm LÝ DO. Nút mờ không nói gì là người dùng bấm mãi rồi
              đi hỏi; `title` cho desktop, dòng chữ bên dưới cho điện thoại. */}
          <Button type="submit" disabled={!!blocked || saving} title={blocked ?? undefined}>
            {saving ? "Đang lưu..." : (blocked ?? "Tạo phiếu trả")}
          </Button>
        </div>
      </form>
    </div>
  )
}
