"use client"

/**
 * PHẦN DÙNG CHUNG CỦA HAI BIỂU MẪU MUA HÀNG — phiếu nhập hàng và phiếu
 * trả NCC: ô tìm hàng, bảng chín cột, khối tổng tiền, thanh dính đáy,
 * modal chi tiết mặt hàng.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "hãy làm phiếu trả NCC tương tự". Hai
 * chứng từ này là hai chiều của cùng một việc với cùng một NCC, nên
 * chúng phải có cùng bộ ô và cùng phép tính. Giữ hai bản là chỗ để một
 * bên được sửa còn bên kia thì không — đúng chuyện đã xảy ra: phiếu
 * nhập có ghi chú dòng, giảm giá, tiền thuế gõ tay; phiếu trả không có
 * gì trong ba thứ đó.
 *
 * ⚠ PHẦN ĐẦU PHIẾU KHÔNG DÙNG CHUNG. Phiếu nhập cần Số hoá đơn đầu vào
 * và Kho đích; phiếu trả cần Lý do trả và Kho nguồn. Ép chung một khối
 * là dựng một component nhận mười cờ bật/tắt — khó đọc hơn hai khối
 * riêng. Nên phần đầu do từng màn tự vẽ và truyền vào qua `header`.
 *
 * ⚠ TIỀN Ở ĐÂY CHỈ ĐỂ XEM TRƯỚC. Máy chủ tính lại từ dòng hàng và ghi
 * số của NÓ vào công nợ NCC — `complete_purchase_invoice` (mig 145) và
 * `complete_supplier_return` (mig 146).
 */

import { useMemo, useRef, useState } from "react"
import { Info, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MoneyInput } from "@/components/ui/money-input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatInt } from "@/lib/utils"
import { ProductPicker, PICKER_PEEK } from "@/components/ui/product-picker"
import {
  inSupplierScope, linesOutOfSupplierScope, scopeToSupplier, searchReturnProducts,
} from "@/lib/purchasing/return-form"
import type { PickerExtra } from "@/lib/purchasing/picker-extras"
import {
  lineFromProduct, lineTotalOf, receiptTotals, unitCostOf, unitPatch,
  lineDiscountAmountOf,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"

/**
 * ⚠ `PickerExtra` ĐỊNH NGHĨA Ở `picker-extras.ts`, cạnh đúng hàm đọc ra
 * nó. Xuất lại ở đây để bốn màn chỉ phải nhớ một đường nhập.
 */
export type { PickerExtra }

/**
 * Bấm vào ô số là CHỌN HẾT nội dung, để gõ là thay luôn.
 *
 * ⚠ CHỦ NHÀ BÁO: "ô số lượng bấm vào để gõ thì tự xoá trắng (hiện tại
 * cứ phải xoá số 0 đi)". Ô số điền sẵn một giá trị — giá vốn, hay số 0
 * mà trình duyệt tự đặt lại — thì mỗi lần sửa là một lần phải bôi đen
 * hoặc bấm Backspace vài cái. Với người nhập cả phiếu ba mươi dòng đó
 * là ba mươi lần thừa.
 *
 * ⚠ DÙNG `onFocus` CHỨ KHÔNG `onClick`. Bàn phím Tab qua ô cũng phải
 * chọn hết — người nhập liệu hàng loạt không rời tay khỏi bàn phím.
 */
const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select()


export interface PurchasingLinesValue {
  /** Giảm giá đầu phiếu — trừ SAU thuế. */
  discount: string
  /**
   * Tiền thuế GTGT gõ tay theo giấy của NCC.
   *
   * ⚠ Ô TRỐNG KHÁC SỐ 0. Trống nghĩa là "để máy tự cộng từ thuế suất
   * từng dòng"; số 0 nghĩa là "chứng từ này KHÔNG có thuế".
   */
  vatOverride: string
  lines: ReceiptLine[]
}

export function PurchasingLinesEditor({
  products,
  value,
  onChange,
  submitting,
  actions,
  extras = {},
  supplierId,
  header,
  linesTitle,
  totalLabel,
}: {
  products: ReceiptProduct[]
  value: PurchasingLinesValue
  onChange: (patch: Partial<PurchasingLinesValue>) => void
  submitting: boolean
  actions: React.ReactNode
  extras?: Record<string, PickerExtra>
  /**
   * NCC đang chọn ở đầu phiếu — ô tìm chỉ gợi ý hàng của NCC này.
   *
   * ⚠ CHƯA CHỌN THÌ KHÔNG LỌC. Xem `inSupplierScope`.
   */
  supplierId: string | null
  /** Khối "Thông tin chung" do từng màn tự vẽ. */
  header: React.ReactNode
  /** "Chi tiết hàng nhập" hay "Chi tiết hàng trả". */
  linesTitle: string
  /** "Cần trả NCC" hay "NCC hoàn lại". */
  totalLabel: string
}) {
  const [term, setTerm] = useState("")
  /**
   * Tạm bỏ lọc theo NCC — đường thoát cho lúc mã bị gán nhầm NCC.
   *
   * ⚠ NHỚ THEO NCC NÀO, KHÔNG NHỚ BẰNG MỘT CỜ BẬT/TẮT. Bỏ lọc cho NCC A
   *   rồi đổi sang NCC B mà cờ còn bật là lọc đã tắt lúc nào không hay —
   *   đúng lúc người dùng tin rằng nó đang bật.
   */
  const [showAllFor, setShowAllFor] = useState<string | null>(null)
  const showAll = showAllFor !== null && showAllFor === supplierId
  const setShowAll = (on: boolean) => setShowAllFor(on ? supplierId : null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const seqRef = useRef(0)

  const totals = useMemo(
    () => receiptTotals(value.lines, value.discount, value.vatOverride),
    [value.lines, value.discount, value.vatOverride]
  )

  const onSlip = useMemo(
    () => new Set(value.lines.map((l) => l.product_id).filter(Boolean)),
    [value.lines]
  )
  /**
   * ⚠ THU VỀ NCC TRƯỚC, TÌM SAU. Tìm trước rồi mới lọc là ô tìm cắt ở
   *   12 kết quả đầu — nếu cả 12 đều của NCC khác thì người dùng nhận
   *   một danh sách RỖNG trong khi mặt hàng họ cần đứng thứ 13.
   */
  const scoped = useMemo(
    () => (showAll ? products : scopeToSupplier(products, supplierId)),
    [products, supplierId, showAll]
  )
  const hits = useMemo(
    () => searchReturnProducts(scoped, term, onSlip, PICKER_PEEK),
    [scoped, term, onSlip]
  )
  /**
   * ⚠ ẨN BAO NHIÊU THÌ NÓI BẤY NHIÊU. Lọc im lặng là người nhập gõ đúng
   *   tên hàng, ô tìm trả về rỗng, và họ không có cách nào đoán ra vì
   *   sao — tưởng danh mục thiếu mã, rồi đi tạo mã trùng.
   */
  const hiddenCount = useMemo(() => {
    /* ⚠ CHỈ ĐẾM KHI ĐÃ GÕ. Từ 20/09/2026 ô trống cũng xổ danh sách, nên
       không chặn ở đây là lúc vừa bấm vào ô đã hiện "còn N mã thuộc NCC
       khác" — một câu cảnh báo cho một phép tìm chưa xảy ra. */
    if (showAll || !supplierId || term.trim() === "") return 0
    const other = products.filter((p) => !inSupplierScope(p, supplierId))
    return searchReturnProducts(other, term, onSlip, 200).length
  }, [products, supplierId, term, onSlip, showAll])

  /**
   * ⚠ ĐỔI NCC SAU KHI ĐÃ THÊM HÀNG là cửa sau của phép lọc ô tìm. Bảng
   *   hàng không có cột NCC nên không ai thấy — phải nói ra ở đây.
   */
  const lacDong = useMemo(
    () => linesOutOfSupplierScope(value.lines, products, supplierId),
    [value.lines, products, supplierId]
  )

  const setLines = (fn: (a: ReceiptLine[]) => ReceiptLine[]) => onChange({ lines: fn(value.lines) })
  const patchLine = (id: string, patch: Partial<ReceiptLine>) =>
    setLines((a) => a.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const addProduct = (p: ReceiptProduct) => {
    seqRef.current += 1
    setLines((a) => [...a, lineFromProduct(p, seqRef.current)])
    setTerm("")
  }

  const toggleDiscountMode = (l: ReceiptLine) =>
    patchLine(l.id, {
      discount_mode: l.discount_mode === "percent" ? "amount" : "percent",
      line_discount: "",
    })

  const pickUnit = (l: ReceiptLine, unitName: string) => patchLine(l.id, unitPatch(l, unitName))

  const detail = value.lines.find((l) => l.id === detailId) ?? null

  return (
    <>
      {header}

      {/* ---------------- Tìm hàng để thêm ---------------- */}
      {/*
        ⚠ BẤM VÀO LÀ XỔ DANH SÁCH (chủ nhà chốt 20/09/2026). Dùng chung
          `ProductPicker` với phiếu nhập kho và phiếu xuất kho — bốn màn
          một ô tìm, không phải bốn bản vẽ tay.
      */}
      <Card>
        <CardContent className="pt-5">
          <ProductPicker
            id="pr-find"
            term={term}
            onTermChange={setTerm}
            disabled={products.length === 0 || submitting}
            items={hits.map((p) => ({
              ...p,
              title: p.name,
              subtitle: [
                p.sku || "—",
                p.base_unit,
                /* ⚠ NCC HIỆN Ở ĐÂY để người nhập biết mình có đang chọn
                   nhầm hàng của NCC khác không — một phiếu nhập trộn hai
                   NCC là công nợ ghi sai chỗ. Trống là CHƯA GÁN, nói ra
                   chứ không để người dùng đoán. */
                p.primary_supplier_id == null
                  ? "chưa gán NCC"
                  : extras[p.id]?.supplierName ?? "",
              ].filter(Boolean).join(" · "),
            }))}
            onPick={(p) => addProduct(p)}
            renderMeta={(p) => {
              const x = extras[p.id]
              return (
                <span className="shrink-0 text-right text-xs">
                  <span className="block text-muted-foreground">Tồn</span>
                  {/* ⚠ CHƯA ĐỌC ĐƯỢC THÌ NÓI LÀ CHƯA BIẾT. */}
                  <span className="block font-semibold tabular-nums">
                    {x && x.onHand !== null ? formatInt(x.onHand) : "…"}
                  </span>
                </span>
              )
            }}
            hint={
              <>
                {/*
                  ⚠ NÓI RÕ ĐANG LỌC, VÀ CHO ĐƯỜNG THOÁT. Cột
                    `products.primary_supplier_id` được backfill từ phiếu
                    nhập gần nhất (migration 030), nên một mã nhập từ NCC
                    mới sẽ còn mang tên NCC cũ cho tới lần nhập kế. Không
                    có nút này thì người nhập kẹt cứng: mã có thật, gõ
                    đúng tên, mà ô tìm một mực nói không có.
                */}
                {term.trim() !== "" && hiddenCount > 0 && !showAll && (
                  <p className="text-xs text-muted-foreground">
                    Đang chỉ hiện hàng của NCC đã chọn — còn {hiddenCount} mã khớp thuộc NCC khác.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="font-medium text-primary underline"
                    >
                      Hiện tất cả
                    </button>
                  </p>
                )}
                {showAll && supplierId && (
                  <p className="text-xs text-[#7a4b00]">
                    Đang hiện hàng của MỌI NCC. Thêm nhầm hàng của NCC khác là công nợ ghi sai chỗ.{" "}
                    <button
                      type="button"
                      onClick={() => setShowAll(false)}
                      className="font-medium text-primary underline"
                    >
                      Lọc lại theo NCC
                    </button>
                  </p>
                )}
              </>
            }
          />
        </CardContent>
      </Card>

      {/* ---------------- Bảng hàng ---------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {linesTitle} {value.lines.length > 0 && `(${value.lines.length} dòng)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:px-6 sm:pb-6">
          {/*
            ⚠ VÀNG, KHÔNG ĐỎ. Đây là chuyện đáng ngó lại, không phải lỗi
              cứng: mã vừa đổi NCC còn treo tên NCC cũ tới lần nhập kế.
              Đỏ ở đây là dạy người dùng bỏ qua màu đỏ.
          */}
          {lacDong.length > 0 && (
            <div className="mx-3 mb-3 rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-[#7a4b00] sm:mx-0">
              <span className="font-semibold">
                {lacDong.length} dòng trên phiếu thuộc NCC khác:
              </span>{" "}
              {lacDong.map((l) => l.product_name).join(" · ")}.{" "}
              Một phiếu trộn hai NCC là công nợ ghi sai chỗ — bỏ những dòng này ra, hoặc
              đổi lại NCC ở đầu phiếu.
            </div>
          )}
          {value.lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Phiếu chưa có mặt hàng nào. Tìm ở ô trên rồi bấm Thêm.
            </p>
          ) : (
            <>
              {/*
                ⚠ BẢNG CHÍN CỘT KHÔNG VỪA MÀN 375px. Trên điện thoại vẽ
                  danh sách thẻ; bảng chỉ hiện từ lg trở lên. Ép cả chín
                  cột vào màn hẹp là người dùng cuộn ngang để gõ một ô số
                  lượng.
              */}
              <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-10 px-2 py-2 text-left">STT</th>
                      <th className="w-28 px-2 py-2 text-left">Mã hàng</th>
                      <th className="px-2 py-2 text-left">Tên hàng</th>
                      <th className="w-40 px-2 py-2 text-left">Ghi chú</th>
                      <th className="w-28 px-2 py-2 text-left">ĐVT</th>
                      <th className="w-24 px-2 py-2 text-right">Số lượng</th>
                      <th className="w-32 px-2 py-2 text-right">Đơn giá</th>
                      <th className="w-28 px-2 py-2 text-right">Giảm giá</th>
                      <th className="w-32 px-2 py-2 text-right">Thành tiền</th>
                      <th className="w-10 px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {value.lines.map((l, i) => (
                      <tr key={l.id} className="border-t align-top">
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-2 font-mono text-xs">{l.sku || "—"}</td>
                        <td className="px-2 py-2">
                          {/* ⚠ TÊN HÀNG LÀ CỬA VÀO MODAL CHI TIẾT (chủ nhà
                              chốt). Bảng chính giữ đúng chín cột; mọi thứ
                              khác — hệ số quy đổi, VAT, giá vốn quy đổi —
                              nằm sau cú bấm này. */}
                          <button
                            type="button"
                            onClick={() => setDetailId(l.id)}
                            className="flex items-start gap-1 text-left font-medium hover:text-primary hover:underline"
                          >
                            <span className="min-w-0">{l.product_name}</span>
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={l.note}
                            onChange={(e) => patchLine(l.id, { note: e.target.value })}
                            placeholder="—"
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-2">
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
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="number" step="any" min={0} value={l.quantity}
                            onFocus={selectOnFocus}
                            onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                            className="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput
                            value={l.unit_price}
                            onChange={(v) => patchLine(l.id, { unit_price: String(v) })}
                            onFocus={selectOnFocus}
                            showSuffix={false}
                            inputClassName="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2">
                          {/* ⚠ NÚT ĐỔI ĐƠN VỊ NẰM NGAY TRONG Ô (chủ nhà
                              chốt: "bấm vào sẽ ra lựa chọn giảm giá theo
                              giá trị và giảm giá theo phần trăm"). Để nó
                              thành một ô chọn riêng là thêm một cột nữa
                              vào bảng chín cột đã chật. */}
                          <div className="flex items-center gap-1">
                            <Input
                              type="number" step="any" min={0}
                              max={l.discount_mode === "percent" ? 100 : undefined}
                              value={l.line_discount}
                              onFocus={selectOnFocus}
                              onChange={(e) => patchLine(l.id, { line_discount: e.target.value })}
                              className="h-9 text-right tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() => toggleDiscountMode(l)}
                              title={l.discount_mode === "percent" ? "Đang giảm theo %. Bấm để đổi sang số tiền." : "Đang giảm theo số tiền. Bấm để đổi sang %."}
                              className="h-9 w-8 shrink-0 rounded-md border text-sm font-bold text-muted-foreground hover:bg-muted"
                            >
                              {l.discount_mode === "percent" ? "%" : "đ"}
                            </button>
                          </div>
                          {/* ⚠ Ở CHẾ ĐỘ %, HIỆN LUÔN SỐ TIỀN QUY RA. Con
                              số ghi xuống sổ là tiền, không phải phần
                              trăm — không hiện ra thì người dùng không
                              đối chiếu được với hoá đơn giấy. */}
                          {l.discount_mode === "percent" && Number(l.line_discount) > 0 && (
                            <div className="mt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
                              = {formatCurrency(lineDiscountAmountOf(l))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(lineTotalOf(l))}
                        </td>
                        <td className="px-1 py-2">
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                            title="Bỏ dòng này khỏi phiếu"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bản điện thoại — cùng đủ chín ô, xếp dọc. */}
              <div className="space-y-3 px-3 pb-3 lg:hidden">
                {value.lines.map((l, i) => (
                  <div key={l.id} className="rounded-xl border p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailId(l.id)}
                        className="flex min-w-0 items-start gap-1 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs text-muted-foreground">
                            {i + 1}. {l.sku || "—"}
                          </span>
                          <span className="block text-sm font-semibold">{l.product_name}</span>
                        </span>
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive"
                        onClick={() => setLines((a) => a.filter((x) => x.id !== l.id))}
                        title="Bỏ dòng này khỏi phiếu"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Ghi chú</Label>
                        <Input
                          value={l.note}
                          onChange={(e) => patchLine(l.id, { note: e.target.value })}
                          placeholder="—" className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
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
                      <div className="space-y-1">
                        <Label className="text-xs">Số lượng</Label>
                        <Input
                          type="number" step="any" min={0} value={l.quantity}
                          onFocus={selectOnFocus}
                          onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                          className="h-9 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Đơn giá</Label>
                        <MoneyInput
                          value={l.unit_price}
                          onChange={(v) => patchLine(l.id, { unit_price: String(v) })}
                          onFocus={selectOnFocus}
                          showSuffix={false}
                          inputClassName="h-9 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          Giảm giá
                          {l.discount_mode === "percent" && Number(l.line_discount) > 0 && (
                            <span className="ml-1 font-normal text-muted-foreground">
                              = {formatCurrency(lineDiscountAmountOf(l))}
                            </span>
                          )}
                        </Label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" step="any" min={0}
                            max={l.discount_mode === "percent" ? 100 : undefined}
                            value={l.line_discount}
                            onFocus={selectOnFocus}
                            onChange={(e) => patchLine(l.id, { line_discount: e.target.value })}
                            className="h-9 text-right tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => toggleDiscountMode(l)}
                            title={l.discount_mode === "percent" ? "Đang giảm theo %. Bấm để đổi sang số tiền." : "Đang giảm theo số tiền. Bấm để đổi sang %."}
                            className="h-9 w-9 shrink-0 rounded-md border text-sm font-bold text-muted-foreground"
                          >
                            {l.discount_mode === "percent" ? "%" : "đ"}
                          </button>
                        </div>
                      </div>
                      <div className="col-span-2 text-right text-sm">
                        Thành tiền:{" "}
                        <span className="font-semibold tabular-nums">{formatCurrency(lineTotalOf(l))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Tổng tiền ---------------- */}
      <div className="ml-auto grid w-full max-w-sm gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="pr-discount" className="text-xs uppercase tracking-wider text-muted-foreground">
            Giảm giá cả phiếu
          </Label>
          <MoneyInput
            value={value.discount}
            onChange={(v) => onChange({ discount: String(v) })}
            onFocus={selectOnFocus}
            showSuffix={false}
            className="w-40"
            inputClassName="h-9 text-right tabular-nums"
            id="pr-discount"
          />
        </div>
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tiền hàng</dt>
            <dd className="tabular-nums">{formatCurrency(totals.subtotal)}</dd>
          </div>
          {/*
            ⚠ TIỀN THUẾ GÕ TAY ĐƯỢC (chủ nhà báo 20/09/2026: "Tiền thuế
              GTGT chưa nhập được?"). Hoá đơn giấy của NCC ghi một dòng
              "Tiền thuế GTGT" và người nhập phải gõ lại ĐÚNG con số đó
              — nếu không, công nợ trên máy lệch với tờ giấy hai bên
              cùng ký, và mỗi lần đối chiếu là một lần cãi nhau về vài
              nghìn đồng làm tròn.

            ⚠ ĐỂ TRỐNG THÌ MÁY TỰ CỘNG. Không bắt gõ cho phiếu bình
              thường; chỉ ai cần khớp tờ giấy mới phải đụng vào.
          */}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="pr-vat-total" className="text-muted-foreground">Thuế GTGT</Label>
            <MoneyInput
              id="pr-vat-total"
              value={value.vatOverride}
              onChange={(v) => onChange({ vatOverride: String(v) })}
              onFocus={selectOnFocus}
              showSuffix={false}
              className="w-40"
              inputClassName="h-9 text-right tabular-nums"
              placeholder={String(Math.round(totals.vatComputed))}
            />
          </div>
          {/* ⚠ LỆCH VỚI SỐ TỰ CỘNG THÌ NÓI RA. Gõ đè một con số cách xa
              tổng thuế suất của các dòng thường là gõ nhầm ô — im lặng
              ở đây là để một phiếu sai đi thẳng vào công nợ. */}
          {totals.vatOverridden && Math.abs(totals.vat - totals.vatComputed) > 1 && (
            <p className="text-right text-[11px] text-[#7a4b00]">
              Tự cộng từ dòng hàng là {formatCurrency(totals.vatComputed)} — đang dùng số gõ tay.
            </p>
          )}
          {/* ⚠ GIẢM GIÁ TRỪ SAU THUẾ (chủ nhà chốt 20/09/2026). Hiện nó
              thành một dòng riêng, dưới dòng thuế, để thứ tự trên màn
              đúng bằng thứ tự trong phép tính. */}
          {totals.discount > 0 && (
            <div className="flex justify-between text-[#b54708]">
              <dt>Giảm giá cả phiếu</dt>
              <dd className="tabular-nums">−{formatCurrency(totals.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-extrabold">
            <dt>{totalLabel}</dt>
            <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
          </div>
        </dl>
      </div>

      {/* Thanh hành động dính đáy — đúng khuôn màn đặt hàng. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:pl-[var(--sidebar-w,0px)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{value.lines.length} dòng · {totalLabel}</div>
            <div className="truncate text-lg font-bold tabular-nums">{formatCurrency(totals.total)}</div>
          </div>
          {actions}
        </div>
      </div>

      {/* ---------------- Modal chi tiết mặt hàng ---------------- */}
      {/*
        ⚠ MODAL GIỮ NHỮNG THỨ KHÔNG VÀO ĐƯỢC CHÍN CỘT (chủ nhà chốt:
          "thông tin sản phẩm hiển thị đơn giản, cần nhiều thông tin hơn
          thì bấm vào ra modal"). Thuế suất nằm ở đây chứ không ở bảng:
          nó gần như luôn là giá trị mặc định của mặt hàng, và cho nó
          một cột riêng là bắt chín cột kia hẹp lại vì một ô ít ai sửa.
      */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{detail.product_name}</DialogTitle>
              </DialogHeader>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Mã hàng</dt>
                  <dd className="font-mono">{detail.sku || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Đơn vị cơ sở</dt>
                  <dd>{detail.base_unit}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Đang nhập theo</dt>
                  <dd>
                    {detail.unit_name}
                    {Number(detail.conversion_factor) > 1 && (
                      <span className="text-muted-foreground">
                        {" "}(×{detail.conversion_factor} {detail.base_unit})
                      </span>
                    )}
                  </dd>
                </div>
                {/* ⚠ GIÁ VỐN QUY VỀ ĐƠN VỊ CƠ SỞ — đúng con số sẽ ghi vào
                    `batches.unit_cost`. Người nhập gõ giá một thùng, còn
                    kho và mọi báo cáo lãi lỗ đọc giá một hộp; không hiện
                    ra đây thì không ai đối chiếu được. */}
                <div className="flex justify-between gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">Giá vốn / {detail.base_unit}</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatCurrency(unitCostOf(detail))}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1">
                <Label htmlFor="pr-vat" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Thuế GTGT (%)
                </Label>
                <Input
                  id="pr-vat" type="number" step="any" min={0} max={100}
                  value={detail.vat_percent}
                  onFocus={selectOnFocus}
                  onChange={(e) => patchLine(detail.id, { vat_percent: e.target.value })}
                  className="h-9 text-right tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-lnote" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ghi chú dòng
                </Label>
                <Textarea
                  id="pr-lnote" rows={2} value={detail.note}
                  onChange={(e) => patchLine(detail.id, { note: e.target.value })}
                  placeholder="Ví dụ: lô cận date, nhận bù đợt trước"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
