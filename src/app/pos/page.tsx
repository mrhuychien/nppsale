"use client"

/**
 * TRANG GỐC `/pos` — khi chưa mở chứng từ nào, hoặc vừa đóng tab cuối.
 *
 * ⚠ KHÔNG ĐƯỢC LÀ 404. Bản đầu không có trang này: đóng tab cuối cùng
 * là store đẩy về `/pos` và người dùng nhìn thấy "This page could not
 * be found" trong một màn họ vừa dùng. Trang này phải nói được việc
 * tiếp theo — spec §11 "mọi màn có ít nhất một hành động kế tiếp".
 */

import { usePosTabs } from "@/store/pos/tabs"
import { POS_DOC_LABEL, POS_DOT, type PosDocType } from "@/lib/pos/tabs"

const THU_TU: PosDocType[] = ["SO", "RET", "PUR", "PRET"]

const PHIM: Record<PosDocType, string> = {
  SO: "Bán hàng · lập đơn rồi xuất hóa đơn",
  INV: "Hóa đơn bán",
  RET: "Khách trả hàng / đổi hàng",
  PUR: "Nhập hàng từ nhà cung cấp",
  PRET: "Trả hàng cho nhà cung cấp",
}

export default function PosHomePage() {
  const { openNew, tabs } = usePosTabs()
  return (
    <div className="flex min-h-0 flex-grow items-center justify-center p-6">
      <div className="w-[560px] rounded-2xl border border-[var(--pos-line)] bg-white p-6">
        <h1 className="text-[16px] font-bold text-[var(--pos-ink)]">Mở chứng từ mới</h1>
        <p className="mt-1 text-[12.5px] text-[var(--pos-muted)]">
          {tabs.length > 0
            ? "Hoặc bấm vào một tab đang mở phía trên."
            : "Chưa có tab nào. Chọn loại chứng từ để bắt đầu."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {THU_TU.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => openNew(k)}
              className="flex items-start gap-2.5 rounded-xl border border-[var(--pos-line)] px-3.5 py-3 text-left hover:border-[var(--pos-primary)] hover:bg-[var(--pos-primary-faint)]"
            >
              <span aria-hidden className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: POS_DOT[k] }} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-[var(--pos-ink)]">{POS_DOC_LABEL[k]}</span>
                <span className="mt-px block text-[11px] text-[var(--pos-muted)]">{PHIM[k]}</span>
              </span>
            </button>
          ))}
        </div>
        {/* ⚠ Hóa đơn không lập trực tiếp — nó sinh ra từ nút "Xuất hàng &
            lập HĐ" của đơn hàng. Nói ra để không ai đi tìm nút ấy. */}
        <p className="mt-4 text-[11.5px] text-[var(--pos-dim)]">
          Hóa đơn bán được lập từ đơn hàng — bấm <strong>Xuất hàng &amp; lập HĐ</strong> trên
          màn đơn.
        </p>
      </div>
    </div>
  )
}
