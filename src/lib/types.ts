export type PlanTier = "free" | "plus" | "pro";
export type Gender = "female" | "male" | "non-binary";
export type MemoryCategory =
  | "identity"
  | "interest"
  | "relationship"
  | "work_study"
  | "event"
  | "preference";
export type ReactionType = "love" | "laugh" | "up" | "down";

export interface StyleProfile {
  reply_length: "terse" | "balanced" | "expressive";
  humor_level: number;
  emoji_density: number;
  support_style: "listener" | "balanced" | "problem_solver" | "playful";
  recent_openers: string[];
  turn_count: number;
}

export interface UserProfile {
  id: string;
  display_name: string;
  birth_date: string | null;
  is_age_verified: boolean;
  ai_disclosure_accepted_at: string | null;
  timezone: string;
  plan_tier: PlanTier;
  subscription_status: string;
  theme: "light" | "dark" | "system";
  proactive_enabled: boolean;
  proactive_frequency: "off" | "low" | "balanced" | "high";
  quiet_hours_start: string;
  quiet_hours_end: string;
  voice_speed: number;
  allow_anonymized_training: boolean;
}

export interface Companion {
  id: string;
  user_id: string;
  archetype_slug: string;
  name: string;
  gender: Gender;
  age: number;
  avatar_url: string | null;
  personality_summary: string;
  communication_style: string;
  backstory: string;
  interests: string[];
  voice_id: string;
  chat_theme: string;
  relationship_stage: number;
  affinity_score: number;
  romantic_consent_enabled: boolean;
  style_profile: StyleProfile;
  last_interaction_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  companion_id: string;
  role: "user" | "assistant";
  modality: "text" | "voice_note" | "live_call";
  content: string;
  prompt_version_id?: string | null;
  is_proactive: boolean;
  user_reaction?: ReactionType | null;
  created_at: string;
}

export interface MemoryItem {
  id: string;
  user_id: string;
  companion_id: string | null;
  category: MemoryCategory;
  fact: string;
  importance: number;
  status: "active" | "superseded" | "deleted";
  event_date: string | null;
  created_at: string;
}
