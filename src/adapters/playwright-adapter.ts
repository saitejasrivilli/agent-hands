import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { SurfaceAdapter, SurfaceState, ActFor } from "./surface-adapter.js";
import { resolveLocator, LocatorResolutionError } from "../replay/locator-resolver.js";
import type { EvidenceLogger } from "../evidence/logger.js";

export class PlaywrightAdapter implements SurfaceAdapter {
  private browser!: Browser;
  private context!: BrowserContext;
  private currentPage!: Page;
  private lastStrategyHit: { kind: string; index: number } | null = null;

  static async launch(startUrl: string, headless = true): Promise<PlaywrightAdapter> {
    const adapter = new PlaywrightAdapter();
    adapter.browser = await chromium.launch({ headless });
    adapter.context = await adapter.browser.newContext();
    adapter.currentPage = await adapter.context.newPage();
    await adapter.currentPage.goto(startUrl);
    return adapter;
  }

  page(): Page {
    return this.currentPage;
  }

  async observe(): Promise<SurfaceState> {
    const axTree = await this.currentPage.locator("body").ariaSnapshot();
    const domSummary = await this.currentPage.evaluate(() => document.body.innerText.slice(0, 4000));
    return {
      url: this.currentPage.url(),
      axTree,
      domSummary,
      screenshotPath: "",
    };
  }

  async act(action: ActFor): Promise<string | void> {
    switch (action.type) {
      case "navigate": {
        await this.currentPage.goto(action.value!);
        return;
      }
      case "click": {
        const r = await resolveLocator(this.currentPage, action.target!);
        this.lastStrategyHit = { kind: r.strategyKind, index: r.strategyIndex };
        await r.locator.click();
        return;
      }
      case "type": {
        const r = await resolveLocator(this.currentPage, action.target!);
        this.lastStrategyHit = { kind: r.strategyKind, index: r.strategyIndex };
        await r.locator.fill(action.value ?? "");
        return;
      }
      case "waitFor": {
        const r = await resolveLocator(this.currentPage, action.target!);
        this.lastStrategyHit = { kind: r.strategyKind, index: r.strategyIndex };
        await r.locator.waitFor({ state: "visible" });
        return;
      }
      case "extract": {
        const r = await resolveLocator(this.currentPage, action.target!);
        this.lastStrategyHit = { kind: r.strategyKind, index: r.strategyIndex };
        return (await r.locator.textContent()) ?? "";
      }
    }
  }

  getLastStrategyHit() {
    return this.lastStrategyHit;
  }

  async snapshot(evidenceDir: string, label: string): Promise<{ screenshotPath: string; axTreePath: string }> {
    const screenshotPath = `${evidenceDir}/screenshots/${label}.png`;
    const axTreePath = `${evidenceDir}/screenshots/${label}.ax.json`;
    await this.currentPage.screenshot({ path: screenshotPath });
    const ax = await this.currentPage.locator("body").ariaSnapshot();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(axTreePath, JSON.stringify({ ariaSnapshot: ax }, null, 2));
    return { screenshotPath, axTreePath };
  }

  async close() {
    await this.browser.close();
  }
}

export { LocatorResolutionError };
