-- 015_ar_sketch.sql
-- AR Sketch: SketchUp-style 3D drawing in AR
-- Stores individual shapes and periodic full-state snapshots

-- Individual shapes drawn in AR Sketch
CREATE TABLE IF NOT EXISTS ar_sketch_shapes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  shape_type TEXT NOT NULL DEFAULT 'polygon',  -- 'line','polygon','extrusion','cut','rect','freeform'
  name TEXT,
  points JSONB NOT NULL DEFAULT '[]',          -- [{x,y,z}, ...]
  is_closed BOOLEAN DEFAULT false,
  height FLOAT,                                -- extrusion height (null for flat shapes)
  area FLOAT,
  perimeter FLOAT,
  color TEXT,                                  -- hex color for rendering
  sort_order INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',                 -- extra data (cut result, edge info, etc.)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Periodic full-state snapshots (all shapes as JSON blob)
CREATE TABLE IF NOT EXISTS ar_sketch_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  shapes_json JSONB NOT NULL DEFAULT '[]',     -- full state from getCurrentShapes()
  roomplan_json JSONB,                         -- background RoomPlan data
  mesh_url TEXT,                               -- optional mesh export URL
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sketch_shapes_project ON ar_sketch_shapes(project_id);
CREATE INDEX IF NOT EXISTS idx_sketch_snapshots_project ON ar_sketch_snapshots(project_id);

-- RLS
ALTER TABLE ar_sketch_shapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_sketch_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their sketch shapes"
  ON ar_sketch_shapes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their sketch snapshots"
  ON ar_sketch_snapshots FOR ALL USING (auth.uid() = user_id);
