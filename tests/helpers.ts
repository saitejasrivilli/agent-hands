import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

// Spawns a real target-app instance on a dedicated test port (as a genuine
// child process, not an in-process mock) so tests exercise the real system
// end to end — Playwright driving a real server — matching how this project
// has been manually verified throughout, just automated.
export async function startTargetApp(port: number, tenant?: string): Promise<ChildProcess> {
  const child = spawn("npx", ["tsx", "target-app/server.ts"], {
    env: { ...process.env, PORT: String(port), ...(tenant ? { TENANT: tenant } : {}) },
    stdio: "pipe",
  });
  await waitForHttp(`http://localhost:${port}/`, 10_000);
  return child;
}

export function stopTargetApp(child: ChildProcess) {
  child.kill();
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`target app at ${url} did not become ready within ${timeoutMs}ms`);
}

export function cleanEvidenceDir(evidenceRoot: string) {
  rmSync(evidenceRoot, { recursive: true, force: true });
}
