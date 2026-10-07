#!/usr/bin/env bash
set +x
set -euo pipefail
target='postgresql://postgres@localhost:5433/verify'
q="SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
if ! src=$(psql -X -v ON_ERROR_STOP=1 "$PGURL" -tAc "$q" 2>/dev/null); then
  printf '::error::BACKUP_SOURCE_TABLE_QUERY_FAILED\n'; exit 1
fi
if ! dst=$(psql -X -v ON_ERROR_STOP=1 "$target" -tAc "$q" 2>/dev/null); then
  printf '::error::BACKUP_RESTORED_TABLE_QUERY_FAILED\n'; exit 1
fi
if [[ ! "$src" =~ ^[0-9]+$ || ! "$dst" =~ ^[0-9]+$ || "$src" != "$dst" || "$dst" == 0 ]]; then
  printf '::error::BACKUP_TABLE_COUNT_MISMATCH_OR_INVALID\n'; exit 1
fi
usq='SELECT count(*) FROM auth.users;'
if ! su=$(psql -X -v ON_ERROR_STOP=1 "$PGURL" -tAc "$usq" 2>/dev/null); then
  printf '::error::BACKUP_SOURCE_USER_QUERY_FAILED\n'; exit 1
fi
if ! du=$(psql -X -v ON_ERROR_STOP=1 "$target" -tAc "$usq" 2>/dev/null); then
  printf '::error::BACKUP_RESTORED_USER_QUERY_FAILED\n'; exit 1
fi
if [[ ! "$su" =~ ^[0-9]+$ || ! "$du" =~ ^[0-9]+$ || "$su" != "$du" ]]; then
  printf '::error::BACKUP_USER_COUNT_MISMATCH_OR_INVALID\n'; exit 1
fi
printf 'Public table and auth.users counts match.\n'
