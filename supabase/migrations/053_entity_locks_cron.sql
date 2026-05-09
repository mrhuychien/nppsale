-- ====================================================================
-- T-06 follow-up: schedule pg_cron job to release stale entity_locks
-- without relying on user activity.
--
-- Mig 046 already implements lazy cleanup inside acquire_entity_lock /
-- heartbeat_entity_lock — that handles 99% of cases (active users
-- always trigger sweeps). This migration adds a passive once-per-minute
-- sweep so locks held by a tab that crashed without any peers ever
-- trying to acquire still get released within ~10-11 min.
--
-- Idempotent + tolerant: skip the cron schedule when the pg_cron
-- extension isn't available (self-hosted Supabase without it,
-- local dev). Lazy cleanup keeps everything functional in that case.
-- ====================================================================

DO $$
DECLARE
  v_has_cron boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_has_cron;

  IF NOT v_has_cron THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping schedule. Lazy cleanup in acquire/heartbeat continues to work.';
    RETURN;
  END IF;

  -- Unschedule previous version if it exists (idempotent rerun).
  PERFORM cron.unschedule('release-stale-entity-locks')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'release-stale-entity-locks'
  );

  PERFORM cron.schedule(
    'release-stale-entity-locks',
    '* * * * *',
    $cron$ SELECT public.release_stale_entity_locks(); $cron$
  );

  RAISE NOTICE 'Scheduled release-stale-entity-locks (every minute).';
END $$;
