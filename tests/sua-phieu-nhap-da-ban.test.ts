/**
 * Chủ nhà 06/10/2026: "Hiện tại những phiếu nhập hàng từ NCC đã bán hàng ra không sửa được, tao muốn sửa được, hãy
 * xử lý. tương tự với phiếu trả hàng ncc". Mig 235 — kịch bản SQL thật: scripts/sql/thu-235-sua-phieu-nhap-da-ban.sql
 * (13/13). Bấm thật: e2e/sua-phieu-nhap-da-ban.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const doc = (p: string) => readFileSync(p, "utf8")
const MIG = doc("supabase/migrations/235_sua_phieu_nhap_da_ban.sql")
const ham = (ten: string) => MIG.slice(MIG.indexOf(`FUNCTION public.${ten}(`), MIG.indexOf("$fn$;", MIG.indexOf(`FUNCTION public.${ten}(`)))

describe("mig 235 — sua_phieu_nhap", () => {
  const f = ham("sua_phieu_nhap")
  it("giữ lô: số đã xuất giữ nguyên trên lô (còn mới = SL mới − đã xuất), không đẻ tồn âm", () => {
    expect(f).toMatch(/qty_on_hand = r\.base - r\.da_xuat/)
    expect(f).toMatch(/IF r\.base < o\.da_xuat THEN/)
    expect(f).toMatch(/DA_XUAT_NHIEU_HON/)
  })
  it("bỏ dòng chỉ khi lô chưa xuất gì", () => {
    expect(f).toMatch(/WHERE NOT c\.dung AND c\.da_xuat <> 0/)
  })
  it("đổi giá → giá vốn phần đã xuất tính lại (dấu vết lấy lô + dòng xuất)", () => {
    expect(f).toMatch(/UPDATE stock_line_consumptions slc SET unit_cost = b\.unit_cost/)
    expect(f).toMatch(/e\.type = 'export'/)
  })
  it("công nợ sửa TẠI CHỖ (không xoá) — tiền đã trả giữ nguyên; trả dư không kẹp (partial)", () => {
    expect(f).toMatch(/UPDATE payables\s+SET amount = v_total/)
    expect(f).not.toMatch(/DELETE FROM payables/)
    expect(f).toMatch(/WHEN v_paid > 0 THEN 'partial'/)
  })
  it("chỉ phiếu đã hoàn thành, kiểm vai + NPP, ghi lại bảng giá nhập", () => {
    expect(f).toMatch(/PHIEU_CHUA_HOAN_THANH/)
    expect(f).toMatch(/NOT IN \('owner', 'manager', 'accountant', 'warehouse'\)/)
    expect(f).toMatch(/SAI_DON_VI/)
    expect(f).toMatch(/PERFORM public\._ghi_gia_nhap_tu_phieu\(p_invoice_id\)/)
  })
})

describe("mig 235 — cancel_supplier_return không kẹt lô đã đóng", () => {
  const f = ham("cancel_supplier_return")
  it("không còn chặn LO_DA_DONG; lô đã đóng thì mở lại", () => {
    expect(f).not.toMatch(/RAISE EXCEPTION 'LO_DA_DONG/)
    expect(f).toMatch(/status = CASE WHEN COALESCE\(b\.status, 'available'\) <> 'available' THEN 'available'/)
  })
  it("vẫn giữ kiểm vai (mig 166), idempotent, chặn đã cấn trừ", () => {
    expect(f).toMatch(/\(mig 166\)/)
    expect(f).toMatch(/FORBIDDEN/)
    expect(f).toMatch(/IF v_status = 'cancelled' THEN/)
    expect(f).toMatch(/DA_CAN_TRU/)
  })
})

describe("nối dây giao diện", () => {
  it("POS + điện thoại: phiếu đã hoàn thành lưu qua suaPhieuNhapDaXong, không huỷ trước", () => {
    const save = doc("src/lib/pos/save.ts")
    const pos = save.slice(save.indexOf("export async function savePosPurchase"), save.indexOf("export async function savePosSupplierReturn"))
    expect(pos).toMatch(/if \(trangThai === "completed"\) \{\s+await suaPhieuNhapDaXong\(/)
    expect(pos).not.toMatch(/cancel_purchase_invoice/)
    expect(doc("src/lib/purchasing/save-receipt.ts")).toMatch(/rpc\("sua_phieu_nhap"/)
  })
  it("khám sổ có dòng mig 235", () => {
    expect(doc("scripts/sql/kham-so-that.sql")).toMatch(/Mig 235/)
  })
})
