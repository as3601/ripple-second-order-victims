"""LLM layer: plain-language control-room briefing + AI-suggested hidden dependencies.

Providers are tried in order; the first that answers wins. All except Claude are free:
  1. Ollama (local, offline, no key)   RIPPLE_OLLAMA_MODEL  (default qwen2.5:3b, ~6s on a 4GB GPU)
  2. Groq   (free tier, needs GROQ_API_KEY)    RIPPLE_GROQ_MODEL
  3. Gemini (free tier, needs GEMINI_API_KEY)  RIPPLE_GEMINI_MODEL
  4. Claude (paid, needs ANTHROPIC_API_KEY)    RIPPLE_MODEL
Otherwise falls back to a deterministic template so the demo never breaks.
Only the standard library is used for the free providers (no extra installs).
"""
import json
import os
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("RIPPLE_OLLAMA_MODEL", "qwen2.5:3b")
GROQ_MODEL = os.environ.get("RIPPLE_GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_MODEL = os.environ.get("RIPPLE_GEMINI_MODEL", "gemini-2.5-flash")
CLAUDE_MODEL = os.environ.get("RIPPLE_MODEL", "claude-opus-5-5")

SCHEMA = {
    "type": "object",
    "properties": {
        "briefing": {"type": "string"},
        "hidden_links": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["briefing", "hidden_links"],
    "additionalProperties": False,
}

SYSTEM = (
    "You support a city emergency control room in the Chandigarh tricity, India. "
    "Given a disruptive event and the cascade engine's ranked predictions, write a briefing "
    "of at most 5 short sentences in plain language for the duty officer: who will be affected "
    "next, when, and the 2-3 actions to take first. Use the numbers given; do not invent new figures. "
    "Then list 3-5 plausible hidden second-order dependencies the engine did NOT model "
    "(specific to Indian cities: informal workers, mandis, ASHA workers, PDS, etc.), one line each. "
    'Reply with JSON only: {"briefing": "...", "hidden_links": ["...", "..."]}'
)


def template_brief(result):
    ev, imps = result["event"], result["impacts"]
    if not imps:
        return "No downstream human consequences predicted above threshold for this event."
    label = ev.get("label") or ev["type"].replace("_", " ").title()
    lines = [f"{label}: {result['totals']['people']:,} people across {result['totals']['zones']} zones "
             f"face knock-on effects; {result['totals']['critical']} alerts are critical."]
    for i in sorted(imps[:4], key=lambda i: i["eta_h"]):
        lines.append(f"T+{i['eta_h']}h: {i['title']}.")
    lines.append(f"Act first: {imps[0]['action'].split(';')[0]}.")
    return " ".join(lines)


def _post(url, body, headers=None, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _ollama(prompt):
    r = _post(f"{OLLAMA_URL}/api/chat", {
        "model": OLLAMA_MODEL, "stream": False, "format": SCHEMA, "keep_alive": "60m",
        "options": {"temperature": 0.3},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
    }, timeout=90)
    return r["message"]["content"]


def warm_up():
    """Load the local model into memory so the first demo click is fast. Silent if Ollama is absent."""
    try:
        _post(f"{OLLAMA_URL}/api/generate", {"model": OLLAMA_MODEL, "keep_alive": "60m"}, timeout=120)
    except Exception:
        pass


def _groq(prompt):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return None
    r = _post("https://api.groq.com/openai/v1/chat/completions", {
        "model": GROQ_MODEL, "response_format": {"type": "json_object"}, "temperature": 0.3,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
    }, headers={"Authorization": f"Bearer {key}"}, timeout=30)
    return r["choices"][0]["message"]["content"]


def _gemini(prompt):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    r = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent", {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3},
    }, headers={"x-goog-api-key": key}, timeout=30)
    return r["candidates"][0]["content"]["parts"][0]["text"]


def _claude(prompt):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    import anthropic
    resp = anthropic.Anthropic().beta.messages.create(
        model=CLAUDE_MODEL, max_tokens=2000, system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"},
        messages=[{"role": "user", "content": prompt}],
    )
    if resp.stop_reason == "refusal":
        return None
    return "".join(b.text for b in resp.content if b.type == "text")


PROVIDERS = [("ollama", _ollama), ("groq", _groq), ("gemini", _gemini), ("claude", _claude)]


def brief(result):
    payload = json.dumps({
        "event": result["event"],
        "first_order": [f["what"] for f in result["first_order"]],
        "top_predictions": [{k: i[k] for k in ("order", "label", "title", "people", "eta_h",
                                                 "priority", "action")} for i in result["impacts"][:10]],
        "hospital_load": [h for h in result["hospital_load"] if h["ratio"] >= 0.85],
    })
    errors = []
    for name, fn in PROVIDERS:
        try:
            text = fn(payload)
            if not text:
                continue
            data = json.loads(text)
            links = [str(t) for t in data.get("hidden_links", [])][:5]
            return {"briefing": str(data["briefing"]),
                    "hidden_links": [{"text": t, "source": name} for t in links],
                    "source": name}
        except Exception as e:  # provider down, no key, bad JSON -> try the next one
            errors.append(f"{name}: {type(e).__name__}")
    return {"briefing": template_brief(result), "hidden_links": [], "source": "template",
            "note": "; ".join(errors)}
