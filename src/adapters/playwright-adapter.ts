import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { SurfaceAdapter, SurfaceState, ActFor } from "./surface-adapter.js";
import { resolveLocator, resolveLocatorWithBudget, LocatorResolutionError } from "../replay/locator-resolver.js";
import type { EvidenceLogger } from "../evidence/logger.js";

export class PlaywrightAdapter implements SurfaceAdapter {
  private browser!: Browser;
  private context!: BrowserContext;
  private currentPage!: Page;
  private lastStrategyHit: { kind: string; index: number } | null = null;

  static async launch(startUrl: string, headless = true): Promise<PlaywrightAdapter> {
    const adapter = new PlaywrightAdapter();
    adapter.browser = await chromium.launch({ headless });
    // Everything after this point that can throw (newContext/newPage/goto)
    // is wrapped so a failure here still closes the already-spawned browser
    // process before rethrowing. Found via adversarial testing: without
    // this, a bad startUrl (unreachable host, or even a Chrome-blocked
    // "unsafe port" like :1) orphaned a live Chromium process — every
    // caller's own try/catch correctly turned the exception into a typed
    // Result, but the orphaned browser process kept running (and kept
    // Node's event loop alive) regardless, hanging the whole program.
    try {
      adapter.context = await adapter.browser.newContext();
      adapter.currentPage = await adapter.context.newPage();
      // A bounded action/navigation timeout is a real production safeguard,
      // not just a test convenience: without it, a stalled backend hangs the
      // whole replay indefinitely instead of surfacing a typed, debuggable
      // failure. setDefaultTimeout covers locator actions (click/fill/etc,
      // including the navigation a click implicitly triggers);
      // setDefaultNavigationTimeout covers explicit goto/waitForNavigation —
      // both are needed, they are NOT the same timeout in Playwright. Kept
      // generous relative to this app's actual (near-instant) pages — only a
      // genuinely stalled response should ever hit it.
      adapter.currentPage.setDefaultTimeout(5000);
      adapter.currentPage.setDefaultNavigationTimeout(5000);
      await adapter.currentPage.goto(startUrl);
    } catch (err) {
      await adapter.browser.close().catch(() => {});
      throw err;
    }
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

  private async resolve(action: ActFor) {
    const strategies = action.target!;
    const r =
      action.timeoutMs && action.retry
        ? await resolveLocatorWithBudget(this.currentPage, strategies, { timeoutMs: action.timeoutMs, retry: action.retry })
        : await resolveLocator(this.currentPage, strategies);
    this.lastStrategyHit = { kind: r.strategyKind, index: r.strategyIndex };
    return r;
  }

  async act(action: ActFor): Promise<string | void> {
    switch (action.type) {
      case "navigate": {
        await this.currentPage.goto(action.value!);
        return;
      }
      case "click": {
        const r = await this.resolve(action);
        await r.locator.click();
        return;
      }
      case "type": {
        const r = await this.resolve(action);
        await r.locator.fill(action.value ?? "");
        return;
      }
      case "waitFor": {
        const r = await this.resolve(action);
        await r.locator.waitFor({ state: "visible" });
        return;
      }
      case "extract": {
        const r = await this.resolve(action);
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
