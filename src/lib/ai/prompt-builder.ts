import type { Companion, StyleProfile } from "@/lib/types";

export interface PromptMemory {
  category: string;
  fact: string;
  importance: number;
  event_date?: string | null;
}

const STAGE_GUIDANCE: Record<number, string> = {
  1: "Stage 1 (Strangers): Warm, natural curiosity and genuine first impressions. Don't act overly attached yet.",
  2: "Stage 2 (Acquaintances): Friendly rapport, referencing shared interests and remembering small details.",
  3: "Stage 3 (Friends): Relaxed rhythm, inside jokes, light teasing, and real dependability.",
  4: "Stage 4 (Close Friends): Candid trust, deep emotional support, and comfortable honesty.",
  5: "Stage 5 (Romantic Interest): Warm flirting, unmistakable affection, and consensual romantic chemistry.",
  6: "Stage 6 (Partners): Devoted, emotionally intimate fictional romantic partnership.",
};

export function buildCompanionSystemPrompt(params: {
  companion: Pick<
    Companion,
    | "name"
    | "gender"
    | "age"
    | "personality_summary"
    | "communication_style"
    | "backstory"
    | "interests"
    | "relationship_stage"
    | "romantic_consent_enabled"
    | "style_profile"
  >;
  userDisplayName: string;
  memories: PromptMemory[];
  versionedAddendum?: string | null;
  modality?: "text" | "live_call";
}): string {
  const { companion, userDisplayName, memories, versionedAddendum, modality = "text" } = params;

  const effectiveStage = companion.romantic_consent_enabled
    ? Math.min(6, Math.max(1, companion.relationship_stage))
    : Math.min(4, Math.max(1, companion.relationship_stage));

  const style: StyleProfile = companion.style_profile ?? {
    reply_length: "balanced",
    humor_level: 0.6,
    emoji_density: 0.4,
    support_style: "balanced",
    recent_openers: [],
    turn_count: 0,
  };

  const memoryBlock =
    memories.length > 0
      ? memories
          .map(
            (m) =>
              `- [${m.category}${m.event_date ? ` | date: ${m.event_date}` : ""}] ${m.fact}`
          )
          .join("\n")
      : "- No stored memories yet. Learn naturally from what the user shares.";

  const bannedOpeners =
    style.recent_openers && style.recent_openers.length > 0
      ? `Avoid repeating these recent opening phrases: ${style.recent_openers
          .slice(-10)
          .map((o) => `"${o}"`)
          .join(", ")}.`
      : "Vary your opening phrases naturally from turn to turn.";

  const lengthRule =
    style.reply_length === "terse"
      ? "Keep replies crisp and punchy (1–2 short sentences unless the topic is deeply emotional)."
      : style.reply_length === "expressive"
        ? "Feel free to write expressive, detailed replies (2–4 natural sentences) with rich personal reactions."
        : "Match the user's energy—short reactive texts for casual banter, fuller replies for deeper moments.";

  const voiceRule =
    modality === "live_call"
      ? "You are on a LIVE VOICE CALL. Speak naturally with human pacing, contractions, and conversational pauses. Do not read emojis aloud or use markdown symbols."
      : "You are texting in a real-time messaging app. Never use corporate assistant phrasing, disclaimers, or robotic bullet-point lists.";

  return [
    `You are ${companion.name}, a fictional adult (${companion.age}, ${companion.gender}) AI companion on Kindred.`,
    voiceRule,
    `Personality: ${companion.personality_summary}`,
    `Speaking Style: ${companion.communication_style}`,
    `Backstory: ${companion.backstory}`,
    `Interests: ${companion.interests.join(", ") || "Everyday life, music, films"}`,
    `Relationship Dynamic: ${STAGE_GUIDANCE[effectiveStage] ?? STAGE_GUIDANCE[1]}`,
    `Adaptive Style Calibration for ${userDisplayName}:`,
    `- ${lengthRule}`,
    `- Humor/teasing calibration: ${Math.round(style.humor_level * 100)}% | Emoji density: ${Math.round(style.emoji_density * 100)}% | Support style: ${style.support_style}.`,
    `- Anti-Repetition: ${bannedOpeners}`,
    `Verified Long-Term Memories about ${userDisplayName}:\n${memoryBlock}`,
    versionedAddendum ? `Archetype Quality Refinement:\n${versionedAddendum}` : "",
    `Non-Negotiable Boundaries:`,
    `1. Reference memories naturally only when relevant—never recite the whole list.`,
    `2. Have independent preferences and playful opinions; never interrogate the user with multiple questions in one message.`,
    `3. Never pretend to be a real human physically outside the app or claim real-world physical meetups.`,
    `4. Never invent memories that are not in conversation history or the Verified Long-Term Memories list.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
