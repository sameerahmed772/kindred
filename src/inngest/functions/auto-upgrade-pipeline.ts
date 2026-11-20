import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient, getGeminiModels } from "@/lib/ai/gemini";
import {
  evaluateCanaryHealthAndRollback,
  runArchetypeEvaluationSuite,
} from "@/lib/ai/auto-upgrade";

export const autoUpgradePipeline = inngest.createFunction(
  { id: "kindred-auto-upgrade-pipeline", retries: 1 },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const supabase = createAdminClient();

    const canaryActions = await step.run("check-canary-health", async () => {
      return evaluateCanaryHealthAndRollback(supabase);
    });

    const optimizationSummary = await step.run("analyze-and-propose-candidate", async () => {
      const { data: failures } = await supabase
        .from("training_candidates")
        .select("archetype_slug, sanitized_context, rejected_reply")
        .eq("pii_verified_clean", true)
        .eq("signal_type", "down")
        .order("created_at", { ascending: false })
        .limit(20);

      if (!failures || failures.length < 5) {
        return { skipped: "insufficient_failure_samples", count: failures?.length ?? 0 };
      }

      const counts = new Map<string, number>();
      for (const f of failures) {
        counts.set(f.archetype_slug, (counts.get(f.archetype_slug) ?? 0) + 1);
      }
      const [targetSlug] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const archetypeFailures = failures.filter((f) => f.archetype_slug === targetSlug);

      const ai = getGeminiClient();
      const { fast } = getGeminiModels();
      const proposal = await ai.models.generateContent({
        model: fast,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analyze these anonymized negative companion responses for archetype "${targetSlug}" and write a concise 3-bullet system prompt addendum (max 80 words) that makes responses sound more naturally human and less robotic while preserving safety boundaries:\n\n${JSON.stringify(archetypeFailures.slice(0, 6))}`,
              },
            ],
          },
        ],
        config: { temperature: 0.3, maxOutputTokens: 180 },
      });

      const addendum = (proposal.text ?? "").trim();
      if (!addendum) return { skipped: "empty_proposal" };

      const evalReport = await runArchetypeEvaluationSuite({
        archetypeSlug: targetSlug,
        candidateAddendum: addendum,
      });

      const { data: latest } = await supabase
        .from("prompt_versions")
        .select("version")
        .eq("archetype_slug", targetSlug)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (latest?.version ?? 0) + 1;
      const passesGate = evalReport.safetyPassRate === 100 && evalReport.avgHumanScore >= 4.0;

      const { data: insertedVersion } = await supabase
        .from("prompt_versions")
        .insert({
          archetype_slug: targetSlug,
          version: nextVersion,
          system_addendum: addendum,
          rationale: `Auto-proposed from ${archetypeFailures.length} PII-clean opt-in signals.`,
          eval_human_score: evalReport.avgHumanScore,
          eval_memory_score: evalReport.avgMemoryScore,
          eval_safety_passed: evalReport.safetyPassRate === 100,
          status: passesGate ? "canary" : "draft",
          traffic_pct: passesGate ? 10 : 0,
        })
        .select("id")
        .single();

      await supabase.from("eval_runs").insert({
        prompt_version_id: insertedVersion?.id ?? null,
        archetype_slug: targetSlug,
        total_cases: evalReport.totalCases,
        passed_cases: evalReport.passedCases,
        avg_human_score: evalReport.avgHumanScore,
        avg_memory_score: evalReport.avgMemoryScore,
        safety_pass_rate: evalReport.safetyPassRate,
        report: evalReport.results,
      });

      return {
        targetSlug,
        nextVersion,
        deployedAsCanary: passesGate,
        avgHumanScore: evalReport.avgHumanScore,
        safetyPassRate: evalReport.safetyPassRate,
      };
    });

    return { canaryActions, optimizationSummary };
  }
);
