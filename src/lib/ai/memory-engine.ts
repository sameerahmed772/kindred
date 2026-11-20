import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Type } from "@google/genai";
import { getGeminiClient, getGeminiModels } from "@/lib/ai/gemini";
import type { MemoryCategory, StyleProfile } from "@/lib/types";

export interface RetrievedMemory {
  id: string;
  category: MemoryCategory;
  fact: string;
  importance: number;
  event_date: string | null;
  similarity: number;
  hybrid_score: number;
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const ai = getGeminiClient();
    const { embed } = getGeminiModels();
    const res = await ai.models.embedContent({
      model: embed,
      contents: text,
      config: { outputDimensionality: 768 },
    });
    const values = res.embeddings?.[0]?.values;
    return values && values.length === 768 ? values : null;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}

export async function retrieveHybridMemories(params: {
  supabase: SupabaseClient;
  userId: string;
  companionId: string;
  queryText: string;
  limit?: number;
}): Promise<RetrievedMemory[]> {
  const { supabase, userId, companionId, queryText, limit = 8 } = params;
  const queryEmbedding = await embedText(queryText);

  if (queryEmbedding) {
    const { data, error } = await supabase.rpc("match_hybrid_memories", {
      p_user_id: userId,
      p_companion_id: companionId,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_match_count: limit,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const ids = data.map((row: RetrievedMemory) => row.id);
      void supabase
        .from("memories")
        .update({ last_referenced_at: new Date().toISOString() })
        .in("id", ids)
        .eq("user_id", userId);
      return data as RetrievedMemory[];
    }
  }

  const { data } = await supabase
    .from("memories")
    .select("id, category, fact, importance, event_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`companion_id.eq.${companionId},companion_id.is.null`)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    ...row,
    similarity: 0.5,
    hybrid_score: 0.5,
  })) as RetrievedMemory[];
}

interface ExtractedMemoryPayload {
  memories: Array<{
    category: MemoryCategory;
    fact: string;
    importance: number;
    event_date?: string | null;
    supersedes_memory_id?: string | null;
  }>;
}

export async function extractAndReconcileMemories(params: {
  supabase: SupabaseClient;
  userId: string;
  companionId: string;
  recentTurns: Array<{ role: string; content: string }>;
}): Promise<{ created: number; superseded: number }> {
  const { supabase, userId, companionId, recentTurns } = params;
  if (recentTurns.length === 0) return { created: 0, superseded: 0 };

  const { data: existingMemories } = await supabase
    .from("memories")
    .select("id, category, fact")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`companion_id.eq.${companionId},companion_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(40);

  const existingList = (existingMemories ?? [])
    .map((m) => `ID=${m.id} | [${m.category}] ${m.fact}`)
    .join("\n");

  const transcript = recentTurns
    .slice(-6)
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");

  const ai = getGeminiClient();
  const { fast } = getGeminiModels();

  const response = await ai.models.generateContent({
    model: fast,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Extract durable, personal long-term facts about the USER from the conversation snippet below.",
              "Rules:",
              "- Only extract facts explicitly stated by the user (name, birthday, job/studies, goals, favorites, friends/family, upcoming events, dislikes).",
              "- Ignore ephemeral greetings or assistant guesses.",
              "- If a new fact updates or contradicts an Existing Active Memory, set supersedes_memory_id to that exact existing ID.",
              "- Skip facts already captured identically in Existing Active Memories.",
              "- If an event date is explicitly mentioned (YYYY-MM-DD), include event_date.",
              "",
              `Existing Active Memories:\n${existingList || "(none)"}`,
              "",
              `Conversation:\n${transcript}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          memories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  enum: ["identity", "interest", "relationship", "work_study", "event", "preference"],
                },
                fact: { type: Type.STRING },
                importance: { type: Type.INTEGER },
                event_date: { type: Type.STRING, nullable: true },
                supersedes_memory_id: { type: Type.STRING, nullable: true },
              },
              required: ["category", "fact", "importance"],
            },
          },
        },
        required: ["memories"],
      },
    },
  });

  const rawText = response.text;
  if (!rawText) return { created: 0, superseded: 0 };

  let parsed: ExtractedMemoryPayload;
  try {
    parsed = JSON.parse(rawText) as ExtractedMemoryPayload;
  } catch {
    return { created: 0, superseded: 0 };
  }

  let created = 0;
  let superseded = 0;
  const existingIds = new Set((existingMemories ?? []).map((m) => m.id));

  for (const item of (parsed.memories ?? []).slice(0, 5)) {
    const cleanFact = item.fact?.trim();
    if (!cleanFact || cleanFact.length < 3) continue;

    const importance = Math.min(5, Math.max(1, Math.round(item.importance || 3)));
    const validDate =
      item.event_date && /^\d{4}-\d{2}-\d{2}$/.test(item.event_date)
        ? item.event_date
        : null;

    const embedding = await embedText(`[${item.category}] ${cleanFact}`);

    const { data: inserted, error } = await supabase
      .from("memories")
      .insert({
        user_id: userId,
        companion_id: item.category === "identity" ? null : companionId,
        category: item.category,
        fact: cleanFact,
        importance,
        event_date: validDate,
        embedding: embedding ? JSON.stringify(embedding) : null,
      })
      .select("id")
      .single();

    if (!error && inserted) {
      created += 1;
      if (item.supersedes_memory_id && existingIds.has(item.supersedes_memory_id)) {
        await supabase
          .from("memories")
          .update({ status: "superseded", superseded_by: inserted.id })
          .eq("id", item.supersedes_memory_id)
          .eq("user_id", userId);
        superseded += 1;
      }
    }
  }

  return { created, superseded };
}

export async function updateAdaptiveStyleProfile(params: {
  supabase: SupabaseClient;
  userId: string;
  companionId: string;
  currentStyle: StyleProfile;
  userMessage: string;
  assistantMessage: string;
}): Promise<StyleProfile> {
  const { supabase, userId, companionId, currentStyle, userMessage, assistantMessage } = params;

  const opener = assistantMessage.trim().split(/\s+/).slice(0, 4).join(" ");
  const recentOpeners = [...(currentStyle.recent_openers ?? []), opener].slice(-15);
  const turnCount = (currentStyle.turn_count ?? 0) + 1;

  const userWordCount = userMessage.trim().split(/\s+/).filter(Boolean).length;
  const userHasEmoji = /\p{Extended_Pictographic}/u.test(userMessage);
  const userHasLaugh = /\b(haha|lmao|lol|dead|😂|🤣)\b/i.test(userMessage);

  let replyLength = currentStyle.reply_length ?? "balanced";
  if (turnCount % 3 === 0) {
    if (userWordCount <= 7) replyLength = "terse";
    else if (userWordCount >= 32) replyLength = "expressive";
    else replyLength = "balanced";
  }

  const nextEmoji = Number(
    Math.min(
      0.95,
      Math.max(0.05, (currentStyle.emoji_density ?? 0.4) * 0.85 + (userHasEmoji ? 0.15 : 0.02))
    ).toFixed(2)
  );
  const nextHumor = Number(
    Math.min(
      0.95,
      Math.max(0.15, (currentStyle.humor_level ?? 0.6) * 0.88 + (userHasLaugh ? 0.12 : 0.05))
    ).toFixed(2)
  );

  const updated: StyleProfile = {
    reply_length: replyLength,
    humor_level: nextHumor,
    emoji_density: nextEmoji,
    support_style: currentStyle.support_style ?? "balanced",
    recent_openers: recentOpeners,
    turn_count: turnCount,
  };

  await supabase
    .from("companions")
    .update({ style_profile: updated })
    .eq("id", companionId)
    .eq("user_id", userId);

  return updated;
}
