-- Supabase Schema Migration: 01_schema.sql
-- Bolão de Placar Exato System

-- 1. Enable RLS and clean up if needed
-- (Not dropping anything since this is the initial schema)

-- =========================================================================
-- 2. TABLES
-- =========================================================================

-- Pool configuration / settings
CREATE TABLE IF NOT EXISTS public.pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team_image_url TEXT,
    away_team_image_url TEXT,
    bet_amount NUMERIC NOT NULL,
    prize_percent NUMERIC DEFAULT 75 NOT NULL,
    deadline TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'FINISHED')) DEFAULT 'OPEN',
    allow_repeated_score BOOLEAN NOT NULL DEFAULT TRUE,
    max_bets_per_phone INTEGER NOT NULL DEFAULT 5,
    pix_key TEXT NOT NULL,
    pix_receiver_name TEXT NOT NULL,
    organizer_whatsapp TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT 'verde',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bets placed by participants
CREATE TABLE IF NOT EXISTS public.bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
    public_code TEXT UNIQUE NOT NULL,
    participant_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    score_key TEXT NOT NULL, -- e.g., "2-1"
    amount NUMERIC NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'REJECTED')) DEFAULT 'PENDING',
    payment_confirmed_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    admin_note TEXT,
    browser_session_id TEXT,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Result records of pools
CREATE TABLE IF NOT EXISTS public.results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE UNIQUE,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    score_key TEXT NOT NULL,
    total_winners INTEGER NOT NULL DEFAULT 0,
    total_prize NUMERIC NOT NULL DEFAULT 0,
    prize_per_winner NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin session management (token authentication instead of exposing password/cookies directly)
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rate limiting protection for admin panel
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- e.g., "admin" or IP representation
    ip_hash TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cryptographic math captcha validation
CREATE TABLE IF NOT EXISTS public.math_captchas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    question TEXT NOT NULL,
    answer_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit logger for core admin and betting actions
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    public_code TEXT,
    old_status TEXT,
    new_status TEXT,
    actor TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- 3. INDEXES
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_bets_pool_id ON public.bets(pool_id);
CREATE INDEX IF NOT EXISTS idx_bets_public_code ON public.bets(public_code);
CREATE INDEX IF NOT EXISTS idx_bets_phone_normalized ON public.bets(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_bets_score_key ON public.bets(score_key);
CREATE INDEX IF NOT EXISTS idx_bets_status ON public.bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_pool_score ON public.bets(pool_id, score_key);
CREATE INDEX IF NOT EXISTS idx_bets_pool_phone ON public.bets(pool_id, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_results_pool_id ON public.results(pool_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON public.admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_math_captchas_token_hash ON public.math_captchas(token_hash);

-- =========================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- Enable RLS on all tables
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.math_captchas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. POOLS RLS Policies
-- Anyone can view pools configuration details
CREATE POLICY "Allow public SELECT on pools"
    ON public.pools
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- No public modification of pools allowed
CREATE POLICY "Block public WRITE on pools"
    ON public.pools
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

-- 2. BETS RLS Policies
-- Bets are sensitive because they contain names and phones. Direct SELECT is completely blocked for public (anon/authenticated).
-- Any public consultation should use the secure Views or secure Edge Functions/RPC functions.
CREATE POLICY "Block public SELECT on bets"
    ON public.bets
    FOR SELECT
    TO anon, authenticated
    USING (false);

-- No public insert/update/delete on bets directly
CREATE POLICY "Block public WRITE on bets"
    ON public.bets
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

-- 3. RESULTS RLS Policies
-- Anyone can see results
CREATE POLICY "Allow public SELECT on results"
    ON public.results
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- No public write on results
CREATE POLICY "Block public WRITE on results"
    ON public.results
    FOR ALL
    TO anon, authenticated
    USING (false)
    WITH CHECK (false);

-- 4. Other tables: Block all public access (Select and Write)
CREATE POLICY "Block public on admin_sessions" ON public.admin_sessions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block public on admin_login_attempts" ON public.admin_login_attempts FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block public on math_captchas" ON public.math_captchas FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "Block public on audit_logs" ON public.audit_logs FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- =========================================================================
-- 5. PUBLIC VIEWS (Bypass RLS securely by returning only non-sensitive data)
-- =========================================================================

-- View for the transparency board (shows only paid bets and hides personal data)
CREATE OR REPLACE VIEW public.public_paid_bets AS
    SELECT 
        public_code,
        score_key,
        status,
        is_winner,
        created_at
    FROM public.bets
    WHERE status = 'PAID';

-- Grant access to the transparency view
GRANT SELECT ON public.public_paid_bets TO anon, authenticated;

-- View for basic public summary of pool metrics
CREATE OR REPLACE VIEW public.public_pool_summary AS
    SELECT
        p.id AS pool_id,
        COUNT(b.id) FILTER (WHERE b.status = 'PAID') AS total_paid_bets,
        p.bet_amount,
        p.prize_percent,
        (COUNT(b.id) FILTER (WHERE b.status = 'PAID') * p.bet_amount * (p.prize_percent / 100.0)) AS estimated_prize
    FROM public.pools p
    LEFT JOIN public.bets b ON b.pool_id = p.id
    GROUP BY p.id, p.bet_amount, p.prize_percent;

-- Grant access to public pool summary
GRANT SELECT ON public.public_pool_summary TO anon, authenticated;

-- View for public consultation of any bet (shows status of pending/paid/rejected but hides personal data)
CREATE OR REPLACE VIEW public.public_bets_consultation AS
    SELECT 
        public_code,
        home_score,
        away_score,
        score_key,
        status,
        amount,
        is_winner,
        created_at,
        pool_id
    FROM public.bets;

-- Grant access to public consultation view
GRANT SELECT ON public.public_bets_consultation TO anon, authenticated;
