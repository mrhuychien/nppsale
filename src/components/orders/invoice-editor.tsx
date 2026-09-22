"use client"

/**
 * MÀN SOẠN HÓA ĐƠN BÁN — toàn trang.
 *
 * ⚠ TRƯỚC ĐÂY LÀ MỘT HỘP THOẠI. Chủ nhà chốt đổi sang toàn trang, bố cục
 * như màn tạo đơn: bảng dòng hàng ở giữa, thanh tổng tiền dính đáy, và
 * thêm được mã hàng KHÔNG có trong đơn gốc.
 *
 * ⚠ CHƯA CHẠM CƠ SỞ DỮ LIỆU CHO TỚI NÚT CUỐI. Hóa đơn không có trạng
 * thái nháp — một dòng `sales_invoices` là giấy đã in và kho đã trừ.
 *
 * ⚠ NPP TOÀN QUYỀN SỬA SỐ LƯỢNG VÀ GIÁ. Không có chốt chặn nào ở đây,
 * chỉ cảnh báo vàng. Trần giá của nhân viên bán hàng (`priceViolation` ở
 * màn `/sell`) giữ nguyên và không liên quan tới màn này.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Loader2, PackageCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DetailCustomerCard } from "@/components/detail/detail-chrome"
import { fullCustomerAddress } from "@/lib/customers/address"
import { shortTermLabel } from "@/lib/orders/list-summary"
import { formatCurrency, formatDate } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { errorMessage } from "@/lib/errors"
import {
  invoiceTotals, loadInvoiceableLines, postInvoice, reissueInvoice,
  invoiceWarnings, shortageOf, type PostInvoiceResult,
} from "@/lib/orders/post-invoice"
import {
  seedForNew, seedForReissue, makeAddedRow, withStock, toDraft,
  rowsOverOrdered, searchAddable, rowToCartLine, patchRowFromCart,
  type EditorRow, type ReissueSeedLine,
} from "@/lib/orders/invoice-editor"
import { sellableUnits, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { ProductPicker, PICKER_PEEK } from "@/components/ui/product-picker"
import { LineEditSheet, Stepper } from "@/components/sell/line-edit-sheet"
import { vatLabel } from "@/lib/constants"
import { CatalogueShortNote } from "@/components/ui/catalogue-short-note"
import { loadCatalogue } from "@/lib/products/load-catalogue"

/**
 * Phần ĐẦU ĐƠN — thứ người xuất hàng phải đọc trước khi quyết định.
 *
 * ⚠ ĐỌC Ở ĐÂY, KHÔNG NHẬN QUA PROPS. Màn này có HAI lối vào
 * (`/sales-invoices/new?order=` và `/sales-invoices/[id]/edit`), và cả
 * hai đều đã đọc `sales_orders` cho việc riêng của chúng. Bắt cả hai
 * đọc thêm cùng một khối là hai câu truy vấn phải sửa song song mỗi lần
 * đổi một trường — và lối vào nào quên sửa thì màn xuất hàng ở đó lại
 * trống tên khách y như cũ.
 */
interface OrderHeadRow {
  notes: string | null
  order_date: string | null
  payment_terms: string | null
  customer?: {
    store_name?: string | null
    phone?: string | null
    address?: string | null
    ward?: string | null
    district?: string | null
    province?: string | null
  } | null
  sales_user?: { full_name?: string | null } | null
}

interface Props {
  orderId: string
  orderCode: string
  /** Nhóm giá của khách trên đơn — quyết định giá của mã thêm tay. */
  priceGroupId: string | null
  reissueOf?: { invoiceId: string; invoiceCode: string; lines: ReissueSeedLine[] } | null
  priceWarnPct?: number
  /** Nơi quay về khi huỷ hoặc xong. */
  backHref: string
}

export function InvoiceEditor({
  orderId, orderCode, priceGroupId, reissueOf = null, priceWarnPct = 10, backHref,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<EditorRow[]>([])
  const [notes, setNotes] = useState("")
  /**
   * Ghi chú chung của ĐƠN — để NPP duyệt trước khi xuất (chủ nhà chốt
   * 20/09/2026: "phần Xuất hàng cũng phải có ghi chú đầy đủ cho NPP
   * duyệt").
   *
   * ⚠ CHỈ ĐỌC, KHÔNG CHÉP VÀO Ô "Ghi chú hóa đơn". Hai thứ khác nhau:
   * ghi chú đơn là lời người bán dặn lúc đặt, ghi chú hóa đơn là lời
   * người xuất kho dặn lúc giao. Chép sang là tờ hóa đơn in ra hai lần
   * cùng một câu với hai nhãn khác nhau — xem `noteBlocksOf`.
   */
  const [head, setHead] = useState<OrderHeadRow | null>(null)
  /**
   * ⚠ TÁCH RIÊNG KHỎI `head`. `head === null` có HAI nghĩa — chưa đọc
   * xong, và đọc xong nhưng không ra dòng nào (RLS từ chối trả về 0 dòng
   * kèm `error` null). Nhập hai nghĩa vào một biến là ô xương cá quay
   * mãi mãi cho những người không có quyền xem đơn.
   */
  const [headLoaded, setHeadLoaded] = useState(false)
  const orderNotes = (head?.notes ?? "").trim() || null
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * Hàng đổi / trả kèm đơn — để hiện khoản trừ ngay tại màn soạn hóa đơn.
   *
   * ⚠ NGƯỜI BẤM "XUẤT HÀNG" PHẢI THẤY SỐ KHÁCH THẬT SỰ PHẢI TRẢ. Từ mig
   *   133, khoản trừ hàng trả đi cùng hóa đơn và vào công nợ NGAY khi ghi
   *   sổ. Màn này chỉ hiện "Tổng cộng" là người xuất hàng đọc cho khách
   *   một con số cao hơn số sẽ ghi vào sổ, và khách trả dư.
   */
  const [retCredit, setRetCredit] = useState(0)
  /** Dòng hàng trả đang chờ — để cảnh báo TRƯỚC khi lưu. */
  const [retLines, setRetLines] = useState<
    Array<{
      id: string; returnId: string; productId: string; name: string
      qty: number; unit: string; unitPrice: number; vatRate: number
      credit: number; isExchange: boolean
    }>
  >([])
  /**
   * Số lượng NGƯỜI DÙNG vừa đặt lại cho từng dòng trả — 0 nghĩa là bỏ.
   *
   * ⚠ GIỮ RIÊNG, KHÔNG SỬA THẲNG `retLines`. Cần biết CÁI GÌ ĐÃ ĐỔI để
   *   chỉ gửi đúng phần ấy lên máy chủ; trộn vào một mảng là mỗi lần
   *   lưu lại ghi đè cả những dòng không ai chạm tới.
   */
  const [retEdits, setRetEdits] = useState<Record<string, number>>({})
  /**
   * Dòng hàng đổi / trả NGƯỜI DÙNG VỪA THÊM, chưa ghi xuống sổ.
   *
   * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Sao phần Tạo hoá đơn (Xuất hàng) và Sửa
   *   hoá đơn không thêm được hàng đổi / trả. Tao muốn nó đủ chức năng
   *   như khi Tạo đơn hàng cơ mà?". Bản 149 mới cho SỬA và BỎ — mà
   *   khách đưa hàng trả lại đúng lúc giao là chuyện thường ngày.
   *
   * ⚠ GIỮ RIÊNG KHỎI `retLines`. `retLines` là thứ ĐÃ có trong sổ; trộn
   *   hai thứ là không biết cái nào cần gửi lên với tư cách "thêm mới",
   *   và lần lưu sau lại thêm một bản nữa.
   */
  const [retAdds, setRetAdds] = useState<
    Array<{
      key: string; productId: string; name: string; unit: string
      qty: number; price: number; vatRate: number; isExchange: boolean
    }>
  >([])
  const [retTerm, setRetTerm] = useState("")
  const [catalog, setCatalog] = useState<PricedProduct[]>([])
  /** Danh mục đọc chưa hết — màn hình phải nói ra, đừng để người dùng đoán. */
  const [catalogTruncated, setCatalogTruncated] = useState(false)
  /** Dòng đã bỏ khỏi tờ hóa đơn đang soạn — giữ để hoàn tác. */
  const [dropped, setDropped] = useState<EditorRow[]>([])
  /** Dòng đang mở ô sửa — giống hệt màn Sửa đơn hàng. */
  const [editKey, setEditKey] = useState<string | null>(null)
  const [term, setTerm] = useState("")
  const [addUnit, setAddUnit] = useState<Record<string, string>>({})
  const seqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadInvoiceableLines(supabase, orderId)
      .then((lines) => {
        if (cancelled) return
        setRows(reissueOf ? seedForReissue(lines, reissueOf.lines) : seedForNew(lines))
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, reissueOf?.invoiceId])

  /**
   * Đọc phần ĐẦU ĐƠN: khách, ngày đặt, hình thức trả, nhân viên bán, ghi chú.
   *
   * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN MÀN XUẤT HÀNG. Đây là phần bổ sung;
   *   ném lỗi ở đây là chặn cả việc xuất hàng vì một khối thông tin.
   */
  useEffect(() => {
    let cancelled = false
    setHeadLoaded(false)
    supabase
      .from("sales_orders")
      .select(
        "notes, order_date, payment_terms, customer:customers(store_name, phone, address, ward, district, province), sales_user:users!sales_orders_sales_user_id_fkey(full_name)"
      )
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setHead(((data as unknown) as OrderHeadRow | null) ?? null)
        setHeadLoaded(true)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  /**
   * Đọc hàng đổi / trả còn hiệu lực của đơn.
   *
   * ⚠ CHỈ PHIẾU CÒN HIỆU LỰC (`status <> 'cancelled'`). Phiếu đã huỷ
   *   không trừ gì; hiện nó ở đây là báo một khoản giảm không có thật.
   *
   * ⚠ ĐỌC HỎNG THÌ IM, KHÔNG CHẶN MÀN XUẤT HÀNG — cùng nguyên tắc với
   *   khối đầu đơn ở trên.
   */
  useEffect(() => {
    let cancelled = false
    supabase
      .from("returns")
      .select(
        "id, status, invoice_id, credit_note_amount, lines:return_lines(id, product_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange, product:products(name))"
      )
      .eq("order_id", orderId)
      .neq("status", "cancelled")
      .then(({ data }) => {
        if (cancelled) return
        const rs = ((data as unknown) as Array<{
          id: string
          status: string
          invoice_id: string | null
          credit_note_amount: number | null
          lines?: Array<{
            id: string; product_id: string; unit_name: string; quantity: number
            unit_price: number | null; vat_rate: number | null; line_total: number
            is_exchange?: boolean | null; product?: { name?: string | null } | null
          }> | null
        }>) ?? []
        setRetCredit(rs.reduce((s2, r) => s2 + Math.max(0, Number(r.credit_note_amount || 0)), 0))
        setRetLines(
          rs.flatMap((r) =>
            (r.lines ?? []).map((l) => ({
              id: l.id,
              returnId: r.id,
              productId: l.product_id,
              unitPrice: Number(l.unit_price ?? 0),
              vatRate: Number(l.vat_rate ?? 0),
              name: l.product?.name || "Sản phẩm đã xoá",
              qty: Number(l.quantity) || 0,
              unit: l.unit_name,
              credit: l.is_exchange ? 0 : Math.max(0, Number(l.line_total || 0)),
              isExchange: l.is_exchange === true,
            }))
          )
        )
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  /**
   * ⚠ DANH MỤC NẠP NỀN, KHÔNG CHẶN MÀN. Người dùng vào đây để xuất phần
   *   còn lại của đơn — việc thường ngày. Bắt họ chờ cả bảng sản phẩm
   *   tải xong mới thấy dòng hàng là bắt chờ cho một tính năng họ có thể
   *   không dùng tới.
   *
   * ⚠ PHẢI KÉO HẾT THEO TRANG — chủ nhà báo 21/09/2026: "Thêm mã hàng
   *   không có trong đơn tại sao gõ ko ra mã hàng?". Bản cũ đọc bằng
   *   một `.select()` trơn kèm `.order("name")`. PostgREST CẮT Ở 1.000
   *   DÒNG, nên với danh mục 1.700 mã thì mọi mặt hàng xếp sau chữ cái
   *   thứ một nghìn KHÔNG hề có trong bộ nhớ — gõ đúng tên vẫn ra rỗng,
   *   và ô tìm không có cách nào nói ra là nó chưa đọc hết. Xem
   *   `loadCatalogue`.
   */
  useEffect(() => {
    let cancelled = false
    loadCatalogue<PricedProduct>(
      supabase,
      "id, sku, name, barcode, base_unit, vat_rate, sell_price, status, price_lists(*), units:product_units(*)",
      { activeOnly: true }
    )
      .then((res) => {
        if (cancelled) return
        setCatalog(res.rows)
        setCatalogTruncated(res.truncated)
      })
      .catch((e) => {
        if (cancelled) return
        console.error("[invoice-editor] nạp danh mục lỗi:", errorMessage(e))
        /* ⚠ ĐỌC HỎNG THÌ COI NHƯ ĐỌC THIẾU, đừng im. Danh mục rỗng mà
           không một dòng chữ nào là đúng cái lỗi ở trên, chỉ khác
           nguyên nhân. */
        setCatalogTruncated(true)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const draft = useMemo(() => toDraft(rows), [rows])
  const totals = useMemo(() => invoiceTotals(draft), [draft])
  const picked = rows.filter((r) => r.qty > 0)

  const onScreen = useMemo(() => new Set(rows.map((r) => r.productId)), [rows])
  /* ⚠ CÙNG TRẦN VỚI BỐN MÀN PHIẾU KIA. Ô trống xổ đúng `PICKER_PEEK`
     mục, không đổ cả 1.700 mã — xem chú thích của `PICKER_PEEK`. */
  const hits = useMemo(
    () => searchAddable(catalog, term, onScreen, PICKER_PEEK),
    [catalog, term, onScreen]
  )

  /**
   * ⚠ SO GIÁ VỚI GIÁ TRÊN ĐƠN, KHÔNG VỚI `products.sell_price`.
   * `sell_price` là giá theo đơn vị cơ sở, còn dòng đơn có thể bán theo
   * thùng — so thẳng là nhuộm vàng mọi dòng bán theo thùng.
   */
  const priceOff = (r: EditorRow): boolean => {
    if (priceWarnPct <= 0 || r.unitPrice <= 0) return false
    return Math.abs(r.price - r.unitPrice) > (r.unitPrice * priceWarnPct) / 100
  }

  const shortRows = rows.filter((r) => r.qty > 0 && r.stockKnown && shortageOf(r, r.qty) > 0)
  /** Số lượng trả ĐANG hiện của một dòng — phần sửa thắng số gốc. */
  const retQty = (l: { id: string; qty: number }) => retEdits[l.id] ?? l.qty
  /**
   * Khoản trừ của một dòng trả theo số lượng ĐANG hiện.
   *
   * ⚠ TÍNH LẠI Y HỆT MÁY CHỦ: round(qty × đơn giá × (1 + thuế)) — cùng
   *   công thức với `toReturnLine` và `_apply_return_edits` (mig 149).
   *   Lệch một đồng ở đây là người dùng đọc cho khách một con số, còn
   *   sổ ghi một con số khác.
   */
  const retCreditOf = (l: {
    id: string; qty: number; unitPrice: number; vatRate: number; isExchange: boolean
  }) =>
    l.isExchange ? 0 : Math.round(retQty(l) * l.unitPrice * (1 + (l.vatRate || 0)))

  /**
   * Phần sửa phiếu trả sẽ gửi kèm — CHỈ những dòng thật sự đổi.
   *
   * ⚠ GỬI CẢ NHỮNG DÒNG KHÔNG ĐỔI là ghi đè `line_total` của chúng bằng
   *   phép tính lại, và một dòng cũ có `line_total` lệch (nhập tay, dữ
   *   liệu cũ) sẽ lặng lẽ đổi số tiền — sửa một thứ người ta không yêu
   *   cầu sửa.
   */
  const returnEdits = retLines
    .filter((l) => retEdits[l.id] !== undefined && retEdits[l.id] !== l.qty)
    .map((l) => ({ lineId: l.id, quantity: retEdits[l.id] }))

  /**
   * Khoản trừ tổng theo số lượng ĐANG hiện.
   *
   * ⚠ DÙNG SỐ ĐANG HIỆN, KHÔNG DÙNG `retCredit` ĐỌC TỪ SỔ. Người dùng
   *   vừa bỏ một dòng trả mà thanh tổng vẫn trừ tiền của nó là đọc cho
   *   khách một con số sắp sai.
   */
  /** Khoản trừ của một dòng VỪA THÊM — cùng công thức với máy chủ. */
  const addCreditOf = (a: { qty: number; price: number; vatRate: number; isExchange: boolean }) =>
    a.isExchange ? 0 : Math.round(a.qty * a.price * (1 + (a.vatRate || 0)))

  const retCreditNow =
    (retLines.length > 0
      ? retLines.reduce((sum, l) => sum + retCreditOf(l), 0)
      : retCredit) + retAdds.reduce((sum, a) => sum + addCreditOf(a), 0)

  const overRows = rowsOverOrdered(rows)

  const setQty = (key: string, v: number) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, qty: Math.max(0, v) } : r)))
  /**
   * BỎ MỘT DÒNG KHỎI TỜ HÓA ĐƠN ĐANG SOẠN.
   *
   * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Màn Xuất hàng và Sửa Hoá đơn bán chưa
   *   có phần xoá dòng mặt hàng đi?". Trước nay chỉ dòng THÊM TAY mới
   *   xoá được; dòng của đơn phải tự đặt số lượng về 0.
   *
   * ⚠ BỎ DÒNG KHÔNG ĐỤNG GÌ TỚI ĐƠN, và hai đường cho ra dữ liệu Y HỆT
   *   NHAU. `postInvoice`/`reissueInvoice` đều lọc `quantity > 0`
   *   trước khi gọi RPC (xem `post-invoice.ts`), nên một dòng để 0 và
   *   một dòng bị bỏ đi là cùng một thứ đối với cơ sở dữ liệu. Phần
   *   chưa xuất vẫn nằm nguyên trên đơn, lần lập hóa đơn sau vẫn thấy.
   *
   * ⚠ HÀNG ĐỔI THÌ KHÔNG. Dòng `isExchange` đến từ phiếu trả của
   *   khách, không phải từ đơn — bỏ nó đi là hàng khách đã đưa lại mà
   *   tờ hóa đơn không ghi nhận, và khoản trừ công nợ biến mất. Đây là
   *   luật đã có sẵn của kho mã này, xem `addedByHand` ở
   *   `seedForReissue`.
   */
  const dropRow = (key: string) =>
    setRows((p) => {
      const row = p.find((r) => r.key === key)
      if (!row || row.isExchange) return p
      /* ⚠ GIỮ LẠI ĐỂ HOÀN TÁC. Màn này không có bản nháp — bấm nhầm mà
         phải tải lại trang là mất sạch số lượng và giá đã sửa tay. */
      setDropped((d) => [...d, row])
      return p.filter((r) => r.key !== key)
    })

  /** Dòng vừa bỏ, xếp theo thứ tự bỏ — hoàn tác lấy cái cuối cùng. */
  const undoDrop = () =>
    setDropped((d) => {
      const last = d[d.length - 1]
      if (!last) return d
      setRows((p) => (p.some((r) => r.key === last.key) ? p : [...p, last]))
      return d.slice(0, -1)
    })

  const addProduct = async (p: PricedProduct) => {
    const unit = addUnit[p.id] || p.base_unit
    seqRef.current += 1
    const row = makeAddedRow(p, unit, priceGroupId, seqRef.current)
    setRows((prev) => [...prev, row])
    setTerm("")

    /**
     * ⚠ HỎI TỒN SAU KHI THÊM, và tới lúc đó mới bật cảnh báo cho dòng
     *   này. Tô vàng "vượt tồn" khi còn chưa hỏi kho là kêu oan — người
     *   dùng học được cách bỏ qua màu vàng, rồi lần nó kêu thật thì không
     *   ai nhìn.
     */
    const { data, error } = await supabase
      .from("batches")
      .select("qty_on_hand")
      .eq("product_id", p.id)
      .eq("warehouse_zone", "sale")
    if (error) {
      console.error("[invoice-editor] tra tồn lỗi:", error.message)
      return
    }
    const sum = ((data as Array<{ qty_on_hand: number | null }>) || []).reduce(
      (a, b) => a + Number(b.qty_on_hand ?? 0), 0
    )
    setRows((prev) => withStock(prev, row.key, sum))
  }

  const submit = async () => {
    if (picked.length === 0) return
    setSaving(true)
    try {
      const r: PostInvoiceResult = reissueOf
        ? await reissueInvoice(supabase, reissueOf.invoiceId, {
            lines: draft, notes: notes.trim() || null,
            /* ⚠ ĐI CÙNG MỘT GIAO DỊCH — xem `return_edits`, mig 149. */
            returnEdits: returnEdits,
            returnAdds: retAdds.map((a) => ({
              productId: a.productId, unitName: a.unit, quantity: a.qty,
              unitPrice: a.price, vatRate: a.vatRate, isExchange: a.isExchange,
            })),
          })
        : await postInvoice(supabase, {
            orderId, lines: draft, notes: notes.trim() || null,
            /* ⚠ XUẤT HÀNG LẦN ĐẦU CŨNG THÊM ĐƯỢC — xem mig 152. */
            returnAdds: retAdds.map((a) => ({
              productId: a.productId, unitName: a.unit, quantity: a.qty,
              unitPrice: a.price, vatRate: a.vatRate, isExchange: a.isExchange,
            })),
          })
      const w = invoiceWarnings(r)
      toast({
        title: reissueOf
          ? `Đã lập lại: ${reissueOf.invoiceCode} → ${r.invoiceCode ?? ""}`.trim()
          : `Đã xuất hóa đơn ${r.invoiceCode ?? ""}`.trim(),
      })
      // ⚠ Cảnh báo đi TOAST RIÊNG. Nhét vào description của toast thành
      //   công là để nó đọc như một lời chúc mừng có chú thích.
      if (w) toast({ title: "Xuất thiếu hàng", description: w, variant: "destructive" })
      /**
       * ⚠ SANG THẲNG MÀN IN, và màn đó tự bật cửa sổ in (chủ nhà chốt).
       *   Việc tiếp theo sau khi xuất hàng LUÔN là in tờ giao cho tài
       *   xế; bắt bấm thêm hai nút nữa cho một việc chắc chắn xảy ra là
       *   thuế đánh lên mỗi đơn.
       *
       * ⚠ KHÔNG TỰ IN NẾU RPC KHÔNG TRẢ VỀ MÃ HÓA ĐƠN. Không có id thì
       *   không có gì để in; quay về chỗ cũ còn hơn mở một màn trống rồi
       *   bật hộp thoại in lên trên nó.
       */
      /**
       * ⚠ `replace`, KHÔNG `push`. Hai lý do, cùng một hướng:
       *   · Hóa đơn đã ghi sổ rồi thì màn soạn nó KHÔNG được nằm lại
       *     trong lịch sử — lùi một bước vào đó là mời người dùng bấm
       *     Xuất hàng lần nữa cho một đơn đã xuất.
       *   · Màn in nay tự rời đi khi đóng hộp thoại in
       *     (`useLeaveAfterPrint`). `push` thì đường về của nó là màn
       *     soạn vừa xong; `replace` thì đường về là chỗ người dùng đứng
       *     TRƯỚC khi bấm Xuất hàng — đúng "chỗ cũ" chủ nhà chốt.
       */
      router.replace(r.invoiceId ? `/sales-invoices/${r.invoiceId}/print?auto=1` : backHref)
    } catch (e) {
      toast({ title: "Không xuất được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title={reissueOf ? `Sửa hóa đơn ${reissueOf.invoiceCode}` : "Xuất hàng"}
        description={
          reissueOf
            ? "Hóa đơn cũ sẽ bị huỷ và một hóa đơn mới được lập, trong cùng một giao dịch. Kho hoàn về đúng lô đã lấy rồi mới trừ lại theo số mới."
            : "Sửa số lượng và giá thoải mái. Phần chưa xuất vẫn nằm lại trên đơn để xuất đợt sau."
        }
        backHref={backHref}
      >
        <Badge variant="secondary" className="font-mono">{orderCode}</Badge>
      </PageHeader>

      {/*
        KHỐI ĐẦU ĐƠN — tên khách, liên hệ, ngày đặt, hình thức trả, NVBH.

        ⚠ MÀN NÀY TRƯỚC ĐÂY CHỈ CÓ MÃ ĐƠN (chủ nhà hỏi 20/09/2026: "sao
          màn Xuất hàng không có thông tin đơn hàng như tên khách hàng").
          "DH-0108" không nói được hàng này giao cho ai — người đứng ở
          kho phải mở tab khác tra đơn mới biết mình đang xuất cho cửa
          hàng nào, và đó đúng là lúc dễ xuất nhầm đơn nhất.

        ⚠ DÙNG `DetailCustomerCard`, KHÔNG TỰ VẼ. Chi tiết đơn và chi
          tiết hóa đơn đã vẽ khối khách bằng khuôn này; vẽ khuôn thứ ba
          là cùng một khách hiện ba kiểu trên ba màn đi liền nhau.

        ⚠ KHÔNG CHO BẤM VÀO TÊN. `onNameClick` mở modal xem nhanh khách —
          hay ở màn chi tiết, nhưng ở đây người dùng đang GÕ DỞ số lượng
          trên một biểu mẫu chưa lưu. Một cú bấm nhầm mở modal là một cú
          bấm nữa để đóng, và không ai được lợi gì.
      */}
      {!headLoaded ? (
        <Skeleton className="h-[86px] rounded-2xl" />
      ) : head ? (
        <DetailCustomerCard
          name={head.customer?.store_name || "Khách lẻ"}
          contact={
            [head.customer?.phone, fullCustomerAddress(head.customer ?? {})]
              .filter(Boolean)
              .join(" · ") || null
          }
          stats={[
            {
              label: "Ngày đặt",
              /* ⚠ KHÔNG CÓ THÌ NÓI LÀ CHƯA XÁC ĐỊNH, đừng in ngày hôm
                 nay hay một dấu gạch — cả hai đều đọc như dữ liệu thật. */
              value: head.order_date ? formatDate(head.order_date) : "chưa xác định",
            },
            { label: "Thanh toán", value: shortTermLabel(head.payment_terms) || "chưa xác định" },
            ...(head.sales_user?.full_name
              ? [{ label: "Nhân viên bán", value: head.sales_user.full_name }]
              : []),
          ]}
        />
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : (
        <>
<div className="overflow-hidden rounded-2xl border bg-card">
            {rows.length === 0 ? (
              <p className="p-7 text-center text-sm font-semibold text-muted-foreground">
                Đơn không còn dòng nào để xuất. Thêm mã hàng bên dưới nếu cần.
              </p>
            ) : (
              rows.map((r) => {
                const short = r.qty > 0 && r.stockKnown ? shortageOf(r, r.qty) : 0
                const over = !!r.orderLineId && r.qty > r.remainingQty
                return (
                  <div
                    key={r.key}
                    className="flex flex-col gap-2 border-b p-3 last:border-0"
                  >
                    <div className="flex items-start gap-1">
                      {/*
                        ⚠ CẢ DÒNG LÀ NÚT MỞ Ô SỬA — giống hệt màn Sửa đơn
                          hàng (chủ nhà chốt 21/09/2026). Bảng cũ bắt gõ
                          số vào hai ô bé xíu nằm cạnh nhau; trên điện
                          thoại đó là hai mục tiêu 24px và một bàn phím
                          che mất nửa màn.
                      */}
                      <button
                        type="button"
                        onClick={() => setEditKey(r.key)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-bold leading-snug">
                            {r.productName}{" "}
                            <span className="font-semibold text-muted-foreground">
                              ({r.unitName})
                            </span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold text-muted-foreground">
                            <span>
                              {formatCurrency(r.price)} × {r.qty}
                            </span>
                            {r.isExchange && <Badge variant="secondary">Hàng đổi</Badge>}
                            {r.addedByHand && <Badge variant="outline">Thêm tay</Badge>}
                            {/* ⚠ "ĐẶT / ĐÃ XUẤT" LÀ THỨ QUYẾT ĐỊNH SỐ
                                LƯỢNG — bảng cũ có cột riêng, bố cục mới
                                đưa vào đây chứ không bỏ đi. */}
                            {r.orderLineId && (
                              <span>
                                đặt {r.orderedQty} · đã xuất {r.invoicedQty}
                              </span>
                            )}
                            <span className={short > 0 ? "text-amber-600" : undefined}>
                              {/* ⚠ CHƯA TRA XONG THÌ NÓI LÀ CHƯA BIẾT,
                                  đừng in 0 — 0 đọc như "hết hàng". */}
                              tồn {r.stockKnown ? r.availableBase : "…"}
                            </span>
                            {over && (
                              <span className="font-extrabold text-amber-600">Vượt phần còn lại</span>
                            )}
                            {short > 0 && (
                              <span className="font-extrabold text-amber-600">Thiếu {short}</span>
                            )}
                            {priceOff(r) && (
                              <span className="rounded-md bg-amber-100 px-1.5 py-px font-bold text-amber-700">
                                Giá lệch so với đơn
                              </span>
                            )}
                            {(r.vatRate || 0) > 0 && <span>VAT {vatLabel(r.vatRate)}</span>}
                          </span>
                          {/* ⚠ GHI CHÚ CỦA DÒNG PHẢI HIỆN Ở ĐÂY. `note` đi
                              theo `loadInvoiceableLines` từ dòng đơn, và
                              đây là màn NPP quyết định xuất bao nhiêu —
                              giấu lời dặn của người bán ("lấy lô mới",
                              "không nhận hàng cận hạn") đúng vào lúc cần
                              đọc nó nhất là bỏ phí cả việc nhập. */}
                          {r.note && (
                            <span className="mt-0.5 block whitespace-pre-wrap text-xs italic text-amber-700 [overflow-wrap:anywhere]">
                              Ghi chú: {r.note}
                            </span>
                          )}
                        </span>
                      </button>
                      {/* ⚠ HÀNG ĐỔI KHÔNG BỎ ĐƯỢC — xem `dropRow`. */}
                      {!r.isExchange && (
                        <button
                          type="button"
                          onClick={() => dropRow(r.key)}
                          aria-label={`Bỏ ${r.productName}`}
                          title={
                            r.addedByHand
                              ? "Bỏ dòng thêm tay này"
                              : "Bỏ khỏi tờ hóa đơn này — phần chưa xuất vẫn còn trên đơn"
                          }
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground active:bg-destructive/10 active:text-destructive"
                        >
                          <Trash2 className="h-[18px] w-[18px]" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[17px] font-extrabold tabular-nums">
                        {formatCurrency(r.qty * r.price)}
                      </span>
                      <div className="w-[164px]">
                        {/* ⚠ CHO VỀ 0 ĐƯỢC. Ở giỏ hàng, 0 nghĩa là bỏ
                            dòng; ở đây 0 nghĩa là "đợt này không xuất
                            dòng này" — một trạng thái CÓ THẬT và khác
                            hẳn với bỏ dòng, vì phần còn lại vẫn nằm trên
                            đơn và dòng vẫn hiện ra để người ta thấy. */}
                        <Stepper qty={r.qty} onChange={(q) => setQty(r.key, q)} min={0} />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/*
            ⚠ BỎ DÒNG PHẢI HOÀN TÁC ĐƯỢC. Màn này KHÔNG có bản nháp —
              không có gì được ghi xuống cho tới nút cuối. Bấm nhầm cái
              thùng rác mà cách duy nhất để lấy lại là tải lại trang thì
              mất sạch mọi số lượng và giá đã sửa tay, có khi là hai
              mươi dòng. Một nút hoàn tác rẻ hơn nhiều so với việc gõ
              lại cả tờ hóa đơn.

            ⚠ VÀ NÓI RÕ BỎ KHỎI ĐÂU. "Đã bỏ 3 dòng" mà không nói bỏ khỏi
              cái gì là để người xuất hàng tưởng mình vừa xoá hàng khỏi
              ĐƠN của khách.
          */}
          {dropped.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Đã bỏ {dropped.length} dòng khỏi tờ hóa đơn này. Phần chưa xuất vẫn còn
                trên đơn {orderCode}.
              </p>
              <Button variant="outline" size="sm" onClick={undoDrop}>
                Hoàn tác
              </Button>
            </div>
          )}

          {/* ⚠ VẤN ĐỀ VÀ THÔNG TIN TÁCH RIÊNG. Gộp "thiếu hàng" với "xuất
              vượt đơn" vào một dòng vàng thì người đọc bỏ qua cả hai. */}
          {shortRows.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {shortRows.length} dòng vượt tồn kho bán. Vẫn xuất được nếu đơn vị cho
                phép bán âm — tồn sẽ âm cho tới khi nhập bù.
              </span>
            </p>
          )}
          {overRows.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {overRows.length} dòng xuất nhiều hơn phần còn lại của đơn. Được phép,
                nhưng kiểm lại xem có gõ nhầm không.
              </span>
            </p>
          )}

          {/*
            ---------------- Thêm mã hàng ngoài đơn ----------------
            ⚠ DÙNG `ProductPicker`, KHÔNG TỰ VẼ Ô TÌM. Màn này từng có
              một ô tìm riêng, và chính vì thế nó BỊ BỎ SÓT khi chủ nhà
              chốt 20/09/2026 "bấm vào là phải xổ list rồi" — bốn màn
              phiếu đổi theo, màn hóa đơn thì không. Một ô tìm dùng
              chung là một chỗ phải sửa, không phải năm.
          */}
          <Card>
            <CardContent className="pt-5">
              <ProductPicker
                closeOnPick
                id="inv-add-find"
                label="Thêm mã hàng không có trong đơn"
                placeholder="Tên hàng, mã SKU hoặc mã vạch…"
                emptyHint="Không tìm thấy mã nào khớp, hoặc mã đó đã có trên hóa đơn."
                disabled={catalog.length === 0}
                term={term}
                onTermChange={setTerm}
                items={hits.map((p) => ({
                  ...p,
                  title: p.name,
                  subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
                }))}
                onPick={(p) => addProduct(p)}
                /*
                  ⚠ CHỌN ĐƠN VỊ NGAY TẠI DÒNG GỢI Ý, VÌ SAU KHI THÊM
                    KHÔNG SỬA ĐƯỢC NỮA. Bảng hóa đơn hiện `unitName` ở
                    dạng chữ thường, không phải ô chọn — thêm nhầm "hộp"
                    thay vì "thùng" là phải xoá dòng rồi làm lại. Khe
                    `renderAside` vẽ NGOÀI cái nút của dòng nên bấm vào
                    đây không thêm hàng.
                */
                renderAside={(p) => {
                  const units = sellableUnits(p)
                  if (units.length <= 1) return null
                  return (
                    <Select
                      value={addUnit[p.id] || p.base_unit}
                      onValueChange={(v) => setAddUnit((s) => ({ ...s, [p.id]: v }))}
                    >
                      <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )
                }}
                /*
                  ⚠ ĐỌC THIẾU THÌ NÓI RA. Im lặng ở đây là người dùng gõ
                    đúng tên một mã có thật, không thấy gì, rồi kết luận
                    danh mục thiếu mã — đúng cái đã xảy ra hôm nay.
                */
                hint={catalogTruncated ? <CatalogueShortNote /> : null}
              />
            </CardContent>
          </Card>

          {/*
            HÀNG ĐỔI / TRẢ KÈM ĐƠN — liệt kê ngay tại màn xuất hàng.
            ⚠ NÓI RÕ DÒNG NÀO TRỪ TIỀN, DÒNG NÀO KHÔNG. Hàng đổi lấy hàng
              mới ra khỏi kho và KHÔNG trừ tiền; trộn chung một danh sách
              không nhãn là người xuất hàng cộng nhầm số khách phải trả.
          */}
          {retLines.length > 0 && (
            <Card className="border-l-4 border-l-amber-400">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Hàng đổi / trả kèm đơn ({retLines.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Khoản trừ vào công nợ ngay khi xuất hóa đơn. Hàng nhập lại kho khi phiếu
                  trả được hoàn thành.
                </p>
              </CardHeader>
              <CardContent className="grid gap-1.5">
                {retLines.map((l) => {
                  const q = retQty(l)
                  const bo = q <= 0
                  return (
                    <div
                      key={l.id}
                      className={`flex flex-wrap items-center gap-2 text-[13px] ${bo ? "opacity-50" : ""}`}
                    >
                      <span
                        className={
                          l.isExchange
                            ? "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-primary ring-1 ring-primary/30"
                            : "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-[#b54708] ring-1 ring-[#b54708]/30"
                        }
                      >
                        {l.isExchange ? "ĐỔI" : "TRẢ"}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate font-semibold ${bo ? "line-through" : ""}`}
                      >
                        {l.name}
                      </span>
                      {/*
                        ⚠ SỬA ĐƯỢC NGAY TẠI ĐÂY (chủ nhà chốt 21/09/2026:
                          "cho phép sửa cả đổi trả -> sửa thế nào cập nhật
                          vào phiếu trả là xong"). Trước nay khối này chỉ
                          để ĐỌC, nên bỏ một món khỏi hóa đơn là phải đi
                          sang màn phiếu trả rồi quay lại.

                        ⚠ VÀ PHẦN SỬA ĐI CÙNG MỘT GIAO DỊCH với việc lập
                          lại hóa đơn — xem `return_edits` ở mig 149. Ghi
                          thẳng từ đây rồi mới gọi RPC là hai bước: bước
                          một xong, bước hai hỏng, và phiếu trả đã bị sửa
                          cho một hóa đơn không bao giờ được lập.
                      */}
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={q}
                        aria-label={`Số lượng trả ${l.name}`}
                        onChange={(e) =>
                          setRetEdits((prev) => ({
                            ...prev,
                            [l.id]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="h-9 w-20 shrink-0 rounded-lg border px-2 text-right tabular-nums"
                      />
                      <span className="shrink-0 text-muted-foreground">{l.unit}</span>
                      <span className="w-[92px] shrink-0 text-right font-semibold tabular-nums">
                        {l.isExchange ? "không trừ" : `−${formatCurrency(retCreditOf(l))}`}
                      </span>
                      {/* ⚠ ĐƯA VỀ 0 LÀ BỎ DÒNG, và phải lấy lại được —
                          bấm nhầm mà chỉ còn cách tải lại trang là mất
                          sạch tờ hóa đơn đang soạn dở. */}
                      {bo && (
                        <button
                          type="button"
                          onClick={() =>
                            setRetEdits((prev) => ({ ...prev, [l.id]: l.qty }))
                          }
                          className="shrink-0 text-xs font-semibold text-primary underline"
                        >
                          Hoàn tác
                        </button>
                      )}
                    </div>
                  )
                })}

                {/* Dòng VỪA THÊM, chưa ghi xuống sổ. */}
                {retAdds.map((a) => (
                  <div key={a.key} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span
                      className={
                        a.isExchange
                          ? "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-primary ring-1 ring-primary/30"
                          : "shrink-0 rounded px-1 py-px text-[10px] font-extrabold text-[#b54708] ring-1 ring-[#b54708]/30"
                      }
                    >
                      {a.isExchange ? "ĐỔI" : "TRẢ"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{a.name}</span>
                    <Badge variant="outline" className="shrink-0">Mới</Badge>
                    <input
                      type="number" min={0} step="any" value={a.qty}
                      aria-label={`Số lượng trả ${a.name}`}
                      onChange={(e) =>
                        setRetAdds((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) }
                              : x
                          )
                        )
                      }
                      className="h-9 w-20 shrink-0 rounded-lg border px-2 text-right tabular-nums"
                    />
                    <span className="shrink-0 text-muted-foreground">{a.unit}</span>
                    <span className="w-[92px] shrink-0 text-right font-semibold tabular-nums">
                      {a.isExchange ? "không trừ" : `−${formatCurrency(addCreditOf(a))}`}
                    </span>
                    {/* ⚠ CHƯA GHI XUỐNG SỔ THÌ BỎ HẲN, không cần hoàn tác. */}
                    <button
                      type="button"
                      onClick={() => setRetAdds((prev) => prev.filter((x) => x.key !== a.key))}
                      aria-label={`Bỏ ${a.name}`}
                      className="shrink-0 text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                {/*
                  ⚠ THÊM ĐƯỢC NGAY TẠI ĐÂY. Khách đưa hàng trả lại đúng
                    lúc giao là chuyện thường ngày, và người xuất hàng
                    đang đứng ngay đó — bắt họ sang màn khác lập một
                    phiếu trả riêng là bỏ phí cả thao tác.

                  ⚠ MẶC ĐỊNH LÀ TRẢ, KHÔNG PHẢI ĐỔI. Trả thì trừ công
                    nợ, đổi thì không — đoán sai chiều nào cũng là sai
                    tiền, nên chọn cái người ta dùng nhiều hơn và cho
                    bấm đổi ngay trên dòng.
                */}
                <div className="mt-1 border-t pt-3">
                  <ProductPicker
                    closeOnPick
                    id="inv-add-return"
                    label="Thêm hàng đổi / trả"
                    placeholder="Tên hàng, mã SKU hoặc mã vạch…"
                    emptyHint="Không tìm thấy mã nào khớp."
                    disabled={catalog.length === 0}
                    term={retTerm}
                    onTermChange={setRetTerm}
                    items={searchAddable(catalog, retTerm, new Set(), PICKER_PEEK).map((p) => ({
                      ...p,
                      title: p.name,
                      subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
                    }))}
                    onPick={(p) => {
                      seqRef.current += 1
                      setRetAdds((prev) => [
                        ...prev,
                        {
                          key: `ra${seqRef.current}`,
                          productId: p.id,
                          name: p.name,
                          unit: p.base_unit,
                          qty: 1,
                          /* ⚠ GIÁ TRẢ LẤY THEO NHÓM GIÁ CỦA KHÁCH, y
                             như dòng bán — trả theo giá bảng chung là
                             hoàn cho khách nhiều hơn số họ đã trả. */
                          price: unitPriceFor(p, p.base_unit, priceGroupId),
                          vatRate: Number(p.vat_rate ?? 0),
                          isExchange: false,
                        },
                      ])
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ⚠ GHI CHÚ CỦA ĐƠN ĐỨNG RIÊNG VÀ ĐỨNG TRƯỚC. Đây là lời người
              bán dặn, thứ NPP phải đọc TRƯỚC khi quyết định xuất bao
              nhiêu — không phải thứ để trộn vào ô nhập bên dưới. */}
          {orderNotes && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">
              <p className="text-xs uppercase tracking-wider text-amber-700">Ghi chú đơn hàng</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-amber-900 [overflow-wrap:anywhere]">
                {orderNotes}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-note" className="text-xs uppercase tracking-wider text-muted-foreground">
                Ghi chú hóa đơn
              </Label>
              <Textarea
                id="inv-note" rows={2} value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ví dụ: giao đợt 1, còn lại giao tuần sau"
              />
            </div>
            <dl className="self-end space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tiền hàng</dt>
                <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Thuế GTGT</dt>
                <dd className="tabular-nums">{formatCurrency(totals.vat)}</dd>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <dt>Tổng cộng</dt>
                <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
              </div>
              {/* ⚠ KHOẢN TRỪ HÀNG TRẢ VÀO CÔNG NỢ NGAY KHI GHI SỔ (mig 133).
                  Không hiện ở đây thì người xuất hàng đọc cho khách con số
                  "Tổng cộng" — cao hơn số sẽ ghi vào sổ đúng bằng khoản trừ. */}
              {retCreditNow > 0 && (
                <>
                  <div className="flex justify-between text-[#b54708]">
                    <dt>Trừ hàng trả</dt>
                    <dd className="tabular-nums">−{formatCurrency(retCreditNow)}</dd>
                  </div>
                  <div className="flex justify-between border-t pt-1 text-base font-extrabold">
                    <dt>Khách phải trả</dt>
                    <dd className="tabular-nums">
                      {formatCurrency(Math.max(0, totals.total - retCreditNow))}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          {/* Thanh hành động dính đáy — giống màn giỏ hàng, để ngón tay
              không phải đi tìm nút trên màn dài. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">{picked.length} dòng</div>
                <div className="truncate text-lg font-bold tabular-nums">
                  {formatCurrency(Math.max(0, totals.total - retCreditNow))}
                  {retCreditNow > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-[#b54708]">
                      đã trừ {formatCurrency(retCreditNow)} hàng trả
                    </span>
                  )}
                </div>
              </div>
              <Button variant="outline" onClick={() => router.push(backHref)} disabled={saving}>
                Huỷ
              </Button>
              <Button
                onClick={submit}
                disabled={saving || picked.length === 0}
                /* ⚠ KHOÁ NÚT KÈM LÝ DO, đừng để họ bấm rồi mới biết. */
                title={picked.length === 0 ? "Nhập số lượng cho ít nhất một dòng" : undefined}
              >
                {saving
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <PackageCheck className="mr-1.5 h-4 w-4" />}
                {reissueOf ? "Lập lại" : "Xuất hàng"}
              </Button>
            </div>
          </div>
        </>
      )}

      {/*
        Ô SỬA DÒNG — CÙNG MỘT SHEET VỚI MÀN SỬA ĐƠN HÀNG.
        ⚠ Chủ nhà chốt 21/09/2026: hai màn này phải "giống hệt màn Sửa
          đơn hàng". Dùng chung `LineEditSheet` chứ không vẽ bản thứ hai
          — hai bản là hai lần phải nhớ sửa, và đó đúng là cái đã làm ô
          tìm hàng bị bỏ sót ba lần liền.
      */}
      {(() => {
        const r = rows.find((x) => x.key === editKey)
        if (!r) return null
        return (
          <LineEditSheet
            line={rowToCartLine(r)}
            product={catalog.find((p) => p.id === r.productId)}
            groupId={priceGroupId}
            canEditPrice
            maxIncreasePct={0}
            /* ⚠ NPP TOÀN QUYỀN SỬA GIÁ ở màn này — luật đã ghi từ đầu
               tệp. Để nguyên trần của `/sell` là ô giá đỏ lên kèm câu
               "Không được thấp hơn giá bảng", một câu SAI ở đây. */
            freePrice
            baseOnHand={r.stockKnown ? r.availableBase : 0}
            /* ⚠ KHOÁ ĐƠN VỊ CỦA DÒNG GẮN VỚI ĐƠN — xem `lockUnit`. */
            lockUnit={
              r.orderLineId
                ? "Dòng này thuộc đơn hàng nên phải giữ đúng đơn vị đã đặt. Muốn đổi đơn vị thì bỏ dòng rồi thêm lại bằng ô Thêm mã hàng."
                : null
            }
            canRemove={!r.isExchange}
            onPatch={(patch) =>
              setRows((prev) =>
                prev.map((x) => (x.key === r.key ? patchRowFromCart(x, patch) : x))
              )
            }
            onRemove={() => {
              dropRow(r.key)
              setEditKey(null)
            }}
            onClose={() => setEditKey(null)}
          />
        )
      })()}
    </div>
  )
}
