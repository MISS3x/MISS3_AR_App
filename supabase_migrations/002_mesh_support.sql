-- ====================================================
-- MISS3 AR App — Mesh Upload Support
-- Run this in Supabase SQL Editor
-- ====================================================

-- 1) Add mesh columns to ar_projects
ALTER TABLE ar_projects
  ADD COLUMN IF NOT EXISTS mesh_url TEXT,
  ADD COLUMN IF NOT EXISTS mesh_vertices_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mesh_faces_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mesh_file_size BIGINT DEFAULT 0;

-- 2) Create storage bucket for mesh files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mesh-scans',
  'mesh-scans',
  true,  -- Make it PUBLIC so web viewer can download models via public URL
  52428800,  -- 50MB max
  ARRAY['application/octet-stream', 'model/obj', 'text/plain', 'application/json']
)
ON CONFLICT (id) DO NOTHING;

-- 3) Storage RLS — authenticated users can upload to their own folder
CREATE POLICY "Users upload own meshes"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mesh-scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- NEW: Anyone can download the mesh (for the web 3D viewer)
CREATE POLICY "Public read access for meshes"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'mesh-scans');

CREATE POLICY "Users delete own meshes"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'mesh-scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4) Mesh scans metadata table (optional, for listing scans)
CREATE TABLE IF NOT EXISTS ar_mesh_scans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ar_projects(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  file_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  vertices_count INTEGER DEFAULT 0,
  faces_count INTEGER DEFAULT 0,
  format TEXT DEFAULT 'obj',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_mesh_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own mesh scans"
  ON ar_mesh_scans FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own mesh scans"
  ON ar_mesh_scans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mesh scans"
  ON ar_mesh_scans FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
