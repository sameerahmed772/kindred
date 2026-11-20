import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { postTurnLearning } from "@/inngest/functions/post-turn-learning";
import { proactiveScheduler } from "@/inngest/functions/proactive-scheduler";
import { autoUpgradePipeline } from "@/inngest/functions/auto-upgrade-pipeline";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [postTurnLearning, proactiveScheduler, autoUpgradePipeline],
});
