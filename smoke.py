"""Smoke test Fase 1 via A: FastJev + GGUF Q4_K_M via llama.cpp (CPU)."""
import time
from fastjev import Choice, FastJev, LlamaCppBackend, Option, Boolean, Score, Level

REPO = "bartowski/Qwen_Qwen3.5-4B-GGUF"
REVISION = "4168f45a16a1290d65a4ec0fa312ae917a4c15d6"
FILENAME = "Qwen_Qwen3.5-4B-Q4_K_M.gguf"

t0 = time.time()
backend = LlamaCppBackend.from_pretrained(
    REPO,
    revision=REVISION,
    filename=FILENAME,
    n_gpu_layers=0,  # CPU-only: wheel pip senza CUDA; GPU dopo se serve
)
print(f"[load] {time.time()-t0:.1f}s path={backend.info.model} rev={backend.info.revision}")

with FastJev(backend) as jev:
    state = "Customer message: I was charged twice for my order last week and nobody has replied."
    t1 = time.time()
    answers = jev.decide_many(state, {
        "route": Choice("Which team should handle this?", [
            Option("billing", "Charges, refunds, invoices"),
            Option("shipping", "Delivery, tracking, parcels"),
            Option("technical", "Bugs, login, integrations"),
        ]),
        "angry": Boolean("Is the customer angry?"),
        "urgency": Score("How urgent is this?", [
            Level(0, "can wait"), Level(1, "this week"),
            Level(2, "today"), Level(3, "right now"),
        ]),
    })
    dt = time.time() - t1
    print(f"[decide_many 3q] {dt:.2f}s")
    for qid, d in answers.items():
        print(f"  {qid}: value={d.value} probs={d.probabilities} tokens={d.usage}")
print("SMOKE-OK")
