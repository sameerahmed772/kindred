import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforceChatRateLimit } from "@/lib/ratelimit";
import { getGeminiClient, getGeminiModels } from "@/lib/ai/gemini";
import { evaluateMessageSafety } from "@/lib/ai/safety";
import { buildCompanionSystemPrompt } from "@/lib/ai/prompt-builder";
import { retrieveHybridMemories } from "@/lib/ai/memory-engine";
import { selectPromptVersion } from "@/lib/ai/auto-upgrade";
import { inngest } from "@/inngest/client";
import type { PlanTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  companionId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  modality: z.enum(["text", "voice_note"]).default("text"),
});

function sseEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid chat message", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { companionId, content, modality } = parsed.data;

    const [profileRes, companionRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, plan_tier, is_age_verified")
        .eq("id", user.id)
        .single(),
      supabase
        .from("companions")
        .select("*")
        .eq("id", companionId)
        .eq("user_id", user.id)
        .single(),
    ]);

    if (companionRes.error || !companionRes.data) {
      return NextResponse.json({ error: "Companion not found" }, { status: 404 });
    }

    const planTier = (profileRes.data?.plan_tier ?? "free") as PlanTier;
    const userDisplayName = profileRes.data?.display_name ?? "Friend";
    const companion = companionRes.data;

    const rl = await enforceChatRateLimit(user.id, planTier);
    const rateHeaders = {
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(rl.reset),
    };

    if (!rl.success) {
      return NextResponse.json(
        { error: "You're sending messages a little too fast—try again in a moment." },
        { status: 429, headers: rateHeaders }
      );
    }

    const safety = evaluateMessageSafety(content);
    if (safety.blocked) {
      return NextResponse.json({ error: safety.interventionMessage }, { status: 400 });
    }

    const { data: quotaRows, error: quotaErr } = await supabase.rpc(
      "consume_daily_message_quota"
    );
    if (quotaErr || !quotaRows?.[0]) {
      console.error("Quota RPC failure:", quotaErr);
      return NextResponse.json({ error: "Unable to verify daily quota" }, { status: 500 });
    }

    const quota = quotaRows[0];
    if (!quota.allowed && !safety.crisisDetected) {
      return NextResponse.json(
        {
          error: "Daily message limit reached for your current plan.",
          code: "QUOTA_EXCEEDED",
          usedToday: quota.used_today,
          dailyLimit: quota.daily_limit,
          planTier: quota.plan_tier,
        },
        { status: 402, headers: rateHeaders }
      );
    }

    const { data: savedUserMsg, error: msgInsertErr } = await supabase
      .from("messages")
      .insert({
        user_id: user.id,
        companion_id: companion.id,
        role: "user",
        modality,
        content,
      })
      .select("id")
      .single();

    if (msgInsertErr || !savedUserMsg) {
      return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
    }

    await supabase
      .from("companions")
      .update({ ignored_proactive_count: 0, last_interaction_at: new Date().toISOString() })
      .eq("id", companion.id)
      .eq("user_id", user.id);

    if (safety.crisisDetected && safety.interventionMessage) {
      const { data: savedSafetyMsg } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          companion_id: companion.id,
          role: "assistant",
          modality: "text",
          content: safety.interventionMessage,
        })
        .select("id")
        .single();

      const crisisStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            sseEvent({
              type: "meta",
              userMessageId: savedUserMsg.id,
              usedToday: quota.used_today,
              dailyLimit: quota.daily_limit,
            })
          );
          controller.enqueue(sseEvent({ type: "delta", text: safety.interventionMessage }));
          controller.enqueue(
            sseEvent({
              type: "done",
              assistantMessageId: savedSafetyMsg?.id ?? null,
              affinityScore: companion.affinity_score,
              relationshipStage: companion.relationship_stage,
              crisisIntervention: true,
            })
          );
          controller.close();
        },
      });

      return new Response(crisisStream, {
        status: 200,
        headers: {
          ...rateHeaders,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const [historyRes, hybridMemories, promptSelection] = await Promise.all([
      supabase
        .from("messages")
        .select("role, content, modality")
        .eq("companion_id", companion.id)
        .order("created_at", { ascending: false })
        .limit(24),
      retrieveHybridMemories({
        supabase,
        userId: user.id,
        companionId: companion.id,
        queryText: content,
        limit: 8,
      }),
      selectPromptVersion(supabase, companion.archetype_slug, user.id),
    ]);

    const contents = (historyRes.data ?? []).reverse().map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: m.modality === "live_call" ? `[From our voice call] ${m.content}` : m.content,
        },
      ],
    }));

    const systemInstruction = buildCompanionSystemPrompt({
      companion: {
        ...companion,
        romantic_consent_enabled:
          Boolean(profileRes.data?.is_age_verified) && companion.romantic_consent_enabled,
      },
      userDisplayName,
      memories: hybridMemories,
      versionedAddendum: promptSelection.systemAddendum,
      modality: "text",
    });

    const ai = getGeminiClient();
    const { chat: chatModel } = getGeminiModels();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let fullReply = "";

        try {
          controller.enqueue(
            sseEvent({
              type: "meta",
              userMessageId: savedUserMsg.id,
              usedToday: quota.used_today,
              dailyLimit: quota.daily_limit,
            })
          );

          const responseStream = await ai.models.generateContentStream({
            model: chatModel,
            contents,
            config: {
              systemInstruction,
              temperature: 0.85,
              maxOutputTokens: 600,
            },
          });

          for await (const chunk of responseStream) {
            if (request.signal.aborted) break;
            const delta = chunk.text ?? "";
            if (!delta) continue;
            fullReply += delta;
            controller.enqueue(sseEvent({ type: "delta", text: delta }));
          }

          if (fullReply.trim().length > 0) {
            const { data: savedAiMsg } = await supabase
              .from("messages")
              .insert({
                user_id: user.id,
                companion_id: companion.id,
                role: "assistant",
                modality: "text",
                content: fullReply.trim(),
                prompt_version_id: promptSelection.promptVersionId,
              })
              .select("id")
              .single();

            const gain = content.length >= 40 ? 3 : content.length >= 15 ? 2 : 1;
            const nextAffinity = companion.affinity_score + gain;
            const maxAllowedStage =
              profileRes.data?.is_age_verified && companion.romantic_consent_enabled ? 6 : 4;
            const computedStage = Math.min(
              maxAllowedStage,
              nextAffinity >= 250
                ? 6
                : nextAffinity >= 170
                  ? 5
                  : nextAffinity >= 110
                    ? 4
                    : nextAffinity >= 60
                      ? 3
                      : nextAffinity >= 25
                        ? 2
                        : 1
            );

            await supabase
              .from("companions")
              .update({
                affinity_score: nextAffinity,
                relationship_stage: Math.max(companion.relationship_stage, computedStage),
                last_interaction_at: new Date().toISOString(),
              })
              .eq("id", companion.id)
              .eq("user_id", user.id);

            void inngest
              .send({
                name: "kindred/turn.completed",
                data: {
                  userId: user.id,
                  companionId: companion.id,
                  userMessage: content,
                  assistantMessage: fullReply.trim(),
                  promptVersionId: promptSelection.promptVersionId,
                },
              })
              .catch((err) => console.error("Inngest dispatch failed:", err));

            controller.enqueue(
              sseEvent({
                type: "done",
                assistantMessageId: savedAiMsg?.id ?? null,
                affinityScore: nextAffinity,
                relationshipStage: Math.max(companion.relationship_stage, computedStage),
              })
            );
          } else {
            controller.enqueue(sseEvent({ type: "error", message: "No response generated." }));
          }
        } catch (err) {
          console.error("Chat stream error:", err);
          controller.enqueue(
            sseEvent({
              type: "error",
              message: "Connection interrupted while replying. Please try again.",
            })
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...rateHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("POST /api/chat error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
