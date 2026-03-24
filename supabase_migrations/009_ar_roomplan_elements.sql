-- ====================================================
-- MISS3 AR App — Per-Element RoomPlan Persistence
-- Run this in Supabase SQL Editor
-- ====================================================

-- Per-element table: each wall/door/window/object is its own row
CREATE TABLE IF NOT EXISTS ar_roomplan_elements (
  id UUID PRIMARY KEY,              -- Apple's element identifier (persistent across scans)
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  category TEXT NOT NULL,            -- 'wall', 'door', 'window', 'floor', 'opening', 'object'
  subcategory TEXT,                  -- For objects: 'chair', 'table', 'sofa', 'bed', etc.
  transform JSONB NOT NULL,          -- 4x4 matrix as array of 16 floats
  dimensions JSONB NOT NULL,         -- {width, height, depth}
  confidence TEXT DEFAULT 'high',    -- 'low', 'medium', 'high'
  is_finalized BOOLEAN DEFAULT false,
  scan_session_id TEXT,              -- Track which scan session last updated this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_roomplan_elements ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can manage own elements
CREATE POLICY "Users can insert own elements"
  ON ar_roomplan_elements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own elements"
  ON ar_roomplan_elements FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own elements"
  ON ar_roomplan_elements FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own elements"
  ON ar_roomplan_elements FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Public read for web viewer
CREATE POLICY "Public can view elements"
  ON ar_roomplan_elements FOR SELECT TO public
  USING (true);

-- Index for fast project queries
CREATE INDEX IF NOT EXISTS idx_roomplan_elements_project 
  ON ar_roomplan_elements(project_id);
