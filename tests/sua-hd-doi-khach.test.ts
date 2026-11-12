import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { cauDoiKhach, khachGuiLen, khoaDoiKhach } from "../src/lib/pos/invoice-edit"
import { explainInvoiceError, reissueInvoice } from "../src/lib/orders/post-invoice"
import { laManHoaDonDienThoai, showsBottomNav } from "../src/lib/nav/mobile-chrome"

/**
 * Chủ nhà 12/11/2026: "E sửa phần sửa hoá đơn cho phép đổi khách hàng (cả trên đt và pos)" — mig 261 + POS + điện thoại.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/261_sua_hd_doi_khach.sql")

describe("luật đổi khách ở màn (cùng luật máy chủ _doi_khach_lap_lai_kiem)", () => {
  it("chưa thu tiền → đổi được", () => {
    expect(khoaDoiKhach({ paidAmount: 0, receiptCount: 0, receiptErr: false })).toBeNull()
  })
  it("đã thu tiền / còn phiếu thu (kể cả số 0đ) / chưa đọc được phiếu thu → khoá, nói lý do + việc cần làm", () => {
    expect(khoaDoiKhach({ paidAmount: 50000, receiptCount: 0, receiptErr: false })).toContain("huỷ phiếu thu trước")
    expect(khoaDoiKhach({ paidAmount: 0, receiptCount: 1, receiptErr: false })).toContain("đã thu tiền")
    expect(khoaDoiKhach({ paidAmount: 0, receiptCount: 0, receiptErr: true })).toContain("Chưa đọc được phiếu thu")
  })
  it("chỉ gửi khách khi KHÁC khách cũ", () => {
    expect(khachGuiLen("k1", "k2")).toBe("k2")
    expect(khachGuiLen("k1", "k1")).toBeNull()
    expect(khachGuiLen("k1", null)).toBeNull()
    expect(khachGuiLen(undefined, undefined)).toBeNull()
  })
  it("câu báo nói rõ tên cũ → mới và những gì đổi theo", () => {
    const c = cauDoiKhach("Tạp hoá Cô Ba", "Đại lý Minh")
    expect(c).toContain("Đổi khách: Tạp hoá Cô Ba → Đại lý Minh")
    expect(c).toContain("công nợ ghi cho khách mới")
  })
})

describe("reissueInvoice gửi customer_id khi (và chỉ khi) có khách mới", () => {
  /** Sổ giả: `khachToMoi` = khách mà tờ mới THẬT SỰ mang (sổ chưa chạy mig 261 thì vẫn là khách cũ). */
  const goi = async (customerId?: string | null, khachToMoi: string = customerId ?? "k1") => {
    let gui: { p: Record<string, unknown> } | null = null
    let soLanDoc = 0
    const sb = {
      rpc: async (_fn: string, args: { p: Record<string, unknown> }) => {
        gui = args
        return { data: [{ invoice_id: "n", invoice_code: "HD-1-1" }], error: null }
      },
      from: () => {
        soLanDoc += 1
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { customer_id: khachToMoi }, error: null }) }
        return q
      },
    }
    const r = await reissueInvoice(sb as never, "inv", {
      lines: [{ productId: "p", unitName: "hộp", quantity: 1, unitPrice: 1000, conversionFactor: 1 }] as never,
      ...(customerId !== undefined ? { customerId } : {}),
    })
    return { p: gui!.p, r, soLanDoc }
  }
  it("có khách mới → p.customer_id; tờ mới đúng khách mới thì không báo gì", async () => {
    const { p, r } = await goi("k2")
    expect(p.customer_id).toBe("k2")
    expect(r.canhBaoKhach ?? null).toBeNull()
  })
  it("không có / null → không có khoá customer_id (máy chủ giữ khách của đơn), không hỏi lại sổ", async () => {
    expect((await goi()).p).not.toHaveProperty("customer_id")
    expect((await goi(null)).p).not.toHaveProperty("customer_id")
    expect((await goi()).soLanDoc).toBe(0)
  })
  it("sổ chưa chạy mig 261 (tờ mới vẫn khách cũ) → báo đỏ, nói rõ thiếu migration — không im lặng", async () => {
    const { r } = await goi("k2", "k1")
    expect(r.invoiceId).toBe("n")
    expect(r.canhBaoKhach).toContain("CHƯA đổi khách")
    expect(r.canhBaoKhach).toContain("migration 261")
  })
  it("lỗi máy chủ dịch ra câu tiếng Việt", () => {
    expect(explainInvoiceError("REISSUE_DOI_KHACH_DA_THU: hoá đơn đã thu tiền của khách cũ — huỷ phiếu thu trước rồi mới đổi khách"))
      .toBe("Chưa đổi được khách: hoá đơn đã thu tiền của khách cũ — huỷ phiếu thu trước rồi mới đổi khách")
    expect(explainInvoiceError("REISSUE_KHACH_KHONG_HOP_LE: không tìm thấy khách hàng mới, hoặc bạn không được bán cho khách này"))
      .toContain("Chưa đổi được khách: không tìm thấy khách hàng mới")
  })
})

describe("điện thoại: màn Xuất hàng / Sửa HĐ không bị thanh nav đè thanh nút", () => {
  it("hai đường dẫn của InvoiceEditor tắt nav; danh sách / chi tiết hoá đơn vẫn có nav", () => {
    expect(laManHoaDonDienThoai("/sales-invoices/new")).toBe(true)
    expect(showsBottomNav("/sales-invoices/new")).toBe(false)
    expect(showsBottomNav("/sales-invoices/00000000-0000-4000-8000-0000000000f1/edit")).toBe(false)
    expect(showsBottomNav("/sales-invoices")).toBe(true)
    expect(showsBottomNav("/sales-invoices/00000000-0000-4000-8000-0000000000f1")).toBe(true)
  })
  it("InvoiceEditor vẫn có thanh dính đáy riêng — và hai trang dùng nó là hai trang vừa tắt nav", () => {
    expect(read("src/components/orders/invoice-editor.tsx")).toMatch(/fixed inset-x-0 bottom-0/)
    expect(read("src/app/(dashboard)/sales-invoices/[id]/edit/page.tsx")).toContain("<InvoiceEditor")
  })
})

describe("ghim: màn POS + điện thoại + máy chủ", () => {
  it("POS: thẻ khách đổi được khi Sửa HĐ chưa thu tiền; lưu gửi khách qua khachGuiLen, khoá thì không gửi", () => {
    const s = read("src/components/pos/invoice-screen.tsx")
    expect(s).toContain("readOnly={!sua || !!khoaKhach}")
    expect(s).toContain("customerId: khoaKhach ? null : khachGuiLen(khachGoc?.id, khach?.id)")
    expect(s).toContain("F4: () => { if (sua && !khoaKhach) setMoTimKhach(true) }")
  })
  it("điện thoại: lưu gửi khách qua khachGuiLen, khoá thì không gửi; hộp chọn khách dùng chung với phiếu trả", () => {
    const s = read("src/components/orders/invoice-editor.tsx")
    expect(s).toContain("customerId: khoaKhach ? null : khachGuiLen(head?.customer_id, khachMoi?.id)")
    expect(s).toContain('import { ChonKhachSheet, type KhachChon } from "@/components/customers/chon-khach-sheet"')
    expect(read("src/components/returns/phieu-tra-khach-mobile.tsx")).toContain(
      'import { ChonKhachSheet } from "@/components/customers/chon-khach-sheet"'
    )
  })
  it("migration 261: VÌ SAO + lời chủ nhà, hàm nội bộ REVOKE, vá đúng 1/1 chỗ, NOTIFY + SELECT tóm tắt", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 12/11/2026")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._doi_khach_lap_lai_kiem(uuid, jsonb) FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._doi_khach_lap_lai_ap(uuid, uuid[]) FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("IF v_n1 <> 1 OR v_n2 <> 1 THEN")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst"))).toMatch(/\nSELECT/)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 100, 'Mig 261 (Sửa HĐ đổi được khách hàng)'")
    expect(read("supabase/schema_full.sql")).toContain("261 — SỬA HOÁ ĐƠN ĐỔI ĐƯỢC KHÁCH HÀNG")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(ROOT, tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-261-sua-hd-doi-khach.sql")
describe.skipIf(!BO_THU)("mig 261 trên Postgres thử", () => {
  it("17/17 dòng đạt (đơn → HĐ kèm hàng trả → phiếu trả tự lập → Sửa HĐ đổi khách → công nợ / phiếu trả / đơn; đã thu / khách không hợp lệ bị chặn)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("17|17|0")
  })
})
