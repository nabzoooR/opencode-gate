"""Server SystemOne locale su 0.8B NLI (CPU). Batch per domanda, niente safety:
la sicurezza resta solo deterministica (rules.json nel plugin)."""
import time
import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForSequenceClassification

DIR = "/home/nabz/Dev/opencode-gate/models/openjev-08b/qwen3.5-0.8b-nli-v2s-long"
SERVED = "openjev-08b-nli"

tok = AutoTokenizer.from_pretrained(DIR, trust_remote_code=True)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
model = AutoModelForSequenceClassification.from_pretrained(
    DIR, dtype=torch.float32, trust_remote_code=True).to(DEVICE).eval()
print(f"[serve08] device={DEVICE}", flush=True)
TPL = model.config.nli_template
ENT = next(int(i) for i, l in model.config.id2label.items() if l == "entailment")
torch.set_num_threads(4)

app = FastAPI()


class Question(BaseModel):
    type: str
    instructions: str = ""
    criteria: dict | list | None = None


class Request(BaseModel):
    model: str
    state: str | dict
    questions: dict[str, Question]


def state_text(s) -> str:
    import json as _json
    return s if isinstance(s, str) else _json.dumps(s)


@torch.no_grad()
def entail_batch(premise: str, hyps: list[str]) -> list[float]:
    texts = [TPL.format(premise=premise, hypothesis=h) for h in hyps]
    enc = tok(texts, return_tensors="pt", padding=True, truncation=True, max_length=1024).to(DEVICE)
    logits = model(**enc).logits
    return torch.softmax(logits, -1)[:, ENT].tolist()


@app.get("/v1/models")
def models():
    return {"models": [{"name": SERVED, "description": "openjev 0.8B NLI cross-encoder (local GPU)"}]}


@app.post("/v1/systemone")
def systemone(req: Request):
    t0 = time.time()
    st = state_text(req.state)[:2000]
    answers = {}
    for qid, q in req.questions.items():
        ins = q.instructions or ""
        if q.type == "choice":
            crit = q.criteria if isinstance(q.criteria, dict) else {}
            labels = list(crit.keys())
            hyps = [f"{ins} This text is about {k}: {crit[k] if crit[k] else k}" for k in labels]
            scores = entail_batch(st, hyps)
            tot = sum(scores) or 1.0
            probs = {k: s / tot for k, s in zip(labels, scores)}
            best = max(probs, key=probs.get)
            answers[qid] = {"type": "choice", "choice": best, "probabilities": probs}
        elif q.type == "noul":
            (p,) = entail_batch(st, [ins])
            answers[qid] = {"type": "noul", "noul": p}
        elif q.type == "score":
            levels = list(q.criteria) if isinstance(q.criteria, list) else []
            hyps = [f"{ins} Level: {lv}" for lv in levels]
            scores = entail_batch(st, hyps)
            tot = sum(scores) or 1.0
            probs = {str(i): s / tot for i, s in enumerate(scores)}
            answers[qid] = {"type": "score", "score": sum(i * s / tot for i, s in enumerate(scores)),
                            "probabilities": probs, "legend": {str(i): lv for i, lv in enumerate(levels)}}
    return {"model": SERVED, "answers": answers,
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "timing_ms": int((time.time() - t0) * 1000)}
