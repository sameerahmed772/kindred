export interface RedactionResult {
  sanitized: string;
  redactionsCount: number;
  verifiedClean: boolean;
}

const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  { name: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { name: "url", regex: /https?:\/\/[^\s]+/gi, replacement: "[URL]" },
  { name: "credit_card", regex: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[PAYMENT_ID]" },
  { name: "phone", regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/g, replacement: "[PHONE]" },
  { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[ID_NUMBER]" },
  { name: "address", regex: /\b\d{1,5}\s+[A-Za-z0-9\s.'-]+\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Rue|Road|Rd|Lane|Ln|Drive|Dr)\b/gi, replacement: "[ADDRESS]" },
  { name: "handle", regex: /@[a-zA-Z0-9_]{3,30}/g, replacement: "[HANDLE]" },
];

export function redactPII(text: string, knownNames: string[] = []): RedactionResult {
  let sanitized = text;
  let redactionsCount = 0;

  for (const { regex, replacement } of PII_PATTERNS) {
    sanitized = sanitized.replace(regex, (match) => {
      if (replacement === "[PHONE]" && match.replace(/\D/g, "").length < 7) {
        return match;
      }
      redactionsCount += 1;
      return replacement;
    });
  }

  for (const rawName of knownNames) {
    const trimmed = rawName.trim();
    if (trimmed.length < 2) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRegex = new RegExp(`\\b${escaped}\\b`, "gi");
    sanitized = sanitized.replace(nameRegex, () => {
      redactionsCount += 1;
      return "[USER]";
    });
  }

  const hasResidualEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(sanitized);
  const hasResidualUrl = /https?:\/\//i.test(sanitized);
  const hasLongDigits = /\d{9,}/.test(sanitized.replace(/\s+/g, ""));

  return {
    sanitized,
    redactionsCount,
    verifiedClean: !hasResidualEmail && !hasResidualUrl && !hasLongDigits,
  };
}
