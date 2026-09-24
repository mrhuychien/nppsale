"use client"

/**
 * LẬP PHIẾU THU — chứng từ độc lập của workflow v2.
 *
 * Kế toán chọn một khách, tick những khoản nợ muốn thu, tick thêm những
 * phiếu trả ĐỘC LẬP muốn cấn trừ, rồi lưu. Toàn bộ việc ghi sổ nằm trong
 * RPC `create_cash_receipt` — một giao dịch, có khoá hàng, có chống thu
 * vượt và chống cấn trừ trùng.
 *
 * ⚠ HAI LOẠI PHIẾU TRẢ GIẢM CÔNG NỢ THEO HAI ĐƯỜNG KHÁC NHAU. Phiếu trả
 * GẮN ĐƠN đã giảm nợ ngay lúc `complete_return` chạy; đem nó vào đây nữa
 * là trừ hai lần, nên RPC từ chối bằng `BAD_CREDIT`. Chỉ phiếu ĐỘC LẬP
 * (`order_id` null) mới nằm chờ ở đây — đó chính là "cấn trừ đơn trả
 * độc lập".
 *
 * ⚠ CON SỐ TO NHẤT MÀN PHẢI LÀ SỐ TIỀN KHÁCH ĐƯA THẬT, tức tổng khoản nợ
 * đã chọn TRỪ tổng khoản có cấn trừ TRỪ phần rút từ số dư có. Hiện tổng
 * khoản nợ thay cho nó là bảo kế toán thu nhiều hơn số khách phải trả.
 *
 * ⚠ Ô TÌM ĐƠN Ở TRÊN CÙNG LÀ LỐI VÀO, KHÔNG PHẢI MỘT DANH SÁCH THỨ HAI.
 * Chủ nhà thu tiền theo đơn: cầm tờ giao hàng, gõ mã đơn, ra đúng khoản
 * nợ của đơn ấy. Nhưng chứng từ ghi sổ vẫn là KHOẢN NỢ, nên chọn đơn chỉ
 * làm hai việc — nạp khách của đơn, và điền sẵn số còn phải thu vào ô của
 * dòng nợ dưới. Không có state riêng cho "đơn đã chọn": nếu có thì màn
 * này lập tức có hai nguồn sự thật cho cùng một con số.
 *
 * ⚠ SỐ DƯ CÓ KHÔNG NẰM TRONG DANH SÁCH KHOẢN NỢ, VÀ ĐÓ LÀ CỐ Ý. Dòng
 * công nợ trả dư có `status = 'paid'` (xem `_wf2_recompute_receivable`),
 * nên bộ lọc `open/partial/overdue` của danh sách trên loại nó ra — đúng,
 * vì nó không phải khoản để đi thu. Nhưng thế thì tiền của khách BIẾN
 * MẤT KHỎI MÀN: kế toán không thấy nó ở đâu để đem ra dùng. Vì vậy có
 * một truy vấn RIÊNG, KHÔNG lọc trạng thái, chỉ hỏi `paid > amount`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SearchSelect } from "@/components/ui/search-select"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MoneyInput } from "@/components/ui/money-input"
import { formatCurrency, formatDate } from "@/lib/utils"
import { PAYMENT_METHODS } from "@/lib/constants"
import { errorMessage } from "@/lib/errors"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { createCashReceipt, cashToCollect } from "@/lib/finance/cash-receipt"
import { totalCredit, type ReceivableAmounts } from "@/lib/receivables/credit"
import {
  outstandingOf,
  searchOrderDebts,
  type OrderDebtRow,
} from "@/lib/finance/receipt-orders"
import { Save, HandCoins, Undo2, TriangleAlert, PiggyBank, Search } from "lucide-react"

interface OpenReceivable {
  id: string
  order_id: string | null
  invoice_id: string | null
  amount: number
  paid: number
  due_date: string | null
  status: string
  order?: { order_code?: string | null } | null
  invoice?: { invoice_code?: string | null } | null
}

/**
 * Nhãn của một dòng công nợ.
 *
 * ⚠ MÃ HÓA ĐƠN TRƯỚC, MÃ ĐƠN SAU — chủ nhà nói đúng. Từ v2b mỗi HÓA ĐƠN
 * sinh một dòng nợ, không phải mỗi đơn: một đơn xuất hai đợt có HAI dòng
 * nợ, và cả hai đều mang cùng một mã `DH-xxxx`. Kế toán nhìn hai dòng
 * giống hệt nhau, số tiền khác nhau, và không có cách nào biết dòng nào
 * là đợt nào.
 *
 * ⚠ CÔNG NỢ ĐẦU KỲ KHÔNG GẮN CHỨNG TỪ NÀO, và đó là hợp lệ (mig 102).
 * Nói thẳng "đầu kỳ / không gắn chứng từ" chứ đừng để trống.
 */
function debtLabel(r: OpenReceivable): string {
  const inv = r.invoice?.invoice_code
  const ord = r.order?.order_code
  if (inv && ord) return `${inv} · ${ord}`
  return inv || ord || "Công nợ không gắn chứng từ"
}

/**
 * Dòng công nợ đang mở của TOÀN TỔ CHỨC, để ô tìm đơn có gì mà tìm.
 *
 * ⚠ CỘT `invoice_id` CÓ TỪ MIG 124 và mã hóa đơn mới là thứ kế toán cầm
 * trên tay (tờ giao hàng in mã `HD-xxxx`). Tìm được cả hai mã thì không
 * phải dạy ai nhớ mã nào tra ở đâu.
 */
const DEBT_SELECT =
  "id, order_id, customer_id, amount, paid, due_date, status, " +
  "order:sales_orders(order_code, order_date), " +
  "invoice:sales_invoices(invoice_code, invoice_date), " +
  "customer:customers(store_name), " +
  "sales_user:users!receivables_sales_user_id_fkey(full_name)"

interface RawDebt {
  id: string
  order_id: string | null
  customer_id: string
  amount: number
  paid: number
  due_date: string | null
  order?: { order_code?: string | null; order_date?: string | null } | null
  invoice?: { invoice_code?: string | null; invoice_date?: string | null } | null
  customer?: { store_name?: string | null } | null
  sales_user?: { full_name?: string | null } | null
}

function toDebtRow(r: RawDebt): OrderDebtRow {
  return {
    receivableId: r.id,
    orderId: r.order_id,
    orderCode: r.order?.order_code ?? null,
    invoiceCode: r.invoice?.invoice_code ?? null,
    customerId: r.customer_id,
    // ⚠ KHÔNG BỊA TÊN. `customer_id` là NOT NULL nên embed rỗng nghĩa là
    //   RLS chặn hoặc dữ liệu hỏng — nói "chưa xác định" chứ đừng để
    //   trống cho người đọc tưởng là khách vãng lai.
    customerName: r.customer?.store_name ?? "Khách chưa xác định",
    salesUserName: r.sales_user?.full_name ?? null,
    orderDate: r.invoice?.invoice_date ?? r.order?.order_date ?? null,
    dueDate: r.due_date,
    amount: Number(r.amount || 0),
    paid: Number(r.paid || 0),
  }
}

interface StandaloneCredit {
  id: string
  credit_note_amount: number | null
  created_at: string
  reason: string | null
}

export default function NewCashReceiptPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("receivables")
  const { toast } = useToast()
  const supabase = createClient()

  const [customers, setCustomers] = useState<
    Array<{ id: string; store_name: string; owner_name: string | null; phone: string | null }>
  >([])
  /**
   * ⚠ MỞ TỪ XEM NHANH HÓA ĐƠN (`?customerId=&invoiceId=`, chủ nhà 24/09/2026:
   *   "Thu tiền -> tạo phiếu thu gắn với Hoá đơn và khách hàng"): khách chọn
   *   sẵn, số còn nợ của ĐÚNG tờ ấy điền sẵn — qua cùng luật `pendingPick`.
   */
  const thamSo = useSearchParams()
  const [customerId, setCustomerId] = useState(() => thamSo.get("customerId") ?? "")
  const pendingInvoice = useRef<string | null>(thamSo.get("invoiceId"))
  /* ⚠ Dựng một lần theo `customers` — dựng lại mỗi lần vẽ là một mảng
     mới mỗi lần, và ô tìm nhận một danh sách "đổi" liên tục. */
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.store_name,
        hint: [c.owner_name, c.phone].filter(Boolean).join(" · ") || null,
        keywords: [c.owner_name, c.phone].filter(Boolean).join(" "),
      })),
    [customers]
  )
  const [method, setMethod] = useState("cash")
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")

  const [receivables, setReceivables] = useState<OpenReceivable[] | null>(null)
  const [credits, setCredits] = useState<StandaloneCredit[] | null>(null)
  /** Các dòng công nợ ĐANG DƯ của khách — nguồn của số dư có (Q11). */
  const [creditRows, setCreditRows] = useState<ReceivableAmounts[] | null>(null)
  const [useCredit, setUseCredit] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** id khoản nợ → số tiền thu. `MoneyInput` trả về số đã phân tích sẵn. */
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [pickedCredits, setPickedCredits] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  /** Ô tìm đơn: mọi khoản nợ đang mở của tổ chức + từ khoá đang gõ. */
  const [allDebts, setAllDebts] = useState<OrderDebtRow[] | null>(null)
  const [debtSearch, setDebtSearch] = useState("")
  /**
   * ⚠ LỖI ĐỌC RIÊNG, KHÔNG DÙNG CHUNG `loadError`. `loadCustomer` xoá
   * `loadError` mỗi lần đổi khách; gộp vào đó là lỗi của ô tìm biến mất
   * ngay khi người dùng chọn khách, và họ tìm mãi không ra mà không hiểu
   * vì sao.
   */
  const [debtError, setDebtError] = useState<string | null>(null)
  /**
   * Đơn vừa chọn khi CHƯA có khách — chờ `loadCustomer` đọc xong rồi mới
   * điền số. Không có chỗ chờ này thì `setCustomerId` chạy trước,
   * `loadCustomer` xoá `amounts`, và con số vừa điền mất ngay.
   */
  const pendingPick = useRef<{ receivableId: string; amount: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetchAllForAggregate<{
        id: string; store_name: string; owner_name: string | null; phone: string | null
      }>((from, to) =>
        supabase
          .from("customers")
          .select("id, store_name, owner_name, phone", { count: "exact" })
          /* ⚠ PHÂN TRANG THEO `id`, KHÔNG THEO `store_name`. Mốc chia
             trang phải DUY NHẤT — hai cửa hàng trùng tên là các trang
             lặp/sót nhau, và khách bị sót thì không lập được phiếu thu
             cho họ. Ô tìm tự sắp theo tên khi hiện ra. */
          .order("id")
          .range(from, to)
      )
      if (cancelled) return
      if (res.error) setLoadError(res.error)
      setCustomers(res.rows)
    })()
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Nạp MỌI khoản nợ đang mở của tổ chức cho ô tìm đơn.
   *
   * ⚠ PHẢI KÉO QUA `fetchAllForAggregate`. PostgREST cắt ở 1000 dòng
   * TRONG IM LẶNG: nhà phân phối nào có hơn 1000 khoản nợ đang mở thì
   * đơn cần tìm nằm ngoài lát cắt, ô tìm trả về rỗng, và kế toán kết
   * luận đơn ấy đã thu rồi.
   *
   * ⚠ LỌC TRẠNG THÁI GIỐNG HỆT DANH SÁCH DƯỚI. Hai bộ lọc khác nhau là
   * chọn được ở trên một dòng không hiện ở dưới — số tiền điền vào một ô
   * không tồn tại.
   */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetchAllForAggregate<RawDebt>((from, to) =>
        supabase
          .from("receivables")
          .select(DEBT_SELECT, { count: "exact" })
          .in("status", ["open", "partial", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false })
          // ⚠ Khoá phụ `id`: cả trăm khoản cùng hạn, các trang chạy song
          //   song — thiếu khoá duy nhất là một khoản nợ lặp hai lần hoặc
          //   biến mất khỏi ô tìm.
          .order("id")
          .range(from, to)
      )
      if (cancelled) return
      if (res.error) {
        setDebtError(res.error)
        setAllDebts([])
        return
      }
      setAllDebts(res.rows.map(toDebtRow))
    })()
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Nạp khoản nợ còn mở + khoản có đang chờ của khách vừa chọn.
   *
   * ⚠ ĐỌC HỎNG THÌ NÓI RA. Hiện danh sách rỗng cho một lỗi mạng là kế
   * toán kết luận khách này không nợ gì, rồi đóng sổ sai.
   */
  const loadCustomer = useCallback(
    async (cid: string) => {
      setReceivables(null)
      setCredits(null)
      setCreditRows(null)
      setAmounts({})
      setPickedCredits(new Set())
      setUseCredit(0)
      setLoadError(null)
      if (!cid) return

      const [recRes, credRes, balRes] = await Promise.all([
        supabase
          .from("receivables")
          .select(
            "id, order_id, invoice_id, amount, paid, due_date, status, " +
              "order:sales_orders(order_code), invoice:sales_invoices(invoice_code)"
          )
          .eq("customer_id", cid)
          .in("status", ["open", "partial", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false }),
        /**
         * ⚠ BA ĐIỀU KIỆN NÀY PHẢI KHỚP ĐÚNG THỨ RPC KIỂM (`BAD_CREDIT`):
         * đã hoàn thành, KHÔNG gắn đơn nào, và chưa cấn trừ vào phiếu thu
         * nào. Hiện rộng hơn là người dùng tick được một phiếu mà RPC sẽ
         * từ chối; hiện hẹp hơn là khoản có nằm chờ mãi không ai thấy.
         */
        supabase
          .from("returns")
          .select("id, credit_note_amount, created_at, reason")
          .eq("customer_id", cid)
          .eq("status", "completed")
          .is("order_id", null)
          .is("applied_receipt_id", null)
          .order("created_at", { ascending: true }),
        /**
         * SỐ DƯ CÓ — phải tự cộng ở đây, và phải cộng ĐỦ.
         *
         * ⚠ KHÔNG LỌC TRẠNG THÁI. Dòng trả dư mang `status = 'paid'` (xem
         * `_wf2_recompute_receivable`) nên mọi bộ lọc "còn mở" gạt nó đi —
         * mà nó chính là tiền của khách đang nằm ở nhà phân phối. Tập
         * phải KHỚP ĐÚNG thứ `create_cash_receipt` cộng vào `v_avail`:
         * mọi dòng công nợ của khách, `GREATEST(0, paid - amount)`.
         *
         * ⚠ PostgREST KHÔNG SO ĐƯỢC CỘT VỚI CỘT, nên không có cách hỏi
         * thẳng `paid > amount`; phải kéo về rồi cộng. Và phải kéo QUA
         * `fetchAllForAggregate`: một khách lâu năm vượt 1000 dòng là
         * PostgREST cắt bớt trong im lặng, số dư hiện ra THIẾU, kế toán
         * rút ít hơn số khách thật sự có.
         */
        fetchAllForAggregate<ReceivableAmounts>((from, to) =>
          supabase
            .from("receivables")
            .select("amount, paid", { count: "exact" })
            .eq("customer_id", cid)
            .order("id")
            .range(from, to)
        ),
      ])
      if (recRes.error || credRes.error || balRes.error) {
        setLoadError(errorMessage(recRes.error ?? credRes.error ?? balRes.error))
        return
      }
      const rows = ((recRes.data as unknown) as OpenReceivable[]) ?? []
      setReceivables(rows)
      setCredits(((credRes.data as unknown) as StandaloneCredit[]) ?? [])
      setCreditRows(balRes.rows)

      /**
       * ⚠ CHỈ ĐIỀN KHI DÒNG ẤY CÓ THẬT TRONG DANH SÁCH VỪA ĐỌC. Ô tìm đơn
       * đọc một lần lúc mở màn; đến lúc bấm thì khoản nợ ấy có thể đã
       * được người khác thu xong. Điền bừa là `amounts` mang một id không
       * hiện ở đâu — tổng phiếu cộng thêm một con số không ai sửa được, và
       * RPC từ chối lúc bấm Lưu mà không ai hiểu vì sao.
       */
      const seed = pendingPick.current
      pendingPick.current = null
      if (seed && rows.some((r) => r.id === seed.receivableId)) {
        setAmounts({ [seed.receivableId]: seed.amount })
      }
      /* Hóa đơn truyền qua đường dẫn: điền số còn nợ của tờ ấy — chỉ khi nó
         đang mở trong danh sách vừa đọc; không thì nói ra, đừng đoán. */
      const hd = pendingInvoice.current
      pendingInvoice.current = null
      if (hd) {
        const r = rows.find((x) => x.invoice_id === hd)
        if (r) setAmounts({ [r.id]: outstandingOf(r) })
        else toast({ title: "Hóa đơn này không còn khoản nợ mở", description: "Chọn khoản khác của khách để thu, hoặc kiểm tra lại hóa đơn." })
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    void loadCustomer(customerId)
  }, [customerId, loadCustomer])

  /** Cùng một phép kẹp với ô tìm đơn — hai chỗ lệch nhau là hai con số. */
  const remainingOf = (r: OpenReceivable) => outstandingOf(r)

  /** Dòng đã chọn = dòng đang có số tiền > 0, không có tập riêng. */
  const pickedIds = useMemo(
    () =>
      new Set(
        Object.entries(amounts)
          .filter(([, v]) => (Number(v) || 0) > 0)
          .map(([k]) => k)
      ),
    [amounts]
  )

  const debtResults = useMemo(
    () =>
      searchOrderDebts(allDebts ?? [], debtSearch, {
        lockedCustomerId: customerId || null,
        alreadyPicked: pickedIds,
      }),
    [allDebts, debtSearch, customerId, pickedIds]
  )

  /**
   * Chọn một đơn từ ô tìm.
   *
   * ⚠ ĐỔI KHÁCH THÌ PHẢI ĐI QUA `loadCustomer`. Điền thẳng số vào
   * `amounts` rồi mới đổi khách là `loadCustomer` xoá sạch ngay sau đó.
   */
  const pickDebt = (r: OrderDebtRow) => {
    const amount = outstandingOf(r)
    if (r.customerId !== customerId) {
      pendingPick.current = { receivableId: r.receivableId, amount }
      setCustomerId(r.customerId)
      return
    }
    setAmounts((p) => ({ ...p, [r.receivableId]: amount }))
  }

  const linesTotal = useMemo(
    () => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0),
    [amounts]
  )
  const creditsTotal = useMemo(
    () =>
      (credits ?? [])
        .filter((c) => pickedCredits.has(c.id))
        .reduce((s, c) => s + Number(c.credit_note_amount || 0), 0),
    [credits, pickedCredits]
  )
  /** Tiền của khách đang nằm ở nhà phân phối, rút được. */
  const creditBalance = useMemo(() => totalCredit(creditRows ?? []), [creditRows])
  /** Rút nhiều nhất bấy nhiêu: không quá số dư, không quá phần còn phải trả. */
  const maxUsable = Math.max(0, Math.min(creditBalance, linesTotal - creditsTotal))
  const toCollect = cashToCollect(linesTotal, creditsTotal, useCredit)

  /**
   * ⚠ BA LUẬT NÀY LÀ BẢN SAO CỦA BA PHÉP KIỂM TRONG RPC. Chặn ở đây để
   * người dùng thấy lý do ngay cạnh ô nhập, thay vì bấm Lưu rồi nhận một
   * mã lỗi. RPC vẫn kiểm lại — đây là lớp lịch sự, không phải lớp an
   * toàn.
   */
  const overAmount = useMemo(
    () =>
      (receivables ?? []).filter((r) => (Number(amounts[r.id]) || 0) > remainingOf(r) + 0.01),
    [receivables, amounts]
  )
  const creditOverflow = creditsTotal > linesTotal
  /** Bản sao của `CREDIT_BALANCE_TOO_LOW` và `CREDIT_EXCEEDS_SELECTED`. */
  const useOverBalance = useCredit > creditBalance + 0.01
  const useOverSelected = useCredit > linesTotal - creditsTotal + 0.01
  const nothingPicked = linesTotal <= 0 && creditsTotal <= 0
  const canSave =
    !!user &&
    hasPermission(user.role, "receivables", "create") &&
    !!customerId &&
    !nothingPicked &&
    !creditOverflow &&
    !useOverBalance &&
    !useOverSelected &&
    overAmount.length === 0 &&
    !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const lines = Object.entries(amounts)
        .map(([receivable_id, v]) => ({ receivable_id, amount: Number(v) || 0 }))
        .filter((l) => l.amount > 0)
      const id = await createCashReceipt(supabase, {
        customer_id: customerId,
        method,
        receipt_date: receiptDate,
        notes: notes.trim() || null,
        lines,
        credits: Array.from(pickedCredits).map((return_id) => ({ return_id })),
        use_credit: useCredit,
      })
      // ⚠ NÓI RÕ TỪNG NGUỒN. "Đã lập phiếu thu 500.000" khi khách chỉ đưa
      //   200.000 là câu dễ bị nhớ nhầm nhất lúc đối chiếu tiền mặt cuối
      //   ngày.
      const parts = [`Khách đưa ${formatCurrency(toCollect)}`]
      if (creditsTotal > 0) parts.push(`cấn trừ ${formatCurrency(creditsTotal)} từ phiếu trả`)
      if (useCredit > 0) parts.push(`rút ${formatCurrency(useCredit)} từ số dư có`)
      toast({ title: "Đã lập phiếu thu", description: `${parts.join(", ")}.` })
      router.push(`/finance/cash-receipts/${id}`)
    } catch (err) {
      toast({ title: "Không lập được phiếu thu", description: errorMessage(err), variant: "destructive" })
      setSaving(false)
    }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const noPermission = !!user && !hasPermission(user.role, "receivables", "create")

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lập phiếu thu"
        description="Tìm đơn cần thu (hoặc chọn khách), sửa số tiền từng khoản, cấn trừ phiếu trả độc lập nếu có."
        backHref="/finance/cash-receipts"
      />

      {noPermission && (
        <Card className="border-error/40 bg-error-container">
          <CardContent className="p-3 text-sm font-semibold text-on-error-container">
            Bạn chưa được cấp quyền lập phiếu thu.
          </CardContent>
        </Card>
      )}

      {loadError && (
        <Card className="border-error/40 bg-error-container">
          <CardContent className="p-3 text-sm text-on-error-container">
            <p className="font-semibold">Không đọc được dữ liệu</p>
            <p className="mt-0.5 break-words">{loadError}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" /> Tìm đơn để thu
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p className="text-xs font-semibold leading-snug text-muted-foreground">
                Gõ mã đơn, mã hoá đơn, tên khách hoặc người bán. Chọn đơn thì tự nạp khách và
                điền sẵn số còn phải thu xuống danh sách dưới — sửa lại được.
              </p>
              <Input
                value={debtSearch}
                onChange={(e) => setDebtSearch(e.target.value)}
                placeholder="DH-0042, HD-0042, tap hoa ba nam…"
              />

              {/* ⚠ KHOÁ THEO KHÁCH THÌ PHẢI NÓI RA. Không nói thì kế toán gõ
                  đúng mã đơn của khách khác mà không ra gì, và kết luận là
                  ô tìm hỏng. */}
              {!!customerId && (
                <p className="text-xs font-semibold leading-snug text-amber-600">
                  Đang chỉ tìm trong đơn của{" "}
                  {customers.find((c) => c.id === customerId)?.store_name || "khách đã chọn"} —
                  một phiếu thu chỉ của một khách. Đổi khách ở ô dưới để tìm rộng ra.
                </p>
              )}

              {debtError ? (
                <p className="rounded-lg bg-error-container p-2 text-xs font-bold text-on-error-container">
                  Không đọc được danh sách đơn còn nợ: {debtError}
                </p>
              ) : allDebts === null ? (
                <Skeleton className="h-14" />
              ) : debtResults.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  {(allDebts ?? []).length === 0
                    ? "Không có đơn nào còn nợ."
                    : "Không có đơn nào khớp."}
                </p>
              ) : (
                <>
                  {debtResults.map((r) => (
                    <button
                      key={r.receivableId}
                      type="button"
                      onClick={() => pickDebt(r)}
                      className="grid gap-1 rounded-xl border p-3 text-left hover:bg-muted/40 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {r.invoiceCode || r.orderCode || "Công nợ không gắn đơn"}
                          {r.invoiceCode && r.orderCode ? (
                            <span className="ml-1.5 font-semibold text-muted-foreground">
                              · {r.orderCode}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground">
                          {r.orderDate ? formatDate(r.orderDate) : "chưa rõ ngày"} ·{" "}
                          {r.customerName} · {r.salesUserName || "chưa rõ người bán"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-extrabold tabular-nums">
                        {formatCurrency(outstandingOf(r))}
                      </span>
                    </button>
                  ))}
                  {/* ⚠ CẮT BỚT THÌ PHẢI NÓI. Im lặng dừng ở 20 dòng đọc
                      giống như "chỉ có bấy nhiêu đơn thôi". */}
                  {debtResults.length >= 20 && (
                    <p className="text-center text-xs text-muted-foreground">
                      Mới hiện 20 đơn đầu — gõ thêm để thu hẹp.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thông tin phiếu</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Khách hàng
                </Label>
                {/*
                  ⚠ GÕ ĐỂ TÌM, KHÔNG CUỘN (chủ nhà chốt 21/09/2026). Danh
                    sách khách kéo ĐỦ theo trang — một `<Select>` liệt kê
                    cả nghìn dòng là không chọn nổi. Lập phiếu thu mà
                    không chọn được khách thì không lập được phiếu.

                  ⚠ KHÔNG CHO GÕ TỰ DO: `customer_id` đi thẳng vào công
                    nợ, một cái tên gõ tay không ghi thu cho ai cả.
                */}
                <SearchSelect
                  id="cr-customer"
                  options={customerOptions}
                  valueId={customerId}
                  onPick={(o) => setCustomerId(o?.id ?? "")}
                  placeholder="Gõ tên cửa hàng, tên chủ hoặc số điện thoại…"
                  emptyHint="Không tìm thấy khách nào khớp."
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ngày thu
                </Label>
                <Input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Hình thức
                </Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú
                </Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HandCoins className="h-4 w-4" /> Khoản nợ còn mở
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {!customerId ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chọn khách hàng để xem khoản nợ.
                </p>
              ) : receivables === null ? (
                <>
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </>
              ) : receivables.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Khách này không còn khoản nợ nào đang mở.
                </p>
              ) : (
                receivables.map((r) => {
                  const remaining = remainingOf(r)
                  const picked = (Number(amounts[r.id]) || 0) > 0
                  const over = (Number(amounts[r.id]) || 0) > remaining + 0.01
                  return (
                    <div
                      key={r.id}
                      className={`grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_auto] sm:items-center ${
                        over ? "border-error/50 bg-error/5" : picked ? "border-primary/40 bg-primary/5" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{debtLabel(r)}</p>
                        <p className="mt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                          Còn nợ {formatCurrency(remaining)}
                          {r.due_date ? ` · hạn ${formatDate(r.due_date)}` : ""}
                        </p>
                        {over && (
                          <p className="mt-1 text-xs font-bold text-error">
                            Thu vượt số còn nợ — nhiều nhất {formatCurrency(remaining)}.
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <MoneyInput
                          value={amounts[r.id] ?? ""}
                          onChange={(v) => setAmounts((p) => ({ ...p, [r.id]: v }))}
                          className="w-40"
                          inputClassName="tabular-nums"
                        />
                        {/* Bấm một lần là điền hết phần còn nợ — việc kế toán
                            làm nhiều nhất, đừng bắt gõ lại con số đã hiện. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setAmounts((p) => ({ ...p, [r.id]: remaining }))}
                        >
                          Đủ
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Undo2 className="h-4 w-4" /> Cấn trừ phiếu trả độc lập
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {/* ⚠ NÓI RÕ VÌ SAO DANH SÁCH NÀY HẸP. Phiếu trả gắn đơn đã giảm
                  nợ ngay lúc hoàn thành; đem vào đây nữa là trừ hai lần, và
                  RPC sẽ từ chối. Không giải thích thì kế toán đi tìm một
                  phiếu trả họ biết chắc là có. */}
              <p className="text-xs font-semibold leading-snug text-muted-foreground">
                Chỉ hiện phiếu trả ĐÃ hoàn thành, KHÔNG gắn đơn nào, và chưa cấn trừ ở phiếu thu
                khác. Phiếu trả gắn đơn đã tự trừ vào công nợ của đơn đó rồi.
              </p>
              {!customerId ? null : credits === null ? (
                <Skeleton className="h-14" />
              ) : credits.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  Khách này không có khoản có nào đang chờ.
                </p>
              ) : (
                credits.map((c) => {
                  const on = pickedCredits.has(c.id)
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                        on ? "border-primary/40 bg-primary/5" : ""
                      }`}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) =>
                          setPickedCredits((p) => {
                            const next = new Set(p)
                            if (v) next.add(c.id)
                            else next.delete(c.id)
                            return next
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold">
                          Phiếu trả {formatDate(c.created_at)}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                          {c.reason || "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-extrabold tabular-nums text-[#b54708]">
                        −{formatCurrency(Number(c.credit_note_amount || 0))}
                      </span>
                    </label>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* ⚠ CHỈ HIỆN KHI KHÁCH THẬT SỰ CÓ SỐ DƯ. Một ô "rút số dư có"
              luôn nằm đó với số 0 dạy kế toán quen mắt bỏ qua nó, đúng
              lúc cần thì không ai nhìn. */}
          {creditBalance > 0 && (
            <Card className="border-success/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="h-4 w-4" /> Số dư có của khách
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {/* Nói TIỀN NÀY TỪ ĐÂU RA, không chỉ nói có bao nhiêu. */}
                <p className="text-xs font-semibold leading-snug text-muted-foreground">
                  Khách đang gửi {formatCurrency(creditBalance)} ở nhà phân phối — phần trả dư
                  sau khi trả hàng. Rút ra để đắp vào các khoản nợ đang chọn; phần rút không
                  phải tiền khách đưa hôm nay.
                </p>
                <div className="flex items-center gap-2">
                  <div className="grid flex-1 gap-1.5">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Rút từ số dư
                    </Label>
                    <MoneyInput
                      value={useCredit || ""}
                      onChange={(v) => setUseCredit(Number(v) || 0)}
                      inputClassName="tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-5"
                    disabled={maxUsable <= 0}
                    onClick={() => setUseCredit(maxUsable)}
                    title={
                      maxUsable <= 0
                        ? "Chọn khoản nợ trước — số dư chỉ đắp được vào khoản đang thu."
                        : undefined
                    }
                  >
                    Rút tối đa
                  </Button>
                </div>
                {useOverBalance && (
                  <p className="text-xs font-bold text-error">
                    Vượt số dư — nhiều nhất {formatCurrency(creditBalance)}.
                  </p>
                )}
                {!useOverBalance && useOverSelected && (
                  <p className="text-xs font-bold text-error">
                    Rút nhiều hơn phần còn phải trả thì lại sinh số dư mới ở chỗ khác. Nhiều
                    nhất {formatCurrency(Math.max(0, linesTotal - creditsTotal))}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tổng kết</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Row label="Khoản nợ đã chọn" value={formatCurrency(linesTotal)} />
              <Row label="Cấn trừ phiếu trả" value={`−${formatCurrency(creditsTotal)}`} />
              {creditBalance > 0 && (
                <Row label="Rút số dư có" value={`−${formatCurrency(useCredit)}`} />
              )}
              <div className="h-px bg-border" />
              {/* ⚠ ĐÂY LÀ CON SỐ KHÁCH ĐƯA THẬT, và là con số RPC ghi vào
                  phiếu. Để tổng khoản nợ ở vị trí này là bảo kế toán thu
                  nhiều hơn số khách phải trả. */}
              <div className="flex items-baseline justify-between">
                <span className="font-bold">Khách đưa</span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {formatCurrency(toCollect)}
                </span>
              </div>

              {creditOverflow && (
                <p className="flex items-start gap-1.5 rounded-lg bg-error-container p-2 text-xs font-bold text-on-error-container">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  Cấn trừ lớn hơn số nợ đã chọn. Chọn thêm khoản nợ, hoặc bỏ bớt phiếu trả.
                </p>
              )}
              {overAmount.length > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-error-container p-2 text-xs font-bold text-on-error-container">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  {overAmount.length} khoản đang thu vượt số còn nợ.
                </p>
              )}

              <Button className="mt-2 w-full" onClick={save} disabled={!canSave}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Đang lưu…" : "Lập phiếu thu"}
              </Button>
              {nothingPicked && !!customerId && (
                <p className="text-center text-xs text-muted-foreground">
                  Chưa chọn khoản nào để thu.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}
