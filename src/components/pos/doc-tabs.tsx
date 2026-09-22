"use client"

/**
 * DÃY TAB CHỨNG TỪ — spec §3.
 *
 * ⚠ TAB LÀ `<button>` THẬT, không phải `div` gắn `onClick`. Spec §11
 * chốt riêng một dòng: `div` có `onClick` bị Tab bỏ qua, nên người
 * dùng bàn phím không có cách nào chuyển tab.
 *
 * ⚠ NÚT `×` NẰM RIÊNG, KHÔNG LỒNG TRONG NÚT TAB. `<button>` trong
 * `<button>` là HTML không hợp lệ; trình duyệt tự gỡ lồng và kết quả
 * là bấm `×` lại kích cả tab. Hai nút anh em, tab lo chuyển, `×` lo
 * đóng.
 *
 * ⚠ NÚT `+` HỎI LOẠI CHỨNG TỪ. Bản đầu mở thẳng một đơn hàng — người
 * cần lập phiếu nhập không có cách nào mở nó từ topbar, phải gõ URL.
 */

import { useState } from "react"
import { usePosTabs } from "@/store/pos/tabs"
import { POS_DOC_LABEL, POS_DOT, type PosDocType } from "@/lib/pos/tabs"

const LOAI_MO_MOI: PosDocType[] = ["SO", "RET", "PUR", "PRET"]

export function DocTabs() {
  const { tabs, activeKey, close, activate, openNew } = usePosTabs()
  const [moMenu, setMoMenu] = useState(false)

  return (
    <div className="flex min-w-0 flex-grow items-center gap-1">
      <div className="flex min-w-0 flex-grow items-center gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const dang = t.key === activeKey
          return (
            /*
              ⚠ VIÊN THUỐC CÓ VIỀN, KHÔNG PHẢI MẢNG NỀN. Bản thiết kế
                21/09/2026 vẽ tab là viên bo tròn viền 1.5px: trên thanh
                TRẮNG, một tab chỉ tô nền nhạt thì mép nó tan vào thanh và
                không đếm được đang mở mấy chứng từ.
            */
            <div
              key={t.key}
              className={`flex h-[34px] shrink-0 items-center gap-2 rounded-full border-[1.5px] ${
                dang
                  ? "border-[var(--pos-primary-border)] bg-[var(--pos-primary-soft)] pl-3 pr-1.5"
                  : "border-[var(--pos-edge)] bg-[var(--pos-card)] px-3"
              }`}
            >
              <button
                type="button"
                onClick={() => activate(t.key)}
                aria-current={dang ? "page" : undefined}
                title={POS_DOC_LABEL[t.docType]}
                className={`flex items-center gap-[7px] text-[13px] font-bold ${
                  dang ? "text-[var(--pos-primary-deep)]" : "text-[var(--pos-muted)]"
                }`}
              >
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: POS_DOT[t.docType] }}
                />
                <span className="max-w-[160px] truncate">{t.label}</span>
                {/*
                  ⚠ SỐ DÒNG HÀNG CỦA TAB — bản thiết kế vẽ con số này
                    ngay cạnh nhãn. Nó trả lời một câu hỏi thật: mở bốn
                    tab thì tab nào còn rỗng. Không có nó, người bán
                    phải bấm vào từng tab để biết.

                  ⚠ TAB RỖNG KHÔNG VẼ SỐ 0. Một dãy số 0 cạnh mọi tab là
                    nhiễu; chỗ nào có hàng thì chỗ ấy mới đáng nhìn.
                */}
                {t.count > 0 && (
                  <span
                    className={`n shrink-0 text-[12px] font-extrabold ${
                      dang ? "text-[var(--pos-primary)]" : "text-[var(--pos-dim)]"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
                {/*
                  ⚠ CHIP "CHƯA LƯU" LÀ CHỮ, KHÔNG PHẢI MỘT CHẤM NỮA.
                    Spec §3 mục 2. Một chấm thứ hai cạnh chấm loại chứng
                    từ là hai chấm không ai phân biệt được; chữ thì đọc
                    xong là hiểu.
                */}
                {t.dirty && (
                  <span
                    /* ⚠ Thanh nay nền TRẮNG nên hai trạng thái dùng CHUNG
                       một cặp màu được — bản trước phải tách hai vì tab
                       chưa chọn nằm trên nền xanh đậm. */
                    className="shrink-0 rounded-[6px] bg-[var(--pos-warn-soft)] px-1.5 py-px text-[10px] font-extrabold text-[var(--pos-warn)]"
                  >
                    chưa lưu
                  </span>
                )}
              </button>
              {dang && (
                <button
                  type="button"
                  onClick={() => close(t.key)}
                  aria-label={`Đóng tab ${t.label}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-[var(--pos-primary-deep)] hover:bg-[var(--pos-card)]"
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label="Mở chứng từ mới"
          aria-expanded={moMenu}
          onClick={() => setMoMenu((v) => !v)}
          className="ml-1 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-[var(--pos-edge-dash)] bg-[var(--pos-card)] text-[18px] font-bold leading-none text-[var(--pos-primary-deep)] hover:border-[var(--pos-primary)] hover:bg-[var(--pos-primary-soft)]"
        >
          +
        </button>
        {moMenu && (
          <>
            <button
              type="button"
              aria-label="Đóng menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMoMenu(false)}
            />
            <div className="absolute right-0 top-9 z-50 w-[200px] overflow-hidden rounded-[10px] border border-[var(--pos-line)] bg-white py-1 shadow-[0_10px_30px_rgba(15,23,42,.18)]">
              {LOAI_MO_MOI.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setMoMenu(false); openNew(k) }}
                  className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-[12.5px] text-[var(--pos-muted)] hover:bg-[var(--pos-head)]"
                >
                  <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: POS_DOT[k] }} />
                  {POS_DOC_LABEL[k]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
