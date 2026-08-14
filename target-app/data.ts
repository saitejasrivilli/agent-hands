export interface Member {
  id: string;
  name: string;
  savingsBalance: number;
  currency: string;
  requiresInterstitial?: boolean;
  restricted?: boolean;
  responseDelayMs?: number;
}

export const members: Record<string, Member> = {
  "12345": { id: "12345", name: "Alice Rivera", savingsBalance: 4820.55, currency: "USD" },
  "67890": { id: "67890", name: "Marcus Chen", savingsBalance: 132.10, currency: "USD" },
  // Deliberately exercises a recoverable runtime condition (session-expiring-style
  // interstitial) for V3's error-taxonomy testing — see BUILD_PLAN.md V3.
  "55555": { id: "55555", name: "Priya Anand", savingsBalance: 950.0, currency: "USD", requiresInterstitial: true },
  // Deliberately exercises a second, distinct business-outcome case
  // (permission denied, not "not found") — proves the taxonomy is a real
  // set of policies, not one hardcoded pattern. See business-outcomes.ts.
  "40404": { id: "40404", name: "Restricted Member", savingsBalance: 0, currency: "USD", restricted: true },
  // Simulates a slow backend (e.g. a core-banking lookup hitting a legacy
  // mainframe) — a genuine timing failure, not a hand-broken locator. Used
  // to exercise escalation from an organic error, with an UNMODIFIED base
  // artifact (see DECISIONS.md).
  "88888": { id: "88888", name: "Devon Okafor", savingsBalance: 2100.0, currency: "USD", responseDelayMs: 7000 },
};

export const subAccounts: Array<{
  confirmationNumber: string;
  memberId: string;
  accountType: string;
  initialDeposit: number;
}> = [];

let confirmationCounter = 100000;
export function nextConfirmationNumber(): string {
  confirmationCounter += 1;
  return `SA-${confirmationCounter}`;
}
