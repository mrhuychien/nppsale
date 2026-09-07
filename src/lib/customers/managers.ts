/**
 * "Điểm bán này do ai quản lý" — thuần, không chạm mạng.
 *
 * Một điểm bán có thể do NHIỀU người cùng phụ trách, mỗi người bán một
 * ngành hàng khác nhau (người lo sữa, người lo bánh kẹo). Dữ liệu đã có
 * sẵn ở hai bảng, không cần bảng mới:
 *   • customer_assignments — ai phụ trách điểm bán nào, vai trò chính/phụ
 *   • user_suppliers (mig 080) — mỗi người bán hàng của NCC nào
 *
 * Ghép hai cái đó lại chính là câu trả lời, và ghép ở đây (thuần) thay
 * vì trong component để test được mà không cần dựng DOM.
 */

export type AssignmentRow = {
  user_id: string
  role: string | null
  status: string | null
}

export type UserRow = {
  id: string
  full_name: string
  is_active?: boolean | null
}

export type SupplierLink = { user_id: string; supplier_id: string }
export type SupplierRow = { id: string; name: string }

export type Manager = {
  userId: string
  fullName: string
  /** Vai trò chính. Một điểm bán nên có đúng một người chính. */
  isPrimary: boolean
  /** Nhân sự đã nghỉ nhưng phân công còn treo — phải NHÌN THẤY. */
  userInactive: boolean
  /** Không tra được tên (RLS che, hoặc user đã bị xoá). */
  unknownUser: boolean
  /** Tên NCC / ngành hàng người này phụ trách. */
  suppliers: string[]
}

/** So tên tiếng Việt — mặc định của localeCompare xếp sai chữ có dấu. */
function byVi(a: string, b: string): number {
  return a.localeCompare(b, "vi")
}

/**
 * Ghép danh sách người phụ trách một điểm bán.
 *
 * BỎ phân công đã ngừng (`status` khác 'active') — đó là phân công đã gỡ,
 * hiện lên là sai. NHƯNG GIỮ người đã nghỉ việc mà phân công còn treo, có
 * gắn cờ: ẩn đi thì điểm bán trông như "không ai phụ trách" và không ai
 * biết vì sao, còn hiện ra thì người quản lý gỡ được ngay.
 *
 * Người phụ trách chính lên đầu, còn lại xếp theo tên.
 */
export function buildManagers(
  assignments: AssignmentRow[],
  users: UserRow[],
  supplierLinks: SupplierLink[],
  suppliers: SupplierRow[]
): Manager[] {
  const userById = new Map(users.map((u) => [u.id, u]))
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]))

  const linksByUser = new Map<string, string[]>()
  for (const l of supplierLinks) {
    const name = supplierName.get(l.supplier_id)
    // NCC không tra được tên thì bỏ, KHÔNG hiện id thô: một dãy uuid
    // trên màn hình không nói cho ai điều gì.
    if (!name) continue
    const arr = linksByUser.get(l.user_id)
    if (arr) arr.push(name)
    else linksByUser.set(l.user_id, [name])
  }

  const seen = new Set<string>()
  const out: Manager[] = []
  for (const a of assignments) {
    if (a.status && a.status !== "active") continue
    // Cùng một người xuất hiện hai lần (dữ liệu cũ) thì gộp, đừng hiện
    // hai dòng trùng tên làm người đọc tưởng có hai người.
    if (seen.has(a.user_id)) continue
    seen.add(a.user_id)

    const u = userById.get(a.user_id)
    out.push({
      userId: a.user_id,
      fullName: u?.full_name || "Không rõ người dùng",
      isPrimary: a.role === "primary",
      userInactive: !!u && u.is_active === false,
      unknownUser: !u,
      suppliers: (linksByUser.get(a.user_id) || []).slice().sort(byVi),
    })
  }

  return out.sort((x, y) => {
    if (x.isPrimary !== y.isPrimary) return x.isPrimary ? -1 : 1
    return byVi(x.fullName, y.fullName)
  })
}

/** Nhãn ngành hàng của một người, dùng chung cho cả chi tiết lẫn danh sách. */
export function scopeLabel(m: Manager): string {
  // KHÔNG viết "tất cả ngành hàng" khi danh sách rỗng. Theo RLS ở
  // migration 081, NVBH chưa gán NCC nào chỉ thấy sản phẩm không gắn NCC
  // — tức là gần như không bán được gì. Đó là một thiếu sót cần sửa, nói
  // đúng như vậy.
  if (m.suppliers.length === 0) return "Chưa gán ngành hàng"
  return m.suppliers.join(", ")
}

/**
 * Tóm tắt cho một ô trong bảng danh sách.
 *
 * Nêu tên tối đa `max` người rồi gộp phần còn lại. Ô bảng chỉ rộng chừng
 * đó; đổ hết 5 tên vào là hàng bị kéo cao gấp ba và cả bảng khó đọc.
 */
export function managersSummary(managers: Manager[], max = 2): string {
  if (managers.length === 0) return "Chưa phân công"
  const head = managers.slice(0, max).map((m) => m.fullName).join(", ")
  const rest = managers.length - max
  return rest > 0 ? `${head} +${rest}` : head
}

/** Có chuyện cần người quản lý để mắt tới không? */
export function managersWarning(managers: Manager[]): string | null {
  if (managers.length === 0) return "Chưa có ai phụ trách điểm bán này"
  const gone = managers.filter((m) => m.userInactive || m.unknownUser)
  if (gone.length > 0) {
    return `${gone.map((m) => m.fullName).join(", ")} đã nghỉ nhưng phân công còn treo`
  }
  if (!managers.some((m) => m.isPrimary)) {
    return "Chưa có người phụ trách CHÍNH — công nợ và thông báo sẽ không biết gửi cho ai"
  }
  const noScope = managers.filter((m) => m.suppliers.length === 0)
  if (noScope.length > 0) {
    return `${noScope.map((m) => m.fullName).join(", ")} chưa được gán ngành hàng nào`
  }
  return null
}
