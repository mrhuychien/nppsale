/**
 * Đưa bản sao ĐÃ MÃ HOÁ lên Google Drive, rồi xoay vòng xoá bản cũ.
 *
 * VÌ SAO REFRESH TOKEN CHỨ KHÔNG PHẢI SERVICE ACCOUNT
 *   Service account không có hạn mức Drive riêng. Upload vào thư mục người
 *   khác chia sẻ thì file vẫn thuộc sở hữu service account → lỗi "Service
 *   Accounts do not have storage quota". Muốn chạy được phải có Shared
 *   Drive, mà Shared Drive là tính năng Google Workspace. Tài khoản Gmail
 *   cá nhân thì đường đi được là OAuth refresh token của chính chủ.
 *
 * SCOPE `drive.file` — KHÔNG phải `drive`
 *   `drive.file` chỉ cho ứng dụng thấy những file do CHÍNH NÓ tạo. Token
 *   lộ thì kẻ lấy được cũng không đọc được gì khác trong Drive của bạn.
 *   Đây là khác biệt đáng kể so với scope `drive` toàn quyền.
 *
 * VÀ FILE ĐÃ ĐƯỢC MÃ HOÁ TỪ TRƯỚC
 *   Drive ở đây chỉ là ổ đĩa câm. Khoá riêng không nằm trong CI, nên kể cả
 *   token lẫn toàn bộ thư mục Drive bị lộ thì bản sao vẫn không đọc được.
 *
 * Chạy: npx tsx scripts/backup/upload-drive.ts <thư-mục-chứa-file-.age>
 */
import { readdirSync, statSync, createReadStream } from "node:fs"
import { join } from "node:path"

/** Giữ bao nhiêu bản. Drive miễn phí 15 GB dùng CHUNG với Gmail và Photos
 *  — không xoay vòng thì một ngày nào đó Gmail ngừng nhận thư. */
const KEEP_DAILY = 7
const KEEP_WEEKLY = 4 // bản của Chủ nhật
const KEEP_MONTHLY = 6 // bản ngày 1

/**
 * Đọc secret LÚC CẦN, không phải lúc import.
 *
 * Đọc ở cấp module thì chỉ cần `import { keepSet }` là tiến trình chết vì
 * thiếu biến môi trường — bộ test không nạp nổi hàm thuần để kiểm. Một
 * module toàn hàm thuần không nên đòi thông tin đăng nhập mới cho đọc.
 */
function env(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`Thiếu biến môi trường ${k}. Xem docs/BACKUP.md.`)
  return v
}

/** Đổi refresh token lấy access token ngắn hạn. */
async function accessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GDRIVE_CLIENT_ID"),
      client_secret: env("GDRIVE_CLIENT_SECRET"),
      refresh_token: env("GDRIVE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  })
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string }
  if (!res.ok || !body.access_token) {
    // Nói rõ nguyên nhân hay gặp nhất thay vì ném nguyên lỗi của Google:
    // refresh token của "Testing app" hết hạn sau 7 ngày.
    throw new Error(
      `Không lấy được access token: ${body.error_description || body.error || res.status}. ` +
        `Nếu là "invalid_grant": OAuth app đang ở chế độ Testing thì refresh token hết hạn sau 7 ngày — ` +
        `chuyển app sang Production trong Google Cloud Console rồi lấy token mới.`
    )
  }
  return body.access_token
}

type DriveFile = { id: string; name: string; createdTime: string }

async function listBackups(token: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const q = new URLSearchParams({
      q: `'${env("GDRIVE_FOLDER_ID")}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, createdTime)",
      orderBy: "name",
      pageSize: "100",
    })
    if (pageToken) q.set("pageToken", pageToken)
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Liệt kê thư mục Drive lỗi: ${res.status} ${await res.text()}`)
    const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
    out.push(...(body.files ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)
  return out.filter((f) => f.name.endsWith(".age"))
}

async function upload(token: string, path: string, name: string): Promise<string> {
  const size = statSync(path).size
  // Upload nhiều bước (resumable): file backup có thể lớn, và upload một
  // phát thì đứt giữa chừng là mất trắng, phải làm lại từ đầu.
  const start = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({ name, parents: [env("GDRIVE_FOLDER_ID")] }),
    }
  )
  if (!start.ok) throw new Error(`Mở phiên upload lỗi: ${start.status} ${await start.text()}`)
  const location = start.headers.get("location")
  if (!location) throw new Error("Google không trả về địa chỉ upload")

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Length": String(size) },
    // @ts-expect-error — Node fetch nhận stream, kiểu của lib chưa khai báo
    body: createReadStream(path),
    duplex: "half",
  })
  if (!put.ok) throw new Error(`Upload lỗi: ${put.status} ${await put.text()}`)
  const done = (await put.json()) as { id: string }
  return done.id
}

async function remove(token: string, id: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Xoá file cũ lỗi: ${res.status} ${await res.text()}`)
  }
}

/** Ngày trong tên file `nppsale-YYYYMMDD.pgc.age`, hoặc null. */
export function dateFromName(name: string): Date | null {
  const m = /nppsale-(\d{4})(\d{2})(\d{2})\.pgc\.age$/.exec(name)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Chọn bản nào ĐƯỢC GIỮ: 7 bản gần nhất, cộng 4 bản Chủ nhật, cộng 6 bản
 * ngày mùng 1.
 *
 * ⚠ Trả về danh sách GIỮ chứ không phải danh sách XOÁ. Tên file lạ (không
 * đúng mẫu ngày) sẽ không rơi vào nhóm nào — và vì phép xoá chỉ đụng tới
 * thứ NẰM NGOÀI danh sách giữ, một file lạ sẽ bị xoá. Nên hàm này giữ lại
 * luôn mọi tên không đọc được ngày: thà để thừa một file còn hơn xoá nhầm
 * thứ người ta cố ý đặt ở đó.
 */
export function keepSet(names: string[]): Set<string> {
  const dated = names
    .map((n) => ({ n, d: dateFromName(n) }))
    .filter((x): x is { n: string; d: Date } => x.d !== null)
    .sort((a, b) => b.d.getTime() - a.d.getTime())

  const keep = new Set<string>()
  // Tên không đọc được ngày → giữ, không đụng tới.
  for (const n of names) if (dateFromName(n) === null) keep.add(n)

  dated.slice(0, KEEP_DAILY).forEach((x) => keep.add(x.n))
  dated.filter((x) => x.d.getUTCDay() === 0).slice(0, KEEP_WEEKLY).forEach((x) => keep.add(x.n))
  dated.filter((x) => x.d.getUTCDate() === 1).slice(0, KEEP_MONTHLY).forEach((x) => keep.add(x.n))
  return keep
}

async function main() {
  const dir = process.argv[2]
  if (!dir) {
    console.error("Thiếu tham số: thư mục chứa file .age")
    process.exit(1)
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".age"))
  if (files.length === 0) {
    console.error(`Không có file .age nào trong ${dir} — không có gì để tải lên.`)
    process.exit(1)
  }

  const token = await accessToken()

  for (const f of files) {
    const id = await upload(token, join(dir, f), f)
    console.log(`Đã tải lên ${f} (${(statSync(join(dir, f)).size / 1024 / 1024).toFixed(2)} MB) → ${id}`)
  }

  // Xoay vòng SAU khi upload xong. Xoá trước rồi upload hỏng là có lúc
  // không còn bản nào trên Drive.
  const remote = await listBackups(token)
  const keep = keepSet(remote.map((f) => f.name))
  const drop = remote.filter((f) => !keep.has(f.name))

  for (const f of drop) {
    await remove(token, f.id)
    console.log(`Đã xoá bản cũ: ${f.name}`)
  }
  console.log(`Còn lại ${remote.length - drop.length} bản trên Drive.`)
}

// Chỉ chạy khi gọi trực tiếp — để test import được keepSet mà không upload.
if (process.argv[1]?.endsWith("upload-drive.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
