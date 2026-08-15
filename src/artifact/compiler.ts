import { readFileSync } from "node:fs";
import type { TranscriptEntry } from "../agent/loop.js";
import type { Artifact, ActionType, FieldType, LocatorStrategy, Step } from "./types.js";
import { canonicalizeRoute } from "./route-canonicalization.js";

// Compiles a discovery transcript (raw, LLM-produced) into a typed, versioned,
// reusable Artifact — decoupled from the transcript per Section 3.2. The
// transcript's own locators are data-specific (e.g. the LLM located the
// balance cell by its literal value "4820.55 USD", which only exists for one
// member). The compiler's job is to notice that and add a more robust
// fallback locator, not just copy what discovery did verbatim.

function toCamelCase(label: string): string {
  const words = label.trim().split(/\s+/);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

// Heuristic: in a two-column "label / value" row (the common legacy-table
// shape), the accessibility snapshot lists `cell "<label>"` immediately
// before `cell "<value>"`. Find the value's preceding label so we can build a
// value-independent fallback locator (`tr:has-text('<label>')`) — this is
// what lets the artifact generalize across records instead of hardcoding one
// member's balance. Documented limitation: only handles this specific
// label/value adjacency shape; anything else falls back to no extra
// strategy (see DECISIONS.md).
function deriveRowLabel(ax: string, value: string): string | null {
  const cellMatches = [...ax.matchAll(/cell "([^"]+)"/g)].map((m) => m[1]);
  const idx = cellMatches.findIndex((c) => c === value);
  if (idx > 0) {
    const candidate = cellMatches[idx - 1];
    if (candidate !== value) return candidate;
  }
  return null;
}

export interface CompileOptions {
  capabilityId: string;
  description: string;
  goal: string;
  targetUrl: string;
  discoveryRunId: string;
}

export function compileArtifact(transcript: TranscriptEntry[], opts: CompileOptions): Artifact {
  const inputSchema: Record<string, FieldType> = {};
  const outputSchema: Record<string, FieldType> = {};
  const steps: Step[] = [];
  const actionsUsed = new Set<ActionType>();
  let lastExtractStep: Step | null = null;

  transcript.forEach((entry, i) => {
    const { name: actionName, args } = entry.action;
    if (actionName !== "click" && actionName !== "type" && actionName !== "extract") return;

    actionsUsed.add(actionName as ActionType);
    const role = String(args.role);
    const accessibleName = String(args.name);
    const strategies: LocatorStrategy[] = [{ kind: "role", value: role, meta: { name: accessibleName } }];

    let step: Step;

    if (actionName === "type") {
      const value = String(args.value ?? "");
      const isFromGoal = value.length > 0 && opts.goal.toLowerCase().includes(value.toLowerCase());
      let valueTemplate = value;
      if (isFromGoal) {
        const paramName = toCamelCase(accessibleName);
        inputSchema[paramName] = "string";
        valueTemplate = `{{${paramName}}}`;
      }
      step = {
        index: i,
        action: "type",
        target: { strategies },
        valueTemplate,
        timeoutMs: 5000,
        retry: { max: 1, backoffMs: 200 },
      };
    } else if (actionName === "click") {
      // Accessible name for controls (buttons/links) is stable regardless of
      // record data, so a text-match fallback is safe to add here (unlike
      // extract, where the "name" is often the data value itself).
      strategies.push({ kind: "text", value: accessibleName, meta: { exact: "true" } });
      step = {
        index: i,
        action: "click",
        target: { strategies },
        timeoutMs: 5000,
        retry: { max: 1, backoffMs: 200 },
      };
    } else {
      // extract
      const key = String(args.key ?? `field${i}`);
      // Fixed known bug (see DECISIONS.md): the earlier version of this
      // fallback matched the whole <tr>, so its textContent was
      // "label+value" concatenated — inconsistent with the primary
      // strategy's bare-value output. Scoping to the row's second cell
      // (the value column in this table's label/value layout) makes output
      // shape consistent regardless of which strategy resolves.
      // A transcript entry with a missing/malformed `observation.ax` (e.g.
      // from a truncated or corrupted discovery run) used to crash the
      // compiler with an unhelpful "Cannot read properties of undefined"
      // instead of degrading gracefully. Found via adversarial testing —
      // defaulting to "" means deriveRowLabel just finds no fallback
      // (honest: the compiler couldn't derive one from this entry), rather
      // than treating a data-quality problem as a hard crash.
      const label = deriveRowLabel(entry.observation?.ax ?? "", accessibleName);
      if (label) {
        strategies.push({ kind: "cssPath", value: `table[border='1'] tr:has-text('${label}') td:nth-child(2)` });
      }
      outputSchema[key] = "string";
      step = {
        index: i,
        action: "extract",
        target: { strategies },
        extractAs: key,
        timeoutMs: 5000,
        retry: { max: 1, backoffMs: 200 },
      };
      lastExtractStep = step;
    }

    steps.push(step);
  });

  const successCondition = lastExtractStep
    ? { kind: "elementText" as const, target: (lastExtractStep as Step).target }
    : { kind: "urlMatches" as const, expected: ".*" };

  // Same defensive treatment as the ax-snapshot fallback above: a missing/
  // invalid observation.url shouldn't crash compilation, just be skipped
  // from the canonical-routes list (it's metadata, not load-bearing).
  const canonicalRoutes = [
    ...new Set(
      transcript
        .map((entry) => {
          try {
            return canonicalizeRoute(entry.observation?.url ?? "");
          } catch {
            return null;
          }
        })
        .filter((r): r is string => r !== null)
    ),
  ];

  return {
    capabilityId: opts.capabilityId,
    version: 1,
    description: opts.description,
    inputSchema,
    outputSchema,
    steps,
    successCondition,
    recoveryRules: [],
    allowlistScope: {
      domains: [new URL(opts.targetUrl).hostname],
      actions: [...actionsUsed],
    },
    createdFrom: { discoveryRunId: opts.discoveryRunId, timestamp: new Date().toISOString() },
    canonicalRoutes,
  };
}

export function compileFromTranscriptFile(transcriptPath: string, opts: CompileOptions): Artifact {
  const transcript: TranscriptEntry[] = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  return compileArtifact(transcript, opts);
}
