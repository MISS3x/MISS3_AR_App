-- ====================================================
-- MISS3 AR App — Object Scanner Tables & Storage
-- Run this in Supabase SQL Editor
-- ====================================================

-- 1) Create ar_objects table for tracking 3D photo-scanned models
CREATE TABLE IF NOT EXISTS ar_objects (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  storage_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  format TEXT DEFAULT 'usdz',
  status TEXT DEFAULT 'uploaded',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own objects"
  ON ar_objects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own objects"
  ON ar_objects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own objects"
  ON ar_objects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own objects"
  ON ar_objects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
