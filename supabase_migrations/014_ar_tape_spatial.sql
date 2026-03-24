-- ====================================================
-- MISS3 AR App — AR Tape Spatial Data
-- Separate tables for paid AR Tape module
-- Run this in Supabase SQL Editor
-- ====================================================

-- ═══════════════════════════════════════════════════
-- 1. ar_tape_points — individual named 3D points
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ar_tape_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  tape_item_id UUID REFERENCES ar_tape_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,                -- e.g. "Délka_01 — Bod 1"
  point_index INTEGER NOT NULL,      -- sequential order within the measurement
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  position_z FLOAT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_tape_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own tape points" ON ar_tape_points;
CREATE POLICY "Users can insert own tape points"
  ON ar_tape_points FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own tape points" ON ar_tape_points;
CREATE POLICY "Users can view own tape points"
  ON ar_tape_points FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view tape points" ON ar_tape_points;
CREATE POLICY "Public can view tape points"
  ON ar_tape_points FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Users can delete own tape points" ON ar_tape_points;
CREATE POLICY "Users can delete own tape points"
  ON ar_tape_points FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tape_points_project ON ar_tape_points(project_id);
CREATE INDEX IF NOT EXISTS idx_tape_points_item ON ar_tape_points(tape_item_id);

-- ═══════════════════════════════════════════════════
-- 2. ar_tape_floorplan — background floor plan data
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ar_tape_floorplan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  walls JSONB,       -- [{transform: [...], dimensions: {width, height}}]
  floors JSONB,      -- [{transform: [...], dimensions: {width, length}}]
  doors JSONB,       -- [{transform: [...], dimensions: {width, height}}]
  windows JSONB,     -- [{transform: [...], dimensions: {width, height}}]
  is_live BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_tape_floorplan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own tape floorplan" ON ar_tape_floorplan;
CREATE POLICY "Users can insert own tape floorplan"
  ON ar_tape_floorplan FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own tape floorplan" ON ar_tape_floorplan;
CREATE POLICY "Users can view own tape floorplan"
  ON ar_tape_floorplan FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view tape floorplan" ON ar_tape_floorplan;
CREATE POLICY "Public can view tape floorplan"
  ON ar_tape_floorplan FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Users can update own tape floorplan" ON ar_tape_floorplan;
CREATE POLICY "Users can update own tape floorplan"
  ON ar_tape_floorplan FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own tape floorplan" ON ar_tape_floorplan;
CREATE POLICY "Users can delete own tape floorplan"
  ON ar_tape_floorplan FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tape_floorplan_project ON ar_tape_floorplan(project_id);
