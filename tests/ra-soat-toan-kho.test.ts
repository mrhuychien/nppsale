import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * RÀ SOÁT TOÀN KHO MÃ — ba lỗi HỎNG TRONG IM LẶNG.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Rảnh ngồi rà soát xem có chỗ nào ngu ngơ
 * như vậy nữa không? bàn giao code cho khách mà muối mặt".
 *
 * Ba lỗi dưới đây cùng MỘT HÌNH DẠNG: màn hình báo thành công, dữ liệu
 * thì không đúng, và KHÔNG CÓ MỘT DÒNG LỖI NÀO. Đó là loại lỗi tốn
 * nhiều tháng mới phát hiện, vì tới lúc phát hiện thì sổ sách đã lệch
 * từ lâu.
 *
 * ⚠ TỆP NÀY KHÔNG SỬA GÌ CẢ — nó ĐÓNG BĂNG con số. Mỗi danh sách dưới
 * đây là hiện trạng đã đếm được; chốt đi kèm đòi mỗi tên phải THẬT SỰ
 * còn mắc lỗi, nên sửa xong phải xoá tên, và không ai nhét thêm được
 * một màn mới vào. Danh sách chỉ có thể NGẮN ĐI.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function moiNguon(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) moiNguon(p, acc)
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

function moiTep(): string[] {
  return ["src/app", "src/components", "src/lib", "src/hooks"].flatMap((b) =>
    moiNguon(resolve(ROOT, b))
  )
}

// =====================================================================
// 1. GHI TỪ TRÌNH DUYỆT MÀ KHÔNG KIỂM SỐ DÒNG
// =====================================================================

/**
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` NULL. Đây là cái bẫy lớn
 * nhất của kho mã này, và nó được ghi thành luật ngay từ đầu: mọi
 * `update` / `delete` từ trình duyệt phải `.select("id")` rồi kiểm
 * `rows.length === 0` và ném lỗi.
 *
 * Không kiểm thì người không đủ quyền bấm "Xoá", nhận đúng một dòng
 * chữ "Đã xoá", và KHÔNG CÓ GÌ bị xoá cả. Họ đi làm việc khác, tin
 * rằng đã xong.
 *
 * ⚠ NẶNG NHẤT LÀ MẤY BẢNG TIỀN — `receivables`, `payables`, `payments`,
 * `batches`. Một lệnh ghi công nợ bị RLS nuốt là sổ khách lệch đi mà
 * không ai biết.
 */
const CON_NO_GHI_KHONG_KIEM = [
  "src/app/(dashboard)/commissions/policies/[id]/page.tsx",
  "src/app/(dashboard)/customers/page.tsx",
  "src/app/(dashboard)/customers/routes/page.tsx",
  "src/app/(dashboard)/deliveries/[id]/handover/page.tsx",
  "src/app/(dashboard)/deliveries/[id]/page.tsx",
  "src/app/(dashboard)/deliveries/[id]/settle/page.tsx",
  "src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx",
  "src/app/(dashboard)/hr/bonus-config/page.tsx",
  "src/app/(dashboard)/inventory/pending/page.tsx",
  "src/app/(dashboard)/inventory/stock-out/collect/[entryId]/page.tsx",
  "src/app/(dashboard)/inventory/stock-out/page.tsx",
  "src/app/(dashboard)/notifications/page.tsx",
  "src/app/(dashboard)/payables/[id]/page.tsx",
  "src/app/(dashboard)/products/page.tsx",
  "src/app/(dashboard)/promotions/[id]/page.tsx",
  "src/app/(dashboard)/promotions/page.tsx",
  "src/app/(dashboard)/purchasing/receipts/[id]/edit/page.tsx",
  "src/app/(dashboard)/sales/pjp/page.tsx",
  "src/app/(dashboard)/settings/org/page.tsx",
  "src/app/(dashboard)/settings/users/page.tsx",
  "src/app/(dashboard)/setup/page.tsx",
  "src/app/(dashboard)/suppliers/[id]/page.tsx",
  "src/app/(dashboard)/suppliers/page.tsx",
  "src/components/customers/customer-form.tsx",
  "src/components/customers/customer-photo-capture.tsx",
  "src/components/deliveries/pod-capture-sheet.tsx",
  "src/components/layout/notification-bell.tsx",
  "src/components/products/product-form.tsx",
  "src/components/settings/permission-matrix.tsx",
  "src/lib/misa/mark-replaced.ts",
  "src/lib/payroll/run.ts",
  "src/lib/returns.ts",
  "src/lib/workflow/sessions.ts",
]

// =====================================================================
// 2. PHÂN TRANG THEO MỘT CỘT KHÔNG DUY NHẤT
// =====================================================================

/**
 * ⚠ MỐC CHIA TRANG PHẢI DUY NHẤT. `.order("due_date").range(...)` trên
 * một cột NGÀY: hàng chục dòng cùng một ngày, và thứ tự giữa chúng do
 * máy chủ tự quyết, khác nhau giữa hai lượt gọi. Kết quả: một dòng
 * hiện ở CẢ trang 1 lẫn trang 2, còn một dòng khác KHÔNG hiện ở trang
 * nào.
 *
 * ⚠ CHỈ NGƯỜI ĐỌC KỸ MỚI THẤY, và đó là lý do nó sống lâu: danh sách
 * trông bình thường, chỉ thiếu vài dòng. Ở màn công nợ thì "thiếu vài
 * dòng" nghĩa là vài khoản nợ không ai đòi.
 *
 * ⚠ CÁCH SỬA: thêm `.order("id")` làm mốc phụ sau mốc chính. Thứ tự
 * người dùng thấy không đổi, nhưng ranh giới trang thành xác định.
 */
const CON_NO_MOC_PHAN_TRANG = [
  "src/app/(dashboard)/commissions/page.tsx",
  "src/app/(dashboard)/deliveries/page.tsx",
  "src/app/(dashboard)/finance/cash-receipts/new/page.tsx",
  "src/app/(dashboard)/finance/expenses/page.tsx",
  "src/app/(dashboard)/hr/payroll/runs/page.tsx",
  "src/app/(dashboard)/inventory/page.tsx",
  "src/app/(dashboard)/inventory/stocktake-check/page.tsx",
  "src/app/(dashboard)/invoices/page.tsx",
  "src/app/(dashboard)/notifications/page.tsx",
  "src/app/(dashboard)/orders/page.tsx",
  "src/app/(dashboard)/payables/page.tsx",
  "src/app/(dashboard)/products/page.tsx",
  "src/app/(dashboard)/purchasing/invoices/page.tsx",
  "src/app/(dashboard)/receivables/aging/page.tsx",
  "src/app/(dashboard)/receivables/by-customer/[customerId]/page.tsx",
  "src/app/(dashboard)/receivables/by-rep/[userId]/page.tsx",
  "src/app/(dashboard)/receivables/page.tsx",
  "src/app/(dashboard)/returns/new/page.tsx",
  "src/app/(dashboard)/returns/page.tsx",
  "src/app/(dashboard)/sell/drafts/page.tsx",
  "src/app/(dashboard)/suppliers/page.tsx",
]

// =====================================================================

describe("rà soát: ghi từ trình duyệt phải kiểm số dòng", () => {
  function ghiKhongKiem(src: string): boolean {
    const re = /\.from\("\w+"\)\s*\.(update|delete)\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      // Bọc trong `ghiPhaiTrungDong(` là đã kiểm — hàm ấy tự `.select()` và
      // ném khi 0 dòng. Tìm lùi tới đầu câu lệnh (dấu `;` hoặc `{` gần nhất).
      const dau = Math.max(0, src.lastIndexOf(";", m.index), src.lastIndexOf("{", m.index))
      if (src.slice(dau, m.index).includes("ghiPhaiTrungDong(")) continue
      if (!src.slice(m.index, m.index + 600).includes(".select(")) return true
    }
    return false
  }

  it("không tệp nào MỚI ghi mà không kiểm số dòng", () => {
    const bad: string[] = []
    for (const abs of moiTep()) {
      const rel = abs.slice(ROOT.length + 1)
      if (rel.includes("app/api/")) continue
      if (CON_NO_GHI_KHONG_KIEM.includes(rel)) continue
      if (ghiKhongKiem(code(readFileSync(abs, "utf-8")))) bad.push(rel)
    }
    expect(
      bad,
      "update/delete từ trình duyệt mà không `.select(\"id\")` rồi kiểm số " +
        "dòng — RLS từ chối trả về 0 dòng kèm HTTP 200 và `error` null, nên " +
        "màn hình báo thành công cho một việc chưa hề xảy ra:\n  " + bad.join("\n  ")
    ).toEqual([])
  })

  it("mỗi tệp trong danh sách nợ đều thật sự còn mắc lỗi", () => {
    for (const rel of CON_NO_GHI_KHONG_KIEM) {
      expect(
        ghiKhongKiem(code(read(rel))),
        `${rel} đã kiểm số dòng — xoá tên nó khỏi CON_NO_GHI_KHONG_KIEM`
      ).toBe(true)
    }
  })

  /** ⚠ Phép quét phải còn nhận ra mẫu — nếu không nó xanh vì mù. */
  it("phép quét còn nhận ra được mẫu ấy", () => {
    expect(ghiKhongKiem('await supabase.from("customers").delete().eq("id", id)')).toBe(true)
    expect(
      ghiKhongKiem('const { data } = await supabase.from("customers").delete().eq("id", id).select("id")')
    ).toBe(false)
    expect(
      ghiKhongKiem('await ghiPhaiTrungDong(\n  supabase.from("customers").delete().eq("id", id)\n)')
    ).toBe(false)
    // Bọc ở câu lệnh TRƯỚC không che được câu lệnh sau.
    expect(
      ghiKhongKiem('await ghiPhaiTrungDong(q); await supabase.from("customers").delete().eq("id", id)')
    ).toBe(true)
  })
})

describe("rà soát: mốc phân trang phải duy nhất", () => {
  function mocKhongDuyNhat(src: string): boolean {
    const re = /\.order\("(\w+)"[^)]*\)\s*\.range\(|\.range\([^)]*\)\s*\.order\("(\w+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if ((m[1] || m[2]) !== "id") return true
    }
    return false
  }

  it("không tệp nào MỚI phân trang theo cột không duy nhất", () => {
    const bad: string[] = []
    for (const abs of moiTep()) {
      const rel = abs.slice(ROOT.length + 1)
      if (CON_NO_MOC_PHAN_TRANG.includes(rel)) continue
      if (mocKhongDuyNhat(code(readFileSync(abs, "utf-8")))) bad.push(rel)
    }
    expect(
      bad,
      "phân trang theo một cột không duy nhất — hai dòng cùng giá trị thì " +
        "một dòng hiện ở hai trang, một dòng không hiện ở trang nào:\n  " +
        bad.join("\n  ")
    ).toEqual([])
  })

  it("mỗi tệp trong danh sách nợ đều thật sự còn mắc lỗi", () => {
    for (const rel of CON_NO_MOC_PHAN_TRANG) {
      expect(
        mocKhongDuyNhat(code(read(rel))),
        `${rel} đã có mốc duy nhất — xoá tên nó khỏi CON_NO_MOC_PHAN_TRANG`
      ).toBe(true)
    }
  })

  it("phép quét còn nhận ra được mẫu ấy", () => {
    expect(mocKhongDuyNhat('.order("due_date").range(a, b)')).toBe(true)
    expect(mocKhongDuyNhat('.order("id").range(a, b)')).toBe(false)
  })
})
