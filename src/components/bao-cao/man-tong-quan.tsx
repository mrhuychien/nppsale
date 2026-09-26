"use client"

/**
 * MÀN 1 — TỔNG QUAN (`/bao-cao`). Spec mục 3, thiết kế 26/09/2026.
 * "Hôm nay / tháng này kinh doanh thế nào?" — chỉ chọn kỳ + so sánh, không "Thêm lọc".
 * KPI → biểu đồ doanh thu thuần → Top 5 (2×2; điện thoại: 4 tab) → số nhanh. Bấm số nào cũng mở
 * màn chi tiết ở đúng chế độ xem.
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CreditCard, ShoppingCart, Warehouse } from "lucide-react"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, KhoiDanhSach, HangSoNhanh, CongTacDoan, DangTai, KhongCoSo, LoiDocSo, ChuaDu, type TheKpi, type OSoNhanh } from "./khoi"
import { BieuDoCot } from "./bieu-do"
import { useNap, layDanhMuc, tenGiaTri } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { kyTheoMa, soNgay, doHat, chiaThoiGian, khoaThoiGian, tenKy, congNgay } from "@/lib/bao-cao/ky"
import { lienKetMan, MAC_DINH_MAN } from "@/lib/bao-cao/trang-thai"
import { congBan, gomBan, CHUA_CO, type DongBan } from "@/lib/bao-cao/cong"
import { soGon, soDu, phanTram, soSanh, duongXuHuong } from "@/lib/bao-cao/so"
import { napSoBan } from "@/lib/bao-cao/nap-ban-hang"
import { napDonChuaXuat } from "@/lib/bao-cao/nap-don-dat"
import { napCongNo } from "@/lib/bao-cao/nap-cong-no"
import { napTonKho, NGUONG_KHO } from "@/lib/bao-cao/nap-kho"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

const TOP = [
  { id: "prod", tieuDe: "Top 5 mặt hàng", tab: "Mặt hàng" },
  { id: "cust", tieuDe: "Top 5 khách hàng", tab: "Khách hàng" },
  { id: "staff", tieuDe: "Top 5 nhân viên", tab: "Nhân viên" },
  { id: "channel", tieuDe: "Top 5 kênh", tab: "Kênh" },
] as const

export function ManTongQuan() {
  const bc = useBaoCao("reports", MAC_DINH_MAN["/bao-cao"])
  const { st, dat, homNay, xemGiaVon, orgId } = bc
  const router = useRouter()
  const ky = kyTheoMa(st.ky, homNay, st.ca, st.cb)
  const { a, b } = ky
  const cmp = st.soSanh ? ky.cmp : null
  const len = soNgay(a, b) + 1
  const [tab, setTab] = useState<(typeof TOP)[number]["id"]>("prod")

  const nap = useNap(
    orgId
      ? async () => {
          const sb = createClient()
          const { dm, thieu } = await layDanhMuc(orgId)
          const [ban, no, don, kho] = await Promise.all([
            napSoBan(sb, orgId, cmp ? cmp[0] : a, b, dm),
            napCongNo(sb, orgId, homNay, dm),
            napDonChuaXuat(sb, orgId),
            napTonKho(sb, orgId, homNay, dm),
          ])
          return { dm, ban, no, don, kho, thieu: thieu || ban.thieu || no.thieu || don.thieu || kho.thieu }
        }
      : null,
    `${orgId}|${a}|${b}|${cmp?.[0] ?? ""}`
  )

  // Giữ kỳ đang chọn khi sang màn khác.
  const kyDi = { ky: st.ky, ca: st.ca, cb: st.cb }
  const di = (url: string) => router.push(url)

  const vm = useMemo(() => {
    const d = nap.data
    if (!d) return null
    const dm = d.dm
    const cur = d.ban.dong.filter((l) => l.ngay >= a && l.ngay <= b)
    const prev = cmp ? d.ban.dong.filter((l) => l.ngay >= cmp[0] && l.ngay <= cmp[1]) : null
    const T = congBan(cur)
    const TP = prev ? congBan(prev) : null
    const theoNgay = (f: (l: DongBan) => number) => {
      const v = new Array(len).fill(0)
      for (const l of cur) v[soNgay(a, l.ngay)] += f(l)
      return duongXuHuong(v)
    }
    const phaiThu = d.no.khach.reduce((s, k) => s + Math.max(0, k.no), 0)
    const quaHan = d.no.khach.reduce((s, k) => s + k.qua, 0)
    const khachQuaHan = d.no.khach.filter((k) => k.qua > 0).length
    const kpis: TheKpi[] = [
      { id: "net", label: "Doanh thu thuần", value: soGon(T.net), info: GIAI_THICH.net, delta: soSanh(T.net, TP?.net, true), spark: theoNgay((l) => l.loai * l.tien), onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: "time" })) },
      ...(xemGiaVon
        ? [{ id: "gp", label: "Lãi gộp", value: soGon(T.gp), info: GIAI_THICH.gp, sub: `Biên ${phanTram(T.net ? T.gp / T.net : 0)}`, delta: soSanh(T.gp, TP?.gp, true), spark: theoNgay((l) => l.loai * (l.tien - l.giaVon)), onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: "time" })) } satisfies TheKpi]
        : []),
      { id: "nInv", label: "Số hoá đơn", value: soDu(T.nInv), info: GIAI_THICH.nInv, delta: soSanh(T.nInv, TP?.nInv, true), onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: "time", dao: [{ l: "Hoá đơn", v: "docs" }] })) },
      { id: "cust", label: "Khách mua", value: soDu(T.nCust), info: GIAI_THICH.cust, delta: soSanh(T.nCust, TP?.nCust, true), onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: "cust" })) },
      { id: "debt", label: "Công nợ phải thu", value: soGon(phaiThu), info: GIAI_THICH.debt, sub: `trong đó quá hạn ${soGon(quaHan)}`, subTone: quaHan > 0 ? "danger" : "muted", onClick: () => di(lienKetMan("/bao-cao/cong-no", {})) },
    ]
    const g = doHat(a, b)
    const cot = chiaThoiGian(a, b, g)
    const m = gomBan(cur, (l) => khoaThoiGian(g, l.ngay))
    let cv: number[] | null = null
    if (prev && cmp) {
      const mc = gomBan(prev, (l) => khoaThoiGian(g, l.ngay))
      cv = chiaThoiGian(cmp[0], cmp[1], g).map((t) => mc.get(t.k)?.net || 0)
    }
    const top = TOP.map((t) => {
      const kf =
        t.id === "prod" ? (l: DongBan) => l.sp : t.id === "cust" ? (l: DongBan) => l.kh : t.id === "staff" ? (l: DongBan) => l.nv : (l: DongBan) => dm.khach.get(l.kh)?.kenh || CHUA_CO
      const ds = Array.from(gomBan(cur, kf).values())
        .filter((x) => x.net !== 0)
        .sort((x, y) => y.net - x.net)
        .slice(0, 5)
      const ten = (k: string) => (t.id === "prod" ? tenGiaTri(dm, "prod", k) : t.id === "cust" ? tenGiaTri(dm, "cust", k) : t.id === "staff" ? tenGiaTri(dm, "staff", k) : k)
      const locDao = t.id === "channel" ? "channel" : t.id
      const tiep = t.id === "prod" ? "cust" : t.id === "cust" ? "prod" : "cust"
      return {
        ...t,
        dong: ds.map((x) => ({
          label: ten(x.k),
          value: soGon(x.net),
          bar: { w: T.net ? (x.net / T.net) * 100 : 0, text: phanTram(T.net ? x.net / T.net : 0) },
          onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: t.id, dao: [{ l: ten(x.k), v: tiep, f: { [locDao]: x.k } }] })),
        })),
        chan: { label: "Xem tất cả", onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: t.id })) },
      }
    })
    const hanTu = congNgay(homNay, NGUONG_KHO.hetHan)
    const loSapHet = d.kho.lo.filter((l) => l.hsd && l.hsd <= hanTu).length
    const giaTriTon = d.kho.ton.reduce((s, x) => s + x.giaTri, 0)
    const oSo: OSoNhanh[] = [
      { label: "Đơn đặt chưa xuất hoá đơn", value: `${soDu(d.don.soDon)} đơn`, sub: soGon(d.don.conLai), icon: ShoppingCart, mau: "violet", onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ky: "year", nguon: "ord", xem: "time", dao: [{ l: "Chưa xuất HĐ", v: "docs", f: { chuaXuat: true } }] })) },
      ...(xemGiaVon
        ? [{ label: "Giá trị tồn kho", value: soGon(giaTriTon), sub: `${d.kho.ton.length} mặt hàng còn hàng`, icon: Warehouse, mau: "amber", onClick: () => di(lienKetMan("/bao-cao/kho", {})) } satisfies OSoNhanh]
        : []),
      { label: "Hàng sắp hết hạn", value: `${soDu(loSapHet)} lô`, sub: `HSD còn ≤ ${NGUONG_KHO.hetHan} ngày`, icon: AlertTriangle, mau: "amber", tone: loSapHet ? "warning" : undefined, onClick: () => di(lienKetMan("/bao-cao/kho", { xem: "exp" })) },
      { label: "Nợ quá hạn", value: `${soDu(khachQuaHan)} khách`, sub: soGon(quaHan), icon: CreditCard, mau: "red", tone: khachQuaHan ? "danger" : undefined, onClick: () => di(lienKetMan("/bao-cao/cong-no", { xem: "aging" })) },
    ]
    return {
      kpis,
      bieuDo: {
        tieuDe: `Doanh thu thuần theo ${g === "day" ? "ngày" : g === "week" ? "tuần" : "tháng"}`,
        cot: cot.map((t) => {
          const v = m.get(t.k)?.net || 0
          return { label: t.label.replace("Tuần ", "").replace("Tháng ", "Th"), v, title: `${t.label}: ${soDu(v)}`, onClick: () => di(lienKetMan("/bao-cao/ban-hang", { ...kyDi, xem: "time", dao: [{ l: t.label, v: "cust", f: { range: t.r } }] })) }
        }),
        cv,
      },
      top,
      oSo,
      rong: !cur.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, a, b, cmp?.[0], xemGiaVon])

  return (
    <KhungBaoCao
      href="/bao-cao"
      role={bc.user?.role}
      dao={[{ label: "Tổng quan", onClick: () => undefined }]}
      onBoDao={() => undefined}
      thanhLoc={
        <ThanhLoc
          che="range"
          homNay={homNay}
          maKy={st.ky}
          ca={st.ca}
          cb={st.cb}
          onKy={(ky, ca, cb) => dat({ ky, ca: ca ?? null, cb: cb ?? null })}
          soSanh={{ bat: st.soSanh, nhan: "So với kỳ trước", onDoi: () => dat({ soSanh: !st.soSanh }) }}
          loai={[]}
          loc={{}}
          luaChon={() => []}
          onLoc={() => undefined}
          onBoHet={() => undefined}
          capNhat={nap.capNhat}
          onTaiLai={nap.taiLai}
        />
      }
    >
      {bc.loading || (nap.dangTai && !vm) ? (
        <DangTai soThe={5} />
      ) : nap.loi ? (
        <LoiDocSo text={`Đọc số tổng quan hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
      ) : vm ? (
        <>
          {nap.data?.thieu && <ChuaDu text="Số liệu quá lớn, đang hiện 20.000 dòng đầu — thu hẹp kỳ." />}
          <HangKpi kpis={vm.kpis} />
          {vm.rong ? (
            <KhongCoSo text={`${tenKy(st.ky)} chưa có hoá đơn nào — đổi kỳ sang Tháng trước?`} nut={{ label: "Xem tháng trước", onClick: () => dat({ ky: "lastmonth" }) }} />
          ) : (
            <>
              <BieuDoCot tieuDe={vm.bieuDo.tieuDe} chuGiai={[{ label: "Kỳ này", kieu: "cot" }, ...(vm.bieuDo.cv ? [{ label: "Kỳ trước", kieu: "duong" as const }] : [])]} cot={vm.bieuDo.cot} soSanh={vm.bieuDo.cv} />
              <CongTacDoan className="lg:hidden" ds={TOP.map((t) => ({ value: t.id, label: t.tab }))} value={tab} onChange={setTab} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {vm.top.map((t) => (
                  <div key={t.id} className={t.id === tab ? "" : "max-lg:hidden"}>
                    <KhoiDanhSach tieuDe={t.tieuDe} dong={t.dong} chan={t.chan} testId={`bc-top-${t.id}`} />
                  </div>
                ))}
              </div>
            </>
          )}
          <HangSoNhanh ds={vm.oSo} />
        </>
      ) : null}
    </KhungBaoCao>
  )
}
