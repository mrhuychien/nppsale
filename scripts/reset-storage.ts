/**
 * Xoá MỌI file trong Supabase Storage — bước bắt buộc trước khi chạy
 * supabase/reset/05_reset_blank.sql.
 *
 * VÌ SAO PHẢI LÀ SCRIPT, KHÔNG PHẢI SQL
 *   Supabase chặn xoá thẳng bằng SQL:
 *     ERROR 42501: Direct deletion from storage tables is not allowed.
 *                  Use the Storage API instead.
 *     HINT: This prevents accidental data loss from orphaned objects.
 *   Trigger storage.protect_delete() dựng ra để tránh đúng chuyện đó: xoá
 *   dòng trong storage.objects mà file thật vẫn nằm lại trên S3 — hàng
 *   trong kho không ai biết, không ai dọn được nữa.
 *
 *   Bản đầu của 05_reset_blank.sql có `DELETE FROM storage.objects` và
 *   chạy được trên Postgres tạm tôi dựng để kiểm — vì cái bảng đó tôi tự
 *   tạo tay, không có trigger của Supabase. Test xanh, production chặn.
 *
 * XEM TRƯỚC LÀ MẶC ĐỊNH
 *   Không có `--yes` thì chỉ đếm và liệt kê, không xoá gì. Thao tác hàng
 *   loạt không hoàn tác được thì phải nhìn thấy phạm vi trước đã.
 *
 * CÁCH CHẠY
 *   Xem trước:
 *     SUPABASE_URL=https://<proj>.supabase.co \
 *     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *     npx tsx scripts/reset-storage.ts
 *
 *   Xoá thật:
 *     … npx tsx scripts/reset-storage.ts --yes
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const CONFIRM = process.argv.includes("--yes")

if (!url || !key) {
  console.error(
    "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Lấy ở Supabase Dashboard → Settings → API (dùng service_role, KHÔNG phải anon)."
  )
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

/** Storage list phân trang và KHÔNG đệ quy — thư mục con phải tự đi vào. */
async function listAll(bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = []
  const PAGE = 100
  let offset = 0

  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Thư mục không có `id`. Đây là cách duy nhất phân biệt qua API này.
      if (entry.id === null) {
        out.push(...(await listAll(bucket, path)))
      } else {
        out.push(path)
      }
    }

    if (data.length < PAGE) break
    offset += PAGE
  }
  return out
}

async function main() {
  const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
  if (bErr) {
    console.error(`Không đọc được danh sách bucket: ${bErr.message}`)
    process.exit(1)
  }
  if (!buckets || buckets.length === 0) {
    console.log("Không có bucket nào.")
    return
  }

  let total = 0
  let removed = 0
  const failures: string[] = []

  for (const b of buckets) {
    const files = await listAll(b.id)
    total += files.length
    console.log(`\n${b.id}: ${files.length} file`)
    for (const f of files.slice(0, 5)) console.log(`   ${f}`)
    if (files.length > 5) console.log(`   … và ${files.length - 5} file nữa`)

    if (!CONFIRM || files.length === 0) continue

    // Xoá theo lô. Lô quá lớn thì một lỗi nhỏ làm hỏng cả mẻ và không biết
    // file nào đã đi, file nào còn.
    const BATCH = 100
    for (let i = 0; i < files.length; i += BATCH) {
      const chunk = files.slice(i, i + BATCH)
      const { error } = await supabase.storage.from(b.id).remove(chunk)
      if (error) {
        failures.push(`${b.id}[${i}..${i + chunk.length}]: ${error.message}`)
      } else {
        removed += chunk.length
      }
    }
    console.log(`   → đã xoá ${removed} file`)
  }

  if (!CONFIRM) {
    console.log(
      `\n────────\nXEM TRƯỚC: ${total} file sẽ bị xoá. Chưa xoá gì.\n` +
        `Chạy lại kèm --yes để xoá thật.`
    )
    return
  }

  if (failures.length) {
    console.error(`\nCó ${failures.length} lô lỗi:`)
    for (const f of failures) console.error(`   ${f}`)
    process.exit(1)
  }

  // Đếm lại từ đầu — không tin vào biến đếm của chính mình. Xoá xong mà
  // còn sót thì bước SQL sau sẽ chặn, nhưng biết ngay ở đây vẫn hơn.
  let left = 0
  for (const b of buckets) left += (await listAll(b.id)).length

  console.log(`\n────────\nĐã xoá ${removed}/${total} file. Còn lại: ${left}.`)
  if (left > 0) {
    console.error("Vẫn còn file — chạy lại script này trước khi chạy SQL.")
    process.exit(1)
  }
  console.log("Storage sạch. Bước tiếp: supabase/reset/05_reset_blank.sql")
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
