"use client"

/**
 * LẬP PHIẾU TRẢ HÀNG CỦA KHÁCH TRÊN ĐIỆN THOẠI — cùng kiểu màn bán hàng /sell.
 *
 * Chủ nhà 07/10/2026: "Phiếu trả hàng tạo trên mobile chưa có giao diện như sell mobile". Màn cũ là biểu mẫu máy tính
 * thu nhỏ (ô chọn, bảng). Nay hai bước như /sell và phiếu nhập NCC (`PhieuNccMobile`):
 *   1. THÊM HÀNG — thẻ sản phẩm của /sell (`ProductCard`, không hiện tồn), chọn quy cách trên thẻ, chọn từng mã / chọn
 *      nhiều (`pick-mode`, loại "tra"), hàng trên hoá đơn gắn kèm hiện trước, thanh đáy "Xem phiếu".
 *   2. PHIẾU — khách, hoá đơn liên quan, lý do, (nhân viên), dòng hàng: ĐVT, giá trả, Trả tiền / Đổi hàng, số lượng;
 *      ghi chú; thanh đáy "Trừ công nợ khách" + Lưu phiếu.
 * Dữ liệu, trần giá và cách lưu vẫn ở trang `/returns/new` — đây chỉ là phần vẽ.
 */
import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ListChecks, Plus, Search, X } from "lucide-react"
import { ProductCard } from "@/components/sell/product-card"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { CompactSelect } from "@/components/ui/compact-select"
import { MoneyInput } from "@/components/ui/money-input"
import { Skeleton } from "@/components/ui/skeleton"
import { chamTheHang, docChonNhieu, ghiChonNhieu, roiManSauKhiThem } from "@/lib/sell/pick-mode"
import { sellableUnits, unitPriceFor, type PricedProduct } from "@/lib/sell/pricing"
import { RETURN_REASONS, findReturnLine, type ReturnCartLine } from "@/lib/sell/returns"
import { timXepHang, viMatchAllWords } from "@/lib/search"
import { cn, formatCurrency, formatDate } from "@/lib/utils"

const RENDER_CAP = 60

export interface KhachTra {
  id: string
  store_name: string
  owner_name?: string | null
  phone?: string | null
}
export interface HoaDonTra {
  id: string
  invoice_code: string
  invoice_date: string
  total: number
}
export interface DongHoaDonTra {
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
}

export interface PhieuTraKhachMobileProps {
  loading: boolean
  loadError: string | null
  customers: KhachTra[]
  customerId: string
  onCustomer: (id: string) => void
  /** Có quyền tạo nhanh khách → mở khung tạo với chữ đã gõ. */
  onTaoKhach?: (chu: string) => void
  products: PricedProduct[]
  groupId: string | null
  invoices: HoaDonTra[]
  invoiceId: string
  onInvoice: (id: string) => void
  invoiceLines: DongHoaDonTra[]
  reason: string
  onReason: (v: string) => void
  notes: string
  onNotes: (v: string) => void
  /** null = không được chọn nhân viên (chỉ Chủ NPP / Quản lý). */
  sellers: Array<{ value: string; label: string }> | null
  sellerId: string
  onSeller: (id: string) => void
  lines: ReturnCartLine[]
  onLines: (fn: (prev: ReturnCartLine[]) => ReturnCartLine[]) => void
  /** Trần giá của một dòng (giá đã bán trên HĐ gắn kèm, không thì giá bảng) + dòng có vượt trần không. */
  tranGia: (l: ReturnCartLine) => { ceiling: number; sold: boolean; bad: boolean }
  /** Giá trả gợi ý khi thêm / đổi ĐVT: giá đã bán trên HĐ gắn kèm, không thì giá bảng của nhóm khách. */
  giaGoiY: (productId: string, unit: string) => number
  credit: number
  blocked: string | null
  saving: boolean
  onSave: () => void
  onBack: () => void
  /** Có quyền tạo nhanh sản phẩm. */
  onTaoSp?: (chu: string) => void
}

export function PhieuTraKhachMobile(p: PhieuTraKhachMobileProps) {
  const [buoc, setBuoc] = useState<"hang" | "phieu">("hang")
  const [q, setQ] = useState("")
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})
  const [chonNhieu, setChonNhieu] = useState(false)
  const [moKhach, setMoKhach] = useState(false)
  useEffect(() => setChonNhieu(docChonNhieu("tra")), [])

  /* ⚠ Back của điện thoại ở bước Phiếu → về bước Thêm hàng, không rời màn (như /sell, PhieuNccMobile). */
  useEffect(() => {
    const onPop = () => setBuoc("hang")
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const moPhieu = () => {
    if (buoc === "phieu") return
    window.history.pushState({ phieuTra: 1 }, "")
    setBuoc("phieu")
    window.scrollTo(0, 0)
  }
  const veThemHang = () => {
    if (window.history.state?.phieuTra) window.history.back()
    else setBuoc("hang")
  }

  const byId = useMemo(() => new Map(p.products.map((x) => [x.id, x])), [p.products])
  const khach = p.customers.find((c) => c.id === p.customerId) ?? null
  const danhSach = useMemo(
    () => timXepHang(p.products, q, (x) => [x.sku, x.barcode, x.name], { nho: "hang" }).ketQua.slice(0, RENDER_CAP),
    [p.products, q]
  )
  const qtyOf = (productId: string, unit: string) => {
    const i = findReturnLine(p.lines, productId, unit)
    return i < 0 ? 0 : p.lines[i].qty
  }
  const unitOf = (x: PricedProduct) => unitSel[x.id] ?? x.base_unit

  const buoc1 = (x: PricedProduct, unit: string, d: number) => {
    const dongMoi = qtyOf(x.id, unit) === 0
    p.onLines((prev) => {
      const i = findReturnLine(prev, x.id, unit)
      if (i < 0) {
        if (d <= 0) return prev
        return [
          { productId: x.id, unit, qty: d, price: p.giaGoiY(x.id, unit), vatRate: Number(x.vat_rate ?? 0), isExchange: false, note: "" },
          ...prev,
        ]
      }
      const sl = prev[i].qty + d
      return sl <= 0 ? prev.filter((_, k) => k !== i) : prev.map((l, k) => (k === i ? { ...l, qty: sl } : l))
    })
    if (roiManSauKhiThem({ chonNhieu, delta: d, dongMoi })) moPhieu()
  }
  const chonQuyCach = (productId: string, unit: string) => {
    setUnitSel((s) => ({ ...s, [productId]: unit }))
    const x = byId.get(productId)
    if (!x) return
    const kq = chamTheHang({ chonNhieu, daCo: qtyOf(productId, unit) > 0, laQuyCach: true })
    if (kq.them) buoc1(x, unit, 1)
    else if (kq.sangPhieu) moPhieu()
  }

  const soDong = p.lines.length
  const soDv = p.lines.reduce((s, l) => s + l.qty, 0)

  if (buoc === "hang") {
    return (
      <div className="-mx-4 -mt-4 min-h-screen bg-surface-container-low pb-28" data-testid="buoc-them-hang-tra">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-surface-container-lowest px-2 py-2">
          <button type="button" aria-label="Quay lại" onClick={p.onBack} className="grid h-10 w-10 place-items-center">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="flex-1 text-[17px] font-bold">Trả hàng</h1>
          <button
            type="button"
            data-testid="chon-nhieu"
            aria-pressed={chonNhieu}
            onClick={() => {
              ghiChonNhieu(!chonNhieu, "tra")
              setChonNhieu(!chonNhieu)
            }}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold",
              chonNhieu ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            )}
          >
            <ListChecks className="h-4 w-4" /> Chọn nhiều
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <NutKhach khach={khach} onClick={() => setMoKhach(true)} />

          {p.loadError && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">Không tải được danh mục: {p.loadError}</p>
          )}

          {p.invoiceLines.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="hang-tren-hoa-don">
              <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">Hàng trên hoá đơn gắn kèm</p>
              {p.invoiceLines.map((l) => {
                const sp = byId.get(l.product_id)
                const co = qtyOf(l.product_id, l.unit_name)
                return (
                  <button
                    key={`${l.product_id}|${l.unit_name}`}
                    type="button"
                    onClick={() => sp && buoc1(sp, l.unit_name, 1)}
                    className={cn(
                      "flex items-center gap-3 rounded-[14px] border-[1.5px] bg-surface-container-lowest p-3 text-left",
                      co > 0 ? "border-primary" : "border-transparent"
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[14px] font-semibold">{sp?.name ?? "—"}</span>
                      <span className="text-[12px] text-muted-foreground">
                        Đã bán {l.quantity} {l.unit_name} · {formatCurrency(Number(l.unit_price) || 0)} / {l.unit_name}
                      </span>
                    </span>
                    {co > 0 ? (
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-bold text-primary">Trả {co}</span>
                    ) : (
                      <Plus className="h-5 w-5 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm tên hàng, mã, mã vạch…"
              aria-label="Tìm hàng trả"
              className="h-11 w-full rounded-xl border border-border bg-surface-container-lowest pl-9 pr-3 text-[15px] outline-none focus:border-primary"
            />
          </div>

          {p.loading ? (
            <Skeleton className="h-64" />
          ) : danhSach.length === 0 ? (
            <div className="rounded-xl bg-surface-container-lowest p-6 text-center text-sm text-muted-foreground">
              Không tìm thấy mặt hàng nào khớp.
              {p.onTaoSp && q.trim() && (
                <button type="button" onClick={() => p.onTaoSp?.(q.trim())} className="mt-2 block w-full font-semibold text-primary">
                  + Tạo sản phẩm “{q.trim()}”
                </button>
              )}
            </div>
          ) : (
            danhSach.map((x) => {
              const u = unitOf(x)
              return (
                <ProductCard
                  key={x.id}
                  product={x}
                  baseOnHand={0}
                  showStock={false}
                  addLabel="Trả"
                  groupId={p.groupId}
                  unit={u}
                  qty={qtyOf(x.id, u)}
                  onPickUnit={chonQuyCach}
                  onStep={(sp, unit, d) => buoc1(sp, unit, d)}
                />
              )
            })
          )}
        </div>

        <SellBottomBar>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-muted-foreground">{soDong} mặt hàng · {soDv} đơn vị</p>
              <p className="text-[17px] font-bold tabular-data">{formatCurrency(p.credit)}</p>
            </div>
            <button
              type="button"
              onClick={moPhieu}
              className="flex h-12 items-center gap-1 rounded-xl bg-primary px-5 text-[15px] font-bold text-primary-foreground"
            >
              Xem phiếu <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </SellBottomBar>

        <ChonKhachSheet
          open={moKhach}
          onClose={() => setMoKhach(false)}
          customers={p.customers}
          onPick={(id) => {
            p.onCustomer(id)
            setMoKhach(false)
          }}
          onTao={p.onTaoKhach}
        />
      </div>
    )
  }

  /* ---------------------------------------------------------------- BƯỚC PHIẾU */
  return (
    <div className="-mx-4 -mt-4 min-h-screen bg-surface-container-low pb-36" data-testid="buoc-phieu-tra">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-surface-container-lowest px-2 py-2">
        <button type="button" aria-label="Về thêm hàng" onClick={veThemHang} className="grid h-10 w-10 place-items-center">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[17px] font-bold">Phiếu trả hàng</h1>
        <button type="button" onClick={veThemHang} className="flex h-9 items-center gap-1 rounded-full border border-primary px-3 text-[13px] font-semibold text-primary">
          <Plus className="h-4 w-4" /> Thêm hàng
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <NutKhach khach={khach} onClick={() => setMoKhach(true)} />

        <div className="flex flex-col gap-3 rounded-[14px] bg-surface-container-lowest p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Hoá đơn liên quan</span>
            <CompactSelect
              ariaLabel="Hoá đơn liên quan"
              value={p.invoiceId}
              onChange={p.onInvoice}
              emptyLabel={p.customerId ? "Không gắn hoá đơn nào" : "Chọn khách trước"}
              disabled={!p.customerId}
              options={p.invoices.map((o) => ({ value: o.id, label: `${o.invoice_code} · ${formatDate(o.invoice_date)} · ${formatCurrency(o.total)}` }))}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Lý do trả *</span>
            <div role="group" aria-label="Lý do trả" className="flex flex-wrap gap-1.5">
              {RETURN_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={p.reason === r.value}
                  onClick={() => p.onReason(r.value)}
                  className={cn(
                    "h-9 rounded-full border px-3 text-[13px] font-semibold",
                    p.reason === r.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {p.sellers && (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Tính cho nhân viên</span>
              <CompactSelect
                ariaLabel="Tính cho nhân viên"
                value={p.sellerId}
                onChange={p.onSeller}
                emptyLabel="Theo hoá đơn gốc / người lập"
                options={p.sellers}
              />
            </label>
          )}
        </div>

        {/* ---------- DÒNG HÀNG ---------- */}
        <div className="flex flex-col rounded-[14px] bg-surface-container-lowest">
          {p.lines.length === 0 ? (
            <p className="p-7 text-center text-sm text-muted-foreground">Chưa có hàng trả. Bấm “Thêm hàng” để chọn.</p>
          ) : (
            p.lines.map((l, i) => (
              <DongTra
                key={`${l.productId}|${l.unit}`}
                stt={i + 1}
                line={l}
                product={byId.get(l.productId)}
                tran={p.tranGia(l)}
                onPatch={(patch) => p.onLines((prev) => prev.map((x, k) => (k === i ? { ...x, ...patch } : x)))}
                onUnit={(u) =>
                  p.onLines((prev) => {
                    if (u === l.unit) return prev
                    const trung = findReturnLine(prev, l.productId, u)
                    if (trung >= 0) {
                      /* Đã có dòng cùng (hàng, ĐVT) → gộp số lượng vào dòng đó. */
                      return prev
                        .map((x, k) => (k === trung ? { ...x, qty: x.qty + l.qty } : x))
                        .filter((_, k) => k !== i)
                    }
                    return prev.map((x, k) => (k === i ? { ...x, unit: u, price: p.giaGoiY(l.productId, u) } : x))
                  })
                }
                onRemove={() => p.onLines((prev) => prev.filter((_, k) => k !== i))}
              />
            ))
          )}
          {p.lines.some((l) => l.isExchange) && (
            <p className="px-3 pb-3 text-[12px] text-muted-foreground">Dòng đổi hàng không trừ tiền.</p>
          )}
        </div>

        <label className="flex flex-col gap-1 rounded-[14px] bg-surface-container-lowest p-3">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Ghi chú</span>
          <textarea
            value={p.notes}
            onChange={(e) => p.onNotes(e.target.value)}
            rows={2}
            placeholder="VD: hàng móp thùng khi giao, khách báo lúc nhận…"
            className="rounded-[10px] border border-border bg-surface-container-lowest px-3 py-2 text-[14px] outline-none focus:border-primary"
          />
        </label>
      </div>

      <SellBottomBar>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-muted-foreground">Trừ công nợ khách</span>
            <span data-testid="tien-tra-khach" className="text-[19px] font-black tabular-data">{formatCurrency(p.credit)}</span>
          </div>
          {p.blocked && <p className="text-[12px] font-semibold text-[#b54708]">{p.blocked}</p>}
          <button
            type="button"
            onClick={p.onSave}
            disabled={!!p.blocked || p.saving}
            className="h-12 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {p.saving ? "Đang lưu…" : "Lưu phiếu trả"}
          </button>
        </div>
      </SellBottomBar>

      <ChonKhachSheet
        open={moKhach}
        onClose={() => setMoKhach(false)}
        customers={p.customers}
        onPick={(id) => {
          p.onCustomer(id)
          setMoKhach(false)
        }}
        onTao={p.onTaoKhach}
      />
    </div>
  )
}

function NutKhach({ khach, onClick }: { khach: KhachTra | null; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="chon-khach-tra"
      onClick={onClick}
      className="flex items-center gap-3 rounded-[14px] bg-surface-container-lowest p-3 text-left"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Khách hàng *</span>
        {khach ? (
          <span className="truncate text-[15px] font-bold">{khach.store_name}</span>
        ) : (
          <span className="text-[15px] font-semibold text-primary">Chọn khách trả hàng</span>
        )}
        {khach && (khach.owner_name || khach.phone) && (
          <span className="truncate text-[12px] text-muted-foreground">{[khach.owner_name, khach.phone].filter(Boolean).join(" · ")}</span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </button>
  )
}

function ChonKhachSheet({
  open, onClose, customers, onPick, onTao,
}: {
  open: boolean
  onClose: () => void
  customers: KhachTra[]
  onPick: (id: string) => void
  onTao?: (chu: string) => void
}) {
  const [q, setQ] = useState("")
  const ds = useMemo(
    () => customers.filter((c) => viMatchAllWords(q, c.store_name, c.owner_name, c.phone)).slice(0, RENDER_CAP),
    [customers, q]
  )
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-3 rounded-t-2xl p-4">
        <p className="text-[16px] font-bold">Chọn khách hàng</p>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tên cửa hàng, tên chủ, số điện thoại…"
          aria-label="Tìm khách hàng"
          className="h-11 rounded-xl border border-border px-3 text-[15px] outline-none focus:border-primary"
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {ds.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c.id)} className="flex flex-col border-b border-border/60 py-2.5 text-left">
              <span className="text-[14px] font-semibold">{c.store_name}</span>
              {(c.owner_name || c.phone) && (
                <span className="text-[12px] text-muted-foreground">{[c.owner_name, c.phone].filter(Boolean).join(" · ")}</span>
              )}
            </button>
          ))}
          {ds.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy khách nào khớp.</p>}
        </div>
        {onTao && (
          <button type="button" onClick={() => { onTao(q.trim()); onClose() }} className="h-11 rounded-xl border border-primary font-semibold text-primary">
            + Tạo khách mới{q.trim() ? ` “${q.trim()}”` : ""}
          </button>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DongTra({
  stt, line, product, tran, onPatch, onUnit, onRemove,
}: {
  stt: number
  line: ReturnCartLine
  product: PricedProduct | undefined
  tran: { ceiling: number; sold: boolean; bad: boolean }
  onPatch: (p: Partial<ReturnCartLine>) => void
  onUnit: (u: string) => void
  onRemove: () => void
}) {
  const ten = product?.name ?? "—"
  const dvs = product ? sellableUnits(product) : [line.unit]
  const tien = Math.round(line.qty * line.price * (1 + (line.vatRate || 0)))
  return (
    <div data-testid="dong-tra-khach" className="flex flex-col gap-2.5 border-b border-border/60 p-3">
      <div className="flex items-start gap-2">
        <span data-testid="stt-dong" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-container-low text-[12px] font-bold text-muted-foreground">
          {stt}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] font-semibold leading-[1.35]">{ten}</span>
          <span className="text-[12px] text-muted-foreground">
            {product?.sku ?? "—"}
            {tran.ceiling > 0 && ` · ${tran.sold ? "giá đã bán" : "giá bảng"} ${formatCurrency(tran.ceiling)}`}
          </span>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Xoá ${ten}`} className="-mr-1 -mt-1 grid h-8 w-8 place-items-center text-muted-foreground">
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      {dvs.length > 1 && (
        <div role="group" aria-label={`Đơn vị tính ${ten}`} className="flex flex-wrap gap-1.5">
          {dvs.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={u === line.unit}
              onClick={() => onUnit(u)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-semibold",
                u === line.unit ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              {u}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div role="group" aria-label={`Loại dòng ${ten}`} className="flex rounded-[10px] bg-surface-container-low p-[3px]">
          {[
            { v: false, t: "Trả tiền" },
            { v: true, t: "Đổi hàng" },
          ].map((o) => (
            <button
              key={o.t}
              type="button"
              aria-pressed={line.isExchange === o.v}
              onClick={() => onPatch({ isExchange: o.v })}
              className={cn(
                "h-8 rounded-lg px-3 text-[13px]",
                line.isExchange === o.v ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted-foreground"
              )}
            >
              {o.t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="w-32">
          <MoneyInput
            aria-label={`Giá trả ${ten}`}
            value={Math.round(line.price)}
            onChange={(n) => onPatch({ price: Math.max(0, n) })}
            inputClassName={cn("h-9 text-right", tran.bad && "border-destructive")}
          />
        </div>
      </div>
      {tran.bad && <p className="text-[12px] font-bold text-destructive">Giá trả vượt trần so với {tran.sold ? "giá đã bán" : "giá bảng"}</p>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center rounded-[10px] border border-border">
            <button type="button" aria-label={`Bớt ${ten}`} disabled={line.qty <= 1} onClick={() => onPatch({ qty: line.qty - 1 })} className="h-9 w-9 text-[18px] disabled:opacity-30">
              −
            </button>
            <input
              aria-label={`Số lượng ${ten}`}
              inputMode="decimal"
              value={String(line.qty)}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const n = Number(e.target.value.replace(",", "."))
                if (Number.isFinite(n) && n > 0) onPatch({ qty: n })
              }}
              className="h-9 w-12 bg-transparent text-center text-[14px] font-bold tabular-data outline-none"
            />
            <button type="button" aria-label={`Tăng ${ten}`} onClick={() => onPatch({ qty: line.qty + 1 })} className="h-9 w-9 text-[18px]">
              +
            </button>
          </div>
          <span className="text-[13px] text-muted-foreground">{line.unit}</span>
        </div>
        <span className={cn("text-[15px] font-bold tabular-data", line.isExchange && "text-muted-foreground line-through")}>
          {formatCurrency(tien)}
        </span>
      </div>
    </div>
  )
}

/** Giá bảng của một (hàng, ĐVT) cho nhóm khách — dùng chung cho trang. */
export const giaBangTra = (p: PricedProduct | undefined, unit: string, groupId: string | null) => (p ? unitPriceFor(p, unit, groupId) : 0)
