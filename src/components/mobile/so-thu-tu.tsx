/**
 * SỐ THỨ TỰ ĐẦU DÒNG trên các màn làm đơn / phiếu ở điện thoại — chủ nhà 02/10/2026: "các màn làm đơn trên di động
 * thêm số thứ tự đầu dòng". Một ô dùng chung để mọi màn cùng cỡ, cùng màu.
 */
export function SoThuTu({ n }: { n: number }) {
  return (
    <span
      data-testid="stt-dong"
      aria-label={`Dòng ${n}`}
      className="mt-px grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-surface-container-low px-1 text-[12px] font-bold tabular-nums text-muted-foreground"
    >
      {n}
    </span>
  )
}
