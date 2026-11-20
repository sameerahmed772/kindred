import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient, getGeminiModels } from "@/lib/ai/gemini";
import { buildCompanionSystemPrompt } from "@/lib/ai/prompt-builder";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

function isWithinQuietHours(timezone: string, startHHMM: string, endHHMM: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const [hStr, mStr] = formatter.format(new Date()).split(":");
    const nowMin = Number(hStr) * 60 + Number(mStr);
    const [sh, sm] = startHHMM.split(":").map(Number);
    const [eh, em] = endHHMM.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    return startMin <= endMin
      ? nowMin >= startMin && nowMin < endMin
      : nowMin >= startMin || nowMin < endMin;
  } catch {
    return false;
  }
}

const FREQUENCY_COOLDOWN_HOURS: Record<string, number> = {
  high: 6,
  balanced: 14,
  low: 36,
};

export const proactiveScheduler = inngest.createFunction(
  { id: "kindred-proactive-scheduler", retries: 2 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const supabase = createAdminClient();

    const eligible = await step.run("find-eligible-companions", async () => {
      const { data } = await supabase
        .from("companions")
        .select(
          `
          id, user_id, name, gender, age, personality_summary, communication_style,
          backstory, interests, relationship_stage, romantic_consent_enabled,
          style_profile, ignored_proactive_count, last_proactive_at, last_interaction_at,
          profiles!inner (
            display_name, timezone, proactive_enabled, proactive_frequency,
            quiet_hours_start, quiet_hours_end
          )
        `
        )
        .lt("ignored_proactive_count", 2)
        .limit(50);

      const now = Date.now();
      return (data ?? []).filter((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (!profile || !profile.proactive_enabled || profile.proactive_frequency === "off") {
          return false;
        }
        if (isWithinQuietHours(profile.timezone, profile.quiet_hours_start, profile.quiet_hours_end)) {
          return false;
        }
        const cooldownHrs = FREQUENCY_COOLDOWN_HOURS[profile.proactive_frequency] ?? 14;
        const lastProactive = row.last_proactive_at ? new Date(row.last_proactive_at).getTime() : 0;
        const lastChat = new Date(row.last_interaction_at).getTime();
        return (
          now - lastChat >= 4 * 60 * 60 * 1000 &&
          now - lastProactive >= cooldownHrs * 60 * 60 * 1000
        );
      });
    });

    let dispatched = 0;

    for (const comp of eligible) {
      const profile = Array.isArray(comp.profiles) ? comp.profiles[0] : comp.profiles;

      await step.run(`dispatch-proactive-${comp.id}`, async () => {
        const todayIso = new Date().toISOString().slice(0, 10);
        const yesterdayIso = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        const [memoriesRes, recentRes] = await Promise.all([
          supabase
            .from("memories")
            .select("category, fact, importance, event_date")
            .eq("user_id", comp.user_id)
            .eq("status", "active")
            .or(`companion_id.eq.${comp.id},companion_id.is.null`)
            .order("importance", { ascending: false })
            .limit(10),
          supabase
            .from("messages")
            .select("role, content")
            .eq("user_id", comp.user_id)
            .eq("companion_id", comp.id)
            .order("created_at", { ascending: false })
            .limit(6),
        ]);

        const memories = memoriesRes.data ?? [];
        const eventMemory = memories.find(
          (m) => m.event_date === todayIso || m.event_date === yesterdayIso
        );
        const triggerType = eventMemory
          ? "event_followup"
          : (recentRes.data?.length ?? 0) > 0
            ? "conversation_thread"
            : "daily_checkin";

        const systemInstruction = buildCompanionSystemPrompt({
          companion: comp,
          userDisplayName: profile.display_name,
          memories,
        });

        const prompt = eventMemory
          ? `Initiate a warm, natural check-in text asking about this saved event: "${eventMemory.fact}". Keep it 1–2 casual sentences.`
          : `Send a spontaneous, natural check-in text based on your recent conversation or personality. Keep it short (1–2 sentences), human, and not repetitive.`;

        const ai = getGeminiClient();
        const { fast } = getGeminiModels();
        const gen = await ai.models.generateContent({
          model: fast,
          contents: [
            ...(recentRes.data ?? []).reverse().map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            { role: "user", parts: [{ text: `[PROACTIVE TRIGGER]: ${prompt}` }] },
          ],
          config: { systemInstruction, temperature: 0.9, maxOutputTokens: 160 },
        });

        const text = (gen.text ?? "").trim();
        if (!text) return;

        const { data: savedMsg } = await supabase
          .from("messages")
          .insert({
            user_id: comp.user_id,
            companion_id: comp.id,
            role: "assistant",
            modality: "text",
            content: text,
            is_proactive: true,
          })
          .select("id")
          .single();

        await supabase
          .from("companions")
          .update({
            last_proactive_at: new Date().toISOString(),
            ignored_proactive_count: (comp.ignored_proactive_count ?? 0) + 1,
          })
          .eq("id", comp.id);

        const pushDelivered = await sendWebPushToUser({
          supabase,
          userId: comp.user_id,
          title: `${comp.name} (AI Companion)`,
          body: text,
          url: `/?companion=${comp.id}`,
        });

        await supabase.from("proactive_logs").insert({
          user_id: comp.user_id,
          companion_id: comp.id,
          trigger_type: triggerType,
          message_id: savedMsg?.id ?? null,
          push_delivered: pushDelivered,
        });

        dispatched += 1;
      });
    }

    return { checked: eligible.length, dispatched };
  }
);
