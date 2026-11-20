-- ============================================================================
-- KINDRED PRODUCTION SCHEMA (Sprints 1-4: Auth, pgvector, Quotas, Billing, Evals)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. User Profiles & Subscription State
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Friend',
  birth_date DATE,
  is_age_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ai_disclosure_accepted_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'plus', 'pro')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'system')),
  proactive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  proactive_frequency TEXT NOT NULL DEFAULT 'balanced'
    CHECK (proactive_frequency IN ('off', 'low', 'balanced', 'high')),
  quiet_hours_start TIME NOT NULL DEFAULT '23:00',
  quiet_hours_end TIME NOT NULL DEFAULT '08:00',
  voice_speed REAL NOT NULL DEFAULT 1.0 CHECK (voice_speed BETWEEN 0.7 AND 1.4),
  allow_anonymized_training BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    IF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
      RAISE EXCEPTION 'Billing columns can only be modified by server webhooks.';
    END IF;
    IF NEW.birth_date IS NOT NULL THEN
      NEW.is_age_verified := (NEW.birth_date <= (CURRENT_DATE - INTERVAL '18 years'));
    ELSE
      NEW.is_age_verified := FALSE;
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_billing ON public.profiles;
CREATE TRIGGER trg_protect_profile_billing
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_columns();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_birth_date DATE;
  v_is_adult BOOLEAN := FALSE;
BEGIN
  BEGIN
    v_birth_date := NULLIF(TRIM(NEW.raw_user_meta_data ->> 'birth_date'), '')::DATE;
    IF v_birth_date IS NOT NULL THEN
      v_is_adult := (v_birth_date <= (CURRENT_DATE - INTERVAL '18 years'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_birth_date := NULL;
    v_is_adult := FALSE;
  END;

  INSERT INTO public.profiles (id, display_name, birth_date, is_age_verified, ai_disclosure_accepted_at)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data ->> 'display_name'), ''),
      SPLIT_PART(COALESCE(NEW.email, 'Friend'), '@', 1)
    ),
    v_birth_date,
    v_is_adult,
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. Versioned Archetype Prompts (Sprint 4 Canary & Auto-Rollback)
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  system_addendum TEXT NOT NULL,
  rationale TEXT,
  eval_human_score REAL,
  eval_memory_score REAL,
  eval_safety_passed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'canary', 'active', 'rolled_back')),
  traffic_pct INTEGER NOT NULL DEFAULT 0 CHECK (traffic_pct BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (archetype_slug, version)
);

-- 3. Companions
CREATE TABLE IF NOT EXISTS public.companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  archetype_slug TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'non-binary')),
  age SMALLINT NOT NULL DEFAULT 24 CHECK (age >= 18 AND age <= 99),
  avatar_url TEXT,
  personality_summary TEXT NOT NULL,
  communication_style TEXT NOT NULL,
  backstory TEXT NOT NULL,
  interests TEXT[] NOT NULL DEFAULT '{}',
  voice_id TEXT NOT NULL DEFAULT 'Aoede',
  chat_theme TEXT NOT NULL DEFAULT 'midnight',
  relationship_stage SMALLINT NOT NULL DEFAULT 1 CHECK (relationship_stage BETWEEN 1 AND 6),
  affinity_score INTEGER NOT NULL DEFAULT 0 CHECK (affinity_score >= 0),
  romantic_consent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  style_profile JSONB NOT NULL DEFAULT '{
    "reply_length": "balanced",
    "humor_level": 0.6,
    "emoji_density": 0.4,
    "support_style": "balanced",
    "recent_openers": [],
    "turn_count": 0
  }'::jsonb,
  ignored_proactive_count SMALLINT NOT NULL DEFAULT 0,
  last_proactive_at TIMESTAMPTZ,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companions_user_recent
  ON public.companions (user_id, last_interaction_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_companion_romantic_age_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_adult BOOLEAN;
BEGIN
  IF NEW.romantic_consent_enabled = TRUE THEN
    SELECT p.is_age_verified INTO v_adult FROM public.profiles p WHERE p.id = NEW.user_id;
    IF COALESCE(v_adult, FALSE) = FALSE THEN
      RAISE EXCEPTION 'Verified 18+ birth date in Settings is required before enabling romantic progression.';
    END IF;
  ELSE
    IF NEW.relationship_stage > 4 THEN
      NEW.relationship_stage := 4;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companion_romantic_gate ON public.companions;
CREATE TRIGGER trg_companion_romantic_gate
  BEFORE INSERT OR UPDATE ON public.companions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_companion_romantic_age_gate();

-- 4. Unified Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  modality TEXT NOT NULL DEFAULT 'text' CHECK (modality IN ('text', 'voice_note', 'live_call')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  is_proactive BOOLEAN NOT NULL DEFAULT FALSE,
  user_reaction TEXT CHECK (user_reaction IN ('love', 'laugh', 'up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_companion_timeline
  ON public.messages (user_id, companion_id, created_at DESC);

-- 5. Semantic Long-Term Memory (pgvector 768-dim)
CREATE TABLE IF NOT EXISTS public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  companion_id UUID REFERENCES public.companions(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('identity', 'interest', 'relationship', 'work_study', 'event', 'preference')
  ),
  fact TEXT NOT NULL CHECK (char_length(fact) BETWEEN 2 AND 500),
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
  superseded_by UUID REFERENCES public.memories(id) ON DELETE SET NULL,
  event_date DATE,
  embedding VECTOR(768),
  last_referenced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user_active
  ON public.memories (user_id, companion_id, status, importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
  ON public.memories USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_hybrid_memories(
  p_user_id UUID,
  p_companion_id UUID,
  p_query_embedding VECTOR(768),
  p_match_count INTEGER DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  category TEXT,
  fact TEXT,
  importance SMALLINT,
  event_date DATE,
  similarity REAL,
  hybrid_score REAL
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    m.id,
    m.category,
    m.fact,
    m.importance,
    m.event_date,
    CASE
      WHEN m.embedding IS NOT NULL THEN (1 - (m.embedding <=> p_query_embedding))::REAL
      ELSE 0.35::REAL
    END AS similarity,
    (
      0.55 * (
        CASE
          WHEN m.embedding IS NOT NULL THEN GREATEST(0, 1 - (m.embedding <=> p_query_embedding))
          ELSE 0.35
        END
      )
      + 0.25 * EXP(-EXTRACT(EPOCH FROM (NOW() - COALESCE(m.last_referenced_at, m.created_at))) / (86400.0 * 30.0))
      + 0.20 * (m.importance / 5.0)
    )::REAL AS hybrid_score
  FROM public.memories m
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND (m.companion_id = p_companion_id OR m.companion_id IS NULL)
  ORDER BY hybrid_score DESC
  LIMIT GREATEST(1, LEAST(p_match_count, 25));
$$;

-- 6. Daily Usage & Atomic Quotas
CREATE TABLE IF NOT EXISTS public.usage_daily (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  text_messages INTEGER NOT NULL DEFAULT 0 CHECK (text_messages >= 0),
  voice_seconds INTEGER NOT NULL DEFAULT 0 CHECK (voice_seconds >= 0),
  PRIMARY KEY (user_id, usage_date)
);

CREATE OR REPLACE FUNCTION public.consume_daily_message_quota()
RETURNS TABLE (allowed BOOLEAN, used_today INTEGER, daily_limit INTEGER, plan_tier TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan TEXT;
  v_limit INTEGER;
  v_used INTEGER;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT p.plan_tier INTO v_plan FROM public.profiles p WHERE p.id = v_uid;
  v_plan := COALESCE(v_plan, 'free');
  v_limit := CASE v_plan WHEN 'pro' THEN 5000 WHEN 'plus' THEN 500 ELSE 40 END;

  INSERT INTO public.usage_daily (user_id, usage_date, text_messages)
  VALUES (v_uid, CURRENT_DATE, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  UPDATE public.usage_daily u
  SET text_messages = u.text_messages + 1
  WHERE u.user_id = v_uid AND u.usage_date = CURRENT_DATE AND u.text_messages < v_limit
  RETURNING u.text_messages INTO v_used;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_used, v_limit, v_plan;
  ELSE
    SELECT u.text_messages INTO v_used
    FROM public.usage_daily u
    WHERE u.user_id = v_uid AND u.usage_date = CURRENT_DATE;
    RETURN QUERY SELECT FALSE, COALESCE(v_used, v_limit), v_limit, v_plan;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_daily_message_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_daily_message_quota() TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_voice_seconds_quota(p_seconds INTEGER)
RETURNS TABLE (allowed BOOLEAN, used_month INTEGER, monthly_limit INTEGER, plan_tier TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan TEXT;
  v_limit INTEGER;
  v_month_used INTEGER;
  v_add INTEGER := GREATEST(0, COALESCE(p_seconds, 0));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT p.plan_tier INTO v_plan FROM public.profiles p WHERE p.id = v_uid;
  v_plan := COALESCE(v_plan, 'free');
  v_limit := CASE v_plan WHEN 'pro' THEN 10800 WHEN 'plus' THEN 1800 ELSE 60 END;

  SELECT COALESCE(SUM(u.voice_seconds), 0)::INTEGER INTO v_month_used
  FROM public.usage_daily u
  WHERE u.user_id = v_uid AND u.usage_date >= date_trunc('month', CURRENT_DATE)::DATE;

  IF (v_month_used + v_add) > v_limit THEN
    RETURN QUERY SELECT FALSE, v_month_used, v_limit, v_plan;
    RETURN;
  END IF;

  IF v_add > 0 THEN
    INSERT INTO public.usage_daily (user_id, usage_date, voice_seconds)
    VALUES (v_uid, CURRENT_DATE, v_add)
    ON CONFLICT (user_id, usage_date)
    DO UPDATE SET voice_seconds = public.usage_daily.voice_seconds + EXCLUDED.voice_seconds;
  END IF;

  RETURN QUERY SELECT TRUE, (v_month_used + v_add), v_limit, v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_voice_seconds_quota(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_voice_seconds_quota(INTEGER) TO authenticated;

-- 7. Supporting Tables
CREATE TABLE IF NOT EXISTS public.voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  transcript_synced BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.proactive_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event_followup', 'conversation_thread', 'daily_checkin', 'manual_test')),
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  push_delivered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.deletion_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_hash TEXT NOT NULL,
  stripe_canceled BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.training_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_slug TEXT NOT NULL,
  prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  sanitized_context JSONB NOT NULL,
  chosen_reply TEXT,
  rejected_reply TEXT,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('love', 'laugh', 'up', 'down', 'high_engagement')),
  pii_verified_clean BOOLEAN NOT NULL DEFAULT FALSE,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version_id UUID REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  archetype_slug TEXT NOT NULL,
  total_cases INTEGER NOT NULL,
  passed_cases INTEGER NOT NULL,
  avg_human_score REAL NOT NULL,
  avg_memory_score REAL NOT NULL,
  safety_pass_rate REAL NOT NULL,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Strict Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proactive_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "companions_all_own" ON public.companions;
CREATE POLICY "companions_all_own" ON public.companions
  FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
CREATE POLICY "messages_select_own" ON public.messages
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.companions c
      WHERE c.id = companion_id AND c.user_id = (SELECT auth.uid())
    )
  );
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
CREATE POLICY "messages_delete_own" ON public.messages
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "memories_all_own" ON public.memories;
CREATE POLICY "memories_all_own" ON public.memories
  FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "usage_select_own" ON public.usage_daily;
CREATE POLICY "usage_select_own" ON public.usage_daily
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "voice_sessions_own" ON public.voice_sessions;
CREATE POLICY "voice_sessions_own" ON public.voice_sessions
  FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
  FOR ALL USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "proactive_logs_select_own" ON public.proactive_logs;
CREATE POLICY "proactive_logs_select_own" ON public.proactive_logs
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "prompt_versions_read_active" ON public.prompt_versions;
CREATE POLICY "prompt_versions_read_active" ON public.prompt_versions
  FOR SELECT USING (status IN ('active', 'canary'));
