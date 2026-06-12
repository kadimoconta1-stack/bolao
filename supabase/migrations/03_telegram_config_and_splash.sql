-- Migration: 03_telegram_config_and_splash
-- Adds telegram_config table and show_splash_screen column to pools

-- ─── 1. Telegram Config table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telegram_config (
  id              INT PRIMARY KEY DEFAULT 1,
  bot_token       TEXT NOT NULL DEFAULT '',
  admin_chat_id   TEXT NOT NULL DEFAULT '',
  webhook_secret  TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: block public reads; only service-role (Edge Functions) can access
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;

-- No public SELECT policy — Edge Functions use service role key which bypasses RLS
-- Deny all by default (no policies = deny all for anon/authenticated)

-- ─── 2. Add show_splash_screen column to pools ───────────────────────────────
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS show_splash_screen BOOLEAN NOT NULL DEFAULT false;
