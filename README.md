# opencode-gate — classificatore locale interposto a OpenCode

Gate decisionale locale: OpenCode (coding su modelli cloud) +
classificatore NLI `openjev-08b-nli` (0.8B, ~1.7GB safetensors) su CPU
locale via plugin, modalità shadow. Il modello non blocca mai:
tutto il traffico ML è fire-and-forget con fail-open.
Blocca solo `rules.json` (regex, <1ms).

Storico: server FastJev Qwen3.5-4B GGUF (`serve.py`, `smoke.py`)
pensionato il 2026-10-04 — lento (7–40s + primo avvio ~100s), leak RAM
fino a OOM. Vedi "Modello (storico)" in fondo.

## Architettura

```
Prompt utente -> [gate.ts hook "prompt"] -> shadow route+priority (:8080)
Subagent/task -> [router.ts hook "execute.before"] -> routing sync al modello forte/leggero
Tool bash/write/edit -> [gate.ts "tool.execute.before"]
    -> blocco deterministico istantaneo (rules.json) OPPURE
    -> flag immediato ask-shadow (<1ms, senza modello)
Tool result -> [gate.ts "tool.execute.after"] -> shadow grounded (:8080)
```

Serializzazione: max 1 shadow in volo (`MAX_INFLIGHT=1`), gli altri
vengono droppati e loggati come `shadow-dropped` — il modello 0.8B
serializza su CPU (~3–8s a domanda). Abort shadow a 120s.

## Componenti

| File | Ruolo |
|---|---|
| `plugin/gate.ts` | plugin OpenCode v2 (id `local-gate`): prompt shadow route+priority, blocchi deterministici bash/write, giudice grounded shadow → copiare in `~/.config/opencode/plugins/` |
| `plugin/router.ts` | plugin OpenCode v2 (id `local-router`, **sperimentale, non committato**): instrada subagent/task su modello forte o leggero in base alla priority classificata (`complex`/`critical` → strong) |
| `serve08.py` | app FastAPI SystemOne (`openjev-08b-nli`, NLI 0.8B, CPU torch float32, 4 thread, batch per domanda, tipi `choice`/`noul`/`score`) |
| `serve.py` | storico: server FastJev 4B (pensionato, vedi sopra) |
| `rules.json` | policy deterministiche v1 (blocchi `bash_deny` + `write_deny_paths`, flag `bash_ask_shadow`) |
| `thresholds.json` | soglie v2 tarate 2026-10-04 (`openjev-08b-nli`, probe live + bench) |
| `bench08.py` | bench 0.8B NLI sugli stessi 14 casi di `tune.py` (10/14: safety e priority-score non affidabili col modello piccolo) |
| `smoke.py` / `tune.py` | storici (stack FastJev 4B): smoke test GGUF / batteria taratura 14 casi (`logs/tuning.json`, 14/14 sul 4B) |
| `systemd/opencode-gate.service` | unit → copiare in `~/.config/systemd/user/` (uvicorn `serve08:app`, `:8080`, 1 worker, `MemoryMax=12G`) |
| `memcheck.sh` | guardian memoria: restart sopra 9GB (leak noto runtime), da timer systemd ogni 15 min |
| `models/openjev-08b/qwen3.5-0.8b-nli-v2s-long/` | pesi HF locali (safetensors) caricati da `serve08.py` |
| `logs/gate.log` | verdetti shadow (`plugin-load`, `shadow-ok`, `shadow-dropped`, `shadow-failover`, `review`, `ask-shadow`, `block`, `route`) |

## Reinstallazione da zero

```bash
mkdir -p ~/Dev/opencode-gate/models ~/Dev/opencode-gate/logs
cd ~/Dev/opencode-gate
uv venv --python 3.12 .venv
. .venv/bin/activate
uv pip install torch transformers fastapi uvicorn pydantic
# pesi HF in models/openjev-08b/qwen3.5-0.8b-nli-v2s-long/ + smoke test:
curl -s http://127.0.0.1:8080/v1/models
# persistenza:
cp systemd/opencode-gate.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-gate.service
loginctl enable-linger $USER
# plugin: copiare i sorgenti versionati (hot-reload automatico al salvataggio)
cp plugin/gate.ts ~/.config/opencode/plugins/
# thresholds.json + rules.json restano in ~/Dev/opencode-gate/ (percorsi assoluti in gate.ts)
```

## Operatività

```bash
systemctl --user status opencode-gate.service
journalctl --user -u opencode-gate.service -n 20
curl -s http://127.0.0.1:8080/v1/models
tail -f ~/Dev/opencode-gate/logs/gate.log
```

OpenCode Desktop ricarica `gate.ts` al salvataggio (watcher); per nuove
installazioni uscire del tutto dall'app e riaprirla. Se `gate.log` non nasce,
controllare `~/.local/share/opencode/log/opencode.log` per `failed to load plugin`.

## Soglie (`thresholds.json` v2, 2026-10-04)

| Domanda | Soglia | Nota |
|---|---|---|
| route (choice bug/feature/refactor/docs) | accetta se top ≥ 0.6 | probe 0.97–1.0 sui corretti |
| priority (**choice** trivial/simple/complex/critical) | accetta se top ≥ 0.55 | probe: trivial 0.69 / simple 0.67 / critical 0.60; lo `score` numerico non discrimina, non usare |
| grounded (noul) | done se ≥ 0.6 | bench: ok 1.00, fail 0.00 |
| safety | **solo deterministica** (`rules.json`) | modello 0.8B inaffidabile su safety (es. `mkfs` 0.87) |

Bench 0.8B (`bench08.py`, 14 casi): 10/14 — falliscono i 4 casi
safety/priority-score ereditati dal bench 4B; per questo safety è solo
deterministica e priority è passata a choice.

## Modello (storico 4B, pensionato)

Pinnato: `bartowski/Qwen_Qwen3.5-4B-GGUF`
revisione `4168f45a16a1290d65a4ec0fa312ae917a4c15d6`,
file `Qwen_Qwen3.5-4B-Q4_K_M.gguf`, backend CPU (`n_gpu_layers=0`).
NOTA GPU (verificato 2026-10-05): FUNZIONA con torch cu126 (kernel sm_61
presenti; cu130 invece non ne ha). Richiede cudart+cublas 12.8 di sistema e
`uv pip install torch --index-url .../cu126` (rete lenta verso pypi.nvidia.com:
ripetere finche passa). 0.8B fp32 = ~3.4GB VRAM, ~56ms/forward, 0.7s/3 domande
vs 2.4s su CPU. Wheel llama-cpp CUDA resta inutilizzabile (SIGILL su i5).
