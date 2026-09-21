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

import { useCallback, useMemo, useState } from "react"
import { formatCurrency } from "@/lib/utils"
import { lineGross, switchUnit, type DiscountInput } from "@/lib/pos/discount"
import { returnTotals, debtAfterReturn, warehouseSentence } from "@/lib/pos/return-totals"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, DocBanner } from "@/components/pos/doc-sub-header"
import { LineTableFrame, QtyStepper } from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
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

const LY_DO = [
  { id: "damaged", label: "Hàng hư hỏng" },
  { id: "wrong", label: "Sai hàng" },
  { id: "near_expiry", label: "Gần hết hạn" },
  { id: "expired", label: "Hết hạn sử dụng" },
  { id: "refused", label: "Khách từ chối nhận" },
]

export interface ReturnScreenProps {
  /** `lap` = phiếu mới / còn nháp. `sua` = phiếu ĐÃ nhập kho, mở ra sửa. */
  mode: "lap" | "sua"
  slipCode?: string | null
  badge?: PosBadge | null
}

/** Lưới hai bảng — spec §4 hàng "Trả hàng (3, 8)". */
const GRID_TRA = "24px 84px minmax(0,1fr) 108px 96px 104px 110px 24px"
const GRID_DOI = "24px 84px minmax(0,1fr) 96px 104px 120px 24px"

let dem = 0
const newKey = () => `r${++dem}`

export function ReturnScreen({ mode, slipCode, badge }: ReturnScreenProps) {
  const { products, customers, stockByProduct, loading, warnings } = usePosRefData()

  const [traLines, setTraLines] = useState<PosLine[]>([])
  const [doiLines, setDoiLines] = useState<PosLine[]>([])
  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [phi, setPhi] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [hoan, setHoan] = useState<HoanTien>("cong-no")
  const [lyDo, setLyDo] = useState("damaged")
  const [ghiChu, setGhiChu] = useState("")
  const [thoiDiem, setThoiDiem] = useState("")
  const [moTimTra, setMoTimTra] = useState(false)
  const [moTimDoi, setMoTimDoi] = useState(false)
  const [moTimKhach, setMoTimKhach] = useState(false)
  const [moChonHD, setMoChonHD] = useState(false)

  const tatCaDong = useMemo(
    () => [
      ...traLines.map((l) => ({ qty: l.qty, price: l.price, isExchange: false })),
      ...doiLines.map((l) => ({ qty: l.qty, price: l.price, isExchange: true })),
    ],
    [traLines, doiLines]
  )

  const t = useMemo(() => returnTotals({ lines: tatCaDong, fee: phi }), [tatCaDong, phi])
  const noConLai = debtAfterReturn(khach?.debt, t.dueToCustomer)
  const cauKho = warehouseSentence(t)

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
        units: [{ unit_name: p.base_unit, conversion: 1 }],
        qty: 1,
        price: Number(p.sell_price) || 0,
        discount: { value: 0, unit: "vnd" },
        isExchange: doi,
        stock: stockByProduct[p.id] ?? null,
      }
      if (doi) setDoiLines((c) => [...c, moi])
      else setTraLines((c) => [...c, moi])
    },
    [products, stockByProduct]
  )

  /**
   * ⚠ `F7` LÀ THÊM HÀNG ĐỔI Ở MÀN PHIẾU TRẢ ĐỘC LẬP (spec §10). `F8`
   * dành cho hàng trả KÈM trong đơn/hóa đơn — ở màn này ô hàng trả là
   * bảng chính nên nó nhận `F3`.
   */
  usePosKeys({
    F3: () => setMoTimTra(true),
    F4: () => setMoTimKhach(true),
    F7: () => setMoTimDoi(true),
    Escape: () => { setMoTimTra(false); setMoTimDoi(false); setMoTimKhach(false); setMoChonHD(false) },
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
            <span className="n text-[12.5px] font-semibold text-[#0f172a]">
              {formatCurrency(Number(p.sell_price) || 0)}
            </span>
          ),
        }
      }),
    [products, stockByProduct]
  )

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
      if (ds.length === 0) return <span className="text-[#94a3b8]">không đổi</span>
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
      { label: "Kho hàng lỗi", body: oKho(traLines, 1, "sp") },
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
  }, [traLines, doiLines, khach, noConLai])

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
          className="grid h-[34px] shrink-0 items-center border-b border-[#e2e8f0] bg-[#f8fafc] px-4 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#64748b]"
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
          <p className="px-4 py-6 text-center text-[12.5px] text-[#64748b]">
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
              className="grid min-h-[52px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
              style={{ gridTemplateColumns: g, gap: 8 }}
            >
              <div className="n text-[11.5px] text-[#94a3b8]">{i + 1}</div>
              <div className="n truncate text-[11px] text-[#64748b]">{l.sku || "—"}</div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium leading-tight text-[#0f172a]">
                  {l.name}
                </div>
                <div className="mt-px truncate text-[11px] text-[#64748b]">
                  {l.stock == null ? (
                    <span className="text-[#94a3b8]">tồn chưa xác định</span>
                  ) : (
                    `Tồn ${l.stock.toLocaleString("vi-VN")}`
                  )}
                  {doi ? " · xuất từ Kho bán" : " · nhập vào Kho hàng lỗi"}
                </div>
              </div>
              {!doi && (
                <select
                  aria-label={`Lô hàng trả dòng ${i + 1}`}
                  value={l.lotId ?? ""}
                  onChange={(e) => patch(l.key, { lotId: e.target.value || null })}
                  className="h-7 w-full rounded-md border border-[#cbd5e1] bg-white px-1 text-[11px] text-[#0f172a]"
                >
                  {/* ⚠ Chưa có danh sách lô — xem `docs/pos-todo.md` mục 4. */}
                  <option value="">chưa chọn lô</option>
                  {(l.lots ?? []).map((lo) => (
                    <option key={lo.id} value={lo.id}>
                      {lo.code}{lo.expiry ? ` · ${lo.expiry}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <QtyStepper
                compact
                label={`số lượng ${doi ? "đổi" : "trả"} dòng ${i + 1}`}
                value={l.qty}
                onChange={(v) => patch(l.key, { qty: v })}
              />
              <input
                className="n h-7 w-full rounded-md border border-[#cbd5e1] px-1.5 text-right text-[12px] text-[#0f172a]"
                aria-label={`Đơn giá dòng ${i + 1}`}
                inputMode="numeric"
                value={l.price === 0 ? "0" : String(l.price)}
                onChange={(e) => patch(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
              />
              <div className="text-right">
                {doi ? (
                  <>
                    {/*
                      ⚠ SỐ GẠCH NGANG + CHỮ "không trừ tiền". Ẩn hẳn số
                        đi thì người lập phiếu không biết món ấy đáng bao
                        nhiêu; để số trần thì họ tưởng nó đang được trừ.
                    */}
                    <div className="n text-[12.5px] text-[#94a3b8] line-through">
                      {formatCurrency(tien)}
                    </div>
                    <div className="text-[9.5px] font-semibold text-[#2563eb]">không trừ tiền</div>
                  </>
                ) : (
                  <div className="n text-[13px] font-bold text-[#b45309]">{formatCurrency(tien)}</div>
                )}
              </div>
              <button
                type="button"
                aria-label={`Xoá dòng ${doi ? "đổi" : "trả"} ${i + 1}`}
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                className="flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[#f1f5f9]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" aria-hidden>
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
          mode === "lap" ? (
            <button
              type="button"
              onClick={() => setMoChonHD(true)}
              className="font-semibold text-[#2563eb] underline"
            >
              Chọn hóa đơn gốc
            </button>
          ) : undefined
        }
        right={<SubHeaderDate value={thoiDiem} onChange={setThoiDiem} />}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        <div className="flex min-h-0 w-[1012px] shrink-0 flex-col gap-3">
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}

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
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-[#e2e8f0] bg-white px-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#92400e]">
                  Hàng trả về
                </span>
                <span className="text-[11px] text-[#64748b]">
                  {t.returnLineCount} dòng · {t.returnQty} sp
                </span>
                <div className="flex-grow" />
                <button
                  type="button"
                  onClick={() => setMoTimTra(true)}
                  className="h-7 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-[11.5px] font-semibold text-[#334155]"
                >
                  + Hàng trả <span className="n opacity-70">F3</span>
                </button>
              </div>
            }
          >
            {bang(traLines, setTraLines, false)}

            <div className="flex h-[38px] items-center gap-2 border-y border-[#e2e8f0] bg-[#f8fafc] px-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#1d4ed8]">
                Hàng đổi
              </span>
              <span className="text-[11px] text-[#64748b]">
                {t.exchangeLineCount} dòng · {t.exchangeQty} sp · không trừ tiền
              </span>
              <div className="flex-grow" />
              <button
                type="button"
                onClick={() => setMoTimDoi(true)}
                className="h-7 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-[11.5px] font-semibold text-[#334155]"
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

        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
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

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-3.5">
            {/* ⚠ "Giá gốc hàng mua" CHỈ ĐỂ ĐỐI CHIẾU, không vào phép cộng —
                xem `return-totals.ts`. Chưa nối được hóa đơn gốc nên để
                trống chứ không điền 0. */}
            <MoneyRow label="Giá gốc hàng mua" value="chưa xác định" tone="muted" />
            <MoneyRow label="Tổng tiền hàng trả" value={t.goodsReturned} />
            <DocDiscountRow
              id="pos-phi-tra"
              label="Phí trả hàng"
              discount={phi}
              amount={t.fee}
              onChange={(d) =>
                setPhi(d.unit === phi.unit ? d : switchUnit(phi, t.goodsReturned))
              }
            />
            <div className="flex items-center justify-between py-[5px]">
              <span className="text-[13px] text-[#334155]">Giá trị hàng đổi</span>
              <span className="text-right">
                <span className="mr-2 text-[10px] font-semibold text-[#2563eb]">không trừ tiền</span>
                <span className="n text-[13.5px] text-[#94a3b8]">
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

            <p className="mt-3.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
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
                      ? "border-[#2563eb] bg-[#eff6ff] font-semibold text-[#1d4ed8]"
                      : "border-[#cbd5e1] bg-white font-medium text-[#334155]"
                  }`}
                >
                  {HOAN_LABEL[h]}
                </button>
              ))}
            </div>

            <label htmlFor="pos-lydo" className="mt-3.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Lý do trả hàng
            </label>
            <select
              id="pos-lydo"
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              className="mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px] text-[#0f172a]"
            >
              {LY_DO.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            <label htmlFor="pos-ghichu" className="mt-2.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Ghi chú
            </label>
            <input
              id="pos-ghichu"
              type="text"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              placeholder="VD: hàng móp thùng khi giao, khách báo lúc nhận…"
              className="mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px] text-[#334155]"
            />

            <div className="flex-grow" />

            {/*
              ⚠ BOX CẢNH BÁO NÓI ĐÚNG HAI CHIỀU KHO, và chỉ hiện khi có
                gì để nói. Phiếu rỗng mà vẫn hứa một giao dịch là nói dối
                — xem `warehouseSentence`.
            */}
            {cauKho && (
              <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden>
                  <path d="M12 8v5M12 17h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <span className="text-[11.5px] leading-snug text-[#92400e]">{cauKho}</span>
              </div>
            )}

            {mode === "sua" && (
              <p className="mt-2 text-[11px] leading-snug text-[#64748b]">
                Số phiếu {slipCode || "này"} giữ nguyên. Bản ghi cũ vào nhật ký kèm người sửa
                và thời điểm.
              </p>
            )}
          </div>

          <PanelActions>
            <PanelButton width={54}>In</PanelButton>
            <PanelButton width={96}>{mode === "sua" ? "Huỷ" : "Lưu nháp"}</PanelButton>
            <PanelButton
              variant="primary"
              disabled={t.returnLineCount === 0 && t.exchangeLineCount === 0}
              title={
                t.returnLineCount === 0 && t.exchangeLineCount === 0
                  ? "Chưa có dòng hàng nào trong phiếu"
                  : undefined
              }
            >
              Ghi nhận &amp; nhập kho
            </PanelButton>
          </PanelActions>

          {/* Neo cho hai dropdown thêm hàng. */}
          <div className="relative">
            <SearchDropdown
              open={moTimTra}
              onClose={() => setMoTimTra(false)}
              title="Tìm hàng trả"
              placeholder="Tìm hàng trong hóa đơn gốc…"
              items={mucHang}
              onPick={(it) => themDong(it.id, false)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
            <SearchDropdown
              open={moTimDoi}
              onClose={() => setMoTimDoi(false)}
              title="Thêm hàng đổi"
              placeholder="Thêm hàng đổi từ kho bán…"
              items={mucHang}
              onPick={(it) => themDong(it.id, true)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
          </div>
        </div>
      </div>

      <SourceInvoiceModal
        open={moChonHD}
        onClose={() => setMoChonHD(false)}
        customerId={khach?.id ?? null}
        onPick={() => setMoChonHD(false)}
      />
    </>
  )
}
