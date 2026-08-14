export interface Member {
  id: string;
  name: string;
  savingsBalance: number;
  currency: string;
  requiresInterstitial?: boolean;
}

export const members: Record<string, Member> = {
  "12345": { id: "12345", name: "Alice Rivera", savingsBalance: 4820.55, currency: "USD" },
  "67890": { id: "67890", name: "Marcus Chen", savingsBalance: 132.10, currency: "USD" },
  // Deliberately exercises a recoverable runtime condition (session-expiring-style
  // interstitial) for V3's error-taxonomy testing — see BUILD_PLAN.md V3.
  "55555": { id: "55555", name: "Priya Anand", savingsBalance: 950.0, currency: "USD", requiresInterstitial: true },
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
