import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractAndReconcileMemories,
  updateAdaptiveStyleProfile,
} from "@/lib/ai/memory-engine";
import { redactPII } from "@/lib/ai/pii-redactor";

export const postTurnLearning = inngest.createFunction(
  { id: "kindred-post-turn-learning", retries: 2 },
  { event: "kindred/turn.completed" },
  async ({ event, step }) => {
    const { userId, companionId, userMessage, assistantMessage, promptVersionId } =
      event.data as {
        userId: string;
        companionId: string;
        userMessage: string;
        assistantMessage: string;
        promptVersionId?: string | null;
      };

    const supabase = createAdminClient();

    const memoryResult = await step.run("extract-and-reconcile-memories", async () => {
      const { data: recent } = await supabase
        .from("messages")
        .select("role, content")
        .eq("user_id", userId)
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(6);

      return extractAndReconcileMemories({
        supabase,
        userId,
        companionId,
        recentTurns: (recent ?? []).reverse(),
      });
    });

    await step.run("update-adaptive-style-profile", async () => {
      const { data: comp } = await supabase
        .from("companions")
        .select("style_profile")
        .eq("id", companionId)
        .eq("user_id", userId)
        .single();

      if (!comp) return null;
      return updateAdaptiveStyleProfile({
        supabase,
        userId,
        companionId,
        currentStyle: comp.style_profile,
        userMessage,
        assistantMessage,
      });
    });

    await step.run("record-optin-sanitized-telemetry", async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, allow_anonymized_training")
        .eq("id", userId)
        .single();

      if (!profile?.allow_anonymized_training) return { skipped: "user_opted_out" };

      const { data: comp } = await supabase
        .from("companions")
        .select("archetype_slug, name")
        .eq("id", companionId)
        .single();

      if (!comp) return { skipped: "no_companion" };

      const knownNames = [profile.display_name, comp.name].filter(Boolean);
      const userRedacted = redactPII(userMessage, knownNames);
      const aiRedacted = redactPII(assistantMessage, knownNames);

      if (!userRedacted.verifiedClean || !aiRedacted.verifiedClean) {
        return { skipped: "pii_verification_failed" };
      }

      if (userMessage.trim().length >= 30) {
        await supabase.from("training_candidates").insert({
          archetype_slug: comp.archetype_slug,
          prompt_version_id: promptVersionId ?? null,
          sanitized_context: { user_prompt: userRedacted.sanitized },
          chosen_reply: aiRedacted.sanitized,
          signal_type: "high_engagement",
          pii_verified_clean: true,
        });
      }

      return { recorded: true };
    });

    return { memoryResult };
  }
);
