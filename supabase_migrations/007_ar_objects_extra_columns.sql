-- ====================================================
-- MISS3 AR App — ar_objects extra columns
-- Aligns with SHARED_CONTRACT.md
-- Run in Supabase SQL Editor
-- ====================================================

-- Add name column for object title
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS name TEXT;

-- Add thumbnail_path for preview images
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- Add metadata JSONB for flexible extra data
ALTER TABLE ar_objects ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add file_size_bytes (SHARED_CONTRACT uses this name, rename if needed)
-- The existing column is `file_size`, keeping for backward compat
