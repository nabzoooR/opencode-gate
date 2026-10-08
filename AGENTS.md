# opencode-gate — istruzioni sessione

Gate decisionale locale per OpenCode: classificatore 0.8B NLI su GPU + plugin.

## Architettura (non cambiare senza motivo)
- `serve08.py` → FastAPI SystemOne `openjev-08b-nli` su `:8080` via systemd (`opencode-gate.service`).
- `plugin/gate.ts` → hook prompt/tool (shadow fail-open); safety SOLO deterministica (`rules.json`).
- `plugin/router.ts` → instrada subagent sui free Zen + circuit breaker 429.
- `plugin/gate_route.ts` → tool manuale di routing (in `~/.config/opencode/tools/`).
- Safety via modello abolita (0.8B inaffidabile); priorità come `choice`, mai `score`.

## Divieti
- Mai esporre `:8080` fuori localhost. Niente auth richiesta proprio perché loopback.
- Non committare `models/`, `.venv/`, `logs/` (pesi, dipendenze, prompt utente).
- Non modificare `version:`/soglie senza misura prima/dopo su `logs/`.

## Memoria progetto (aggiornare ai milestone)
- Stack GPU: torch cu126 (kernel sm_61 ok); cu130 e wheel llama-cpp CUDA NON funzionano qui.
- Soglie in `thresholds.json` v2 (route 0.6, priorità choice, grounded 0.6).
- Memcheck systemd ogni 15 min sopra 9GB (leak runtime noto).
