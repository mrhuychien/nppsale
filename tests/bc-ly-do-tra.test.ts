/** Chủ nhà 27/09/2026: "khu vực trả hàng lý do trả vẫn còn tiếng Anh". */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { nhanLyDoTra } from "@/lib/constants"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { danhMucRong } from "@/lib/bao-cao/cong"

describe("lý do trả hiện tiếng Việt", () => {
  it("mã → nhãn; chữ gõ tay giữ nguyên; rỗng → rỗng", () => {
    expect(nhanLyDoTra("damaged")).toBe("Hàng hư hỏng")
    expect(nhanLyDoTra("near_expiry")).toBe("Gần hết hạn")
    expect(nhanLyDoTra("Khách đổi ý")).toBe("Khách đổi ý")
    expect(nhanLyDoTra(null)).toBe("")
  })
  it("khối Hàng trả trong kỳ (Bán hàng, Cuối ngày) nhận nhãn tiếng Việt", () => {
    const out = dungDongBan({
      hoaDon: [], dongHd: [], dongTra: [],
      tra: [{ id: "r1", status: "completed", customer_id: "k1", credit_note_amount: -100, created_at: "2026-09-26", sales_user_id: null, invoice_id: null, ma: "TH-1", lyDo: "near_expiry", tuSinh: true }],
      giaVonCoSo: new Map(), giaVonTra: new Map(), nvTra: new Map(), dm: danhMucRong(),
    })
    expect(out.phieuTra[0].lyDo).toBe("Gần hết hạn")
  })
  it("xem nhanh phiếu trả dùng cùng nhãn", () => {
    expect(readFileSync("src/components/bao-cao/xem-nhanh.tsx", "utf8")).toContain('["Lý do", nhanLyDoTra(')
  })
})
