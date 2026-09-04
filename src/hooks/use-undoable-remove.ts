"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** 5 giây — đủ để đọc "Đã xoá X" và bấm Hoàn tác, chưa đủ để quên. */
const UNDO_MS = 5000

/**
 * Xoá một phần tử khỏi danh sách nhưng giữ lại đường lùi trong 5 giây.
 *
 * VÌ SAO: dòng hàng trong đơn không chỉ có tên — nó mang giá đã sửa, VAT,
 * chiết khấu, ghi chú. Xoá nhầm là gõ lại tất cả. Có vuốt-để-xoá (M3.3e)
 * thì xoá nhầm càng dễ, nên hoàn tác không phải tuỳ chọn.
 *
 * Xoá THẬT ngay lập tức, chỉ nhớ lại phần tử + vị trí: giữ dòng "đang chờ
 * xoá" trong danh sách sẽ làm tổng tiền và cảnh báo tồn kho tính sai
 * trong đúng 5 giây đó.
 *
 * Hẹn giờ nằm trong ref và bị huỷ khi unmount — để lại setTimeout gọi
 * setState sau khi component chết là một cảnh báo React và một rò rỉ.
 */
export function useUndoableRemove<T>(opts: {
  onRemove: (index: number) => void
  onRestore: (index: number, item: T) => void
  label?: (item: T) => string
  timeoutMs?: number
}) {
  const { onRemove, onRestore, timeoutMs = UNDO_MS } = opts
  const [pending, setPending] = useState<{ index: number; item: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clearTimer, [])

  const remove = useCallback(
    (index: number, item: T) => {
      clearTimer()
      onRemove(index)
      setPending({ index, item })
      timer.current = setTimeout(() => setPending(null), timeoutMs)
    },
    [onRemove, timeoutMs]
  )

  const undo = useCallback(() => {
    clearTimer()
    setPending((p) => {
      if (p) onRestore(p.index, p.item)
      return null
    })
  }, [onRestore])

  const dismiss = useCallback(() => {
    clearTimer()
    setPending(null)
  }, [])

  return {
    /** Phần tử vừa xoá, còn hoàn tác được. null = không có gì để lùi. */
    pending,
    /** Nhãn hiện trên thanh hoàn tác, do nơi gọi tự đặt. */
    pendingLabel: pending && opts.label ? opts.label(pending.item) : null,
    remove,
    undo,
    dismiss,
  }
}
