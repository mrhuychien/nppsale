"use client"

/**
 * KHUNG `/pos` — topbar + tab + thân trang, spec §2.
 *
 * ⚠ TRANG KHÔNG CUỘN. Spec §2 chốt: chỉ bảng hàng cuộn trong khung nó.
 * Người ngồi bàn giấy nhìn một màn hình đứng yên; cuộn cả trang thì
 * hàng nút "Xuất hàng & lập HĐ" trôi khỏi tầm mắt đúng lúc cần bấm.
 * Điều đó buộc mọi con trong cột phải có `min-h-0` — flex item mặc
 * định KHÔNG co xuống dưới chiều cao nội dung, thiếu nó thì
 * `overflow-y-auto` không bao giờ chạy và khung tự phình đẩy nút ra
 * ngoài. (Đúng cái bẫy đã sập ở ngăn Xem nhanh hóa đơn.)
 *
 * ⚠ DƯỚI 1280px THÌ NÓI THẲNG. Spec §2. Bóp màn POS xuống điện thoại
 * là dựng một màn thứ ba không ai thiết kế; `/sell` đã có sẵn cho khổ
 * ấy và nó tốt hơn bất cứ thứ gì ép ra từ đây.
 *
 * ⚠ KHUNG PHẢI GIỮ ĐƯỢC TIÊU ĐIỂM, nếu không phím tắt CHẾT. `keydown`
 * chỉ nổi bọt từ phần tử đang có tiêu điểm; mở trang xong tiêu điểm
 * nằm ở `<body>` — ngoài khung — nên `F3` không tới đây cho tới khi
 * người dùng bấm chuột vào đâu đó bên trong. Bản đầu đúng y như thế:
 * mở `/pos`, bấm F3, không có gì xảy ra. Nay khung có `tabIndex={-1}`,
 * tự lấy tiêu điểm lúc dựng, và lấy lại mỗi khi tiêu điểm rơi ra
 * `<body>` (đóng modal là một lần như vậy). Vẫn KHÔNG gắn lên
 * `document` — spec §10.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { PosTopBar } from "@/components/pos/pos-top-bar"
import { posKeyOf, posShouldHandle, type PosKey } from "@/lib/pos/keys"

/** Nơi các màn đăng ký việc cần làm khi bấm phím tắt. */
export type PosKeyHandlers = Partial<Record<PosKey, () => void>>

/**
 * Bộ việc của màn ĐANG MỞ.
 *
 * ⚠ MỘT MÀN MỘT BỘ, và bộ sau đè bộ trước rồi trả lại khi rời màn. Giữ
 * chồng nhiều bộ là hai màn cùng nhận `F8` và không ai biết cái nào
 * chạy. Một ô nhớ ở cấp mô-đun là đủ vì `/pos` chỉ mở MỘT màn tại một
 * thời điểm — tab là nhiều CHỨNG TỪ, không phải nhiều màn cùng vẽ.
 *
 * ⚠ GIỮ MỘT HÀM ĐỌC, KHÔNG GIỮ BẢN SAO. Component vẽ lại mỗi lần gõ
 * một ký tự; giữ bản sao là phím tắt thao tác trên giỏ hàng của một
 * phút trước.
 */
const dangKy: { doc: () => PosKeyHandlers } = { doc: () => ({}) }

/** Đăng ký phím tắt cho màn đang mở. */
export function usePosKeys(handlers: PosKeyHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const truoc = dangKy.doc
    dangKy.doc = () => ref.current
    return () => { dangKy.doc = truoc }
  }, [])
}

/**
 * Kích một phím tắt từ một nút trên màn — ô tìm ở topbar dùng cái này
 * để mở đúng dropdown của màn đang đứng.
 *
 * @returns `false` nếu màn đang mở không đăng ký phím ấy.
 */
export function firePosKey(k: PosKey): boolean {
  const fn = dangKy.doc()[k]
  if (!fn) return false
  fn()
  return true
}

export function PosShell({ children }: { children: ReactNode }) {
  const [hepQua, setHepQua] = useState(false)
  const khungRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const do1 = () => setHepQua(window.innerWidth < 1280)
    do1()
    window.addEventListener("resize", do1)
    return () => window.removeEventListener("resize", do1)
  }, [])

  /* ⚠ Lấy tiêu điểm lúc dựng — xem đầu tệp. */
  useEffect(() => {
    if (!hepQua) khungRef.current?.focus({ preventScroll: true })
  }, [hepQua])

  /**
   * ⚠ GẮN Ở KHUNG NÀY, KHÔNG GẮN `document` (spec §10). `keydown` nổi
   * bọt từ mọi phần tử con lên đây, nên bắt ở đây là đủ cho mọi tiêu
   * điểm nằm trong `/pos` — mà lại tự tháo khi rời trang, không có
   * cách nào đụng vào `/sell`.
   */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = posKeyOf(e.key)
    if (!k) return
    const el = e.target as HTMLElement | null
    if (!posShouldHandle(k, el?.tagName ?? "", el?.isContentEditable === true)) return
    /**
     * ⚠ MÀN KHÔNG ĐĂNG KÝ PHÍM NÀY THÌ ĐỪNG CHẶN. `F3` của trình duyệt
     * là "tìm trong trang" — cướp nó ở một màn không có ô tìm hàng là
     * lấy đi một chức năng mà không đưa lại gì.
     */
    const fn = dangKy.doc()[k]
    if (!fn) return
    e.preventDefault()
    fn()
  }, [])

  /* ⚠ Tiêu điểm rơi ra `<body>` (phần tử đang có tiêu điểm bị gỡ khỏi
     DOM — đóng dropdown, xoá dòng) thì kéo về khung. `relatedTarget`
     rỗng nghĩa là không có phần tử nào nhận tiêu điểm tiếp theo. */
  const onBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget) return
    const khung = khungRef.current
    if (!khung) return
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) khung.focus({ preventScroll: true })
    })
  }, [])

  if (hepQua) {
    return (
      <div className="pos-scope flex h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-[15px] font-bold">Màn hình quá hẹp — dùng /sell trên điện thoại</p>
          <p className="mt-1.5 text-[13px] text-[var(--pos-muted)]">
            Màn POS dựng cho khổ 1280px trở lên. Trên điện thoại hãy mở{" "}
            <a href="/sell" className="font-semibold text-[var(--pos-primary)] underline">
              màn bán hàng
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={khungRef}
      tabIndex={-1}
      className="pos-scope flex h-screen flex-col overflow-hidden outline-none"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <PosTopBar />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
