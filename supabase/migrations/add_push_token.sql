-- Run this in Supabase SQL editor
ALTER TABLE players ADD COLUMN IF NOT EXISTS push_token text;
