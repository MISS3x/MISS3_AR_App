-- ====================================================
-- MISS3 AR App — AR Tape Measurement Items
-- Run this in Supabase SQL Editor
-- ====================================================

CREATE TABLE IF NOT EXISTS ar_tape_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  measure_type TEXT NOT NULL DEFAULT 'length',  -- length | area | volume | count
  operation TEXT DEFAULT '+',                    -- + | - | × | ÷
  value FLOAT,
  unit TEXT DEFAULT 'm',                         -- m | m² | m³ | ks
  points JSONB,                                  -- [{x, y, z}, ...] raw 3D points
  is_closed BOOLEAN DEFAULT false,
  perimeter FLOAT,
  area FLOAT,
  height FLOAT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_tape_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own tape items" ON ar_tape_items;
CREATE POLICY "Users can insert own tape items"
  ON ar_tape_items FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own tape items" ON ar_tape_items;
CREATE POLICY "Users can view own tape items"
  ON ar_tape_items FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view tape items" ON ar_tape_items;
CREATE POLICY "Public can view tape items"
  ON ar_tape_items FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Users can update own tape items" ON ar_tape_items;
CREATE POLICY "Users can update own tape items"
  ON ar_tape_items FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own tape items" ON ar_tape_items;
CREATE POLICY "Users can delete own tape items"
  ON ar_tape_items FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tape_items_project ON ar_tape_items(project_id);

-- Add tool_type to ar_projects to distinguish tape vs scanner projects
ALTER TABLE ar_projects ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'scanner';
