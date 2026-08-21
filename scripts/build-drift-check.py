#!/usr/bin/env python3
"""
Sinh file SQL dò LỆCH MIGRATION: so sánh schema thật trên database với
những gì thư mục supabase/migrations/ mong đợi.

Vì sao cần: DB production có thể chạy thiếu migration mà KHÔNG có dấu hiệu
gì rõ ràng — biểu hiện chỉ là "danh sách rỗng", "lưu thất bại"... rất khó
truy. Công cụ này trả lời dứt điểm: đối tượng nào đang thiếu.

CÁCH TIẾP CẬN — quan trọng:
Không kiểm "migration X có đủ đối tượng của nó không", vì migration sau
thường XOÁ/THAY THẾ đối tượng của migration trước (đổi tên policy, chuyển
cột sang bảng khác...). Kiểm kiểu đó sinh rất nhiều báo động giả.

Thay vào đó tính TRẠNG THÁI CUỐI CÙNG: duyệt toàn bộ migration theo thứ
tự, với mỗi đối tượng ghi nhận hành động cuối cùng là TẠO hay XOÁ. Chỉ
kiểm những đối tượng mà hành động cuối cùng là TẠO — tức những thứ schema
LẼ RA phải có ở hiện tại.

Chạy:  python3 scripts/build-drift-check.py
Kết quả: supabase/diagnostics/check_migration_drift.sql
"""
import os
import re
import glob
from collections import OrderedDict

MIG_DIR = "supabase/migrations"
OUT = "supabase/diagnostics/check_migration_drift.sql"
SKIP = {"003_seed.sql"}


def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql


def q(s: str) -> str:
    return s.replace("'", "''")


def scan(sql: str):
    """Trả về [(vị_trí, key, hành_động, biểu_thức, mô_tả)] — CHƯA sắp xếp.
    Người gọi phải sort theo vị_trí để phản ánh đúng thứ tự trong file:
    một DROP đứng NGAY TRƯỚC CREATE (mẫu idempotent) không được hiểu
    nhầm thành 'đối tượng đã bị xoá'."""
    ev = []
    add = lambda pos, key, act, expr="", desc="": ev.append((pos, key, act, expr, desc))

    # ---- Cột ----
    for m in re.finditer(r"ALTER\s+TABLE\s+(?:public\.)?(\w+)(.*?);", sql, re.S | re.I):
        table, body, base = m.group(1), m.group(2), m.start()
        for c in re.finditer(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", body, re.I):
            col = c.group(1)
            add(base + c.start(), f"col:{table}.{col}", "tao",
                f"EXISTS(SELECT 1 FROM information_schema.columns "
                f"WHERE table_schema='public' AND table_name='{table}' AND column_name='{col}')",
                f"{table}.{col}")
        for c in re.finditer(r"DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)", body, re.I):
            add(base + c.start(), f"col:{table}.{c.group(1)}", "xoa")

    # ---- Constraint ----
    for m in re.finditer(r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+CONSTRAINT\s+(\w+)", sql, re.I | re.S):
        t, c = m.group(1), m.group(2)
        add(m.start(), f"con:{t}.{c}", "tao",
            f"EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
            f"JOIN pg_namespace n ON n.oid=t.relnamespace "
            f"WHERE n.nspname='public' AND t.relname='{t}' AND c.conname='{c}')",
            f"constraint {c}")
    for m in re.finditer(r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)", sql, re.I | re.S):
        add(m.start(), f"con:{m.group(1)}.{m.group(2)}", "xoa")

    # ---- Bảng ----
    for m in re.finditer(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I):
        t = m.group(1)
        add(m.start(), f"tbl:{t}", "tao",
            f"EXISTS(SELECT 1 FROM information_schema.tables "
            f"WHERE table_schema='public' AND table_name='{t}')", f"bảng {t}")
    for m in re.finditer(r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I):
        add(m.start(), f"tbl:{m.group(1)}", "xoa")

    # ---- View ----
    for m in re.finditer(r"CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)", sql, re.I):
        v = m.group(1)
        add(m.start(), f"view:{v}", "tao",
            f"EXISTS(SELECT 1 FROM information_schema.views "
            f"WHERE table_schema='public' AND table_name='{v}')", f"view {v}")
    for m in re.finditer(r"DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I):
        add(m.start(), f"view:{m.group(1)}", "xoa")

    # ---- Hàm ----
    for m in re.finditer(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)", sql, re.I):
        f = m.group(1)
        add(m.start(), f"fn:{f}", "tao",
            f"EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
            f"WHERE n.nspname='public' AND p.proname='{f}')", f"hàm {f}()")
    for m in re.finditer(r"DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I):
        add(m.start(), f"fn:{m.group(1)}", "xoa")

    # ---- Policy (nhận cả schema storage) ----
    for m in re.finditer(r'CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)', sql, re.I):
        name, schema, table = m.group(1), (m.group(2) or "public"), m.group(3)
        add(m.start(), f"pol:{schema}.{table}.{name}", "tao",
            f"EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='{schema}' "
            f"AND tablename='{table}' AND policyname='{q(name)}')",
            f"policy {table}/{name[:30]}")
    for m in re.finditer(r'DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)', sql, re.I):
        name, schema, table = m.group(1), (m.group(2) or "public"), m.group(3)
        add(m.start(), f"pol:{schema}.{table}.{name}", "xoa")

    # ---- Index ----
    for m in re.finditer(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", sql, re.I):
        i = m.group(1)
        add(m.start(), f"idx:{i}", "tao",
            f"EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='{i}')",
            f"index {i}")
    for m in re.finditer(r"DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I):
        add(m.start(), f"idx:{m.group(1)}", "xoa")

    return ev


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    files = sorted(glob.glob(os.path.join(MIG_DIR, "*.sql")))

    # Trạng thái cuối cùng của từng đối tượng: key -> (hành_động, biểu_thức, mô_tả, migration)
    final = OrderedDict()
    for path in files:
        base = os.path.basename(path)
        if base in SKIP:
            continue
        sql = strip_comments(open(path, encoding="utf-8").read())
        for _pos, key, act, expr, desc in sorted(scan(sql), key=lambda e: e[0]):
            if act == "xoa":
                final[key] = ("xoa", "", "", base)
            else:
                final[key] = ("tao", expr, desc, base)

    alive = [(k, e, d, m) for k, (a, e, d, m) in final.items() if a == "tao" and e]

    rows = "\n  UNION ALL\n".join(
        f"  SELECT '{q(m)}' AS migration, '{q(d)}' AS doi_tuong, ({e}) AS co"
        for _, e, d, m in alive
    )

    header = f"""-- ====================================================================
-- DÒ LỆCH MIGRATION — file TỰ SINH, KHÔNG sửa tay.
-- Sinh lại bằng: python3 scripts/build-drift-check.py
--
-- MỤC ĐÍCH: trả lời dứt điểm "database này có đủ schema mà mã nguồn
-- đang mong đợi không?".
--
-- CÁCH HOẠT ĐỘNG: duyệt toàn bộ {len(files)} migration theo thứ tự và tính
-- TRẠNG THÁI CUỐI CÙNG của từng đối tượng. Đối tượng bị migration sau
-- xoá/thay thế (vd cột qr_login_token của 087 bị 088 chuyển sang bảng
-- riêng, hay policy bị đổi tên qua nhiều đợt sửa RLS) sẽ KHÔNG bị kiểm —
-- nhờ vậy không còn báo động giả.
--
-- Tổng số đối tượng schema cần có ở hiện tại: {len(alive)}
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run.
-- Chỉ ĐỌC metadata schema, KHÔNG đụng dữ liệu.
--
-- ĐỌC KẾT QUẢ: mỗi dòng trả về là MỘT ĐỐI TƯỢNG ĐANG THIẾU, kèm tên
-- migration cần chạy để bù. Không có dòng nào = schema đã khớp mã nguồn.
-- ====================================================================

WITH mong_doi(migration, doi_tuong, co) AS (
{rows}
)
SELECT
  migration AS chay_migration_nay_de_bu,
  string_agg(doi_tuong, ', ' ORDER BY doi_tuong) AS doi_tuong_dang_thieu,
  count(*) AS so_luong
FROM mong_doi
WHERE NOT co
GROUP BY migration
ORDER BY migration;

-- Muốn xem toàn bộ (kể cả đối tượng đã có): đổi "WHERE NOT co" thành
-- "WHERE true" và bỏ GROUP BY.
"""

    open(OUT, "w", encoding="utf-8").write(header)
    print(f"Đã sinh {OUT}")
    print(f"  Duyệt {len(files)} migration → {len(alive)} đối tượng cần kiểm")
    print(f"  (đã loại {len(final) - len(alive)} đối tượng bị migration sau xoá/thay thế)")


if __name__ == "__main__":
    main()
