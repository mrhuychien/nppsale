#!/usr/bin/env python3
"""
Sinh file SQL dò LỆCH MIGRATION: so sánh schema thật trên database với
những gì thư mục supabase/migrations/ mong đợi.

Vì sao cần: DB production có thể chạy thiếu migration mà KHÔNG có dấu hiệu
gì rõ ràng — biểu hiện chỉ là "danh sách rỗng", "lưu thất bại"... rất khó
truy. Công cụ này trả lời dứt điểm: migration nào đã chạy, migration nào chưa.

Chạy:  python3 scripts/build-drift-check.py
Kết quả: supabase/diagnostics/check_migration_drift.sql
"""
import os
import re
import glob

MIG_DIR = "supabase/migrations"
OUT = "supabase/diagnostics/check_migration_drift.sql"

# Bỏ qua các migration chỉ chứa dữ liệu/seed hoặc thao tác không để lại
# dấu vết schema kiểm tra được.
SKIP = {"003_seed.sql"}


def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql


def probes_for(sql: str):
    """Trả về danh sách (loại, biểu_thức_SQL_kiểm_tra, mô_tả)."""
    out = []

    # Cột thêm vào bảng — dấu hiệu chắc chắn và rẻ nhất để kiểm tra.
    for m in re.finditer(
        r"ALTER\s+TABLE\s+(?:public\.)?(\w+)(.*?);", sql, re.S | re.I
    ):
        table, body = m.group(1), m.group(2)
        for c in re.finditer(
            r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", body, re.I
        ):
            out.append((
                "cot",
                f"EXISTS(SELECT 1 FROM information_schema.columns "
                f"WHERE table_schema='public' AND table_name='{table}' "
                f"AND column_name='{c.group(1)}')",
                f"{table}.{c.group(1)}",
            ))

    # Constraint thêm vào bảng. Quan trọng: migration 024 chỉ đổi CHECK
    # constraint nên nếu không kiểm cái này sẽ bỏ sót — mà đó chính là
    # nguyên nhân lỗi "không lưu được phân quyền" từng gặp.
    for m in re.finditer(
        r"ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+CONSTRAINT\s+(\w+)", sql, re.I | re.S
    ):
        out.append((
            "constraint",
            f"EXISTS(SELECT 1 FROM pg_constraint c "
            f"JOIN pg_class t ON t.oid=c.conrelid "
            f"JOIN pg_namespace n ON n.oid=t.relnamespace "
            f"WHERE n.nspname='public' AND t.relname='{m.group(1)}' "
            f"AND c.conname='{m.group(2)}')",
            f"constraint {m.group(2)}",
        ))

    # Bảng mới
    for m in re.finditer(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)", sql, re.I
    ):
        out.append((
            "bang",
            f"EXISTS(SELECT 1 FROM information_schema.tables "
            f"WHERE table_schema='public' AND table_name='{m.group(1)}')",
            f"bảng {m.group(1)}",
        ))

    # View
    for m in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)", sql, re.I
    ):
        out.append((
            "view",
            f"EXISTS(SELECT 1 FROM information_schema.views "
            f"WHERE table_schema='public' AND table_name='{m.group(1)}')",
            f"view {m.group(1)}",
        ))

    # Hàm
    for m in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)", sql, re.I
    ):
        out.append((
            "ham",
            f"EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
            f"WHERE n.nspname='public' AND p.proname='{m.group(1)}')",
            f"hàm {m.group(1)}()",
        ))

    # Policy — chỉ lấy policy được CREATE (không tính DROP)
    for m in re.finditer(
        r"CREATE\s+POLICY\s+\"([^\"]+)\"\s+ON\s+(?:public\.)?(\w+)", sql, re.I
    ):
        name = m.group(1).replace("'", "''")
        out.append((
            "policy",
            f"EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' "
            f"AND tablename='{m.group(2)}' AND policyname='{name}')",
            f"policy {m.group(2)}/{m.group(1)[:28]}",
        ))

    # Index
    for m in re.finditer(
        r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)",
        sql, re.I,
    ):
        out.append((
            "index",
            f"EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' "
            f"AND indexname='{m.group(1)}')",
            f"index {m.group(1)}",
        ))

    return out


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    files = sorted(glob.glob(os.path.join(MIG_DIR, "*.sql")))
    blocks, skipped = [], []

    for path in files:
        base = os.path.basename(path)
        if base in SKIP:
            skipped.append((base, "seed dữ liệu"))
            continue
        sql = strip_comments(open(path, encoding="utf-8").read())
        probes = probes_for(sql)
        # Khử trùng lặp, giữ tối đa 6 phép kiểm cho mỗi migration.
        seen, uniq = set(), []
        for kind, expr, desc in probes:
            if expr in seen:
                continue
            seen.add(expr)
            uniq.append((kind, expr, desc))
            if len(uniq) >= 6:
                break
        if not uniq:
            skipped.append((base, "không có đối tượng schema kiểm tra được"))
            continue

        total = len(uniq)
        found = " + ".join(f"(CASE WHEN {e} THEN 1 ELSE 0 END)" for _, e, _ in uniq)
        missing = " || ".join(
            f"(CASE WHEN {e} THEN '' ELSE '{d.replace(chr(39), chr(39) * 2)}, ' END)"
            for _, e, d in uniq
        )
        blocks.append(f"""  SELECT
    '{base}' AS migration,
    {total} AS can_co,
    ({found}) AS dang_co,
    NULLIF(rtrim({missing}, ', '), '') AS thieu_gi""")

    body = "\n  UNION ALL\n".join(blocks)

    header = f"""-- ====================================================================
-- DÒ LỆCH MIGRATION — file TỰ SINH, KHÔNG sửa tay.
-- Sinh lại bằng: python3 scripts/build-drift-check.py
--
-- MỤC ĐÍCH: trả lời dứt điểm "database production đã chạy đủ migration
-- chưa?". Nhiều lỗi khó hiểu (danh sách rỗng, lưu thất bại, phân quyền
-- không lưu được) đều bắt nguồn từ việc DB thiếu migration mà không có
-- thông báo nào.
--
-- CÁCH DÙNG: dán toàn bộ file vào Supabase → SQL Editor → Run.
-- Chỉ ĐỌC metadata schema, KHÔNG đụng dữ liệu.
--
-- ĐỌC KẾT QUẢ:
--   trang_thai = 'DU'      → migration đã chạy đầy đủ
--   trang_thai = 'THIEU'   → CHƯA chạy (hoặc chạy dở) → xem cột thieu_gi
--   trang_thai = 'MOT_PHAN'→ chạy dở dang, cần xem kỹ
--
-- Số migration được kiểm: {len(blocks)} / {len(files)} file
-- ====================================================================

WITH kiem_tra AS (
{body}
)
SELECT
  migration,
  CASE
    WHEN dang_co = can_co THEN 'DU'
    WHEN dang_co = 0      THEN 'THIEU'
    ELSE 'MOT_PHAN'
  END AS trang_thai,
  dang_co || '/' || can_co AS doi_tuong,
  thieu_gi
FROM kiem_tra
WHERE dang_co < can_co          -- chỉ hiện migration CÓ VẤN ĐỀ
ORDER BY migration;

-- Bỏ dòng WHERE ở trên nếu muốn xem TẤT CẢ migration (kể cả đã đủ).
"""

    open(OUT, "w", encoding="utf-8").write(header)
    print(f"Đã sinh {OUT}")
    print(f"  Kiểm tra {len(blocks)} migration")
    if skipped:
        print(f"  Bỏ qua {len(skipped)}: " + ", ".join(f"{b} ({r})" for b, r in skipped[:6]))


if __name__ == "__main__":
    main()
