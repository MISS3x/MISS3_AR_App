-- ====================================================
-- MISS3 AR App — Supabase Tables for AR Ruler
-- Run this in Supabase SQL Editor
-- ====================================================

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS ar_measurements CASCADE;
DROP TABLE IF EXISTS ar_projects CASCADE;

-- 1) AR Projects
CREATE TABLE ar_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ar_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own projects"
  ON ar_projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own projects"
  ON ar_projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON ar_projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) AR Measurements (shapes)
CREATE TABLE ar_measurements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES ar_projects(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  shape_number INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE ar_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own measurements"
  ON ar_measurements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own measurements"
  ON ar_measurements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own measurements"
  ON ar_measurements FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own measurements"
  ON ar_measurements FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
