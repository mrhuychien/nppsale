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

Vao **SQL Editor** trong Supabase Dashboard, chay lan luot 3 file theo thu tu:

**File 1: Tao bang** - Copy noi dung `supabase/migrations/001_schema.sql` va chay

**File 2: Thiet lap RLS** - Copy noi dung `supabase/migrations/002_rls_policies.sql` va chay

**File 3: Du lieu mau** - Copy noi dung `supabase/migrations/003_seed.sql` va chay

> **Luu y**: Phai chay dung thu tu 001 → 002 → 003. Neu bi loi, kiem tra lai tung file mot.

### 1.4 Cau hinh Authentication

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
