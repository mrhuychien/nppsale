-- ====================================================================
-- T-06: Hard-lock concurrency (pessimistic, with heartbeat)
--
-- Spec D5: when a user opens a record for editing, take a DB lock so
-- nobody else can. UI shows "🔒 [Tên] đang sửa" + readonly. Locks are
-- released by the holder explicitly OR auto-expire after 10 minutes
-- of no heartbeat (stale-cleanup runs lazily on every acquire attempt
-- — pg_cron not assumed available).
--
-- entity_type values mirror workflow_sessions where they overlap:
--   'sales_order' | 'stock_entry' | 'delivery' | 'driver_handover'
-- but the table accepts free-form text so other surfaces (returns,
-- customers…) can re-use the lock primitive.
-- ====================================================================

CREATE TABLE IF NOT EXISTS entity_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  locked_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locked_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_entity_lock UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_locks_heartbeat
  ON entity_locks (last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_entity_locks_holder
  ON entity_locks (locked_by);

ALTER TABLE entity_locks ENABLE ROW LEVEL SECURITY;

-- Read all locks in your org so the UI can show "đang khoá bởi X".
CREATE POLICY entity_locks_select ON entity_locks FOR SELECT
  USING (org_id = public.user_org_id());

-- Mutations only via the helper functions (SECURITY DEFINER) below.
CREATE POLICY entity_locks_no_direct_writes ON entity_locks FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON entity_locks TO authenticated;

-- --------------------------------------------------------------------
-- Stale-lock cleanup. Runs lazily inside acquire/heartbeat. 10-minute
-- threshold per spec D5.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_stale_entity_locks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM entity_locks
  WHERE last_heartbeat_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_stale_entity_locks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_stale_entity_locks() TO authenticated;

-- --------------------------------------------------------------------
-- acquire_entity_lock — atomic. Returns one row:
--   ok=true  + holder=auth.uid() when the caller now holds the lock.
--   ok=false + holder=<current> when someone else holds it.
-- Existing lock by the SAME user is treated as success and bumps the
-- heartbeat (idempotent re-mount).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION acquire_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS TABLE (
  ok boolean,
  holder_id uuid,
  holder_name text,
  locked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid := public.user_org_id();
  v_existing record;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Lazy stale cleanup so a crashed tab doesn't permanently lock a row.
  PERFORM release_stale_entity_locks();

  SELECT el.locked_by, el.locked_at, u.full_name
    INTO v_existing
  FROM entity_locks el
  JOIN users u ON u.id = el.locked_by
  WHERE el.entity_type = p_entity_type
    AND el.entity_id   = p_entity_id;

  IF FOUND THEN
    IF v_existing.locked_by = v_uid THEN
      -- Re-acquire by same user → bump heartbeat.
      UPDATE entity_locks
      SET last_heartbeat_at = now()
      WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

      RETURN QUERY
      SELECT true, v_uid, v_existing.full_name, v_existing.locked_at;
      RETURN;
    END IF;

    -- Held by someone else.
    RETURN QUERY
    SELECT false, v_existing.locked_by, v_existing.full_name, v_existing.locked_at;
    RETURN;
  END IF;

  -- No existing lock → take it.
  INSERT INTO entity_locks (org_id, entity_type, entity_id, locked_by)
  VALUES (v_org, p_entity_type, p_entity_id, v_uid);

  RETURN QUERY
  SELECT
    true,
    v_uid,
    (SELECT full_name FROM users WHERE id = v_uid),
    now()::timestamptz;
END;
$$;

REVOKE EXECUTE ON FUNCTION acquire_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acquire_entity_lock(text, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- heartbeat_entity_lock — bump last_heartbeat_at if you're the holder.
-- Returns true if your heartbeat was applied; false if the lock was
-- stolen / expired (caller should re-acquire or readonly the form).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION heartbeat_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  -- Cleanup stales first so a long-since-stale lock doesn't reappear.
  PERFORM release_stale_entity_locks();

  UPDATE entity_locks
  SET last_heartbeat_at = now()
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND locked_by   = v_uid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION heartbeat_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION heartbeat_entity_lock(text, uuid) TO authenticated;

-- --------------------------------------------------------------------
-- release_entity_lock — only the current holder can release.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_entity_lock(
  p_entity_type text,
  p_entity_id   uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  DELETE FROM entity_locks
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND locked_by   = v_uid;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_entity_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_entity_lock(text, uuid) TO authenticated;

COMMENT ON TABLE entity_locks IS
  'T-06: pessimistic per-record edit locks. Mutations only via acquire_/heartbeat_/release_entity_lock SECURITY DEFINER functions. Stales reaped at 10 minutes of no heartbeat.';
