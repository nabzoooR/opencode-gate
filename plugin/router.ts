// Router free-model esteso + circuit breaker anti rate-limit.
// Corsie privacy-aware; modelli verificati contro /zen/v1/models all'avvio.
const GATE_URL = "http://127.0.0.1:8080";
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";

// tier: light = zero-retention o leggeri, mid = generalisti, heavy = forti
const FREE_TABLE = [
  { id: "opencode/space-bunny-free", tier: "light", zeroRetention: true },
  { id: "opencode/longcat-2.5-preview-free", tier: "light", zeroRetention: true },
  { id: "opencode/ling-3.1-flash-free", tier: "light", zeroRetention: false },
  { id: "opencode/mimo-v2.6-flash-free", tier: "light", zeroRetention: false },
  { id: "opencode/fledge-alpha-free", tier: "mid", zeroRetention: false },
  { id: "opencode/mimo-v2.5-free", tier: "mid", zeroRetention: false },
  { id: "opencode/ling-3.0-flash-fin-free", tier: "mid", zeroRetention: false },
  { id: "opencode/big-pickle", tier: "mid", zeroRetention: false },
  { id: "opencode/nemotron-3.5-lightning-free", tier: "heavy", zeroRetention: false, noPersonalData: true },
  { id: "opencode/nemotron-3-ultra-free", tier: "heavy", zeroRetention: false, noPersonalData: true },
  { id: "opencode/muse-spark-1.3-contributor-free", tier: "heavy", zeroRetention: false, trainsOnData: true },
];
const BLOCK_MS = 10 * 60 * 1000;

export default {
  id: "local-router",
  async setup(ctx) {
    let available = new Set(FREE_TABLE.map((m) => m.id));
    try {
      const res = await fetch(ZEN_MODELS_URL);
      const data = await res.json();
      const models = data.models || data.data || [];
      const freeIds = new Set(
        models.filter((m) => (m.cost && m.cost.input === 0) || /free/i.test(m.id || m.name || ""))
          .map((m) => "opencode/" + (m.id || m.name))
      );
      if (freeIds.size > 0) available = freeIds;
    } catch { /* tabella statica */ }

    const blocked = new Map(); // model -> timestamp fine blocco
    const usable = (tier) =>
      FREE_TABLE.filter((m) => m.tier === tier && available.has(m.id) && (blocked.get(m.id) || 0) < Date.now())
        .map((m) => m.id);
    const pick = (priority) => {
      const tiers = priority === "critical" || priority === "complex"
        ? ["heavy", "mid", "light"] : priority === "simple" ? ["mid", "light", "heavy"] : ["light", "mid", "heavy"];
      for (const t of tiers) {
        const list = usable(t);
        if (list.length > 0) return { model: list[0], tier: t };
      }
      return { model: "opencode/big-pickle", tier: "fallback" };
    };

    async function logLine(obj) {
      try {
        const { appendFile } = await import("node:fs/promises");
        await appendFile("/home/nabz/Dev/opencode-gate/logs/gate.log",
          JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
      } catch { /* best-effort */ }
    }

    async function classify(prompt) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      try {
        const res = await fetch(`${GATE_URL}/v1/systemone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: "openjev-08b-nli",
            state: prompt.slice(0, 2000),
            questions: {
              priority: {
                type: "choice",
                instructions: "How complex is this task?",
                criteria: { trivial: "Trivial", simple: "Small task", complex: "Multi-step", critical: "Production risk" },
              },
            },
          }),
        });
        const data = await res.json();
        return data?.answers?.priority?.choice ?? "simple";
      } catch {
        return "simple";
      } finally {
        clearTimeout(timer);
      }
    }

    // Circuit breaker: al 429 blocca il modello 10 min, riprova con attesa.
    await ctx.session.hook("retry", async (event) => {
      try {
        const st = event.error && event.error.status;
        const msg = String((event.error && (event.error.message || event.error.type)) || "");
        if (st === 429 || /rate.?limit|quota|FreeUsageLimit/i.test(msg)) {
          const model = event.model ? `${event.model.providerID}/${event.model.id}` : "unknown";
          blocked.set(model, Date.now() + BLOCK_MS);
          await logLine({ kind: "circuit-break", model, attempt: event.attempt });
          event.decision = { retry: true, delay: 15_000 };
        }
        // 400 flakiness provider (Responses API + history lunghe): un retry
        // singolo aiuta — i "Riprova" manuali avanzano. Solo al 1° tentativo.
        if (st === 400 && /invalid parameters/i.test(msg) && event.attempt === 1) {
          await logLine({ kind: "retry-400", attempt: event.attempt });
          event.decision = { retry: true, delay: 5_000 };
        }
      } catch { /* fail-open */ }
    });

    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent" && event.tool !== "task") return;
      const input = event.input || {};
      if (input.model !== undefined || input.sessionID !== undefined) return;
      const prompt = String(input.prompt || input.task || input.description || "").slice(0, 2000);
      if (!prompt.trim()) return;
      try {
        const prio = await classify(prompt);
        const { model, tier } = pick(prio);
        input.model = model;
        await logLine({ kind: "route", hook: "subagent", priority: prio, tier, model });
      } catch { /* fail-open */ }
    });
  },
};
