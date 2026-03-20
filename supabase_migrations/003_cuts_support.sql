-- ====================================================
-- MISS3 AR App — Cut Sections Support
-- Run this in Supabase SQL Editor
-- ====================================================

-- Cut sections table
CREATE TABLE IF NOT EXISTS ar_cuts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ar_projects(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  cut_type TEXT NOT NULL DEFAULT 'horizontal', -- 'horizontal' or 'vertical'
  plane_height FLOAT,           -- Y position for horizontal cuts
  plane_rotation FLOAT DEFAULT 0, -- Z-axis rotation in degrees for vertical cuts
  plane_origin_x FLOAT DEFAULT 0,
  plane_origin_y FLOAT DEFAULT 0,
  plane_origin_z FLOAT DEFAULT 0,
  polyline JSONB,               -- [{x,y,z}, ...] intersection polyline
  total_length FLOAT DEFAULT 0,
  segment_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_cuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own cuts"
  ON ar_cuts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own cuts"
  ON ar_cuts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own cuts"
  ON ar_cuts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cuts"
  ON ar_cuts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
