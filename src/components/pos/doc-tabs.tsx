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
            <div
              key={t.key}
              className={`flex h-[34px] shrink-0 items-center rounded-lg ${
                dang ? "bg-white pl-3 pr-1.5" : "px-3"
              }`}
            >
              <button
                type="button"
                onClick={() => activate(t.key)}
                aria-current={dang ? "page" : undefined}
                title={POS_DOC_LABEL[t.docType]}
                className={`flex items-center gap-[7px] text-[13px] ${
                  dang ? "font-semibold text-[#0f172a]" : "font-medium text-[#cbd5e1]"
                }`}
              >
                <span
                  aria-hidden
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: POS_DOT[t.docType] }}
                />
                <span className="max-w-[160px] truncate">{t.label}</span>
                {/*
                  ⚠ CHIP "CHƯA LƯU" LÀ CHỮ, KHÔNG PHẢI MỘT CHẤM NỮA.
                    Spec §3 mục 2. Một chấm thứ hai cạnh chấm loại chứng
                    từ là hai chấm không ai phân biệt được; chữ thì đọc
                    xong là hiểu.
                */}
                {t.dirty && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-px text-[10px] font-bold ${
                      dang ? "bg-[#fef3c7] text-[#92400e]" : "bg-[#78350f] text-[#fde68a]"
                    }`}
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
                  className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[15px] leading-none text-[#94a3b8] hover:bg-[#e2e8f0] hover:text-[#334155]"
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
          className="ml-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[#475569] text-[16px] leading-none text-[#94a3b8] hover:border-[#64748b] hover:text-[#cbd5e1]"
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
            <div className="absolute right-0 top-9 z-50 w-[200px] overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white py-1 shadow-[0_10px_30px_rgba(15,23,42,.18)]">
              {LOAI_MO_MOI.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setMoMenu(false); openNew(k) }}
                  className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-[12.5px] text-[#334155] hover:bg-[#f8fafc]"
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
