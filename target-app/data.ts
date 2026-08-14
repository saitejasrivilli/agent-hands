export interface Member {
  id: string;
  name: string;
  savingsBalance: number;
  currency: string;
}

export const members: Record<string, Member> = {
  "12345": { id: "12345", name: "Alice Rivera", savingsBalance: 4820.55, currency: "USD" },
  "67890": { id: "67890", name: "Marcus Chen", savingsBalance: 132.10, currency: "USD" },
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
