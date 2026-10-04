// Instradamento subagent via gate locale (stile oc-agent-router, ma con
// classificatore localhost invece di Jev hosted). L'utente lavora con gli
// agent normali (Build); i subagent task vengono modellati dal gate.
export default {
  id: "local-router",
  async setup(ctx) {
    const GATE_URL = "http://127.0.0.1:8080";
    const STRONG = "opencode/muse-spark-1.3-contributor-free";
    const LIGHT = "opencode/big-pickle";

    async function logLine(obj) {
      try {
        const { appendFile } = await import("node:fs/promises");
        await appendFile("/home/nabz/Dev/opencode-gate/logs/gate.log",
          JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
      } catch { /* best-effort */ }
    }

    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent" && event.tool !== "task") return;
      const input = event.input || {};
      // Rispetta modello esplicito e resume: non toccare.
      if (input.model !== undefined || input.sessionID !== undefined) return;
      const prompt = String(input.prompt || input.task || input.description || "").slice(0, 2000);
      if (!prompt.trim()) return;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        const res = await fetch(`${GATE_URL}/v1/systemone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: "openjev-08b-nli",
            state: prompt,
            questions: {
              priority: {
                type: "choice",
                instructions: "How complex is this task?",
                criteria: {
                  trivial: "Trivial question",
                  simple: "Small bounded task",
                  complex: "Multi-step work",
                  critical: "Production or data loss risk",
                },
              },
            },
          }),
        });
        clearTimeout(timer);
        const data = await res.json();
        const prio = data?.answers?.priority?.choice ?? "simple";
        const heavy = prio === "complex" || prio === "critical";
        input.model = heavy ? STRONG : LIGHT;
        await logLine({ kind: "route", hook: "subagent", priority: prio, model: input.model });
      } catch {
        // fail-open: lascia il modello configurato
      }
    });
  },
};
