/**
 * XUẤT EXCEL MỘT PHIẾU — nút ở TRANG CHI TIẾT của 8 loại chứng từ.
 *
 * Chủ nhà 05/10/2026: "xuất excel cho chi tiết 8 loại phiếu", rồi "xuất excel như kiểu mẫu in hoá đơn ấy" — tệp là
 * MỘT tờ giống tờ in (đầu công ty, tiêu đề, khách / NCC, bảng kẻ ô, dòng tổng, bằng chữ, ô ký), dựng ở
 * `./mau-in.ts`. Hóa đơn / đơn hàng / phiếu trả khách đọc ĐÚNG như màn in của chúng (cùng cột, cùng luật trừ hàng
 * trả) để tệp Excel và tờ giấy ra cùng một số.
 *
 * ⚠ ĐỌC ĐỦ HOẶC NÉM: phiếu / dòng không đọc được thì ném (nút báo đỏ), không ra tờ thiếu dòng trông như tờ đủ.
 * ⚠ Phiếu kho: giá vốn chỉ khi người xem được giá vốn.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { docMaPhieuTra } from "@/lib/returns/ma-phieu"
import { loadOrgHeader } from "@/lib/org/header"
import { invoiceAddressOf, type CustomerAddressParts } from "@/lib/customers/address"
import { docGioSuaCuoi, gioSuaCuoi, mocInPhieuTra, ngayChungTu } from "@/lib/printing/doc-stamp"
import { creditCounted, creditOnInvoice, showCreditOnPrint, type InvoiceReturnRow } from "@/lib/orders/invoice-credit"
import { giamCuaHoaDon } from "@/lib/pos/invoice-discount"
import { ORDER_STATUS_MAP } from "@/lib/constants"
import { RECEIPT_ZONES } from "@/lib/purchasing/receipt-form"
import { RETURN_REASONS as LY_DO_TRA_NCC } from "@/lib/purchasing/return-form"
import { CASH_RECEIPT_SOURCE_LABEL, CASH_RECEIPT_STATUS_LABEL } from "@/lib/finance/cash-receipt-list"
import type { SalesInvoiceLine, SalesInvoiceReturnLine } from "@/components/printing/sales-invoice"
import type { ReturnSlipLine } from "@/components/printing/return-slip"
import { napDong, napTenNguoi } from "./nap"
import {
  CHON_DONG_THU, HINH_THUC, NHOM_CHI, TT_KHO, kho, khachDong, khoanThu, loaiKho, lyDoTra, slCoSoKho,
  type DongKho, type DongThu, type NguonDong,
} from "./cac-man"
import { HANG_NHUNG, ngayVN } from "./phieu"
import { dungMauIn, mauBanHang, mauKho, mauNcc, mauTien, mauTraKhach, type DauCongTy, type MauIn } from "./mau-in"
import type { SheetDinhDang } from "./xlsx-dinh-dang"

export type LoaiPhieuXuat = "tra-ncc" | "nhap" | "tra-khach" | "thu" | "chi" | "kho" | "don" | "hoa-don"

const KHACH_IN = "customer:customers(store_name, billing_name, billing_address, address, ward, district, province, phone)"

/** Câu chọn đầu phiếu — đủ cột cho tờ in (kèm `org_id` để đọc đầu công ty). */
export const CHON_MOT_PHIEU: Record<LoaiPhieuXuat, { bang: string; chon: string; ten: string }> = {
  "tra-ncc": {
    bang: "supplier_returns",
    chon: "id, org_id, return_code, return_date, warehouse_zone, subtotal, vat, vat_override, discount, total, status, reason, notes, created_by, supplier:suppliers(name, code)",
    ten: "phiếu trả NCC",
  },
  nhap: {
    bang: "purchase_invoices",
    chon: "id, org_id, receipt_code, invoice_number, invoice_date, status, total, warehouse_zone, subtotal, vat, vat_override, discount, notes, created_by, supplier:suppliers(name, code)",
    ten: "phiếu nhập",
  },
  "tra-khach": {
    bang: "returns",
    chon:
      `id, org_id, created_at, return_date, reason, status, credit_note_amount, notes, ${KHACH_IN}, ` +
      "requester:users!returns_requested_by_fkey(full_name), seller:users!returns_sales_user_id_fkey(full_name), " +
      "order:sales_orders(order_code), invoice:sales_invoices(invoice_code)",
    ten: "phiếu trả hàng",
  },
  thu: {
    bang: "cash_receipts",
    chon:
      "id, org_id, receipt_code, receipt_date, status, source_type, expected_amount, submitted_amount, notes, " +
      "collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name)",
    ten: "phiếu thu",
  },
  chi: {
    bang: "expenses",
    chon: "id, org_id, expense_date, amount, description, reference_code, source_type, is_paid, payment_method, created_by, category:expense_categories(name, bucket)",
    ten: "khoản chi",
  },
  kho: {
    bang: "stock_entries",
    chon: "id, org_id, entry_code, type, status, notes, created_at, posted_at, issue_reason, warehouse_zone, dest_warehouse_zone, creator:users!stock_entries_created_by_fkey(full_name)",
    ten: "phiếu kho",
  },
  don: {
    bang: "sales_orders",
    chon: `id, org_id, order_code, order_date, status, subtotal, vat, total, ${KHACH_IN}, sales_user:users!sales_orders_sales_user_id_fkey(full_name, phone)`,
    ten: "đơn hàng",
  },
  "hoa-don": {
    bang: "sales_invoices",
    chon: `id, org_id, invoice_code, invoice_date, status, subtotal, total, notes, ${KHACH_IN}, sales_user:users!sales_invoices_sales_user_id_fkey(full_name, phone), order:sales_orders(order_code)`,
    ten: "hóa đơn",
  },
}

/** Dòng của từng loại — đọc qua `napDong` (đủ trang, lỗi thì ném). */
const HANG = "product:products(name, sku)"
export const DONG_MOT_PHIEU: Record<Exclude<LoaiPhieuXuat, "chi">, NguonDong> = {
  "tra-ncc": { bang: "supplier_return_lines", cot: "return_id", chon: `id, return_id, sort_order, unit_name, quantity, unit_price, line_discount, line_total, notes, ${HANG}`, ten: "Dòng phiếu trả NCC" },
  nhap: { bang: "purchase_invoice_lines", cot: "invoice_id", chon: `id, invoice_id, sort_order, unit_name, quantity, unit_price, line_discount, line_total, notes, ${HANG}`, ten: "Dòng phiếu nhập" },
  "tra-khach": { bang: "return_lines", cot: "return_id", chon: `id, return_id, created_at, unit_name, quantity, unit_price, line_total, is_exchange, note, reason, ${HANG}`, ten: "Dòng phiếu trả" },
  thu: { bang: "cash_receipt_lines", cot: "receipt_id", chon: CHON_DONG_THU, ten: "Dòng phiếu thu" },
  kho: { bang: "stock_entry_lines", cot: "entry_id", chon: `id, entry_id, created_at, unit_name, quantity, qty_in_base_uom, conversion_factor_snapshot, unit_cost, notes, batch:batches(batch_code, expires_at), ${HANG_NHUNG}`, ten: "Dòng phiếu kho" },
  don: { bang: "sales_order_lines", cot: "order_id", chon: `id, order_id, created_at, unit_name, quantity, unit_price, line_discount, line_total, note, ${HANG}`, ten: "Dòng đơn hàng" },
  "hoa-don": { bang: "sales_invoice_lines", cot: "invoice_id", chon: `id, invoice_id, sort_order, unit_name, quantity, unit_price, line_discount, line_total, is_exchange, note, ${HANG}`, ten: "Dòng hóa đơn" },
}

type R = Record<string, unknown>
type Hang = { name?: string | null; sku?: string | null } | null | undefined
type Ten = { full_name?: string | null; phone?: string | null } | null | undefined

const so = (v: unknown) => Number(v) || 0
const chu = (v: unknown) => (typeof v === "string" ? v : "")

/** Thứ tự dòng như trên chứng từ: `sort_order`, rồi giờ tạo, rồi id. */
export function xepDong<T extends R>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      so(a.sort_order) - so(b.sort_order) ||
      chu(a.created_at).localeCompare(chu(b.created_at)) ||
      chu(a.id).localeCompare(chu(b.id))
  )
}

async function napDongMot<T extends R>(sb: SupabaseClient, loai: Exclude<LoaiPhieuXuat, "chi">, id: string): Promise<T[]> {
  return xepDong(await napDong<T>(sb, DONG_MOT_PHIEU[loai], [id]))
}

const huyTrangThai = (st: unknown) => st === "cancelled" || st === "voided"

/** Mã hiện trên tên tệp. */
function maCua(loai: LoaiPhieuXuat, p: R, maTra?: string): string {
  switch (loai) {
    case "tra-ncc": return chu(p.return_code)
    case "nhap": return chu(p.receipt_code) || chu(p.invoice_number)
    case "tra-khach": return maTra || ""
    case "thu": return chu(p.receipt_code)
    case "chi": return chu(p.reference_code) || chu(p.expense_date)
    case "kho": return chu(p.entry_code)
    case "don": return chu(p.order_code)
    case "hoa-don": return chu(p.invoice_code)
  }
}

export interface MotPhieuXuat {
  /** Tờ "như mẫu in" (một sheet). */
  sheets: SheetDinhDang[]
  /** Mã phiếu (để đặt tên tệp / báo lại); rỗng khi phiếu chưa có mã. */
  ma: string
}

const dongBan = (l: R): SalesInvoiceLine => ({
  id: chu(l.id),
  name: (l.product as Hang)?.name || "—",
  spec: (l.product as Hang)?.sku || null,
  unitName: chu(l.unit_name),
  quantity: so(l.quantity),
  unitPrice: so(l.unit_price),
  discount: so(l.line_discount),
  lineTotal: so(l.line_total),
  note: (l.note as string | null) ?? null,
})

type PhieuTraCuaDon = InvoiceReturnRow & { credit_note_amount?: number | null; credit_with_invoice?: boolean | null }
const dongTraIn = (r: { lines?: R[] | null }): SalesInvoiceReturnLine[] =>
  (r.lines ?? []).map((l) => ({
    id: chu(l.id),
    name: (l.product as Hang)?.name || "Sản phẩm đã xoá",
    unitName: chu(l.unit_name),
    quantity: so(l.quantity),
    unitPrice: so(l.unit_price),
    credit: l.is_exchange ? 0 : Math.max(0, so(l.line_total)),
    isExchange: l.is_exchange === true,
  }))
const CHON_TRA_KEM = "id, status, credit_note_amount, credit_with_invoice, lines:return_lines(id, unit_name, quantity, unit_price, line_total, is_exchange, product:products(name))"

async function mauCua(sb: SupabaseClient, loai: LoaiPhieuXuat, id: string, p: R, org: DauCongTy, giaVon: boolean): Promise<{ mau: MauIn; maTra?: string }> {
  switch (loai) {
    /* ---------------------------------------------------------------- Hóa đơn bán — như /sales-invoices/[id]/print */
    case "hoa-don": {
      const [lines, ret, eInv] = await Promise.all([
        napDongMot<R>(sb, "hoa-don", id),
        sb.from("returns").select(CHON_TRA_KEM).eq("invoice_id", id),
        sb.from("invoices").select("misa_inv_no").eq("sales_invoice_id", id)
          .order("misa_inv_no", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ])
      if (ret.error) throw new Error(`Không đọc được phiếu trả của hóa đơn: ${ret.error.message}`)
      /* Như màn in: không đọc được tờ điện tử thì coi như chưa phát hành (bảng / cột cũ có thể chưa có). */
      const daPhatHanh = !eInv.error && !!(eInv.data as { misa_inv_no?: string | null } | null)?.misa_inv_no
      const tra = (ret.data ?? []) as unknown as PhieuTraCuaDon[]
      const credit = creditOnInvoice(tra)
      const inTru = showCreditOnPrint({ credit, eInvoiceIssued: daPhatHanh }) ? credit : 0
      const kh = (p.customer ?? {}) as CustomerAddressParts & { store_name?: string | null; billing_name?: string | null; phone?: string | null }
      const nv = p.sales_user as Ten
      const ma = chu(p.invoice_code)
      return {
        mau: mauBanHang({
          ten: ma || "Hóa đơn",
          org,
          tieuDe: "HÓA ĐƠN BÁN HÀNG",
          nhanSo: "Số HĐ",
          so: ma,
          ngay: ngayChungTu(chu(p.invoice_date)),
          coGio: false,
          khach: kh.billing_name || kh.store_name || "",
          diaChi: invoiceAddressOf(kh),
          lienHe: kh.phone,
          nhanVien: nv?.full_name,
          dtNhanVien: nv?.phone,
          /* Bỏ dòng hàng đổi xuất đi trên tờ in (chủ nhà chốt) — vẫn là dòng hóa đơn thật trong sổ. */
          lines: lines.filter((l) => !l.is_exchange).map(dongBan),
          total: so(p.total),
          giamDon: p.subtotal == null ? 0 : giamCuaHoaDon(lines as never, p.subtotal as number),
          traHang: inTru,
          dongTra: inTru ? tra.filter(creditCounted).flatMap((r) => dongTraIn(r as unknown as { lines?: R[] })) : [],
          ghiChu: [{ label: "Ghi chú hóa đơn", text: p.notes as string | null }],
          chanTrai:
            p.status === "posted"
              ? (p.order as { order_code?: string | null } | null)?.order_code
                ? `Theo đơn ${(p.order as { order_code: string }).order_code}`
                : null
              : "⚠ HÓA ĐƠN ĐÃ HUỶ — không có giá trị thanh toán.",
        }),
      }
    }
    /* ---------------------------------------------------------------- Đơn hàng — như /orders/[id]/print */
    case "don": {
      const [lines, ret] = await Promise.all([
        napDongMot<R>(sb, "don", id),
        sb.from("returns").select(CHON_TRA_KEM).eq("order_id", id).neq("status", "cancelled"),
      ])
      if (ret.error) throw new Error(`Không đọc được phiếu trả của đơn: ${ret.error.message}`)
      const dongTra = ((ret.data ?? []) as unknown as Array<{ lines?: R[] }>).flatMap(dongTraIn)
      const kh = (p.customer ?? {}) as CustomerAddressParts & { store_name?: string | null; billing_name?: string | null; phone?: string | null }
      const nv = p.sales_user as Ten
      const st = ORDER_STATUS_MAP[chu(p.status)]
      const ma = chu(p.order_code)
      return {
        mau: mauBanHang({
          ten: ma || "Đơn hàng",
          org,
          tieuDe: "ĐƠN ĐẶT HÀNG",
          nhanSo: "Số ĐH",
          so: ma,
          ngay: ngayChungTu(chu(p.order_date)),
          coGio: false,
          khach: kh.billing_name || kh.store_name || "",
          diaChi: invoiceAddressOf(kh),
          lienHe: kh.phone,
          nhanVien: nv?.full_name,
          dtNhanVien: nv?.phone,
          lines: lines.map(dongBan),
          /* Tiền hàng = subtotal + vat (total đã trừ hàng trả rồi kẹp 0 — xem màn in đơn). */
          total: p.subtotal != null ? so(p.subtotal) + so(p.vat) : so(p.total),
          giamDon: p.subtotal == null ? 0 : giamCuaHoaDon(lines as never, p.subtotal as number),
          traHang: dongTra.reduce((s, l) => s + (l.credit || 0), 0),
          dongTra,
          chanTrai:
            p.status === "cancelled"
              ? "⚠ ĐƠN ĐÃ HUỶ — không có giá trị."
              : `Đơn đặt hàng — chưa phải chứng từ thanh toán.${st ? ` Trạng thái: ${st.label}.` : ""}`,
        }),
      }
    }
    /* ---------------------------------------------------------------- Phiếu trả khách — như /returns/[id]/print */
    case "tra-khach": {
      const [lines, maMap, gioSua] = await Promise.all([
        napDongMot<R>(sb, "tra-khach", id),
        docMaPhieuTra(sb, [id]),
        docGioSuaCuoi(sb as never, "returns", id),
      ])
      const maTra = maMap.get(id)
      const kh = (p.customer ?? {}) as CustomerAddressParts & { store_name?: string | null; billing_name?: string | null; phone?: string | null }
      const doi = (l: R): ReturnSlipLine => ({
        id: chu(l.id),
        name: (l.product as Hang)?.name || "Sản phẩm đã xoá",
        sku: (l.product as Hang)?.sku ?? null,
        unitName: chu(l.unit_name),
        quantity: so(l.quantity),
        unitPrice: so(l.unit_price),
        lineTotal: Math.max(0, so(l.line_total)),
        /* Lý do trùng lý do phiếu thì khỏi lặp trên từng dòng. */
        reason: !l.is_exchange && l.reason && l.reason !== p.reason ? lyDoTra(l.reason as string) : null,
        note: (l.note as string | null) ?? null,
      })
      const tra = lines.filter((l) => !l.is_exchange).map(doi)
      const moc = mocInPhieuTra(gioSuaCuoi(gioSua, chu(p.created_at)), chu(p.return_date) || null)
      const inv = p.invoice as { invoice_code?: string | null } | null
      const ord = p.order as { order_code?: string | null } | null
      return {
        maTra,
        mau: mauTraKhach({
          org,
          ma: maTra,
          ngay: moc.at,
          coGio: moc.hasTime,
          theo: inv?.invoice_code ? `HĐ ${inv.invoice_code}` : ord?.order_code ? `đơn ${ord.order_code}` : null,
          khach: kh.billing_name || kh.store_name || "",
          diaChi: invoiceAddressOf(kh),
          lienHe: kh.phone,
          nhanVien: (p.seller as Ten)?.full_name,
          nguoiLap: (p.requester as Ten)?.full_name,
          lyDo: lyDoTra(p.reason as string | null) || null,
          tra,
          doi: lines.filter((l) => l.is_exchange).map(doi),
          credit: p.credit_note_amount == null ? tra.reduce((s, l) => s + l.lineTotal, 0) : so(p.credit_note_amount),
          ghiChu: p.notes as string | null,
          huy: huyTrangThai(p.status),
        }),
      }
    }
    /* ---------------------------------------------------------------- Phiếu nhập / trả NCC */
    case "nhap":
    case "tra-ncc": {
      const nhap = loai === "nhap"
      const [lines, ten] = await Promise.all([napDongMot<R>(sb, loai, id), napTenNguoi(sb, [p.created_by as string | null])])
      const ncc = p.supplier as { name?: string | null; code?: string | null } | null
      const zone = chu(p.warehouse_zone)
      return {
        mau: mauNcc({
          loai: nhap ? "nhap" : "tra",
          org,
          ma: chu(nhap ? p.receipt_code : p.return_code),
          ngay: ngayChungTu(chu(nhap ? p.invoice_date : p.return_date)),
          ncc: ncc?.name || "",
          maNcc: ncc?.code,
          soHdNcc: p.invoice_number as string | null,
          kho: nhap ? RECEIPT_ZONES.find((z) => z.value === zone)?.label ?? kho(zone) : kho(zone),
          lyDo: nhap ? null : LY_DO_TRA_NCC.find((r) => r.value === p.reason)?.label ?? (p.reason as string | null),
          dong: lines.map((l) => ({
            ten: (l.product as Hang)?.name || "Không rõ mặt hàng",
            ma: (l.product as Hang)?.sku,
            dvt: chu(l.unit_name),
            sl: so(l.quantity),
            gia: so(l.unit_price),
            ck: so(l.line_discount),
            thanhTien: so(l.line_total),
            ghiChu: l.notes as string | null,
          })),
          tienHang: so(p.subtotal),
          /* Tiền thuế gõ tay theo giấy NCC thắng tiền máy cộng (mig 146). */
          vat: so(p.vat_override ?? p.vat),
          giam: so(p.discount),
          tong: so(p.total),
          ghiChu: p.notes as string | null,
          nguoiLap: p.created_by ? ten.get(p.created_by as string) : null,
          huy: huyTrangThai(p.status),
        }),
      }
    }
    /* ---------------------------------------------------------------- Phiếu kho */
    case "kho": {
      const lines = await napDongMot<R>(sb, "kho", id)
      const loaiTen = loaiKho(chu(p.type))
      return {
        mau: mauKho({
          org,
          ma: chu(p.entry_code),
          loai: loaiTen,
          ngay: p.created_at ? new Date(chu(p.created_at)) : null,
          kho: kho(p.warehouse_zone as string | null),
          khoDich: kho(p.dest_warehouse_zone as string | null) || null,
          lyDo: p.issue_reason as string | null,
          trangThai: TT_KHO[chu(p.status) || "posted"] ?? chu(p.status),
          giaVon,
          dong: lines.map((l) => {
            const d = l as unknown as DongKho
            const lo = d.batch
            return {
              ten: d.product?.name || "Không rõ mặt hàng",
              ma: d.product?.sku,
              dvt: d.unit_name || "",
              sl: so(d.quantity),
              lo: lo?.batch_code ?? null,
              han: lo?.expires_at ? `HSD ${ngayVN(lo.expires_at)}` : null,
              /* `unit_cost` là giá MỖI ĐƠN VỊ CƠ SỞ → giá trị = SL cơ sở × giá. */
              giaTri: giaVon ? slCoSoKho(d) * so(d.unit_cost) : null,
              ghiChu: d.notes ?? null,
            }
          }),
          ghiChu: p.notes as string | null,
          nguoiLap: (p.creator as Ten)?.full_name,
          huy: huyTrangThai(p.status),
        }),
      }
    }
    /* ---------------------------------------------------------------- Phiếu thu */
    case "thu": {
      const lines = await napDongMot<R>(sb, "thu", id)
      const dong = lines as unknown as DongThu[]
      const khach = Array.from(new Set(dong.map(khachDong).filter(Boolean)))
      const tong = so(p.expected_amount)
      const nop = p.submitted_amount == null ? null : so(p.submitted_amount)
      return {
        mau: mauTien({
          loai: "thu",
          org,
          ma: chu(p.receipt_code),
          ngay: ngayChungTu(chu(p.receipt_date)),
          thongTin: [
            ["Khách hàng", khach.join(", ") || "—", true],
            ["Người thu", (p.collector as Ten)?.full_name],
            ["Nguồn", CASH_RECEIPT_SOURCE_LABEL[chu(p.source_type)] ?? (p.source_type as string | null)],
            ["Trạng thái", CASH_RECEIPT_STATUS_LABEL[chu(p.status)] ?? chu(p.status)],
          ],
          dong: dong.map((l) => {
            const k = khoanThu(l)
            const noiDung =
              k === "Hóa đơn" ? `Hóa đơn ${l.invoice?.invoice_code}` : k === "Đơn hàng (cũ)" ? `Đơn hàng ${l.order?.order_code} (cũ)` : k
            return { noiDung, ngay: ngayVN(l.invoice?.invoice_date) || null, doiTac: khachDong(l) || null, soTien: so(l.amount) }
          }),
          tong,
          tongPhu: nop != null && Math.round(nop) !== Math.round(tong) ? [["Đã nộp", nop]] : [],
          ghiChu: p.notes as string | null,
          nguoiLap: (p.creator as Ten)?.full_name,
          huy: huyTrangThai(p.status),
        }),
      }
    }
    /* ---------------------------------------------------------------- Phiếu chi (khoản chi phí) */
    case "chi": {
      const ten = await napTenNguoi(sb, [p.created_by as string | null])
      const dm = p.category as { name?: string | null; bucket?: string | null } | null
      const ht = p.payment_method ? HINH_THUC[chu(p.payment_method)] ?? chu(p.payment_method) : ""
      return {
        mau: mauTien({
          loai: "chi",
          org,
          ma: chu(p.reference_code) || null,
          ngay: ngayChungTu(chu(p.expense_date)),
          thongTin: [
            ["Danh mục", `${dm?.name || "—"}${dm ? ` (${NHOM_CHI[dm.bucket || "other"] ?? dm.bucket})` : ""}`, true],
            ["Hình thức", ht],
            ["Trạng thái", p.is_paid ? "Đã trả" : "Chưa trả"],
            ["Nguồn", p.source_type ? `Tự sinh: ${p.source_type}` : "Nhập tay"],
          ],
          dong: [{ noiDung: chu(p.description) || dm?.name || "Chi phí", ngay: dm?.name ?? null, doiTac: ht || null, soTien: so(p.amount) }],
          tong: so(p.amount),
          nguoiLap: p.created_by ? ten.get(p.created_by as string) : null,
        }),
      }
    }
  }
}

export async function xuatMotPhieu(
  supabase: SupabaseClient,
  loai: LoaiPhieuXuat,
  id: string,
  o: { giaVon?: boolean } = {}
): Promise<MotPhieuXuat> {
  const c = CHON_MOT_PHIEU[loai]
  const { data, error } = await supabase.from(c.bang).select(c.chon).eq("id", id).maybeSingle()
  if (error) throw new Error(`Không đọc được ${c.ten}: ${error.message}`)
  if (!data) throw new Error(`Không tìm thấy ${c.ten}`)
  const p = data as unknown as R
  /* Đầu công ty qua `loadOrgHeader` (địa chỉ / điện thoại nằm trong `settings`), như mọi tờ in. */
  const [org, kq] = await Promise.all([
    p.org_id ? loadOrgHeader(supabase, p.org_id as string) : Promise.resolve({ name: "", address: "", phone: "" }),
    mauCua(supabase, loai, id, p, {}, !!o.giaVon),
  ])
  const mau = { ...kq.mau, org: { name: org.name, address: org.address, phone: org.phone } }
  return { sheets: [dungMauIn(mau)], ma: maCua(loai, p, kq.maTra) }
}
