import { NextResponse } from "next/server";
import { z } from "zod";
import { Modality } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { enforceVoiceRateLimit } from "@/lib/ratelimit";
import { getGeminiLiveClient, getGeminiModels } from "@/lib/ai/gemini";
import { buildCompanionSystemPrompt } from "@/lib/ai/prompt-builder";
import { retrieveHybridMemories } from "@/lib/ai/memory-engine";

const voiceSessionSchema = z.object({
  companionId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await enforceVoiceRateLimit(user.id);
  if (!rl.success) return NextResponse.json({ error: "Voice rate limit exceeded" }, { status: 429 });

  const body = await request.json().catch(() => null);
  const parsed = voiceSessionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid companionId" }, { status: 400 });

  const { data: quotaRows, error: quotaErr } = await supabase.rpc(
    "consume_voice_seconds_quota",
    { p_seconds: 0 }
  );
  if (quotaErr || !quotaRows?.[0]) {
    return NextResponse.json({ error: "Failed to verify voice quota" }, { status: 500 });
  }
  const quota = quotaRows[0];
  if (!quota.allowed || quota.used_month >= quota.monthly_limit) {
    return NextResponse.json(
      {
        error: "Monthly Live Voice allowance reached. Upgrade your plan in Settings for more call time.",
        code: "VOICE_QUOTA_EXCEEDED",
      },
      { status: 402 }
    );
  }

  const [profileRes, companionRes, historyRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, is_age_verified, voice_speed")
      .eq("id", user.id)
      .single(),
    supabase
      .from("companions")
      .select("*")
      .eq("id", parsed.data.companionId)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("messages")
      .select("role, content")
      .eq("companion_id", parsed.data.companionId)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  if (companionRes.error || !companionRes.data) {
    return NextResponse.json({ error: "Companion not found" }, { status: 404 });
  }

  const companion = companionRes.data;
  const recentSnippet = (historyRes.data ?? [])
    .reverse()
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const memories = await retrieveHybridMemories({
    supabase,
    userId: user.id,
    companionId: companion.id,
    queryText: recentSnippet || companion.personality_summary,
    limit: 8,
  });

  const systemInstruction = [
    buildCompanionSystemPrompt({
      companion: {
        ...companion,
        romantic_consent_enabled:
          Boolean(profileRes.data?.is_age_verified) && companion.romantic_consent_enabled,
      },
      userDisplayName: profileRes.data?.display_name ?? "Friend",
      memories,
      modality: "live_call",
    }),
    recentSnippet ? `Recent Text Chat Context:\n${recentSnippet}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const liveAi = getGeminiLiveClient();
  const { live: liveModel } = getGeminiModels();

  try {
    const expireTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const token = await liveAi.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: liveModel,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: companion.voice_id || "Aoede" },
              },
            },
          },
        },
      },
    });

    const { data: sessionRow } = await supabase
      .from("voice_sessions")
      .insert({
        user_id: user.id,
        companion_id: companion.id,
        model_id: liveModel,
      })
      .select("id")
      .single();

    return NextResponse.json({
      sessionId: sessionRow?.id,
      ephemeralToken: token.name,
      model: liveModel,
      voiceId: companion.voice_id,
      voiceSpeed: profileRes.data?.voice_speed ?? 1.0,
      remainingSeconds: Math.max(0, quota.monthly_limit - quota.used_month),
    });
  } catch (err) {
    console.error("Failed to mint Gemini Live ephemeral token:", err);
    return NextResponse.json(
      {
        error: "Live voice token minting failed. Check GEMINI_API_KEY and GEMINI_LIVE_MODEL in .env.local.",
      },
      { status: 502 }
    );
  }
}
