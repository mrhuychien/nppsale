"use client"

/**
 * MÀN 3 — CUỐI NGÀY (`/bao-cao/cuoi-ngay`). Spec mục 5, thiết kế 26/09/2026.
 * "Hôm nay tiền, hàng, chứng từ có khớp không?" — chọn MỘT ngày (‹ ngày trước · Hôm nay · ›).
 * KPI → Tiền trong ngày (quan trọng nhất với kế toán) + Trạng thái đơn → Theo nhân viên (đối
 * chiếu khi nhân viên nộp tiền). Nút "In báo cáo cuối ngày" in tờ A5.
 */
import { useMemo, useRef, useState } from "react"
import { useBaoCao } from "@/hooks/use-bao-cao"
import { KhungBaoCao, type MatDao } from "./khung"
import { ThanhLoc } from "./thanh-loc"
import { HangKpi, KhoiDanhSach, DangTai, KhongCoSo, LoiDocSo, ChuaDu, type TheKpi, type DongKhoi } from "./khoi"
import { BangBaoCao, type DongBang } from "./bang"
import { XemNhanhChungTu, type ChungTuMo, type LoaiChungTu } from "./xem-nhanh"
import { useNap, layDanhMuc, luaChonLoc, tenGiaTri, xuatExcel } from "./dung-chung"
import { createClient } from "@/lib/supabase/client"
import { congNgay, ngayDu, ngayThang, THU_VN, thu } from "@/lib/bao-cao/ky"
import { hieuLuc, MAC_DINH_MAN } from "@/lib/bao-cao/trang-thai"
import { congBan, quaLoc, type LoaiLoc } from "@/lib/bao-cao/cong"
import { soGon, soDu, phanTram, soSanh } from "@/lib/bao-cao/so"
import { napSoBan } from "@/lib/bao-cao/nap-ban-hang"
import { napKhoanThu, napPhieuChi, tonQuy } from "@/lib/bao-cao/nap-tien"
import { fetchAllOrdersDu } from "@/lib/analytics/sales"
import { nhanTrangThaiDon } from "@/lib/bao-cao/nap-don-dat"
import { GIAI_THICH } from "@/lib/bao-cao/giai-thich"

const TRANG_THAI = ["Nháp", "Phiếu tạm", "Hoàn thành", "Đã đóng", "Đã hủy"]

export function ManCuoiNgay() {
  const bc = useBaoCao("reports", MAC_DINH_MAN["/bao-cao/cuoi-ngay"])
  const { st, dat, daoThem, veBuoc, homNay, khoaNV, xemGiaVon, orgId } = bc
  const d = st.ngay || homNay
  const E = hieuLuc(st, "tong", khoaNV)
  const view = E.xem
  const [ct, setCt] = useState<ChungTuMo | null>(null)
  const xuatRef = useRef<(() => (string | number)[][]) | null>(null)

  const nap = useNap(
    orgId
      ? async () => {
          const sb = createClient()
          const { dm, thieu } = await layDanhMuc(orgId)
          const truoc = congNgay(d, -1)
          const [ban, don, thu, chi, quy] = await Promise.all([
            napSoBan(sb, orgId, truoc, d, dm),
            fetchAllOrdersDu(sb, orgId, { from: truoc, to: d }),
            napKhoanThu(sb, d, d),
            napPhieuChi(sb, orgId, d, d),
            tonQuy(sb, orgId, d),
          ])
          return { dm, ban, don: don.rows, thu: thu.ds, chi: chi.ds, quy, thieu: thieu || ban.thieu || don.truncated || thu.thieu || chi.thieu }
        }
      : null,
    `${orgId}|${d}`
  )
  const dm = nap.data?.dm || null

  const vm = useMemo(() => {
    const x = nap.data
    if (!x || !dm) return null
    const loc = E.loc
    const hdLap = new Map(Array.from(x.ban.hoaDon.values()).map((h) => [h.id, h.nguoiLap]))
    const dongNgay = (n: string) => x.ban.dong.filter((l) => l.ngay === n && quaLoc({ kh: l.kh, nv: l.nv, nguoiTao: l.loai > 0 ? hdLap.get(l.hd) || "" : undefined }, loc, dm))
    const donNgay = (n: string) =>
      x.don.filter((o) => String(o.order_date).slice(0, 10) === n && quaLoc({ kh: o.customer_id, nv: o.sales_user_id || "", nguoiTao: o.created_by || "" }, loc, dm))
    const L = dongNgay(d)
    const T = congBan(L)
    const TP = st.soSanh ? congBan(dongNgay(congNgay(d, -1))) : null
    const O = donNgay(d)
    const song = O.filter((o) => o.status !== "cancelled")
    const OP = st.soSanh ? donNgay(congNgay(d, -1)).filter((o) => o.status !== "cancelled") : null
    const thu = x.thu.filter((t) => quaLoc({ kh: t.kh, nv: t.nv, nguoiTao: t.nguoiThu, hinhThuc: t.hinhThuc }, loc, dm))
    const tm = thu.filter((t) => t.hinhThuc === "Tiền mặt")
    const ck = thu.filter((t) => t.hinhThuc !== "Tiền mặt")
    const sum = (a: { tien: number }[]) => a.reduce((s, t) => s + t.tien, 0)
    const docs = (l: string, kind: string, f: Record<string, string> = {}) => () => daoThem({ l, v: "docs", f: { kind, ...f } })
    const kpis: TheKpi[] = [
      { id: "ot", label: "Đơn tạo", value: soDu(song.length), info: GIAI_THICH.order, delta: soSanh(song.length, OP?.length, true), onClick: docs("Đơn tạo", "orders") },
      { id: "nInv", label: "Hoá đơn đã xuất", value: soDu(T.nInv), info: GIAI_THICH.nInv, delta: soSanh(T.nInv, TP?.nInv, true), onClick: docs("Hoá đơn", "inv") },
      { id: "rev", label: "Doanh thu", value: soGon(T.rev), info: GIAI_THICH.rev, delta: soSanh(T.rev, TP?.rev, true), onClick: docs("Hoá đơn", "inv") },
      { id: "ret", label: "Hàng trả", value: soGon(T.ret), info: GIAI_THICH.ret, delta: soSanh(T.ret, TP?.ret, false), onClick: docs("Phiếu trả", "ret") },
      { id: "net", label: "Doanh thu thuần", value: soGon(T.net), info: GIAI_THICH.net, delta: soSanh(T.net, TP?.net, true) },
      ...(xemGiaVon ? [{ id: "gp", label: "Lãi gộp", value: soGon(T.gp), info: GIAI_THICH.gp, sub: `Biên ${phanTram(T.net ? T.gp / T.net : 0)}`, delta: soSanh(T.gp, TP?.gp, true) } satisfies TheKpi] : []),
    ]
    const tien: DongKhoi[] = [
      { label: "Tiền mặt thu", sub: `${tm.length} khoản thu`, value: soDu(sum(tm)), onClick: docs("Thu tiền mặt", "rcash") },
      { label: "Chuyển khoản thu", sub: `${ck.length} khoản thu`, value: soDu(sum(ck)), onClick: docs("Thu chuyển khoản", "rbank") },
      { label: "Chi trong ngày", sub: `${x.chi.length} phiếu chi`, value: soDu(sum(x.chi)), onClick: docs("Phiếu chi", "pay") },
      { label: "Tồn quỹ cuối ngày", sub: "Tiền mặt và tiền gửi", value: soDu(x.quy), bold: true, info: GIAI_THICH.cashEnd },
    ]
    const trangThai: DongKhoi[] = TRANG_THAI.map((s) => {
      const a = O.filter((o) => nhanTrangThaiDon(o.status) === s)
      return {
        label: s,
        sub: soDu(a.reduce((t, o) => t + Number(o.total || 0), 0)),
        value: `${a.length} đơn`,
        valueTone: s === "Đã hủy" && a.length ? ("muted" as const) : undefined,
        onClick: a.length ? docs(s, "orders", { status: s }) : undefined,
      }
    }).filter((r, i) => i !== 0 || r.value !== "0 đơn")
    let bang: React.ReactNode = null
    let tenXuat = "Theo nhân viên"
    if (view === "docs") {
      const kind = String(E.co.kind || "")
      type D = DongBang & { id: string; loai: LoaiChungTu; ngay: string; doiTuong: string; dien: string; tien: number }
      let ds: D[] = []
      let doiTuongL = "Khách"
      let dienL = "Diễn giải"
      if (kind === "orders") {
        dienL = "Trạng thái"
        ds = O.filter((o) => !E.co.status || nhanTrangThaiDon(o.status) === E.co.status).map((o) => ({ _n: o.order_code, id: o.id, loai: "don", ngay: d, doiTuong: tenGiaTri(dm, "cust", o.customer_id), dien: nhanTrangThaiDon(o.status), tien: Number(o.total || 0) }))
      } else if (kind === "inv") {
        dienL = "Nhân viên"
        const m = new Map<string, number>()
        for (const l of L) if (l.loai > 0) m.set(l.hd, (m.get(l.hd) || 0) + l.tien)
        ds = Array.from(m.entries()).map(([id, tien]) => {
          const h = x.ban.hoaDon.get(id)!
          return { _n: h.ma, id, loai: "hd", ngay: h.ngay, doiTuong: tenGiaTri(dm, "cust", h.kh), dien: tenGiaTri(dm, "staff", h.nv), tien }
        })
      } else if (kind === "ret") {
        ds = x.ban.phieuTra
          .filter((r) => r.ngay === d && quaLoc({ kh: r.kh, nv: r.nv }, loc, dm))
          .map((r) => ({ _n: r.ma, id: r.id, loai: "tra", ngay: r.ngay, doiTuong: tenGiaTri(dm, "cust", r.kh), dien: [r.lyDo, r.loai].filter(Boolean).join(" · "), tien: r.tien }))
      } else if (kind === "rcash" || kind === "rbank") {
        ds = (kind === "rcash" ? tm : ck).map((t) => ({ _n: t.maHd ? `Thu ${t.maHd}` : "Khoản thu", id: t.id, loai: "thu", ngay: t.ngay, doiTuong: tenGiaTri(dm, "cust", t.kh), dien: `${t.hinhThuc} · ${tenGiaTri(dm, "staff", t.nguoiThu)}`, tien: t.tien }))
      } else if (kind === "pay") {
        doiTuongL = "Đối tượng"
        ds = x.chi.map((c) => ({ _n: c.ma || (c.loai === "ncc" ? "Trả NCC" : "Phiếu chi"), id: c.id, loai: "chi", ngay: c.ngay, doiTuong: c.nhom, dien: c.dien, tien: c.tien }))
      }
      tenXuat = "Chứng từ"
      bang = (
        <BangBaoCao<D>
          khoa={`cn:docs:${kind}:${String(E.co.status || "")}`}
          tieuDe="Chứng từ"
          phu={`${ds.length} chứng từ`}
          cotDau="Chứng từ"
          cot={[
            { k: "doiTuong", label: doiTuongL, f: "text", v: (r) => r.doiTuong },
            { k: "dien", label: dienL, f: "text", v: (r) => r.dien },
            { k: "tien", label: "Số tiền", f: "money", v: (r) => r.tien, bold: true },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", tien: ds.reduce((s, r) => s + r.tien, 0) } as D}
          sapMacDinh={{ k: "tien", dir: -1 }}
          chinh="tien"
          onDong={(r) => (r.loai === "chi" && kind === "pay" && x.chi.find((c) => c.id === r.id)?.loai === "ncc" ? null : () => setCt({ loai: r.loai, id: r.id }))}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    } else {
      type D = DongBang & { k: string; n: number; net: number; thu: number }
      const nvs = new Set<string>([...song.map((o) => o.sales_user_id || ""), ...L.map((l) => l.nv), ...thu.map((t) => t.nv)])
      const ds: D[] = Array.from(nvs).map((nv) => ({
        _n: tenGiaTri(dm, "staff", nv),
        k: nv,
        n: song.filter((o) => (o.sales_user_id || "") === nv).length,
        net: congBan(L.filter((l) => l.nv === nv)).net,
        thu: sum(thu.filter((t) => t.nv === nv)),
      }))
      bang = (
        <BangBaoCao<D>
          khoa="cn:staff"
          tieuDe="Theo nhân viên"
          phu="Đối chiếu khi nhân viên nộp tiền"
          cotDau="Nhân viên"
          cot={[
            { k: "n", label: "Số đơn", f: "int", v: (r) => r.n },
            { k: "net", label: "DT thuần", f: "money", v: (r) => r.net, bold: true },
            { k: "thu", label: "Đã thu", f: "money", v: (r) => r.thu },
          ]}
          dong={ds}
          tong={{ _n: "Tổng", k: "", n: song.length, net: T.net, thu: sum(thu) }}
          sapMacDinh={{ k: "net", dir: -1 }}
          chinh="net"
          onDong={(r) => () => daoThem({ l: r._n, v: "docs", f: { kind: "inv", staff: r.k } })}
          xemGiaVon={xemGiaVon}
          xuatRef={xuatRef}
        />
      )
    }
    return { kpis, tien, trangThai, bang, tenXuat, T, song, soDon: O.length, thu: { tm: sum(tm), ck: sum(ck) }, chi: sum(x.chi), quy: x.quy, rong: !O.length && !L.length && !thu.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nap.data, dm, JSON.stringify(E), view, d, st.soSanh, xemGiaVon])

  const nhanNgay = `${d === homNay ? "Hôm nay" : THU_VN[thu(d)]} ${ngayThang(d)}`
  const dao: MatDao[] = [{ label: `Cuối ngày ${ngayThang(d)}`, onClick: () => veBuoc(0) }, ...st.dao.map((s, i) => ({ label: s.l, onClick: () => veBuoc(i + 1) }))]
  const loai: LoaiLoc[] = [...(khoaNV ? [] : (["staff"] as LoaiLoc[])), "creator", "cust", "pay"]
  const inA5 = () => {
    const html = document.documentElement
    html.setAttribute("data-print-mode", "cuoi-ngay")
    requestAnimationFrame(() => {
      window.print()
      setTimeout(() => html.removeAttribute("data-print-mode"), 200)
    })
  }
  return (
    <>
      <KhungBaoCao
        href="/bao-cao/cuoi-ngay"
        role={bc.user?.role}
        dao={dao}
        onBoDao={() => veBuoc(0)}
        onIn={vm ? inA5 : null}
        nhanIn="In báo cáo cuối ngày"
        onXuat={bc.xuatFile ? () => xuatExcel(`Cuối ngày ${ngayDu(d)} · ${vm?.tenXuat || ""}`, xuatRef.current?.()) : null}
        thanhLoc={
          <ThanhLoc
            che="day"
            homNay={homNay}
            ngay={d}
            onNgay={(n) => dat({ ngay: n === homNay ? null : n, dao: [] })}
            soSanh={{ bat: st.soSanh, nhan: "So với hôm trước", onDoi: () => dat({ soSanh: !st.soSanh }) }}
            loai={loai}
            loc={st.loc}
            luaChon={(k) => luaChonLoc(dm, k)}
            onLoc={(k, vals) => dat({ loc: { ...st.loc, [k]: vals } })}
            onBoHet={() => dat({ loc: {} })}
            khoaNV={khoaNV ? bc.user?.full_name || "Tôi" : null}
            capNhat={nap.capNhat}
            onTaiLai={nap.taiLai}
          />
        }
      >
        {bc.loading || (nap.dangTai && !vm) ? (
          <DangTai soThe={6} />
        ) : nap.loi ? (
          <LoiDocSo text={`Đọc số cuối ngày hỏng: ${nap.loi}. Màn này không hiện số 0 thay cho phần lỗi.`} onThuLai={nap.taiLai} />
        ) : vm ? (
          <>
            {nap.data?.thieu && <ChuaDu text="Số liệu quá lớn, đang hiện 20.000 dòng đầu." />}
            <HangKpi kpis={vm.kpis} />
            {vm.rong && !st.dao.length ? (
              <KhongCoSo text={`${nhanNgay} chưa có đơn, hoá đơn hay khoản thu nào — xem ngày trước?`} nut={{ label: "Xem ngày trước", onClick: () => dat({ ngay: congNgay(d, -1), dao: [] }) }} />
            ) : (
              <>
                {view !== "docs" && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <KhoiDanhSach tieuDe="Tiền trong ngày" phai={ngayDu(d)} dong={vm.tien} testId="bc-tien-ngay" />
                    <KhoiDanhSach tieuDe="Trạng thái đơn trong ngày" phai={`${vm.soDon} đơn`} dong={vm.trangThai} />
                  </div>
                )}
                {vm.bang}
              </>
            )}
          </>
        ) : null}
        <XemNhanhChungTu ct={ct} onDong={() => setCt(null)} />
      </KhungBaoCao>
      {vm && (
        <div className="print-cuoi-ngay-only a5-doc">
          <h1 style={{ textAlign: "center", margin: 0 }}>BÁO CÁO CUỐI NGÀY</h1>
          <p style={{ textAlign: "center", margin: "2px 0 8px" }}>Ngày {ngayDu(d)}</p>
          <table style={{ width: "100%" }}>
            <tbody>
              {[
                ["Đơn tạo", soDu(vm.song.length)],
                ["Hoá đơn đã xuất", soDu(vm.T.nInv)],
                ["Doanh thu", soDu(vm.T.rev)],
                ["Hàng trả", soDu(vm.T.ret)],
                ["Doanh thu thuần", soDu(vm.T.net)],
                ["Tiền mặt thu", soDu(vm.thu.tm)],
                ["Chuyển khoản thu", soDu(vm.thu.ck)],
                ["Chi trong ngày", soDu(vm.chi)],
                ["Tồn quỹ cuối ngày", soDu(vm.quy)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "2px 0" }}>{k}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="signatures" style={{ display: "flex", justifyContent: "space-between", marginTop: 24, textAlign: "center" }}>
            <div>
              Người lập
              <br />
              <i>(Ký, ghi rõ họ tên)</i>
            </div>
            <div>
              Kế toán
              <br />
              <i>(Ký, ghi rõ họ tên)</i>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
