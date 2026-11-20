import "server-only";
import Stripe from "stripe";
import { getServerEnv } from "@/lib/env";
import type { PlanTier } from "@/lib/types";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;
  const env = getServerEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export const PLAN_LIMITS: Record<
  PlanTier,
  {
    name: string;
    priceMonthlyEur: number;
    maxCompanions: number;
    dailyMessages: number;
    monthlyVoiceSeconds: number;
    maxMemories: number;
    allowsCustomCompanions: boolean;
    allowsPremiumArchetypes: boolean;
  }
> = {
  free: {
    name: "Free",
    priceMonthlyEur: 0,
    maxCompanions: 2,
    dailyMessages: 40,
    monthlyVoiceSeconds: 60,
    maxMemories: 25,
    allowsCustomCompanions: false,
    allowsPremiumArchetypes: false,
  },
  plus: {
    name: "Plus",
    priceMonthlyEur: 9.99,
    maxCompanions: 5,
    dailyMessages: 500,
    monthlyVoiceSeconds: 1800,
    maxMemories: 500,
    allowsCustomCompanions: true,
    allowsPremiumArchetypes: false,
  },
  pro: {
    name: "Pro",
    priceMonthlyEur: 19.99,
    maxCompanions: 50,
    dailyMessages: 5000,
    monthlyVoiceSeconds: 10800,
    maxMemories: 10000,
    allowsCustomCompanions: true,
    allowsPremiumArchetypes: true,
  },
};

export function mapPriceIdToPlan(priceId: string | null | undefined): PlanTier {
  const env = getServerEnv();
  if (!priceId) return "free";
  if (env.STRIPE_PRICE_PRO && priceId === env.STRIPE_PRICE_PRO) return "pro";
  if (env.STRIPE_PRICE_PLUS && priceId === env.STRIPE_PRICE_PLUS) return "plus";
  return "free";
}
