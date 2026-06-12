-- Migration: 04_telegram_config_expansion
-- Expands telegram_config to support admin_user_id, group_chat_id, bot_username, and bot_id

ALTER TABLE public.telegram_config
  ADD COLUMN IF NOT EXISTS admin_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_chat_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bot_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bot_id TEXT NOT NULL DEFAULT '';
