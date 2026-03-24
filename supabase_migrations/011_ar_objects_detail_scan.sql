-- ====================================================
-- MISS3 AR App — Extend ar_objects for Detail Capture
-- Run this in Supabase SQL Editor
-- ====================================================

-- Add project linkage + room positioning + texture
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES ar_projects(id) ON DELETE SET NULL;
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS texture_path TEXT;
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS room_transform FLOAT[] DEFAULT '{}';
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS scan_type TEXT DEFAULT 'standalone'; -- standalone | detail

-- Allow public read so web viewer can display objects
DROP POLICY IF EXISTS "Public can view objects" ON ar_objects;
CREATE POLICY "Public can view objects"
  ON ar_objects FOR SELECT TO public
  USING (true);

-- Index for project lookup
CREATE INDEX IF NOT EXISTS idx_ar_objects_project ON ar_objects(project_id);
