export interface SafetyAssessment {
  crisisDetected: boolean;
  blocked: boolean;
  interventionMessage?: string;
}

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill\s+myself|end\s+my\s+life|want\s+to\s+die|commit\s+suicide|suicidal)\b/i,
  /\b(hurt\s+myself|cut\s+myself|self[\s-]?harm|overdose\s+on)\b/i,
  /\b(no\s+reason\s+to\s+live|better\s+off\s+dead)\b/i,
];

const SEVERE_POLICY_PATTERNS: RegExp[] = [
  /\b(csam|child\s+sexual|underage\s+sex|minor\s+nude)\b/i,
];

export function evaluateMessageSafety(text: string): SafetyAssessment {
  for (const rx of SEVERE_POLICY_PATTERNS) {
    if (rx.test(text)) {
      return {
        crisisDetected: false,
        blocked: true,
        interventionMessage:
          "This request violates Kindred's safety policy and cannot be processed.",
      };
    }
  }

  for (const rx of CRISIS_PATTERNS) {
    if (rx.test(text)) {
      return {
        crisisDetected: true,
        blocked: false,
        interventionMessage: [
          "I'm stepping out of character because your safety matters most. I'm an AI companion and can't provide emergency care, but real people are ready to support you right now:",
          "",
          "• France: Call 3114 (24/7 free, confidential suicide prevention line) or 112 for emergencies.",
          "• United States & Canada: Call or text 988 (Suicide & Crisis Lifeline).",
          "• United Kingdom: Call 111 (NHS mental health) or 116 123 (Samaritans).",
          "• International: Visit https://findahelpline.com for free local support.",
          "",
          "Please reach out to someone you trust or one of these services right now. You don't have to carry this alone.",
        ].join("\n"),
      };
    }
  }

  return { crisisDetected: false, blocked: false };
}

export const EU_AI_ACT_DISCLOSURE =
  "Kindred companions are fictional AI characters powered by generative AI (EU AI Act Art. 50 disclosure). Conversations, voice calls, and proactive check-ins are AI-generated and never sent by a human outside the app.";
