-- Read-only catalog metadata. No rows, function bodies, passwords or SQL text.
-- Follow outgoing dependencies and attached internal/automatic objects so
-- defaults, policies, indexes, triggers and rewrite rules are represented.
WITH RECURSIVE
selected_schemas AS (
  SELECT oid FROM pg_namespace WHERE nspname IN ('public', 'auth', 'storage')
),
edges AS (
  SELECT classid, objid, refclassid, refobjid FROM pg_depend
  UNION
  SELECT refclassid, refobjid, classid, objid FROM pg_depend
  WHERE deptype IN ('a', 'i', 'P', 'S')
),
objects(classid, objid) AS (
  SELECT classid, objid FROM pg_depend
  WHERE refclassid = 'pg_namespace'::regclass
    AND refobjid IN (SELECT oid FROM selected_schemas)
  UNION
  SELECT e.refclassid, e.refobjid FROM objects o
  JOIN edges e ON e.classid = o.classid AND e.objid = o.objid
),
required_extensions AS (
  SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname <> 'plpgsql' AND (
    EXISTS (SELECT 1 FROM objects o
      WHERE o.classid = 'pg_extension'::regclass AND o.objid = e.oid)
    -- SQL string bodies do not reliably register pg_depend edges. Migrations
    -- 177 and 205 explicitly require these real PostgreSQL extensions.
    OR e.extname IN ('unaccent', 'pg_trgm')
  )
),
required_roles AS (
  SELECT DISTINCT r.rolname AS name
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  CROSS JOIN LATERAL unnest(p.polroles) AS policy_role(oid)
  JOIN pg_roles r ON r.oid = policy_role.oid
  WHERE c.relnamespace IN (SELECT oid FROM selected_schemas)
)
SELECT json_build_object(
  'format', 1,
  'extensions', COALESCE((SELECT json_agg(e ORDER BY e.name) FROM required_extensions e), '[]'::json),
  'roles', COALESCE((SELECT json_agg(r ORDER BY r.name) FROM required_roles r), '[]'::json)
);
