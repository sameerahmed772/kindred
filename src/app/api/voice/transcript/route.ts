import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

const transcriptSchema = z.object({
  sessionId: z.string().uuid().optional(),
  companionId: z.string().uuid(),
  durationSeconds: z.number().int().min(1).max(3600),
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      })
    )
    .max(200),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = transcriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid voice transcript payload" }, { status: 400 });
  }

  const { sessionId, companionId, durationSeconds, turns } = parsed.data;

  const { data: companion } = await supabase
    .from("companions")
    .select("id")
    .eq("id", companionId)
    .eq("user_id", user.id)
    .single();

  if (!companion) return NextResponse.json({ error: "Companion not found" }, { status: 404 });

  await supabase.rpc("consume_voice_seconds_quota", { p_seconds: durationSeconds });

  if (turns.length > 0) {
    await supabase.from("messages").insert(
      turns.map((t) => ({
        user_id: user.id,
        companion_id: companionId,
        role: t.role,
        modality: "live_call",
        content: t.content,
      }))
    );

    const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
    const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant")?.content ?? "";

    if (lastUser && lastAssistant) {
      void inngest
        .send({
          name: "kindred/turn.completed",
          data: {
            userId: user.id,
            companionId,
            userMessage: lastUser,
            assistantMessage: lastAssistant,
          },
        })
        .catch((err) => console.error("Voice memory extraction dispatch failed:", err));
    }
  }

  if (sessionId) {
    await supabase
      .from("voice_sessions")
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        transcript_synced: true,
      })
      .eq("id", sessionId)
      .eq("user_id", user.id);
  }

  return NextResponse.json({ synced: true, turnsSaved: turns.length });
}
