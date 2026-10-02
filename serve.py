"""Server SystemOne locale Fase 1 via A: FastJev Qwen3.5-4B GGUF su :8080 (CPU)."""
from fastjev import FastJev, LlamaCppBackend, SystemOneAdapter
from fastjev.http import create_app

REPO = "bartowski/Qwen_Qwen3.5-4B-GGUF"
REVISION = "4168f45a16a1290d65a4ec0fa312ae917a4c15d6"
FILENAME = "Qwen_Qwen3.5-4B-Q4_K_M.gguf"

backend = LlamaCppBackend.from_pretrained(
    REPO,
    revision=REVISION,
    filename=FILENAME,
    n_gpu_layers=0,
    prefix_reuse=True,  # una sola valutazione del prefisso stato per decide_many
)
jev = FastJev(backend)
service = SystemOneAdapter(
    jev,
    served_model="fastjev-qwen3.5-4b",
    description="fastjev direct option-logit baseline on Qwen3.5-4B Q4_K_M (local CPU)",
    release_date="2026-09-18",
)
app = create_app(service)
