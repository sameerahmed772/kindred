import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getServerEnv } from "@/lib/env";

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (client) return client;
  const env = getServerEnv();
  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

export function getGeminiLiveClient(): GoogleGenAI {
  const env = getServerEnv();
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: { apiVersion: "v1alpha" },
  });
}

export function getGeminiModels() {
  const env = getServerEnv();
  return {
    chat: env.GEMINI_CHAT_MODEL,
    fast: env.GEMINI_FAST_MODEL,
    embed: env.GEMINI_EMBED_MODEL,
    live: env.GEMINI_LIVE_MODEL,
  };
}
