// What's sensitive, kept separate from how redaction executes (logger.ts).
// Two layers, since either one alone misses real cases:
//  - key-name match: catches known-sensitive fields regardless of value shape
//  - value-pattern match: catches sensitive-shaped values under an innocuous
//    key name (e.g. an SSN accidentally captured under a generic "note" key)
//
// Explicitly a starting set, not exhaustive PII coverage — a production
// system would need a much broader, likely tenant-configurable, list (see
// REPORT.md §6 "Limits"). Broadened here beyond the original single SSN
// pattern to make that intent concrete rather than aspirational.

export const SENSITIVE_KEY_PATTERN =
  /ssn|password|token|secret|credential|apikey|social.?security|dob|date.?of.?birth|account.?number|routing.?number|pin\b/i;

export interface ValuePattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export const VALUE_PATTERNS: ValuePattern[] = [
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[REDACTED-SSN]" },
  // Requires visible grouping (space/dash every 4 digits) — a bare 13-19
  // digit run is deliberately NOT matched, since that would also catch our
  // own evidenceId values (Date.now() timestamps are 13 digits) as a false
  // positive. Real card numbers are essentially never typed/displayed as
  // one ungrouped digit blob, so this loses little real coverage.
  { name: "card", pattern: /\b\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]?\d{1,4})?\b/g, replacement: "[REDACTED-CARD]" },
  { name: "email", pattern: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, replacement: "[REDACTED-EMAIL]" },
  { name: "phone", pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[REDACTED-PHONE]" },
];
