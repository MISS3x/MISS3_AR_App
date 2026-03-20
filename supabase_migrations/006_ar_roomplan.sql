-- ====================================================
-- MISS3 AR App — RoomPlan structured room data
-- Run this in Supabase SQL Editor
-- ====================================================

-- Store structured RoomPlan CapturedRoom data (walls, doors, windows, floors, objects)
CREATE TABLE IF NOT EXISTS ar_roomplan (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  walls JSONB DEFAULT '[]',
  doors JSONB DEFAULT '[]',
  windows JSONB DEFAULT '[]',
  openings JSONB DEFAULT '[]',
  floors JSONB DEFAULT '[]',
  objects JSONB DEFAULT '[]',
  wall_count INTEGER DEFAULT 0,
  door_count INTEGER DEFAULT 0,
  window_count INTEGER DEFAULT 0,
  object_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_roomplan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own roomplan"
  ON ar_roomplan FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own roomplan"
  ON ar_roomplan FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own roomplan"
  ON ar_roomplan FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own roomplan"
  ON ar_roomplan FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
