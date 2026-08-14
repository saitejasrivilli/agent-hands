import type { Page } from "playwright";
import type { LocatorStrategy } from "../artifact/types.js";

export interface SurfaceState {
  url: string;
  axTree: unknown;
  domSummary: string;
  screenshotPath: string;
}

export interface ActFor {
  type: "click" | "type" | "navigate" | "waitFor" | "extract";
  target?: LocatorStrategy[];
  value?: string;
  // Optional condition-based resolution budget (see locator-resolver.ts's
  // resolveLocatorWithBudget). Omitted by callers that don't have a Step to
  // draw it from (e.g. the discovery loop's single-shot actions) — falls
  // back to a single immediate check, unchanged from prior behavior.
  timeoutMs?: number;
  retry?: { max: number; backoffMs: number };
}

export interface SurfaceAdapter {
  observe(): Promise<SurfaceState>;
  act(action: ActFor): Promise<string | void>;
  snapshot(evidenceDir: string, label: string): Promise<{ screenshotPath: string; axTreePath: string }>;
  page(): Page;
}
