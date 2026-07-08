# Huong dan Deploy NPP Sale len Vercel + Supabase

## Tong quan

- **Frontend/Backend**: Next.js 14 deploy len **Vercel**
- **Database + Auth**: **Supabase** (PostgreSQL + Row Level Security)
- **Environment**: 2 bien moi truong can thiet

---

## Buoc 1: Thiet lap Supabase

### 1.1 Tao project Supabase

1. Truy cap [https://supabase.com](https://supabase.com) va dang nhap
2. Click **"New Project"**
3. Dien thong tin:
   - **Name**: `nppsale` (hoac ten tuy chon)
   - **Database Password**: tao mat khau manh, luu lai
   - **Region**: chon region gan nhat (vd: Singapore)
4. Click **"Create new project"** va doi 1-2 phut

### 1.2 Lay thong tin ket noi

1. Vao **Project Settings** > **API**
2. Sao chep 2 gia tri:
   - **Project URL** → day la `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → day la `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 1.3 Chay Migration tao database

Cac migration la **cong don** (001 tao bang, cac file sau ALTER them cot/chuc nang).
Cai moi tren mot database TRONG chi can **1 file gop** thay vi chay 87 file:

**Cach nhanh (khuyen dung):**
1. Mo **SQL Editor** trong Supabase Dashboard.
2. Copy toan bo noi dung `supabase/schema_full.sql` va chay **1 lan**.
   File nay gop tat ca migration theo dung thu tu (schema + RLS),
   **KHONG kem du lieu demo** — an toan cho site thuong mai.
3. (Tuy chon, CHI cho moi truong thu nghiem) chay them
   `supabase/seed_demo.sql` de co du lieu mau + 6 tai khoan demo.
   **KHONG chay file nay tren production** — mat khau demo la cong khai.

> File `schema_full.sql` duoc sinh tu thu muc `supabase/migrations`. Sau
> khi them migration moi, chay lai `bash scripts/build-combined-migration.sh`
> de cap nhat.

**Cach thu cong (neu muon chay tung buoc):** chay lan luot cac file trong
`supabase/migrations/` theo dung thu tu so (001 → 002 → ... → 088). Phai
dung thu tu vi cac file sau phu thuoc file truoc. Tren production, BO QUA
`003_seed.sql` (du lieu demo).

> **Luu y**: Chi chay `schema_full.sql` tren database TRONG (cai moi). Voi
> database da co san, chi chay rieng migration MOI (vd `087_qr_login.sql`
> roi `088_qr_token_isolation.sql`) — dung chay lai ca file gop vi cac
> lenh CREATE TABLE dau tien se bao loi "already exists".

### 1.4 Tai khoan demo (chi khi da chay seed_demo.sql)

File `supabase/seed_demo.sql` tao 6 tai khoan demo voi mat khau `Demo@123456`.
**Canh bao**: day la mat khau cong khai — chi dung cho thu nghiem. Tren
production hay tao tai khoan owner that (Authentication > Add user trong
Supabase Dashboard, roi INSERT profile vao bang users) va KHONG chay seed.

| Email               | Role       | Ten            |
| ------------------- | ---------- | -------------- |
| owner@demo.com      | owner      | Nguyen Van An  |
| manager@demo.com    | manager    | Tran Thi Bich  |
| accountant@demo.com | accountant | Le Van Cuong   |
| sales@demo.com      | sales      | Pham Thi Dung  |
| warehouse@demo.com  | warehouse  | Hoang Van Em   |
| driver@demo.com     | driver     | Vo Van Phuc    |

### 1.5 Cau hinh Authentication

1. Vao **Authentication** > **Providers**
2. Dam bao **Email** provider da duoc bat
3. (Tuy chon) Tat "Confirm email" trong **Authentication** > **Settings** de test nhanh

---

## Buoc 2: Deploy len Vercel

### 2.1 Push code len GitHub

Dam bao code da duoc push len GitHub repository.

```bash
git push -u origin main
```

### 2.2 Import project tren Vercel

1. Truy cap [https://vercel.com](https://vercel.com) va dang nhap bang GitHub
2. Click **"Add New..."** > **"Project"**
3. Tim va chon repository **nppsale**
4. Cau hinh:
   - **Framework Preset**: `Next.js` (tu dong detect)
   - **Root Directory**: `.` (de mac dinh)
   - **Build Command**: `next build` (de mac dinh)
   - **Output Directory**: `.next` (de mac dinh)

### 2.3 Them Environment Variables

Trong trang Import, mo phan **Environment Variables** va them:

| Ten bien                        | Gia tri                          |
| ------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL tu Supabase (buoc 1.2)      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key tu Supabase (buoc 1.2) |

> **Quan trong**: Phai them day du 2 bien nay truoc khi deploy. Thieu se gay loi ket noi database.

### 2.4 Deploy

Click **"Deploy"** va doi Vercel build xong (khoang 1-3 phut).

---

## Buoc 3: Cau hinh sau deploy

### 3.1 Cap nhat Supabase URL Redirect

1. Trong Supabase Dashboard, vao **Authentication** > **URL Configuration**
2. Cap nhat:
   - **Site URL**: `https://ten-project.vercel.app`
   - **Redirect URLs**: them `https://ten-project.vercel.app/**`

### 3.2 (Tuy chon) Cau hinh Custom Domain

1. Trong Vercel, vao **Settings** > **Domains**
2. Them domain (vd: `npp.sale`)
3. Cap nhat DNS record theo huong dan cua Vercel
4. Quay lai Supabase cap nhat **Site URL** va **Redirect URLs** voi domain moi

---

## Buoc 4: Kiem tra sau deploy

### Checklist

- [ ] Truy cap duoc trang web tren Vercel URL
- [ ] Trang login hien thi dung
- [ ] Dang ky tai khoan moi thanh cong
- [ ] Dang nhap thanh cong va vao duoc dashboard
- [ ] Cac trang quan ly (san pham, don hang, khach hang...) load data dung

### Xu ly loi thuong gap

| Loi                                     | Nguyen nhan & Cach xu ly                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `Failed to fetch`                        | Sai `NEXT_PUBLIC_SUPABASE_URL`. Kiem tra lai trong Vercel Environment Variables |
| `Invalid API key`                        | Sai `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Kiem tra lai trong Vercel                 |
| Trang trang / 500 error                  | Kiem tra Vercel build logs. Co the thieu env vars                              |
| Dang nhap nhung khong vao duoc dashboard | Kiem tra RLS policies da duoc chay (file 002)                                  |
| `relation "xxx" does not exist`          | Chua chay migration. Chay lai file 001_schema.sql                              |

---

## Buoc 5: Re-deploy khi cap nhat code

```bash
# Push code len GitHub, Vercel se tu dong re-deploy
git add .
git commit -m "update: mo ta thay doi"
git push
```

Vercel se tu dong detect thay doi va deploy lai. Theo doi tien trinh tai Vercel Dashboard > **Deployments**.

---

## Cau truc Environment Variables

```env
# .env.local (development)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx
```

> **Khong bao gio** commit file `.env.local` len git. File nay da duoc them vao `.gitignore`.

---

## Tham khao

- [Vercel Docs - Next.js](https://vercel.com/docs/frameworks/nextjs)
- [Supabase Docs - Next.js Guide](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [Supabase Docs - Auth](https://supabase.com/docs/guides/auth)
