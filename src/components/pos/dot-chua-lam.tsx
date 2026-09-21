"use client"

/**
 * MÀN CHƯA DỰNG TRONG ĐỢT NÀY — spec §13 chia 4 đợt.
 *
 * ⚠ NÓI THẲNG LÀ CHƯA LÀM, ĐỪNG DỰNG MỘT MÀN NỬA VỜI. Một bảng hàng
 * trống với panel tiền toàn số 0 trông y hệt một màn đã xong nhưng
 * chưa có dữ liệu — chủ nhà bấm thử rồi báo "màn này hỏng", và cả hai
 * bên mất một vòng chỉ để biết nó chưa được dựng.
 *
 * Đây đúng là luật §4 của Coder Pack: không chắc thì để trống và gắn
 * nhãn, đừng đoán cho có.
 */

import Link from "next/link"
import { DocSubHeader } from "@/components/pos/doc-sub-header"

export function DotChuaLam({
  title,
  dot,
  gom,
}: {
  title: string
  /** Đợt theo lộ trình spec §13. */
  dot: 2 | 3 | 4
  /** Những màn cùng đợt, để chủ nhà biết đợt ấy gồm gì. */
  gom: string
}) {
  return (
    <>
      <DocSubHeader title={title} badge={{ label: `ĐỢT ${dot}`, tone: "tam" }} />
      <div className="flex min-h-0 flex-grow items-center justify-center p-6">
        <div className="max-w-[520px] rounded-xl border border-[#e2e8f0] bg-white p-6 text-center">
          <p className="text-[15px] font-bold text-[#0f172a]">Màn này thuộc đợt {dot}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#64748b]">
            Đợt này mới dựng khung và phần bán hàng (màn 1, 1b, 2, 4, 5, 6) theo lộ trình
            §13 của spec. Đợt {dot} gồm: {gom}.
          </p>
          <p className="mt-2 text-[12px] text-[#94a3b8]">
            Chưa dựng nửa vời để chủ nhà khỏi mất công thử một màn chưa có gì.
          </p>
          <Link
            href="/pos/don-hang/moi"
            className="mt-4 inline-block rounded-lg bg-[#2563eb] px-4 py-2 text-[13px] font-bold text-white"
          >
            Về màn đơn đặt hàng
          </Link>
        </div>
      </div>
    </>
  )
}
