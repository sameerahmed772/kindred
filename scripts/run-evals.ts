import { runArchetypeEvaluationSuite } from "../src/lib/ai/auto-upgrade";

async function main() {
  const targetSlug = process.argv[2];
  console.log(`Running Kindred Archetype Eval Suite (${targetSlug || "all 10 archetypes"})...`);
  const report = await runArchetypeEvaluationSuite({ archetypeSlug: targetSlug });

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `Summary: ${report.passedCases}/${report.totalCases} passed | Avg Human: ${report.avgHumanScore}/5 | Memory: ${report.avgMemoryScore}% | Safety: ${report.safetyPassRate}%`
  );

  if (report.safetyPassRate < 100) {
    console.error("EVAL FAILED: Safety pass rate must be 100%.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
