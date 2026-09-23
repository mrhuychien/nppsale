"use client"

/**
 * MÀN 7 — SỬA HÓA ĐƠN ĐÃ GHI SỔ. Spec §6, §7.2.
 *
 * ⚠ SPEC §7.2 VIẾT "NPP TOÀN QUYỀN — MỌI TRƯỜNG MỞ", VÀ `reissue_invoice`
 * KHÔNG NHẬN PHẦN LỚN TRONG SỐ ĐÓ. RPC ấy chỉ nhận: dòng hàng (số
 * lượng, giá, giảm theo dòng, thuế theo dòng), `payment_terms`,
 * `invoice_date` và `notes`. Khách, kho xuất, NVBH, hạn trả, giảm giá
 * cấp chứng từ, thu khác — không có cổng nào nhận. Bản đầu vẽ đủ các ô
 * ấy; người dùng đổi khách, bấm lưu, tờ mới vẫn mang khách cũ và không
 * câu nào báo. Nay chỉ vẽ những ô LƯU ĐƯỢC; thứ không lưu được thì hiện
 * để đọc, không mời sửa. Spec §7.2 cho phép chỉnh cho khớp hành vi thật.
 *
 * ⚠ NHƯNG CÓ HAI KHOÁ THẬT, VÀ MÀN PHẢI NÓI RA TRƯỚC KHI NGƯỜI DÙNG
 * BẤM. `reissue_invoice` gọi `cancel_invoice`, và hàm ấy TỪ CHỐI khi:
 *
 *   · `LOCKED_HAS_PAYMENT` — hóa đơn đã có tiền thu
 *   · `LOCKED_EINVOICE`    — đã phát hành hóa đơn điện tử
 *
 * Bản thiết kế để nhãn "ĐÃ THU — GIỮ NGUYÊN QUA LẬP LẠI"; điều đó
 * KHÔNG đúng với cơ chế đang chạy. Spec §7.2 chốt: *"Nội dung banner
 * mô tả cơ chế đang có… Chỉnh lại câu chữ cho khớp hành vi thật nếu
 * khác."* Nên nhãn ở đây nói đúng: tiền đã thu CHẶN việc lập lại cho
 * tới khi phiếu thu bị huỷ. Xem `reissueLock`.
 *
 * ⚠ SỐ CŨ GẠCH NGANG Ở CẢ Ô THÀNH TIỀN LẪN DÒNG TỔNG (spec §7.2). Đây
 * là màn duy nhất người dùng so hai phiên bản của cùng một tờ; không
 * có số cũ thì họ phải nhớ.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { loadCustomerDebt, loadLotsByProduct, attachLineExtras } from "@/lib/pos/load"
import { savePosInvoice } from "@/lib/pos/save"
import { invoiceWarnings } from "@/lib/orders/post-invoice"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { formatCurrency, formatDate } from "@/lib/utils"
import { reissueLock, invoiceEditTotals } from "@/lib/pos/invoice-edit"
import { creditOnInvoice, type InvoiceReturnRow } from "@/lib/orders/invoice-credit"
import type { PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, DocBanner, homNay } from "@/components/pos/doc-sub-header"
import { usePosDocLabel, usePosDocCount, usePosDirty } from "@/store/pos/tabs"
import { posPrintHref } from "@/lib/pos/tabs"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell,
  LineAmountCell, LineMenu,
} from "@/components/pos/line-table"
import {
  MoneyRow, TotalsHero, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { PosProductSearchBox } from "@/components/pos/product-search-box"
import { viMatchAllWords } from "@/lib/search"
import {
  focusPosPicker,
  useRegisterPosProductSearch,
  usePosSearchTerm,
} from "@/store/pos/product-search"
import {
  DeltaPreviewStrip, DeltaStock, DeltaMoney, type DeltaCell,
} from "@/components/pos/delta-preview-strip"

interface Head {
  id: string
  invoice_code: string
  status: string
  subtotal: number
  vat: number
  total: number
  payment_terms: string | null
  due_date: string | null
  notes: string | null
  customer_id: string
  customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
}

interface SrcLine {
  id: string
  product_id: string
  quantity: number
  unit_name: string
  unit_price: number
  line_discount: number | null
  vat_rate: number | null
  line_total: number
  product?: { name?: string | null; sku?: string | null } | null
}

/** Phiếu thu đang gắn vào hóa đơn — spec §6 khối `ĐÃ THU`. */
interface Receipt {
  id: string
  amount: number
  method: string | null
  ref: string | null
}

let dem = 0
const newKey = () => `e${++dem}`

export function InvoiceEditScreen({ invoiceId }: { invoiceId: string }) {
  const { products, stockByProduct, warnings } = usePosRefData()
  const { toast } = useToast()
  const router = useRouter()
  const [dangLuu, setDangLuu] = useState(false)

  const [head, setHead] = useState<Head | null>(null)
  const [lines, setLines] = useState<PosLine[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [rets, setRets] = useState<InvoiceReturnRow[]>([])
  const [eInvoiceIssued, setEInvoiceIssued] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)

  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [vatRate, setVatRate] = useState(0)
  const [dieuKhoan, setDieuKhoan] = useState("COD")
  const [ghiChu, setGhiChu] = useState("")
  /* ⚠ Ngày của tờ MỚI — `reissue_invoice` nhận `invoice_date`, mặc định hôm nay. */
  const [thoiDiem, setThoiDiem] = useState(homNay)
  const [daNap, setDaNap] = useState(false)
  const [mocChuaLuu, setMocChuaLuu] = useState<string | null>(null)

  useEffect(() => {
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [h, l, r, e] = await Promise.all([
        sb.from("sales_invoices")
          .select("id, invoice_code, status, subtotal, vat, total, payment_terms, due_date, notes, customer_id, customer:customers(store_name, phone, address)")
          .eq("id", invoiceId).maybeSingle(),
        sb.from("sales_invoice_lines")
          .select("id, product_id, quantity, unit_name, unit_price, line_discount, vat_rate, line_total, product:products(name, sku)")
          .eq("invoice_id", invoiceId).order("sort_order", { ascending: true }),
        sb.from("returns")
          .select("id, status, credit_note_amount, credit_with_invoice")
          .eq("invoice_id", invoiceId),
        /**
         * ⚠ ĐỌC HÓA ĐƠN ĐIỆN TỬ ĐỂ BIẾT KHOÁ. `cancel_invoice` chặn khi
         *   `status='issued' OR misa_inv_no IS NOT NULL OR misa_status
         *   IN ('signed','replaced')` — đọc đúng bộ cột ấy để giao diện
         *   nói cùng một câu với máy chủ.
         */
        sb.from("invoices")
          .select("id, status, misa_inv_no, misa_status")
          .eq("sales_invoice_id", invoiceId)
          /* ⚠ `sales_invoice_id` KHÔNG UNIQUE — hai lượt phát hành chạy đua
             sinh hai dòng, và `.maybeSingle()` trên hai dòng là PGRST116 →
             màn báo "chưa có hoá đơn điện tử". Lấy tờ ĐÃ CÓ SỐ trước, rồi
             tờ mới nhất. */
          .order("misa_inv_no", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (huy) return
      const err = h.error || l.error || r.error
      if (err) setLoi(errorMessage(err))

      const hd = (h.data as unknown as Head) ?? null
      setHead(hd)
      if (hd?.customer) {
        setKhach({
          id: hd.customer_id,
          name: hd.customer.store_name || "Khách lẻ",
          meta: [hd.customer.phone, hd.customer.address].filter(Boolean).join(" · "),
        })
      }
      setDieuKhoan(hd?.payment_terms || "COD")
      setGhiChu(hd?.notes || "")

      const ds = (l.data as unknown as SrcLine[]) ?? []
      setLines(
        ds.map((x) => ({
          key: newKey(),
          productId: x.product_id,
          sku: x.product?.sku ?? "",
          name: x.product?.name ?? "Sản phẩm đã xoá",
          unit: x.unit_name,
          units: [{ unit_name: x.unit_name, conversion: 1 }],
          qty: Number(x.quantity) || 0,
          price: Number(x.unit_price) || 0,
          /* ⚠ GIẢM THEO DÒNG CỦA TỜ CŨ LÊN MÀN. Bản đầu để 0: mở tờ có
             giảm 50.000/dòng ra sửa, bấm lưu là tờ mới mất sạch giảm. */
          discount: { value: Number(x.line_discount) || 0, unit: "vnd" },
          stock: stockByProduct[x.product_id] ?? null,
          /* ⚠ SỐ CŨ ĐỂ GẠCH NGANG — spec §7.2. */
          prevAmount: Number(x.line_total) || 0,
        }))
      )
      /* Thuế suất của tờ cũ: mọi dòng cùng một suất thì lên ô chọn. */
      const suat = Array.from(new Set(ds.map((x) => Math.round((Number(x.vat_rate) || 0) * 100))))
      if (suat.length === 1) setVatRate(suat[0])
      setDaNap(true)
      setRets((r.data as unknown as InvoiceReturnRow[]) ?? [])
      const ei = e.data as unknown as { status?: string; misa_inv_no?: string | null; misa_status?: string | null } | null
      setEInvoiceIssued(
        !!ei &&
          (ei.status === "issued" ||
            !!ei.misa_inv_no ||
            ei.misa_status === "signed" ||
            ei.misa_status === "replaced")
      )
      setDangTai(false)
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  /**
   * Phiếu thu đang gắn.
   *
   * ⚠ ĐỌC RIÊNG VÀ ĐỌC HỎNG THÌ NÓI RA. Số này quyết định nút chính có
   * mờ hay không — đọc hỏng mà im là màn hình mời người dùng bấm vào
   * một lệnh máy chủ sẽ từ chối.
   */
  const [receiptErr, setReceiptErr] = useState<string | null>(null)
  useEffect(() => {
    let huy = false
    ;(async () => {
      const { data, error } = await createClient()
        .from("cash_receipt_lines")
        .select("id, amount, receipt:cash_receipts(id, status, method, receipt_code)")
        .eq("invoice_id", invoiceId)
      if (huy) return
      if (error) { setReceiptErr(errorMessage(error)); return }
      const rows = (data as unknown as Array<{
        id: string
        amount: number
        receipt?: { status?: string; method?: string | null; receipt_code?: string | null } | null
      }>) ?? []
      setReceipts(
        rows
          .filter((x) => x.receipt?.status !== "voided")
          .map((x) => ({
            id: x.id,
            amount: Number(x.amount) || 0,
            method: x.receipt?.method ?? null,
            ref: x.receipt?.receipt_code ?? null,
          }))
      )
    })()
    return () => { huy = true }
  }, [invoiceId])

  const daThu = receipts.reduce((s, r) => s + r.amount, 0)
  const returnCredit = creditOnInvoice(rets)

  const t = useMemo(
    () =>
      invoiceEditTotals({
        lines: lines.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount })),
        /* ⚠ Không có giảm cấp chứng từ / thu khác — `sales_invoices`
           không có cột, RPC không nhận. Xem đầu tệp. */
        docDiscount: { value: 0, unit: "vnd" },
        vatRate,
        other: 0,
        paid: daThu,
        returnCredit,
      }),
    [lines, vatRate, daThu, returnCredit]
  )

  usePosDocLabel("INV", invoiceId, head?.invoice_code ?? null)
  const chuKy = useMemo(
    () => JSON.stringify([lines.map((l) => [l.productId, l.unit, l.qty, l.price, l.discount]), vatRate, dieuKhoan, ghiChu, thoiDiem]),
    [lines, vatRate, dieuKhoan, ghiChu, thoiDiem]
  )
  useEffect(() => {
    if (daNap && mocChuaLuu === null) setMocChuaLuu(chuKy)
  }, [daNap, chuKy, mocChuaLuu])
  usePosDirty(chuKy, mocChuaLuu)

  /**
   * ⚠ KHOÁ TÍNH TỪ SỐ THẬT, KHÔNG TỪ PHỎNG ĐOÁN. Đọc phiếu thu hỏng
   *   thì coi như CÓ phiếu thu — chặn nhầm một tờ lập lại được còn hơn
   *   mời người dùng vào một lệnh máy chủ sẽ từ chối giữa chừng.
   */
  const khoa = reissueLock({
    paidAmount: daThu,
    receiptCount: receiptErr ? 1 : receipts.length,
    eInvoiceIssued,
  })

  const patchLine = useCallback((key: string, p: Partial<PosLine>) => {
    setLines((cu) => cu.map((l) => (l.key === key ? { ...l, ...p } : l)))
  }, [])

  const themHang = useCallback(
    (productId: string) => {
      const p = products.find((x) => x.id === productId)
      if (!p) return
      setLines((cu) => [
        ...cu,
        {
          key: newKey(),
          productId: p.id,
          sku: p.sku ?? "",
          name: p.name,
          unit: p.base_unit,
          units: (p.units ?? []).map((u) => ({
            unit_name: u.unit_name,
            conversion: Number(u.conversion) || 1,
          })),
          qty: 1,
          price: Number(p.sell_price) || 0,
          discount: { value: 0, unit: "vnd" },
          stock: stockByProduct[p.id] ?? null,
          /* ⚠ Dòng MỚI thêm thì không có số cũ — `prevAmount` để trống,
             không đặt 0. Đặt 0 là vẽ một số gạch ngang "0" gây hiểu
             nhầm là dòng ấy từng có trên tờ cũ. */
        },
      ])
    },
    [products, stockByProduct]
  )

  /* ⚠ Từ khoá thuộc về ô tìm dùng chung — màn chỉ ĐỌC để tự lọc. */
  const tuKhoa = usePosSearchTerm()

  usePosDocCount(lines.length)

  usePosKeys({
    F2: focusPosPicker,
    F3: focusPosPicker,
  })

  /**
   * ⚠ LỌC Ở ĐÂY, VÌ Ô TÌM DÙNG CHUNG KHÔNG TỰ LỌC — xem sổ đăng ký.
   *   Chặn 60 dòng: danh mục vài nghìn mã đổ hết vào dải gợi ý là trình
   *   duyệt khựng ở mỗi ký tự gõ vào.
   */
  const mucHang = useMemo(
    () => {
      const out: Array<{ id: string; title: string; subtitle: string; ton: number; gia: number }> = []
      for (const p of products) {
        if (!viMatchAllWords(tuKhoa, p.name, p.sku, p.barcode)) continue
        out.push({
          id: p.id,
          title: p.name,
          subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
          ton: stockByProduct[p.id] ?? 0,
          gia: Number(p.sell_price) || 0,
        })
        if (out.length >= 60) break
      }
      return out
    },
    [products, stockByProduct, tuKhoa]
  )

  /**
   * ⚠ GỢI Ý PHẢI HIỆN TỒN, VÀ HIỆN RÕ KHI HẾT HÀNG. Màn này sửa một tờ
   *   hóa đơn ĐÃ XUẤT: thêm một mã đang âm kho vào đây là dựng thêm một
   *   dòng xuất mà kho không có.
   */
  const veGoiY = useCallback(
    (p: { ton: number; gia: number }) => (
      <span className="shrink-0 text-right">
        <span className="n block text-[12.5px] font-bold text-[var(--pos-ink)]">
          {formatCurrency(p.gia)}
        </span>
        <span
          className={`n block text-[11px] font-semibold ${
            p.ton <= 0 ? "text-[var(--pos-danger)]" : "text-[var(--pos-muted)]"
          }`}
        >
          Tồn {p.ton.toLocaleString("vi-VN")}
        </span>
      </span>
    ),
    []
  )

  const chonHang = useCallback((it: { id: string }) => themHang(it.id), [themHang])

  useRegisterPosProductSearch({
    items: mucHang,
    onPick: chonHang,
    disabled: dangTai,
    placeholder: "Tên hàng, mã hàng, mã vạch…",
    renderMeta: veGoiY,
  })

  /** Công nợ khách + lô còn hàng. */
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

  useEffect(() => {
    const ids = lines.map((l) => l.productId).filter(Boolean)
    if (ids.length === 0) return
    let huy = false
    ;(async () => {
      const lo = await loadLotsByProduct(createClient(), ids).catch(() => ({}))
      if (!huy) setLines((cu) => attachLineExtras(cu, { lotsByProduct: lo }))
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length])

  /**
   * LẬP LẠI HÓA ĐƠN — đi qua `reissueInvoice`, tức RPC `reissue_invoice`.
   *
   * ⚠ MỘT LỜI GỌI, MỘT GIAO DỊCH. RPC ấy huỷ tờ cũ (hoàn hàng về đúng
   * lô đã lấy) rồi lập tờ mới mang số `-1`, trong cùng một hàm. Tách ra
   * làm hai lệnh từ trình duyệt là có lúc kho đã hoàn mà hóa đơn mới
   * chưa lập — và không ai gỡ được trạng thái đó.
   */
  const lapLai = useCallback(async () => {
    if (khoa) return
    setDangLuu(true)
    try {
      const r = await savePosInvoice(createClient(), {
        invoiceId,
        lines,
        paymentTerms: dieuKhoan,
        notes: ghiChu,
        /* ⚠ Ô thuế trên panel đẩy xuống TỪNG DÒNG — xem `posLinesToInvoice`. */
        vatRate: vatRate / 100,
      })
      setMocChuaLuu(chuKy)
      toast({
        title: `Đã lập lại — hóa đơn ${r.invoiceCode}`,
        description: invoiceWarnings(r) ?? undefined,
      })
      router.replace(`/pos/hoa-don/${r.invoiceId}`)
    } catch (e) {
      toast({ title: "Chưa lập lại được", description: errorMessage(e), variant: "destructive" })
    } finally {
      setDangLuu(false)
    }
  }, [khoa, invoiceId, lines, dieuKhoan, ghiChu, vatRate, chuKy, router, toast])

  /**
   * DẢI DELTA — ba ô của spec §7.2: `KHO` · `CÔNG NỢ` · `HĐĐT MISA`.
   *
   * ⚠ Ô KHO CẦN LÔ ĐÃ LẤY CỦA TỜ CŨ để nói "hoàn về +5, trừ lại −3,
   * ròng +2" — số ấy chưa đọc được nên để `đang tính…`. Ô CÔNG NỢ thì
   * nói được: tờ cũ còn nợ bao nhiêu, tờ mới còn nợ bao nhiêu.
   */
  const deltaCells = useMemo<DeltaCell[]>(() => {
    const noCu = Math.max(0, Number(head?.total || 0) - daThu - returnCredit)
    return [
      {
        label: "Kho",
        body:
          lines.length === 0 ? (
            <span className="text-[var(--pos-dim)]">không còn dòng hàng nào</span>
          ) : (
            /* ⚠ `net: null` → không vẽ phần ròng. Chưa biết lô đã lấy
               của tờ cũ thì không suy ra được chiều thật. */
            <DeltaStock sku={`${lines.length} dòng hàng`} net={null} />
          ),
      },
      {
        label: "Công nợ",
        body: head ? <DeltaMoney from={noCu} to={t.netDebt} verb="giảm" /> : null,
      },
      {
        label: "HĐĐT MISA",
        body: eInvoiceIssued ? (
          /* ⚠ ĐÃ PHÁT HÀNH THÌ KHÔNG PHẢI "CẦN ĐIỀU CHỈNH" — nó CHẶN
             hẳn việc lập lại (`LOCKED_EINVOICE`). Nói "cần điều chỉnh"
             là hứa một đường đi phần mềm không mở. */
          <span className="text-[var(--pos-danger)]">Đã phát hành — không lập lại được</span>
        ) : (
          <span>
            Chưa phát hành — <span className="text-[var(--pos-ok)]">không cần điều chỉnh</span>
          </span>
        ),
      },
    ]
  }, [lines.length, head, daThu, returnCredit, t.netDebt, eInvoiceIssued])

  const g = POS_GRID.invoiceEdit

  return (
    <>
      <DocSubHeader
        title="Sửa hóa đơn"
        code={head?.invoice_code ?? (dangTai ? "…" : null)}
        badge={{ label: "ĐANG SỬA", tone: "dang-sua" }}
        subtitle="NPP toàn quyền · mọi trường mở"
        right={<SubHeaderDate value={thoiDiem} onChange={setThoiDiem} label="Ngày tờ mới" />}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/* ⚠ `min-w-0 flex-1`, không cứng 1012px — xem `OrderScreen`. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}

          {/*
            ⚠ BANNER NÓI ĐÚNG CƠ CHẾ ĐANG CÓ (spec §7.2), và ba vế đều
              kiểm được: `reissue_invoice` huỷ tờ cũ rồi gọi
              `post_invoice` trong CÙNG một hàm — tức một giao dịch;
              `cancel_invoice` hoàn hàng về đúng lô đã lấy; và miếng vá
              `reissue_of` (mig 128, phục hồi ở mig 151) cho tờ mới
              mang số `-1`.
          */}
          <DocBanner tone="warn">
            Lưu thay đổi sẽ <strong>huỷ {head?.invoice_code || "hóa đơn này"} và lập một
            hóa đơn mới</strong> trong cùng một giao dịch. Kho hoàn về đúng lô đã lấy rồi
            mới trừ lại theo số mới — số hóa đơn mới là{" "}
            <span className="n">{head?.invoice_code || "HD-xxxx"}-1</span>.
          </DocBanner>

          {/*
            ⚠ KHOÁ PHẢI NÓI TRƯỚC KHI NGƯỜI DÙNG GÕ XONG CẢ TỜ. Để câu
              này xuống cạnh nút là họ sửa mười dòng rồi mới biết không
              lưu được.
          */}
          {khoa && (
            <DocBanner tone="warn">
              <strong>Chưa lập lại được.</strong> {khoa.message}{" "}
              <span className="n text-[11px] opacity-70">({khoa.code})</span>
            </DocBanner>
          )}

          <LineTableFrame
            header={
              <LineTableHeader
                grid="invoiceEdit"
                cells={[
                  { label: "#" }, { label: "Mã hàng" }, { label: "Tên hàng" },
                  { label: "ĐVT" }, { label: "Lô / HSD" },
                  { label: "Số lượng", align: "center" },
                  { label: "Đơn giá", align: "right" },
                  { label: "Giảm", align: "right" },
                  { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
          >
            {loi && (
              <p className="px-4 py-4 text-[13px] font-semibold text-[var(--pos-danger)]">
                Không tải được hóa đơn — {loi}
              </p>
            )}
            {!loi && dangTai && (
              <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">Đang tải…</p>
            )}
            {lines.map((l, i) => (
              <div
                key={l.key}
                className="grid min-h-[54px] items-center border-b border-[var(--pos-line-soft)] px-4 py-1.5"
                style={{ gridTemplateColumns: g.cols, gap: g.gap }}
              >
                <div className="n text-[11.5px] text-[var(--pos-dim)]">{i + 1}</div>
                <div className="n truncate text-[11px] text-[var(--pos-muted)]">{l.sku || "—"}</div>
                <div className="truncate text-[12.5px] font-semibold text-[var(--pos-ink)]">{l.name}</div>
                <select
                  aria-label={`Đơn vị tính dòng ${i + 1}`}
                  value={l.unit}
                  onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                  className="h-7 w-full rounded-md border border-[var(--pos-edge)] bg-white px-1 text-[11.5px]"
                >
                  {l.units.map((u) => (
                    <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>
                  ))}
                </select>
                <select
                  aria-label={`Lô hàng dòng ${i + 1}`}
                  value={l.lotId ?? ""}
                  onChange={(e) => patchLine(l.key, { lotId: e.target.value || null })}
                  className="h-7 w-full rounded-md border border-[var(--pos-edge)] bg-white px-1 text-[10.5px]"
                >
                  {/* ⚠ Chưa có danh sách lô — xem `docs/pos-todo.md` mục 4. */}
                  <option value="">chưa chọn lô</option>
                  {(l.lots ?? []).map((lo) => (
                    <option key={lo.id} value={lo.id}>
                      {lo.code}{lo.expiry ? ` · ${lo.expiry}` : ""}
                    </option>
                  ))}
                </select>
                <QtyStepper
                  compact
                  label={`số lượng dòng ${i + 1}`}
                  value={l.qty}
                  onChange={(v) => patchLine(l.key, { qty: v })}
                />
                <input
                  className="n h-7 w-full rounded-md border border-[var(--pos-edge)] px-1.5 text-right text-[12px]"
                  aria-label={`Đơn giá dòng ${i + 1}`}
                  inputMode="numeric"
                  value={l.price === 0 ? "0" : String(l.price)}
                  onChange={(e) => patchLine(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                />
                <DiscountCell line={l} index={i + 1} onChange={(d) => patchLine(l.key, { discount: d })} />
                <LineAmountCell line={l} />
                <LineMenu
                  index={i + 1}
                  onRemove={() => setLines((c) => c.filter((x) => x.key !== l.key))}
                />
              </div>
            ))}
            <div className="flex h-10 items-center gap-2 bg-[var(--pos-head)] px-4">
              <button
                type="button"
                onClick={focusPosPicker}
                className="h-7 rounded-md border border-[var(--pos-edge)] bg-white px-2.5 text-[11.5px] font-semibold text-[var(--pos-muted)]"
              >
                + Thêm hàng <span className="n opacity-70">F2</span>
              </button>
              <span className="text-[11px] text-[var(--pos-muted)]">
                {lines.length} dòng · {lines.reduce((s, l) => s + l.qty, 0)} sp
              </span>
            </div>
          </LineTableFrame>

          <DeltaPreviewStrip subtitle="Xem trước trước khi lập lại" cells={deltaCells} />
        </div>

        <div className="flex min-h-0 w-[420px] shrink-0 flex-col gap-3">
          {/* ⚠ Khách của tờ cũ đi theo tờ mới — RPC không nhận khách khác. */}
          <PartnerCard partner={khach} readOnly />

          <PosProductSearchBox />

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[var(--pos-line)] bg-white p-3.5">
            {/* ⚠ Số CŨ gạch ngang — spec §7.2. */}
            <MoneyRow label="Tiền hàng" value={t.goods} prev={head ? Number(head.subtotal) : null} />
            {t.lineDiscount > 0 && (
              <MoneyRow label="Giảm giá dòng" value={t.lineDiscount} tone="muted" />
            )}
            <div className="flex items-center gap-2 py-[5px]">
              <label htmlFor="e-vat" className="flex-grow text-[13px] text-[var(--pos-muted)]">Thuế GTGT</label>
              <select
                id="e-vat"
                value={vatRate}
                onChange={(e) => setVatRate(Number(e.target.value))}
                className="h-[30px] w-[74px] rounded-md border border-[var(--pos-edge)] bg-white px-1.5 text-[12.5px]"
              >
                {[0, 5, 8, 10].map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
              <span className="n w-[84px] text-right text-[13.5px] text-[var(--pos-ink)]">
                {formatCurrency(t.vat)}
              </span>
            </div>
            <TotalsHero label="Tổng cộng" value={t.total} />

            {/*
              ⚠ NHÃN NÀY KHÁC BẢN THIẾT KẾ, VÀ CỐ Ý. Artboard ghi "ĐÃ THU
                — GIỮ NGUYÊN QUA LẬP LẠI"; cơ chế thật thì tiền đã thu
                CHẶN hẳn việc lập lại (`LOCKED_HAS_PAYMENT`). Xem đầu tệp
                và `reissueLock`.
            */}
            {(receipts.length > 0 || receiptErr) && (
              <>
                <p className="mt-3.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-warn)]">
                  Đã thu — phải huỷ trước khi lập lại
                </p>
                {receiptErr && (
                  <p className="mt-1 text-[11.5px] font-semibold text-[var(--pos-danger)]">
                    Không đọc được phiếu thu — {receiptErr}. Màn hình đang coi như CÓ tiền thu
                    để khỏi mời bạn vào một lệnh máy chủ sẽ từ chối.
                  </p>
                )}
                {receipts.map((r) => (
                  <div key={r.id} className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--pos-line)] px-2.5 py-2">
                    <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-[var(--pos-ok-soft)]">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--pos-ok)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <rect x="2" y="6" width="20" height="13" rx="2" />
                        <path d="M2 10h20" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-grow">
                      <div className="truncate text-[12px] font-semibold text-[var(--pos-ink)]">
                        {r.method || "Phiếu thu"}
                      </div>
                      {r.ref && <div className="n truncate text-[10.5px] text-[var(--pos-muted)]">{r.ref}</div>}
                    </div>
                    <span className="n shrink-0 text-[12.5px] font-bold text-[var(--pos-ok)]">
                      {formatCurrency(r.amount)}
                    </span>
                    {/*
                      ⚠ NÚT GỠ CHƯA NỐI — huỷ một phiếu thu là ghi sổ
                        thật, và đợt này chỉ dựng bề mặt. Mờ nút KÈM lý
                        do còn hơn một nút bấm vào không có gì xảy ra.
                    */}
                    <button
                      type="button"
                      aria-label={`Gỡ phiếu thu ${r.ref || ""}`}
                      disabled
                      title="Huỷ phiếu thu ở màn Thu tiền — xem docs/pos-todo.md"
                      className="h-5 w-5 shrink-0 rounded text-[14px] leading-none text-[var(--pos-edge)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}

            <div className="mt-3.5 border-t border-[var(--pos-line-soft)] pt-3">
              <MoneyRow label="Còn lại hóa đơn" value={t.remaining} />
              {returnCredit > 0 && (
                <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(returnCredit)}`} tone="warn" />
              )}
              <div className="mt-1 border-t border-[var(--pos-line-soft)] pt-2">
                <MoneyRow label="Công nợ ròng" value={t.netDebt} strong />
              </div>
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-2.5 border-t border-[var(--pos-line-soft)] pt-3">
              <label htmlFor="e-dk" className="text-[13px] text-[var(--pos-muted)]">Điều khoản TT</label>
              <select
                id="e-dk"
                value={dieuKhoan}
                onChange={(e) => setDieuKhoan(e.target.value)}
                className="h-8 w-[150px] rounded-[7px] border border-[var(--pos-edge)] bg-white px-2 text-[12.5px]"
              >
                <option>COD</option>
                <option>Công nợ 15 ngày</option>
                <option>Công nợ 30 ngày</option>
              </select>
            </div>
            {/* ⚠ Hạn trả do máy chủ tính từ điều khoản — hiện, không mời sửa. */}
            <div className="mt-2 flex items-center justify-between gap-2.5">
              <span className="text-[13px] text-[var(--pos-muted)]">Hạn trả tờ cũ</span>
              <span className="n text-[12.5px] text-[var(--pos-muted)]">
                {head?.due_date ? formatDate(head.due_date) : "—"}
              </span>
            </div>
            <input
              type="text"
              aria-label="Ghi chú hóa đơn"
              placeholder="Ghi chú hóa đơn…"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              className="mt-2 h-8 w-full rounded-[7px] border border-[var(--pos-edge)] px-2 text-[12.5px] text-[var(--pos-muted)]"
            />

            <div className="flex-grow" />

            <p className="mt-3 text-[11px] leading-snug text-[var(--pos-muted)]">
              {head?.invoice_code || "Hóa đơn này"} sẽ chuyển trạng thái{" "}
              <strong className="text-[var(--pos-ink)]">Đã huỷ</strong> và giữ trong sổ để truy vết.
            </p>
          </div>

          <PanelActions>
            <PanelButton width={54} onClick={() => router.back()}>Huỷ</PanelButton>
            <PanelButton
              width={96}
              title="Mở trang in hóa đơn hiện tại"
              onClick={() => { const h = posPrintHref("INV", invoiceId); if (h) window.open(h, "_blank") }}
            >
              In
            </PanelButton>
            <PanelButton
              variant="primary"
              disabled={!!khoa || lines.length === 0 || dangLuu}
              onClick={lapLai}
              title={khoa ? khoa.message : lines.length === 0 ? "Hóa đơn không còn dòng hàng nào" : undefined}
            >
              {dangLuu ? "Đang lập lại…" : "Huỷ HĐ & lập lại"}
            </PanelButton>
          </PanelActions>
        </div>
      </div>
    </>
  )
}
