// Business-outcome taxonomy: what page text maps to what typed outcome code.
// Kept separate from replayer.ts so this is policy data, not mechanism —
// adding a new expected outcome (a new legitimate "this is a result, not a
// crash" case) means adding an entry here, not touching the execution loop.

export interface BusinessOutcomeMarker {
  pattern: RegExp;
  code: string;
  detail: string;
}

export const BUSINESS_OUTCOME_MARKERS: BusinessOutcomeMarker[] = [
  { pattern: /no member found/i, code: "member_not_found", detail: "target app reported no matching member" },
  {
    pattern: /access denied/i,
    code: "permission_denied",
    detail: "target app reported the caller lacks permission for this member/action",
  },
];
