# Đóng ứng dụng để chạy migration

## Vì sao phải đóng

Đợt v2b gỡ `complete_order` ở migration 124 rồi mới dựng `post_invoice` ở
125. Đẩy theo thứ tự nào cũng có một khoảng mà **ứng dụng nói một đằng,
cơ sở dữ liệu một nẻo**:

- Đẩy migration trước → mã cũ trên sóng gọi `complete_order`, hàm đã bị
  gỡ, người dùng nhận `function does not exist`.
- Đẩy mã trước → mã mới gọi `post_invoice`, hàm chưa có, lỗi y hệt.

⚠ **Không có nguy cơ hỏng sổ.** Mỗi migration chạy trong MỘT giao dịch,
nên một lệnh ghi chen vào giữa thì hoặc phải xếp hàng chờ, hoặc ném lỗi
cho người bấm. Cái phải tránh là **người dùng bối rối** và gõ lại nhiều
lần, không phải dữ liệu lệch.

---

## Chế độ bảo trì chặn được gì

| | |
|---|---|
| **Chặn** | Mọi lần tải trang mới, chuyển màn, bấm F5 |
| **Không chặn** | Một tab ĐANG MỞ SẴN |
| **Không chặn** | Các route `/api/*` (hoá đơn điện tử, cron) |

⚠ **Tab đang mở sẵn là chỗ hở thật.** Mã JavaScript trong tab đó đã tải
xong và nói **thẳng với Supabase qua PostgREST**, không đi qua máy chủ
Next.js — middleware không nhìn thấy những lệnh ấy. Nên vẫn phải:

- Nhắn nhân viên **đóng hẳn ứng dụng** trước giờ hẹn.
- Chọn **giờ vắng** (tối muộn, hoặc trước giờ mở hàng).

---

## Các bước

### 1. Trước hôm chạy

- [ ] Nhắn nhân viên giờ hẹn, bảo đóng ứng dụng.
- [ ] Xử lý hết phiếu xuất kho còn ở trạng thái nháp — xem
      `docs/workflow-v2b-checklist.md` mục 0.
- [ ] **Tắt cron trên Vercel.** `vercel.json` khai một cron
      `/api/cron/daily` lúc 18:00 UTC (01:00 giờ VN). Route `/api/*`
      không bị middleware chặn, nên nếu chạy migration vắt qua giờ đó thì
      cron vẫn nổ. Tắt bằng cách xoá khối `crons` rồi deploy, hoặc chọn
      giờ chạy tránh xa mốc ấy.

### 2. Đóng cửa và đẩy mã mới, CÙNG MỘT LƯỢT

Trên Vercel → Settings → Environment Variables:

```
MAINTENANCE_MODE = 1        (Production)
```

Rồi **Redeploy** nhánh đã merge.

⚠ **Phải deploy lại thì biến mới có tác dụng.** Middleware đọc
`process.env` của chính bản deploy đó; đổi biến mà không deploy lại thì
bản đang chạy vẫn mang giá trị cũ.

⚠ **Đẩy mã MỚI trong lúc đang đóng cửa, không phải sau.** Làm vậy thì
khoảng "mã mới, cơ sở dữ liệu cũ" nằm gọn phía sau cánh cửa đóng, không
ai nhìn thấy.

- [ ] Mở trang web bằng một trình duyệt khác → thấy **"Đang nâng cấp hệ
      thống"**. Không thấy thì dừng lại, đừng chạy migration.

### 3. Chạy migration

```bash
supabase db push --debug 2>&1 | tee push-v2b.log
```

- [ ] Đọc `push-v2b.log`, đối chiếu từng dòng ở
      `docs/workflow-v2b-checklist.md` mục 1.

### 4. Tự kiểm trước khi mở cửa

Đặt cookie mở đường trong Console của trình duyệt:

```js
document.cookie = "npp_maintenance_bypass=1; path=/"
```

- [ ] Đi hết mục 3 của `docs/workflow-v2b-checklist.md` (tạo đơn → xuất
      hàng → xuất một phần → đóng đơn).

⚠ **Cookie này KHÔNG phải một lớp bảo mật.** Ai biết tên cookie đều vào
được — nhưng vào rồi vẫn phải đăng nhập và vẫn bị RLS chặn như mọi
người. Nó chỉ để người đang chạy migration tự kiểm.

### 5. Mở cửa

- [ ] **Xoá hẳn** biến `MAINTENANCE_MODE` trên Vercel (đặt `=0` cũng
      được, nhưng xoá thì không ai nhầm).
- [ ] Redeploy.
- [ ] Bật lại cron nếu đã tắt ở bước 1.
- [ ] Nhắn nhân viên mở lại.
- [ ] Xoá cookie mở đường:
      `document.cookie = "npp_maintenance_bypass=; path=/; max-age=0"`

---

## Nếu phải quay đầu

Migration **không có bản lùi**. `cancel_invoice` hoàn kho theo dấu vết
FIFO, nhưng đó là hoàn từng hóa đơn — không phải hoàn cả migration.

Cách quay đầu duy nhất là **khôi phục bản sao lưu cơ sở dữ liệu**. Vì
thế mục 0 của `docs/workflow-v2b-checklist.md` bắt sao lưu trước, và vì
thế đừng chạy lần đầu trên cơ sở dữ liệu thật.

---

## Bật bảo trì khi chạy máy ở nhà

```bash
MAINTENANCE_MODE=1 npm run dev
```
