-- ====================================================
-- MISS3 AR App — Fix RLS Policies for Mesh Upload
-- Run this in Supabase SQL Editor
-- ====================================================

-- 1) Storage: Allow UPDATE for upsert operations
-- The app uses supabase.storage.upload(path, file, { upsert: true })
-- which requires both INSERT and UPDATE policies
CREATE POLICY "Users update own meshes"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'mesh-scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'mesh-scans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2) ar_mesh_scans: Allow UPDATE and UPSERT
CREATE POLICY "Users can update own mesh scans"
  ON ar_mesh_scans FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3) ar_projects: Allow UPDATE (for mesh_url, mesh_vertices_count, etc.)
-- Check if this policy already exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ar_projects' AND policyname = 'Users can update own projects'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can update own projects"
      ON ar_projects FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

-- 4) ar_bounding_boxes: Allow UPSERT (the app uses .upsert())
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ar_bounding_boxes' AND policyname = 'Users can update own bounding boxes'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can update own bounding boxes"
      ON ar_bounding_boxes FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

-- 5) Public read access for ar_mesh_scans (for web viewer)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ar_mesh_scans' AND policyname = 'Public can view mesh scans'
  ) THEN
    EXECUTE 'CREATE POLICY "Public can view mesh scans"
      ON ar_mesh_scans FOR SELECT
      TO public
      USING (true)';
  END IF;
END $$;
