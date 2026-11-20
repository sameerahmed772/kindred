#!/usr/bin/env bash
set -euo pipefail

echo "1/5 Running TypeScript typecheck..."
npm run typecheck

echo "2/5 Running ESLint..."
npm run lint

echo "3/5 Running unit tests (Safety, PII Redactor, Consent Cap)..."
npm run test:unit

echo "4/5 Running RLS security tests (requires TEST_USER_A/B in .env.local)..."
npm run test:security

echo "5/5 Running Next.js production build..."
npm run build

echo "ALL CHECKS PASSED."
