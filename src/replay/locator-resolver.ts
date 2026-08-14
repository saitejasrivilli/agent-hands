import type { Page, Locator } from "playwright";
import type { LocatorStrategy } from "../artifact/types.js";

export class LocatorResolutionError extends Error {
  constructor(public strategies: LocatorStrategy[]) {
    super(`No locator strategy resolved uniquely: ${JSON.stringify(strategies)}`);
  }
}

export interface ResolveResult {
  locator: Locator;
  strategyIndex: number;
  strategyKind: LocatorStrategy["kind"];
}

// Resolves in priority order (as authored in the artifact/step). Logs which
// strategy hit so drift can be observed over many replays (BEST_PRACTICES.md
// §1/§10) — the caller is responsible for writing that to the evidence log.
export async function resolveLocator(page: Page, strategies: LocatorStrategy[]): Promise<ResolveResult> {
  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    let locator: Locator;
    switch (s.kind) {
      case "testid":
        locator = page.getByTestId(s.value);
        break;
      case "role":
        locator = page.getByRole(s.value as any, s.meta?.name ? { name: s.meta.name } : undefined);
        break;
      case "text":
        locator = page.getByText(s.value, { exact: s.meta?.exact === "true" });
        break;
      case "cssPath":
        locator = page.locator(s.value);
        break;
      case "axPath":
      case "coordinates":
        // not implemented for the web adapter; reserved for future surface types (HLD.md §6)
        continue;
      default:
        continue;
    }
    const count = await locator.count().catch(() => 0);
    if (count === 1) {
      return { locator, strategyIndex: i, strategyKind: s.kind };
    }
    // zero matches -> try next strategy; ambiguous (>1) -> also try next
    // rather than guessing which one, per BEST_PRACTICES.md §1.
  }
  throw new LocatorResolutionError(strategies);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps resolveLocator with condition-based polling — bounded by timeoutMs
// and retry.max, backing off retry.backoffMs between attempts. Fixes a real
// gap: Step.timeoutMs/retry were declared on the schema from V0 onward but
// never actually consulted anywhere, so a step either resolved on the first
// immediate check or failed outright — no tolerance for a page that's still
// mid-render or a backend that's merely slow, not broken (see DECISIONS.md).
// This is still "no fixed sleep()" in spirit: it doesn't wait a fixed amount
// before checking, it re-checks the actual condition (does the locator
// resolve yet?) on a bounded schedule and stops the moment it does.
export async function resolveLocatorWithBudget(
  page: Page,
  strategies: LocatorStrategy[],
  budget: { timeoutMs: number; retry: { max: number; backoffMs: number } }
): Promise<ResolveResult> {
  const deadline = Date.now() + budget.timeoutMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= budget.retry.max; attempt++) {
    try {
      return await resolveLocator(page, strategies);
    } catch (err) {
      lastError = err;
      const timeLeft = deadline - Date.now();
      if (attempt === budget.retry.max || timeLeft <= 0) break;
      await sleep(Math.min(budget.retry.backoffMs, timeLeft));
    }
  }
  throw lastError instanceof Error ? lastError : new LocatorResolutionError(strategies);
}
