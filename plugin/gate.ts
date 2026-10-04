// Gate locale OpenCode <-> FastJev (shadow) — formato OpenCode v2.
// File locale, zero dipendenze npm. Blocchi deterministici istantanei
// (rules.json) + resto in shadow fire-and-forget verso 127.0.0.1:8080.

const GATE_URL = "http://127.0.0.1:8080";
const GATE_MODEL = "openjev-08b-nli";
const RULES_PATH = "/home/nabz/Dev/opencode-gate/rules.json";
const LOG_PATH = "/home/nabz/Dev/opencode-gate/logs/gate.log";
const THRESHOLDS_PATH = "/home/nabz/Dev/opencode-gate/thresholds.json";

let thresholds = { safety: { review_if_safe_below: 0.7 } };

async function loadThresholds() {
  try {
    const { readFile } = await import("node:fs/promises");
    thresholds = JSON.parse(await readFile(THRESHOLDS_PATH, "utf8"));
  } catch {
    // default sopra: fail-open
  }
}

let rules = null;

async function loadRules() {
  if (rules) return rules;
  try {
    const { readFile } = await import("node:fs/promises");
    rules = JSON.parse(await readFile(RULES_PATH, "utf8"));
  } catch {
    rules = { bash_deny: [], bash_ask_shadow: [], write_deny_paths: [] };
  }
  return rules;
}

async function logLine(obj) {
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
  } catch {
    // best-effort, mai bloccare
  }
}

let inFlight = 0;
const MAX_INFLIGHT = 1; // il modello serializza: piu di 1 accoda, timeout e OOM

function shadow(state, questions, meta) {
  if (inFlight >= MAX_INFLIGHT) {
    void logLine({ kind: "shadow-dropped", ...meta });
    return;
  }
  inFlight++;
  void (async () => {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(`${GATE_URL}/v1/systemone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: GATE_MODEL, state: String(state).slice(0, 2000), questions }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      const stateSnippet = String(state).slice(0, 300);
      await logLine({ kind: "shadow-ok", ms: Date.now() - t0, ...meta, state: stateSnippet, answers: data.answers });
    } catch (err) {
      await logLine({ kind: "shadow-failover", ms: Date.now() - t0, ...meta, error: String(err).slice(0, 200) });
    } finally {
      inFlight--;
    }
  })();
}

function matchesAny(text, patterns) {
  for (const p of patterns || []) {
    try {
      if (new RegExp(p).test(text)) return p;
    } catch {
      // pattern malformata: ignora
    }
  }
  return null;
}

function toolArgs(event) {
  const i = (event && event.input) || {};
  return i;
}

export default {
  id: "local-gate",
  async setup(ctx) {
    await loadRules();
    await loadThresholds();
    await logLine({ kind: "plugin-load" });

    // Routing + priorita in shadow su ogni prompt utente. Mai blocca.
    await ctx.session.hook("prompt", async (event) => {
      try {
        const text = String((event.prompt && event.prompt.text) || "").slice(0, 2000);
        if (!text.trim()) return;
        shadow(text, {
          route: {
            type: "choice",
            instructions: "Which task type is this prompt?",
            criteria: {
              bug: "Fixing an error or broken behavior",
              feature: "New code or functionality",
              refactor: "Restructure code without behavior change",
              docs: "Documentation or explanations",
            },
          },
          priority: {
            type: "choice",
            instructions: "How complex/risky is this task?",
            criteria: {
              trivial: "Trivial question or tiny lookup",
              simple: "Small bounded task",
              complex: "Multi-step work across files",
              critical: "Production, data loss or security risk",
            },
          },
        }, { hook: "prompt" });
      } catch {
        // fail-open
      }
    });

    // Sicurezza: blocco deterministico istantaneo, resto in shadow.
    await ctx.tool.hook("execute.before", async (event) => {
      const r = await loadRules();
      const args = toolArgs(event);
      try {
        if (event.tool === "bash") {
          const cmd = String(args.command || args.cmd || "");
          const hit = matchesAny(cmd, r.bash_deny);
          if (hit) {
            await logLine({ kind: "block", cmd: cmd.slice(0, 500), rule: hit });
            throw new Error(`[gate] comando bloccato dalla policy locale (regola: ${hit})`);
          }
          // Pattern sospetti ma non bloccanti: flag immediato <1ms, senza modello.
          const ask = matchesAny(cmd, r.bash_ask_shadow);
          if (ask) {
            await logLine({ kind: "ask-shadow", cmd: cmd.slice(0, 500), rule: ask });
          }
        }
        if (event.tool === "write" || event.tool === "edit") {
          const p = String(args.filePath || args.path || args.file || "");
          const hit = matchesAny(p, r.write_deny_paths);
          if (hit) {
            await logLine({ kind: "block", path: p.slice(0, 500), rule: hit });
            throw new Error(`[gate] scrittura bloccata dalla policy locale (regola: ${hit})`);
          }
        }
        // Niente shadow safety: la sicurezza e' solo deterministica (sopra).
        // Il modello 0.8B serve routing/priorita/giudice.
      } catch (err) {
        if (err && err.message && err.message.startsWith("[gate]")) throw err;
        // qualsiasi altro errore: fail-open
      }
    });

    // Giudice output in shadow.
    await ctx.tool.hook("execute.after", async (event) => {
      try {
        const text = JSON.stringify(event).slice(0, 1500);
        if (!text.trim()) return;
        shadow(`tool=${event.tool} result=${text}`, {
          grounded: { type: "noul", instructions: "Does the tool result indicate successful completion?" },
        }, { hook: "tool.execute.after", tool: event.tool });
      } catch {
        // fail-open
      }
    });
  },
};
