-- ====================================================
-- MISS3 AR App — Add is_auto column to ar_photos
-- Run this in Supabase SQL Editor
-- ====================================================

ALTER TABLE ar_photos ADD COLUMN IF NOT EXISTS is_auto BOOLEAN DEFAULT false;

-- Public read policy (for web viewer)
DROP POLICY IF EXISTS "Public can view photos" ON ar_photos;
CREATE POLICY "Public can view photos"
  ON ar_photos FOR SELECT TO public
  USING (true);
