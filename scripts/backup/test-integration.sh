#!/usr/bin/env bash
# Dummy fixture only: two independent disposable PostgreSQL 17 services.
set -euo pipefail
export PGPASSWORD=verify
export PGURL='postgresql://postgres@localhost:5434/fixture'
mkdir -p out
psql -X -v ON_ERROR_STOP=1 "$PGURL" <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION unaccent WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE auth.users(id integer PRIMARY KEY);
INSERT INTO auth.users VALUES (1);
CREATE TABLE storage.buckets(id text PRIMARY KEY);
CREATE TABLE public.products(id integer PRIMARY KEY, name text NOT NULL);
INSERT INTO public.products VALUES (1, 'Bánh');
CREATE FUNCTION public.khong_dau(text) RETURNS text LANGUAGE sql IMMUTABLE AS
  'SELECT extensions.unaccent(''extensions.unaccent''::regdictionary, $1)';
CREATE INDEX products_search ON public.products USING gin(name extensions.gin_trgm_ops);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_read ON public.products FOR SELECT TO authenticated USING (true);
SQL
pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage --file=out/dump.pgc
bash scripts/backup/prepare-target.sh
bash scripts/backup/verify-dump.sh
bash scripts/backup/verify-counts.sh
result=$(psql -X -v ON_ERROR_STOP=1 'postgresql://postgres@localhost:5433/verify' -tAc \
  "SELECT public.khong_dau('Bánh') = 'Banh' AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='products_search') AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname='products_read') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND NOT rolcanlogin AND NOT rolsuper);")
[[ "$result" == t ]]
printf 'Real unaccent function, trigram index, policy and confined role restored.\n'
