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

Làm một lần, khoảng 20–30 phút. Việc 2 (Google) là việc rối nhất; làm theo
đúng thứ tự thì không vướng.

---

### Việc 1 — Cặp khoá mã hoá (5 phút)

**Cài `age`:**

| Hệ điều hành | Lệnh |
|---|---|
| Windows | `winget install FiloSottile.age` |
| macOS | `brew install age` |
| Ubuntu/Debian | `sudo apt install age` |

Không cài được thì tải bản chạy sẵn ở
<https://github.com/FiloSottile/age/releases> (chọn file theo hệ điều hành,
giải nén, chạy trong thư mục đó).

**Sinh khoá:**

```bash
age-keygen -o nppsale-backup-key.txt
```

Màn hình in ra dòng bắt đầu bằng `Public key:`. Mở file
`nppsale-backup-key.txt` sẽ thấy:

```
# created: 2026-09-13T10:00:00+07:00
# public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFP
```

| Dòng | Là gì | Đưa đi đâu |
|---|---|---|
| `age1...` (sau `# public key:`) | khoá **công khai** — chỉ dùng để mã hoá | dán vào GitHub ở việc 3 |
| `AGE-SECRET-KEY-1...` | khoá **riêng** — thứ duy nhất giải mã được | **KHÔNG** đưa lên GitHub |

**Cất khoá riêng ở ít nhất hai nơi**, ví dụ:

- trình quản lý mật khẩu (1Password, Bitwarden…)
- in ra giấy, cất két
- USB để ở nhà

> ⚠ **Mất khoá riêng là mất toàn bộ bản sao.** Không có cửa sau, không ai
> khôi phục hộ được — kể cả tôi, kể cả Google. Đây là cái giá của việc
> Drive không đọc được dữ liệu của bạn.
>
> ⚠ **Đừng cất khoá riêng trong chính Drive đang chứa backup.** Mất tài
> khoản Google là mất cả hai cùng lúc.

---

### Việc 2 — Google Drive (15 phút)

#### 2.1 Tạo thư mục đích

Vào <https://drive.google.com> → **Mới → Thư mục mới** → đặt tên
`nppsale-backup` → mở thư mục đó.

Nhìn thanh địa chỉ:

```
https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jK
                                        └──── đây là FOLDER_ID ────┘
```

Chép đoạn đó lại.

#### 2.2 Bật Google Drive API

1. Vào <https://console.cloud.google.com>
2. Thanh trên cùng → menu chọn project → **NEW PROJECT** → tên
   `nppsale-backup` → **CREATE**
3. Đợi vài giây, rồi **chọn đúng project vừa tạo** (hay quên bước này)
4. Menu trái → **APIs & Services → Library** → tìm `Google Drive API` →
   **ENABLE**

#### 2.3 Màn hình đồng ý (OAuth consent screen)

Menu trái → **APIs & Services → OAuth consent screen**:

1. User Type: **External** → **CREATE**
2. App name: `nppsale backup` · User support email: email của bạn ·
   Developer contact: email của bạn → **SAVE AND CONTINUE**
3. Scopes → **ADD OR REMOVE SCOPES** → ô lọc gõ `drive.file` → tích dòng
   `.../auth/drive.file` → **UPDATE** → **SAVE AND CONTINUE**
4. Test users → bỏ qua → **SAVE AND CONTINUE**
5. Về lại màn OAuth consent screen → bấm **PUBLISH APP** → xác nhận

> ⚠ **Bước "PUBLISH APP" là bắt buộc.** Để ở chế độ *Testing* thì refresh
> token **hết hạn sau 7 ngày** — backup chạy ngon một tuần rồi lặng lẽ
> ngừng, và không ai nhận ra cho tới lúc cần khôi phục.
>
> Google có thể hiện cảnh báo "app chưa được xác minh". Không sao: app này
> chỉ mình bạn dùng, và scope `drive.file` không đụng được gì ngoài file
> do chính nó tạo.

#### 2.4 Tạo OAuth client

Menu trái → **APIs & Services → Credentials** → **+ CREATE CREDENTIALS** →
**OAuth client ID**:

- Application type: **Desktop app**
- Name: `nppsale backup`
- **CREATE**

Hộp thoại hiện **Client ID** và **Client secret** — chép cả hai.

#### 2.5 Lấy refresh token

**Bước a — xin mã uỷ quyền.** Thay `CLIENT_ID_CUA_BAN` rồi dán cả dòng vào
trình duyệt:

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID_CUA_BAN&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent
```

Chọn tài khoản Google → **Continue** (qua cảnh báo chưa xác minh) →
**Continue** lần nữa để cấp quyền.

Trình duyệt sẽ báo **"không kết nối được"** — **đúng như vậy, không phải
lỗi**. Thứ cần lấy nằm trên thanh địa chỉ:

```
http://localhost/?code=4%2F0AVMBsJi...&scope=https://www.googleapis.com/auth/drive.file
                       └──────── chép đoạn này ────────┘
```

Chép phần giữa `code=` và `&scope`.

> ⚠ Đoạn mã đó bị **mã hoá URL**: `%2F` chính là dấu `/`. Dán nguyên vào
> lệnh dưới thì Google báo `invalid_grant`. Lệnh dưới đã dùng
> `--data-urlencode` nên tự xử lý — cứ dán **y nguyên** đoạn vừa chép.

**Bước b — đổi mã lấy refresh token.** Mã này chỉ dùng được **một lần** và
hết hạn sau vài phút, nên làm ngay:

```bash
curl -s https://oauth2.googleapis.com/token \
  -d client_id=CLIENT_ID_CUA_BAN \
  -d client_secret=CLIENT_SECRET_CUA_BAN \
  --data-urlencode code=MA_VUA_CHEP \
  -d grant_type=authorization_code \
  -d redirect_uri=http://localhost
```

Trên **Windows PowerShell** dùng lệnh này thay thế:

```powershell
$body = @{
  client_id     = "CLIENT_ID_CUA_BAN"
  client_secret = "CLIENT_SECRET_CUA_BAN"
  code          = "MA_VUA_CHEP"
  grant_type    = "authorization_code"
  redirect_uri  = "http://localhost"
}
Invoke-RestMethod -Uri https://oauth2.googleapis.com/token -Method Post -Body $body
```

Kết quả:

```json
{
  "access_token": "ya29...",
  "refresh_token": "1//0gFx...",   ← CHÉP DÒNG NÀY
  "expires_in": 3599
}
```

**Không thấy `refresh_token`?** Do đã từng cấp quyền cho app này rồi. Thêm
`&prompt=consent` vào URL bước a (đã có sẵn trong URL trên) và làm lại; nếu
vẫn không có thì vào
<https://myaccount.google.com/permissions> gỡ quyền của app rồi làm lại từ
bước a.

---

### Việc 3 — Nhập vào GitHub (5 phút)

Vào repo → **Settings → Secrets and variables → Actions** → nút
**New repository secret**. Thêm lần lượt **6 secret**:

| Tên secret | Giá trị | Lấy ở đâu |
|---|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres.xxx:MATKHAU@aws-0-...pooler.supabase.com:5432/postgres` | xem ô cảnh báo ngay dưới |
| `AGE_PUBLIC_KEY` | `age1ql3z7...` | việc 1 — dòng `public key`, **không** phải dòng SECRET |
| `GDRIVE_CLIENT_ID` | `1234-abc.apps.googleusercontent.com` | việc 2.4 |
| `GDRIVE_CLIENT_SECRET` | `GOCSPX-...` | việc 2.4 |
| `GDRIVE_REFRESH_TOKEN` | `1//0gFx...` | việc 2.5 |
| `GDRIVE_FOLDER_ID` | `1A2b3C4d5E6f...` | việc 2.1 |

> ### ⚠ Chọn đúng chuỗi kết nối Supabase
>
> Supabase → **Settings → Database → Connection string** cho **ba** lựa
> chọn. Chỉ một cái dùng được:
>
> | Lựa chọn | Cổng | Dùng được? |
> |---|---|---|
> | **Session pooler** | 5432 | ✅ **DÙNG CÁI NÀY** |
> | Direct connection | 5432 | ⚠ chỉ có IPv6 với project mới — GitHub Actions không có IPv6, sẽ báo `could not translate host name` hoặc `Network is unreachable` |
> | Transaction pooler | 6543 | ❌ `pg_dump` không chạy được qua chế độ transaction |
>
> Nhớ thay `[YOUR-PASSWORD]` trong chuỗi bằng mật khẩu database thật (mật
> khẩu đặt lúc tạo project; quên thì **Settings → Database → Reset database
> password**).

#### Chạy thử

Repo → tab **Actions** → chọn **Sao lưu database** ở cột trái → nút **Run
workflow** → **Run workflow**.

Khoảng 2–4 phút. Xong thì:

- Actions hiện dấu ✓ xanh
- Thư mục Drive có file `nppsale-YYYYMMDD.pgc.age`
- Trong log, bước *"Đối chiếu số bảng và số dòng"* in ra hai con số **bằng
  nhau**

Từ đó nó tự chạy **10:00 sáng mỗi ngày**.

#### Kiểm thật: thử khôi phục một lần

Đừng đợi tới lúc cần. Tải file `.age` về, rồi:

```bash
age --decrypt -i nppsale-backup-key.txt -o thu.pgc nppsale-20260913.pgc.age
```

Ra file `thu.pgc` vài MB là khoá riêng đúng và bản sao đọc được. Quy trình
khôi phục đầy đủ ở mục [Khôi phục](#khôi-phục) bên dưới.

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
