-- AR Sketch objects table
-- Stores every shape/object created in AR Sketch tool
-- Supports real-time sync to web viewer via Supabase Realtime

CREATE TABLE IF NOT EXISTS ar_sketch_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text REFERENCES ar_projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  shape_type text NOT NULL,
  name text,
  points jsonb DEFAULT '[]'::jsonb,
  is_closed boolean DEFAULT false,
  height real,
  radius real,
  radius2 real,
  position jsonb,
  rotation jsonb,
  scale jsonb,
  color text DEFAULT '#4CAF50',
  sort_order integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_sketch_objects_project ON ar_sketch_objects(project_id);
CREATE INDEX IF NOT EXISTS idx_sketch_objects_user ON ar_sketch_objects(user_id);

-- Row Level Security
ALTER TABLE ar_sketch_objects ENABLE ROW LEVEL SECURITY;

-- RLS (idempotent)
DROP POLICY IF EXISTS "Users can CRUD own sketch objects" ON ar_sketch_objects;

CREATE POLICY "Users can CRUD own sketch objects"
  ON ar_sketch_objects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Realtime (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ar_sketch_objects'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ar_sketch_objects;
  END IF;
END $$;
