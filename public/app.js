// Vanilla JS, no build step, no framework — matches the rest of this
// project's dependency-minimal approach. Every action here calls the same
// API that just wraps runDiscovery/compileFromTranscriptFile/replay; the
// CLI calling those same functions directly is unaffected.

function badge(kind) {
  const span = document.createElement("span");
  span.className = "badge badge-" + (kind || "unknown");
  span.textContent = kind || "unknown";
  return span;
}

// ---- Tabs ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "capabilities") loadCapabilities();
    if (btn.dataset.tab === "replay") loadReplayCapabilities();
    if (btn.dataset.tab === "evidence") loadEvidence();
  });
});

// ---- Discover ----
document.getElementById("discover-run").addEventListener("click", async () => {
  const goal = document.getElementById("discover-goal").value.trim();
  const target = document.getElementById("discover-target").value.trim();
  const statusEl = document.getElementById("discover-status");
  const resultEl = document.getElementById("discover-result");
  if (!goal) return;

  statusEl.classList.remove("hidden");
  statusEl.textContent = "Running discovery — the LLM is driving the live app now. This can take 10-30s...";
  resultEl.classList.add("hidden");

  try {
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, target }),
    });
    const data = await res.json();
    statusEl.classList.add("hidden");
    resultEl.classList.remove("hidden");
    resultEl.innerHTML = "";
    resultEl.appendChild(badge(data.kind));
    const p = document.createElement("p");
    if (data.kind === "success") {
      p.innerHTML = `<b>${escapeHtml(data.summary || "")}</b><br>Outputs: <code>${escapeHtml(
        JSON.stringify(data.outputs)
      )}</code><br>Run id: <code>${data.runId}</code>`;
    } else {
      p.innerHTML = `Stuck: <b>${escapeHtml(data.reason || "")}</b><br>Run id: <code>${data.runId}</code><br>
        <span class="hint">To escalate and finish this manually, re-run from the terminal with --escalate
        (see README "Escalation" demo command).</span>`;
    }
    resultEl.appendChild(p);
  } catch (err) {
    statusEl.classList.add("hidden");
    resultEl.classList.remove("hidden");
    resultEl.textContent = "Error: " + err.message;
  }
});

// ---- Capabilities ----
async function loadCapabilities() {
  const list = document.getElementById("capabilities-list");
  list.innerHTML = "Loading...";
  const caps = await (await fetch("/api/capabilities")).json();
  list.innerHTML = "";
  caps.forEach((c) => {
    const div = document.createElement("div");
    div.className = "capability-item";
    div.innerHTML = `
      <h3>${escapeHtml(c.capabilityId)} <span class="muted">v${c.version}</span></h3>
      <div class="muted">${escapeHtml(c.description)}</div>
      <div class="schema">inputs: ${escapeHtml(JSON.stringify(c.inputSchema))}</div>
      <div class="schema">outputs: ${escapeHtml(JSON.stringify(c.outputSchema))}</div>
      ${c.riskySteps.length ? `<div class="risky-flag">⚠ risky step(s): ${c.riskySteps.join(", ")} — requires confirm:true</div>` : ""}
      ${c.canonicalRoutes.length ? `<div class="schema">routes: ${escapeHtml(c.canonicalRoutes.join(", "))}</div>` : ""}
    `;
    list.appendChild(div);
  });
}
document.getElementById("capabilities-refresh").addEventListener("click", loadCapabilities);

// ---- Replay ----
let replayCapabilitiesCache = [];

async function loadReplayCapabilities() {
  replayCapabilitiesCache = await (await fetch("/api/capabilities")).json();
  const select = document.getElementById("replay-capability");
  select.innerHTML = "";
  replayCapabilitiesCache.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.file;
    opt.textContent = c.capabilityId;
    select.appendChild(opt);
  });
  renderReplayInputs();
}

function renderReplayInputs() {
  const file = document.getElementById("replay-capability").value;
  const cap = replayCapabilitiesCache.find((c) => c.file === file);
  const container = document.getElementById("replay-inputs");
  container.innerHTML = "";
  if (!cap) return;
  Object.entries(cap.inputSchema).forEach(([key, type]) => {
    const label = document.createElement("label");
    label.textContent = `${key} (${type})`;
    const input = document.createElement("input");
    input.type = type === "number" ? "number" : "text";
    input.id = "input-" + key;
    input.dataset.field = key;
    input.dataset.type = type;
    container.appendChild(label);
    container.appendChild(input);
  });
  if (cap.riskySteps.length) {
    const label = document.createElement("label");
    label.textContent = "confirm (this capability has a risky/mutating step)";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "input-confirm";
    container.appendChild(label);
    container.appendChild(input);
  }
}
document.getElementById("replay-capability").addEventListener("change", renderReplayInputs);

document.getElementById("replay-run").addEventListener("click", async () => {
  const file = document.getElementById("replay-capability").value;
  const cap = replayCapabilitiesCache.find((c) => c.file === file);
  const resultEl = document.getElementById("replay-result");
  if (!cap) return;

  const inputs = {};
  Object.keys(cap.inputSchema).forEach((key) => {
    const el = document.getElementById("input-" + key);
    const raw = el.value;
    inputs[key] = el.dataset.type === "number" ? Number(raw) : raw;
  });
  const confirmEl = document.getElementById("input-confirm");
  if (confirmEl) inputs.confirm = confirmEl.checked;

  resultEl.classList.remove("hidden");
  resultEl.innerHTML = "Running replay...";

  try {
    const res = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, inputs }),
    });
    const data = await res.json();
    resultEl.innerHTML = "";
    resultEl.appendChild(badge(data.kind));
    const p = document.createElement("p");
    p.innerHTML = `<code>${escapeHtml(JSON.stringify(data, null, 2))}</code>`;
    resultEl.appendChild(p);
  } catch (err) {
    resultEl.innerHTML = "Error: " + err.message;
  }
});

// ---- Evidence ----
async function loadEvidence() {
  const runs = await (await fetch("/api/evidence")).json();
  const tbody = document.querySelector("#evidence-table tbody");
  tbody.innerHTML = "";
  document.getElementById("evidence-detail-card").style.display = "none";
  runs.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "evidence-row";
    tr.innerHTML = `
      <td>${r.type}</td>
      <td>${escapeHtml(r.goalOrCapability)}</td>
      <td></td>
      <td>${escapeHtml((r.ts || "").replace("T", " ").slice(0, 19))}</td>
    `;
    tr.children[2].appendChild(badge(r.kind));
    tr.addEventListener("click", () => loadEvidenceDetail(r.id));
    tbody.appendChild(tr);
  });
}
document.getElementById("evidence-refresh").addEventListener("click", loadEvidence);

async function loadEvidenceDetail(id) {
  const data = await (await fetch("/api/evidence/" + id)).json();
  const card = document.getElementById("evidence-detail-card");
  const title = document.getElementById("evidence-detail-title");
  const container = document.getElementById("evidence-detail");
  card.style.display = "block";
  title.textContent = "Run detail — " + id;
  container.innerHTML = "";

  if (data.result) {
    const p = document.createElement("p");
    p.appendChild(badge(data.result.kind));
    p.appendChild(document.createTextNode(" " + JSON.stringify(data.result)));
    container.appendChild(p);
  }

  data.steps.forEach((s) => {
    const div = document.createElement("div");
    div.className = "step-line";
    div.innerHTML = `<span class="actor ${s.actor}">${s.actor}</span>
      <div><b>${escapeHtml(s.event)}</b><pre>${escapeHtml(JSON.stringify(s.detail || {}, null, 0))}</pre></div>`;
    container.appendChild(div);
  });

  if (data.drift.length) {
    const h = document.createElement("h3");
    h.textContent = "Locator drift signal";
    container.appendChild(h);
    data.drift.forEach((d) => {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `step ${d.step}: ${d.outcome} (${d.strategyKind}, index ${d.strategyIndex})`;
      container.appendChild(p);
    });
  }

  if (data.approvals.length) {
    const h = document.createElement("h3");
    h.textContent = "Risky-action approvals";
    container.appendChild(h);
    data.approvals.forEach((a) => {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `step ${a.step} (${a.action}) confirmed at ${a.ts}`;
      container.appendChild(p);
    });
  }

  if (data.screenshots.length) {
    const h = document.createElement("h3");
    h.textContent = "Screenshots";
    container.appendChild(h);
    data.screenshots.forEach((f) => {
      const img = document.createElement("img");
      img.className = "screenshot-thumb";
      img.src = `/api/evidence/${id}/screenshots/${f}`;
      container.appendChild(img);
    });
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Initial load
loadReplayCapabilities();
