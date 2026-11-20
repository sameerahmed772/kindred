import { describe, it, expect } from "vitest";
import { evaluateMessageSafety } from "@/lib/ai/safety";
import { redactPII } from "@/lib/ai/pii-redactor";
import { buildCompanionSystemPrompt } from "@/lib/ai/prompt-builder";

describe("Safety & Crisis Interceptor", () => {
  it("flags crisis phrasing and returns localized helpline info", () => {
    const res = evaluateMessageSafety("I feel hopeless and want to kill myself tonight");
    expect(res.crisisDetected).toBe(true);
    expect(res.blocked).toBe(false);
    expect(res.interventionMessage).toContain("3114");
    expect(res.interventionMessage).toContain("988");
  });

  it("allows normal casual messages", () => {
    const res = evaluateMessageSafety("Just finished my CS lab and grabbed ramen!");
    expect(res.crisisDetected).toBe(false);
    expect(res.blocked).toBe(false);
  });
});

describe("PII Redactor (Tier 2/3 Opt-In Learning)", () => {
  it("redacts emails, phone numbers, URLs, and known user names", () => {
    const out = redactPII(
      "Hey, I am Alex. Email me at alex.dev@example.com or call +33 6 12 34 56 78, check https://secret.me",
      ["Alex"]
    );
    expect(out.verifiedClean).toBe(true);
    expect(out.sanitized).not.toContain("alex.dev@example.com");
    expect(out.sanitized).not.toContain("34 56 78");
    expect(out.sanitized).not.toContain("https://secret.me");
    expect(out.sanitized).toContain("[USER]");
    expect(out.sanitized).toContain("[EMAIL]");
  });
});

describe("Prompt Builder Consent & Anti-Repetition", () => {
  it("caps stage at 4 when romantic_consent_enabled is false", () => {
    const prompt = buildCompanionSystemPrompt({
      companion: {
        name: "Maya",
        gender: "female",
        age: 24,
        personality_summary: "Witty and warm",
        communication_style: "Casual texting",
        backstory: "Graphic designer",
        interests: ["Music"],
        relationship_stage: 6,
        romantic_consent_enabled: false,
        style_profile: {
          reply_length: "terse",
          humor_level: 0.7,
          emoji_density: 0.4,
          support_style: "balanced",
          recent_openers: ["Hey there!"],
          turn_count: 5,
        },
      },
      userDisplayName: "Sam",
      memories: [{ category: "work_study", fact: "Studies computer science", importance: 5 }],
    });

    expect(prompt).toContain("Stage 4 (Close Friends)");
    expect(prompt).not.toContain("Stage 6 (Partners)");
    expect(prompt).toContain("Studies computer science");
    expect(prompt).toContain("Hey there!");
  });
});
