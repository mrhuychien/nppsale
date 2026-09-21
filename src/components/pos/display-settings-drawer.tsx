"use client"

/**
 * DRAWER THIẾT LẬP HIỂN THỊ — spec §9, màn 5. Rộng 452px, bên phải.
 *
 * ⚠ TOGGLE LÀ `<button role="switch" aria-checked>`, không phải một
 * `div` bo tròn. Spec §9 chốt nguyên văn. Người đọc màn hình phải
 * nghe được "đang bật / đang tắt"; một `div` có `onClick` thì họ không
 * biết ô ấy tồn tại.
 */

import { useState, useEffect } from "react"
import { usePosSettings, POS_SETTINGS_DEFAULT, type PosSettings } from "@/store/pos/settings"

type Tab = "cot" | "thao-tac" | "in"

function Toggle({
  id,
  label,
  note,
  noteDanger,
  checked,
  onChange,
}: {
  id: string
  label: string
  note?: string
  noteDanger?: boolean
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <label htmlFor={id} className="min-w-0 flex-grow cursor-pointer">
        <span className="block text-[13px] font-medium text-[var(--pos-ink)]">{label}</span>
        {note && (
          <span className={`mt-px block text-[11px] ${noteDanger ? "text-[var(--pos-danger)]" : "text-[var(--pos-muted)]"}`}>
            {note}
          </span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--pos-primary)]" : "bg-[var(--pos-edge)]"
        }`}
      >
        <span
          aria-hidden
          /* ⚠ NEO BẰNG `style`, KHÔNG BẰNG `top-[3px]`. Kho mã có chốt
             cấm neo dọc bằng px cứng trong class (thanh tổng tiền từng
             bị thanh điều hướng đè 15px vì đúng cách viết ấy). Núm
             toggle không dính bẫy đó, nhưng luật là luật — và ở đây
             `left` vốn đã phải đi qua `style` rồi. */
          className="absolute h-4 w-4 rounded-full bg-white transition-all"
          style={{ top: 3, left: checked ? 21 : 3 }}
        />
      </button>
    </div>
  )
}

export function DisplaySettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, patch } = usePosSettings()
  const [tab, setTab] = useState<Tab>("cot")
  /**
   * ⚠ SỬA TRÊN BẢN NHÁP, ÁP DỤNG KHI BẤM "ÁP DỤNG". Spec §9 có đủ ba
   * nút `Khôi phục mặc định` · `Hủy` · `Áp dụng` — có nút Hủy mà thay
   * đổi đã ăn ngay thì nút ấy nói dối.
   */
  const [nhap, setNhap] = useState<PosSettings>(settings)
  useEffect(() => { if (open) setNhap(settings) }, [open, settings])

  if (!open) return null
  const set = (p: Partial<PosSettings>) => setNhap((c) => ({ ...c, ...p }))

  return (
    <>
      <button type="button" aria-label="Đóng" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-[var(--pos-ink)]/30" />
      <aside
        className="fixed right-0 top-0 z-50 flex h-screen w-[452px] flex-col bg-white shadow-[0_0_40px_rgba(15,23,42,.18)]"
        aria-label="Thiết lập hiển thị"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--pos-line)] px-4">
          <h2 className="text-[16px] font-bold text-[var(--pos-ink)]">Thiết lập hiển thị</h2>
          <button type="button" aria-label="Đóng thiết lập" onClick={onClose} className="h-8 w-8 rounded-lg text-[18px] leading-none text-[var(--pos-muted)] hover:bg-[var(--pos-line-soft)]">×</button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-[var(--pos-line)] px-4">
          {([
            ["cot", "Cột bảng hàng"],
            ["thao-tac", "Thao tác bán"],
            ["in", "In phiếu"],
          ] as const).map(([k, t]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-current={tab === k ? "true" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[12.5px] ${
                tab === k ? "border-[var(--pos-primary)] font-semibold text-[var(--pos-ink)]" : "border-transparent text-[var(--pos-muted)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-grow overflow-y-auto px-4 py-3">
          {tab === "cot" && (
            <>
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
                Hiển thị trong bảng
              </p>
              <Toggle id="s-stt" label="Số thứ tự" checked={nhap.colIndex} onChange={(v) => set({ colIndex: v })} />
              <Toggle id="s-sku" label="Mã hàng" checked={nhap.colSku} onChange={(v) => set({ colSku: v })} />
              <Toggle id="s-ton" label="Tồn kho & đã đặt" checked={nhap.colStock} onChange={(v) => set({ colStock: v })} />
              <Toggle id="s-lo" label="Lô & hạn sử dụng" checked={nhap.colLot} onChange={(v) => set({ colLot: v })} />
              <Toggle id="s-giam" label="Cột giảm giá theo dòng" checked={nhap.colLineDiscount} onChange={(v) => set({ colLineDiscount: v })} />
              <Toggle id="s-vat" label="Cột thuế GTGT" checked={nhap.colVat} onChange={(v) => set({ colVat: v })} />
              <Toggle
                id="s-anh"
                label="Ảnh hàng hóa"
                note="+64px chiều cao dòng · chậm với đơn nhiều dòng"
                noteDanger
                checked={nhap.colImage}
                onChange={(v) => set({ colImage: v })}
              />

              <div className="mt-3 border-t border-[var(--pos-line-soft)] pt-3">
                <div className="flex items-start justify-between gap-3">
                  <label htmlFor="s-dvgiam" className="min-w-0 flex-grow">
                    <span className="block text-[13px] font-medium text-[var(--pos-ink)]">Đơn vị giảm giá mặc định</span>
                    {/*
                      ⚠ CÂU NÀY LÀ BẮT BUỘC, spec §9 chốt nguyên văn ý:
                        đây chỉ là giá trị KHỞI TẠO cho dòng mới. Thiếu
                        nó thì người dùng đổi thiết lập rồi chờ các dòng
                        đã gõ đổi theo — và tưởng màn hình hỏng khi chúng
                        không đổi.
                    */}
                    <span className="mt-px block text-[11px] text-[var(--pos-muted)]">
                      Chỉ là giá trị khởi tạo cho dòng MỚI. Mỗi dòng vẫn tự đổi ₫/% riêng.
                    </span>
                  </label>
                  <select
                    id="s-dvgiam"
                    value={nhap.defaultDiscountUnit}
                    onChange={(e) => set({ defaultDiscountUnit: e.target.value as "vnd" | "pct" })}
                    className="h-8 shrink-0 rounded-[7px] border border-[var(--pos-edge)] bg-white px-2 text-[12.5px]"
                  >
                    <option value="vnd">VND</option>
                    <option value="pct">%</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {tab === "thao-tac" && (
            <>
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--pos-muted)]">
                Hỗ trợ nhập liệu
              </p>
              <Toggle id="s-giagan" label="Xem giá bán gần nhất" checked={nhap.showLastPrice} onChange={(v) => set({ showLastPrice: v })} />
              <Toggle id="s-menhgia" label="Gợi ý mệnh giá thanh toán" checked={nhap.suggestCash} onChange={(v) => set({ suggestCash: v })} />
              <Toggle id="s-gop" label="Gộp hàng hóa trùng dòng" checked={nhap.mergeDuplicateLines} onChange={(v) => set({ mergeDuplicateLines: v })} />
              <Toggle
                id="s-ghino"
                label="Mặc định ghi nợ toàn bộ"
                note="Bán sỉ thì ghi nợ là thường ngày — tắt đi là mỗi đơn phải sửa một lần."
                checked={nhap.defaultCreditAll}
                onChange={(v) => set({ defaultCreditAll: v })}
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--pos-line-soft)] pt-3">
                <label htmlFor="s-sort" className="text-[13px] font-medium text-[var(--pos-ink)]">
                  Sắp xếp hàng hóa
                </label>
                <select
                  id="s-sort"
                  value={nhap.sortBy}
                  onChange={(e) => set({ sortBy: e.target.value as PosSettings["sortBy"] })}
                  className="h-8 rounded-[7px] border border-[var(--pos-edge)] bg-white px-2 text-[12.5px]"
                >
                  <option value="moi-nhat">Thêm sau nằm dưới</option>
                  <option value="ten">Theo tên hàng</option>
                  <option value="ma">Theo mã hàng</option>
                </select>
              </div>
            </>
          )}

          {tab === "in" && (
            <p className="py-6 text-[12.5px] leading-relaxed text-[var(--pos-muted)]">
              Mẫu in dùng chung với phần đang chạy (phiếu giao A5, hóa đơn bán, phiếu thu).
              Thiết lập riêng cho màn POS chưa có trong đợt này — xem{" "}
              <span className="n">docs/pos-todo.md</span>.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--pos-line)] px-4 py-3">
          <button
            type="button"
            onClick={() => setNhap(POS_SETTINGS_DEFAULT)}
            className="text-[12px] font-semibold text-[var(--pos-muted)] hover:text-[var(--pos-muted)]"
          >
            Khôi phục mặc định
          </button>
          <span className="flex-grow" />
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-[var(--pos-edge)] bg-white px-4 text-[13px] font-semibold text-[var(--pos-muted)]"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => { patch(nhap); onClose() }}
            className="h-9 rounded-lg bg-[var(--pos-primary)] px-4 text-[13px] font-bold text-white"
          >
            Áp dụng
          </button>
        </div>
      </aside>
    </>
  )
}
