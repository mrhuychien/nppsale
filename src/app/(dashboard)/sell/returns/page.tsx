"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, Search } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useAuth } from "@/hooks/use-auth"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { useSellData } from "@/hooks/use-sell-data"
import { Stepper } from "@/components/sell/line-edit-sheet"
import { ReturnLineSheet } from "@/components/sell/return-line-sheet"
import { RETURN_REASONS, returnReasonLabel, returnPriceViolation } from "@/lib/sell/returns"
import { unitPriceFor } from "@/lib/sell/pricing"
import { userPriceRulesFrom } from "@/lib/pricing"
import { toStockLines, toStockReturnLines } from "@/lib/sell/stock"
import { isReturnLineOverstock } from "@/lib/orders/stock-check"
import { cn, formatCurrency } from "@/lib/utils"

export default function SellReturnsPage() {
  const router = useRouter()
  const cart = useSellCart()
  const { user } = useAuth()
  const { products, productById, customerById, stockByProduct } = useSellData()

  // Nhu cầu xuất kho gồm cả dòng bán lẫn dòng đổi — xem `@/lib/sell/stock`.
  const stockLines = useMemo(() => toStockLines(cart.cart), [cart.cart])
  const stockReturns = useMemo(() => toStockReturnLines(cart.returnLines), [cart.returnLines])
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const groupId = customerById(cart.customerId)?.group_id ?? null

  /**
   * Quyền sửa giá — DÙNG CHUNG với dòng bán.
   *
   * ⚠ Ai không được sửa giá bán thì cũng không được sửa giá trả. Hai đằng
   * cùng là thẩm quyền về TIỀN: chặn ở đơn bán rồi mở ở phiếu trả thì
   * "trả hàng" thành đường vòng để ra đúng con số mình muốn.
   */
  const rules = userPriceRulesFrom(user)
  const canEditPrice = user?.role !== "sales" || !!rules.allow_price_edit

  /** Giá bảng của đúng đơn vị đang chọn trên dòng trả. */
  const listPriceOf = (r: { productId: string; unit: string }) => {
    const p = productById(r.productId)
    return p ? unitPriceFor(p, r.unit, groupId) : 0
  }
  /** Dòng này đã bị sửa giá so với bảng giá chưa — để gắn nhãn "Giá sửa". */
  const priceEdited = (r: { productId: string; unit: string; price: number }) => {
    const list = listPriceOf(r)
    return list > 0 && r.price !== list
  }
  /** ⚠ Trả CAO hơn giá bảng là một đường rút tiền — tô đỏ ngay trên dòng. */
  const priceBadOf = (r: { productId: string; unit: string; price: number }) =>
    returnPriceViolation(r, listPriceOf(r)) !== null


  return (
    <div className="flex min-h-screen flex-col bg-surface pb-28">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="flex-1 text-[22px] font-extrabold">Hàng trả / đổi</h1>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        <section className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-on-surface-variant">
            Lý do
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RETURN_REASONS.map((r) => {
              const active = cart.returnReason === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => cart.setReturnReason(r.value)}
                  className={cn(
                    "h-10 whitespace-nowrap rounded-[10px] border-[1.5px] px-3.5 text-[13px] font-bold",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-outline-variant text-on-surface"
                  )}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* ⚠ MỘT MÀN TÌM HÀNG DUY NHẤT CHO CẢ APP.
            Trước đây chỗ này có ô tìm + lưới thẻ RIÊNG, kèm một danh sách
            "Hàng trong đơn này" bày sẵn. Hai vấn đề:
              · Danh sách bày sẵn chiếm gần hết màn hình trước khi người dùng
                kịp gõ gì, mà hàng phải trả thường KHÔNG nằm trong đơn đang
                soạn — khách trả hàng của chuyến trước.
              · Bản tìm hàng ở đây thiếu sạch những thứ màn bán hàng có: tab
                "khách hay lấy", nút quét mã, trần số thẻ vẽ một lúc. Cùng
                một việc mà hai bản, và bản kém hơn nằm đúng chỗ ít ai soi.
            Nay chạm vào đây là mở CHÍNH màn tìm hàng của luồng bán hàng, ở
            chế độ chọn hàng trả. */}
        <button
          type="button"
          onClick={() => router.push("/sell?mode=return")}
          className="flex h-13 items-center gap-2.5 rounded-2xl bg-surface-container-lowest px-3.5 py-3 text-left shadow-card"
        >
          <Search className="h-[18px] w-[18px] shrink-0 text-on-surface-variant" />
          <span className="flex-1 text-base font-semibold text-on-surface-variant">
            Tìm hàng để trả — tên, mã hàng, mã vạch…
          </span>
        </button>

        {/* ⚠ Chưa có dòng nào thì NÓI RA. Giữa chip lý do và dòng chú
            thích cuối trang là một khoảng trống, và khoảng trống đó trông
            như màn hình chưa tải xong chứ không như "chưa chọn gì". */}
        {cart.returnLines.length === 0 && (
          <p className="px-1 py-6 text-center text-sm font-semibold text-on-surface-variant">
            Chưa có hàng trả nào. Chạm ô tìm ở trên để chọn hàng khách đưa lại.
          </p>
        )}

        {cart.returnLines.length > 0 && (
          <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
            {cart.returnLines.map((r, i) => {
              const p = productById(r.productId)
              // ⚠ Dòng ĐỔI ăn tồn kho như một dòng bán: hàng thay thế lấy
              // từ kho đưa cho khách. Dòng trả tiền thì ngược lại (nhập
              // lại kho) nên không bao giờ vượt tồn.
              const over = isReturnLineOverstock(
                i,
                stockReturns,
                stockLines,
                products,
                stockByProduct
              )
              return (
                <div
                  key={`${r.productId}|${r.unit}`}
                  className="flex flex-col gap-2.5 border-b border-outline-variant/30 p-3 last:border-0"
                >
                  <div className="flex items-start gap-2.5">
                    {/* ⚠ Bấm vào dòng là mở phần sửa — trước đây dòng trả
                        chỉ có bộ đếm số lượng, không có đường nào chỉnh
                        ĐƠN GIÁ. Giá lấy theo bảng giá hôm nay, trong khi
                        hàng khách đưa lại mua hôm khác và thường là hàng
                        hư hỏng chỉ bù được một phần. */}
                    <button
                      type="button"
                      onClick={() => setEditIdx(i)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-[15px] font-bold leading-snug">
                        {p?.name ?? "—"}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold text-on-surface-variant">
                        {returnReasonLabel(cart.returnReason)} · {formatCurrency(r.price)}/{r.unit}
                        {priceEdited(r) && (
                          <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-px font-extrabold text-primary">
                            Giá sửa
                          </span>
                        )}
                      </span>
                      {over && (
                        <span className="mt-0.5 block text-xs font-extrabold text-error">
                          Vượt tồn kho — kho không đủ hàng để đổi
                        </span>
                      )}
                      {priceBadOf(r) && (
                        <span className="mt-0.5 block text-xs font-extrabold text-error">
                          Giá trả cao hơn giá bảng
                        </span>
                      )}
                      {r.note && (
                        <span className="mt-0.5 block text-xs font-semibold italic text-on-surface-variant">
                          “{r.note}”
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => cart.setReturnQty(i, 0)}
                      aria-label="Xoá dòng trả"
                      className="grid h-9 w-9 shrink-0 place-items-center text-xl text-error"
                    >
                      ×
                    </button>
                  </div>
                  {/* ⚠ Hai loại khác nhau ở CHỖ TIỀN: đổi hàng không trừ
                      đồng nào. Nhầm là sai tiền theo cả hai chiều.

                      ⚠ BỘ CHỌN NẰM RIÊNG MỘT HÀNG. Xếp cạnh bộ đếm số
                      lượng thì trên màn 375px hai khối cộng lại rộng hơn
                      thẻ (~162px + 164px + lề) — bộ đếm bị đẩy tràn ra
                      ngoài mép phải, bấm không tới nút +. */}
                  <div className="flex gap-1 rounded-[10px] bg-surface-container p-[3px]">
                    {[
                      { ex: false, label: "Trả tiền" },
                      { ex: true, label: "Đổi hàng" },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => cart.patchReturnLine(i, { isExchange: o.ex })}
                        className={cn(
                          "h-10 flex-1 rounded-lg text-[13px] font-extrabold",
                          r.isExchange === o.ex
                            ? "bg-surface-container-lowest text-primary shadow-sm"
                            : "text-on-surface-variant"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[15px] font-extrabold tabular-data">
                      {r.isExchange ? (
                        <span className="text-on-surface-variant">Đổi hàng · không trừ tiền</span>
                      ) : (
                        <>−{formatCurrency(Math.round(r.qty * r.price * (1 + (r.vatRate || 0))))}</>
                      )}
                    </span>
                    <div className="w-[164px] shrink-0">
                      <Stepper qty={r.qty} onChange={(v) => cart.setReturnQty(i, v)} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between p-3 text-sm font-bold text-on-surface-variant">
              Trừ vào đơn
              <span className="text-[18px] font-extrabold tabular-data text-tertiary">
                −{formatCurrency(cart.returnCredit)}
              </span>
            </div>
          </section>
        )}

        <p className="px-1 text-xs font-semibold leading-relaxed text-on-surface-variant">
          Phiếu trả ở trạng thái <b>chờ duyệt</b>; kho nhập lại hàng và kế toán giảm công nợ sau khi
          quản lý duyệt. Dòng “Đổi hàng” không trừ tiền.
        </p>
      </div>

      <SellBottomBar>
        <button
          type="button"
          onClick={() => router.back()}
          className="h-13 w-full rounded-2xl bg-primary py-3.5 text-base font-extrabold text-on-primary"
        >
          Xong · về đơn hàng
        </button>
      </SellBottomBar>

      <ReturnLineSheet
        line={editIdx != null ? (cart.returnLines[editIdx] ?? null) : null}
        product={
          editIdx != null ? productById(cart.returnLines[editIdx]?.productId ?? "") : undefined
        }
        groupId={groupId}
        canEditPrice={canEditPrice}
        onPatch={(patch) => editIdx != null && cart.patchReturnLine(editIdx, patch)}
        onRemove={() => {
          if (editIdx != null) cart.setReturnQty(editIdx, 0)
          setEditIdx(null)
        }}
        onClose={() => setEditIdx(null)}
      />
    </div>
  )
}
