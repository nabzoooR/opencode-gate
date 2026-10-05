import { tool } from "@opencode-ai/plugin";

const GATE_URL = "http://127.0.0.1:8080";
const GATE_MODEL = "openjev-08b-nli";

const STRONG_MODEL = "opencode/muse-spark-1.3-contributor-free";
const MID_MODEL = "opencode/big-pickle";
const LIGHT_MODEL = "opencode/space-bunny-free";

export default tool({
  description:
    "Classifica un task col gate locale e restituisce corsia + modello free consigliato. Usare prima di delegare a un subagent.",
  args: {
    task: tool.schema.string().describe("Descrizione completa del task da instradare"),
  },
  async execute(args) {
    const fallback = JSON.stringify({ lane: "lite", model: MID_MODEL, via: "fallback" });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(`${GATE_URL}/v1/systemone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: GATE_MODEL,
          state: String(args.task).slice(0, 2000),
          questions: {
            route: {
              type: "choice",
              instructions: "Which task type is this?",
              criteria: {
                bug: "Fixing an error",
                feature: "New code",
                refactor: "Restructure without behavior change",
                docs: "Documentation",
              },
            },
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
      const route = data?.answers?.route?.choice ?? "feature";
      const model = prio === "critical" || prio === "complex" ? STRONG_MODEL
        : prio === "simple" ? MID_MODEL : LIGHT_MODEL;
      const lane = prio === "critical" || prio === "complex" ? "build" : "lite";
      return JSON.stringify({ lane, model, route, priority: prio });
    } catch {
      return fallback;
    }
  },
});
