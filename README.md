# opencode-gate — classificatore locale interposto a OpenCode

Gate decisionale locale: OpenCode (coding su modelli cloud Zen free) +
classificatore FastJev su GPU/CPU locale via plugin, modalità shadow.

## Architettura

```
Prompt utente -> [gate.ts hook "prompt"] -> shadow routing + priorita (:8080)
Tool bash/write/edit -> [gate.ts "tool.execute.before"]
    -> blocco deterministico istantaneo (rules.json) OPPURE
    -> flag immediato ask-shadow (<1ms) + shadow safety (:8080)
Tool result -> [gate.ts "tool.execute.after"] -> shadow grounded (:8080)
```

Il modello (~19s su CPU i5) non blocca mai: tutto il traffico ML è
fire-and-forget con fail-open. Blocca solo `rules.json` (regex, <1ms).

## Componenti

| File | Ruolo |
|---|---|
| `plugin/gate.ts` | sorgente plugin OpenCode v2 (id `local-gate`) → copiare in `~/.config/opencode/plugins/` |
| `systemd/opencode-gate.service` | unit → copiare in `~/.config/systemd/user/` |
| `rules.json` | policy deterministiche (blocchi + ask-shadow) |
| `thresholds.json` | soglie tarate 2026-10-02 (14 casi, 14/14, `logs/tuning.json`) |
| `serve.py` | app FastAPI SystemOne (`fastjev-qwen3.5-4b`, GGUF Q4_K_M ~3GB) |
| `smoke.py` / `tune.py` | test fumo / batteria taratura (solo classificazione) |
| `~/.config/systemd/user/opencode-gate.service` | persistenza (enable + linger) |
| `logs/gate.log` | verdetti shadow (`shadow-ok`, `review`, `ask-shadow`, `block`) |

## Reinstallazione da zero

```bash
mkdir -p ~/Dev/opencode-gate/models ~/Dev/opencode-gate/logs
cd ~/Dev/opencode-gate
uv venv --python 3.12 .venv
. .venv/bin/activate
uv pip install 'fastjev[llama-cpp,api]'
# download GGUF (~3GB) + smoke test:
python smoke.py
# persistenza:
cp /percorso/backup/opencode-gate.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-gate.service
loginctl enable-linger $USER
# plugin: copiare il sorgente versionato e abilitarlo (hot-reload automatico)
cp plugin/gate.ts ~/.config/opencode/plugins/
# thresholds.json + rules.json in ~/Dev/opencode-gate/
```

Modello pinnato: `bartowski/Qwen_Qwen3.5-4B-GGUF`
revisione `4168f45a16a1290d65a4ec0fa312ae917a4c15d6`,
file `Qwen_Qwen3.5-4B-Q4_K_M.gguf`, backend CPU (`n_gpu_layers=0`).
NOTA GPU (verificato 2026-10-04): offload CUDA non utilizzabile qui.
Wheel `cu124` si carica con cudart/cublas 12.8 ma va in SIGILL su i5-6500
(parte CPU compilata per istruzioni più recenti); CUDA 13 escluso (niente
Pascal). Restare su CPU (`n_gpu_layers=0`). Unica via residua: compilare
llama-cpp-python da sorgente con toolkit completo (pesante, non fatto).

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

## Soglie (non calibrate: entropia normalizzata, da rivalutare su dati reali)

route top ≥ 0.6 · safety review < 0.7 · priority bande 0.8/1.5/2.5 · done ≥ 0.6
