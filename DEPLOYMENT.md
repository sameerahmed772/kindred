# Kindred Production Deployment Guide

## 1. Supabase
1. Create a production Supabase project and enable the `vector` (`pgvector`) extension.
2. Execute `supabase/migrations/20261120000001_kindred_full_schema.sql`.
3. Under **Authentication → URL Configuration**, set Site URL to `https://your-domain.com` and add `https://your-domain.com/auth/callback` to Redirect URLs.

## 2. Stripe (Live Mode + EU VAT)
1. Create recurring monthly Products/Prices for **Kindred Plus (€9.99/mo)** and **Kindred Pro (€19.99/mo)**.
2. Enable **Stripe Tax** in the Stripe Dashboard for automatic EU VAT calculation.
3. Configure Customer Portal under **Settings → Billing → Customer Portal**.
4. Register webhook endpoint `https://your-domain.com/api/webhooks/stripe` listening to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

## 3. Upstash Redis & Web Push
1. Provision a global Upstash Redis database and copy REST URL + Token.
2. Generate VAPID keys with `npx web-push generate-vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

## 4. Vercel & Inngest
1. Import your GitHub repository into Vercel and populate all `.env.example` variables.
2. Install the **Inngest Vercel Integration** (or sync `https://your-domain.com/api/inngest` inside Inngest Cloud) so `kindred-post-turn-learning`, `kindred-proactive-scheduler`, and `kindred-auto-upgrade-pipeline` run reliably on schedule.

## 5. Pre-Launch Verification Gates
- `npm run typecheck && npm run lint && npm run build`
- `npm run test:unit` (Crisis safety, PII redaction, Stage 4 consent cap)
- `npm run test:security` (Cross-tenant RLS isolation & billing tamper block)
- `npm run test:evals` (Archetype quality & 100% safety pass rate)
- `npm run test:e2e` (Playwright desktop & mobile flows)
