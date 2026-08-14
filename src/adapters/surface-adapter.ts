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
}

export interface SurfaceAdapter {
  observe(): Promise<SurfaceState>;
  act(action: ActFor): Promise<string | void>;
  snapshot(evidenceDir: string, label: string): Promise<{ screenshotPath: string; axTreePath: string }>;
  page(): Page;
}
