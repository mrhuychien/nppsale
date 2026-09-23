"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"
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
import { SearchSelect } from "@/components/ui/search-select"
import { ProductPicker, PICKER_PEEK } from "@/components/ui/product-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { lapPhieuTraMotLan } from "@/lib/sell/create-return"
import { mayChuThieuCot } from "@/lib/db/co-rpc"
import { userPriceRulesFrom } from "@/lib/pricing"
import {
  RETURN_REASONS,
  addReturnLine,
  patchReturnLine,
  returnCreditOf,
  returnPriceViolation,
  searchReturnable,
  setReturnQty,
  toReturnLine,
  boCotMoiCuaDongTra,
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
 * ⚠ GẮN VÀO HÓA ĐƠN, KHÔNG GẮN VÀO ĐƠN — nhưng KHÔNG CÒN VÌ LÝ DO CŨ.
 * Trước 22/09/2026 hóa đơn là TRẦN của số được trả; chủ nhà đã bỏ trần
 * ấy (migration 158) vì hàng khách mua trước khi dùng phần mềm không có
 * dòng nào trong sổ. Nay hóa đơn chỉ còn là MỐC ĐỐI CHIẾU: nó cho biết
 * khoản trừ công nợ này thuộc tờ nào, và cho ra giá đã bán để soi giá
 * trả. Phiếu không gắn hóa đơn vẫn lập và hoàn thành được.
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

/**
 * ⚠ DÙNG TRẦN CHUNG `PICKER_PEEK`, KHÔNG GIỮ MỘT CON SỐ RIÊNG. Năm ô
 * tìm hàng trong kho mã này xổ cùng một số mục; một màn lệch số là
 * người dùng thấy hai ô hành xử khác nhau mà không hiểu vì sao.
 */
const PICK_CAP = PICKER_PEEK

/**
 * Lỗi "cơ sở dữ liệu chưa có cột `sales_user_id`" — tức mã nguồn đã lên
 * mà migration 160 chưa chạy.
 *
 * ⚠ HẸP NHẤT CÓ THỂ, và phải NHẮC ĐÍCH DANH TÊN CỘT. Nới ra là nuốt
 *   luôn hai lời từ chối của trigger (`PHIEU_TRA_HO_KHONG_DUOC_PHEP`,
 *   `NHAN_VIEN_KHONG_BAN_HANG`) rồi lặng lẽ ghi lại phiếu KHÔNG có người
 *   đứng tên — người dùng thấy "đã tạo" và tin là đã gán xong.
 */
function retryWithoutSalesUser(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = err.message || ""
  if (!msg.includes("sales_user_id")) return false
  return err.code === "PGRST204" || err.code === "42703" || msg.includes("42703")
}

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

  /**
   * ⚠ ĐỌC CẢ `owner_name` VÀ `phone`, KHÔNG CHỈ `store_name`. Người lập
   *   phiếu trả thường chỉ nhớ số điện thoại hoặc tên chủ cửa hàng —
   *   một danh sách chỉ có tên cửa hàng thì "tìm được" cũng bằng không.
   *   Đây đúng bộ ba mà ô tìm ở màn Đơn hàng đang dùng.
   */
  const [customers, setCustomers] = useState<
    Pick<Customer, "id" | "store_name" | "owner_name" | "phone">[]
  >([])
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
  /**
   * ⚠ DỰNG MỘT LẦN THEO `customers`. Dựng lại ở mỗi lần vẽ là mảng mới
   *   mỗi lần, và `SearchSelect` nhận một danh sách "đổi" liên tục.
   */
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.store_name,
        /* Hiện số điện thoại để phân biệt hai cửa hàng trùng tên. */
        hint: [c.owner_name, c.phone].filter(Boolean).join(" · ") || null,
        keywords: [c.owner_name, c.phone].filter(Boolean).join(" "),
      })),
    [customers]
  )

  /**
   * NPP LẬP PHIẾU TRẢ GIÚP NHÂN VIÊN (chủ nhà chốt 22/09/2026).
   *
   * ⚠ CHỈ CHỦ NHÀ / QUẢN LÝ THẤY Ô NÀY — y như màn lập đơn. Nhân viên
   *   lập phiếu của chính mình; cho họ chọn tên người khác là mở đường
   *   đẩy khoản TRỪ doanh số sang tên đồng nghiệp. Giao diện chỉ là lớp
   *   đầu; trigger `trg_returns_guard_sales_user` (mig 160) mới là chỗ
   *   chặn thật, vì `returns` ghi thẳng từ trình duyệt.
   */
  const canPickSeller = user?.role === "owner" || user?.role === "manager"
  const [sellerId, setSellerId] = useState("")
  const [sellers, setSellers] = useState<Array<{ id: string; full_name: string; role: string }>>([])

  useEffect(() => {
    if (!canPickSeller || !user?.org_id) return
    let cancelled = false
    createClient()
      .from("users")
      .select("id, full_name, role")
      .eq("org_id", user.org_id)
      /* ⚠ ĐÚNG BỘ VAI TRÒ MÀ TRIGGER CHO PHÉP — xem mig 160. Hiện ra một
         cái tên mà máy chủ sẽ từ chối là bẫy người dùng. */
      .in("role", ["sales", "manager", "owner"])
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled) {
          setSellers((data as Array<{ id: string; full_name: string; role: string }>) || [])
        }
      })
    return () => {
      cancelled = true
    }
  }, [canPickSeller, user?.org_id])

  const sellerOptions = useMemo(
    () =>
      sellers.map((u) => ({
        id: u.id,
        label: u.full_name || "(chưa đặt tên)",
        hint: u.id === user?.id ? "chính bạn" : u.role,
      })),
    [sellers, user?.id]
  )

  const [q, setQ] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const [custRes, prodRes] = await Promise.all([
        // ⚠ Phân trang: hơn 1.000 khách là chuyện thường, mà server cắt ở
        // 1.000 dòng và KHÔNG báo — khách nằm sau đó thì không lập được phiếu.
        fetchAllForAggregate<Pick<Customer, "id" | "store_name" | "owner_name" | "phone">>((from, to) =>
          createClient()
            .from("customers")
            .select("id, store_name, owner_name, phone", { count: "exact" })
            .eq("status", "active")
            // ⚠ Khoá phụ `id`: trùng tên cửa hàng là chuyện thường, các
            //   trang song song thiếu khoá duy nhất là lặp / sót khách.
            .order("store_name")
            .order("id")
            .range(from, to)
        ),
        fetchAllForAggregate<ProductLite>((from, to) =>
          createClient()
            .from("products")
            .select("id, name, sku, barcode, base_unit, vat_rate, sell_price", { count: "exact" })
            .eq("status", "active")
            .order("name")
            .order("id")
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

  /**
   * ⚠ Ô TRỐNG CŨNG XỔ DANH SÁCH. Chủ nhà chốt 20/09/2026 "bấm vào là
   *   phải xổ list rồi", và 21/09/2026 hỏi lại đúng màn này: "Đơn trả
   *   hàng phần tìm kiếm sản phẩm khi tìm kiếm phải xổ list". Màn này
   *   bị bỏ sót vì nó TỰ VẼ ô tìm thay vì dùng `ProductPicker` — cùng
   *   một lý do với màn hóa đơn hôm nay. `viMatchAllWords` khớp tất cả
   *   khi từ khoá rỗng, nên bỏ câu `if (!term) return []` là đủ.
   *
   * ⚠ TRẦN GIỮ NGUYÊN. Đổ cả 1.700 mã xuống là dựng lại đúng cái danh
   *   sách phải cuộn mà ô tìm sinh ra để thay thế.
   */
  /* ⚠ LUẬT NẰM Ở `searchReturnable`, không viết lại ở đây — xem chú
     thích của hàm ấy: bản viết thẳng vào màn thì không chốt nào canh
     được, và nó đã trôi hai lần. */
  const found = useMemo(() => searchReturnable(products, q, PICK_CAP), [q, products])

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
      const headRow: Record<string, unknown> = {
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
      }

      /**
       * ⚠ KHÔNG CÓ QUYỀN CHỌN THÌ KHÔNG GỬI CỘT. Bỏ trống để trigger
       *   mig 160 tự điền: phiếu gắn đơn thì theo nhân viên của đơn,
       *   không gắn đơn thì theo người gõ nếu người đó có bán hàng. Ghi
       *   đè `user.id` ở đây là cướp mất luật ấy — tài khoản kế toán gõ
       *   hộ một phiếu là thành một dòng trừ doanh số không ai nhận.
       */
      if (canPickSeller && sellerId) headRow.sales_user_id = sellerId

      // ⚠ MỘT GIAO DỊCH (mig 171) — xem `lapPhieuTraMotLan`. `null` là máy
      //   chủ chưa có hàm; khi ấy đi đường cũ ngay dưới.
      const motLan = await lapPhieuTraMotLan(supabase, headRow, lines.map(toReturnLine))
      if (motLan) {
        toast({
          title: "Đã lập phiếu trả hàng",
          description: `Khoản có ${formatCurrency(credit)} — chờ bấm Hoàn thành để nhập kho và trừ công nợ.`,
        })
        router.push(`/returns/${motLan}`)
        return
      }

      let { data: head, error: headErr } = await supabase
        .from("returns")
        .insert(headRow)
        .select("id")
        .single()
      /**
       * ⚠ CHƯA CHẠY MIG 160 THÌ VẪN PHẢI LẬP ĐƯỢC PHIẾU. Mã nguồn lên
       *   trước migration là chuyện thường ở đây; để nguyên thì cả màn
       *   Trả hàng chết vì một cột chưa có. Bỏ cột ra ghi lại — phiếu
       *   mất người đứng tên, nhưng phiếu có.
       */
      if (headErr && "sales_user_id" in headRow && retryWithoutSalesUser(headErr)) {
        delete headRow.sales_user_id
        ;({ data: head, error: headErr } = await supabase
          .from("returns")
          .insert(headRow)
          .select("id")
          .single())
      }
      if (headErr) throw headErr
      // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi.
      if (!head?.id) {
        throw new Error("Không tạo được phiếu trả — bạn không có quyền trên đơn vị này.")
      }

      let { data: inserted, error: lineErr } = await supabase
        .from("return_lines")
        .insert(lines.map((l) => ({ return_id: head.id, ...toReturnLine(l) })))
        .select("id")
      // ⚠ Chưa chạy mig 159 thì `reason` là cột lạ — bỏ lý do từng dòng ra ghi lại.
      if (lineErr && mayChuThieuCot(lineErr)) {
        ;({ data: inserted, error: lineErr } = await supabase
          .from("return_lines")
          .insert(lines.map((l) => ({ return_id: head.id, ...boCotMoiCuaDongTra(toReturnLine(l)) })))
          .select("id"))
      }
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
              {/*
                ⚠ Ô CHỌN PHẢI GÕ TÌM ĐƯỢC (chủ nhà báo 21/09/2026: "list
                  khách hàng xổ xuống chưa tìm kiếm được khách hàng").
                  Danh sách này kéo ĐỦ theo trang — với NPP có hơn một
                  nghìn khách thì một `<Select>` liệt kê hết rồi bắt cuộn
                  là không dùng được. `SearchSelect` là ô mà chủ nhà đã
                  chỉ đích danh làm mẫu ("như khi chọn NCC ấy").

                ⚠ KHÔNG CHO GÕ TỰ DO. Phiếu trả PHẢI gắn vào một khách có
                  thật — `customer_id` đi thẳng vào công nợ. Một cái tên
                  gõ tay không trừ nợ cho ai cả.
              */}
              <SearchSelect
                id="ret-customer"
                options={customerOptions}
                valueId={customerId}
                onPick={(o) => setCustomerId(o?.id ?? "")}
                placeholder="Gõ tên cửa hàng, tên chủ hoặc số điện thoại…"
                emptyHint="Không tìm thấy khách nào khớp."
              />
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

            {/*
              ⚠ Ô NÀY NÓI VỀ NGƯỜI, KHÔNG NÓI VỀ HÀNG — và nó ở ngay thẻ
                đầu, cạnh khách hàng, chứ không lẫn xuống bảng dòng hàng.

              ⚠ ĐỂ TRỐNG KHÔNG CÓ NGHĨA LÀ "KHÔNG AI". Trigger mig 160
                điền hộ: có hóa đơn gốc thì theo nhân viên của đơn ấy,
                không có thì theo bạn. Nói ra đúng câu đó, vì một ô rỗng
                không nhãn là người dùng không biết phiếu sẽ tính cho ai.
            */}
            {canPickSeller && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Phiếu này tính cho nhân viên nào
                </Label>
                <SearchSelect
                  id="ret-seller"
                  options={sellerOptions}
                  valueId={sellerId}
                  onPick={(o) => setSellerId(o?.id ?? "")}
                  placeholder="Gõ tên nhân viên…"
                  emptyHint="Không tìm thấy nhân viên nào khớp."
                />
                <p className="text-xs text-muted-foreground">
                  Để trống thì phiếu theo nhân viên của hóa đơn gốc; không gắn hóa đơn
                  thì đứng tên bạn. Báo cáo nhân viên trừ doanh số của người này.
                </p>
              </div>
            )}
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

            {/*
              ⚠ DÙNG `ProductPicker`, KHÔNG TỰ VẼ. Ô tìm tự vẽ ở đây
                chính là lý do màn này bị bỏ sót khi chủ nhà chốt "bấm
                vào là phải xổ list" — bốn màn phiếu đổi theo, hai màn
                tự vẽ (hóa đơn và phiếu trả) thì không. Nay năm màn một
                ô tìm.
            */}
            <ProductPicker
              closeOnPick
              id="ret-add-product"
              label="Tìm sản phẩm khác"
              placeholder="Tên hàng, mã hàng hoặc mã vạch…"
              emptyHint="Không tìm thấy mã nào khớp."
              term={q}
              onTermChange={setQ}
              disabled={products.length === 0}
              items={found.map((p) => ({
                ...p,
                title: p.name,
                subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
              }))}
              onPick={(p) => addFromCatalog(p)}
            />

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
