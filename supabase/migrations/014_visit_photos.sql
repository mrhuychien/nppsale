-- =====================================================================
-- Migration 014: Visit photos + extended result codes
-- =====================================================================
-- Extends visit_logs so check-in can attach a photo and a free-text note.
-- Photos are stored in the Supabase Storage bucket `visit-photos`.

ALTER TABLE visit_logs
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS check_in_address text;

-- Storage bucket for visit photos (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: any authenticated user of the org can upload to their
-- own folder (<org_id>/...); anyone authenticated can read (bucket is public
-- for simple CDN delivery but we still restrict writes via RLS).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_insert'
  ) THEN
    CREATE POLICY "visit_photos_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'visit-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_select'
  ) THEN
    CREATE POLICY "visit_photos_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'visit-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'visit_photos_delete'
  ) THEN
    CREATE POLICY "visit_photos_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'visit-photos'
        AND (split_part(name, '/', 1))::uuid = public.user_org_id()
      );
  END IF;
END $$;
