"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posNewReturnHref } from "@/lib/nav/pos-preview"
import { createClient } from "@/lib/supabase/client"
import { docNguoiBan } from "@/lib/users/nguoi-ban"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { TaoNhanhKhach } from "@/components/tao-nhanh/tao-nhanh-khach"
import { TaoNhanhSanPham } from "@/components/tao-nhanh/tao-nhanh-san-pham"
import { duocTaoNhanh } from "@/lib/tao-nhanh/quyen"
import { gopVuaTao } from "@/lib/tao-nhanh/vua-tao"
import { useToast } from "@/hooks/use-toast"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { formatCurrency } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import { lapPhieuTraMotLan } from "@/lib/sell/create-return"
import { mayChuThieuCot } from "@/lib/db/co-rpc"
import { userPriceRulesFrom } from "@/lib/pricing"
import {
  addReturnLine,
  returnCreditOf,
  returnPriceViolation,
  toReturnLine,
  boCotMoiCuaDongTra,
  type ReturnCartLine,
} from "@/lib/sell/returns"
import type { Customer } from "@/types"
import type { PricedProduct } from "@/lib/sell/pricing"
import { PhieuTraKhachMobile, giaBangTra } from "@/components/returns/phieu-tra-khach-mobile"

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

/* Đủ cho thẻ sản phẩm /sell: ĐVT quy đổi + bảng giá (giá theo nhóm khách, `unitPriceFor`). */
type ProductLite = PricedProduct

/**
 * ⚠ DÙNG TRẦN CHUNG `PICKER_PEEK`, KHÔNG GIỮ MỘT CON SỐ RIÊNG. Năm ô
 * tìm hàng trong kho mã này xổ cùng một số mục; một màn lệch số là
 * người dùng thấy hai ô hành xử khác nhau mà không hiểu vì sao.
 */

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
    Pick<Customer, "id" | "store_name" | "owner_name" | "phone" | "group_id">[]
  >([])
  const [dangNap, setDangNap] = useState(true)
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
    /* ⚠ Cùng câu đọc với POS (`docNguoiBan`): ĐÚNG BỘ VAI TRÒ MÀ TRIGGER CHO PHÉP (mig 160) — hiện ra một cái tên mà
       máy chủ sẽ từ chối là bẫy người dùng — và bỏ người đã nghỉ / tạm khoá (mig 223). Đọc hỏng thì NÓI RA. */
    docNguoiBan(createClient(), user.org_id)
      .then((ds) => { if (!cancelled) setSellers(ds) })
      .catch((e) => {
        if (!cancelled) toast({ title: "Không tải được danh sách nhân viên bán", description: errorMessage(e), variant: "destructive" })
      })
    return () => {
      cancelled = true
    }
  }, [canPickSeller, user?.org_id, toast])


  const [saving, setSaving] = useState(false)
  /** Khung tạo nhanh khách / sản phẩm đang mở, kèm chữ đã gõ ở ô tìm (chủ nhà 03/10/2026) — phiếu giữ nguyên. */
  const [taoKhach, setTaoKhach] = useState<{ chu: string } | null>(null)
  const [taoSp, setTaoSp] = useState<{ chu: string } | null>(null)

  useEffect(() => {
    async function load() {
      const [custRes, prodRes] = await Promise.all([
        // ⚠ Phân trang: hơn 1.000 khách là chuyện thường, mà server cắt ở
        // 1.000 dòng và KHÔNG báo — khách nằm sau đó thì không lập được phiếu.
        fetchAllForAggregate<Pick<Customer, "id" | "store_name" | "owner_name" | "phone" | "group_id">>((from, to) =>
          createClient()
            .from("customers")
            .select("id, store_name, owner_name, phone, group_id", { count: "exact" })
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
            .select("id, name, sku, barcode, base_unit, vat_rate, sell_price, images, price_lists(*), units:product_units(*)", { count: "exact" })
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
      setDangNap(false)
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
      /* Đọc hỏng thì NÓI RA — ô chọn hoá đơn trống trơn trông như "khách chưa mua gì". */
      if (error) {
        toast({ title: "Không tải được hoá đơn của khách", description: errorMessage(error), variant: "destructive" })
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
        const { data: one, error: oneErr } = await supabase
          .from("sales_invoices")
          .select("id, invoice_code, invoice_date, total, order_id")
          .eq("id", invoiceId)
          .maybeSingle()
        if (cancelled) return
        if (oneErr) toast({ title: "Không tải được hoá đơn đang chọn", description: errorMessage(oneErr), variant: "destructive" })
        else if (one) rows.unshift(one as InvoiceLite)
      }
      setInvoices(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [customerId, invoiceId, supabase, toast])

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
  /** Nhóm khách → giá bảng theo nhóm (`unitPriceFor`), như màn bán hàng /sell. */
  const groupId = customers.find((c) => c.id === customerId)?.group_id ?? null

  /**
   * ⚠ GIÁ LẤY TỪ HOÁ ĐƠN ĐÃ BÁN nếu phiếu gắn hoá đơn có (hàng, ĐVT) đó — khách mua có chiết khấu thì trả lại phải
   *   tính đúng số tiền họ đã trả. Không thì giá bảng của nhóm khách ở đúng ĐVT.
   */
  const giaDaBan = (productId: string, unit: string) =>
    invoiceLines.find((o) => o.product_id === productId && o.unit_name === unit)
  const giaGoiY = (productId: string, unit: string) => {
    const sold = giaDaBan(productId, unit)
    return sold ? Number(sold.unit_price) || 0 : giaBangTra(productById(productId), unit, groupId)
  }
  /** ⚠ Trả CAO hơn giá đã bán / giá bảng là một đường rút tiền — trần như màn cũ (`returnPriceViolation`). */
  const tranGia = (l: ReturnCartLine) => {
    const sold = giaDaBan(l.productId, l.unit)
    const ceiling = sold ? Number(sold.unit_price) : giaBangTra(productById(l.productId), l.unit, groupId)
    return { ceiling, sold: !!sold, bad: returnPriceViolation(l, ceiling, priceRules) !== null }
  }

  const credit = returnCreditOf(lines)
  const priceBad = lines.filter((l) => tranGia(l).bad).length

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
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
           * ⚠ LẬP PHIẾU RA Ở "NHÁP" (chủ nhà 25/09/2026: "trạng thái Chờ xử lý chỉ có
           * ở phiếu trả tự sinh" — mig 191). Phiếu tự lập đi Nháp → Hoàn thành.
           *
           * ⚠ KHÔNG PHẢI "HOÀN THÀNH".
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
          status: "draft",
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
    <>
      {/* ⚠ Máy tính thì lập phiếu trả trên màn `/pos` — chủ nhà báo 23/09/2026
          "Tạo phiếu trả hàng → chưa chuyển sang pos". Chặn ở CỬA: nút "Tạo
          phiếu trả" ở danh sách và nút "Trả hàng" ở hóa đơn đều vào đây. */}
      <PosDesktopRedirect
        to={posNewReturnHref({ invoiceId: params.get("invoiceId"), customerId: params.get("customerId") })}
      />
      {/* Điện thoại: cùng kiểu màn bán hàng /sell (chủ nhà 07/10/2026: "Phiếu trả hàng tạo trên mobile chưa có giao
          diện như sell mobile"). Dữ liệu, trần giá, cách lưu vẫn ở trang này. */}
      <PhieuTraKhachMobile
        loading={dangNap}
        loadError={loadError}
        customers={customers}
        customerId={customerId}
        onCustomer={setCustomerId}
        onTaoKhach={duocTaoNhanh(user?.role, "khach") ? (chu) => setTaoKhach({ chu }) : undefined}
        products={products}
        groupId={groupId}
        invoices={invoices}
        invoiceId={invoiceId}
        onInvoice={setInvoiceId}
        invoiceLines={invoiceLines}
        reason={reason}
        onReason={setReason}
        notes={notes}
        onNotes={setNotes}
        sellers={canPickSeller ? sellers.map((u) => ({ value: u.id, label: u.id === user?.id ? `${u.full_name} (bạn)` : u.full_name || "(chưa đặt tên)" })) : null}
        sellerId={sellerId}
        onSeller={setSellerId}
        lines={lines}
        onLines={setLines}
        tranGia={tranGia}
        giaGoiY={giaGoiY}
        credit={credit}
        blocked={blocked}
        saving={saving}
        onSave={() => handleSubmit()}
        onBack={() => router.push("/returns")}
        onTaoSp={duocTaoNhanh(user?.role, "san-pham") ? (chu) => setTaoSp({ chu }) : undefined}
      />
      <TaoNhanhKhach
        open={!!taoKhach}
        onOpenChange={(o) => !o && setTaoKhach(null)}
        chuBanDau={taoKhach?.chu}
        onDaTao={(k) => {
          setCustomers((ds) =>
            gopVuaTao(ds, [{ id: k.id, store_name: k.store_name, owner_name: k.owner_name ?? "", phone: k.phone ?? "", group_id: null }])
          )
          setCustomerId(k.id)
        }}
      />
      <TaoNhanhSanPham
        open={!!taoSp}
        onOpenChange={(o) => !o && setTaoSp(null)}
        chuBanDau={taoSp?.chu}
        moTa="Sản phẩm vừa tạo sẽ được thêm luôn vào phiếu trả."
        onDaTao={(sp) => {
          const moi = { ...sp, price_lists: [], units: [] } as unknown as ProductLite
          setProducts((ds) => gopVuaTao(ds, [moi]))
          setLines((prev) =>
            addReturnLine(prev, {
              productId: moi.id, unit: moi.base_unit, qty: 1, price: Number(moi.sell_price) || 0,
              vatRate: Number(moi.vat_rate ?? 0), isExchange: false, note: "",
            })
          )
        }}
      />
    </>
  )
}
