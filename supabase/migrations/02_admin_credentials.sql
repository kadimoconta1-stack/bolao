-- Migration: 02_admin_credentials
-- Create admin_credentials table to support changing the admin password from the dashboard

CREATE TABLE IF NOT EXISTS public.admin_credentials (
  id integer PRIMARY KEY DEFAULT 1,
  password_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Enable RLS (default blocks all public SELECT/INSERT/UPDATE)
ALTER TABLE public.admin_credentials ENABLE ROW LEVEL SECURITY;
