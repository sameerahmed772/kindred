import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient, getGeminiModels } from "@/lib/ai/gemini";
import { buildCompanionSystemPrompt } from "@/lib/ai/prompt-builder";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

const triggerSchema = z.object({ companionId: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid companionId" }, { status: 400 });

  const [profileRes, compRes, memoriesRes, recentRes] = await Promise.all([
    supabase.from("profiles").select("display_name, proactive_enabled").eq("id", user.id).single(),
    supabase
      .from("companions")
      .select("*")
      .eq("id", parsed.data.companionId)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("memories")
      .select("category, fact, importance, event_date")
      .eq("status", "active")
      .or(`companion_id.eq.${parsed.data.companionId},companion_id.is.null`)
      .limit(10),
    supabase
      .from("messages")
      .select("role, content")
      .eq("companion_id", parsed.data.companionId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  if (compRes.error || !compRes.data) {
    return NextResponse.json({ error: "Companion not found" }, { status: 404 });
  }
  if (!profileRes.data?.proactive_enabled) {
    return NextResponse.json(
      { error: "Proactive check-ins are currently disabled in Settings." },
      { status: 400 }
    );
  }

  const companion = compRes.data;
  const systemInstruction = buildCompanionSystemPrompt({
    companion,
    userDisplayName: profileRes.data?.display_name ?? "Friend",
    memories: memoriesRes.data ?? [],
  });

  const ai = getGeminiClient();
  const { fast } = getGeminiModels();
  const gen = await ai.models.generateContent({
    model: fast,
    contents: [
      ...(recentRes.data ?? []).reverse().map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      {
        role: "user",
        parts: [
          {
            text: "[PROACTIVE CHECK-IN]: Initiate a warm, spontaneous 1–2 sentence text referencing a saved memory or recent thread.",
          },
        ],
      },
    ],
    config: { systemInstruction, temperature: 0.9, maxOutputTokens: 160 },
  });

  const text = (gen.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Could not generate check-in" }, { status: 500 });

  const { data: msg } = await supabase
    .from("messages")
    .insert({
      user_id: user.id,
      companion_id: companion.id,
      role: "assistant",
      modality: "text",
      content: text,
      is_proactive: true,
    })
    .select("*")
    .single();

  const pushDelivered = await sendWebPushToUser({
    supabase,
    userId: user.id,
    title: `${companion.name} (AI Companion)`,
    body: text,
    url: `/?companion=${companion.id}`,
  });

  return NextResponse.json({ message: msg, pushDelivered });
}
