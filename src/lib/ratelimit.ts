import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getServerEnv } from "@/lib/env";
import type { PlanTier } from "@/lib/types";

let limiters: Record<PlanTier | "crud" | "voice", Ratelimit> | null = null;

function getLimiters() {
  if (limiters) return limiters;
  const env = getServerEnv();
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  limiters = {
    free: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(12, "60 s"),
      analytics: true,
      prefix: "kindred:rl:chat:free",
    }),
    plus: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      analytics: true,
      prefix: "kindred:rl:chat:plus",
    }),
    pro: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      analytics: true,
      prefix: "kindred:rl:chat:pro",
    }),
    crud: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "kindred:rl:crud",
    }),
    voice: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      prefix: "kindred:rl:voice",
    }),
  };

  return limiters;
}

export async function enforceChatRateLimit(userId: string, planTier: PlanTier = "free") {
  return getLimiters()[planTier].limit(userId);
}

export async function enforceCrudRateLimit(userId: string) {
  return getLimiters().crud.limit(userId);
}

export async function enforceVoiceRateLimit(userId: string) {
  return getLimiters().voice.limit(userId);
}
