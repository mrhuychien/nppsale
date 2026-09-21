"use client"

/**
 * MÀN 11 — PHIẾU TRẢ NCC, và MÀN 12 — SỬA PHIẾU TRẢ NCC.
 *
 * ⚠ HAI RÀNG BUỘC RIÊNG CỦA PHÍA NÀY (spec §8):
 *
 *   · mục 4 — select lô CHỈ liệt kê lô thuộc PHIẾU NHẬP GỐC, không
 *     liệt kê toàn kho. Trả một lô không thuộc phiếu gốc là trả cho
 *     NCC món họ không bán cho mình.
 *   · mục 5 — cột `ĐÃ NHẬP`: stepper chặn vượt số đã nhập CÒN LẠI.
 *     Trả nhiều hơn số đã nhận là dựng ra hàng từ không khí.
 *
 * ⚠ BẢN THIẾT KẾ NÓI SAI MỘT CHỖ. Artboard 12 mượn câu của màn 8 —
 * "giữ nguyên số phiếu". Phía bán có `reissue_invoice` nên giữ được số;
 * phía mua chỉ có `cancel_supplier_return` + `complete_supplier_return`
 * RỜI NHAU, nên huỷ rồi lập lại là một phiếu MỚI mang số MỚI. Spec
 * §7.2 cho phép chỉnh câu chữ cho khớp hành vi thật.
 */

import { useCallback, useMemo, useState } from "react"
import { formatCurrency } from "@/lib/utils"
import { switchUnit, type DiscountInput } from "@/lib/pos/discount"
import {
  supplierReturnTotals, supplierReturnMax, supplierReturnCancelLock,
} from "@/lib/pos/purchase"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, DocBanner } from "@/components/pos/doc-sub-header"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell, LineAmountCell, LineMenu,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import { DeltaPreviewStrip, DeltaStock, type DeltaCell } from "@/components/pos/delta-preview-strip"

type HoanTien = "cong-no" | "tien-mat" | "chuyen-khoan"
const HOAN_LABEL: Record<HoanTien, string> = {
  "cong-no": "Trừ công nợ",
  "tien-mat": "Tiền mặt",
  "chuyen-khoan": "Chuyển khoản",
}

const LY_DO = [
  { id: "damaged", label: "Hàng hư hỏng" },
  { id: "wrong", label: "Giao sai hàng" },
  { id: "near_expiry", label: "Gần hết hạn" },
  { id: "over", label: "Giao thừa" },
  { id: "quality", label: "Không đạt chất lượng" },
]

export interface SupplierReturnScreenProps {
  mode: "lap" | "sua"
  slipCode?: string | null
  badge?: PosBadge | null
  /** Khoản giảm công nợ đã được cấn trừ — khoá `DA_CAN_TRU`. */
  creditOffset?: number
  /** Có lô đã lấy nay không còn mở — khoá `LO_DA_DONG`. */
  lotClosed?: boolean
}

let dem = 0
const newKey = () => `sr${++dem}`

export function SupplierReturnScreen({
  mode,
  slipCode,
  badge,
  creditOffset = 0,
  lotClosed = false,
}: SupplierReturnScreenProps) {
  const { products, loading, warnings } = usePosRefData()

  const [lines, setLines] = useState<PosLine[]>([])
  const [ncc, setNcc] = useState<PosPartner | null>(null)
  const [phi, setPhi] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [hoan, setHoan] = useState<HoanTien>("cong-no")
  const [lyDo, setLyDo] = useState("damaged")
  const [ghiChu, setGhiChu] = useState("")
  const [hdDieuChinh, setHdDieuChinh] = useState("")
  const [thoiDiem, setThoiDiem] = useState("")
  const [moTimHang, setMoTimHang] = useState(false)
  const [moTimNcc, setMoTimNcc] = useState(false)

  const t = useMemo(
    () =>
      supplierReturnTotals({
        lines: lines.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount })),
        fee: phi,
      }),
    [lines, phi]
  )

  const khoa = mode === "sua" ? supplierReturnCancelLock({ creditOffset, lotClosed }) : null
  const noConLai = ncc?.debt == null ? null : Math.max(0, ncc.debt - t.dueFromSupplier)

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
          units: [{ unit_name: p.base_unit, conversion: 1 }],
          qty: 1,
          price: 0,
          discount: { value: 0, unit: "vnd" },
          /**
           * ⚠ `lots` ĐỂ RỖNG, KHÔNG ĐỔ TOÀN KHO VÀO (spec §8 mục 4).
           * Lô hợp lệ là lô thuộc PHIẾU NHẬP GỐC; chưa nối được phiếu
           * gốc thì để rỗng và nói ra, chứ không mời người dùng chọn
           * một lô sai.
           */
          lots: [],
          /* ⚠ `ordered` ở màn này mang nghĩa SỐ ĐÃ NHẬP CÒN LẠI —
             `null` là chưa biết, và khi đó không chặn. */
          ordered: null,
        },
      ])
    },
    [products]
  )

  usePosKeys({
    F3: () => setMoTimHang(true),
    F4: () => setMoTimNcc(true),
    Escape: () => { setMoTimHang(false); setMoTimNcc(false) },
  })

  const mucHang = useMemo<SearchItem[]>(
    () =>
      products.map((p) => ({
        id: p.id,
        title: p.name,
        meta: `${p.sku ?? "—"} · ${p.base_unit}`,
        keywords: `${p.sku ?? ""} ${p.barcode ?? ""}`,
      })),
    [products]
  )

  const deltaCells = useMemo<DeltaCell[]>(
    () => [
      {
        label: "Kho bán",
        body:
          lines.length === 0 ? (
            <span className="text-[#94a3b8]">chưa có dòng hàng</span>
          ) : (
            <DeltaStock
              sku={`${lines.length} dòng`}
              net={-lines.reduce((s, l) => s + l.qty, 0)}
              unit="sp"
            />
          ),
      },
      { label: "Công nợ NCC", body: null },
      {
        label: "Giá vốn lô",
        body: <span className="text-[#64748b]">lô trả về đóng bớt, giá vốn lô không đổi</span>,
      },
    ],
    [lines]
  )

  const g = POS_GRID.supplierReturn

  return (
    <>
      <DocSubHeader
        title={mode === "sua" ? "Sửa phiếu trả NCC" : "Phiếu trả NCC"}
        code={slipCode}
        badge={badge ?? (mode === "lap" ? { label: "NHÁP", tone: "tam" } : { label: "ĐÃ XUẤT KHO", tone: "da-kho" })}
        right={<SubHeaderDate value={thoiDiem} onChange={setThoiDiem} label="Ngày trả" />}
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        <div className="flex min-h-0 w-[1012px] shrink-0 flex-col gap-3">
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}

          {/*
            ⚠ KHÔNG HỨA "GIỮ NGUYÊN SỐ PHIẾU". Phía bán có
              `reissue_invoice` nên giữ được số; phía mua chỉ có
              `cancel_supplier_return` + `complete_supplier_return` rời
              nhau. Xem đầu tệp.
          */}
          {mode === "sua" && (
            <DocBanner tone="warn">
              Phiếu đã xuất kho. Bên mua <strong>không có lệnh lập lại một bước</strong>: sửa
              phiếu là <strong>huỷ phiếu này rồi lập một phiếu mới</strong> — hai thao tác
              riêng, và phiếu mới mang số mới. Phiếu cũ giữ trong sổ để truy vết.
            </DocBanner>
          )}

          {khoa && (
            <DocBanner tone="warn">
              <strong>Chưa huỷ được phiếu này.</strong> {khoa.message}{" "}
              <span className="n text-[11px] opacity-70">({khoa.code})</span>
            </DocBanner>
          )}

          <LineTableFrame
            header={
              <LineTableHeader
                grid="supplierReturn"
                cells={[
                  { label: "#" }, { label: "Mã hàng" }, { label: "Tên hàng" },
                  { label: "Lô / HSD" },
                  { label: "Đã nhập", align: "center" },
                  { label: "SL trả", align: "center" },
                  { label: "Giá nhập", align: "right" },
                  { label: "Giảm", align: "right" },
                  { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
          >
            {lines.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-[#64748b]">
                  {loading ? "Đang tải danh mục hàng…" : "Chưa có mặt hàng nào trong phiếu."}
                </p>
                {!loading && (
                  <button
                    type="button"
                    onClick={() => setMoTimHang(true)}
                    className="mt-2 text-[13px] font-semibold text-[#2563eb]"
                  >
                    Thêm hàng <span className="n text-[11px] opacity-70">F3</span>
                  </button>
                )}
              </div>
            )}
            {lines.map((l, i) => {
              /** ⚠ Spec §8 mục 5 — trần đúng số đã nhập còn lại. */
              const tran = supplierReturnMax(l.ordered)
              const chamTran = tran != null && l.qty >= tran
              return (
                <div
                  key={l.key}
                  className="grid min-h-[54px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
                  style={{ gridTemplateColumns: g.cols, gap: g.gap }}
                >
                  <div className="n text-[11.5px] text-[#94a3b8]">{i + 1}</div>
                  <div className="n truncate text-[11px] text-[#64748b]">{l.sku || "—"}</div>
                  <div className="truncate text-[12.5px] font-semibold text-[#0f172a]">{l.name}</div>
                  {/*
                    ⚠ CHỈ LÔ CỦA PHIẾU NHẬP GỐC (spec §8 mục 4). Danh
                      sách lấy từ `l.lots`; chưa nối phiếu gốc thì nó
                      RỖNG và ô nói ra — không rơi về toàn kho.
                  */}
                  <select
                    aria-label={`Lô hàng dòng ${i + 1}`}
                    value={l.lotId ?? ""}
                    onChange={(e) => patchLine(l.key, { lotId: e.target.value || null })}
                    className="h-7 w-full rounded-md border border-[#cbd5e1] bg-white px-1 text-[10.5px]"
                  >
                    <option value="">
                      {(l.lots ?? []).length === 0 ? "chưa nối phiếu nhập gốc" : "chưa chọn lô"}
                    </option>
                    {(l.lots ?? []).map((lo) => (
                      <option key={lo.id} value={lo.id}>
                        {lo.code}{lo.expiry ? ` · ${lo.expiry}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="n text-center text-[12px] text-[#64748b]">
                    {/* ⚠ Chưa biết thì nói thế, đừng hiện 0 — 0 đọc như
                        "đã nhận hết rồi, không trả được gì". */}
                    {l.ordered == null ? <span className="text-[#94a3b8]">—</span> : l.ordered}
                  </div>
                  <div>
                    <QtyStepper
                      compact
                      label={`số lượng trả dòng ${i + 1}`}
                      value={l.qty}
                      onChange={(v) => patchLine(l.key, { qty: tran == null ? v : Math.min(tran, v) })}
                    />
                    {chamTran && (
                      <div className="mt-px text-center text-[9.5px] font-semibold text-[#b45309]">
                        đã chạm số đã nhập
                      </div>
                    )}
                  </div>
                  <input
                    className="n h-7 w-full rounded-md border border-[#cbd5e1] px-1.5 text-right text-[12px]"
                    aria-label={`Giá nhập dòng ${i + 1}`}
                    inputMode="numeric"
                    value={l.price === 0 ? "" : String(l.price)}
                    placeholder="0"
                    onChange={(e) => patchLine(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  />
                  <DiscountCell line={l} index={i + 1} onChange={(d) => patchLine(l.key, { discount: d })} />
                  <LineAmountCell line={l} />
                  <LineMenu index={i + 1} onRemove={() => setLines((c) => c.filter((x) => x.key !== l.key))} />
                </div>
              )
            })}
            {lines.length > 0 && (
              <div className="flex h-10 items-center gap-2 bg-[#f8fafc] px-4">
                <button
                  type="button"
                  onClick={() => setMoTimHang(true)}
                  className="h-7 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-[11.5px] font-semibold text-[#334155]"
                >
                  + Thêm hàng <span className="n opacity-70">F3</span>
                </button>
                <span className="text-[11px] text-[#64748b]">
                  {lines.length} dòng · {lines.reduce((s, l) => s + l.qty, 0)} sp
                </span>
              </div>
            )}
          </LineTableFrame>

          {mode === "sua" && (
            <DeltaPreviewStrip subtitle="Huỷ phiếu rồi lập phiếu mới" cells={deltaCells} />
          )}
        </div>

        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
          <div className="relative">
            <PartnerCard
              partner={ncc}
              label="nhà cung cấp"
              onPick={() => setMoTimNcc(true)}
              onClear={() => setNcc(null)}
            />
            <SearchDropdown
              open={moTimNcc}
              onClose={() => setMoTimNcc(false)}
              title="Tìm nhà cung cấp"
              placeholder="Tên NCC, mã, SĐT…"
              items={[]}
              onPick={(it) => setNcc({ id: it.id, name: it.title, meta: it.meta })}
              emptyHint="Chưa nạp được danh sách nhà cung cấp vào màn POS."
            />
          </div>

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-3.5">
            <MoneyRow label="Tổng tiền hàng trả" value={t.goods} />
            {/*
              ⚠ Ô NÀY TRỪ ĐI, ngược hẳn "Chi phí nhập khác" của màn 9.
                Cùng chữ "chi phí", hai chiều ngược nhau — dấu `−` là
                thứ duy nhất phân biệt.
            */}
            <DocDiscountRow
              id="sr-phi"
              label="Chi phí trả hàng"
              discount={phi}
              amount={t.fee}
              onChange={(d) => setPhi(d.unit === phi.unit ? d : switchUnit(phi, t.goods))}
            />
            <div className="flex items-center justify-between py-[5px] text-[11px] text-[#b45309]">
              <span />
              <span className="n">− {formatCurrency(t.fee)} trừ đi</span>
            </div>
            <MoneyRow label="Giảm giá dòng" value={t.lineDiscount} tone="muted" />

            <TotalsHero
              label="NCC cần hoàn"
              value={t.dueFromSupplier}
              tone="green"
              sub={
                hoan === "cong-no"
                  ? noConLai == null
                    ? "Trừ vào công nợ · nợ NCC còn chưa xác định"
                    : `Trừ vào công nợ · nợ NCC còn ${formatCurrency(noConLai)}`
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

            <label htmlFor="sr-lydo" className="mt-3.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Lý do trả NCC
            </label>
            <select
              id="sr-lydo"
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              className="mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px]"
            >
              {LY_DO.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>

            <input
              type="text"
              aria-label="Ghi chú phiếu trả NCC"
              placeholder="Ghi chú phiếu trả…"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              className="mt-2.5 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px] text-[#334155]"
            />

            {/* ⚠ Spec §8 mục 3 — ô riêng trên panel phiếu trả NCC. */}
            <label htmlFor="sr-hddc" className="mt-2.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              HĐ điều chỉnh NCC
            </label>
            <input
              id="sr-hddc"
              className="n mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px]"
              placeholder="Chưa có"
              value={hdDieuChinh}
              onChange={(e) => setHdDieuChinh(e.target.value)}
            />

            <div className="flex-grow" />
          </div>

          <PanelActions>
            <PanelButton width={54}>In</PanelButton>
            <PanelButton width={96}>{mode === "sua" ? "Huỷ" : "Lưu nháp"}</PanelButton>
            <PanelButton
              variant="primary"
              disabled={!!khoa || lines.length === 0}
              title={khoa ? khoa.message : lines.length === 0 ? "Chưa có dòng hàng nào trong phiếu" : undefined}
            >
              Ghi nhận &amp; xuất kho
            </PanelButton>
          </PanelActions>

          <div className="relative">
            <SearchDropdown
              open={moTimHang}
              onClose={() => setMoTimHang(false)}
              title="Tìm hàng trả NCC"
              placeholder="Tên hàng, mã hàng…"
              items={mucHang}
              onPick={(it) => themHang(it.id)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
          </div>
        </div>
      </div>
    </>
  )
}
