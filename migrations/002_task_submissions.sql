-- Migration: Add task submission system + new task columns
-- Run this in Supabase SQL Editor

-- 1. Add new columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reference_image_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_screenshots INTEGER DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS channel_username TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_fields JSONB;

-- 2. Create task_submissions table
CREATE TABLE IF NOT EXISTS task_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  submitted_data JSONB,
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

-- 3. Create task_submission_images table
CREATE TABLE IF NOT EXISTS task_submission_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID REFERENCES task_submissions(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type TEXT DEFAULT 'screenshot',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Add indexes
CREATE INDEX IF NOT EXISTS idx_task_submissions_user ON task_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status ON task_submissions(status);
CREATE INDEX IF NOT EXISTS idx_task_submission_images_submission ON task_submission_images(submission_id);

-- 5. Create storage bucket for task images
INSERT INTO storage.buckets (id, name, public) VALUES ('task-images', 'task-images', true) ON CONFLICT (id) DO NOTHING;

-- 6. Storage policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read task images' AND tablename = 'objects') THEN
    CREATE POLICY "Public read task images" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'task-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated upload task images' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated upload task images" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'task-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated delete task images' AND tablename = 'objects') THEN
    CREATE POLICY "Authenticated delete task images" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'task-images');
  END IF;
END $$;
