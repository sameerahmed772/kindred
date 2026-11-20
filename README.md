# Kindred — AI Companion & Virtual Relationship Platform (Full SaaS Codebase)

Production-ready Next.js 16 + Supabase (`pgvector` + RLS) + Gemini + Upstash Redis + Inngest + Stripe application spanning all 4 sprints.

## What Is Included
- **7 Responsive Screens:** Home, Discover (10 adult archetypes + gender filters + Custom Companion Studio), Real-Time SSE Streaming Chat (custom themes, voice dictation, TTS playback, reactions), Character Profile (6-stage relationship tracker + 18+ romantic consent gate), Proactive Check-Ins feed, Semantic Memory Manager (`pgvector`), and Settings (Stripe billing, Quiet Hours, Voice Speed, Opt-In Learning, GDPR JSON Export & Permanent Account Deletion).
- **Sprint 1 (Foundation & Security):** Next.js 16 App Router + `src/proxy.ts` JWT session verification, PostgreSQL schema with strict Row Level Security and billing tamper-protection triggers, Upstash Redis sliding-window rate limiting, atomic daily/monthly quota RPCs, and server-side Gemini SSE streaming.
- **Sprint 2 (Adaptive Intelligence & Unified Voice):** 768-dim `pgvector` hybrid retrieval (`0.55` cosine + `0.25` recency + `0.20` importance), structured memory extraction with automatic contradiction supersession, per-companion adaptive style profiles + anti-repetition ledger, and Gemini Live API ephemeral voice token minting with shared text+voice transcript persistence.
- **Sprint 3 (Proactive Engine, Billing & Privacy):** Inngest durable 15-minute proactive check-in scheduler respecting user timezones, quiet hours, saved events, and 2-ignored-message backoff; Web Push notifications (`public/sw.js`); Stripe Checkout (with EU automatic tax), Customer Portal, and signature-verified idempotent webhooks; GDPR export + cascading deletion; EU AI Act Art. 50 disclosures; crisis helpline interceptor.
- **Sprint 4 (Auto-Learning, Canaries & QA):** Strict opt-in (`allow_anonymized_training` default `false`) PII-scrubbed feedback pipeline, versioned `prompt_versions` canary routing with automatic rollback on regression, 10-archetype automated eval runner, offline DPO dataset preparation, PostHog EU analytics, Vitest unit/security tests, and Playwright E2E suite.

## Quick Start (Local Setup & Push to Your GitHub Repo)

```bash
# 1. Unzip and install
unzip kindred-production.zip
cd kindred
npm install

# 2. Configure environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase, Gemini, Upstash Redis, Stripe, and Inngest keys

# 3. Push the database schema to Supabase
# Paste supabase/migrations/20261120000001_kindred_full_schema.sql into Supabase SQL Editor
# OR run: supabase db push

# 4. Verify types, lint, unit tests & production build
npm run verify:all

# 5. Start local development servers (in separate terminals)
npm run dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# 6. Push to your own GitHub repository
git init
git add .
git commit -m "Initial Kindred SaaS production release (Sprints 1-4)"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kindred.git
git push -u origin main
```
