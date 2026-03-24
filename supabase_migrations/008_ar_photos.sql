-- ====================================================
-- MISS3 AR App — AR Photos table + storage bucket
-- Run this in Supabase SQL Editor
-- ====================================================

-- 1) Create ar_photos table for geolocated AR photos
CREATE TABLE IF NOT EXISTS ar_photos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  file_path TEXT NOT NULL,
  public_url TEXT,
  transform JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own photos"
  ON ar_photos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own photos"
  ON ar_photos FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own photos"
  ON ar_photos FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) Create ar-photos storage bucket (public, 20MB max)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ar-photos', 'ar-photos', true, 20971520, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

-- 3) Storage policies — authenticated users can upload/read/delete own photos
CREATE POLICY "Users upload own photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ar-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read ar-photos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'ar-photos');

CREATE POLICY "Users delete own photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ar-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
