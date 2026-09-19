import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  shouldAssignToCreator,
  assignCustomerToCreator,
  assignNote,
} from "../src/lib/customers/assign-creator"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const FORM = read("src/components/customers/customer-form.tsx")
const DETAIL = read("src/app/(dashboard)/customers/[id]/page.tsx")
const CARD = read("src/components/customers/customer-profile-card.tsx")

/** Client giả: chỉ cần `.rpc()`. */
const client = (res: { data?: unknown; error?: { message: string } | null }) =>
  ({ rpc: vi.fn().mockResolvedValue({ data: res.data ?? null, error: res.error ?? null }) }) as unknown as
    SupabaseClient & { rpc: ReturnType<typeof vi.fn> }

describe("Phân công cho người vừa tạo điểm bán", () => {
  /**
   * ⚠ LÝ DO TÍNH NĂNG NÀY TỒN TẠI. RLS cho NVBH chỉ thấy khách ĐƯỢC PHÂN
   * CÔNG. NVBH đứng tại cửa hàng tạo điểm bán mới, xong không mở lại
   * được chính cái mình vừa nhập — phải chờ quản lý phân công tay.
   */
  it("NVBH tạo thì tự nhận tuyến", async () => {
    const c = client({ data: { status: "claimed", role: "primary" } })
    const r = await assignCustomerToCreator(c, { customerId: "kh-1", role: "sales" })
    expect(r).toEqual({ kind: "assigned", role: "primary" })
    expect(c.rpc).toHaveBeenCalledWith("claim_customer_for_me", { p_customer_id: "kh-1" })
  })

  /**
   * ⚠ CỐ Ý CHỈ `sales`. Chủ NPP / quản lý tạo điểm bán là nhập liệu hành
   * chính, không phải nhận tuyến. Gán họ làm phụ trách CHÍNH thì NVBH
   * thật sau này chỉ còn chỗ 'secondary', và ghế 'primary' bị chiếm bởi
   * người không đi tuyến.
   */
  it("chủ NPP và quản lý KHÔNG tự nhận tuyến", async () => {
    expect(shouldAssignToCreator("sales")).toBe(true)
    for (const role of ["owner", "manager", "warehouse", "accountant", "driver", "", null, undefined]) {
      expect(shouldAssignToCreator(role), `vai trò ${role}`).toBe(false)
    }
    const c = client({})
    const r = await assignCustomerToCreator(c, { customerId: "kh-1", role: "owner" })
    expect(r.kind).toBe("skipped")
    // Và KHÔNG gọi RPC — RPC đó tự ném lỗi với vai trò khác sales.
    expect(c.rpc).not.toHaveBeenCalled()
  })

  /** Điểm bán đã có người phụ trách chính thì vào ghế phụ, không tranh. */
  it("đã có người phụ trách chính thì nhận ghế phụ", async () => {
    const c = client({ data: { status: "claimed", role: "secondary" } })
    const r = await assignCustomerToCreator(c, { customerId: "kh-1", role: "sales" })
    expect(r).toEqual({ kind: "assigned", role: "secondary" })
  })

  /** Bấm lại, hoặc quản lý vừa phân công trước một nhịp — không phải lỗi. */
  it("đã được phân công rồi cũng tính là xong", async () => {
    const c = client({ data: { status: "already_assigned" } })
    expect((await assignCustomerToCreator(c, { customerId: "kh-1", role: "sales" })).kind).toBe("assigned")
  })

  it("không có mã điểm bán thì bỏ qua, không gọi RPC", async () => {
    const c = client({})
    expect((await assignCustomerToCreator(c, { customerId: "", role: "sales" })).kind).toBe("skipped")
    expect(c.rpc).not.toHaveBeenCalled()
  })

  /**
   * ⚠ Điểm bán ĐÃ được tạo, chỉ phần phân công hỏng. Nuốt lỗi thì NVBH
   * tưởng mất cả điểm bán, tạo lại, và vướng trùng số điện thoại.
   */
  it("phân công hỏng thì nói ra, và nói rõ điểm bán vẫn còn", async () => {
    const c = client({ error: { message: "permission denied" } })
    const r = await assignCustomerToCreator(c, { customerId: "kh-1", role: "sales" })
    expect(r).toEqual({ kind: "failed", message: "permission denied" })
    const note = assignNote(r)!
    expect(note).toContain("Đã tạo điểm bán")
    expect(note).toContain("CHƯA phân công")
    expect(note).toContain("permission denied")
  })

  it("bỏ qua thì không thêm câu gì vào thông báo", () => {
    expect(assignNote({ kind: "skipped", reason: "x" })).toBeNull()
  })
})

describe("Màn tạo khách có nối đúng", () => {
  /** Không lấy `id` về thì không có gì để phân công. */
  it("lấy id của điểm bán vừa tạo", () => {
    expect(FORM).toContain('.insert(insertPayload)\n          .select("id")\n          .single()')
  })

  it("gọi phân công ngay sau khi tạo", () => {
    expect(FORM).toContain("assignCustomerToCreator(supabase, { customerId: newId, role: user?.role })")
  })

  /** Nhánh lùi (DB chưa có cột created_by) cũng phải lấy id về. */
  it("nhánh thử lại cũng lấy id", () => {
    const retry = FORM.slice(FORM.indexOf("delete insertPayload.created_by"))
    expect(retry.slice(0, 400)).toContain('.select("id")')
  })

  it("phân công hỏng thì thông báo báo đỏ", () => {
    expect(FORM).toContain('variant: outcome.kind === "failed" ? "destructive" : undefined')
  })
})

describe("Mở điểm bán ra là thấy đủ", () => {
  /**
   * ⚠ Trước đây tab "Thông tin" chỉ có biểu mẫu SỬA: muốn xem địa chỉ hay
   * hạn mức thì phải đọc trong ô nhập, còn NGƯỜI TẠO và NGÀY TẠO thì
   * không có mặt ở đâu cả.
   *
   * ⚠ Rồi thẻ hồ sơ lại nằm TRONG tab "Sửa thông tin": mở điểm bán ra vẫn
   * không thấy số điện thoại, địa chỉ hay ai phụ trách — phải bấm sang một
   * tab tên là "Sửa" để ĐỌC. Nay nó đứng ĐẦU tab Tổng quan, trước cả ảnh
   * điểm bán và đơn hàng gần đây.
   */
  it("thẻ hồ sơ đứng đầu tab Tổng quan", () => {
    const i = DETAIL.indexOf('<TabsContent value="overview"')
    expect(i).toBeGreaterThan(0)
    const tab = DETAIL.slice(i, DETAIL.indexOf('<TabsContent value="orders"'))
    const card = tab.indexOf("<CustomerProfileCard")
    expect(card, "tab Tổng quan không có thẻ hồ sơ").toBeGreaterThan(0)
    expect(card, "thẻ hồ sơ không đứng đầu").toBeLessThan(tab.indexOf("<CustomerPhotoCapture"))
    expect(card).toBeLessThan(tab.indexOf("Đơn hàng gần đây"))
  })

  /**
   * ⚠ MỘT CHUYỆN KỂ MỘT LẦN. Để thẻ hồ sơ ở cả hai tab thì tab "Sửa thông
   * tin" mở ra là một bảng đọc rồi mới tới biểu mẫu nói y hệt nội dung đó
   * bằng các ô nhập.
   */
  it("tab Sửa thông tin chỉ còn biểu mẫu sửa", () => {
    // Cắt tới hết khối Tabs: tab "info" nay đứng CUỐI, nên cắt tới một
    // tab cụ thể nào đó là ra lát rỗng và chốt xanh oan.
    const tab = DETAIL.slice(
      DETAIL.indexOf('<TabsContent value="info"'),
      DETAIL.indexOf("</Tabs>")
    )
    expect(tab).toContain("<CustomerForm")
    expect(tab).not.toContain("<CustomerProfileCard")
  })

  /** Đọc xong sửa được ngay, không phải đi tìm tab. */
  it("thẻ hồ sơ có lối sang sửa thông tin", () => {
    const i = DETAIL.indexOf("<CustomerProfileCard")
    const block = DETAIL.slice(i, DETAIL.indexOf("/>", i))
    expect(block).toContain("onClick={goEdit}")
    // ⚠ Chỉ hiện cho người được sửa — nút bấm vào rồi mới bị chặn là nút tồi.
    expect(block).toContain("canUpdate ?")
    // Và hai cái tên đó phải đúng là hai thứ chúng hứa hẹn.
    expect(DETAIL).toContain('setActiveTab("info")')
    expect(DETAIL).toContain(
      'const canUpdate = !!user && hasPermission(user.role, "customers", "update")'
    )
  })

  it("thẻ hồ sơ hiện người tạo, ngày tạo và người phụ trách", () => {
    expect(CARD).toContain('label="Người tạo"')
    expect(CARD).toContain('label="Ngày tạo"')
    expect(CARD).toContain('label="Đang phụ trách"')
  })

  /**
   * ⚠ Có `created_by` mà tra không ra tên nghĩa là người đó đã nghỉ —
   * KHÁC hẳn với "không rõ ai tạo". Hiện "—" cho cả hai là gộp hai sự
   * thật khác nhau thành một.
   */
  it("phân biệt 'người đã nghỉ' với 'không rõ ai tạo'", () => {
    expect(CARD).toContain("Nhân viên đã nghỉ")
    expect(CARD).toContain("Không rõ (tạo trước khi hệ thống ghi lại)")
  })

  /** Chưa phân công là chuyện cần nhìn thấy, không phải một ô trống. */
  it("chưa phân công thì tô vàng, không để trống", () => {
    expect(CARD).toContain("Chưa phân công")
    expect(CARD).toContain("text-amber-600")
  })

  /**
   * ⚠ Người tạo phải tra RIÊNG. Họ có thể KHÔNG nằm trong danh sách đang
   * phụ trách (đã nghỉ, đã đổi tuyến), nên lấy ké từ bảng phân công là có
   * lúc ra rỗng.
   */
  it("tra tên người tạo riêng, không lấy ké bảng phân công", () => {
    expect(DETAIL).toContain("const creatorId = (custRes.data as { created_by?: string | null } | null)?.created_by")
    expect(DETAIL).toContain('.from("users")')
    expect(DETAIL).toContain("setCreatorName(")
  })

  /** Kiểu `Customer` phải có cột đó, nếu không màn nào cũng đọc không ra. */
  it("kiểu Customer khai created_by", () => {
    expect(read("src/types/index.ts")).toContain("created_by: string | null")
  })
})
