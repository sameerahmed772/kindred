import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforceCrudRateLimit } from "@/lib/ratelimit";
import { PLAN_LIMITS } from "@/lib/billing/stripe";
import { getArchetypeBySlug } from "@/lib/catalog/archetypes";
import type { PlanTier } from "@/lib/types";

const createCompanionSchema = z.object({
  archetypeSlug: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(60),
  gender: z.enum(["female", "male", "non-binary"]),
  age: z.number().int().min(18).max(99).default(24),
  avatarUrl: z.string().url().optional().nullable(),
  personalitySummary: z.string().trim().min(5).max(500),
  communicationStyle: z.string().trim().min(5).max(500),
  backstory: z.string().trim().min(5).max(1500),
  interests: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  voiceId: z.string().min(1).max(40).default("Aoede"),
  chatTheme: z.string().min(1).max(40).default("midnight"),
  isCustom: z.boolean().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("companions")
    .select("*")
    .order("last_interaction_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Failed to load companions" }, { status: 500 });
  return NextResponse.json({ companions: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await enforceCrudRateLimit(user.id);
  if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = createCompanionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid companion configuration", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [profileRes, countRes] = await Promise.all([
    supabase.from("profiles").select("plan_tier").eq("id", user.id).single(),
    supabase
      .from("companions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const planTier = (profileRes.data?.plan_tier ?? "free") as PlanTier;
  const limits = PLAN_LIMITS[planTier];

  if ((countRes.count ?? 0) >= limits.maxCompanions) {
    return NextResponse.json(
      {
        error: `Your ${limits.name} plan allows up to ${limits.maxCompanions} companions. Upgrade in Settings for more.`,
        code: "COMPANION_LIMIT_REACHED",
      },
      { status: 402 }
    );
  }

  const archetype = getArchetypeBySlug(parsed.data.archetypeSlug);
  if (archetype?.isPremium && !limits.allowsPremiumArchetypes) {
    return NextResponse.json(
      {
        error: `${archetype.name} is an exclusive Pro companion archetype.`,
        code: "PREMIUM_ARCHETYPE_REQUIRED",
      },
      { status: 402 }
    );
  }

  if (parsed.data.isCustom && !limits.allowsCustomCompanions) {
    return NextResponse.json(
      {
        error: "Custom companion creation is available on Plus and Pro plans.",
        code: "CUSTOM_COMPANION_REQUIRED",
      },
      { status: 402 }
    );
  }

  const d = parsed.data;
  const { data: companion, error } = await supabase
    .from("companions")
    .insert({
      user_id: user.id,
      archetype_slug: d.archetypeSlug,
      name: d.name,
      gender: d.gender,
      age: d.age,
      avatar_url: d.avatarUrl ?? null,
      personality_summary: d.personalitySummary,
      communication_style: d.communicationStyle,
      backstory: d.backstory,
      interests: d.interests,
      voice_id: d.voiceId,
      chat_theme: d.chatTheme,
    })
    .select("*")
    .single();

  if (error || !companion) {
    return NextResponse.json({ error: "Failed to create companion" }, { status: 500 });
  }

  const greeting =
    archetype?.sampleGreeting ??
    `Hey! I'm ${companion.name}. Really glad we matched—how's your day treating you so far?`;

  await supabase.from("messages").insert({
    user_id: user.id,
    companion_id: companion.id,
    role: "assistant",
    modality: "text",
    content: greeting,
  });

  return NextResponse.json({ companion }, { status: 201 });
}
