-- ====================================================
-- MISS3 AR App — Scene Anchors for Multi-Session Alignment
-- Run this in Supabase SQL Editor
-- ====================================================

CREATE TABLE IF NOT EXISTS ar_scene_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'manual',  -- manual | auto | roomplan_corner
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  position_z FLOAT NOT NULL,
  rotation_x FLOAT DEFAULT 0,
  rotation_y FLOAT DEFAULT 0,
  rotation_z FLOAT DEFAULT 0,
  thumbnail_path TEXT,
  scan_session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_scene_anchors ENABLE ROW LEVEL SECURITY;

-- Drop all policies first to avoid duplicates
DROP POLICY IF EXISTS "Users can insert own anchors" ON ar_scene_anchors;
DROP POLICY IF EXISTS "Users can view own anchors" ON ar_scene_anchors;
DROP POLICY IF EXISTS "Public can view anchors" ON ar_scene_anchors;
DROP POLICY IF EXISTS "Users can update own anchors" ON ar_scene_anchors;
DROP POLICY IF EXISTS "Users can delete own anchors" ON ar_scene_anchors;

CREATE POLICY "Users can insert own anchors"
  ON ar_scene_anchors FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own anchors"
  ON ar_scene_anchors FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Public can view anchors"
  ON ar_scene_anchors FOR SELECT TO public
  USING (true);

CREATE POLICY "Users can update own anchors"
  ON ar_scene_anchors FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own anchors"
  ON ar_scene_anchors FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Index for fast project lookup
CREATE INDEX IF NOT EXISTS idx_scene_anchors_project ON ar_scene_anchors(project_id);
