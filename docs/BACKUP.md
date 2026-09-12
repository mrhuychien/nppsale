# Sao lưu tự động sang Google Drive

Chạy hằng ngày lúc **10:00 sáng giờ Việt Nam** (03:00 UTC) bằng GitHub
Actions. Mỗi lượt: kết xuất database → **khôi phục thử** → mã hoá → đưa lên
Drive → xoá bản cũ.

> **Drive chỉ là ổ đĩa câm.** File được mã hoá TRƯỚC khi rời khỏi máy chạy,
> bằng khoá công khai. Khoá riêng không bao giờ có mặt trong CI — nên kể cả
> toàn bộ GitHub lẫn thư mục Drive bị lộ, bản sao vẫn không đọc được.

---

## Ba lớp, không phải một

| Lớp | Là gì | Bảo vệ khỏi |
|---|---|---|
| Supabase PITR / daily backup | nhà cung cấp tự lo | lỡ tay xoá dữ liệu, hỏng ghi |
| **Bản sao này** | Drive của bạn, mã hoá | mất tài khoản Supabase, quên thanh toán, xoá nhầm project |
| Diễn tập khôi phục | job kiểm trong chính workflow | bản sao hỏng mà không ai biết |

Lớp 1 nằm cùng nhà cung cấp với dữ liệu gốc, nên không cứu được khi mất
chính tài khoản đó. Đó là lý do có lớp 2.

---

## Ba thứ `pg_dump` KHÔNG cứu được

Đọc kỹ phần này — đây là chỗ hay hỏng nhất, và chỉ lộ ra vào đúng ngày cần
khôi phục.

| Thứ | Vì sao lọt | Hậu quả |
|---|---|---|
| **File trong Storage** | ảnh điểm bán, chữ ký giao hàng nằm trên S3; `storage.objects` chỉ là *metadata* | restore xong mọi ảnh 404 |
| **`EINVOICE_ENC_KEY`** | là biến môi trường, không nằm trong database | tài khoản MISA **không giải mã lại được**, dù backup đủ 100% |
| **Khoá riêng `age`** | cố ý để ngoài | mất khoá = mất luôn mọi bản sao |

Ba thứ đó phải cất riêng, **không cùng chỗ với backup**.

---

## Cài đặt — 3 việc

### 1. Cặp khoá mã hoá

Trên máy bạn (không phải trên CI):

```bash
# macOS:  brew install age
# Ubuntu: sudo apt install age
age-keygen -o nppsale-backup-key.txt
```

Ra hai thứ:

```
# public key: age1ql3z7hjy54pw3hyww5ay...    ← DÁN VÀO GITHUB
AGE-SECRET-KEY-1QXYZ...                      ← CẤT RIÊNG, KHÔNG ĐƯA LÊN GITHUB
```

- **Khoá công khai** → GitHub → Settings → Secrets → Actions → `AGE_PUBLIC_KEY`
- **Khoá riêng** → cất ở nơi *không phải* GitHub và *không phải* Drive:
  trình quản lý mật khẩu, hoặc in ra giấy cất két.

> ⚠ **Mất khoá riêng là mất toàn bộ bản sao.** Không có cửa sau, không ai
> khôi phục hộ được. Cất ít nhất hai nơi.

### 2. Google Drive

1. Tạo một thư mục trên Drive, ví dụ `nppsale-backup`. Mở nó, lấy `FOLDER_ID`
   từ thanh địa chỉ: `drive.google.com/drive/folders/`**`<FOLDER_ID>`**
2. [Google Cloud Console](https://console.cloud.google.com) → tạo project →
   **APIs & Services**:
   - Bật **Google Drive API**
   - **OAuth consent screen**: chọn External, rồi **PUBLISH APP**
     (để ở Testing thì refresh token **hết hạn sau 7 ngày** — backup sẽ
     lặng lẽ ngừng chạy sau một tuần)
   - **Credentials** → Create OAuth client ID → **Desktop app**
3. Lấy refresh token với scope **`drive.file`** (chỉ thấy file do chính ứng
   dụng tạo — token lộ cũng không đọc được phần còn lại trong Drive của bạn):

```bash
# Thay CLIENT_ID / CLIENT_SECRET rồi mở link, đồng ý, copy `code` trên URL
open "https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent"

curl -s https://oauth2.googleapis.com/token \
  -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
  -d code=MA_VUA_COPY -d grant_type=authorization_code \
  -d redirect_uri=http://localhost | grep refresh_token
```

### 3. Nhập vào GitHub Secrets

Settings → Secrets and variables → Actions:

| Secret | Lấy ở đâu |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string (URI) |
| `AGE_PUBLIC_KEY` | bước 1 |
| `GDRIVE_CLIENT_ID` | bước 2 |
| `GDRIVE_CLIENT_SECRET` | bước 2 |
| `GDRIVE_REFRESH_TOKEN` | bước 2 |
| `GDRIVE_FOLDER_ID` | bước 2 |

Chạy thử: **Actions → Sao lưu database → Run workflow**. Xong thì Drive có
một file `nppsale-YYYYMMDD.pgc.age`.

---

## Giữ bao nhiêu bản

7 bản gần nhất + 4 bản Chủ nhật + 6 bản mùng 1. Drive miễn phí 15 GB dùng
**chung** với Gmail và Photos — không xoay vòng thì một ngày nào đó Gmail
ngừng nhận thư.

File có tên không đúng mẫu ngày thì **không bị xoá** — thà để thừa còn hơn
xoá nhầm thứ ai đó cố ý đặt vào thư mục.

---

## Khôi phục

Đọc phần này TRƯỚC khi cần tới nó. Lúc cần thì thường là lúc đang hoảng.

```bash
# 1. Tải file .age từ Drive về

# 2. Giải mã — cần khoá riêng đã cất ở bước 1
age --decrypt -i nppsale-backup-key.txt \
    -o nppsale.pgc nppsale-20260912.pgc.age

# 3. Khôi phục vào một project Supabase MỚI (đừng đè lên cái đang chạy)
pg_restore --dbname "postgresql://postgres:MATKHAU@db.xxx.supabase.co:5432/postgres" \
  --no-owner --no-privileges --clean --if-exists \
  nppsale.pgc

# 4. Đếm lại cho chắc
psql "$URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
psql "$URL" -c "SELECT count(*) FROM auth.users;"
```

`pg_restore` sẽ kêu một số cảnh báo về extension và role không có trên máy
đích — bình thường. Thứ cần nhìn là **số bảng và số dòng**, không phải mã
thoát.

Sau khi khôi phục, ba thứ vẫn thiếu (xem bảng ở trên): file Storage,
`EINVOICE_ENC_KEY`, và mọi biến môi trường khác.

---

## Khi nào nó sẽ hỏng

Ghi sẵn để không phải đoán:

| Triệu chứng | Nguyên nhân gần như chắc chắn |
|---|---|
| `invalid_grant` khi lấy token | OAuth app còn ở **Testing** → refresh token hết hạn sau 7 ngày. Publish app rồi lấy token mới |
| `server version mismatch` | Supabase nâng Postgres lên bản mới hơn `postgresql-client-17` trong workflow. Nâng số đó lên |
| Workflow không chạy | GitHub tạm dừng cron của repo **không có hoạt động trong 60 ngày**. Push một commit là chạy lại |
| `Số bảng lệch` | dump thiếu — đọc log `pg_dump`, thường do quyền hoặc timeout |
| Job đỏ ở bước mã hoá | `AGE_PUBLIC_KEY` sai định dạng (phải bắt đầu bằng `age1`) |

Workflow **cố ý đỏ** khi bất kỳ bước nào hỏng, thay vì tạo ra một file
không dùng được. Bản sao im lặng hỏng là loại tệ nhất: nó làm người ta yên
tâm cho tới đúng ngày cần.
