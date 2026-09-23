"use client"

/**
 * MÀN 3 — PHIẾU TRẢ HÀNG, và MÀN 8 — SỬA PHIẾU TRẢ ĐÃ GHI NHẬN.
 *
 * ⚠ MỘT COMPONENT CHO CẢ HAI, đúng lý do của `OrderScreen` (spec §7.1):
 * hai bản sao là hai chỗ phải sửa khi đổi quy tắc tiền, và bản "sửa" —
 * bản ít người mở hơn — là bản sẽ bị quên. Ba điểm khác nhau đều là
 * prop: badge, banner, và dải xem trước delta.
 *
 * ⚠ HAI BẢNG, KHÔNG PHẢI MỘT. Bản thiết kế tách hẳn bảng HÀNG TRẢ và
 * bảng HÀNG ĐỔI, mỗi bảng một ô tìm riêng (`F3` cho hàng trả — tìm
 * trong hóa đơn gốc; `F7` cho hàng đổi — tìm trong kho bán). Hai chiều
 * hàng ngược nhau thì không được nằm chung một danh sách: người đọc
 * cộng nhầm công nợ của khách.
 *
 * ⚠ HÀNG ĐỔI KHÔNG TRỪ TIỀN. Luật nằm ở `returnTotals` và có chốt đo
 * đúng con số bản thiết kế — đừng tính lại ở đây.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MoneyInput } from "@/components/ui/money-input"
import { CompactSelect } from "@/components/ui/compact-select"
import { PosUnitSelect } from "@/components/pos/unit-select"
import { donViCuaSanPham, donViHienThi, doiDonViDongTra } from "@/lib/pos/units"
import { unitPriceFor } from "@/lib/sell/pricing"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { DocPeople } from "@/components/pos/doc-people"
import { useToast } from "@/hooks/use-toast"
import { loadCustomerDebt, loadInvoiceLinesForReturn, loadLotsByProduct, attachLineExtras } from "@/lib/pos/load"
import { savePosReturn, assignDocSeller } from "@/lib/pos/save"
import { formatCurrency } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { lineGross } from "@/lib/pos/discount"
import { returnTotals, debtAfterReturn, warehouseSentence } from "@/lib/pos/return-totals"
import { RETURN_ZONES, type ReturnZone } from "@/lib/returns/complete-return"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosDocLabel, usePosDocCount, usePosDirty } from "@/store/pos/tabs"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, DocBanner, homNay } from "@/components/pos/doc-sub-header"
import { LineTableFrame, QtyStepper } from "@/components/pos/line-table"
import {
  MoneyRow, TotalsHero, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import { PosProductSearchBox } from "@/components/pos/product-search-box"
import { viMatchAllWords } from "@/lib/search"
import {
  focusPosPicker,
  useRegisterPosProductSearch,
  usePosSearchTerm,
} from "@/store/pos/product-search"
import { SourceInvoiceModal } from "@/components/pos/source-invoice-modal"
import {
  DeltaPreviewStrip, DeltaStock, DeltaMoney, type DeltaCell,
} from "@/components/pos/delta-preview-strip"

/** Ba nút HÌNH THỨC HOÀN — spec §6. */
type HoanTien = "cong-no" | "tien-mat" | "chuyen-khoan"
const HOAN_LABEL: Record<HoanTien, string> = {
  "cong-no": "Trừ công nợ",
  "tien-mat": "Tiền mặt",
  "chuyen-khoan": "Chuyển khoản",
}

/**
 * ⚠ LÝ DO LẤY TỪ `RETURN_REASONS`, KHÔNG VIẾT BỘ RIÊNG. Bản đầu của màn
 * này ghi `wrong` cho "Sai hàng" — cột `returns.reason` có CHECK chỉ
 * nhận `wrong_item` (migration 001, dòng 334). Chọn "Sai hàng" rồi bấm
 * lưu là Postgres từ chối cả phiếu, và câu lỗi là một dòng
 * `violates check constraint` không ai đọc nổi.
 */
const LY_DO = RETURN_REASONS

export interface ReturnScreenProps {
  /** `lap` = phiếu mới / còn nháp. `sua` = phiếu ĐÃ nhập kho, mở ra sửa. */
  mode: "lap" | "sua"
  /** `null` = phiếu mới. */
  returnId?: string | null
  badge?: PosBadge | null
  /** Hóa đơn gốc mở kèm từ màn hóa đơn (`?invoice=`) — nạp sẵn dòng. */
  sourceInvoiceId?: string | null
  /** Khách mở kèm (`?customerId=`) — nút "Trả hàng" ở hồ sơ khách dẫn tới đây. */
  sourceCustomerId?: string | null
}

/** Lưới hai bảng — spec §4 hàng "Trả hàng (3, 8)". */
const GRID_TRA = "24px 84px minmax(0,1fr) 108px 96px 104px 110px 24px"
const GRID_DOI = "24px 84px minmax(0,1fr) 96px 104px 120px 24px"

let dem = 0
const newKey = () => `r${++dem}`

export function ReturnScreen({ mode, returnId = null, badge, sourceInvoiceId = null, sourceCustomerId = null }: ReturnScreenProps) {
  const { products, customers, stockByProduct, loading, warnings, productById, customerById } = usePosRefData()
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()

  const [traLines, setTraLines] = useState<PosLine[]>([])
  const [doiLines, setDoiLines] = useState<PosLine[]>([])
  const [khach, setKhach] = useState<PosPartner | null>(null)
  /** Người lập phiếu (`requested_by`) · người đứng tên (`sales_user_id`). */
  const [nguoi, setNguoi] = useState<{ taoId: string | null; ganId: string | null }>({ taoId: null, ganId: null })
  const [dangGan, setDangGan] = useState(false)
  /* ⚠ Giá hàng trả thêm tay tra bảng giá THEO NHÓM KHÁCH, như màn đơn hàng. */
  const groupId = customerById(khach?.id)?.group_id ?? null
  const [hoan, setHoan] = useState<HoanTien>("cong-no")
  const [lyDo, setLyDo] = useState("damaged")
  const [ghiChu, setGhiChu] = useState("")
  const [thoiDiem] = useState(homNay)
  /** Giá khách đã mua theo mặt hàng — từ hóa đơn gốc, chỉ để đối chiếu. */
  const [giaGoc, setGiaGoc] = useState<Record<string, number>>({})
  const [daNap, setDaNap] = useState(!returnId)
  const [mocChuaLuu, setMocChuaLuu] = useState<string | null>(null)
  /* ⚠ MẶC ĐỊNH KHO CẬN DATE cho hàng trả về: hàng khách trả thường
     không bán lại ngay được. Người lập phiếu đổi được, nhưng mặc định
     phải là hướng an toàn. */
  const [zone, setZone] = useState<ReturnZone>("date")
  /**
   * GIỎ ĐÍCH của ô tìm dùng chung — màn này là màn DUY NHẤT có hai giỏ.
   *
   * ⚠ MỘT Ô TÌM, HAI GIỎ, NÊN PHẢI CÓ TRẠNG THÁI NÀY. Chủ nhà chốt cả
   *   `/pos` chỉ một ô tìm; mà phiếu trả thì vừa nhận HÀNG KHÁCH TRẢ
   *   vừa nhận HÀNG MÌNH ĐỔI LẠI. Thiếu biến này thì một trong hai giỏ
   *   không có đường thêm hàng.
   *
   * ⚠ VÀ PHẢI HIỆN RA TRÊN Ô TÌM (`note`). Gõ nhầm giỏ ở màn này không
   *   phải lỗi nhỏ: nó ghi một món khách TRẢ thành một món mình ĐƯA
   *   THÊM — lệch hẳn chiều tiền, mà hai bảng thì nhìn rất giống nhau.
   */
  const [gioDich, setGioDich] = useState<"tra" | "doi">("tra")
  const [moTimKhach, setMoTimKhach] = useState(false)
  const [moChonHD, setMoChonHD] = useState(false)
  const [slipCode, setSlipCode] = useState<string | null>(null)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [invoiceCode, setInvoiceCode] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiNap, setLoiNap] = useState<string | null>(null)

  const tatCaDong = useMemo(
    () => [
      ...traLines.map((l) => ({ qty: l.qty, price: l.price, isExchange: false })),
      ...doiLines.map((l) => ({ qty: l.qty, price: l.price, isExchange: true })),
    ],
    [traLines, doiLines]
  )

  /**
   * ⚠ KHÔNG CÓ Ô "PHÍ TRẢ HÀNG". Bản thiết kế (spec §6) vẽ nó, nhưng
   * bảng `returns` không có cột nào cho khoản ấy và `complete_return`
   * tính `credit_note_amount` thẳng từ dòng hàng. Một ô phí trừ vào
   * "Cần trả khách" trên màn rồi không đi xuống sổ là người dùng hứa
   * với khách một số, sổ ghi số khác. Xem `docs/pos-todo.md`.
   */
  const t = useMemo(() => returnTotals({ lines: tatCaDong }), [tatCaDong])
  const noConLai = debtAfterReturn(khach?.debt, t.dueToCustomer)
  /** Tổng theo giá khách ĐÃ MUA — chỉ khi mọi dòng trả đều có giá gốc. */
  const tienGiaGoc = useMemo(() => {
    if (traLines.length === 0) return null
    let s = 0
    for (const l of traLines) {
      const g = giaGoc[l.productId]
      if (g == null) return null
      const heSo = donViHienThi(l, productById(l.productId)).find((u) => u.unit_name === l.unit)?.conversion || 1
      s += lineGross(l.qty, Math.round(g * heSo))
    }
    return s
  }, [traLines, giaGoc, productById])

  usePosDocLabel("RET", returnId, slipCode)
  const chuKy = useMemo(
    () =>
      JSON.stringify([
        traLines.map((l) => [l.productId, l.qty, l.price, l.lotId ?? null]),
        doiLines.map((l) => [l.productId, l.qty, l.price]),
        khach?.id ?? null, lyDo, ghiChu, zone, invoiceId,
      ]),
    [traLines, doiLines, khach?.id, lyDo, ghiChu, zone, invoiceId]
  )
  useEffect(() => {
    if (daNap && mocChuaLuu === null) setMocChuaLuu(chuKy)
  }, [daNap, chuKy, mocChuaLuu])
  usePosDirty(chuKy, mocChuaLuu)
  /* ⚠ TÊN KHO NHẬN LẤY TỪ `RETURN_ZONES` — chỉ có `sale` và `date`.
     Xem `warehouseSentence`. */
  const tenKhoNhan = RETURN_ZONES.find((z) => z.value === zone)?.label ?? "kho nhận"
  const cauKho = warehouseSentence(t, tenKhoNhan)

  const themDong = useCallback(
    (productId: string, doi: boolean) => {
      const p = products.find((x) => x.id === productId)
      if (!p) return
      const moi: PosLine = {
        key: newKey(),
        productId: p.id,
        sku: p.sku ?? "",
        name: p.name,
        unit: p.base_unit,
        units: donViCuaSanPham(p),
        qty: 1,
        price: unitPriceFor(p, p.base_unit, groupId),
        discount: { value: 0, unit: "vnd" },
        isExchange: doi,
        stock: stockByProduct[p.id] ?? null,
      }
      if (doi) setDoiLines((c) => [...c, moi])
      else setTraLines((c) => [...c, moi])
    },
    [products, stockByProduct, groupId]
  )

  /** Nạp phiếu trả đã lưu. */
  useEffect(() => {
    if (!returnId) return
    let huy = false
    ;(async () => {
      try {
        const sb = createClient()
        const { data, error } = await sb
          .from("returns")
          .select("id, customer_id, invoice_id, reason, notes, status, requested_by, sales_user_id, customer:customers(store_name, phone), lines:return_lines(id, product_id, unit_name, quantity, unit_price, is_exchange, note, product:products(name, sku))")
          .eq("id", returnId)
          .maybeSingle()
        if (huy) return
        if (error) { setLoiNap(errorMessage(error)); return }
        const r = (data as unknown) as {
          customer_id: string; invoice_id: string | null
          reason: string | null; notes: string | null
          requested_by?: string | null; sales_user_id?: string | null
          customer?: { store_name?: string | null; phone?: string | null } | null
          lines?: Array<{
            id: string; product_id: string; unit_name: string; quantity: number
            unit_price: number; is_exchange: boolean; note: string | null
            product?: { name?: string | null; sku?: string | null } | null
          }> | null
        } | null
        if (!r) { setLoiNap("Không tìm thấy phiếu trả này."); return }
        /* ⚠ PHIẾU TRẢ CỦA KHÁCH KHÔNG CÓ MÃ — bảng `returns` không có cột
           `return_code` (chỉ `supplier_returns` có). Bản trước đọc cột ấy:
           mở lại một phiếu đã lưu là câu đọc hỏng 42703 và màn không tải
           được phiếu. Tìm ra 23/09/2026 khi dựng ô tìm theo mã phiếu. */
        setSlipCode(null)
        setInvoiceId(r.invoice_id)
        setLyDo(r.reason || "damaged")
        setGhiChu(r.notes || "")
        setKhach({ id: r.customer_id, name: r.customer?.store_name || "Khách lẻ", meta: r.customer?.phone ?? "" })
        setNguoi({ taoId: r.requested_by ?? null, ganId: r.sales_user_id ?? null })
        const ds = (r.lines ?? []).map((x) => ({
          key: newKey(),
          productId: x.product_id,
          sku: x.product?.sku ?? "",
          name: x.product?.name ?? "Sản phẩm đã xoá",
          unit: x.unit_name,
          /* ⚠ `return_lines` không lưu hệ số — để trống, lúc vẽ lấy của
             danh mục (`donViHienThi`). Đặt 1 là thùng thành hộp. */
          units: [],
          qty: Number(x.quantity) || 0,
          price: Number(x.unit_price) || 0,
          discount: { value: 0, unit: "vnd" as const },
          isExchange: x.is_exchange === true,
          giaTheoHoaDon: true,
          note: x.note ?? undefined,
        }))
        setTraLines(ds.filter((x) => !x.isExchange))
        setDoiLines(ds.filter((x) => x.isExchange))
        if (r.invoice_id) {
          const { data: hd } = await sb.from("sales_invoices").select("invoice_code").eq("id", r.invoice_id).maybeSingle()
          if (!huy) setInvoiceCode(((hd as unknown) as { invoice_code?: string } | null)?.invoice_code ?? null)
        }
        setDaNap(true)
      } catch (e) {
        if (!huy) setLoiNap(errorMessage(e))
      }
    })()
    return () => { huy = true }
  }, [returnId])

  /** Công nợ khách — `null` là chưa đọc được, panel nói "chưa xác định". */
  useEffect(() => {
    const id = khach?.id
    if (!id) return
    let huy = false
    ;(async () => {
      const no = await loadCustomerDebt(createClient(), id).catch(() => null)
      if (!huy) setKhach((c) => (c && c.id === id ? { ...c, debt: no } : c))
    })()
    return () => { huy = true }
  }, [khach?.id])

  /** Lô còn hàng cho các dòng ĐỔI (lấy ra khỏi kho bán). */
  useEffect(() => {
    const ids = doiLines.map((l) => l.productId).filter(Boolean)
    if (ids.length === 0) return
    let huy = false
    ;(async () => {
      const lo = await loadLotsByProduct(createClient(), ids).catch(() => ({}))
      if (!huy) setDoiLines((cu) => attachLineExtras(cu, { lotsByProduct: lo }))
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doiLines.length])

  /**
   * NẠP DÒNG TỪ HÓA ĐƠN GỐC.
   *
   * ⚠ CHỈ TRẢ ĐƯỢC MÓN CÓ TRÊN TỜ GỐC. `enforce_return_line_cap` chặn
   * thật ở máy chủ; nạp sẵn ở đây là chặn sớm và đỡ cho người nhập cả
   * việc gõ lại tên hàng với giá đã bán.
   */
  const napTuHoaDon = useCallback(
    async (id: string) => {
      try {
        const sb = createClient()
        const [ds, hd] = await Promise.all([
          loadInvoiceLinesForReturn(sb, id),
          sb.from("sales_invoices")
            .select("invoice_code, customer_id, customer:customers(store_name, phone, address)")
            .eq("id", id).maybeSingle(),
        ])
        const head = (hd.data as unknown) as {
          invoice_code?: string; customer_id?: string
          customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
        } | null
        setInvoiceId(id)
        setInvoiceCode(head?.invoice_code ?? null)
        /* ⚠ KHÁCH CỦA HÓA ĐƠN LÊN CARD LUÔN. Trả hàng là trả của đúng
           khách trên tờ ấy; bắt chọn lại là mời chọn nhầm. */
        if (head?.customer_id) {
          setKhach({
            id: head.customer_id,
            name: head.customer?.store_name || "Khách lẻ",
            meta: [head.customer?.phone, head.customer?.address].filter(Boolean).join(" · "),
          })
        }
        /* ⚠ GIÁ GỐC THEO ĐƠN VỊ CƠ SỞ — dòng trả đổi được đơn vị. */
        setGiaGoc(Object.fromEntries(ds.map((x) => [x.productId, x.unitPrice / (x.conversion || 1)])))
        setTraLines(
          ds.map((x) => ({
            key: newKey(),
            productId: x.productId,
            sku: x.sku,
            name: x.name,
            unit: x.unitName,
            units: [{ unit_name: x.unitName, conversion: x.conversion }],
            giaTheoHoaDon: true,
            /* ⚠ SỐ LƯỢNG VỀ 0, KHÔNG BẰNG SỐ ĐÃ BÁN. Nạp sẵn cả số là
               một phiếu trả TOÀN BỘ đơn hàng chỉ sau một cú bấm — và
               người dùng phải sửa từng dòng xuống. Hướng an toàn là
               ngược lại. */
            qty: 0,
            price: x.unitPrice,
            discount: { value: 0, unit: "vnd" as const },
            isExchange: false,
          }))
        )
        toast({ title: `Đã nạp ${ds.length} dòng từ hóa đơn gốc — nhập số lượng trả cho từng dòng` })
      } catch (e) {
        toast({ title: "Không nạp được hóa đơn gốc", description: errorMessage(e), variant: "destructive" })
      }
    },
    [toast]
  )

  /* Mở từ màn hóa đơn (`?invoice=`) thì nạp sẵn tờ ấy — chỉ cho phiếu mới. */
  const daNapTuUrl = useRef(false)
  useEffect(() => {
    if (returnId || !sourceInvoiceId || daNapTuUrl.current) return
    daNapTuUrl.current = true
    void napTuHoaDon(sourceInvoiceId)
  }, [returnId, sourceInvoiceId, napTuHoaDon])

  /**
   * ⚠ KHÁCH ĐI KÈM ĐƯỜNG DẪN — chỉ khi KHÔNG có hóa đơn (hóa đơn tự mang
   *   khách của nó), chỉ cho phiếu mới, một lần, và chờ danh mục khách về
   *   rồi mới đặt — cùng luật với màn đơn (`daNapKhachTheoLink`).
   */
  const daNapKhach = useRef(false)
  useEffect(() => {
    if (daNapKhach.current || returnId || sourceInvoiceId || !sourceCustomerId) return
    const kh = customerById(sourceCustomerId)
    if (!kh) return
    daNapKhach.current = true
    setKhach({ id: kh.id, name: kh.store_name, meta: [kh.phone, kh.address].filter(Boolean).join(" · ") })
  }, [returnId, sourceInvoiceId, sourceCustomerId, customerById, customers.length])

  /** Lưu phiếu trả — ghi kho đi qua `complete_return`, một giao dịch. */
  const luuPhieu = useCallback(
    async (complete: boolean) => {
      if (!user?.org_id || !user.id) return
      if (!khach) { toast({ title: "Chưa chọn khách hàng", variant: "destructive" }); return }
      const dong = [...traLines, ...doiLines].filter((l) => l.productId && l.qty > 0)
      if (dong.length === 0) { toast({ title: "Phiếu chưa có dòng hàng nào", variant: "destructive" }); return }
      setDangLuu(true)
      try {
        const r = await savePosReturn(createClient(), {
          returnId,
          orgId: user.org_id,
          userId: user.id,
          customerId: khach.id,
          invoiceId,
          reason: lyDo,
          notes: ghiChu,
          lines: dong,
          complete,
          zone,
        })
        setMocChuaLuu(chuKy)
        toast({
          title: complete ? `Đã ghi nhận — hàng vào ${tenKhoNhan}` : "Đã lưu phiếu nháp",
        })
        if (!returnId) router.replace(`/pos/tra-hang/${r.returnId}`)
      } catch (e) {
        toast({ title: "Chưa lưu được", description: errorMessage(e), variant: "destructive" })
      } finally {
        setDangLuu(false)
      }
    },
    [user, khach, traLines, doiLines, returnId, invoiceId, lyDo, ghiChu, zone, tenKhoNhan, chuKy, router, toast]
  )

  /**
   * ⚠ `F7` LÀ THÊM HÀNG ĐỔI Ở MÀN PHIẾU TRẢ ĐỘC LẬP (spec §10). `F8`
   * dành cho hàng trả KÈM trong đơn/hóa đơn — ở màn này ô hàng trả là
   * bảng chính nên nó nhận `F3`.
   */
  const tuKhoa = usePosSearchTerm()

  /** Chọn giỏ rồi đưa tiêu điểm về ô tìm — hai nút và hai phím dùng chung. */
  const themVao = useCallback((gio: "tra" | "doi") => {
    setGioDich(gio)
    focusPosPicker()
  }, [])

  usePosDocCount(traLines.length + doiLines.length)

  usePosKeys({
    F2: () => themVao("tra"),
    F3: () => themVao("tra"),
    F4: () => setMoTimKhach(true),
    F7: () => themVao("doi"),
    Escape: () => { setMoTimKhach(false); setMoChonHD(false) },
  })

  const mucHang = useMemo<SearchItem[]>(
    () =>
      products.map((p) => {
        const ton = stockByProduct[p.id] ?? 0
        return {
          id: p.id,
          title: p.name,
          meta: `${p.sku ?? "—"} · ${p.base_unit} · Tồn ${ton.toLocaleString("vi-VN")}`,
          alert: ton <= 0,
          keywords: `${p.sku ?? ""} ${p.barcode ?? ""}`,
          right: (
            <span className="n text-[12.5px] font-semibold text-[var(--pos-ink)]">
              {formatCurrency(unitPriceFor(p, p.base_unit, groupId))}
            </span>
          ),
        }
      }),
    [products, stockByProduct, groupId]
  )

  /**
   * ⚠ ĐÃ GẮN HÓA ĐƠN GỐC THÌ Ô TÌM HÀNG TRẢ CHỈ TÌM TRONG TỜ ẤY.
   * `enforce_return_line_cap` chặn thật ở máy chủ; đây là chặn sớm:
   * một món không có trên tờ gốc không được hiện ra để chọn.
   */
  const mucHangTra = useMemo<SearchItem[]>(
    () => (invoiceId ? mucHang.filter((it) => giaGoc[it.id] != null) : mucHang),
    [mucHang, invoiceId, giaGoc]
  )

  /**
   * ⚠ DANH MỤC ĐƯA LÊN Ô TÌM ĐỔI THEO GIỎ ĐÍCH. Giỏ HÀNG TRẢ khi đã gắn
   *   hóa đơn gốc thì chỉ được chọn trong tờ ấy (`mucHangTra`); giỏ HÀNG
   *   ĐỔI lấy từ kho bán nên dùng cả danh mục. Đưa nhầm danh mục là mời
   *   người dùng chọn một món mà `enforce_return_line_cap` sẽ chặn ở
   *   máy chủ — chặn sớm ngay ở đây thì họ không phải gõ hai lần.
   *
   * ⚠ LỌC Ở ĐÂY, VÌ Ô TÌM DÙNG CHUNG KHÔNG TỰ LỌC — xem sổ đăng ký.
   */
  const mucChoODung = useMemo(() => {
    const nguon = gioDich === "tra" ? mucHangTra : mucHang
    const out: Array<{ id: string; title: string; subtitle: string; meta: string; alert?: boolean }> = []
    for (const it of nguon) {
      if (!viMatchAllWords(tuKhoa, it.title, it.keywords ?? "")) continue
      out.push({ id: it.id, title: it.title, subtitle: it.meta ?? "", meta: it.meta ?? "", alert: it.alert })
      if (out.length >= 60) break
    }
    return out
  }, [gioDich, mucHangTra, mucHang, tuKhoa])

  const chonHang = useCallback(
    (it: { id: string }) => themDong(it.id, gioDich === "doi"),
    [themDong, gioDich]
  )

  useRegisterPosProductSearch({
    items: mucChoODung,
    onPick: chonHang,
    disabled: loading,
    placeholder:
      gioDich === "tra"
        ? (invoiceId ? "Tìm trong hóa đơn gốc…" : "Tên hàng, mã hàng…")
        : "Thêm hàng đổi từ kho bán…",
  })

  const mucKhach = useMemo<SearchItem[]>(
    () =>
      customers.map((c) => ({
        id: c.id,
        title: c.store_name,
        meta: [c.phone, c.address].filter(Boolean).join(" · "),
        keywords: `${c.owner_name ?? ""} ${c.phone ?? ""}`,
      })),
    [customers]
  )

  /**
   * DẢI XEM TRƯỚC DELTA — dựng từ CHÍNH state của màn này.
   *
   * ⚠ NÓI ĐƯỢC GÌ THÌ NÓI, PHẦN CÒN LẠI ĐỂ "ĐANG TÍNH…". Chiều và số
   * lượng hàng vào/ra kho suy ra được ngay từ các dòng đang gõ; con số
   * TỒN TRƯỚC/SAU và công nợ trước/sau thì cần một lượt đọc chưa có
   * (xem `docs/pos-todo.md`). Trộn hai thứ ấy làm một rồi điền 0 vào
   * phần chưa biết là dải này nói "lưu xong chẳng có gì đổi" — câu trả
   * lời nguy hiểm nhất có thể hiện ngay trước một bút toán kho.
   */
  const deltaCells = useMemo<DeltaCell[]>(() => {
    const oKho = (ds: PosLine[], dau: 1 | -1, donVi: string): DeltaCell["body"] => {
      if (ds.length === 0) return <span className="text-[var(--pos-dim)]">không đổi</span>
      const d = ds[0]
      return (
        <DeltaStock
          sku={d.sku || d.name.slice(0, 18)}
          lot={d.lotId ?? null}
          net={dau * ds.reduce((s2, x) => s2 + x.qty, 0)}
          unit={donVi}
        />
      )
    }
    return [
      { label: tenKhoNhan, body: oKho(traLines, 1, "sp") },
      { label: "Kho bán", body: oKho(doiLines, -1, "sp") },
      {
        label: "Công nợ khách",
        /* ⚠ Chưa đọc được nợ hiện tại thì `đang tính…`, đừng dựng
           `0 → 0`. */
        body:
          khach?.debt == null || noConLai == null ? null : (
            <DeltaMoney from={khach.debt} to={noConLai} verb="giảm" />
          ),
      },
    ]
  }, [traLines, doiLines, khach, noConLai, tenKhoNhan])

  const bang = (
    lines: PosLine[],
    setLines: (n: PosLine[]) => void,
    doi: boolean
  ) => {
    const g = doi ? GRID_DOI : GRID_TRA
    const patch = (key: string, p: Partial<PosLine>) =>
      setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)))
    return (
      <>
        <div
          className="grid h-[34px] shrink-0 items-center border-b border-[var(--pos-line)] bg-[var(--pos-head)] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--pos-muted)]"
          style={{ gridTemplateColumns: g, gap: 8 }}
        >
          <div>#</div><div>Mã hàng</div><div>Tên hàng</div>
          {!doi && <div>Lô / HSD</div>}
          <div style={{ textAlign: "center" }}>Số lượng</div>
          <div style={{ textAlign: "right" }}>Đơn giá</div>
          <div style={{ textAlign: "right" }}>Thành tiền</div>
          <div />
        </div>
        {lines.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--pos-muted)]">
            {loading
              ? "Đang tải danh mục hàng…"
              : doi
                ? "Chưa có hàng đổi. Bấm F7 để thêm."
                : "Chưa có hàng trả. Bấm F3 để thêm."}
          </p>
        )}
        {lines.map((l, i) => {
          const tien = lineGross(l.qty, l.price)
          return (
            <div
              key={l.key}
              className="grid min-h-[52px] items-center border-b border-[var(--pos-line-soft)] px-4 py-1.5"
              style={{ gridTemplateColumns: g, gap: 8 }}
            >
              <div className="n text-[11.5px] text-[var(--pos-dim)]">{i + 1}</div>
              <div className="n truncate text-[11px] text-[var(--pos-muted)]">{l.sku || "—"}</div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium leading-tight text-[var(--pos-ink)]">
                    {l.name}
                  </span>
                  {/* ⚠ Đổi đơn vị là đổi giá — xem `doiDonViDongTra`. */}
                  <PosUnitSelect
                    className="shrink-0"
                    label={`Đơn vị ${doi ? "đổi" : "trả"} dòng ${i + 1}`}
                    value={l.unit}
                    units={donViHienThi(l, productById(l.productId))}
                    onChange={(u) => patch(l.key, doiDonViDongTra(l, u, productById(l.productId), groupId))}
                  />
                </div>
                <div className="mt-px truncate text-[11px] text-[var(--pos-muted)]">
                  {l.stock == null ? (
                    <span className="text-[var(--pos-dim)]">tồn chưa xác định</span>
                  ) : (
                    `Tồn ${l.stock.toLocaleString("vi-VN")}`
                  )}
                  {doi ? " · xuất từ Kho bán" : ` · nhập vào ${tenKhoNhan}`}
                </div>
              </div>
              {!doi && (
                <CompactSelect
                  ariaLabel={`Lô hàng trả dòng ${i + 1}`}
                  value={l.lotId ?? ""}
                  onChange={(v) => patch(l.key, { lotId: v || null })}
                  /* ⚠ Chưa có danh sách lô — xem `docs/pos-todo.md` mục 4. */
                  emptyLabel="chưa chọn lô"
                  options={(l.lots ?? []).map((lo) => ({
                    value: lo.id,
                    label: `${lo.code}${lo.expiry ? ` · ${lo.expiry}` : ""}`,
                  }))}
                  className="w-full border-[var(--pos-edge)] bg-white text-[11px] text-[var(--pos-ink)]"
                />
              )}
              <QtyStepper
                compact
                label={`số lượng ${doi ? "đổi" : "trả"} dòng ${i + 1}`}
                value={l.qty}
                onChange={(v) => patch(l.key, { qty: v })}
              />
              <MoneyInput
                showSuffix={false}
                inputClassName="n h-7 w-full rounded-md border border-[var(--pos-edge)] px-1.5 text-right text-[12px] text-[var(--pos-ink)] py-0 lg:h-7 focus-visible:ring-1 focus-visible:ring-offset-0"
                aria-label={`Đơn giá dòng ${i + 1}`}
                value={l.price}
                onChange={(v) => patch(l.key, { price: v })}
              />
              <div className="text-right">
                {doi ? (
                  <>
                    {/*
                      ⚠ SỐ GẠCH NGANG + CHỮ "không trừ tiền". Ẩn hẳn số
                        đi thì người lập phiếu không biết món ấy đáng bao
                        nhiêu; để số trần thì họ tưởng nó đang được trừ.
                    */}
                    <div className="n text-[12.5px] text-[var(--pos-dim)] line-through">
                      {formatCurrency(tien)}
                    </div>
                    <div className="text-[9.5px] font-semibold text-[var(--pos-primary)]">không trừ tiền</div>
                  </>
                ) : (
                  <div className="n text-[13px] font-bold text-[var(--pos-warn)]">{formatCurrency(tien)}</div>
                )}
              </div>
              <button
                type="button"
                aria-label={`Xoá dòng ${doi ? "đổi" : "trả"} ${i + 1}`}
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                className="flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--pos-line-soft)]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--pos-dim)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      <DocSubHeader
        title={mode === "sua" ? "Sửa phiếu trả" : "Phiếu trả hàng"}
        code={slipCode}
        badge={badge ?? (mode === "lap" ? { label: "NHÁP", tone: "tam" } : null)}
        subtitle={
          <button
            type="button"
            onClick={() => setMoChonHD(true)}
            className="font-semibold text-[var(--pos-primary)] underline"
          >
            {invoiceId ? `Hóa đơn gốc ${invoiceCode ?? "đã gắn"} — đổi` : "Chọn hóa đơn gốc"}
          </button>
        }
        right={<SubHeaderDate value={thoiDiem} label="Ngày lập" readOnly />}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/* ⚠ `min-w-0 flex-1`, không cứng 1012px — xem `OrderScreen`. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}
          {loiNap && <DocBanner tone="warn">Không nạp được phiếu — {loiNap}</DocBanner>}

          {/*
            ⚠ BANNER MÔ TẢ CƠ CHẾ ĐANG CÓ (spec §7.2). Phiếu đã nhập kho
              thì ghi nhận lại là hoàn tác bút toán cũ rồi ghi lại theo
              số mới — trong cùng một giao dịch, và SỐ PHIẾU GIỮ NGUYÊN.
              Đây là điểm khác hẳn màn sửa hóa đơn, nơi tờ cũ bị huỷ và
              tờ mới mang số `-1`.
          */}
          {mode === "sua" && (
            <DocBanner tone="warn">
              Phiếu đã nhập kho. Ghi nhận lại sẽ hoàn tác bút toán kho và công nợ cũ rồi ghi
              lại theo số mới, trong cùng một giao dịch — giữ nguyên số phiếu.
            </DocBanner>
          )}

          <LineTableFrame
            header={
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-[var(--pos-line)] bg-white px-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--pos-warn)]">
                  Hàng trả về
                </span>
                <span className="text-[11px] text-[var(--pos-muted)]">
                  {t.returnLineCount} dòng · {t.returnQty} sp
                </span>
                <div className="flex-grow" />
                <button
                  type="button"
                  onClick={() => themVao("tra")}
                  className="h-7 rounded-md border border-[var(--pos-edge)] bg-white px-2.5 text-[11.5px] font-semibold text-[var(--pos-muted)]"
                >
                  + Hàng trả <span className="n opacity-70">F2</span>
                </button>
              </div>
            }
          >
            {bang(traLines, setTraLines, false)}

            <div className="flex h-[38px] items-center gap-2 border-y border-[var(--pos-line)] bg-[var(--pos-head)] px-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--pos-primary-deep)]">
                Hàng đổi
              </span>
              <span className="text-[11px] text-[var(--pos-muted)]">
                {t.exchangeLineCount} dòng · {t.exchangeQty} sp · không trừ tiền
              </span>
              <div className="flex-grow" />
              <button
                type="button"
                onClick={() => themVao("doi")}
                className="h-7 rounded-md border border-[var(--pos-edge)] bg-white px-2.5 text-[11.5px] font-semibold text-[var(--pos-muted)]"
              >
                + Hàng đổi <span className="n opacity-70">F7</span>
              </button>
            </div>

            {bang(doiLines, setDoiLines, true)}
          </LineTableFrame>

          {/* ⚠ Chỉ màn 8 có dải delta — spec §7.1 nói rõ màn lập phiếu
              không có gì để xem trước. */}
          {mode === "sua" && (
            <DeltaPreviewStrip subtitle="Hoàn tác cũ rồi ghi mới" cells={deltaCells} />
          )}
        </div>

        <div className="flex min-h-0 w-[420px] shrink-0 flex-col gap-3">
          <div className="relative">
            <PartnerCard
              partner={khach}
              onPick={() => setMoTimKhach(true)}
              onClear={() => setKhach(null)}
            />
            <SearchDropdown
              open={moTimKhach}
              onClose={() => setMoTimKhach(false)}
              title="Tìm khách hàng"
              placeholder="Tên cửa hàng, SĐT, địa chỉ…"
              items={mucKhach}
              onPick={(it) => setKhach({ id: it.id, name: it.title, meta: it.meta })}
              emptyHint="Không tìm thấy khách nào khớp."
            />
          </div>

          {/*
            ⚠ NGƯỜI ĐƯỢC GÁN CỦA PHIẾU ĐÃ LƯU ĐỔI QUA `assign_doc_seller`
              (mig 178) — gán ngay, không cần lưu lại phiếu. Phiếu MỚI thì
              máy chủ tự điền người của đơn / người lập (trigger mig 153).
          */}
          <DocPeople
            createdById={returnId ? nguoi.taoId : user?.id}
            assignedId={returnId ? nguoi.ganId : null}
            busy={dangGan}
            onAssign={
              returnId
                ? async (uid) => {
                    setDangGan(true)
                    try {
                      await assignDocSeller(createClient(), "return", returnId, uid)
                      setNguoi((n) => ({ ...n, ganId: uid }))
                      toast({ title: "Đã gán lại người phụ trách phiếu trả" })
                    } catch (e) {
                      toast({ title: "Chưa gán được", description: errorMessage(e), variant: "destructive" })
                    } finally {
                      setDangGan(false)
                    }
                  }
                : undefined
            }
            note="Gán ngay — không cần lưu lại phiếu."
          />

          <PosProductSearchBox
            note={
              gioDich === "tra"
                ? { text: "Hàng khách trả", tone: "warn" }
                : { text: "Hàng đổi lại cho khách", tone: "primary" }
            }
          />

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[var(--pos-line)] bg-white p-3.5">
            {/* ⚠ "Giá gốc hàng mua" CHỈ ĐỂ ĐỐI CHIẾU, không vào phép cộng —
                xem `return-totals.ts`. Chưa gắn hóa đơn gốc thì nói
                "chưa xác định" chứ không điền 0. */}
            <MoneyRow
              label="Giá gốc hàng mua"
              value={tienGiaGoc == null ? "chưa xác định" : tienGiaGoc}
              tone="muted"
            />
            <MoneyRow label="Tổng tiền hàng trả" value={t.goodsReturned} />
            <div className="flex items-center justify-between py-[5px]">
              <span className="text-[13px] text-[var(--pos-muted)]">Giá trị hàng đổi</span>
              <span className="text-right">
                <span className="mr-2 text-[10px] font-semibold text-[var(--pos-primary)]">không trừ tiền</span>
                <span className="n text-[13.5px] text-[var(--pos-dim)]">
                  {formatCurrency(t.exchangeValue)}
                </span>
              </span>
            </div>

            <TotalsHero
              label="Cần trả khách"
              value={t.dueToCustomer}
              tone="green"
              sub={
                hoan === "cong-no"
                  ? noConLai == null
                    ? "Trừ vào công nợ · còn lại chưa xác định"
                    : `Trừ vào công nợ · còn lại ${formatCurrency(noConLai)}`
                  : `Hoàn bằng ${HOAN_LABEL[hoan].toLowerCase()}`
              }
            />

            <p className="mt-3.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
              Hình thức hoàn
            </p>
            <div className="mt-1.5 flex gap-1.5">
              {(Object.keys(HOAN_LABEL) as HoanTien[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={hoan === h}
                  onClick={() => setHoan(h)}
                  className={`h-8 flex-grow rounded-[7px] border text-[12px] ${
                    hoan === h
                      ? "border-[var(--pos-primary)] bg-[var(--pos-primary-faint)] font-semibold text-[var(--pos-primary-deep)]"
                      : "border-[var(--pos-edge)] bg-white font-medium text-[var(--pos-muted)]"
                  }`}
                >
                  {HOAN_LABEL[h]}
                </button>
              ))}
            </div>
            {/*
              ⚠ `complete_return` LUÔN ghi giảm công nợ (credit note).
                Hoàn tiền mặt / chuyển khoản là một phiếu chi riêng mà
                màn POS chưa lập — nói ra, đừng để hai nút kia im lặng.
            */}
            {hoan !== "cong-no" && (
              <p className="mt-1 text-[11px] text-[var(--pos-warn)]">
                Phiếu vẫn ghi giảm công nợ khách. Hoàn bằng {HOAN_LABEL[hoan].toLowerCase()} phải
                lập phiếu chi riêng — màn này chưa làm được việc đó.
              </p>
            )}

            {/*
              ⚠ NGƯỜI LẬP PHIẾU PHẢI CHỌN KHO NHẬN. `complete_return`
                nhận đúng hai vùng (`ReturnZone`); mặc định là kho cận
                date vì hàng khách trả thường không bán lại ngay được,
                nhưng đó là mặc định chứ không phải quyết định thay họ.
            */}
            <label htmlFor="pos-kho" className="mt-3.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
              Kho nhận hàng trả
            </label>
            <select
              id="pos-kho"
              value={zone}
              onChange={(e) => setZone(e.target.value as ReturnZone)}
              className="mt-1 h-8 w-full rounded-[7px] border border-[var(--pos-edge)] bg-white px-2 text-[12.5px] text-[var(--pos-ink)]"
            >
              {RETURN_ZONES.map((z) => (
                <option key={z.value} value={z.value}>{z.label} — {z.hint}</option>
              ))}
            </select>

            <label htmlFor="pos-lydo" className="mt-3.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
              Lý do trả hàng
            </label>
            <CompactSelect
              id="pos-lydo"
              ariaLabel="Lý do trả hàng"
              value={lyDo}
              onChange={setLyDo}
              options={LY_DO}
              className="mt-1 h-8 w-full rounded-[7px] border-[var(--pos-edge)] bg-white px-2 text-[12.5px] text-[var(--pos-ink)]"
            />

            <label htmlFor="pos-ghichu" className="mt-2.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
              Ghi chú
            </label>
            <input
              id="pos-ghichu"
              type="text"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              placeholder="VD: hàng móp thùng khi giao, khách báo lúc nhận…"
              className="mt-1 h-8 w-full rounded-[7px] border border-[var(--pos-edge)] px-2 text-[12.5px] text-[var(--pos-muted)]"
            />

            <div className="flex-grow" />

            {/*
              ⚠ BOX CẢNH BÁO NÓI ĐÚNG HAI CHIỀU KHO, và chỉ hiện khi có
                gì để nói. Phiếu rỗng mà vẫn hứa một giao dịch là nói dối
                — xem `warehouseSentence`.
            */}
            {cauKho && (
              <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pos-warn)" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden>
                  <path d="M12 8v5M12 17h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <span className="text-[11.5px] leading-snug text-[var(--pos-warn)]">{cauKho}</span>
              </div>
            )}

            {mode === "sua" && (
              <p className="mt-2 text-[11px] leading-snug text-[var(--pos-muted)]">
                Số phiếu {slipCode || "này"} giữ nguyên. Bản ghi cũ vào nhật ký kèm người sửa
                và thời điểm.
              </p>
            )}
          </div>

          <PanelActions>
            {/* ⚠ Chưa có mẫu in phiếu trả — nút mờ kèm lý do, không `window.print()` cả màn. */}
            <PanelButton width={54} disabled title="Chưa có mẫu in phiếu trả hàng">In</PanelButton>
            <PanelButton
              width={96}
              disabled={dangLuu}
              onClick={() => (mode === "sua" ? router.back() : luuPhieu(false))}
            >
              {mode === "sua" ? "Huỷ" : dangLuu ? "Đang lưu…" : "Lưu nháp"}
            </PanelButton>
            <PanelButton
              variant="primary"
              disabled={dangLuu || (t.returnLineCount === 0 && t.exchangeLineCount === 0) || !khach}
              onClick={() => luuPhieu(true)}
              title={
                t.returnLineCount === 0 && t.exchangeLineCount === 0
                  ? "Chưa có dòng hàng nào trong phiếu"
                  : !khach
                    ? "Chưa chọn khách hàng"
                    : `Nhập hàng trả vào ${tenKhoNhan} và giảm công nợ — một giao dịch`
              }
            >
              {dangLuu ? "Đang ghi…" : "Ghi nhận & nhập kho"}
            </PanelButton>
          </PanelActions>
        </div>
      </div>

      <SourceInvoiceModal
        open={moChonHD}
        onClose={() => setMoChonHD(false)}
        customerId={khach?.id ?? null}
        onPick={(id) => { void napTuHoaDon(id); setMoChonHD(false) }}
      />
    </>
  )
}
