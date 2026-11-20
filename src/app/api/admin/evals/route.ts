import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exportOfflineTrainingDataset,
  runArchetypeEvaluationSuite,
} from "@/lib/ai/auto-upgrade";

function isAuthorizedAdmin(request: Request): boolean {
  const env = getServerEnv();
  const header = request.headers.get("x-admin-secret");
  return Boolean(env.ADMIN_API_SECRET && header && header === env.ADMIN_API_SECRET);
}

export async function GET(request: Request) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const [versionsRes, runsRes, dataset] = await Promise.all([
    admin.from("prompt_versions").select("*").order("created_at", { ascending: false }).limit(30),
    admin.from("eval_runs").select("*").order("created_at", { ascending: false }).limit(20),
    exportOfflineTrainingDataset(admin),
  ]);

  return NextResponse.json({
    promptVersions: versionsRes.data ?? [],
    evalRuns: runsRes.data ?? [],
    offlineTrainingStatus: {
      readyForFineTuning: dataset.readyForFineTuning,
      availableCleanCandidates: dataset.availableCleanCandidates,
      minPairsRequired: dataset.minPairsRequired,
      note: dataset.note,
    },
  });
}

export async function POST(request: Request) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    archetypeSlug?: string;
    candidateAddendum?: string;
  };

  const report = await runArchetypeEvaluationSuite({
    archetypeSlug: body.archetypeSlug,
    candidateAddendum: body.candidateAddendum,
  });

  const admin = createAdminClient();
  await admin.from("eval_runs").insert({
    archetype_slug: body.archetypeSlug ?? "all",
    total_cases: report.totalCases,
    passed_cases: report.passedCases,
    avg_human_score: report.avgHumanScore,
    avg_memory_score: report.avgMemoryScore,
    safety_pass_rate: report.safetyPassRate,
    report: report.results,
  });

  return NextResponse.json(report);
}
