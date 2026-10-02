"use client"

/**
 * TỜ IN của màn Soạn hàng — "In phiếu nhặt" (mặc định) và "In nhãn rổ" (`data-print-mode="nhan-ro"`), như hai
 * nút của mẫu chủ nhà 02/10/2026. Phiếu nhặt xếp theo khu kệ (đúng đường đi), mỗi dòng ghi phần chia từng rổ.
 */
import { formatDate } from "@/lib/utils"
import { moHopThoaiIn } from "@/components/ui/print-button"
import { hienSoLuong, nhomDong, CHU_RO, type DongNhat, type HdSoan } from "@/lib/orders/luot-soan"
import type { OrgHeader } from "@/lib/org/header"

export const inPhieuNhat = () => moHopThoaiIn()

export function inNhanRo() {
  const html = document.documentElement
  html.setAttribute("data-print-mode", "nhan-ro")
  requestAnimationFrame(() => {
    window.print()
    setTimeout(() => html.removeAttribute("data-print-mode"), 200)
  })
}

export function ToInSoanHang({ org, ma, hd, rows, soMat }: { org: OrgHeader; ma: string | null; hd: HdSoan[]; rows: DongNhat[]; soMat: Map<string, number> }) {
  const nhom = nhomDong(rows, "ke")
  let stt = 0
  return (
    <>
      <div className="print-only a4-doc text-[12px] text-black" data-testid="to-in-soan-hang">
        <p className="font-bold uppercase leading-tight">{org.name || ""}</p>
        {org.address && <p className="leading-tight">Địa chỉ: {org.address}</p>}
        <h1 className="mt-1.5 text-center text-xl font-bold">PHIẾU NHẶT HÀNG{ma ? ` · ${ma}` : ""}</h1>
        <p className="text-center">Ngày {formatDate(new Date().toISOString())} · {hd.length} hóa đơn · {rows.length} mặt hàng</p>
        <p className="mt-1 leading-snug">
          <b>Rổ:</b> {hd.map((h, i) => `${CHU_RO[i]} = ${h.ma} (${h.khach})`).join("; ")}
        </p>
        <table className="mt-1.5 w-full border-collapse">
          <thead>
            <tr className="text-center font-bold">
              <th className="w-8 border border-black px-1">STT</th>
              <th className="w-14 border border-black px-1">Vị trí</th>
              <th className="border border-black px-1">Tên hàng</th>
              <th className="border border-black px-1">Tổng cần nhặt</th>
              <th className="border border-black px-1">Chia rổ</th>
              <th className="w-12 border border-black px-1">Đã nhặt</th>
            </tr>
          </thead>
          <tbody>
            {nhom.map((g) => [
              <tr key={`g-${g.ten}`}><td colSpan={6} className="border border-black px-1 font-bold">{g.ten}</td></tr>,
              ...g.rows.map((r) => {
                const q = hienSoLuong(r.tong, r)
                stt++
                return (
                  <tr key={r.productId} className="align-top">
                    <td className="border border-black px-1 text-center">{stt}</td>
                    <td className="border border-black px-1 text-center">{r.viTri || ""}</td>
                    <td className="border border-black px-1">{r.ten}{r.sku ? ` (${r.sku})` : ""}{r.coDoi ? " — có hàng đổi" : ""}</td>
                    <td className="whitespace-nowrap border border-black px-1 text-right font-bold">{q.chinh}{q.phu ? <div className="font-normal">{q.phu}</div> : null}</td>
                    <td className="border border-black px-1">{r.phan.map((p) => `${p.ro} ${p.sl}`).join(" · ")}</td>
                    <td className="border border-black px-1"></td>
                  </tr>
                )
              }),
            ])}
          </tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 text-center">
          <div><p className="font-bold">Người soạn hàng</p><p className="italic">(Ký, họ tên)</p></div>
          <div><p className="font-bold">Thủ kho</p><p className="italic">(Ký, họ tên)</p></div>
        </div>
      </div>

      <div className="print-nhan-ro-only text-black" data-testid="to-in-nhan-ro">
        <div className="grid grid-cols-2 gap-3">
          {hd.map((h, i) => (
            <div key={h.id} className="break-inside-avoid rounded-lg border-2 border-black p-3 text-center">
              <div className="text-[64px] font-black leading-none">{CHU_RO[i]}</div>
              <div className="mt-1 text-[15px] font-bold">{h.khach}</div>
              <div className="text-[13px]">{h.ma}{h.tuyen ? ` · Tuyến ${h.tuyen}` : ""}</div>
              <div className="text-[12px]">{soMat.get(h.id) ?? 0} mặt hàng{ma ? ` · ${ma}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
