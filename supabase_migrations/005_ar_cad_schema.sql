-- ====================================================
-- MISS3 AR App — CAD Reconstruction Support
-- Run this in Supabase SQL Editor
-- ====================================================

-- 1) Add ARAnchors JSON column to projects for snapping rules
ALTER TABLE ar_projects
  ADD COLUMN IF NOT EXISTS ar_anchors_json JSONB DEFAULT '[]'::jsonb;

-- 2) Create ar_bounding_boxes for furniture and semantic objects
CREATE TABLE IF NOT EXISTS ar_bounding_boxes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ar_projects(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  class_name TEXT NOT NULL,         -- e.g., 'chair', 'table', 'sofa', 'window', 'door'
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  position_z FLOAT NOT NULL,
  rotation_x FLOAT NOT NULL DEFAULT 0,
  rotation_y FLOAT NOT NULL DEFAULT 0,
  rotation_z FLOAT NOT NULL DEFAULT 0,
  width FLOAT NOT NULL,
  height FLOAT NOT NULL,
  depth FLOAT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB DEFAULT '{}'::jsonb -- Additional metadata from RoomPlan
);

ALTER TABLE ar_bounding_boxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own bounding boxes"
  ON ar_bounding_boxes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own bounding boxes"
  ON ar_bounding_boxes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bounding boxes"
  ON ar_bounding_boxes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own bounding boxes"
  ON ar_bounding_boxes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
